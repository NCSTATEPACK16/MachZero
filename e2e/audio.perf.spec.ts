import { expect, test } from '@playwright/test';

/**
 * The audio-thread proxy of IMPLEMENTATION §M6.5: 30 s of the race graph rendered in an OfflineAudioContext, timed
 * against real time. The graph: a looping song (stereo, 30 s) and its lift through the song chain (duck gain,
 * low-pass, EQ dip); v1's engine (three oscillators, a low-pass); two rival engines (a saw and a square, a low-pass,
 * a StereoPanner each); an ambience loop and a crowd loop; 12 one-shots a second, each built as it plays and let go
 * as it ends (as the SFX bank does); the master's compressor, limiter and soft clip. The engine voices, ambience and crowd are M6d's; here they are stand-ins of the planned shape.
 * The ratio is printed for the PR; the test fails only above 10% (it catches a blow-up, not a device number).
 */
test('the race graph renders 30 s offline at under 10% of real time', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?features=music');
  const r = await page.evaluate(async () => {
    const SR = 44100;
    const SECONDS = 30;
    const ac = new OfflineAudioContext(2, SR * SECONDS, SR);
    const noise = (seconds: number, channels: number) => {
      const b = ac.createBuffer(channels, Math.round(seconds * SR), SR);
      for (let c = 0; c < channels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.2;
      }
      return b;
    };
    // The master: compressor → limiter → soft clip.
    const comp = ac.createDynamicsCompressor();
    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.ratio.value = 20;
    const clip = ac.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) curve[i] = 0.708 * Math.tanh((i / 1023.5 - 1) / 0.708);
    clip.curve = curve;
    clip.oversample = '2x';
    const master = ac.createGain();
    master.connect(comp).connect(limiter).connect(clip).connect(ac.destination);
    // The song chain on the music bus.
    const duck = ac.createGain();
    const lp = ac.createBiquadFilter();
    const eq = ac.createBiquadFilter();
    eq.type = 'peaking';
    eq.frequency.value = 1500;
    eq.gain.value = -4;
    const music = ac.createGain();
    music.gain.value = 0.35;
    duck.connect(lp).connect(eq).connect(music).connect(master);
    const song = ac.createGain();
    song.connect(duck);
    for (const ch of [2, 1]) {
      const s = ac.createBufferSource();
      s.buffer = noise(SECONDS, ch);
      s.loop = true;
      s.connect(song);
      s.start(0);
    }
    // The player's engine.
    const sfx = ac.createGain();
    sfx.connect(master);
    const engineLp = ac.createBiquadFilter();
    const engineGain = ac.createGain();
    engineGain.gain.value = 0.1;
    engineLp.connect(engineGain).connect(sfx);
    for (const [type, f] of [['sawtooth', 120], ['sawtooth', 121], ['square', 60]] as const) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(engineLp);
      o.start(0);
    }
    // Two rival engines, panned.
    for (let k = 0; k < 2; k++) {
      const filt = ac.createBiquadFilter();
      const g = ac.createGain();
      g.gain.value = 0.05;
      const pan = ac.createStereoPanner();
      pan.pan.value = k ? 0.5 : -0.5;
      filt.connect(g).connect(pan).connect(sfx);
      for (const type of ['sawtooth', 'square'] as const) {
        const o = ac.createOscillator();
        o.type = type;
        o.frequency.value = 100 + k * 13;
        o.connect(filt);
        o.start(0);
      }
    }
    // Ambience and crowd loops.
    const amb = ac.createGain();
    amb.gain.value = 0.3;
    amb.connect(master);
    for (const seconds of [10, 8]) {
      const s = ac.createBufferSource();
      s.buffer = noise(seconds, 1);
      s.loop = true;
      s.connect(amb);
      s.start(0);
    }
    // 12 one-shots a second: buffer sources through a gain and a panner, as the SFX bank plays presets. As in the game,
    // each is built when it plays and disconnected when it ends (the render suspends at each start to build it):
    // building all 360 up front keeps every one alive in the graph for the whole render, which is not the game's cost.
    const shot = noise(0.4, 1);
    const STEP = 1 / 12;
    const play = (t: number) => {
      const s = ac.createBufferSource();
      s.buffer = shot;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      const p = ac.createStereoPanner();
      p.pan.value = Math.sin(t);
      s.connect(g).connect(p).connect(sfx);
      s.onended = () => {
        s.disconnect();
        g.disconnect();
        p.disconnect();
      };
      s.start(t);
    };
    for (let k = 1; k * STEP < SECONDS; k++) {
      const t = k * STEP;
      void ac.suspend(t).then(() => {
        play(ac.currentTime);
        void ac.resume();
      });
    }
    play(0);
    const t0 = performance.now();
    await ac.startRendering();
    const ms = performance.now() - t0;
    return { ms, ratio: ms / (SECONDS * 1000) };
  });
  console.log(`[audio perf] 30 s of the race graph rendered in ${r.ms.toFixed(0)} ms: ${(r.ratio * 100).toFixed(2)}% of real time`);
  expect(r.ratio).toBeLessThan(0.1);
});
