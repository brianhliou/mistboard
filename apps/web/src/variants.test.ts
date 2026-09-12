import {
  BANQI_SPEC_ID,
  canonicalVariantOrderIndex,
  DARK_CHESS_SPEC_ID,
  DARK_CRAZYHOUSE_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  gameSpecForId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  KRIEGSPIEL_SPEC_ID,
  REVEAL_CHESS_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import {
  enabledVariants,
  leaderboardVariants,
  profileRatingVariants,
  VARIANTS,
  variantMiniIdForGameSpec,
} from './variants.js';

describe('web variant launch registry', () => {
  it('lists VARIANTS in the shared canonical variant order', () => {
    // The leaderboard/profile grids render in VARIANTS order. Public entries
    // must match the shelf; unranked internal definitions remain at the tail.
    const order = VARIANTS.map((v) => v.gameSpecId);
    const canonical = [...order].sort(
      (a, b) => canonicalVariantOrderIndex(a) - canonicalVariantOrderIndex(b),
    );
    expect(order).toEqual(canonical);
  });

  it('uses shared game-spec labels for current dark chess formats', () => {
    expect(VARIANTS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'fog',
          gameSpecId: DARK_CHESS_SPEC_ID,
          label: gameSpecForId(DARK_CHESS_SPEC_ID).publicName,
        }),
        expect.objectContaining({
          id: 'fog_draft960',
          gameSpecId: DARK_DRAFT960_SPEC_ID,
          label: gameSpecForId(DARK_DRAFT960_SPEC_ID).publicName,
        }),
      ]),
    );
  });

  it('shows public leaderboard buckets for default public variants', async () => {
    // Pin prod semantics: dev auto-on would otherwise surface the soft-launch DMX bucket.
    vi.resetModules();
    vi.stubEnv('DEV', false);
    const prod = await import('./variants.js');
    // Only always-on rating surfaces remain in this flag-off production view,
    // filtered without changing their canonical shelf order.
    expect(prod.leaderboardVariants.map((v) => v.gameSpecId)).toEqual([
      FORTRESS_XIANGQI_SPEC_ID,
      DUCK_XIANGQI_SPEC_ID,
      DARK_CHESS_SPEC_ID,
      JUNGLE_SPEC_ID,
      JUNGLE_FLIP_SPEC_ID,
    ]);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('makes Dark Xiangqi rating-ready in dev and production-gated, never lobby-selectable, with a thumbnail', async () => {
    // In VARIANTS (so it has a picker mini-board + a rating bucket) but never
    // lobby-selectable (no open-seek), and on the rating surfaces only when its
    // flag is on in production — gated globally by MISTBOARD_RATED_ENABLED on the server.
    expect(VARIANTS.map((v) => v.gameSpecId)).toContain(DARK_XIANGQI_SPEC_ID);
    expect(enabledVariants.map((v) => v.gameSpecId)).not.toContain(DARK_XIANGQI_SPEC_ID);
    expect(variantMiniIdForGameSpec(DARK_XIANGQI_SPEC_ID)).toBe('dark-xiangqi');
    // Dev default: present on local rating surfaces.
    expect(leaderboardVariants.map((v) => v.gameSpecId)).toContain(DARK_XIANGQI_SPEC_ID);
    expect(profileRatingVariants.map((v) => v.gameSpecId)).toContain(DARK_XIANGQI_SPEC_ID);

    // Production flag off: hidden from rating surfaces.
    vi.resetModules();
    vi.stubEnv('DEV', false);
    const prod = await import('./variants.js');
    expect(prod.leaderboardVariants.map((v) => v.gameSpecId)).not.toContain(DARK_XIANGQI_SPEC_ID);
    expect(prod.profileRatingVariants.map((v) => v.gameSpecId)).not.toContain(DARK_XIANGQI_SPEC_ID);
    vi.unstubAllEnvs();
    vi.resetModules();

    // Production flag on: shown on leaderboard + profile, still not lobby-selectable.
    vi.resetModules();
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'true');
    const flagged = await import('./variants.js');
    expect(flagged.leaderboardVariants.map((v) => v.gameSpecId)).toContain(DARK_XIANGQI_SPEC_ID);
    expect(flagged.profileRatingVariants.map((v) => v.gameSpecId)).toContain(DARK_XIANGQI_SPEC_ID);
    expect(flagged.enabledVariants.map((v) => v.gameSpecId)).not.toContain(DARK_XIANGQI_SPEC_ID);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('shows only product-profile variants on default local rating surfaces', () => {
    // Public shelf order: xiangqi family, fog pair, then Jungle family.
    expect(leaderboardVariants.map((v) => v.gameSpecId)).toEqual([
      XIANGQI_SPEC_ID,
      BANQI_SPEC_ID,
      JIEQI_SPEC_ID,
      FORTRESS_XIANGQI_SPEC_ID,
      DUCK_XIANGQI_SPEC_ID,
      DARK_XIANGQI_SPEC_ID,
      DARK_CHESS_SPEC_ID,
      JUNGLE_SPEC_ID,
      JUNGLE_FLIP_SPEC_ID,
    ]);
    expect(profileRatingVariants.map((v) => v.gameSpecId)).toEqual([
      XIANGQI_SPEC_ID,
      BANQI_SPEC_ID,
      JIEQI_SPEC_ID,
      FORTRESS_XIANGQI_SPEC_ID,
      DUCK_XIANGQI_SPEC_ID,
      DARK_XIANGQI_SPEC_ID,
      DARK_CHESS_SPEC_ID,
      JUNGLE_SPEC_ID,
      JUNGLE_FLIP_SPEC_ID,
    ]);
  });

  it('keeps mini-board fallback ids for soft-launch play-menu variants', () => {
    expect(variantMiniIdForGameSpec(DARK_CRAZYHOUSE_SPEC_ID)).toBe('dark-crazyhouse');
    expect(variantMiniIdForGameSpec(KRIEGSPIEL_SPEC_ID)).toBe('kriegspiel');
  });

  it('maps the Jungle surfaces to their animal-rank markers', () => {
    expect(variantMiniIdForGameSpec(JUNGLE_SPEC_ID)).toBe('jungle');
    expect(variantMiniIdForGameSpec(JUNGLE_FLIP_SPEC_ID)).toBe('jungle-flip');
  });

  it('keeps casual Mini Xiangqi out of rating variant surfaces', () => {});

  it('uses canonical game-spec API params for current variants', () => {
    // Xiangqi pivot: VARIANTS follows the new CANONICAL_VARIANT_ORDER.
    expect(VARIANTS.map((v) => [v.gameSpecId, v.apiParam])).toEqual([
      [XIANGQI_SPEC_ID, 'xiangqi'],
      [BANQI_SPEC_ID, 'banqi'],
      [JIEQI_SPEC_ID, 'jieqi'],
      [FORTRESS_XIANGQI_SPEC_ID, 'fortress-xiangqi'],
      [DUCK_XIANGQI_SPEC_ID, 'duck-xiangqi'],
      [DARK_XIANGQI_SPEC_ID, 'dark-xiangqi'],
      [DARK_CHESS_SPEC_ID, 'fog'],
      [JUNGLE_SPEC_ID, 'jungle'],
      [JUNGLE_FLIP_SPEC_ID, 'jungle-flip'],
      [DARK_CRAZYHOUSE_SPEC_ID, 'dark-crazyhouse'],
      [KRIEGSPIEL_SPEC_ID, 'kriegspiel'],
      [REVEAL_CHESS_SPEC_ID, 'reveal-chess'],
      [DARK_DRAFT960_SPEC_ID, 'dark-draft960'],
    ]);
  });

  it('shows Jieqi + Banqi + Reveal Chess on rating surfaces behind their flags, never in the lobby', async () => {
    // Rating-ready: visible on leaderboard/profile when their variant flag is on
    // (gated globally by MISTBOARD_RATED_ENABLED on the server), but never
    // lobby-selectable — none has open-seek matchmaking.
    vi.resetModules();
    vi.stubEnv('VITE_JIEQI_ENABLED', 'true');
    vi.stubEnv('VITE_BANQI_ENABLED', 'true');
    vi.stubEnv('VITE_REVEAL_CHESS_ENABLED', 'true');
    const flagged = await import('./variants.js');

    for (const specId of [JIEQI_SPEC_ID, BANQI_SPEC_ID, REVEAL_CHESS_SPEC_ID]) {
      expect(flagged.leaderboardVariants.map((v) => v.gameSpecId)).toContain(specId);
      expect(flagged.profileRatingVariants.map((v) => v.gameSpecId)).toContain(specId);
      expect(flagged.enabledVariants.map((v) => v.gameSpecId)).not.toContain(specId);
    }

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps Jieqi + Banqi + Reveal Chess off the rating surfaces when their flags are off', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    const prod = await import('./variants.js');
    for (const specId of [JIEQI_SPEC_ID, BANQI_SPEC_ID, REVEAL_CHESS_SPEC_ID]) {
      expect(prod.leaderboardVariants.map((v) => v.gameSpecId)).not.toContain(specId);
      expect(prod.profileRatingVariants.map((v) => v.gameSpecId)).not.toContain(specId);
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps Dark Crazyhouse + Kriegspiel off production rating surfaces when their flags are off', async () => {
    vi.resetModules();
    vi.stubEnv('DEV', false);
    const prod = await import('./variants.js');
    for (const specId of [DARK_CRAZYHOUSE_SPEC_ID, KRIEGSPIEL_SPEC_ID]) {
      expect(prod.leaderboardVariants.map((v) => v.gameSpecId)).not.toContain(specId);
      expect(prod.profileRatingVariants.map((v) => v.gameSpecId)).not.toContain(specId);
    }
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
