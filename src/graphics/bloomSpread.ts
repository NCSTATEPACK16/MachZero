/**
 * Keeps UnrealBloom's on-screen glow the same size at every bloom resolution.
 *
 * UnrealBloomPass blurs a 5-level mip chain with kernels fixed in texels, so the glow's spread on screen is
 * inversely proportional to the bloom buffer's width. Low's buffer (DPR cap 1 × render scale 0.75 × bloom
 * scale 0.5) is a quarter of Med's on a phone: every level is two octaves coarser and the halo washes over
 * the whole frame (H housekeeping, 2026-11). The fix keeps the cheap buffer and re-weights the levels instead:
 * at a shift of `s` octaves, level `i` stands in for the reference chain's level `i + s`, levels past the
 * reference chain fade out, and the reference's finest levels (which the small buffer can't show) fold into
 * level 0 so the total glow stays the same.
 */

/** UnrealBloomPass's bloomFactors (three r186). */
export const BLOOM_FACTORS: readonly number[] = [1.0, 0.8, 0.6, 0.4, 0.2];

/** The composite shader's per-level weight: mix(factor, 1.2 − factor, radius). */
export function bloomLevelWeight(factor: number, radius: number): number {
  return factor + (1.2 - 2 * factor) * radius;
}

/** Octaves the bloom buffer is coarser than the reference (0 when it is as fine or finer). */
export function bloomOctaveShift(bloomWidth: number, referenceWidth: number): number {
  if (bloomWidth <= 0 || referenceWidth <= 0) return 0;
  return Math.max(0, Math.log2(referenceWidth / bloomWidth));
}

/**
 * Per-level multipliers (for UnrealBloomPass.bloomTintColors) that make a chain `shift` octaves coarser
 * reproduce the reference chain's glow. All 1 at shift 0.
 */
export function bloomLevelTints(shift: number, radius: number, out: number[] = []): number[] {
  const n = BLOOM_FACTORS.length;
  const w = BLOOM_FACTORS.map((f) => bloomLevelWeight(f, radius));
  // The reference weight at a continuous level x: linear between levels, fading to 0 one level past the chain.
  const ref = (x: number): number => {
    if (x <= 0) return w[0];
    if (x >= n) return 0;
    const k = Math.floor(x);
    const t = x - k;
    return k >= n - 1 ? w[n - 1] * (1 - t) : w[k] * (1 - t) + w[k + 1] * t;
  };
  // Reference levels finer than the shifted chain's level 0: their glow folds into level 0.
  let folded = 0;
  for (let k = 0; k < n && k < shift; k++) folded += w[k] * Math.min(1, shift - k);
  for (let i = 0; i < n; i++) {
    const want = ref(i + shift) + (i === 0 ? folded : 0);
    out[i] = want / w[i];
  }
  out.length = n;
  return out;
}
