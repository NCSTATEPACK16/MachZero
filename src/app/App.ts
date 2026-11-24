/**
 * The application: one renderer, audio context, input manager, save and settings for the page's lifetime,
 * a route state machine for the menus, and a disposable RaceSession per race. The next race always waits in
 * 'title' state behind the menus, so the backdrop is the real track and field.
 */
import { batch, computed, effect, signal, untracked } from '@preact/signals';
import { CONFIG, readUrlFlags, type UrlFlags } from '../core/config';
import { hazardPolicy } from '../core/hazards';
import type { AITier, Assists, HudActions, Loadout, MenuAction, PartSlot, PartTier, PartVariant, RacerStanding, ShipId } from '../core/contracts';
import { FEATURES, type FeatureSet } from '../core/features';
import { FrameStats, MISSED_FRAME_MS } from '../core/FrameStats';
import { GameLoop } from '../core/loop';
import { DEFAULT_CUP_ID, availableCups, cupAvailable, cupById, cupUnlocked, type CupDef } from '../content/cups';
import { newSeason, seasonCup, seasonUnlocked } from '../game/modes/Championship';
import { bookCupRaceOn, type CupBooking, type SeasonEnd } from '../game/modes/cupBooking';
import { EventBus, type MenuEvents } from '../core/events';
import { buildRaceField, defaultLoadout } from '../content/pilots';
import { buyPart, equipPart, selectChassis, settleRace, type PurchaseResult } from '../content/economy';
import { buyItem, emptyBag, type ItemKind, type ItemPurchase } from '../content/items';
import { AudioSystem } from '../audio/AudioSystem';
import { bindUiSounds } from '../ui/uiSounds';
import { localRecordStore, type RecordStore } from '../game';
import { cupGridOrder, cupWorld, newCup, type CupAward, type CupState } from '../game/modes/GrandPrix';
import { Rumble } from '../game/Rumble';
import { GraphicsSystem } from '../graphics';
import { PerfOverlay, formatSummary } from '../graphics/PerfOverlay';
import { AssetLoader } from '../assets/AssetLoader';
import { TRACK_DEFS } from '../content/tracks';
import { WORLDS, worldById, worldsFor, type WorldDef, type WorldId } from '../content/worlds';
import { bookTourRace, tourWorlds, worldUnlocked, type TourResult } from '../game/modes/WorldTour';
import { raceTally, resultsOpenOf, winnerQuote, type RaceResult } from '../game/modes/raceResult';
import { bookTrial, medalTally, medalTimes } from '../game/modes/TimeTrial';
import type { GhostData } from '../game/ghost/ghostCodec';
import { loadDevGhost } from '../game/ghost/devGhosts';
import type { TrialHud, TutorialHud } from '../game/HUD';
import { PAD_BUTTON_NAMES, keyName } from '../core/controlNames';
import { DEV_TIMES } from '../content/devTimes';
import { GhostStore } from '../save/GhostStore';
import { rosterOf } from '../game/pilotPortrait';
import { InputManager } from '../physics';
import type { InputDevice } from '../physics/InputManager';
import { SaveStore, type FallbackReason } from '../save/SaveStore';
import { MAX_PROFILES, NO_ASSISTS, createProfile, type Medal, type Profile, type ProfilePreset, type SaveData, type SettingsData } from '../save/schema';
import { Settings } from '../settings/Settings';
import { DynamicResolution } from '../settings/DynamicResolution';
import { QUALITY_PROFILES, QualityBenchmark, deviceHint, type QualityLevel } from '../settings/QualityManager';
import { bindHaptics, isNativeApp, setHapticsEnabled, tapUi } from '../native/haptics';
import { TouchRig } from '../game/TouchControls';
import { TouchInput } from '../physics/TouchInput';
import { TiltInput, requestTiltPermission, type TiltPermission } from '../physics/TiltInput';
import { calibratedNeutral } from '../physics/tilt';
import { navigate } from '../ui/nav';
import { RaceSession, type RaceSetup } from './RaceSession';
import { effectiveAssists } from '../physics/Assists';
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
/** Seconds the grid intro card stays up before the countdown (any input skips it). */
const INTRO_SECONDS = 3;
const INTRO_SKIP: readonly MenuAction[] = ['confirm', 'back', 'pause', 'restart', 'up', 'down', 'left', 'right'];

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

const NO_ITEMS = Object.freeze(emptyBag());

export class App {
  readonly flags: UrlFlags = readUrlFlags();
  readonly features: FeatureSet = FEATURES;
  /** The Preact menus run the app; `?autopilot=1` skips them and races straight away (the smoke test). */
  readonly menus: boolean = !this.flags.autopilot;

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
  /** A gamepad is connected (Settings → Controls shows the pad section). */
  readonly padConnected = signal(false);
  /** A key has been pressed this session (Settings → Controls shows the keyboard section). */
  readonly keyboardSeen = signal(false);
  /** Settings → Controls is waiting for a pad button (menu navigation is paused meanwhile). */
  private padCapture: { resolve: (i: number | null) => void; held: Set<number>; until: number } | null = null;

