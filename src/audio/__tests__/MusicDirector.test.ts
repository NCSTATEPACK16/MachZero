import { beforeEach, describe, expect, it } from 'vitest';
import { FADES, MusicDirector, type MusicInput } from '../MusicDirector';

const READY = new Set(['menu', 'neon-bay', 'orbital-ring', 'results']);

const base = (over: Partial<MusicInput> = {}): MusicInput => ({
  route: 'menu',
  overRace: false,
  worldId: 'neon-bay',
  race: 'title',
  intro: false,
  run: 0,
  playerLap: 0,
  playerFinished: false,
  resultsOpen: false,
  stinger: false,
  jukebox: null,
  ...over,
});

let d: MusicDirector;
beforeEach(() => {
  d = new MusicDirector((id) => READY.has(id));
});

/** Drive the director to a race on Neon Bay, past the grid card. */
function toRace(): void {
  d.update(base());
  d.update(base({ route: 'loading' }));
  d.update(base({ route: 'race', race: 'title', intro: true }));
  d.update(base({ route: 'race', race: 'countdown' }));
  d.update(base({ route: 'race', race: 'racing' }));
}

describe('MusicDirector: the scene changes of §E', () => {
  it('boot, first menu: the menu theme fades in over 1.5 s', () => {
    const c = d.update(base());
    expect(c).toMatchObject({ song: 'menu', fromIntro: true, lift: false, muffle: false, fadeIn: 1.5, fadeOut: 0 });
    expect(c.changed).toBe(true);
    expect(d.update(base()).changed).toBe(false);
  });

  it('a world selected: the menu keeps playing and the world’s song is prepared', () => {
    d.update(base({ worldId: 'neon-bay' }));
    const c = d.update(base({ worldId: 'orbital-ring' }));
    expect(c.song).toBe('menu');
    expect(c.changed).toBe(false);
    expect(c.prepare).toContain('orbital-ring');
  });

  it('RACE pressed (the loading screen): the menu theme fades out over 1.0 s', () => {
    d.update(base());
    expect(d.update(base({ route: 'loading' }))).toMatchObject({ song: null, fadeOut: 1.0, changed: true });
  });

  it('the grid card: the world song starts from its intro (fade-in 0.3 s), and the countdown keeps it', () => {
    d.update(base());
    d.update(base({ route: 'loading' }));
    const card = d.update(base({ route: 'race', race: 'title', intro: true }));
    expect(card).toMatchObject({ song: 'neon-bay', fromIntro: true, fadeIn: 0.3, lift: false, changed: true });
    expect(d.update(base({ route: 'race', race: 'countdown' })).changed).toBe(false);
  });

  it('no grid card: the countdown starts the world song from its intro', () => {
    d.update(base({ route: 'loading' }));
    expect(d.update(base({ route: 'race', race: 'countdown' }))).toMatchObject({ song: 'neon-bay', fromIntro: true, fadeIn: 0.3 });
  });

  it('the final lap: the lift comes in (same song, no restart), and the results theme is prepared', () => {
    toRace();
    const c = d.update(base({ route: 'race', race: 'racing', playerLap: 2 }));
    expect(c).toMatchObject({ song: 'neon-bay', lift: true, changed: true, fadeIn: 0, fadeOut: 0 });
    expect(c.restart).toBe(false);
    expect(c.prepare).toContain('results');
    expect(d.update(base({ route: 'race', race: 'racing', playerLap: 1 })).lift).toBe(false);
  });

  it('the player finishes: the song fades out over 1.5 s', () => {
    toRace();
    d.update(base({ route: 'race', race: 'racing', playerLap: 2 }));
    expect(d.update(base({ route: 'race', race: 'racing', playerLap: 3, playerFinished: true }))).toMatchObject({ song: null, fadeOut: 1.5 });
  });

  it('the results open: silence while the stinger plays, then the results theme fades in over 0.5 s', () => {
    toRace();
    d.update(base({ route: 'race', race: 'racing', playerFinished: true }));
    expect(d.update(base({ route: 'results', race: 'results', stinger: true })).song).toBeNull();
    expect(d.update(base({ route: 'results', race: 'results', stinger: false }))).toMatchObject({ song: 'results', fadeIn: 0.5, changed: true });
  });

  it('the HUD results panel (no-menu flows) plays the results flow too', () => {
    toRace();
    expect(d.update(base({ route: 'race', race: 'results', resultsOpen: true })).song).toBe('results');
  });

  it('results → RACE AGAIN: the results theme fades out over 0.5 s, then the world song starts again from its intro', () => {
    toRace();
    d.update(base({ route: 'results', race: 'results' }));
    expect(d.update(base({ route: 'loading', race: 'title' }))).toMatchObject({ song: null, fadeOut: 0.5 });
    expect(d.update(base({ route: 'race', race: 'title', intro: true, run: 1 }))).toMatchObject({ song: 'neon-bay', fromIntro: true, restart: true });
  });

  it('a restart from pause: the song fades out over 0.5 s and starts again from its intro', () => {
    toRace();
    d.update(base({ route: 'race', race: 'paused' }));
    const c = d.update(base({ route: 'race', race: 'countdown', run: 1 }));
    expect(c).toMatchObject({ song: 'neon-bay', fromIntro: true, restart: true, fadeOut: 0.5, fadeIn: 0.3, muffle: false, lift: false });
  });

  it('pause: the song keeps playing, muffled; resume unmuffles it', () => {
    toRace();
    expect(d.update(base({ route: 'race', race: 'paused' }))).toMatchObject({ song: 'neon-bay', muffle: true, restart: false, changed: true });
    expect(d.update(base({ route: 'settings', overRace: true, race: 'paused' }))).toMatchObject({ song: 'neon-bay', muffle: true, changed: false });
    expect(d.update(base({ route: 'race', race: 'racing' }))).toMatchObject({ song: 'neon-bay', muffle: false });
  });

  it('results or pause → the menus: a 1.0 s crossfade to the menu theme', () => {
    toRace();
    d.update(base({ route: 'race', race: 'paused' }));
    expect(d.update(base({ route: 'menu', race: 'title' }))).toMatchObject({ song: 'menu', fadeOut: 1.0, fadeIn: 1.0, muffle: false });
    const e = new MusicDirector((id) => READY.has(id));
    e.update(base({ route: 'results', race: 'results' }));
    expect(e.update(base({ route: 'tour', race: 'title' }))).toMatchObject({ song: 'menu', fadeOut: 1.0, fadeIn: 1.0 });
  });

  it('the cup standings: the results theme keeps playing (and from the menus, the menu theme)', () => {
    d.update(base({ route: 'results', race: 'results' }));
    expect(d.update(base({ route: 'cup', race: 'title' }))).toMatchObject({ song: 'results', changed: false });
    const e = new MusicDirector((id) => READY.has(id));
    e.update(base());
    expect(e.update(base({ route: 'cup' }))).toMatchObject({ song: 'menu', changed: false });
  });

  it('results → the menus prepares the menu theme', () => {
    d.update(base({ route: 'results', race: 'results' }));
    expect(d.update(base({ route: 'results', race: 'results' })).prepare).toContain('menu');
  });

  it('a song not written yet plays nothing (the 2.1 worlds before M6c)', () => {
    d.update(base({ route: 'loading', worldId: 'cinder-forge' }));
    expect(d.update(base({ route: 'race', race: 'countdown', worldId: 'cinder-forge' })).song).toBeNull();
  });

  it('SOUND TEST: a played song replaces the menu theme; leaving gives it back', () => {
    d.update(base({ route: 'settings' }));
    expect(d.update(base({ route: 'soundtest' })).song).toBe('menu');
    const play = d.update(base({ route: 'soundtest', jukebox: { id: 'orbital-ring', lift: false, fromIntro: true, seq: 1 } }));
    expect(play).toMatchObject({ song: 'orbital-ring', fromIntro: true, fadeIn: FADES.jukebox });
    expect(d.update(base({ route: 'soundtest', jukebox: { id: 'orbital-ring', lift: true, fromIntro: true, seq: 1 } }))).toMatchObject({ lift: true, restart: false });
    expect(d.update(base({ route: 'soundtest', jukebox: { id: 'orbital-ring', lift: true, fromIntro: false, seq: 2 } }))).toMatchObject({ fromIntro: false, restart: true });
    expect(d.update(base({ route: 'settings' }))).toMatchObject({ song: 'menu', fadeIn: FADES.jukebox });
  });

  it('the title screen of the no-menu flows plays the menu theme', () => {
    expect(d.update(base({ route: 'race', race: 'title' })).song).toBe('menu');
  });
});
