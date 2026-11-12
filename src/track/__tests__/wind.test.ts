import { describe, expect, it } from 'vitest';
import type { TrackDefinition, TrackFeature } from '../../core/contracts';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '../TrackSource';
import { validateTrack } from '../TrackValidate';
import { buildWinds, WIND_EDGE, WIND_RAMP, windAccel, windAt, windGust, windSpan } from '../features/wind';
import { buildStrikes, STRIKE_MIN_PERIOD, STRIKE_TIME, strikeActive, strikesDuring } from '../features/lightning';

const spireDef = TRACK_DEFS['tempest-spire'];
const spire = trackFromSource({ kind: 'authored', def: spireDef });

function issuesWith(extra: TrackFeature[], drop: (f: TrackFeature) => boolean = () => false): string[] {
  const def: TrackDefinition = { ...spireDef, id: 'spire-variant', features: [...spireDef.features.filter((f) => !drop(f)), ...extra] };
  return validateTrack(trackFromSource({ kind: 'authored', def }), def.elevation).issues.map((i) => `${i.code}: ${i.message}`);
}

describe('wind timeline', () => {
  const w = { period: 6, phase: 0, duty: 0.5 };

  it('blows for duty × period, ramping up and down, and repeats every period', () => {
    expect(windGust(w, 0)).toBe(0);
    expect(windGust(w, WIND_RAMP / 2)).toBeCloseTo(0.5, 5);
    expect(windGust(w, 1.5)).toBe(1);
    expect(windGust(w, 3 - WIND_RAMP / 2)).toBeCloseTo(0.5, 5);
    expect(windGust(w, 3)).toBe(0);
    expect(windGust(w, 5.9)).toBe(0);
    expect(windGust(w, 7.5)).toBe(windGust(w, 1.5));
    expect(windGust({ ...w, phase: 1.5 }, 0)).toBe(1);
  });

  it('a gust with duty 1 never drops', () => {
    for (let t = 0; t < 12; t += 0.1) expect(windGust({ period: 6, phase: 0, duty: 1 }, t)).toBe(1);
  });

  it('the push fades in and out over the ends of the zone and is zero outside it', () => {
    const z = { dStart: 100, dEnd: 300 };
    expect(windSpan(z, 99, 4000)).toBe(0);
    expect(windSpan(z, 100 + WIND_EDGE / 2, 4000)).toBeCloseTo(0.5, 5);
    expect(windSpan(z, 200, 4000)).toBe(1);
    expect(windSpan(z, 300 - WIND_EDGE / 2, 4000)).toBeCloseTo(0.5, 5);
    expect(windSpan(z, 301, 4000)).toBe(0);
  });

  it('the push is signed by the zone direction', () => {
    const [a, b] = buildWinds({ features: [
      { type: 'wind', dStart: 100, dEnd: 300, dir: 1, accel: 7, period: 6, phase: 1.5, duty: 0.5 },
      { type: 'wind', dStart: 500, dEnd: 700, dir: -1, accel: 5, period: 6, phase: 1.5, duty: 0.5 },
    ] });
    expect(windAccel(a, 200, 4000, 0)).toBe(7);
    expect(windAccel(b, 600, 4000, 0)).toBe(-5);
    expect(windAt([a, b], 600, 4000, 0)).toBe(-5);
    expect(windAt([a, b], 400, 4000, 0)).toBe(0);
  });
});

describe('lightning timeline', () => {
  const k = { period: 5, phase: 0 };

  it('the bolt is the last STRIKE_TIME seconds of each cycle: never at t = 0', () => {
    expect(strikeActive(k, 0)).toBe(false);
    expect(strikeActive(k, 5 - STRIKE_TIME / 2)).toBe(true);
    expect(strikeActive(k, 5.01)).toBe(false);
  });

  it('strikesDuring finds a bolt anywhere in the window', () => {
    expect(strikesDuring(k, 1, 2)).toBe(false);
    expect(strikesDuring(k, 4.5, 4.85)).toBe(true);
    expect(strikesDuring(k, 4.9, 5.4)).toBe(true);
    expect(strikesDuring(k, 5.05, 5.5)).toBe(false);
    expect(strikesDuring(k, 0, 20)).toBe(true);
  });

  it('the points of a field strike at different moments', () => {
    const phases = buildStrikes(spire).slice(0, 5).map((s) => s.phase % s.period);
    expect(new Set(phases.map((p) => p.toFixed(2))).size).toBe(5);
  });
});

