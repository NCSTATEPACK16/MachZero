/**
 * Chassis catalogue: 6 ships in 3 weight classes (SPEC §5.1, IMPLEMENTATION Appendix A).
 * The two ships of a class share stats and differ only in looks.
 */
import type { ShipClass, ShipLivery, ShipStats } from '../core/contracts';

/** Base stats per class at Stock parts. Balanced = v1 CONFIG exactly (see ShipStatsResolver tests). */
export const CLASS_STATS: Readonly<Record<ShipClass, Readonly<ShipStats>>> = {
  light: {
    topSpeed: 134,
    thrustAccel: 70,
    boostTopSpeed: 184,
    boostAccel: 100,
    boostCost: 14,
    boostTime: 1.6,
    steerRate: 2.1,
    steerRateHighSpeed: 1.45,
    lateralGrip: 8.5,
    airbrakeGrip: 2.2,
    energyMax: 85,
    damageTakenScale: 1.15,
    mass: 0.8,
  },
  balanced: {
    topSpeed: 140,
    thrustAccel: 62,
    boostTopSpeed: 190,
    boostAccel: 95,
    boostCost: 14,
    boostTime: 1.6,
    steerRate: 1.9,
    steerRateHighSpeed: 1.25,
    lateralGrip: 7.5,
    airbrakeGrip: 2.2,
    energyMax: 100,
    damageTakenScale: 1,
    mass: 1,
  },
  heavy: {
    topSpeed: 146,
    thrustAccel: 54,
    boostTopSpeed: 196,
    boostAccel: 88,
    boostCost: 14,
    boostTime: 1.6,
    steerRate: 1.7,
    steerRateHighSpeed: 1.1,
    lateralGrip: 6.5,
    airbrakeGrip: 2.2,
    energyMax: 120,
    damageTakenScale: 0.85,
    mass: 1.3,
  },
};

/** Hull and collider scale per class, relative to CONFIG.SHIP_LENGTH/WIDTH/HEIGHT. */
export const CLASS_SCALE: Readonly<Record<ShipClass, number>> = { light: 0.9, balanced: 1, heavy: 1.12 };

export const CLASS_LABEL: Readonly<Record<ShipClass, string>> = { light: 'Light', balanced: 'Balanced', heavy: 'Heavy' };

export interface ChassisDef {
  id: string;
  name: string;
  cls: ShipClass;
  blurb: string;
  /** Factory livery (the livery editor starts from it). */
  livery: ShipLivery;
}

export const CHASSIS: readonly ChassisDef[] = [
  { id: 'dart', name: 'DART', cls: 'light', blurb: 'Needle-nosed and twitchy. Quick off the line, fragile in a crowd.', livery: { primary: 0xff5a2b, secondary: 0x1a1d29, glow: 0xffb319 } },
  { id: 'wisp', name: 'WISP', cls: 'light', blurb: 'A feather with fins. Turns on a coin.', livery: { primary: 0x8a4dff, secondary: 0xe8eeff, glow: 0xff2bd6 } },
  { id: 'comet', name: 'COMET', cls: 'balanced', blurb: 'The original MachZero feel. Good at everything.', livery: { primary: 0x1f6bff, secondary: 0xe8eeff, glow: 0x19f0ff } },
  { id: 'arrow', name: 'ARROW', cls: 'balanced', blurb: 'Sharp lines, steady hands, no surprises.', livery: { primary: 0xf2b705, secondary: 0x2b2b35, glow: 0xffe066 } },
  { id: 'titan', name: 'TITAN', cls: 'heavy', blurb: 'Slow to wind up, impossible to stop. Pushes rivals aside.', livery: { primary: 0xd81b2a, secondary: 0x1a1a1a, glow: 0xff3344 } },
  { id: 'bastion', name: 'BASTION', cls: 'heavy', blurb: 'An armoured freight hauler with a racing heart.', livery: { primary: 0x2e7d5b, secondary: 0xd8dde6, glow: 0x7dff3a } },
];

export const DEFAULT_CHASSIS_ID = 'comet';

export function chassisById(id: string): ChassisDef {
  const c = CHASSIS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown chassis "${id}"`);
  return c;
}
