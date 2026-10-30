/**
 * Random pilot callsigns, so a profile can be named with a gamepad alone (no on-screen keyboard needed).
 * Each fits PROFILE_NAME_MAX and survives cleanName unchanged.
 */
export const CALLSIGNS: readonly string[] = [
  'NOVA', 'VIPER', 'COMET', 'RAZOR', 'NEON', 'BLAZE', 'ORBIT', 'PULSE', 'ZENITH', 'QUASAR',
  'FALCON', 'STRIKER', 'VOLT', 'HALO', 'MIRAGE', 'TURBO', 'ECLIPSE', 'RAPTOR', 'SPECTRE', 'AURORA',
  'JET', 'FLARE', 'GHOST', 'STORM', 'APEX', 'NEBULA', 'SONIC', 'PHANTOM', 'BOLT', 'CHROME',
];

/** A callsign plus a two-digit number (e.g. "VIPER-27"), different from `avoid` when possible. */
export function randomCallsign(rand: () => number = Math.random, avoid = ''): string {
  for (let tries = 0; tries < 4; tries++) {
    const name = `${CALLSIGNS[Math.floor(rand() * CALLSIGNS.length) % CALLSIGNS.length]}-${10 + (Math.floor(rand() * 90) % 90)}`;
    if (name !== avoid) return name;
  }
  return avoid === 'PILOT' ? 'NOVA-01' : 'PILOT';
}
