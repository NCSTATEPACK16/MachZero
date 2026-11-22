/**
 * Save-file shape (localStorage key `machzero.save`) and defensive parsing. Everything read from storage
 * goes through `sanitizeSave`, so hand-edited, truncated or foreign data always yields a usable save.
 */
import type { AITier, Assists, KeyBindings, KeyControl, Loadout, PartSlot, PartTier, PartVariant } from '../core/contracts';
import { CHASSIS, chassisById } from '../content/ships';
import { PART_SLOTS, STOCK_PARTS, STOCK_VARIANTS, parsePartKey, partKey, variantOf } from '../content/parts';
import { WORLDS, type WorldId } from '../content/worlds';
import { type ItemBag, clampBag, emptyBag, itemSlots } from '../content/items';
import { type CupState, type Trophies, sanitizeCup, sanitizeTrophies } from '../game/modes/GrandPrix';

export const SAVE_KEY = 'machzero.save';
export const SAVE_VERSION = 9;

export const MAX_PROFILES = 8;
export const PROFILE_NAME_MAX = 12;
/** Number of code-drawn badges (ui/badges). */
export const BADGE_COUNT = 12;

export type QualitySetting = 'auto' | 'low' | 'med' | 'high';
export type TouchSteer = 'slider' | 'tilt';
/** HUD and menu scale (IMPLEMENTATION §M7c): 1, 1.15 or 1.3. Replaces the v7 `largeText` switch. */
export type HudSize = 'normal' | 'large' | 'xl';
export type AirbrakeStyle = 'slider' | 'buttons';
/** Low / medium / high. */
export type Step3 = 0 | 1 | 2;
/** The eight pad driving controls that can be remapped (M7c). Steering stays on the left stick. */
export type PadControl = 'throttle' | 'brake' | 'airLeft' | 'airRight' | 'boost' | 'item' | 'itemPrev' | 'itemNext';
/** Standard-mapping button indices 0–15, one or two per control. */
export type PadBindings = Record<PadControl, number[]>;

/** Touch controls (IMPLEMENTATION §M7b, §M7c). Per device, not per profile. */
export interface TouchSettings {
  steer: TouchSteer;
  /** Auto-accelerate whenever touch drives, whatever the profile's assists say. */
  autoAccelerate: boolean;
  /** Slider sensitivity. */
  sensitivity: Step3;
  airbrake: AirbrakeStyle;
  buttonSize: 's' | 'm' | 'l';
  leftHanded: boolean;
  tiltSensitivity: Step3;
  /** Tilt neutral angle in degrees, −20..20. */
  tiltNeutral: number;
  /** The first-race touch hint was shown. */
  hintSeen: boolean;
}

export type Medal = 'bronze' | 'silver' | 'gold';
export const MEDALS: readonly Medal[] = ['bronze', 'silver', 'gold'];

export interface TrackRecord {
  /** Best single lap (s). */
  bestLap?: number;
  /** Time Trial (IMPLEMENTATION §M8b): best 3-lap total (s) and the best medal reached. */
  trialTime?: number;
  medal?: Medal;
}

/** World Tour progress (IMPLEMENTATION §M8a). */
export interface TourState {
  /** Worlds opened by the 8 → 9 migration (raced before World Tour existed). */
  granted: WorldId[];
  /** World Tour trophies: tiers at which the world was finished in the top 3 (lower tiers filled in), in tier order. */
  trophies: Partial<Record<WorldId, AITier[]>>;
}

/** A championship season in progress (IMPLEMENTATION §M8c). */
export interface SeasonState {
  tier: AITier;
  /** The season's finished cups, in order. The cup in progress is Profile.cup. */
  done: CupState[];
}

export interface GhostSettings {
  best: boolean;
  dev: boolean;
}

export interface Profile {
  id: string;
  name: string;
  badge: number;
  createdAt: number;
  assists: Assists;
  /** CPU difficulty (Settings → Gameplay). */
  aiTier: AITier;
  credits: number;
  loadout: Loadout;
  /** Parts owned per slot, as part keys ('0' Stock, then tier + variant: '1a', '2b'). Stock is always owned. */
  owned: Record<PartSlot, string[]>;
  /** World picked last on the world select (the menu's RACE goes there). */
  world: string;
  /** Per track key: 'classic' (the v1 track), 'bonus-<seed>', or a world's track id. */
  records: Record<string, TrackRecord>;
  stats: { races: number; wins: number };
  /** Items bought in the garage, carried into races (unused ones carry over). */
  items: ItemBag;
  /** The Grand Prix cup in progress (saved after every race), or null. */
  cup: CupState | null;
  /** Grand Prix cups won, one trophy per CPU tier, in tier order. */
  trophies: Trophies;
  /** World Tour progress (M8a). */
  tour: TourState;
  /** The championship season in progress, or null (M8c). */
  season: SeasonState | null;
  /** Champion trophies, in tier order (M8c). */
  champion: AITier[];
  /** The first-race tutorial was finished or skipped (M8c). */
  tutorialDone: boolean;
}

