/**
 * The application: one renderer, audio context, input manager, save and settings for the page's lifetime,
 * a route state machine for the menus, and a disposable RaceSession per race. The next race always waits in
 * 'title' state behind the menus, so the backdrop is the real track and field.
 */
import { batch, computed, effect, signal } from '@preact/signals';
import { CONFIG, readUrlFlags, type UrlFlags } from '../core/config';
import { hazardPolicy } from '../core/hazards';
import type { AITier, HudActions, Loadout, MenuAction, PartSlot, PartTier } from '../core/contracts';
import { FEATURES, type FeatureName, type FeatureSet } from '../core/features';
import { FrameStats, MISSED_FRAME_MS } from '../core/FrameStats';
import { GameLoop } from '../core/loop';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { buyPart, equipPart, selectChassis, settleRace, type PurchaseResult } from '../content/economy';
import { buyEmp, type ItemPurchase } from '../content/items';
import { AudioSystem, localRecordStore, type RecordStore } from '../game';
import { GraphicsSystem } from '../graphics';
import { PerfOverlay, formatSummary } from '../graphics/PerfOverlay';
import { AssetLoader } from '../assets/AssetLoader';
import { TRACK_DEFS } from '../content/tracks';
import { WORLDS, worldById, type WorldDef } from '../content/worlds';
import { InputManager } from '../physics';
import type { InputDevice } from '../physics/InputManager';
import { SaveStore, type FallbackReason } from '../save/SaveStore';
import { MAX_PROFILES, createProfile, type Profile, type ProfilePreset, type SaveData, type SettingsData } from '../save/schema';
import { Settings } from '../settings/Settings';
import { DynamicResolution } from '../settings/DynamicResolution';
import { QUALITY_PROFILES, QualityBenchmark, deviceHint, type QualityLevel } from '../settings/QualityManager';
import { bindHaptics, isNativeApp } from '../native/haptics';
import { navigate } from '../ui/nav';
import { RaceSession, type RaceSetup } from './RaceSession';
import { initialRoute, isMenuRoute, type Route } from './routes';

export interface AppElements {
  app: HTMLElement;
  hud: HTMLElement;
  ui: HTMLElement;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'warn';
}

const NAV_ACTIONS: readonly MenuAction[] = ['up', 'down', 'left', 'right', 'confirm', 'back'];
const DIRECTIONS: readonly MenuAction[] = ['up', 'down', 'left', 'right'];

const FALLBACK_TEXT: Record<FallbackReason, string> = {
  unavailable: 'This browser is blocking storage, so progress won’t be kept after you close the page.',
  'write-failed': 'Storage is full or blocked, so progress won’t be kept after you close the page.',
  'newer-version': 'Your save comes from a newer MachZero, so it’s read-only here.',
};

/** Resolves after the browser has had a chance to paint (with a fallback for hidden tabs, where rAF stalls). */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0);
    requestAnimationFrame(done);
    setTimeout(resolve, 100);
  });
}

export class App {
  readonly flags: UrlFlags = readUrlFlags();
  readonly features: FeatureSet = FEATURES;
  /** The Preact menus replace the v1 start screen (feature `profiles`). */
  readonly menus: boolean = FEATURES.profiles && !this.flags.autopilot;

  readonly route = signal<Route>({ name: 'loading' });
  readonly save = signal<SaveData>(null as unknown as SaveData);
  readonly toasts = signal<Toast[]>([]);
  readonly activeProfile = computed<Profile | null>(() => {
    const s = this.save.value;
    return s.profiles.find((p) => p.id === s.activeProfileId) ?? null;
  });
  readonly settings: Settings;
  /** Preset in use right now (the benchmark may be testing one). */
  readonly qualityLevel = signal<QualityLevel>('high');
  /** True while the first-launch benchmark runs. */
  readonly benchmarking = signal(false);
  /** Device whose buttons the prompts show (the last one used; a pad as soon as one connects). */
  readonly inputDevice = signal<InputDevice>('keyboard');

  /** Set by the UI: receives gamepad / body-focused keyboard menu actions while a menu route is shown. */
  navHandler: ((action: MenuAction) => void) | null = null;

