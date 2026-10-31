/**
 * Native haptics in the iOS app (Capacitor): taps for the player's boost, wall and ship hits, landings and
 * gate hits, a heavy thump for a KO. Does nothing in a browser. Fires at most one impact per 60 ms so a
 * scrape along a rail does not buzz continuously.
 */
import { Capacitor } from '@capacitor/core';
import type { ShipId } from '../core/contracts';
import type { GameBus } from '../core/events';

type Impact = 'light' | 'medium' | 'heavy';
type Fire = (style: Impact) => void;

let firePromise: Promise<Fire | null> | null = null;

/** Lazily load the plugin (only in the app, so the web bundle never pulls it in eagerly). */
function loadFire(): Promise<Fire | null> {
  firePromise ??= Capacitor.isNativePlatform()
    ? import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => {
        const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy } as const;
        return (style: Impact) => void Haptics.impact({ style: map[style] }).catch(() => undefined);
      })
    : Promise.resolve(null);
  return firePromise;
}

export const MIN_GAP_MS = 60;

/** Map one race's events for `playerId` to impacts; `fire` is injectable for tests. Returns an unsubscribe. */
export function bindHaptics(bus: GameBus, playerId: ShipId, fire?: Fire, now: () => number = () => performance.now()): () => void {
  let impl: Fire | null = fire ?? null;
  if (!fire) void loadFire().then((f) => (impl = f));
  let last = -Infinity;
  const tap = (style: Impact, force = false) => {
    const t = now();
    if (!impl || (!force && t - last < MIN_GAP_MS)) return;
    last = t;
    impl(style);
  };
  const offs = [
    bus.on('ship:boost', ({ shipId }) => shipId === playerId && tap('medium')),
    bus.on('ship:railHit', ({ shipId, intensity }) => shipId === playerId && intensity > 0.25 && tap(intensity > 0.7 ? 'heavy' : 'light')),
    bus.on('ship:shipHit', ({ a, b, intensity }) => (a === playerId || b === playerId) && intensity > 0.2 && tap(intensity > 0.7 ? 'medium' : 'light')),
    bus.on('ship:land', ({ shipId, intensity }) => shipId === playerId && intensity > 0.3 && tap('light')),
    bus.on('hazard:gate', ({ shipId }) => shipId === playerId && tap('heavy')),
    bus.on('ship:destroyed', ({ shipId }) => shipId === playerId && tap('heavy', true)),
  ];
  return () => {
    for (const off of offs) off();
  };
}

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
