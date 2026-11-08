/**
 * Pilot portrait badges (SPEC §5.3: "portrait badges drawn in code"): a helmet seen from the front in the pilot's
 * livery (shell = primary, stripe = secondary, visor = glow) with the pilot's emblem on the brow. Pure SVG markup from
 * constant recipes, so the DOM HUD can set it with innerHTML; no image assets.
 */
import type { ShipDefinition, ShipLivery } from '../core/contracts';
import { chassisById } from '../content/ships';
import { pilotById, type PilotMark } from '../content/pilots';

const hex = (c: number): string => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;

const MARKS: Record<PilotMark, string> = {
  flame: 'M24 9 C27 13 29 15 27 19 C30 18 30 15 30 15 C32 19 29 23 24 23 C19 23 17 19 19 15 C20 17 21 18 22 18 C21 15 22 12 24 9 Z',
  star: 'M24 9 L26 14 L31 14 L27 17 L29 22 L24 19 L19 22 L21 17 L17 14 L22 14 Z',
  bolt: 'M26 8 L19 17 H23 L21 24 L29 14 H25 Z',
  chip: 'M19 11 H29 V21 H19 Z M21 13 V19 H27 V13 Z M17 13 H19 M17 16 H19 M17 19 H19 M29 13 H31 M29 16 H31 M29 19 H31',
  snow: 'M24 8 V24 M17 12 L31 20 M31 12 L17 20 M22 9 L24 11 L26 9 M22 23 L24 21 L26 23',
  turbo: 'M15 16 L21 10 V13 H33 V19 H21 V22 Z',
  gear: 'M24 10 L26 12 L29 11 L29 14 L32 16 L29 18 L29 21 L26 20 L24 22 L22 20 L19 21 L19 18 L16 16 L19 14 L19 11 L22 12 Z M24 14 A2 2 0 1 0 24.1 14 Z',
  player: 'M17 16 L24 10 L31 16 L24 22 Z',
};
/** Stroke-only emblems (the rest are filled). */
const STROKED: ReadonlySet<PilotMark> = new Set(['snow', 'chip']);

export function pilotPortraitSvg(livery: ShipLivery, mark: PilotMark, size = 40): string {
  const shell = hex(livery.primary);
  const stripe = hex(livery.secondary);
  const visor = hex(livery.glow);
  const emblem = STROKED.has(mark)
    ? `<path d="${MARKS[mark]}" fill="none" stroke="${stripe}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${MARKS[mark]}" fill="${stripe}" fill-rule="evenodd"/>`;
  return (
    `<svg class="mz-portrait" width="${size}" height="${size}" viewBox="0 0 48 48" aria-hidden="true">` +
    `<rect x="1" y="1" width="46" height="46" rx="9" fill="rgba(8,6,26,0.9)" stroke="${visor}" stroke-opacity="0.6" stroke-width="1.5"/>` +
    `<path d="M8 40 C8 17 14 6 24 6 C34 6 40 17 40 40 Z" fill="${shell}"/>` +
    `<path d="M22 6.2 H26 V40 H22 Z" fill="${stripe}" opacity="0.55"/>` +
    `<path d="M11 26 C11 22 15 20 24 20 C33 20 37 22 37 26 L36 32 C33 34 15 34 12 32 Z" fill="#0b0820"/>` +
    `<path d="M13 26 C13 23 17 22 24 22 C31 22 35 23 35 26 L34.4 30 C31 31.5 17 31.5 13.6 30 Z" fill="${visor}" opacity="0.85"/>` +
    `<path d="M15 24.5 C18 23.4 22 23.2 26 23.4" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
    emblem +
    `</svg>`
  );
}

/** One racer as the grid intro card and the results show them. */
export interface RosterEntry {
  id: number;
  name: string;
  gridIndex: number;
  /** Chassis name (e.g. COMET). */
  ship: string;
  /** null for the player. */
  catchphrase: string | null;
  portrait: string;
}

export function rosterOf(field: readonly ShipDefinition[]): RosterEntry[] {
  return field.map((d) => {
    const pilot = d.isPlayer ? undefined : pilotById(d.pilotId);
    const chassis = d.loadout ? chassisById(d.loadout.chassisId).name : '';
    return {
      id: d.id,
      name: d.name,
      gridIndex: d.gridIndex,
      ship: chassis,
      catchphrase: pilot?.catchphrase ?? null,
      portrait: pilotPortraitSvg(d.livery, pilot?.mark ?? 'player'),
    };
  });
}