  private readonly store: SaveStore;
  private readonly graphics: GraphicsSystem;
  private readonly audio = new AudioSystem();
  private readonly input = new InputManager(window);
  private readonly assets = new AssetLoader();
  private readonly loop: GameLoop;
  private session: RaceSession | null = null;
  private sessionKey = '';
  private building: Promise<RaceSession> | null = null;
  private buildingKey = '';
  private toastId = 0;
  private bench: QualityBenchmark | null = null;
  private readonly frameStats = new FrameStats();
  private perf: PerfOverlay | null = null;
  /** Dynamic resolution, learnt across races (null with ?dynres=0). */
  private readonly dynres: DynamicResolution | null;
  private dynresFeeding = false;
  private simMs = 0;

  constructor(private readonly els: AppElements) {
    let pendingFallback: FallbackReason | null = null;
    this.store = new SaveStore(undefined, { onFallback: (r) => (pendingFallback = r) });
    this.save.value = this.store.load();
    this.settings = new Settings(this.save.value.settings);
    if (pendingFallback) this.toast(FALLBACK_TEXT[pendingFallback], 'warn', 9);

    this.graphics = new GraphicsSystem(els.app);
    this.input.onDeviceChange = (d) => this.setInputDevice(d);
    this.input.onPadChange = (connected) => this.padChanged(connected);
    this.applySettings(this.settings.snapshot());
    this.settings.onChange((s) => {
      this.applySettings(s);
      this.updateSave((d) => (d.settings = s));
    });

    // The in-race HUD is hidden while a menu screen is up.
    effect(() => {
      els.hud.style.visibility = isMenuRoute(this.route.value) ? 'hidden' : '';
    });

    this.dynres = this.flags.dynres && !this.flags.quality ? new DynamicResolution() : null;
    this.loop = new GameLoop({
      fixed: (dt) => {
        const t0 = performance.now();
        this.fixed(dt);
        this.simMs += performance.now() - t0;
      },
      frame: (dt, alpha, time) => {
        const t0 = performance.now();
        this.session?.frame(dt, alpha, time);
        const t1 = performance.now();
        this.graphics.render();
        const t2 = performance.now();
        if (this.bench) this.benchFrame(dt);
        this.afterFrame(this.loop.rawDt * 1000, t1 - t0, t2 - t1);
      },
    });
    const onResize = () => this.graphics.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', onResize);
    onResize();

    if (this.flags.debug || this.flags.autopilot) {
      const app = this;
      (window as unknown as Record<string, unknown>).__machzero = {
        app,
        get race() {
          return app.session?.race;
        },
        get ships() {
          return app.session?.ships;
        },
        get track() {
          return app.session?.track;
        },
        get physics() {
          return app.session?.physics;
        },
        get bus() {
          return app.session?.bus;
        },
        startRace: () => app.startRace(),
        restartRace: () => app.session?.restart(),
        memory: () => app.graphics.memoryInfo,
        /** Shader programs compiled so far (warm-up check). */
        programs: () => app.graphics.programCount,
        /** Frame stats of the current race (perf checks). */
        perf: () => app.frameStats.summary(),
        /** Add credits to the active profile (tests). */
        grantCredits: (n: number) => app.updateProfile((p) => (p.credits += n)),
        /** Dispose the current race and build a fresh one (leak checks). */
        rebuildRace: async () => {
          app.sessionKey = '';
          await app.ensureSession();
        },
      };
    }
  }

  /** Build the first race, pick the first screen and start the loop. */
  async start(): Promise<void> {
    if (this.features.garage) await this.loadShipAssets();
    await this.loadWorldAssets();
    await this.ensureSession();
    this.loop.start();
    const first = initialRoute(this.flags, this.features, this.save.value);
    if (this.flags.autopilot) setTimeout(() => this.session?.start(), 600);
    this.route.value = first;
  }

  // -------------------------------------------------------------------------
  // Actions (UI + HUD)
  // -------------------------------------------------------------------------

  /**
   * The race is (re)built here, behind the loading screen, never in the background on a menu: building one
   * blocks the main thread (≈ 0.3 s on a GPU, several seconds on SwiftShader), which froze menu input.
   */
  async startRace(): Promise<void> {
    this.route.value = { name: 'loading' };
    await nextPaint();
    await this.loadWorldAssets();
    const s = await this.ensureSession();
    s.start();
    this.route.value = { name: 'race' };
  }

  quitToMenu(): void {
    this.session?.toTitle();
    this.route.value = { name: 'menu' };
  }

  openSettings(back: 'menu' | 'pause'): void {
    if (back === 'pause' && this.session?.state !== 'paused') this.session?.pause(true);
    this.route.value = { name: 'settings', back };
  }

