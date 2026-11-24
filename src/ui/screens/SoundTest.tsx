/**
 * SOUND TEST (IMPLEMENTATION §M6a step 10, with `music`): every sound of §M6.2 with a PLAY button, grouped RACE,
 * HAZARDS and MENUS, and the preset render's time and size. M6b adds the songs. `?jukebox=1` opens it once a profile is
 * active. Before the audio context runs (no input yet) it asks for a tap.
 */
import { useEffect, useState } from 'preact/hooks';
import type { App } from '../../app/App';
import type { AudioDebug } from '../../audio/AudioSystem';
import { SOUND_GROUPS, isPreset, type SoundId } from '../../audio/soundTable';
import { Screen } from '../components';

export function SoundTest({ app }: { app: App }) {
  const [info, setInfo] = useState<AudioDebug>(() => app.audio.debug());
  useEffect(() => {
    const id = setInterval(() => setInfo(app.audio.debug()), 400);
    return () => clearInterval(id);
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