export interface SettingsData {
  /** 0..1 */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  colorBlind: boolean;
  hudSize: HudSize;
  /** iOS haptics and pad rumble. */
  haptics: boolean;
  /** Frame-time panel (the in-app way to get ?perf=1, e.g. in the iOS app). */
  perfPanel: boolean;
  keyBindings: KeyBindings;
  quality: QualitySetting;
  /** What 'auto' resolved to on this device (device hint or first-launch benchmark); null = not yet. */
  detectedQuality: 'low' | 'med' | 'high' | null;
  touch: TouchSettings;
  padBindings: PadBindings;
  /** Time Trial ghosts shown (M8b). */
  ghosts: GhostSettings;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  profiles: Profile[];
  activeProfileId: string | null;
  settings: SettingsData;
}

export const KEY_CONTROLS: readonly KeyControl[] = ['throttle', 'brake', 'left', 'right', 'airLeft', 'airRight', 'boost', 'item', 'itemNext'];

/** v1 keyboard layout. */
export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  airLeft: ['KeyQ'],
  airRight: ['KeyE'],
  boost: ['Space', 'ShiftLeft', 'ShiftRight'],
  item: ['KeyF'],
  itemNext: ['KeyC'],
});

/** Keys that always mean a menu action and can't be bound to driving. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['Escape', 'Enter', 'NumpadEnter', 'Backspace', 'Tab', 'KeyM', 'KeyP', 'KeyR']);

export const PAD_CONTROLS: readonly PadControl[] = ['throttle', 'brake', 'airLeft', 'airRight', 'boost', 'item', 'itemPrev', 'itemNext'];

/** Today's pad layout (standard mapping): RT/Ⓐ throttle, LT/Ⓑ brake, LB/RB air-brakes, Ⓧ boost, Ⓨ item, d-pad ←/→ item select. */
export const DEFAULT_PAD_BINDINGS: Readonly<PadBindings> = Object.freeze({
  throttle: [7, 0],
  brake: [6, 1],
  airLeft: [4],
  airRight: [5],
  boost: [2],
  item: [3],
  itemPrev: [14],
  itemNext: [15],
});

export function clonePadBindings(b: Readonly<PadBindings>): PadBindings {
  const out = {} as PadBindings;
  for (const k of PAD_CONTROLS) out[k] = [...b[k]];
  return out;
}

export function defaultTouch(): TouchSettings {
  return { steer: 'slider', autoAccelerate: true, sensitivity: 1, airbrake: 'slider', buttonSize: 'm', leftHanded: false, tiltSensitivity: 1, tiltNeutral: 0, hintSeen: false };
}

export const ROOKIE_ASSISTS: Readonly<Assists> = Object.freeze({ autoAccelerate: true, steering: 2, noKO: true, earlyBoost: true });
export const NO_ASSISTS: Readonly<Assists> = Object.freeze({ autoAccelerate: false, steering: 0, noKO: false, earlyBoost: false });

export const AI_TIERS: readonly AITier[] = ['rookie', 'pilot', 'ace', 'legend'];

export function defaultSettings(): SettingsData {
  return {
    masterVolume: 0.8,
    musicVolume: 0.7,
    sfxVolume: 1,
    muted: false,
    reducedMotion: false,
    colorBlind: false,
    hudSize: 'normal',
    haptics: true,
    perfPanel: false,
    keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS),
    quality: 'auto',
    detectedQuality: null,
    touch: defaultTouch(),
    padBindings: clonePadBindings(DEFAULT_PAD_BINDINGS),
    ghosts: { best: true, dev: true },
  };
}

export function emptyTour(): TourState {
  return { granted: [], trophies: {} };
}

export function emptySave(): SaveData {
  return { version: SAVE_VERSION, profiles: [], activeProfileId: null, settings: defaultSettings() };
}

