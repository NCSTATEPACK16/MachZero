/** The CPU difficulty picker (SPEC §2: the AI dial), on the world map and the Grand Prix screen. */
import type { App } from '../../app/App';
import { TIER_OPTIONS, TIERS } from '../../content/tiers';
import { Segmented } from '../components';

/** The CPU difficulty for the next race, saved to the profile. */
export function TierPicker({ app }: { app: App }) {
  const p = app.activeProfile.value;
  if (!p) return null;
  return (
    <div class="mzu-section mzu-tier">
      <Segmented label="CPU DIFFICULTY" options={TIER_OPTIONS} value={p.aiTier} onChange={(v) => app.setAiTier(v)} />
      <p class="mzu-note">{TIERS[p.aiTier].hint}</p>
    </div>
  );
}