  /** True while the race session is a Grand Prix cup race (built from the profile's cup). */
  readonly cupRace = signal(false);
  /** The cup just finished (for the final standings screen), with what it earned. */
  readonly lastCup = signal<{ cup: CupState; award: CupAward } | null>(null);
  /**
   * A season cup has just finished (IMPLEMENTATION §M8c): the standings screen shows its final standings and the
   * season table before the next cup (whose race 1 is already queued in `profile.cup`). Cleared by NEXT CUP.
   */
  readonly seasonBreak = signal(false);
  /** The season just finished: its cups, the champion, and what the player was paid (the champion card). */
  readonly lastSeason = signal<SeasonEnd | null>(null);
  /** The last race's outcome, for the results screen (IMPLEMENTATION §M8a). */
  readonly lastResult = signal<RaceResult | null>(null);
  /** The menus' sound hooks (IMPLEMENTATION §M8a step 8): results, locked worlds and cups. The race has its own bus. */
  readonly events = new EventBus<MenuEvents>();
  /** Best ghosts, one per track per profile (IMPLEMENTATION §M8b; IndexedDB, never in the save file). */
  private readonly ghostStore = new GhostStore();
  /** The last best-ghost write; the next trial waits for it, so RACE AGAIN races the ghost just set. */
  private ghostSaving: Promise<unknown> = Promise.resolve();
  /** The Time Trial being raced, or null (set by `startTrial`, cleared when it is left for a menu). */
  private trial: { worldId: WorldId; trackId: string; ghosts: { kind: 'best' | 'dev'; data: GhostData }[]; hud: TrialHud } | null = null;
  /** REPLAY TUTORIAL was pressed (Settings → Race): the next World Tour race runs it whatever the profile's preset. */
  private tutorialReplay = false;

  /** Set by the UI: receives gamepad / body-focused keyboard menu actions while a menu route is shown. */
  navHandler: ((action: MenuAction) => void) | null = null;

  private readonly store: SaveStore;
  private readonly graphics: GraphicsSystem;
  private readonly audio = new AudioSystem();
  private audioRendering = false;
  /** Touch controls (IMPLEMENTATION §M7b). */
  private readonly touchRig = new TouchRig(new TouchInput());
  private readonly input = new InputManager(window, this.touchRig.input);
  /** Tilt steering (M7c). */
  private readonly tilt = new TiltInput(window);
  /** The steer of the last driving sample (debug hook for the touch e2e). */
  private lastSteer = 0;
  /** Pad rumble on the player's hits, boosts and landings, where the browser supports it (§V.3). */
  private readonly rumble = new Rumble((strong, weak, ms) => this.input.rumble(strong, weak, ms));
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
  /** performance.now() at which the grid intro card ends (0 = not showing). Wall clock, not sim time: on a slow
   *  renderer the fixed loop runs behind real time and the card would otherwise stay up for many seconds. */
  private introUntil = 0;

  constructor(private readonly els: AppElements) {
    let pendingFallback: FallbackReason | null = null;
    this.store = new SaveStore(undefined, { onFallback: (r) => (pendingFallback = r) });
    this.save.value = this.store.load();
    // A new save starts with reduced motion on when the device asks for it (IMPLEMENTATION §M7c); never later.
    if (this.store.firstLaunch && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.save.value = { ...this.save.value, settings: { ...this.save.value.settings, reducedMotion: true } };
    }
    this.settings = new Settings(this.save.value.settings);
    if (pendingFallback) this.toast(FALLBACK_TEXT[pendingFallback], 'warn', 9);

    this.graphics = new GraphicsSystem(els.app);
    // Audio (IMPLEMENTATION §M6a): the menu bus's sounds, and a hidden page pauses a running race (both with `music`).
    this.audio.bindMenus(this.events);
    if (this.audio.modern) for (const root of [els.ui, els.hud]) bindUiSounds(root, (kind, value) => this.audio.uiSound(kind, value));
    this.audio.onHidden(() => {
      const r = this.session;
      if (r && (r.state === 'racing' || r.state === 'countdown')) r.pause(true);
    });
    this.input.onDeviceChange = (d) => this.setInputDevice(d);
    this.input.onPadChange = (connected) => this.padChanged(connected);
    this.applySettings(this.settings.snapshot());
    this.settings.onChange((s) => {
      this.applySettings(s);
      this.updateSave((d) => (d.settings = s));
    });

    // The player's assists follow the profile, the input device and the touch settings, mid-race too.
    effect(() => {
      const a = this.playerAssists();
      untracked(() => this.session?.setAssists(a));
    });

    // Touch controls follow the touch settings and the effective auto-accelerate, mid-race too.
    const rig = this.touchRig;
    rig.haptic = () => tapUi();
    rig.onHintSeen = () => this.settings.setTouch({ hintSeen: true });
    effect(() => {
      const t = this.settings.touch.value;
      const p = this.menus ? this.activeProfile.value : null;
      const airbrake = t.airbrake;
      rig.input.setConfig({ sensitivity: t.sensitivity, airbrake });
      rig.setConfig({ buttonSize: t.buttonSize, leftHanded: t.leftHanded, airbrake, autoAccelerate: effectiveAssists(p?.assists ?? NO_ASSISTS, 'touch', t).autoAccelerate, hint: !t.hintSeen });
    });
    // A touch-first screen gets 44-point menu targets before its first tap (ui.css, M7c).
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('mz-coarse');
    // The web shows a rotate overlay in portrait on a touch screen (the app is locked to landscape) and pauses.
    if (!isNativeApp()) {
      document.documentElement.classList.add('mz-rotate-ok');
      const portrait = window.matchMedia?.('(orientation: portrait) and (pointer: coarse)');
      portrait?.addEventListener?.('change', (e) => {
        const s = this.session;
        if (e.matches && this.route.value.name === 'race' && s && (s.state === 'racing' || s.state === 'countdown')) s.pause(true);
      });
    }

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
        // The render Worker starts after the first rendered frame, so nothing new runs before it (§M6.5 boot).
        if (!this.audioRendering) {
          this.audioRendering = true;
          this.audio.startRendering();
        }
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
        /** The last-used device and the player's last driving steer (touch e2e). */
        input: {
          get device() {
            return app.inputDevice.value;
          },
          get steer() {
            return app.lastSteer;
          },
        },
        startRace: () => app.startRace(),
        restartRace: () => app.session?.restart(),
        memory: () => app.graphics.memoryInfo,
        /** Shader programs compiled so far (warm-up check). */
        programs: () => app.graphics.programCount,
        /** Frame stats of the current race (perf checks). */
        perf: () => app.frameStats.summary(),
        /** Step the race `seconds` with nobody driving: the player's AI drives (cup e2e). */
        simulate: async (seconds: number) => {
          app.endIntro();
          for (let t = 0; t < seconds; t += 5) {
            for (let i = 0; i < 5 / CONFIG.FIXED_DT; i++) app.session?.fixed(CONFIG.FIXED_DT, null);
            await new Promise((r) => setTimeout(r, 0));
            if (app.session?.state === 'results') return;
          }
        },
        /** The ghosts the current Time Trial shows (e2e). */
        ghosts: () => app.session?.shownGhosts.map((g) => ({ ...g })) ?? [],
        /** The tutorial prompt showing now, and whether the race runs the tutorial (e2e). */
        tutorial: () => ({ prompt: app.session?.tutorialPrompt ?? null, active: app.session?.tutorialActive ?? false }),
        /** The audio's state, node count, voices, buffers and the last sounds played (audio e2e, §M6a step 11). */
        audio: () => app.audio.debug(),
        /** Ghost meshes drawn in the last frame (one draw call each). */
        ghostsDrawn: () => app.graphics.ghostsDrawn,
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
    await this.loadShipAssets();
    await this.loadWorldAssets();
    await this.ensureSession();
    this.loop.start();
    const first = initialRoute(this.flags, this.save.value);
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
    if (this.menus && !this.trial) {
      // The grid intro card first; the countdown starts when it ends (App.fixed). A Time Trial skips it.
      s.setIntro(true);
      this.introUntil = performance.now() + INTRO_SECONDS * 1000;
    } else s.start();
    this.route.value = { name: 'race' };
    if (this.raceNote) {
      this.toast(this.raceNote, 'info', 5);
      this.raceNote = null;
    }
  }