  closeSettings(): void {
    const r = this.route.value;
    this.route.value = r.name === 'settings' && r.back === 'pause' ? { name: 'race' } : { name: 'menu' };
  }

  openSoon(feature: FeatureName, title: string): void {
    this.route.value = { name: 'soon', feature, title };
  }

  openWorlds(): void {
    this.route.value = { name: 'worlds' };
  }

  /** World select: remember the world and race it. */
  selectWorld(worldId: string): void {
    const w = worldById(worldId);
    if (!w?.built) return;
    this.updateProfile((p) => (p.world = w.id), () => true);
    void this.startRace();
  }

  /** The world the next race is in, or null for the v1 classic / Bonus Track. */
  get currentWorld(): WorldDef | null {
    if (!this.features.worlds || this.flags.seed !== null) return null;
    const w = worldById(this.flags.world ?? this.activeProfile.value?.world ?? WORLDS[0].id);
    return w?.built ? w : WORLDS[0];
  }

  openGarage(): void {
    this.route.value = { name: 'garage' };
  }

  closeGarage(): void {
    this.route.value = { name: 'menu' };
  }

  /** Buy (pay, own and fit) a part for the active profile. */
  buyPart(slot: PartSlot, tier: PartTier): PurchaseResult {
    let result: PurchaseResult = 'invalid';
    this.updateProfile((p) => (result = buyPart(p, slot, tier)), () => result === 'bought');
    return result;
  }

  equipPart(slot: PartSlot, tier: PartTier): boolean {
    let ok = false;
    this.updateProfile((p) => (ok = equipPart(p, slot, tier)), () => ok);
    return ok;
  }

  selectChassis(chassisId: string): void {
    this.updateProfile((p) => selectChassis(p, chassisId));
  }

  setLivery(livery: Loadout['livery']): void {
    this.updateProfile((p) => (p.loadout.livery = { ...livery }));
  }

  /** Buy one EMP for the active profile. */
  buyEmp(): ItemPurchase {
    let result: ItemPurchase = 'short';
    this.updateProfile((p) => (result = buyEmp(p)), () => result === 'bought');
    return result;
  }

  /** CPU difficulty for the active profile's next race. */
  setAiTier(tier: AITier): void {
    this.updateProfile((p) => (p.aiTier = tier));
  }

  /** Garage turntable: draw `loadout` into `el`, or stop with null. */
  showShipPreview(el: HTMLElement | null, loadout: Loadout | null): void {
    this.graphics.showPreview(el, loadout);
  }

  nudgeShipPreview(radians: number): void {
    this.graphics.nudgePreview(radians);
  }

  showProfiles(): void {
    this.route.value = { name: 'profiles' };
  }

  get canAddProfile(): boolean {
    return this.save.value.profiles.length < MAX_PROFILES;
  }

  createProfile(name: string, badge: number, preset: ProfilePreset): void {
    if (!this.canAddProfile) return;
    const p = createProfile(name, badge, preset);
    this.updateSave((d) => {
      d.profiles.push(p);
      d.activeProfileId = p.id;
    });
    this.toast(`Welcome, ${p.name}!`, 'good');
    this.route.value = { name: 'menu' };
  }

  selectProfile(id: string): void {
    this.updateSave((d) => (d.activeProfileId = id));
    this.route.value = { name: 'menu' };
  }

  deleteProfile(id: string): void {
    this.updateSave((d) => {
      d.profiles = d.profiles.filter((p) => p.id !== id);
      if (d.activeProfileId === id) d.activeProfileId = null;
    });
  }

  toggleMute(): void {
    this.settings.muted.value = !this.settings.muted.value;
  }

  /** Download every profile and setting as JSON. */
  exportSave(): void {
    const json = this.store.exportJson(this.save.value);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `machzero-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast('Save exported.', 'good');
  }

  /** Replace the whole save with an exported file. Returns an error message, or null on success. */
  importSave(text: string): string | null {
    let data: SaveData;
    try {
      data = this.store.importJson(text);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    batch(() => {
      this.save.value = data;
      this.settings.replace(data.settings);
    });
    this.store.save(data);
    this.toast(`Imported ${data.profiles.length} profile${data.profiles.length === 1 ? '' : 's'}.`, 'good');
    return null;
  }

  toast(text: string, kind: Toast['kind'] = 'info', seconds = 3.5): void {
    const t: Toast = { id: ++this.toastId, text, kind };
    this.toasts.value = [...this.toasts.value, t].slice(-3);
    setTimeout(() => (this.toasts.value = this.toasts.value.filter((x) => x.id !== t.id)), seconds * 1000);
  }

  /** Label of the race the menu's RACE entry starts. */
  get raceLabel(): string {
    const w = this.currentWorld;
    if (w) return w.name;
    return this.flags.seed !== null ? `BONUS TRACK #${this.flags.seed}` : 'NEON BAY · CLASSIC';
  }

