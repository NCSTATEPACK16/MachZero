/**
 * The committed dev ghosts (`public/game/ghosts/<trackId>.bin`, baked by `npm run ghosts:bake`), fetched once
 * each and cached. A missing or bad file is simply no dev ghost.
 */
import { decodeGhost, type GhostData } from './ghostCodec';

const cache = new Map<string, Promise<GhostData | null>>();

export function loadDevGhost(trackId: string): Promise<GhostData | null> {
  let p = cache.get(trackId);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}game/ghosts/${trackId}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? decodeGhost(b) : null))
      .catch((e: unknown) => {
        console.warn(`MachZero: the dev ghost for ${trackId} failed to load.`, e);
        return null;
      });
    // A failure is not cached, so a later trial tries again.
    void p.then((g) => {
      if (!g) cache.delete(trackId);
    });
    cache.set(trackId, p);
  }
  return p;
}