  /** End the grid intro card and start the countdown. */
  private endIntro(): void {
    if (this.introUntil <= 0) return;
    this.introUntil = 0;
    this.session?.setIntro(false);
    this.session?.start();
  }

  quitToMenu(): void {
    this.introUntil = 0;
    this.session?.setIntro(false);
    if (this.cupRace.value) {
      this.leaveCupRace();
      return;
    }
    this.session?.toTitle();
    const trial = this.trial !== null;
    this.trial = null;
    this.route.value = trial ? { name: 'trial' } : { name: 'menu' };
  }

  // ------------------------------------------------------------ Time Trial (IMPLEMENTATION §M8b)

  openTimeTrial(): void {
    this.route.value = { name: 'trial' };
  }

  /** Solo against the clock and the ghosts on `worldId`'s track (an unlocked world). */
  async startTrial(worldId: string): Promise<void> {
    const w = worldById(worldId);
    const p = this.activeProfile.value;
    if (!w?.built || !p) return;
    if (!worldUnlocked(p.tour, w.id, tourWorlds(this.features))) {
      this.events.emit('ui:locked', {});
      return;
    }
    const devTime = DEV_TIMES[w.trackId];
    if (!devTime) return;
    this.route.value = { name: 'loading' };
    const want = this.settings.ghosts.value;
    await this.ghostSaving;
    // The best ghost is read even when it is hidden: the splits are measured against it.
    const [best, dev] = await Promise.all([this.ghostStore.get(p.id, w.trackId), want.dev ? loadDevGhost(w.trackId) : Promise.resolve(null)]);
    const ghosts: { kind: 'best' | 'dev'; data: GhostData }[] = [];
    if (best && want.best) ghosts.push({ kind: 'best', data: best });
    if (dev) ghosts.push({ kind: 'dev', data: dev });
    const held = p.records[w.trackId]?.medal ?? null;
    this.trial = { worldId: w.id, trackId: w.trackId, ghosts, hud: { medalTimes: medalTimes(devTime), held, bestLaps: best?.lapTimes ?? null } };
    await this.startRace();
  }

  // ------------------------------------------------------------ Grand Prix

  /** The active profile's cup in progress, or null. */
  get cup(): CupState | null {
    return this.activeProfile.value?.cup ?? null;
  }

  openGrandPrix(): void {
    this.route.value = { name: 'gp' };
  }

  /** A new cup at the profile's CPU difficulty, straight into race 1. */
  startCup(cupId: string = DEFAULT_CUP_ID): void {
    const p = this.activeProfile.value;
    const def = cupById(cupId);
    if (!p || p.cup || !def || !cupAvailable(def)) return;
    if (!cupUnlocked(def, p)) {
      this.events.emit('ui:locked', {});
      return;
    }
    this.lastCup.value = null;
    this.seasonBreak.value = false;
    this.updateProfile((q) => (q.cup = newCup(def.id, q.aiTier)));
    void this.startCupRace();
  }

  // ------------------------------------------------------------ Championship (IMPLEMENTATION §M8c)

  /** The cups of a season: the cups the player can see, in `CUPS` order. */
  seasonCups(): readonly CupDef[] {
    return availableCups(worldsFor(this.features));
  }

  /** The championship is offered (two or more cups visible) and open to this profile. */
  get seasonOpen(): boolean {
    const p = this.activeProfile.value;
    return !!p && seasonUnlocked(p.trophies, this.seasonCups());
  }

  /** A season at `tier` (the profile's CPU difficulty by default), straight into the first cup's race 1. */
  startSeason(tier?: AITier): void {
    const p = this.activeProfile.value;
    if (!p || p.cup || p.season) return;
    if (!this.seasonOpen) {
      this.events.emit('ui:locked', {});
      return;
    }
    const t = tier ?? p.aiTier;
    const season = newSeason(t);
    const first = seasonCup(season, this.seasonCups());
    if (!first) return;
    this.lastCup.value = null;
    this.lastSeason.value = null;
    this.seasonBreak.value = false;
    this.updateProfile((q) => {
      q.season = season;
      q.cup = newCup(first.id, t);
    });
    void this.startCupRace();
  }