export function cloneBindings(b: Readonly<KeyBindings>): KeyBindings {
  const out = {} as KeyBindings;
  for (const k of KEY_CONTROLS) out[k] = [...b[k]];
  return out;
}

export type ProfilePreset = 'rookie' | 'classic';

let idCounter = 0;
function newId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function cleanName(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-_!?']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PROFILE_NAME_MAX);
  return s;
}

/** A new profile: stock COMET, and the SPEC §2 preset ("I'm new" → Rookie, otherwise Classic). */
export function createProfile(name: string, badge: number, preset: ProfilePreset): Profile {
  const c = chassisById('comet');
  return {
    id: newId(),
    name: cleanName(name) || 'PILOT',
    badge: clampInt(badge, 0, BADGE_COUNT - 1, 0),
    createdAt: Date.now(),
    assists: { ...(preset === 'rookie' ? ROOKIE_ASSISTS : NO_ASSISTS) },
    aiTier: preset === 'rookie' ? 'rookie' : 'pilot',
    credits: 0,
    loadout: { chassisId: c.id, parts: { ...STOCK_PARTS }, variants: { ...STOCK_VARIANTS }, livery: { ...c.livery, decal: 0 } },
    owned: { engine: ['0'], booster: ['0'], stabilizer: ['0'], hull: ['0'], aero: ['0'] },
    world: WORLDS[0].id,
    records: {},
    stats: { races: 0, wins: 0 },
    items: emptyBag(),
    cup: null,
    trophies: {},
    tour: emptyTour(),
    season: null,
    champion: [],
    tutorialDone: false,
  };
}

// ---------------------------------------------------------------------------
// Sanitising (unknown → typed, with defaults)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d;
}
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const tier = (v: unknown): PartTier => clampInt(v, 0, 3, 0) as PartTier;
const variant = (v: unknown): PartVariant => (v === 'b' ? 'b' : 'a');
const color = (v: unknown, d: number): number => clampInt(v, 0, 0xffffff, d);

function sanitizeAssists(v: unknown): Assists {
  const o = isObj(v) ? v : {};
  return {
    autoAccelerate: bool(o.autoAccelerate, false),
    steering: clampInt(o.steering, 0, 2, 0) as 0 | 1 | 2,
    noKO: bool(o.noKO, false),
    earlyBoost: bool(o.earlyBoost, false),
  };
}

function sanitizeLoadout(v: unknown): Loadout {
  const o = isObj(v) ? v : {};
  const chassisId = typeof o.chassisId === 'string' && CHASSIS.some((c) => c.id === o.chassisId) ? o.chassisId : 'comet';
  const factory = chassisById(chassisId).livery;
  const p = isObj(o.parts) ? o.parts : {};
  const l = isObj(o.livery) ? o.livery : {};
  const vr = isObj(o.variants) ? o.variants : {};
  return {
    chassisId,
    parts: { engine: tier(p.engine), booster: tier(p.booster), stabilizer: tier(p.stabilizer), hull: tier(p.hull), aero: tier(p.aero) },
    variants: { engine: variant(vr.engine), booster: variant(vr.booster), stabilizer: variant(vr.stabilizer), hull: variant(vr.hull), aero: 'a' },
    livery: {
      primary: color(l.primary, factory.primary),
      secondary: color(l.secondary, factory.secondary),
      glow: color(l.glow, factory.glow),
      decal: clampInt(l.decal, 0, 5, 0),
    },
  };
}

