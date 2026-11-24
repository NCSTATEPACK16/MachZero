/**
 * The music director (IMPLEMENTATION §M6b, decision E): which song should play, from where the player is. Pure: the
 * App polls it once per frame with the route and the race's state (the race's state is not a signal, it changes
 * inside the fixed step); it answers a cue, flagged `changed` when the music must do something. The MusicPlayer
 * applies cues.
 *
 * | Moment                                   | Music                                                        |
 * | Boot, first menu                         | the menu theme fades in over 1.5 s                           |
 * | A world selected                         | (its song is prepared)                                       |
 * | RACE pressed (loading)                   | the menu theme fades out over 1.0 s                          |
 * | The grid card, or the countdown          | the world song from its intro, fading in over 0.3 s          |
 * | The final lap                            | the lift (the player brings it in at the next bar line)      |
 * | The player finishes                      | the song fades out over 1.5 s                                |
 * | The results open                         | the stinger (M6c), then the results theme in over 0.5 s      |
 * | RACE AGAIN, or a restart                 | the song fades out over 0.5 s; the world song from its intro |
 * | Results or pause → the menus             | a 1.0 s crossfade to the menu theme                          |
 * | The cup standings                        | the results theme keeps playing                              |
 * | Pause                                    | the song plays on, muffled                                   |
 * Hiding and showing the page is the engine's (it suspends and resumes the context).
 */
import { CONFIG } from '../core/config';
import type { RaceState } from '../core/contracts';
import type { WorldId } from '../content/worlds';
import type { RouteName } from '../app/routes';
import type { MusicId } from './songs/format';

export const FADES = {
  bootIn: 1.5,
  loadingOut: 1.0,
  worldIn: 0.3,
  finishOut: 1.5,
  resultsIn: 0.5,
  restartOut: 0.5,
  crossfade: 1.0,
  jukebox: 0.15,
} as const;

export interface JukeboxPick {
  id: MusicId;
  lift: boolean;
  fromIntro: boolean;
  /** Bumped by every PLAY or JUMP TO LOOP, so the same song can start again. */
  seq: number;
}

export interface MusicInput {
  route: RouteName;
  /** Settings or SOUND TEST opened from the pause menu (the race waits under it). */
  overRace: boolean;
  worldId: WorldId | null;
  race: RaceState | null;
  /** The grid card is up. */
  intro: boolean;
  /** Bumped each time the race goes back to the grid (a restart). */
  run: number;
  /** Laps the player has completed. */
  playerLap: number;
  playerFinished: boolean;
  /** The HUD's results panel (the no-menu flows). */
  resultsOpen: boolean;
  /** A results stinger is playing (M6c). */
  stinger: boolean;
  /** SOUND TEST's song, or null. */
  jukebox: JukeboxPick | null;
}

export interface MusicCue {
  song: MusicId | null;
  /** One playing of a song: a new key with the same song restarts it. */
  key: string;
  fromIntro: boolean;
  lift: boolean;
  muffle: boolean;
  /** Seconds for the song before to fade out, and for this one to fade in (0 when nothing changed hands). */
  fadeOut: number;
  fadeIn: number;
  /** The song changed hands (or restarted). */
  restart: boolean;
  /** Anything differs from the cue before. */
  changed: boolean;
  /** Songs worth rendering now. */
  prepare: MusicId[];
}

interface Target {
  song: MusicId | null;
  key: string;
  fromIntro: boolean;
  lift: boolean;
  muffle: boolean;
  /** Why the song is null (the fade-out depends on it). */
  why: 'loading' | 'finish' | 'stinger' | 'none';
}

const NONE: Target = { song: null, key: '', fromIntro: false, lift: false, muffle: false, why: 'none' };

export class MusicDirector {
  private cue: MusicCue | null = null;
  private target: Target = NONE;
  private played = false;

  constructor(private readonly available: (id: MusicId) => boolean) {}

  get current(): MusicCue | null {
    return this.cue;
  }