  /** NEXT CUP: leave the season break for the next cup's standings (its race 1). */
  nextSeasonCup(): void {
    this.seasonBreak.value = false;
    this.lastCup.value = null;
    this.route.value = { name: 'cup' };
  }

  /** Abandon the season (confirmed in the UI): the cup in progress goes too; nothing paid is taken back. */
  quitSeason(): void {
    this.updateProfile((p) => {
      p.season = null;
      p.cup = null;
    });
    this.seasonBreak.value = false;
    this.cupRace.value = false;
    this.route.value = { name: 'menu' };
  }

  /** The standings between races (CONTINUE CUP lands here). */
  openCupStandings(): void {
    this.route.value = { name: 'cup' };
  }

  async startCupRace(): Promise<void> {
    if (!this.cup) return;
    this.cupRace.value = true;
    await this.startRace();
  }

  /** End the cup in progress (confirmed in the UI). */
  quitCup(): void {
    this.updateProfile((p) => (p.cup = null));
    this.cupRace.value = false;
    this.route.value = { name: 'menu' };
  }

  /**
   * Leave a cup race: after the results, to the standings; mid-race, as a retire (0 points for this race, the
   * rivals scored where they run), since a cup can't be restarted.
   */
  private leaveCupRace(): void {
    const s = this.session;
    if (s && this.cup && s.state !== 'results' && s.state !== 'title') {
      this.bookCupRace(s.race.snapshot().standings, s.player.def.id);
      this.toast('Retired: no points from this race.', 'warn');
    }
    this.cupRace.value = false;
    s?.toTitle();
    this.route.value = { name: 'cup' };
  }

  /**
   * Book a cup race in the profile; at the end of the cup, pay the bonus and award the trophy. In a season the
   * finished cup is booked on the season too: the next cup is queued, or at the end the champion is paid.
   * Returns the cup bonus and the champion bonus paid.
   */
  private bookCupRace(standings: readonly RacerStanding[], retire?: ShipId): { cup: number; champion: number } {
    let b: CupBooking | null = null;
    const cups = this.seasonCups();
    this.updateProfile((p) => (b = bookCupRaceOn(p, standings, cups, retire)));
    const booked = b as CupBooking | null;
    if (!booked?.done || !booked.award) return { cup: 0, champion: 0 };
    const a = booked.award;
    const e = booked.ended;
    this.lastCup.value = { cup: booked.done, award: a };
    this.seasonBreak.value = booked.inSeason;
    if (e) this.lastSeason.value = e;
    if (a.bonus > 0) this.toast(`Cup won! +${a.bonus.toLocaleString('en-US')} credits.`, 'good', 6);
    if (e?.bonus) this.toast(`Champion! +${e.bonus.toLocaleString('en-US')} credits.`, 'good', 6);
    return { cup: a.bonus, champion: e?.bonus ?? 0 };
  }

  openSettings(back: 'menu' | 'pause'): void {
    if (back === 'pause' && this.session?.state !== 'paused') this.session?.pause(true);
    this.route.value = { name: 'settings', back };
  }

  closeSettings(): void {
    const r = this.route.value;
    this.route.value = r.name === 'settings' && r.back === 'pause' ? { name: 'race' } : { name: 'menu' };
  }

  /** The World Tour map (IMPLEMENTATION §M8a). */
  openWorlds(): void {
    this.route.value = { name: 'tour' };
  }

  /** The world map opens with this world's card (the results screen's NEXT WORLD). */
  private tourCard: WorldId | null = null;

  /** Open the map with `worldId`'s card showing, and make it the profile's world. */
  openTourCard(worldId: WorldId): void {
    this.tourCard = worldId;
    this.updateProfile((p) => (p.world = worldId));
    this.route.value = { name: 'tour' };
  }

  /** The card the map should open with (read once). */
  takeTourCard(): WorldId | null {
    const id = this.tourCard;
    this.tourCard = null;
    return id;
  }

  /** A World Tour card: remember the world and race it. A locked world is refused. */
  selectWorld(worldId: string): void {
    const w = worldById(worldId);
    if (!w?.built) return;
    const p = this.activeProfile.value;
    if (p && !worldUnlocked(p.tour, w.id, tourWorlds(this.features))) {
      this.events.emit('ui:locked', {});
      return;
    }
    this.updateProfile((q) => (q.world = w.id), () => true);
    if (p && !p.tutorialDone) this.prepareTutorial(p);
    void this.startRace();
  }

  // ------------------------------------------------------------ The first-race tutorial (IMPLEMENTATION §M8c)

  /** The next World Tour race runs the tutorial: a Rookie-preset profile's first, or after REPLAY TUTORIAL. */
  private wantsTutorial(p: Profile | null): boolean {
    if (!p || p.tutorialDone) return false;
    // No new field: a profile with all four assists on was made with the Rookie preset (or is played like one).
    const a = p.assists;
    return this.tutorialReplay || (a.autoAccelerate && a.steering > 0 && a.noKO && a.earlyBoost);
  }

  /** Before a World Tour race: the tutorial's free Shield (if the bag is empty), or a Classic profile's one-line note. */
  private prepareTutorial(p: Profile): void {
    if (this.wantsTutorial(p)) {
      const empty = Object.values(p.items).every((n) => n <= 0);
      if (empty) this.updateProfile((q) => (q.items.shield = 1));
      return;
    }
    this.updateProfile((q) => (q.tutorialDone = true));
    this.raceNote = 'Tutorial: Settings → Race';
  }

  /** A note to show once the next race is on screen (not over the loading screen, where it could run out). */
  private raceNote: string | null = null;