describe('Tempest Spire wind and lightning placement (validator)', () => {
  it('the authored track is valid: three wind zones, two lightning fields, one jump', () => {
    expect(validateTrack(spire, spireDef.elevation).issues).toEqual([]);
    expect(spire.features.filter((f) => f.type === 'wind').length).toBe(3);
    expect(spire.features.filter((f) => f.type === 'lightning').length).toBe(2);
    expect(spire.jumps.length).toBe(1);
    // Wind pushes both ways over a lap.
    expect(new Set(buildWinds(spire).map((w) => w.dir)).size).toBe(2);
  });

  const jump = spireDef.features.find((f) => f.type === 'jump')!;
  const jumpAt = jump.type === 'jump' ? jump.dTakeoff : 0;

  it('rejects wind on the jump, on the start and pit area, and over another zone', () => {
    const wind = (dStart: number, dEnd: number): TrackFeature => ({ type: 'wind', dStart, dEnd, dir: 1, accel: 7, period: 6, phase: 0, duty: 0.5 });
    expect(issuesWith([wind(jumpAt - 60, jumpAt + 60)]).some((m) => m.startsWith('wind:') && m.includes('jump'))).toBe(true);
    expect(issuesWith([wind(40, 200)]).some((m) => m.startsWith('wind:') && m.includes('start'))).toBe(true);
    const first = buildWinds(spire)[0];
    expect(issuesWith([wind(first.dStart + 50, first.dEnd + 50)]).some((m) => m.includes('overlaps the wind zone'))).toBe(true);
  });

  it('rejects a gust that is too strong, too short, or a zone too short to fade', () => {
    const base = buildWinds(spire)[0];
    const only = (f: TrackFeature): boolean => f.type === 'wind' && f.dStart === base.dStart;
    const variant = (patch: Partial<Extract<TrackFeature, { type: 'wind' }>>): string[] =>
      issuesWith([{ type: 'wind', dStart: base.dStart, dEnd: base.dEnd, dir: 1, accel: 7, period: 6, phase: 0, duty: 0.5, ...patch }], only);
    expect(variant({})).toEqual([]);
    expect(variant({ accel: 20 }).some((m) => m.includes('gust 20'))).toBe(true);
    expect(variant({ duty: 0.1 }).some((m) => m.includes('on or off for less'))).toBe(true);
    expect(variant({ dEnd: base.dStart + 50 }).some((m) => m.includes('shorter than'))).toBe(true);
  });

  it('rejects lightning inside a wind zone or with too short a period', () => {
    const w = buildWinds(spire)[0];
    const field = (patch: Partial<Extract<TrackFeature, { type: 'lightning' }>>): TrackFeature => ({ type: 'lightning', dStart: w.dStart + 40, dEnd: w.dStart + 160, count: 3, period: 5, phase: 0, lane: 0, ...patch });
    expect(issuesWith([field({})]).some((m) => m.includes('inside the wind zone'))).toBe(true);
    const free = spireDef.features.find((f) => f.type === 'lightning')!;
    const drop = (f: TrackFeature): boolean => f === free;
    const at = free.type === 'lightning' ? { dStart: free.dStart, dEnd: free.dEnd } : {};
    expect(issuesWith([field({ ...at })], drop)).toEqual([]);
    expect(issuesWith([field({ ...at, period: STRIKE_MIN_PERIOD - 0.5 })], drop).some((m) => m.includes('period'))).toBe(true);
  });
});