  update(input: MusicInput): MusicCue {
    const next = this.decide(input);
    const prev = this.target;
    const restart = next.key !== prev.key;
    let fadeOut = 0;
    let fadeIn = 0;
    if (restart) {
      fadeOut = prev.song ? this.fadeOut(prev, next, input) : 0;
      fadeIn = next.song ? this.fadeIn(prev, next) : 0;
      if (next.song) this.played = true;
    }
    const changed = restart || next.lift !== prev.lift || next.muffle !== prev.muffle || this.cue === null;
    this.target = next;
    this.cue = { song: next.song, key: next.key, fromIntro: next.fromIntro, lift: next.lift, muffle: next.muffle, fadeOut, fadeIn, restart, changed, prepare: this.prepare(input, next) };
    return this.cue;
  }

  private ok(id: MusicId | null): MusicId | null {
    return id && this.available(id) ? id : null;
  }

  private decide(i: MusicInput): Target {
    const menu = (): Target => (this.ok('menu') ? { song: 'menu', key: 'menu', fromIntro: true, lift: false, muffle: false, why: 'none' } : NONE);
    const results = (): Target => (i.stinger ? { ...NONE, why: 'stinger' } : this.ok('results') ? { song: 'results', key: 'results', fromIntro: false, lift: false, muffle: false, why: 'none' } : NONE);

    if (i.route === 'soundtest' && i.jukebox) {
      const j = i.jukebox;
      return this.ok(j.id) ? { song: j.id, key: `jukebox:${j.id}#${j.seq}`, fromIntro: j.fromIntro, lift: j.lift, muffle: false, why: 'none' } : NONE;
    }
    const overRace = i.route === 'race' || (i.overRace && i.race === 'paused');
    if (overRace) {
      if (i.race === 'results' || i.resultsOpen) return results();
      if (i.race === 'title' && !i.intro) return menu();
      if (i.playerFinished) return { ...NONE, why: 'finish' };
      const song = i.worldId ? this.ok(i.worldId) : null;
      if (!song) return NONE;
      const racing = i.race === 'racing' || i.race === 'paused';
      return { song, key: `${song}#${i.run}`, fromIntro: true, lift: racing && i.playerLap >= CONFIG.TOTAL_LAPS - 1, muffle: i.race === 'paused', why: 'none' };
    }
    if (i.route === 'results') return results();
    if (i.route === 'cup' && this.target.song === 'results') return this.target;
    if (i.route === 'loading') return { ...NONE, why: 'loading' };
    return menu();
  }

  private fadeOut(prev: Target, next: Target, i: MusicInput): number {
    if (prev.key.startsWith('jukebox:') || next.key.startsWith('jukebox:')) return FADES.jukebox;
    if (next.song === 'menu') return FADES.crossfade;
    if (next.why === 'finish') return FADES.finishOut;
    if (prev.song === 'menu') return FADES.loadingOut;
    if (prev.song === 'results' || (next.song && prev.song === next.song)) return FADES.restartOut;
    return i.route === 'loading' ? FADES.loadingOut : FADES.restartOut;
  }

  private fadeIn(prev: Target, next: Target): number {
    if (next.key.startsWith('jukebox:') || prev.key.startsWith('jukebox:')) return FADES.jukebox;
    if (next.song === 'menu') return prev.song ? FADES.crossfade : FADES.bootIn;
    if (next.song === 'results') return FADES.resultsIn;
    return FADES.worldIn;
  }

  private prepare(i: MusicInput, t: Target): MusicId[] {
    const out: MusicId[] = [];
    const add = (id: MusicId | null) => {
      if (id && this.available(id) && !out.includes(id) && id !== t.song) out.push(id);
    };
    // The backdrop's world in the menus; the results theme from the final lap; the menu theme from the results.
    if (i.route !== 'race' && i.route !== 'results' && i.worldId) add(i.worldId);
    if (i.route === 'loading' && i.worldId) add(i.worldId);
    if (t.lift || i.playerFinished) add('results');
    if (i.route === 'results' || i.race === 'results' || i.route === 'cup') add('menu');
    if (!this.played) add('menu');
    return out;
  }
}