  /** Settings → Race → REPLAY TUTORIAL: it runs on the next World Tour race. */
  replayTutorial(): void {
    this.tutorialReplay = true;
    this.updateProfile((q) => (q.tutorialDone = false));
    this.toast('The tutorial runs on your next World Tour race.', 'good');
  }

  /** Each step's control as the player has it bound, for keyboard, pad and touch. */
  private tutorialLabels(): TutorialHud['labels'] {
    const k = this.settings.keyBindings.value;
    const pad = this.settings.padBindings.value;
    const t = this.settings.touch.value;
    const key = (codes: readonly string[]) => (codes[0] ? keyName(codes[0]) : '?');
    const btn = (b: readonly number[]) => (b[0] !== undefined ? (PAD_BUTTON_NAMES[b[0]] ?? `BUTTON ${b[0]}`) : '?');
    return {
      steer: { kb: `${key(k.left)} ${key(k.right)}`, pad: 'LEFT STICK', touch: t.steer === 'tilt' ? 'TILT' : 'SLIDE LEFT THUMB' },
      boost: { kb: key(k.boost), pad: btn(pad.boost), touch: 'BOOST' },
      airbrake: { kb: `${key(k.airLeft)} / ${key(k.airRight)}`, pad: `${btn(pad.airLeft)} / ${btn(pad.airRight)}`, touch: t.airbrake === 'slider' ? 'SLIDER TO THE EDGE' : '◂AIR / AIR▸' },
      pit: { kb: 'STEER IN', pad: 'STEER IN', touch: 'STEER IN' },
      item: { kb: key(k.item), pad: btn(pad.item), touch: 'ITEM' },
    };
  }

  /** The world the next race is in, or null for the v1 classic / Bonus Track. */
  get currentWorld(): WorldDef | null {
    if (this.trial) return worldById(this.trial.worldId) ?? null;
    const cup = this.cupRace.value ? this.cup : null;
    const cupWorldId = cup ? cupWorld(cup) : null;
    if (cupWorldId) return worldById(cupWorldId) ?? WORLDS[0];
    if (this.flags.seed !== null) return null;
    const w = worldById(this.flags.world ?? this.activeProfile.value?.world ?? WORLDS[0].id);
    return w?.built ? w : WORLDS[0];
  }

  openGarage(back: 'menu' | 'cup' = 'menu'): void {
    this.route.value = { name: 'garage', back };
  }

  closeGarage(): void {
    const r = this.route.value;
    this.route.value = r.name === 'garage' && r.back === 'cup' ? { name: 'cup' } : { name: 'menu' };
  }

  /** Buy (pay, own and fit) a part for the active profile. */
  buyPart(slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): PurchaseResult {
    let result: PurchaseResult = 'invalid';
    this.updateProfile((p) => (result = buyPart(p, slot, tier, variant)), () => result === 'bought');
    this.shopSound(result, slot);
    return result;
  }

  equipPart(slot: PartSlot, tier: PartTier, variant: PartVariant = 'a'): boolean {
    let ok = false;
    this.updateProfile((p) => (ok = equipPart(p, slot, tier, variant)), () => ok);
    if (ok) this.events.emit('shop:equip', { slot });
    return ok;
  }

  selectChassis(chassisId: string): void {
    this.updateProfile((p) => selectChassis(p, chassisId));
  }

  setLivery(livery: Loadout['livery']): void {
    this.updateProfile((p) => (p.loadout.livery = { ...livery }));
  }

  /** Buy one item of `kind` for the active profile. */
  buyItem(kind: ItemKind): ItemPurchase {
    let result: ItemPurchase = 'short';
    this.updateProfile((p) => (result = buyItem(p, kind)), () => result === 'bought');
    this.shopSound(result, 'item');
    return result;
  }

  /** The shop's sound hooks (IMPLEMENTATION §M6a): a purchase, or a refusal for want of credits. */
  private shopSound(result: string, slot: PartSlot | 'item'): void {
    if (result === 'bought') this.events.emit('shop:buy', { slot });
    else if (result === 'short') this.events.emit('shop:deny', {});
  }

  /** CPU difficulty for the active profile's next race. */
  setAiTier(tier: AITier): void {
    this.updateProfile((p) => (p.aiTier = tier));
  }

  /**
   * Change the active profile's assists (Settings → ASSISTS, also from the pause menu). They act in the race at once
   * (the effect in the constructor passes them on); the hazard rules follow No-KO from the next race.
   */
  setAssists(patch: Partial<Assists>): void {
    this.updateProfile((p) => (p.assists = { ...p.assists, ...patch }));
  }

  /** The player's assists in force: the profile's, plus touch's auto-accelerate (IMPLEMENTATION §M7a). */
  private playerAssists(): Assists {
    const p = this.menus ? this.activeProfile.value : null;
    return effectiveAssists(p?.assists ?? NO_ASSISTS, this.inputDevice.value, this.settings.touch.value);
  }

  /** Garage turntable: draw `loadout` into `el`, or stop with null. */
  showShipPreview(el: HTMLElement | null, loadout: Loadout | null): void {
    this.graphics.showPreview(el, loadout);
  }

  nudgeShipPreview(radians: number): void {
    this.graphics.nudgePreview(radians);
  }

