/**
 * Save-file shape (localStorage key `machzero.save`) and defensive parsing. Everything read from storage
 * goes through `sanitizeSave`, so hand-edited, truncated or foreign data always yields a usable save.
 */
import type { AITier, Assists, KeyBindings, KeyControl, Loadout, PartSlot, PartTier } from '../core/contracts';
import { CHASSIS, chassisById } from '../content/ships';
import { PART_SLOTS } from '../content/parts';

export const SAVE_KEY = 'machzero.save';
export const SAVE_VERSION = 2;

export const MAX_PROFILES = 8;
export const PROFILE_NAME_MAX = 12;
/** Number of code-drawn badges (ui/badges). */
export const BADGE_COUNT = 12;

export type QualitySetting = 'auto' | 'low' | 'med' | 'high';
export type TouchSteer = 'slider' | 'tilt';

export interface TrackRecord {
  /** Best single lap (s). */
  bestLap?: number;
}

export interface Profile {
  id: string;
  name: string;
  badge: number;
  createdAt: number;
  assists: Assists;
  /** Last AI tier picked (the default for the next race). */
  aiTier: AITier;
  credits: number;
  loadout: Loadout;
  /** Part tiers owned per slot (Stock is always owned). */
  owned: Record<PartSlot, PartTier[]>;
  /** Per track key: 'classic' (the v1 track), 'bonus-<seed>', later world track ids. */
  records: Record<string, TrackRecord>;
  stats: { races: number; wins: number };
}

export interface SettingsData {
  /** 0..1 */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  reducedMotion: boolean;
  colorBlind: boolean;
  largeText: boolean;
  keyBindings: KeyBindings;
  quality: QualitySetting;
  /** What 'auto' resolved to on this device (device hint or first-launch benchmark); null = not yet. */
  detectedQuality: 'low' | 'med' | 'high' | null;
  touchSteer: TouchSteer;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  profiles: Profile[];
  activeProfileId: string | null;
  settings: SettingsData;
}

export const KEY_CONTROLS: readonly KeyControl[] = ['throttle', 'brake', 'left', 'right', 'airLeft', 'airRight', 'boost'];

/** v1 keyboard layout. */
export const DEFAULT_KEY_BINDINGS: Readonly<KeyBindings> = Object.freeze({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  airLeft: ['KeyQ'],
  airRight: ['KeyE'],
  boost: ['Space', 'ShiftLeft', 'ShiftRight'],
});

/** Keys that always mean a menu action and can't be bound to driving. */
export const RESERVED_CODES: ReadonlySet<string> = new Set(['Escape', 'Enter', 'NumpadEnter', 'Backspace', 'Tab', 'KeyM', 'KeyP', 'KeyR']);

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
    largeText: false,
    keyBindings: cloneBindings(DEFAULT_KEY_BINDINGS),
    quality: 'auto',
    detectedQuality: null,
    touchSteer: 'slider',
  };
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
    loadout: { chassisId: c.id, parts: { engine: 0, booster: 0, stabilizer: 0, hull: 0 }, livery: { ...c.livery, decal: 0 } },
    owned: { engine: [0], booster: [0], stabilizer: [0], hull: [0] },
    records: {},
    stats: { races: 0, wins: 0 },
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
  return {
    chassisId,
    parts: { engine: tier(p.engine), booster: tier(p.booster), stabilizer: tier(p.stabilizer), hull: tier(p.hull) },
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
  const owned = {} as Record<PartSlot, PartTier[]>;
  const ow = isObj(v.owned) ? v.owned : {};
  for (const slot of PART_SLOTS) {
    const list = Array.isArray(ow[slot]) ? (ow[slot] as unknown[]).filter((t) => clampInt(t, 0, 3, -1) >= 0) : [];
    owned[slot] = [...new Set<PartTier>([0, ...(list as PartTier[])])].sort();
  }
  const loadout = sanitizeLoadout(v.loadout);
  // Only owned parts can be fitted.
  for (const slot of PART_SLOTS) if (!owned[slot].includes(loadout.parts[slot])) loadout.parts[slot] = 0;
  const records: Record<string, TrackRecord> = {};
  if (isObj(v.records)) {
    for (const [k, r] of Object.entries(v.records)) {
      if (!isObj(r)) continue;
      const lap = r.bestLap;
      records[k] = typeof lap === 'number' && Number.isFinite(lap) && lap > 0 ? { bestLap: lap } : {};
    }
  }
  const st = isObj(v.stats) ? v.stats : {};
  return {
    id: v.id,
    name: cleanName(typeof v.name === 'string' ? v.name : '') || 'PILOT',
    badge: clampInt(v.badge, 0, BADGE_COUNT - 1, 0),
    createdAt: num(v.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    assists: sanitizeAssists(v.assists),
    aiTier: oneOf(v.aiTier, AI_TIERS, 'pilot'),
    credits: Math.floor(num(v.credits, 0, 1e9, 0)),
    loadout,
    owned,
    records,
    stats: { races: Math.floor(num(st.races, 0, 1e9, 0)), wins: Math.floor(num(st.wins, 0, 1e9, 0)) },
  };
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
    largeText: bool(v.largeText, d.largeText),
    keyBindings: sanitizeBindings(v.keyBindings),
    quality: oneOf(v.quality, ['auto', 'low', 'med', 'high'] as const, d.quality),
    detectedQuality: v.detectedQuality === 'low' || v.detectedQuality === 'med' || v.detectedQuality === 'high' ? v.detectedQuality : null,
    touchSteer: oneOf(v.touchSteer, ['slider', 'tilt'] as const, d.touchSteer),
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