function sanitizeProfile(v: unknown): Profile | null {
  if (!isObj(v) || typeof v.id !== 'string' || v.id === '') return null;
  const owned = {} as Record<PartSlot, string[]>;
  const ow = isObj(v.owned) ? v.owned : {};
  for (const slot of PART_SLOTS) {
    const keys = new Set<string>(['0']);
    for (const raw of Array.isArray(ow[slot]) ? (ow[slot] as unknown[]) : []) {
      const k = parsePartKey(raw);
      // A key the slot cannot have (a B Aero part) is dropped: re-keying it would not match what was bought.
      if (k && partKey(slot, k.tier, k.variant) === raw) keys.add(raw as string);
    }
    owned[slot] = [...keys].sort();
  }
  const loadout = sanitizeLoadout(v.loadout);
  const cup = sanitizeCup(v.cup, AI_TIERS);
  // Only owned parts can be fitted; a slot's variant is 'a' wherever it has no choice.
  const variants = { ...STOCK_VARIANTS, ...loadout.variants };
  for (const slot of PART_SLOTS) {
    if (!owned[slot].includes(partKey(slot, loadout.parts[slot], variants[slot]))) loadout.parts[slot] = 0;
    variants[slot] = variantOf(slot, loadout.parts[slot], variants[slot]);
  }
  loadout.variants = variants;
  const records: Record<string, TrackRecord> = {};
  if (isObj(v.records)) {
    for (const [k, r] of Object.entries(v.records)) {
      if (!isObj(r)) continue;
      const rec: TrackRecord = {};
      if (positive(r.bestLap)) rec.bestLap = r.bestLap;
      if (positive(r.trialTime)) rec.trialTime = r.trialTime;
      if (typeof r.medal === 'string' && (MEDALS as readonly string[]).includes(r.medal)) rec.medal = r.medal as Medal;
      records[k] = rec;
    }
  }
  const st = isObj(v.stats) ? v.stats : {};
  const stats = { races: Math.floor(num(st.races, 0, 1e9, 0)), wins: Math.floor(num(st.wins, 0, 1e9, 0)) };
  const it = isObj(v.items) ? v.items : {};
  return {
    id: v.id,
    name: cleanName(typeof v.name === 'string' ? v.name : '') || 'PILOT',
    badge: clampInt(v.badge, 0, BADGE_COUNT - 1, 0),
    createdAt: num(v.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    assists: sanitizeAssists(v.assists),
    aiTier: oneOf(v.aiTier, AI_TIERS, 'rookie'),
    credits: Math.floor(num(v.credits, 0, 1e9, 0)),
    loadout,
    owned,
    world: typeof v.world === 'string' && WORLDS.some((w) => w.id === v.world && w.built) ? v.world : WORLDS[0].id,
    records,
    stats,
    items: clampBag(it, itemSlots({ stats })),
    cup,
    trophies: sanitizeTrophies(v.trophies, AI_TIERS),
    tour: sanitizeTour(v.tour),
    season: seasonWithCup(sanitizeSeason(v.season), cup),
    champion: tierList(v.champion),
    tutorialDone: bool(v.tutorialDone, false),
  };
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isWorldId = (v: unknown): v is WorldId => typeof v === 'string' && WORLDS.some((w) => w.id === v);

/** Known tiers only, no duplicates, in AI_TIERS order. */
function tierList(v: unknown): AITier[] {
  return Array.isArray(v) ? AI_TIERS.filter((t) => v.includes(t)) : [];
}

export function sanitizeTour(v: unknown): TourState {
  if (!isObj(v)) return emptyTour();
  const granted = Array.isArray(v.granted) ? WORLDS.filter((w) => (v.granted as unknown[]).includes(w.id)).map((w) => w.id) : [];
  const trophies: TourState['trophies'] = {};
  if (isObj(v.trophies)) {
    for (const [id, list] of Object.entries(v.trophies)) {
      if (!isWorldId(id)) continue;
      const tiers = tierList(list);
      if (tiers.length) trophies[id] = tiers;
    }
  }
  return { granted, trophies };
}

/**
 * A season always has its current cup in `Profile.cup` (the next cup is queued as soon as one finishes): a season
 * whose cup is missing, at another tier, or one it already played is dropped (IMPLEMENTATION §M8c step 2).
 */
function seasonWithCup(season: SeasonState | null, cup: CupState | null): SeasonState | null {
  if (!season || !cup || cup.tier !== season.tier || season.done.some((d) => d.cupId === cup.cupId)) return null;
  return season;
}

function sanitizeSeason(v: unknown): SeasonState | null {
  if (!isObj(v) || !(AI_TIERS as readonly unknown[]).includes(v.tier) || !Array.isArray(v.done)) return null;
  const done: CupState[] = [];
  for (const raw of v.done) {
    const c = sanitizeCup(raw, AI_TIERS, true);
    if (!c) return null;
    done.push(c);
  }
  return { tier: v.tier as AITier, done };
}

function sanitizeBindings(v: unknown): KeyBindings {
  const d = cloneBindings(DEFAULT_KEY_BINDINGS);
  if (!isObj(v)) return d;
  const out = {} as KeyBindings;
  const used = new Set<string>();
  for (const k of KEY_CONTROLS) {
    const raw = v[k];
    const list: string[] = [];
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (typeof c !== 'string' || !/^[A-Za-z0-9]{1,24}$/.test(c) || RESERVED_CODES.has(c) || used.has(c) || list.includes(c)) continue;
        if (list.length < 3) list.push(c);
      }
    }
    out[k] = list.length > 0 ? list : d[k].filter((c) => !used.has(c));
    for (const c of out[k]) used.add(c);
  }
  return out;
}