  /** Garage orbit from the mouse: turn and tilt (rad), zoom (log steps, + = closer). */
  orbitShipPreview(yaw: number, pitch: number, zoom: number): void {
    this.graphics.orbitPreview(yaw, pitch, zoom);
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
    void this.ghostStore.deleteProfile(id);
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
    // A world on the placeholder theme has no props.glb yet.
    if (!w || w.props === false) return;
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
    if (r.name === 'race' && s && this.introUntil > 0) {
      let skip = false;
      for (const a of INTRO_SKIP) if (input.consume(a)) skip = true;
      const c = input.sample();
      if (c.throttle > 0.5 || c.brake > 0.5 || c.boost || c.fire || Math.abs(c.steer) > 0.5) skip = true;
      if (skip || performance.now() >= this.introUntil) this.endIntro();
      s.fixed(dt, null);
      return;
    }
    if (r.name === 'race' && s) {
      if (input.consume('pause')) s.togglePause();
      const cup = this.cupRace.value;
      // No restarts in a cup; Ⓑ on the results goes to the standings, and on the pause panel does nothing
      // (retiring is the panel's RETIRE button only).
      if (input.consume('restart') && s.state !== 'title' && !cup) s.restart();
      if (this.menus && input.consume('back') && (s.state === 'results' || (s.state === 'paused' && !cup))) {
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
        else if (cup && s.state === 'results') this.quitToMenu();
        else if (s.state === 'title' || s.state === 'results') s.start();
        else if (s.state === 'paused') s.pause(false);
      }
      this.stepTilt(dt);
      const c = input.sample();
      this.lastSteer = c.steer;
      s.fixed(dt, c);
      return;
    }
    // Garage: the right stick orbits the turntable and the shoulders zoom (§V.3).
    if (r.name === 'garage') {
      const o = input.orbitInput();
      if (o.x !== 0 || o.y !== 0 || o.zoom !== 0) this.graphics.orbitPreview(o.x * 2.4 * dt, o.y * 1.2 * dt, o.zoom * 1.5 * dt);
    }
    // Settings → Controls is capturing a pad button: the first new press is the answer; menus wait.
    const cap = this.padCapture;
    if (cap) {
      const down = input.padButtonsDown();
      const fresh = down.find((b) => !cap.held.has(b));
      for (const b of [...cap.held]) if (!down.includes(b)) cap.held.delete(b);
      if (fresh !== undefined || performance.now() > cap.until) {
        this.padCapture = null;
        cap.resolve(fresh ?? null);
      }
      for (const a of NAV_ACTIONS) input.consume(a);
      input.consume('pause');
      input.sample();
      s?.fixed(dt, null);
      return;
    }
    // Menu screens: route gamepad / unfocused-keyboard actions to the UI; Escape acts as back.
    for (const a of NAV_ACTIONS) if (input.consume(a)) this.navHandler?.(a);
    if (input.consume('pause')) this.navHandler?.('back');
    input.consume('restart');
    input.sample(); // drop any boost latch
    s?.fixed(dt, null);
  }

  /** Tilt (IMPLEMENTATION §M7c): while it is chosen and its data is fresh, it replaces the slider's steer. */
  private stepTilt(dt: number): void {
    const rig = this.touchRig;
    const tilt = this.tilt;
    const t = this.settings.touch.value;
    if (t.steer !== 'tilt') {
      tilt.stop();
      rig.input.externalSteer = null;
      rig.tiltActive = rig.tiltFlat = false;
      return;
    }
    tilt.start();
    const live = tilt.fresh;
    rig.input.externalSteer = live ? tilt.update(dt, t.tiltNeutral, t.tiltSensitivity) : null;
    rig.tiltActive = live;
    rig.tiltFlat = live && tilt.flat;
  }

  /** Settings → TILT, or the intro card's ENABLE TILT (inside a tap): ask for motion data; without it, the slider. */
  async enableTilt(): Promise<TiltPermission> {
    const r = await requestTiltPermission();
    if (r === 'granted') {
      this.tilt.start();
      this.settings.setTouch({ steer: 'tilt' });
    } else {
      this.settings.setTouch({ steer: 'slider' });
      this.toast(r === 'denied' ? 'Tilt needs motion access. Using the slider. Allow motion and try again.' : 'This device has no motion sensor. Using the slider.', 'warn', 6);
    }
    return r;
  }

  /** CALIBRATE: the way the device is held now becomes straight ahead. False when no motion data is coming in. */
  calibrateTilt(): boolean {
    const roll = this.tilt.currentRoll;
    if (roll === null) {
      this.toast('No tilt data yet. Hold the device as you play, then press CALIBRATE.', 'warn');
      return false;
    }
    this.settings.setTouch({ tiltNeutral: calibratedNeutral(roll) });
    this.toast('Tilt calibrated: this is straight ahead.', 'good');
    return true;
  }

  /** Wait for the next pad button press (Settings → Controls' capture): its index, or null after 6 s or on cancel. */
  capturePadButton(): Promise<number | null> {
    this.cancelPadCapture();
    return new Promise((resolve) => {
      this.padCapture = { resolve, held: new Set(this.input.padButtonsDown()), until: performance.now() + 6000 };
    });
  }

  cancelPadCapture(): void {
    const c = this.padCapture;
    this.padCapture = null;
    c?.resolve(null);
  }

  private setInputDevice(d: InputDevice): void {
    if (d === 'keyboard') this.keyboardSeen.value = true;
    this.inputDevice.value = d;
    document.documentElement.classList.toggle('mz-pad', d === 'pad');
    document.documentElement.classList.toggle('mz-touch', d === 'touch');
    if (d !== 'touch') this.touchRig.input.releaseAll();
  }

