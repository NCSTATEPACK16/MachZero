import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../core/config';
import type { TrackDefinition, TrackFeature } from '../../core/contracts';
import { TRACK_DEFS } from '../../content/tracks';
import { trackFromSource } from '../TrackSource';
import { validateTrack } from '../TrackValidate';
import { PLUNGE_STALL_SPEED, buildPlunges, inPlunge, plungeAccel, plungeDiveFoot } from '../features/plunge';
import { GEYSER_MIN_PERIOD, GEYSER_TIME, geyserActive, geyserDuring, geyserProgress } from '../features/geyser';

const forgeDef = TRACK_DEFS['cinder-forge'];
const forge = trackFromSource({ kind: 'authored', def: forgeDef });
const plunge = forgeDef.features.find((f) => f.type === 'plunge') as Extract<TrackFeature, { type: 'plunge' }>;

function issuesWith(extra: TrackFeature[], drop: (f: TrackFeature) => boolean = () => false): string[] {
  const def: TrackDefinition = { ...forgeDef, id: 'forge-variant', features: [...forgeDef.features.filter((f) => !drop(f)), ...extra] };
  return validateTrack(trackFromSource({ kind: 'authored', def }), def.elevation).issues.map((i) => `${i.code}: ${i.message}`);
}

describe('plunge gravity', () => {
  const G = CONFIG.MAGNET_G;

  it('pulls a ship that points downhill forward, by the slope', () => {
    expect(plungeAccel(G, 0, 100)).toBeCloseTo(0, 9);
    expect(plungeAccel(G, -Math.sin((55 * Math.PI) / 180), 100)).toBeCloseTo(G * 0.819, 1);
    // Downhill the pull does not depend on the speed: a stopped ship rolls off down the dive.
    expect(plungeAccel(G, -0.5, 0)).toBeCloseTo(G * 0.5, 9);
  });

  it('holds a ship that points uphill back, and fades out so that no ship stalls or rolls back', () => {
    expect(plungeAccel(G, 0.5, 120)).toBeCloseTo(-G * 0.5, 9);
    expect(plungeAccel(G, 0.5, PLUNGE_STALL_SPEED)).toBeCloseTo(-G * 0.5, 9);
    expect(plungeAccel(G, 0.5, PLUNGE_STALL_SPEED * 0.75)).toBeCloseTo(-G * 0.25, 9);
    expect(plungeAccel(G, 0.5, PLUNGE_STALL_SPEED / 2)).toBeCloseTo(0, 9);
    expect(plungeAccel(G, 0.5, 0)).toBeCloseTo(0, 9);
    expect(plungeAccel(G, 0.5, -10)).toBeCloseTo(0, 9);
  });
});

describe('plunge range', () => {
  it('covers the dive, the floor and the climb, and nothing else', () => {
    const [p] = buildPlunges(forge);
    expect(buildPlunges(forge).length).toBe(1);
    expect(inPlunge([p], (plunge.dStart + 1) / forge.length)).toBe(true);
    expect(inPlunge([p], (plunge.dEnd - 1) / forge.length)).toBe(true);
    expect(inPlunge([p], (plunge.dStart - 1) / forge.length)).toBe(false);
    expect(inPlunge([p], (plunge.dEnd + 1) / forge.length)).toBe(false);
    expect(inPlunge([], 0.5)).toBe(false);
  });

  it('finds the foot of the dive: level road, 100 m or more below the top, before the climb', () => {
    const fy = (d: number): number => forge.sampleAt(d / forge.length).forward.y;
    const foot = plungeDiveFoot(buildPlunges(forge)[0], fy);
    expect(Math.abs(fy(foot))).toBeLessThan(0.03);
    expect(forge.sampleAt(plunge.dStart / forge.length).position.y - forge.sampleAt(foot / forge.length).position.y).toBeGreaterThan(100);
    expect(foot).toBeLessThan((plunge.dStart + plunge.dEnd) / 2);
  });
});

