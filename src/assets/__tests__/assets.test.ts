/** Enforces scripts/check-assets.mjs in `npm test` (and so in CI, which never runs Blender). */
import { describe, expect, it } from 'vitest';

interface CheckResult {
  problems: string[];
  report: Record<string, number>;
}
type Checker = { checkAssets(root?: string): Promise<CheckResult> };

// Loaded by path so the (Node-only) script stays outside the browser tsconfig.
const load = (): Promise<Checker> => import(/* @vite-ignore */ `${'../../../scripts/check-assets.mjs'}`) as Promise<Checker>;

describe('game assets (public/game)', () => {
  it('ships and parts meet names, sockets, materials, orientation and budgets', async () => {
    const { problems, report } = await (await load()).checkAssets();
    expect(problems).toEqual([]);
    expect(Object.keys(report).length).toBe(6 * 2 + 16);
  });

  it('the checker reports missing assets', async () => {
    const { problems } = await (await load()).checkAssets('/nonexistent-machzero-root');
    expect(problems.some((p) => p.includes('ships/comet.glb'))).toBe(true);
    expect(problems.some((p) => p.includes('parts.glb'))).toBe(true);
  });
});