const step3 = (v: unknown, d: Step3): Step3 => clampInt(v, 0, 2, d) as Step3;

export function sanitizeTouch(v: unknown): TouchSettings {
  const d = defaultTouch();
  if (!isObj(v)) return d;
  return {
    steer: oneOf(v.steer, ['slider', 'tilt'] as const, d.steer),
    autoAccelerate: bool(v.autoAccelerate, d.autoAccelerate),
    sensitivity: step3(v.sensitivity, d.sensitivity),
    airbrake: oneOf(v.airbrake, ['slider', 'buttons'] as const, d.airbrake),
    buttonSize: oneOf(v.buttonSize, ['s', 'm', 'l'] as const, d.buttonSize),
    leftHanded: bool(v.leftHanded, d.leftHanded),
    tiltSensitivity: step3(v.tiltSensitivity, d.tiltSensitivity),
    tiltNeutral: num(v.tiltNeutral, -20, 20, d.tiltNeutral),
    hintSeen: bool(v.hintSeen, d.hintSeen),
  };
}

/**
 * Pad bindings: button indices 0–15, at most 2 per control, no index on two controls (the first control in
 * PAD_CONTROLS order keeps it). A control left empty takes its default buttons that are still free, or else
 * every default is restored.
 */
export function sanitizePadBindings(v: unknown): PadBindings {
  const d = clonePadBindings(DEFAULT_PAD_BINDINGS);
  if (!isObj(v)) return d;
  const out = {} as PadBindings;
  const used = new Set<number>();
  for (const k of PAD_CONTROLS) {
    const raw = v[k];
    const list: number[] = [];
    if (Array.isArray(raw)) {
      for (const b of raw) {
        if (typeof b !== 'number' || !Number.isInteger(b) || b < 0 || b > 15 || used.has(b) || list.includes(b)) continue;
        if (list.length < 2) list.push(b);
      }
    }
    out[k] = list.length > 0 ? list : d[k].filter((b) => !used.has(b));
    if (out[k].length === 0) return d;
    for (const b of out[k]) used.add(b);
  }
  return out;
}

export function sanitizeSettings(v: unknown): SettingsData {
  const d = defaultSettings();
  if (!isObj(v)) return d;
  return {
    masterVolume: num(v.masterVolume, 0, 1, d.masterVolume),
    musicVolume: num(v.musicVolume, 0, 1, d.musicVolume),
    sfxVolume: num(v.sfxVolume, 0, 1, d.sfxVolume),
    muted: bool(v.muted, d.muted),
    reducedMotion: bool(v.reducedMotion, d.reducedMotion),
    colorBlind: bool(v.colorBlind, d.colorBlind),
    hudSize: oneOf(v.hudSize, ['normal', 'large', 'xl'] as const, d.hudSize),
    haptics: bool(v.haptics, d.haptics),
    perfPanel: bool(v.perfPanel, d.perfPanel),
    keyBindings: sanitizeBindings(v.keyBindings),
    quality: oneOf(v.quality, ['auto', 'low', 'med', 'high'] as const, d.quality),
    detectedQuality: v.detectedQuality === 'low' || v.detectedQuality === 'med' || v.detectedQuality === 'high' ? v.detectedQuality : null,
    touch: sanitizeTouch(v.touch),
    padBindings: sanitizePadBindings(v.padBindings),
    ghosts: { best: bool(isObj(v.ghosts) ? v.ghosts.best : undefined, d.ghosts.best), dev: bool(isObj(v.ghosts) ? v.ghosts.dev : undefined, d.ghosts.dev) },
  };
}

/** Current-version data of unknown quality → a valid SaveData. */
export function sanitizeSave(v: unknown): SaveData {
  if (!isObj(v)) return emptySave();
  const profiles: Profile[] = [];
  const ids = new Set<string>();
  if (Array.isArray(v.profiles)) {
    for (const raw of v.profiles) {
      const p = sanitizeProfile(raw);
      if (p && !ids.has(p.id) && profiles.length < MAX_PROFILES) {
        ids.add(p.id);
        profiles.push(p);
      }
    }
  }
  const active = typeof v.activeProfileId === 'string' && ids.has(v.activeProfileId) ? v.activeProfileId : null;
  return { version: SAVE_VERSION, profiles, activeProfileId: active, settings: sanitizeSettings(v.settings) };
}