describe('geyser timeline', () => {
  const g = { period: 5, phase: 0 };

  it('the eruption is the last GEYSER_TIME seconds of each cycle: never at t = 0', () => {
    expect(geyserActive(g, 0)).toBe(false);
    expect(geyserActive(g, 5 - GEYSER_TIME - 0.01)).toBe(false);
    expect(geyserActive(g, 5 - GEYSER_TIME + 0.01)).toBe(true);
    expect(geyserActive(g, 4.99)).toBe(true);
    expect(geyserActive(g, 5.01)).toBe(false);
    expect(geyserProgress(g, 5 - GEYSER_TIME / 2)).toBeCloseTo(0.5, 5);
  });

  it('tells the AI whether a vent erupts while a ship crosses it', () => {
    expect(geyserDuring(g, 1, 2)).toBe(false);
    expect(geyserDuring(g, 3.5, 3.9)).toBe(true);
    expect(geyserDuring(g, 4.5, 4.6)).toBe(true);
    expect(geyserDuring(g, 5.1, 5.3)).toBe(false);
    expect(geyserDuring(g, 0, 5)).toBe(true);
  });
});

describe('validator: the Plunge and geysers', () => {
  it('passes Cinder Forge as authored', () => {
    expect(validateTrack(forge, forgeDef.elevation).issues).toEqual([]);
  });

  it('rejects a hazard field, a wind zone or a dash plate on the Plunge', () => {
    const mid = (plunge.dStart + plunge.dEnd) / 2;
    expect(issuesWith([{ type: 'geysers', dStart: mid - 60, dEnd: mid + 60, count: 3, period: 5, phase: 0 }]).some((m) => m.startsWith('geyser:') && m.includes('plunge'))).toBe(true);
    expect(issuesWith([{ type: 'wind', dStart: mid - 60, dEnd: mid + 60, dir: 1, accel: 7, period: 6, phase: 0, duty: 0.5 }]).some((m) => m.includes('plunge'))).toBe(true);
    expect(issuesWith([{ type: 'dash', dStart: mid - 6, dEnd: mid + 6, lateralMin: -4, lateralMax: 4 }]).some((m) => m.includes('dash plate') && m.includes('plunge'))).toBe(true);
    expect(issuesWith([{ type: 'mines', dStart: mid - 60, dEnd: mid + 60, count: 3, drift: 2 }]).some((m) => m.startsWith('plunge:') && m.includes('mines'))).toBe(true);
  });

  it('rejects a steep road that is not marked as a Plunge (gravity along the road exists only there)', () => {
    const out = issuesWith([], (f) => f.type === 'plunge');
    expect(out.some((m) => m.startsWith('plunge:') && m.includes('outside a Plunge'))).toBe(true);
  });

  it('rejects a Plunge with no dive in it', () => {
    const flat = forgeDef.features.find((f) => f.type === 'geysers') as Extract<TrackFeature, { type: 'geysers' }>;
    const out = issuesWith([{ type: 'plunge', dStart: flat.dEnd + 20, dEnd: flat.dEnd + 120 }]);
    expect(out.some((m) => m.startsWith('plunge:') && m.includes('no dive'))).toBe(true);
  });

  it('rejects a geyser field whose period is too short for the Rookie warning, or with no room beside its lane', () => {
    const f = forgeDef.features.find((x) => x.type === 'geysers') as Extract<TrackFeature, { type: 'geysers' }>;
    const short = issuesWith([{ ...f, period: GEYSER_MIN_PERIOD - 0.5 }], (x) => x === f);
    expect(short.some((m) => m.startsWith('geyser:') && m.includes('period'))).toBe(true);
    // (A lane that leaves no room at all cannot be built: buildTimedPoints throws, as the lightning fields do.)
    expect(() => issuesWith([{ ...f, count: 0 }], (x) => x === f)).not.toThrow();
    expect(issuesWith([{ ...f, count: 0 }], (x) => x === f).some((m) => m.includes('no vents'))).toBe(true);
  });

  it('rejects a geyser field on the start straight, on a jump or inside a lightning field', () => {
    const f = forgeDef.features.find((x) => x.type === 'geysers') as Extract<TrackFeature, { type: 'geysers' }>;
    const jump = forgeDef.features.find((x) => x.type === 'jump') as Extract<TrackFeature, { type: 'jump' }>;
    expect(issuesWith([{ ...f, dStart: 40, dEnd: 200 }]).some((m) => m.startsWith('geyser:') && m.includes('start'))).toBe(true);
    expect(issuesWith([{ ...f, dStart: jump.dTakeoff - 20, dEnd: jump.dLanding + 20 }]).some((m) => m.startsWith('geyser:') && m.includes('jump'))).toBe(true);
    expect(issuesWith([{ type: 'lightning', dStart: f.dStart + 20, dEnd: f.dEnd - 20, count: 3, period: 5, phase: 0 }]).some((m) => m.startsWith('geyser:') && m.includes('lightning'))).toBe(true);
  });
});