  /** A controller dropping mid-race pauses it (never resumes by itself); connecting one switches the prompts. */
  private padChanged(connected: boolean): void {
    this.padConnected.value = connected;
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

  /** The HUD's results panel (the no-menu flows) has no screen to emit the `results:open` sound hook, so the App does. */
  private bindResultsPanel(s: RaceSession): void {
    if (this.resultsScreen) return;
    s.bus.on('race:results', ({ standings }) => {
      this.events.emit('results:open', resultsOpenOf({ mode: 'tour', standings, playerId: s.player.def.id }));
    });
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
    const trial = this.trial;
    if (trial && p) return this.trialSetup(p, trial);
    const cup = this.cupRace.value ? (p?.cup ?? null) : null;
    const tier = cup ? cup.tier : this.raceTier(p);
    const field = buildRaceField({
      playerName: p?.name ?? 'YOU',
      playerLoadout: p?.loadout ?? defaultLoadout(),
      tier,
      ...(cup ? { gridOrder: cupGridOrder(cup) ?? undefined } : {}),
    });
    // Hazards: Rookie races, and a profile with No-KO, telegraph them harder and they only slow you down (SPEC §6,
    // IMPLEMENTATION §M7a); ?hazards= overrides for QA. Fixed for the race once it is built.
    const hazards = hazardPolicy(this.flags.hazards ?? (tier === 'rookie' || p?.assists.noKO ? 'rookie' : 'normal'));
    // Items come from the live profile; one used is spent from the save at once (a restart does not refill it).
    const items = p
      ? {
          counts: () => this.activeProfile.value?.items ?? NO_ITEMS,
          use: (kind: ItemKind) => this.updateProfile((q) => (q.items[kind] = Math.max(0, q.items[kind] - 1))),
        }
      : undefined;
    const base = { field, autopilot: this.flags.autopilot, hazards, items, assists: this.playerAssists() };
    const world = this.currentWorld;
    const def = world ? TRACK_DEFS[world.trackId] : undefined;
    if (world && def) {
      // The first-race tutorial: a World Tour race (not a cup) of a profile that still wants it.
      const tutorial =
        !cup && this.wantsTutorial(p)
          ? {
              hasItem: Object.values(p!.items).some((n) => n > 0),
              hud: { labels: this.tutorialLabels() },
              onDone: () => {
                this.tutorialReplay = false;
                this.updateProfile((q) => (q.tutorialDone = true));
              },
            }
          : undefined;
      return { ...base, ...(tutorial ? { tutorial } : {}), source: { kind: 'authored', def }, palette: world.palette, worldId: world.id, trackKey: def.id, records: p ? this.profileRecords(p.id, def.id) : localRecordStore };
    }
    const seed = this.flags.seed ?? CONFIG.TRACK_SEED;
    const trackKey = this.flags.seed !== null ? `bonus-${seed}` : 'classic';
    return { ...base, source: { kind: 'seeded', seed }, worldId: 'neon-bay', trackKey, records: p ? this.profileRecords(p.id, trackKey) : localRecordStore };
  }

  /** A Time Trial: the player alone on pole, no items; hazards as in a race (the Rookie rules with No-KO on). */
  private trialSetup(p: Profile, trial: NonNullable<App['trial']>): RaceSetup {
    const world = worldById(trial.worldId)!;
    const def = TRACK_DEFS[trial.trackId];
    const field = buildRaceField({ playerName: p.name, playerLoadout: p.loadout, tier: this.raceTier(p), rivals: 0, playerGridIndex: 0 });
    const hazards = hazardPolicy(this.flags.hazards ?? (p.assists.noKO ? 'rookie' : 'normal'));
    return {
      field,
      autopilot: this.flags.autopilot,
      hazards,
      assists: this.playerAssists(),
      source: { kind: 'authored', def },
      palette: world.palette,
      worldId: world.id,
      trackKey: def.id,
      records: this.profileRecords(p.id, def.id),
      trial: { ghosts: trial.ghosts, hud: trial.hud },
    };
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
    const trial = setup.trial ? [setup.trial.ghosts.map((g) => [g.kind, g.data.totalTime]), setup.trial.hud.held] : null;
    const key = JSON.stringify([setup.trackKey, this.activeProfile.value?.id ?? null, setup.hazards?.mode, this.cupRace.value, trial, setup.tutorial ? [setup.tutorial.hasItem, setup.tutorial.hud.labels] : null, setup.field.map((d) => [d.name, d.tier, d.loadout, d.gridIndex])]);
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
      next.attachView({ graphics: this.graphics, audio: this.audio, hudRoot: this.els.hud, actions: this.hudActions(), showTitle: !this.menus, results: !this.resultsScreen, rumble: this.rumble, touch: this.touchRig });
      this.bindStats(next);
      this.bindResultsPanel(next);
      this.bindPerf(next);
      if (isNativeApp()) bindHaptics(next.bus, next.player.def.id); // the race's bus is cleared on dispose
      this.session = next;
      this.sessionKey = key;
      next.setAssists(this.playerAssists()); // they may have changed while it was building
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
      onSkipIntro: () => this.endIntro(),
      onSkipTutorial: () => this.session?.skipTutorial(),
    };
    const tilt = this.tilt;
    actions.tilt = {
      needed: () => this.settings.touch.value.steer === 'tilt' && this.inputDevice.value === 'touch' && !tilt.fresh,
      enable: () => void this.enableTilt(),
    };
    if (this.menus) {
      actions.onMenu = () => this.quitToMenu();
      actions.onSettings = () => this.openSettings('pause');
    }
    if (this.cupRace.value) actions.cup = { onStandings: () => this.quitToMenu(), onRetire: () => this.quitToMenu() };
    return actions;
  }

  /**
   * A race ends on the results screen (IMPLEMENTATION §M8a), not on the HUD's results panel. The no-menu flows
   * (`?autopilot=1`, `?seed=N`) keep the HUD panel.
   */
  get resultsScreen(): boolean {
    return this.menus && this.flags.seed === null;
  }

