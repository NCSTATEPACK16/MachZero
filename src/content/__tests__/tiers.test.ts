import { describe, expect, it } from 'vitest';
import { PROFILES, tunedProfile } from '../../game/AIDriver';
import { buildRaceField, defaultLoadout, RIVAL_FITS } from '../pilots';
import { TIER_OPTIONS, TIER_ORDER, TIERS } from '../tiers';
import { pilotPortraitSvg, rosterOf } from '../../game/pilotPortrait';

describe('AI tiers', () => {
  it('rank in order: pace, catch-up, mistakes, shortcuts and drafting rise from Rookie to Legend', () => {
    for (let i = 1; i < TIER_ORDER.length; i++) {
      const lo = TIERS[TIER_ORDER[i - 1]];
      const hi = TIERS[TIER_ORDER[i]];
      expect(hi.paceScale).toBeGreaterThan(lo.paceScale);
      expect(hi.mistakeRate).toBeLessThanOrEqual(lo.mistakeRate);
      expect(hi.lineInset).toBeLessThanOrEqual(lo.lineInset);
      expect(hi.shortcutOdds).toBeGreaterThanOrEqual(lo.shortcutOdds);
      expect(hi.draftSeeking).toBeGreaterThanOrEqual(lo.draftSeeking);
      expect(hi.aggression).toBeGreaterThanOrEqual(lo.aggression);
    }
    expect(TIER_OPTIONS.map((o) => o.label)).toEqual(['ROOKIE', 'PILOT', 'ACE', 'LEGEND']);
  });

  it('keeps Rookie at the pace the user playtested (0.90) with no catch-up, never rams, never shortcuts or drafts', () => {
    const r = TIERS.rookie;
    expect(r.paceScale).toBeGreaterThanOrEqual(0.9);
    expect(r.paceScale * r.rubberBand.max).toBeLessThan(1);
    expect(r.aggression).toBe(0);
    expect(r.shortcutOdds).toBe(0);
    expect(r.draftSeeking).toBe(0);
  });

  it('Legend drives the v1 personality profiles unchanged; only Ace and Legend hunt drafts', () => {
    for (const p of ['aggressive', 'steady', 'erratic'] as const) {
      const t = tunedProfile(p, 'legend');
      expect(t.latBudget).toBe(PROFILES[p].latBudget);
      expect(t.brakeDecel).toBe(PROFILES[p].brakeDecel);
      expect(t.pitEnergy).toBe(PROFILES[p].pitEnergy);
      expect(tunedProfile(p, 'rookie').boostCooldown).toBeGreaterThan(PROFILES[p].boostCooldown);
    }
    expect(TIER_ORDER.filter((t) => TIERS[t].draftSeeking > 0)).toEqual(['ace', 'legend']);
  });

  it('builds a mixed field: each rival with its own tier and fits', () => {
    const field = buildRaceField({ playerName: 'P', playerLoadout: defaultLoadout(), tier: 'pilot', rivalTiers: ['legend', 'rookie'] });
    expect(field[1].tier).toBe('legend');
    expect(field[1].loadout!.parts).toEqual(RIVAL_FITS.legend);
    expect(field[2].tier).toBe('rookie');
    expect(field[2].loadout!.parts).toEqual(RIVAL_FITS.rookie);
    expect(field[3].tier).toBe('pilot'); // the rest race at the race's tier
    expect(field[0].tier).toBe('pilot');
  });
});

describe('pilot portraits', () => {
  it('draw each pilot in its livery with its own emblem, and the player with theirs', () => {
    const field = buildRaceField({ playerName: 'ME', playerLoadout: defaultLoadout(), tier: 'rookie' });
    const roster = rosterOf(field);
    expect(roster).toHaveLength(8);
    expect(new Set(roster.map((r) => r.portrait)).size).toBe(8);
    const ziggy = roster.find((r) => r.name === 'CAPTAIN ZIGGY')!;
    expect(ziggy.portrait).toContain('#1fb5ff');
    expect(ziggy.ship).toBe('COMET');
    expect(ziggy.catchphrase).toBe('Smooth is fast, cadet.');
    expect(roster[0].catchphrase).toBeNull();
    expect(pilotPortraitSvg({ primary: 0x000001, secondary: 0xabcdef, glow: 0xff0000 }, 'gear')).toMatch(/^<svg[^>]*viewBox="0 0 48 48".*#000001.*<\/svg>$/);
  });
});
