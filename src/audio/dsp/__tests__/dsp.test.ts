import { describe, expect, it } from 'vitest';
import { renderDrum } from '../drums';
import { Chorus, Delay, pumpGain, Reverb } from '../effects';
import { Envelope } from '../env';
import { Svf } from '../filter';
import { INSTRUMENT_IDS, INSTRUMENTS, renderNote, resolveInstrument } from '../instruments';
import { lufs, toDb, truePeak } from '../loudness';
import { Osc, rng } from '../osc';
import { bandEnergy, peakOf, powerSpectrum, rms } from './spectrum';

const SR = 44100;

function osc(wave: 'saw' | 'pulse' | 'tri' | 'sine', f: number, seconds: number): Float32Array {
  const o = new Osc(wave);
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = o.next(f / SR);
  return out;
}

function naiveSaw(f: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = 2 * ph - 1;
    ph += f / SR;
    if (ph >= 1) ph -= 1;
  }
  return out;
}

const sine = (f: number, seconds: number, amp = 1): Float32Array => {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / SR);
  return out;
};

describe('oscillators', () => {
  it('a 440 Hz saw has its fundamental at 440 Hz (falling zero crossings over 1 s, ±1 Hz)', () => {
    const x = osc('saw', 440, 1);
    let crossings = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] > 0 && x[i] <= 0) crossings++;
    expect(Math.abs(crossings - 440)).toBeLessThanOrEqual(1);
  });

  /**
   * Aliasing: §M6b asks for "energy above 15 kHz at least 20 dB lower than a naive saw" at 3 kHz. A 3 kHz saw also has
   * true harmonics at 15, 18 and 21 kHz, which any oscillator must keep, so this measures the aliases alone: the
   * energy above 15 kHz in the bins away from the harmonics.
   */
  it('a 3 kHz band-limited saw has at least 20 dB less alias energy above 15 kHz than a naive saw', () => {
    const blep = powerSpectrum(osc('saw', 3000, 0.5), 8192, 2048);
    const naive = powerSpectrum(naiveSaw(3000, 0.5), 8192, 2048);
    const aliases = (p: Float64Array) => {
      let e = 0;
      for (let i = Math.ceil((15000 * 8192) / SR); i < p.length; i++) {
        const f = (i * SR) / 8192;
        if (Math.abs(f - Math.round(f / 3000) * 3000) > 40) e += p[i];
      }
      return e;
    };
    expect(10 * Math.log10(aliases(naive) / aliases(blep))).toBeGreaterThan(20);
    // The harmonics themselves stay: the 5th (15 kHz) within 10 dB of the naive saw's.
    expect(10 * Math.log10(bandEnergy(naive, SR, 14950, 15050) / bandEnergy(blep, SR, 14950, 15050))).toBeLessThan(10);
  });

  it('pulse, triangle and sine stay within ±1.2 with no NaN', () => {
    for (const w of ['pulse', 'tri', 'sine'] as const) {
      const x = osc(w, 220, 0.5);
      expect(x.every(Number.isFinite), w).toBe(true);
      expect(peakOf(x), w).toBeLessThan(1.2);
      expect(rms(x), w).toBeGreaterThan(0.2);
    }
  });

  it('seeded noise repeats for the same seed', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(rng(8)()).not.toBe(rng(7)());
  });
});

describe('the state-variable filter', () => {
  const through = (f: number) => {
    const s = new Svf(SR).set(1000, 0);
    const x = sine(f, 0.5);
    const y = x.map((v) => s.process(v, 'lp'));
    return 20 * Math.log10(rms(y, SR / 4) / rms(x, SR / 4));
  };
  it('a 1 kHz low-pass passes 100 Hz within 0.5 dB', () => expect(Math.abs(through(100))).toBeLessThan(0.5));
  it('and cuts 10 kHz by more than 30 dB', () => expect(through(10000)).toBeLessThan(-30));
  it('high-pass and band-pass come from the same structure', () => {
    const s = new Svf(SR).set(1000, 0);
    const y = sine(100, 0.5).map((v) => s.process(v, 'hp'));
    expect(20 * Math.log10(rms(y, SR / 4) / rms(sine(100, 0.5), SR / 4))).toBeLessThan(-30);
  });
});

describe('the ADSR', () => {
  it('reaches its sustain level and ends at 0 after its release', () => {
    const gate = Math.round(0.5 * SR);
    const e = new Envelope({ a: 0.01, d: 0.1, s: 0.6, r: 0.2 }, gate, SR);
    const v: number[] = [];
    for (let i = 0; i < e.length; i++) v.push(e.at(i));
    expect(Math.max(...v)).toBeGreaterThan(0.98);
    expect(v[gate - 1]).toBeCloseTo(0.6, 2);
    expect(v[v.length - 1]).toBe(0);
    expect(e.length).toBe(gate + Math.round(0.2 * SR));
    // Never jumps: no step larger than the attack's.
    for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1])).toBeLessThan(0.01);
  });
});

