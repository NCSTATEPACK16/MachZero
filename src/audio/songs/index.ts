/**
 * The song registry (IMPLEMENTATION §M6.4): every written song and stinger by id. Imported only by the render Worker
 * and the main-thread render fallback (a lazy chunk), never by the page itself.
 */
import type { MusicId, SongDef } from './format';

export const SONGS: Partial<Record<MusicId, SongDef>> = {};
