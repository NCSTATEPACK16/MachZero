/**
 * SOUND TEST (IMPLEMENTATION §M6a step 10, §M6b step 9, with `music`): the SONGS (PLAY, STOP, LIFT, JUMP TO LOOP,
 * with each song's tempo, key, length, render time, size and loudness once rendered), the STINGERS (M6c; listed,
 * not playable yet), and every sound of §M6.2 with a PLAY button, grouped RACE, HAZARDS and MENUS. Playing a song
 * replaces the menu theme; leaving gives it back. `?jukebox=1` opens it once a profile is active. Before the audio
 * context runs (no input yet) it asks for a tap.
 */
import { useEffect, useState } from 'preact/hooks';
import { CATALOG, type CatalogEntry } from '../../audio/songs/catalog';
import type { App } from '../../app/App';
import type { AudioDebug } from '../../audio/AudioSystem';
import { SOUND_GROUPS, isPreset, type SoundId } from '../../audio/soundTable';
import { Screen } from '../components';

export function SoundTest({ app }: { app: App }) {
  const [info, setInfo] = useState<AudioDebug>(() => app.audio.debug());
  useEffect(() => {
    const id = setInterval(() => setInfo(app.audio.debug()), 400);
    return () => {
      clearInterval(id);
      // Leaving SOUND TEST gives the menu theme back.
      app.audio.jukebox('stop');
    };
  }, []);
  const running = info.state === 'running';
  const play = (id: SoundId) => {
    app.audio.test(id);
    setInfo(app.audio.debug());
  };
  const rendered = info.presetsMs !== null;
  return (
    <Screen id="soundtest" title="SOUND TEST" kicker="EVERY SOUND IN THE GAME" onBack={() => app.closeSoundTest()} backLabel="SETTINGS" wide>
      {running ? null : (
        <button type="button" class="mzu-chip go mzu-sound-start" onClick={() => app.audio.engine.unlock()}>
          TAP TO START SOUND
        </button>
      )}
      <p class="mzu-note dim" data-presets>
        {rendered
          ? `Effects rendered in ${Math.round(info.presetsMs ?? 0)} ms (${info.presetsBy === 'worker' ? 'background' : 'main thread'}), ${(info.bufferBytes / 1048576).toFixed(2)} MB.`
          : 'Rendering effects…'}
      </p>
      <section class="mzu-section mzu-sound-group" aria-label="SONGS">
        <h2 class="mzu-subhead">SONGS</h2>
        <ul class="mzu-sound-list mzu-song-list">
          {CATALOG.filter((e) => e.kind !== 'stinger').map((e) => (
            <SongRow app={app} entry={e} info={info} onChange={() => setInfo(app.audio.debug())} />
          ))}
        </ul>
      </section>
      <section class="mzu-section mzu-sound-group" aria-label="STINGERS">
        <h2 class="mzu-subhead">STINGERS</h2>
        <ul class="mzu-sound-list">
          {CATALOG.filter((e) => e.kind === 'stinger').map((e) => (
            <li class="mzu-sound" data-stinger={e.id}>
              <span class="mzu-sound-name">{e.title}</span>
              <button type="button" class="mzu-chip" aria-label={`Play ${e.title}`} disabled>
                M6c
              </button>
            </li>
          ))}
        </ul>
      </section>
      {SOUND_GROUPS.map((g) => (
        <section class="mzu-section mzu-sound-group" aria-label={g.title}>
          <h2 class="mzu-subhead">{g.title}</h2>
          <ul class="mzu-sound-list">
            {g.sounds.map((s) => (
              <li class="mzu-sound" data-sound={s.id}>
                <span class="mzu-sound-name">{s.name}</span>
                <button type="button" class="mzu-chip" aria-label={`Play ${s.name}`} disabled={isPreset(s.id) && !rendered} onClick={() => play(s.id)}>
                  PLAY
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** One song: its numbers, and PLAY, STOP, LIFT and JUMP TO LOOP. */
function SongRow({ app, entry, info, onChange }: { app: App; entry: CatalogEntry; info: AudioDebug; onChange: () => void }) {
  const pick = app.audio.jukeboxSong;
  const mine = pick?.id === entry.id;
  const playing = mine && info.song === entry.id;
  const stats = app.audio.songStats(entry.id);
  const run = (cmd: Parameters<App['audio']['jukebox']>[0]) => {
    app.audio.jukebox(cmd);
    onChange();
  };
  const world = entry.kind === 'world';
  const facts = [`${entry.bpm} BPM`, entry.key];
  if (stats) facts.push(mmss(stats.seconds), `rendered in ${(stats.renderMs / 1000).toFixed(1)} s`, `${(stats.bytes / 1048576).toFixed(1)} MB`, `${stats.lufs.toFixed(1)} LUFS`);
  return (
    <li class="mzu-sound mzu-song" data-song={entry.id} data-playing={playing ? '' : undefined}>
      <span class="mzu-song-text">
        <span class="mzu-sound-name">{entry.title}</span>
        <span class="mzu-note dim">{entry.ready ? (mine && !playing ? `${facts.join(' · ')} · rendering…` : facts.join(' · ')) : 'arrives in M6c'}</span>
      </span>
      <span class="mzu-song-buttons">
        <button type="button" class="mzu-chip" data-action="play" aria-label={`Play ${entry.title}`} disabled={!entry.ready} onClick={() => run({ play: entry.id })}>
          PLAY
        </button>
        <button type="button" class="mzu-chip" data-action="stop" aria-label={`Stop ${entry.title}`} disabled={!mine} onClick={() => run('stop')}>
          STOP
        </button>
        {world ? (
          <button type="button" class={`mzu-chip${mine && pick?.lift ? ' go' : ''}`} data-action="lift" aria-pressed={mine && !!pick?.lift} aria-label={`Lift ${mine && pick?.lift ? 'off' : 'on'}`} disabled={!mine} onClick={() => run({ lift: !pick?.lift })}>
            LIFT {mine && pick?.lift ? 'ON' : 'OFF'}
          </button>
        ) : null}
        <button type="button" class="mzu-chip" data-action="loop" aria-label={`Jump to the loop of ${entry.title}`} disabled={!entry.ready} onClick={() => run({ play: entry.id, fromIntro: false })}>
          JUMP TO LOOP
        </button>
      </span>
    </li>
  );
}