describe('effects', () => {
  it('the delay repeats an impulse at the beat time with the feedback ratio', () => {
    const d = Math.round(0.25 * SR);
    const delay = new Delay(0.25, 0.5, 20000, SR);
    const n = d * 5;
    const input = new Float32Array(n);
    input[0] = 1;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    delay.process(input, l, r);
    // Each repeat's energy: the sum over a few samples (the loop's low-pass spreads an impulse over them).
    const at = (k: number) => {
      let s = 0;
      for (let i = k * d - 2; i < k * d + 30; i++) s += Math.abs(l[i]) + Math.abs(r[i]);
      return s;
    };
    expect(at(1)).toBeCloseTo(1, 2);
    expect(at(2) / at(1)).toBeCloseTo(0.5, 1);
    expect(at(3) / at(2)).toBeCloseTo(0.5, 1);
    expect(l[d]).toBeGreaterThan(0.9); // the first repeat on the left
    expect(r[2 * d]).toBeGreaterThan(0.4); // then the right
  });

  it('the reverb tail decays below −60 dB within 3 s at size 0.5', () => {
    const rev = new Reverb(0.5, 0.5, SR);
    const n = 4 * SR;
    const input = new Float32Array(n);
    input.fill(1, 0, 441); // a 10 ms burst
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    rev.process(input, l, r);
    const early = Math.max(peakOf(l.subarray(0, SR / 2)), peakOf(r.subarray(0, SR / 2)));
    const late = Math.max(peakOf(l.subarray(3 * SR)), peakOf(r.subarray(3 * SR)));
    expect(early).toBeGreaterThan(0.01);
    expect(20 * Math.log10(late / early)).toBeLessThan(-60);
  });

  it('the chorus keeps the level and differs between the sides', () => {
    const c = new Chorus(0.8, SR);
    const x = sine(440, 0.5);
    const l = new Float32Array(x.length);
    const r = new Float32Array(x.length);
    c.process(x, l, r, x.length, 0, 0.5, 1, 1);
    expect(rms(l, SR / 10)).toBeGreaterThan(0.3);
    expect(l.some((v, i) => Math.abs(v - r[i]) > 0.01)).toBe(true);
  });

  it('the pump drops on a hit and recovers over its release', () => {
    const hits = Float64Array.from([1, 2]);
    expect(pumpGain(hits, 0.5, 0.6, 0.2).gain).toBe(1);
    expect(pumpGain(hits, 1, 0.6, 0.2).gain).toBeCloseTo(0.4);
    expect(pumpGain(hits, 1.1, 0.6, 0.2).gain).toBeCloseTo(0.85);
    expect(pumpGain(hits, 1.3, 0.6, 0.2).gain).toBe(1);
    expect(pumpGain(hits, 2.0, 0.6, 0.2).gain).toBeCloseTo(0.4);
  });
});

describe('drums', () => {
  it('every drum hit is non-silent and ends within its length', () => {
    for (const id of INSTRUMENT_IDS.filter((i) => INSTRUMENTS[i].kind === 'drum')) {
      const p = INSTRUMENTS[id].params.drum!;
      const x = renderDrum(p, 1, SR, rng(1));
      expect(x.length, id).toBe(Math.round(p.length * SR));
      expect(peakOf(x), `${id} is silent`).toBeGreaterThan(0.05);
      expect(Math.abs(x[x.length - 1]), `${id} does not end`).toBeLessThan(1e-3);
    }
  });

  it('the same hit gives the same samples', () => {
    const p = INSTRUMENTS.hat.params.drum!;
    expect(renderDrum(p, 0.8, SR, rng(3))).toEqual(renderDrum(p, 0.8, SR, rng(3)));
  });
});

describe('instruments', () => {
  it('every instrument renders its lowest and highest notes with no NaN and no peak above 1', () => {
    for (const id of INSTRUMENT_IDS) {
      const def = INSTRUMENTS[id];
      const inst = resolveInstrument(id);
      for (const midi of def.range) {
        const x = renderNote(inst, midi, 1, Math.round(0.4 * SR), SR, rng(1));
        expect(x.every(Number.isFinite), `${id} ${midi} NaN`).toBe(true);
        expect(peakOf(x), `${id} ${midi} too loud`).toBeLessThanOrEqual(1);
        expect(peakOf(x), `${id} ${midi} silent`).toBeGreaterThan(0.01);
        expect(Math.abs(x[x.length - 1]), `${id} ${midi} does not end`).toBeLessThan(1e-3);
      }
    }
  });

  it('a note lasts its gate plus its release', () => {
    const inst = resolveInstrument('saw-lead');
    const x = renderNote(inst, 69, 0.8, 1000, SR, rng(1));
    expect(x.length).toBe(1000 + Math.round(inst.p.r * SR));
  });

  it('a track override replaces the instrument’s parameter', () => {
    expect(resolveInstrument('saw-pad', { cutoff: 500 }).p.cutoff).toBe(500);
    expect(resolveInstrument('kick', { drum: { kind: 'kick', tune: 60, decay: 0.2, length: 0.3 } }).p.drum!.tune).toBe(60);
  });
});

describe('loudness (BS.1770) and true peak', () => {
  it('a full-scale 997 Hz sine in one channel reads −3.01 LUFS; in both, 0 LUFS', () => {
    const x = sine(997, 5);
    expect(lufs([x], SR)).toBeCloseTo(-3.01, 1);
    expect(lufs([x, x], SR)).toBeCloseTo(0, 1);
  });

  it('a −20 dBFS sine reads −20 LUFS (stereo), and silence is gated out', () => {
    const x = sine(997, 5, 0.1);
    const withGap = new Float32Array(10 * SR);
    withGap.set(x);
    expect(lufs([x, x], SR)).toBeCloseTo(-20, 1);
    // The silence is gated out; the three 400 ms blocks that straddle the tone's end pass the relative gate (as
    // BS.1770 intends) and pull the result a little lower.
    expect(Math.abs(lufs([withGap, withGap], SR) + 20)).toBeLessThan(0.2);
    expect(lufs([new Float32Array(SR), new Float32Array(SR)], SR)).toBe(-Infinity);
  });

  it('true peak finds the peak between samples (a sine at fs/4, 45° out of phase)', () => {
    const x = new Float32Array(4096);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin((Math.PI / 2) * i + Math.PI / 4);
    expect(peakOf(x)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(toDb(truePeak([x]))).toBeGreaterThan(-0.5);
    expect(toDb(truePeak([x]))).toBeLessThan(0.3);
  });
});