  private bindStats(s: RaceSession): void {
    const profileId = this.menus ? this.activeProfile.value?.id : undefined;
    if (!profileId) return;
    s.bus.on('race:results', ({ standings }) => {
      const me = standings.find((r) => r.id === s.player.def.id);
      if (s.isTrial) {
        this.bookTrialRun(s, profileId, me, standings);
        return;
      }
      const tier = s.player.def.tier ?? 'rookie';
      // A race on a world counts on the World Tour (a cup race too); the classic and Bonus tracks do not.
      const world = this.flags.seed === null && s.setup.source.kind === 'authored' ? worldById(s.setup.worldId) : undefined;
      let pay = 0;
      let tour = null as TourResult | null; // set inside the save update
      this.updateSave((d) => {
        const p = d.profiles.find((x) => x.id === profileId);
        if (!p) return;
        pay = settleRace(p, me, tier);
        if (!world) return;
        tour = bookTourRace(p.tour, world.id, tier, me, tourWorlds(this.features));
        p.tour = tour.tour;
        p.credits += tour.bonus;
      });
      const t: TourResult | null = tour;
      const firstClear = t?.bonus ?? 0;
      // A cup race also books the cup (and, after the last race, pays the cup bonus).
      const cup = this.cupRace.value && this.session === s;
      const booked = cup ? this.bookCupRace(standings) : { cup: 0, champion: 0 };
      const cupBonus = booked.cup;
      const total = this.activeProfile.value?.credits ?? 0;
      const delta = pay + firstClear + cupBonus + booked.champion;
      if (delta > 0) s.bus.emit('economy:credits', { delta, total });
      if (!this.resultsScreen || this.session !== s || !world) return;
      const roster = rosterOf(s.setup.field);
      this.lastResult.value = {
        mode: cup ? 'cup' : 'tour',
        worldId: world.id,
        tier,
        standings: standings.map((x) => ({ ...x })),
        playerId: s.player.def.id,
        roster,
        tally: raceTally(me, tier, { firstClear, cup: cupBonus, champion: booked.champion }),
        credits: total,
        unlocked: t?.unlocked ?? null,
        newTrophies: t?.newTrophies ?? [],
        quote: winnerQuote(standings, roster, s.player.def.id),
      };
      this.route.value = { name: 'results' };
    });
  }

  /** A Time Trial run: book the time and medals, pay them, keep the ghost when it is the best, show the results. */
  private bookTrialRun(s: RaceSession, profileId: string, me: RacerStanding | undefined, standings: readonly RacerStanding[]): void {
    const trackId = s.setup.trackKey;
    const devTime = DEV_TIMES[trackId];
    const world = worldById(s.setup.worldId);
    if (!devTime || !world) return;
    const total = me?.status === 'finished' && me.totalTime !== null ? me.totalTime : null;
    let outcome = { pay: 0, best: false, reached: null as Medal | null, previous: null as Medal | null, previousBest: null as number | null };
    this.updateSave((d) => {
      const p = d.profiles.find((x) => x.id === profileId);
      if (!p) return;
      const rec = p.records[trackId] ?? {};
      outcome.previous = rec.medal ?? null;
      outcome.previousBest = rec.trialTime ?? null;
      if (total === null) return;
      const r = bookTrial(rec, total, devTime);
      p.records[trackId] = r.record;
      p.credits += r.pay;
      outcome = { ...outcome, pay: r.pay, best: r.best, reached: r.reached };
    });
    const o = outcome;
    const ghost = s.trialGhost;
    if (o.best && ghost) this.ghostSaving = this.ghostStore.put(profileId, trackId, ghost).catch(() => false);
    const credits = this.save.value.profiles.find((x) => x.id === profileId)?.credits ?? 0;
    if (o.pay > 0) s.bus.emit('economy:credits', { delta: o.pay, total: credits });
    if (!this.resultsScreen || this.session !== s) return;
    this.lastResult.value = {
      mode: 'trial',
      worldId: world.id,
      tier: s.player.def.tier ?? 'rookie',
      standings: standings.map((x) => ({ ...x })),
      playerId: s.player.def.id,
      roster: rosterOf(s.setup.field),
      tally: medalTally(o.previous, o.reached),
      credits,
      unlocked: null,
      newTrophies: [],
      quote: null,
      trial: { total, lapTimes: [...s.race.snapshot().lapTimes], devTime, medalTimes: medalTimes(devTime), previousBest: o.previousBest, best: o.best, reached: o.reached, previous: o.previous },
    };
    this.route.value = { name: 'results' };
  }

  // ------------------------------------------------------------ Results screen (IMPLEMENTATION §M8a)

  /** RACE AGAIN: the same world and tier, through the grid intro. */
  raceAgain(): void {
    const r = this.lastResult.value;
    // A Time Trial runs again with the ghosts reloaded (a new best ghost replaces the old one).
    if (r?.mode === 'trial' && this.trial) void this.startTrial(r.worldId);
    else void this.startRace();
  }

  /** Leave the results for a menu screen; the race goes back to the grid behind it. */
  leaveResults(to: Route): void {
    this.session?.toTitle();
    this.trial = null;
    this.route.value = to;
  }

  /** NEXT WORLD: the map, with the world just unlocked picked and its card open. */
  resultsNextWorld(): void {
    const id = this.lastResult.value?.unlocked;
    if (!id) return;
    this.session?.toTitle();
    this.openTourCard(id);
  }

  /** STANDINGS (a cup race): the cup standings, as the HUD's CUP STANDINGS button does. */
  resultsStandings(): void {
    this.quitToMenu();
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
    this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.musicVolume);
    if (this.audio.muted !== s.muted) this.audio.setMuted(s.muted);
    this.graphics.setComfort({ reducedMotion: s.reducedMotion });
    this.graphics.setColorBlind(s.colorBlind);
    setHapticsEnabled(s.haptics);
    this.rumble.enabled = s.haptics;
    this.input.setBindings(s.keyBindings);
    this.input.setPadBindings(s.padBindings);
    const root = document.documentElement.classList;
    // HUD size (IMPLEMENTATION §M7a): until M7c restyles them, both classes carry the old LARGE TEXT rules.
    root.toggle('mz-hud-large', s.hudSize === 'large');
    root.toggle('mz-hud-xl', s.hudSize === 'xl');
    root.toggle('mz-cb', s.colorBlind);
    root.toggle('mz-reduced-motion', s.reducedMotion);
  }
}