  /** Blender ships (M2). On failure the procedural v1 ships stay in use. */
  private async loadShipAssets(): Promise<void> {
    try {
      this.graphics.setShipAssets(await this.assets.loadShips());
    } catch (e) {
      console.warn('MachZero: ship models failed to load; using the built-in ships.', e);
    }
  }

  /** Scenery props of the next race's world (cached; on failure the theme's procedural scenery remains). */
  private async loadWorldAssets(): Promise<void> {
    const w = this.currentWorld;
    if (!w) return;
    try {
      this.graphics.setWorldProps(w.id, await this.assets.load(`worlds/${w.id}/props.glb`));
    } catch (e) {
      console.warn(`MachZero: ${w.name} scenery failed to load; using the procedural scenery.`, e);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private fixed(dt: number): void {
    const input = this.input;
    input.update();
    if (input.consume('mute')) this.toggleMute();
    const s = this.session;
    const r = this.route.value;
    if (r.name === 'race' && s) {
      if (input.consume('pause')) s.togglePause();
      if (input.consume('restart') && s.state !== 'title') s.restart();
      if (this.menus && input.consume('back') && (s.state === 'paused' || s.state === 'results')) {
        this.quitToMenu();
        return;
      }
      // Pause and results panels: the d-pad / stick moves focus between their buttons and Ⓐ presses the
      // focused one; with nothing focused, Ⓐ keeps its default (resume, race again).
      const overlay = s.hudOverlay;
      if (overlay) for (const dir of DIRECTIONS) if (input.consume(dir)) navigate(overlay, dir);
      const focused = overlay !== null && document.activeElement instanceof HTMLElement && overlay.contains(document.activeElement) ? document.activeElement : null;
      if (input.consume('confirm')) {
        if (focused) focused.click();
        else if (s.state === 'title' || s.state === 'results') s.start();
        else if (s.state === 'paused') s.pause(false);
      }
      s.fixed(dt, input.sample());
      return;
    }
    // Menu screens: route gamepad / unfocused-keyboard actions to the UI; Escape acts as back.
    for (const a of NAV_ACTIONS) if (input.consume(a)) this.navHandler?.(a);
    if (input.consume('pause')) this.navHandler?.('back');
    input.consume('restart');
    input.sample(); // drop any boost latch
    s?.fixed(dt, null);
  }

  private setInputDevice(d: InputDevice): void {
    this.inputDevice.value = d;
    document.documentElement.classList.toggle('mz-pad', d === 'pad');
  }

  /** A controller dropping mid-race pauses it (never resumes by itself); connecting one switches the prompts. */
  private padChanged(connected: boolean): void {
    if (connected) {
      this.setInputDevice('pad');
      this.toast('Controller connected.', 'good');
      return;
    }
    const s = this.session;
    if (this.route.value.name === 'race' && s && (s.state === 'racing' || s.state === 'countdown')) {
      s.pause(true);
      this.toast('Controller disconnected — race paused. Reconnect it to carry on.', 'warn', 6);
    } else {
      this.toast('Controller disconnected.', 'warn');
    }
  }

  /** Frame stats, the perf panel and dynamic resolution (racing frames only: menus and pauses are not judged). */
  private afterFrame(frameMs: number, updateMs: number, renderMs: number): void {
    const s = this.session;
    const racing = this.route.value.name === 'race' && s !== null && (s.state === 'racing' || s.state === 'countdown');
    if (racing) this.frameStats.push({ frameMs, simMs: this.simMs, updateMs, renderMs });
    this.simMs = 0;
    if (this.dynres) {
      if (racing && !this.bench) {
        if (!this.dynresFeeding) this.dynres.resetWindow();
        if (this.dynres.feed(frameMs)) this.graphics.setDynamicScale(this.dynres.scale);
      }
      this.dynresFeeding = racing;
    }
    if (this.perf) {
      const r = this.graphics.renderStats;
      this.perf.update(frameMs / 1000, {
        preset: this.qualityLevel.value,
        pixelRatio: this.graphics.renderPixelRatio,
        dynScale: this.dynres?.scale ?? 1,
        calls: r.calls,
        triangles: r.triangles,
      });
    }
  }

  /** Per race: restart the run stats at GO; at the results, log the race's frame summary. */
  private bindPerf(s: RaceSession): void {
    s.bus.on('race:countdown', ({ value }) => {
      if (value === 3) this.frameStats.resetRun();
    });
    s.bus.on('race:results', () => {
      const sum = this.frameStats.summary();
      this.perf?.setRaceSummary(s.setup.worldId, sum);
      if (this.perf) console.info(`[perf] ${s.setup.worldId} ${this.qualityLevel.value}: ${formatSummary(sum)}; p95 ${sum.p95.toFixed(1)} ms (missed = over ${MISSED_FRAME_MS} ms)`);
    });
  }

  private raceTier(p: Profile | null): AITier {
    return p?.aiTier ?? 'rookie';
  }

  private raceSetup(): RaceSetup {
    const p = this.menus ? this.activeProfile.value : null;
    const field = buildRaceField({
      playerName: p?.name ?? 'YOU',
      playerLoadout: p?.loadout ?? defaultLoadout(),
      tier: this.raceTier(p),
    });
    // Hazards: ?hazards=rookie for QA; M5 sets the Rookie policy from the tier.
    const hazards = hazardPolicy(this.flags.hazards ?? 'normal');
    // EMPs come from the live profile; one fired is spent from the save at once (a restart does not refill it).
    const items = p
      ? { count: () => this.activeProfile.value?.items.emp ?? 0, use: () => this.updateProfile((q) => (q.items.emp = Math.max(0, q.items.emp - 1))) }
      : undefined;
    const base = { field, autopilot: this.flags.autopilot, hazards, items };
    const world = this.currentWorld;
    const def = world ? TRACK_DEFS[world.trackId] : undefined;
    if (world && def) {
      return { ...base, source: { kind: 'authored', def }, palette: world.palette, worldId: world.id, trackKey: def.id, records: p ? this.profileRecords(p.id, def.id) : localRecordStore };
    }
    const seed = this.flags.seed ?? CONFIG.TRACK_SEED;
    const trackKey = this.flags.seed !== null ? `bonus-${seed}` : 'classic';
    return { ...base, source: { kind: 'seeded', seed }, worldId: 'neon-bay', trackKey, records: p ? this.profileRecords(p.id, trackKey) : localRecordStore };
  }

  private profileRecords(profileId: string, trackKey: string): RecordStore {
    return {
      load: () => this.save.value.profiles.find((p) => p.id === profileId)?.records[trackKey]?.bestLap ?? null,
      save: (lap) =>
        this.updateSave((d) => {
          const p = d.profiles.find((x) => x.id === profileId);
          if (p) p.records[trackKey] = { ...p.records[trackKey], bestLap: lap };
        }),
    };
  }

  /** The race the menu would start now; reuses the current session when nothing relevant changed. */
  private ensureSession(): Promise<RaceSession> {
    const setup = this.raceSetup();
    const key = JSON.stringify([setup.trackKey, this.activeProfile.value?.id ?? null, setup.hazards?.mode, setup.field.map((d) => [d.name, d.loadout, d.gridIndex])]);
    if (this.session && this.sessionKey === key) return Promise.resolve(this.session);
    if (this.building && this.buildingKey === key) return this.building;
    this.buildingKey = key;
    const build = (async () => {
      const next = await RaceSession.create(setup);
      if (this.buildingKey !== key) {
        // A newer request superseded this one while it was building.
        next.dispose();
        return this.building!;
      }
      this.session?.dispose();
      this.session = null;
      next.attachView({ graphics: this.graphics, audio: this.audio, hudRoot: this.els.hud, actions: this.hudActions(), showTitle: !this.menus });
      this.bindStats(next);
      this.bindPerf(next);
      if (isNativeApp()) bindHaptics(next.bus, next.player.def.id); // the race's bus is cleared on dispose
      this.session = next;
      this.sessionKey = key;
      // Pose the camera on the grid, then compile every shader behind the loading screen (no mid-race stalls).
      next.frame(1 / 60, 1, 0);
      await this.graphics.warmUp();
      if (this.buildingKey === key) this.building = null;
      return next;
    })();
    this.building = build;
    return build;
  }

  private hudActions(): HudActions {
    const actions: HudActions = {
      onStart: () => this.session?.start(),
      onRestart: () => this.session?.restart(),
      onResume: () => this.session?.pause(false),
      onToggleMute: () => this.toggleMute(),
    };
    if (this.menus) {
      actions.onMenu = () => this.quitToMenu();
      actions.onSettings = () => this.openSettings('pause');
    }
    return actions;
  }

  private bindStats(s: RaceSession): void {
    const profileId = this.menus ? this.activeProfile.value?.id : undefined;
    if (!profileId) return;
    s.bus.on('race:results', ({ standings }) => {
      const me = standings.find((r) => r.id === s.player.def.id);
      let pay = 0;
      let total = 0;
      this.updateSave((d) => {
        const p = d.profiles.find((x) => x.id === profileId);
        if (!p) return;
        pay = settleRace(p, me, s.player.def.tier ?? 'rookie');
        total = p.credits;
      });
      if (pay > 0) s.bus.emit('economy:credits', { delta: pay, total });
    });
  }

  /** Change the active profile; `changed` false skips the write (nothing happened). */
  private updateProfile(fn: (p: Profile) => void, changed: () => boolean = () => true): void {
    const id = this.activeProfile.value?.id;
    if (!id) return;
    const draft = structuredClone(this.save.value);
    const p = draft.profiles.find((x) => x.id === id);
    if (!p) return;
    fn(p);
    if (!changed()) return;
    this.save.value = draft;
    if (this.menus) this.store.save(draft);
  }

  private updateSave(fn: (draft: SaveData) => void): void {
    const draft = structuredClone(this.save.value);
    fn(draft);
    this.save.value = draft;
    // Without the menus (v1 flow) nothing is written: an early v2 save would stop the v1 → 2 migration
    // from importing the player's v1 lap record once profiles ship.
    if (this.menus) this.store.save(draft);
  }

  /**
   * Quality in force: ?quality= override, then the explicit setting, then what Auto detected earlier, then
   * the device hint. Otherwise (first launch on a capable desktop) run the benchmark; autopilot uses High.
   */
  private applyQuality(s: SettingsData): void {
    let level: QualityLevel | null = this.flags.quality ?? (s.quality !== 'auto' ? s.quality : s.detectedQuality);
    // The device hint is recomputed each launch (cheap); only a benchmark result is stored.
    // The iOS app starts at Medium: its target devices are recent iPhones and iPads, and dynamic resolution
    // backs off if frames drop (Low's 0.75× resolution looks blocky on a 3× Retina screen).
    if (level === null) level = (isNativeApp() ? 'med' : deviceHint(navigator)) ?? (this.flags.autopilot ? 'high' : null);
    if (level === null) {
      if (!this.bench) {
        this.bench = new QualityBenchmark();
        this.benchmarking.value = true;
        this.setQualityLevel(this.bench.testing);
      }
      return;
    }
    this.bench = null;
    this.benchmarking.value = false;
    this.setQualityLevel(level);
  }

  private setQualityLevel(level: QualityLevel): void {
    if (this.qualityLevel.value === level && this.graphics.qualityLevel === level) return;
    this.qualityLevel.value = level;
    this.graphics.setQuality(QUALITY_PROFILES[level]);
  }

  private benchFrame(dt: number): void {
    const step = this.bench!.feed(dt);
    if (!step.done) {
      this.setQualityLevel(step.test);
      return;
    }
    this.bench = null;
    this.benchmarking.value = false;
    this.settings.detectedQuality.value = step.level; // persists and re-applies via onChange
  }

  /** Forget the detected preset and measure again (Settings → Graphics). */
  redetectQuality(): void {
    this.bench = null;
    this.settings.detectedQuality.value = null;
  }

  private applySettings(s: SettingsData): void {
    this.applyQuality(s);
    const perf = this.flags.perf || s.perfPanel;
    if (perf && !this.perf) this.perf = new PerfOverlay(document.body, this.frameStats);
    else if (!perf && this.perf) {
      this.perf.dispose();
      this.perf = null;
    }
    this.audio.setVolumes(s.masterVolume, s.sfxVolume);
    if (this.audio.muted !== s.muted) this.audio.setMuted(s.muted);
    this.graphics.setComfort({ reducedMotion: s.reducedMotion });
    this.input.setBindings(s.keyBindings);
    const root = document.documentElement.classList;
    root.toggle('mz-large-text', s.largeText);
    root.toggle('mz-cb', s.colorBlind);
    root.toggle('mz-reduced-motion', s.reducedMotion);
  }
}
