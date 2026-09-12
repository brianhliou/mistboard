// Client-side launch registry — single source of truth for which current game
// specs are selectable in the lobby and shown on public rating surfaces
// (leaderboard + profile grid). Turning a game spec on/off is a one-line edit
// here instead of hunting hardcoded lists across the UI.
//
// Note: this is the CLIENT registry. A variant that introduces a new server
// rating pool also needs the server-side pool added (the `rated` spec flag +
// a user_ratings CHECK migration) as part of that variant's integration — the
// client registry doesn't substitute for that, it just centralizes the UI surface.

import {
  BANQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  DARK_CRAZYHOUSE_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  DARK_MINI_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  type GameSpecId,
  gameSpecForId,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  KRIEGSPIEL_SPEC_ID,
  MINI_XIANGQI_SPEC_ID,
  maybeGameSpecForId,
  type RatingVariant,
  REVEAL_CHESS_SPEC_ID,
  ratingPoolForSpec,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import {
  banqiEnabled,
  darkCrazyhouseEnabled,
  darkMiniXiangqiEnabled,
  darkXiangqiEnabled,
  duckXiangqiEnabled,
  fortressXiangqiEnabled,
  jieqiEnabled,
  jungleEnabled,
  jungleFlipEnabled,
  kriegspielEnabled,
  revealChessEnabled,
  xiangqiEnabled,
} from './feature-flags.js';
import type { VariantMiniId } from './variant-mini-boards.js';

// The rated-pool union lives on the game spec now (single source of truth). Kept
// as a local alias so existing call sites keep the `RatingVariantId` name.
export type RatingVariantId = RatingVariant;

export interface VariantDef {
  id: RatingVariantId;
  gameSpecId: GameSpecId;
  /** `?variant=` value the leaderboard API expects. */
  apiParam: string;
  label: string;
  /** Selectable in the lobby variant picker. */
  enabled: boolean;
  /** Shown on the public leaderboard + profile rating grid. */
  onLeaderboard: boolean;
  /** Shown on subject-scoped profile rating grids. */
  onProfile: boolean;
  /** Which mini-board (renderVariantMiniBoard) represents this variant in the UI. */
  miniId: VariantMiniId;
}

const draft960Enabled = import.meta.env.VITE_DRAFT960_ENABLED === 'true';
// Dark Mini Xiangqi retired 2026-07-03 (project_xiangqi_pivot_track): gated by the
// single VITE_DARK_MINI_XIANGQI_ENABLED flag (now off in prod). The former
// two-tier public-entry flag was removed as dead complexity.
const darkMiniEnabled = darkMiniXiangqiEnabled();
const fortressXiangqiOn = fortressXiangqiEnabled();
const duckXiangqiOn = duckXiangqiEnabled();
const xiangqiOn = xiangqiEnabled();
const jieqiOn = jieqiEnabled();
const banqiOn = banqiEnabled();
const jungleOn = jungleEnabled();
const jungleFlipOn = jungleFlipEnabled();
const revealChessOn = revealChessEnabled();
const darkXiangqiOn = darkXiangqiEnabled();
const darkCrazyhouseOn = darkCrazyhouseEnabled();
const kriegspielOn = kriegspielEnabled();
const darkChessSpec = gameSpecForId(DARK_CHESS_SPEC_ID);
const draft960Spec = gameSpecForId(DARK_DRAFT960_SPEC_ID);
const darkMiniXiangqiSpec = gameSpecForId(DARK_MINI_XIANGQI_SPEC_ID);
const fortressXiangqiSpec = gameSpecForId(FORTRESS_XIANGQI_SPEC_ID);
const duckXiangqiSpec = gameSpecForId(DUCK_XIANGQI_SPEC_ID);
const xiangqiSpec = gameSpecForId(XIANGQI_SPEC_ID);
const darkXiangqiSpec = gameSpecForId(DARK_XIANGQI_SPEC_ID);
const darkCrazyhouseSpec = gameSpecForId(DARK_CRAZYHOUSE_SPEC_ID);
const kriegspielSpec = gameSpecForId(KRIEGSPIEL_SPEC_ID);
const jieqiSpec = gameSpecForId(JIEQI_SPEC_ID);
const banqiSpec = gameSpecForId(BANQI_SPEC_ID);
const revealChessSpec = gameSpecForId(REVEAL_CHESS_SPEC_ID);
const jungleSpec = gameSpecForId(JUNGLE_SPEC_ID);
const jungleFlipSpec = gameSpecForId(JUNGLE_FLIP_SPEC_ID);

// Marker coverage is broader than the rated/current variant registry: the play
// picker can surface casual tenants, and rules/articles can reference variants
// that are not leaderboard rows.
const VARIANT_MINI_BY_GAME_SPEC: Partial<Record<GameSpecId, VariantMiniId>> = {
  [DARK_CHESS_SPEC_ID]: 'dark-chess',
  [DARK_DRAFT960_SPEC_ID]: 'draft960',
  [MINI_XIANGQI_SPEC_ID]: 'mini-xiangqi',
  [DARK_MINI_XIANGQI_SPEC_ID]: 'dark-mini-xiangqi',
  [FORTRESS_XIANGQI_SPEC_ID]: 'fortress-xiangqi',
  [DUCK_XIANGQI_SPEC_ID]: 'duck-xiangqi',
  [XIANGQI_SPEC_ID]: 'xiangqi',
  [DARK_XIANGQI_SPEC_ID]: 'dark-xiangqi',
  [JIEQI_SPEC_ID]: 'jieqi',
  [BANQI_SPEC_ID]: 'banqi',
  [REVEAL_CHESS_SPEC_ID]: 'reveal-chess',
  [DARK_CRAZYHOUSE_SPEC_ID]: 'dark-crazyhouse',
  [KRIEGSPIEL_SPEC_ID]: 'kriegspiel',
  [JUNGLE_SPEC_ID]: 'jungle',
  [JUNGLE_FLIP_SPEC_ID]: 'jungle-flip',
};

// Public variants lead in the shared CANONICAL_VARIANT_ORDER (packages/game);
// internal and retired definitions remain afterward for flags and deep links.
// variants.test.ts asserts this array is already sorted by
// canonicalVariantOrderIndex.
export const VARIANTS: VariantDef[] = [
  // Standard Xiangqi (9x10 open info): the pivot anchor. Launched 2026-07-04:
  // on the rating grids + News rail, account-gated rated like Fortress/jieqi/banqi
  // (rated games activate with the global MISTBOARD_RATED_ENABLED flip). PvE via
  // Pikafish, PvP via friend links.
  {
    id: currentRatingVariantForSpec(XIANGQI_SPEC_ID),
    gameSpecId: xiangqiSpec.id,
    apiParam: XIANGQI_SPEC_ID,
    label: xiangqiSpec.publicName,
    miniId: 'xiangqi',
    enabled: false,
    onLeaderboard: xiangqiOn,
    onProfile: xiangqiOn,
  },
  // Banqi is the established half-board flip member of the xiangqi family.
  {
    id: currentRatingVariantForSpec(BANQI_SPEC_ID),
    gameSpecId: banqiSpec.id,
    apiParam: BANQI_SPEC_ID,
    label: banqiSpec.publicName,
    miniId: 'banqi',
    enabled: false,
    onLeaderboard: banqiOn,
    onProfile: banqiOn,
  },
  // Jieqi is the established full-board reveal member of the xiangqi family.
  // It is launched casual and rating-ready (gated globally by
  // MISTBOARD_RATED_ENABLED), with no open-seek matchmaking.
  {
    id: currentRatingVariantForSpec(JIEQI_SPEC_ID),
    gameSpecId: jieqiSpec.id,
    apiParam: JIEQI_SPEC_ID,
    label: jieqiSpec.publicName,
    miniId: 'jieqi',
    enabled: false,
    onLeaderboard: jieqiOn,
    onProfile: jieqiOn,
  },
  // Fortress: the authored open-information xiangqi product variant.
  {
    id: currentRatingVariantForSpec(FORTRESS_XIANGQI_SPEC_ID),
    gameSpecId: fortressXiangqiSpec.id,
    apiParam: FORTRESS_XIANGQI_SPEC_ID,
    label: fortressXiangqiSpec.publicName,
    miniId: 'fortress-xiangqi',
    enabled: false,
    onLeaderboard: fortressXiangqiOn,
    onProfile: fortressXiangqiOn,
  },
  // Duck: xiangqi plus Duck Chess's shared blocker. Launched casual and
  // rating-ready on the same terms as Fortress; the lobby seek stays unrated
  // (registration.ts) until the pool has games in it.
  {
    id: currentRatingVariantForSpec(DUCK_XIANGQI_SPEC_ID),
    gameSpecId: duckXiangqiSpec.id,
    apiParam: DUCK_XIANGQI_SPEC_ID,
    label: duckXiangqiSpec.publicName,
    miniId: 'duck-xiangqi',
    enabled: false,
    onLeaderboard: duckXiangqiOn,
    onProfile: duckXiangqiOn,
  },
  // Full Fog Xiangqi (9x10): launched PvP-first (no bot, no open-seek lobby),
  // rating-ready like Jieqi/Banqi, and paired directly with Fog Chess.
  {
    id: currentRatingVariantForSpec(DARK_XIANGQI_SPEC_ID),
    gameSpecId: darkXiangqiSpec.id,
    apiParam: DARK_XIANGQI_SPEC_ID,
    label: darkXiangqiSpec.publicName,
    miniId: 'dark-xiangqi',
    enabled: false,
    onLeaderboard: darkXiangqiOn,
    onProfile: darkXiangqiOn,
  },
  {
    id: currentRatingVariantForSpec(DARK_CHESS_SPEC_ID),
    gameSpecId: darkChessSpec.id,
    apiParam: 'fog',
    label: darkChessSpec.publicName,
    miniId: 'dark-chess',
    enabled: true,
    onLeaderboard: true,
    onProfile: true,
  },
  // Jungle + Flip Jungle close the public shelf as a family pair. Both use
  // rated human PvP pools; PvE bot games stay unrated. They are not open-seek
  // lobby variants, so `enabled` remains false.
  {
    id: currentRatingVariantForSpec(JUNGLE_SPEC_ID),
    gameSpecId: jungleSpec.id,
    apiParam: JUNGLE_SPEC_ID,
    label: jungleSpec.publicName,
    miniId: 'jungle',
    enabled: false,
    onLeaderboard: jungleOn,
    onProfile: jungleOn,
  },
  {
    id: currentRatingVariantForSpec(JUNGLE_FLIP_SPEC_ID),
    gameSpecId: jungleFlipSpec.id,
    apiParam: JUNGLE_FLIP_SPEC_ID,
    label: jungleFlipSpec.publicName,
    miniId: 'jungle-flip',
    enabled: false,
    onLeaderboard: jungleFlipOn,
    onProfile: jungleFlipOn,
  },
  {
    id: currentRatingVariantForSpec(DARK_CRAZYHOUSE_SPEC_ID),
    gameSpecId: darkCrazyhouseSpec.id,
    apiParam: DARK_CRAZYHOUSE_SPEC_ID,
    label: darkCrazyhouseSpec.publicName,
    miniId: 'dark-crazyhouse',
    enabled: false,
    onLeaderboard: darkCrazyhouseOn,
    onProfile: darkCrazyhouseOn,
  },
  {
    id: currentRatingVariantForSpec(KRIEGSPIEL_SPEC_ID),
    gameSpecId: kriegspielSpec.id,
    apiParam: KRIEGSPIEL_SPEC_ID,
    label: kriegspielSpec.publicName,
    miniId: 'kriegspiel',
    enabled: false,
    onLeaderboard: kriegspielOn,
    onProfile: kriegspielOn,
  },
  {
    id: currentRatingVariantForSpec(REVEAL_CHESS_SPEC_ID),
    gameSpecId: revealChessSpec.id,
    apiParam: REVEAL_CHESS_SPEC_ID,
    label: revealChessSpec.publicName,
    miniId: 'reveal-chess',
    enabled: false,
    onLeaderboard: revealChessOn,
    onProfile: revealChessOn,
  },
  // Draft960: gated behind its flag, and temporarily hidden from the leaderboard
  // until it launches (sequenced to M4). Flip `onLeaderboard` (and the flag) when
  // expanding. Kept in the registry so re-enabling is one edit.
  {
    id: currentRatingVariantForSpec(DARK_DRAFT960_SPEC_ID),
    gameSpecId: draft960Spec.id,
    apiParam: 'dark-draft960',
    label: draft960Spec.publicName,
    miniId: 'draft960',
    enabled: draft960Enabled,
    onLeaderboard: false,
    onProfile: false,
  },
  {
    id: currentRatingVariantForSpec(DARK_MINI_XIANGQI_SPEC_ID),
    gameSpecId: darkMiniXiangqiSpec.id,
    apiParam: DARK_MINI_XIANGQI_SPEC_ID,
    label: darkMiniXiangqiSpec.publicName,
    miniId: 'dark-mini-xiangqi',
    enabled: darkMiniEnabled,
    onLeaderboard: darkMiniEnabled,
    onProfile: darkMiniEnabled,
  },
];

/** Variants shown on public rating surfaces (leaderboard + profile grid). */
export const leaderboardVariants = VARIANTS.filter((v) => v.onLeaderboard);

/** Variants shown on subject-scoped profile rating surfaces. */
export const profileRatingVariants = VARIANTS.filter((v) => v.onProfile);

/** Variants selectable in the lobby. */
export const enabledVariants = VARIANTS.filter((v) => v.enabled);

export function isVariantEnabled(id: RatingVariantId): boolean {
  return VARIANTS.some((v) => v.id === id && v.enabled);
}

/** Mini-board id for a game spec (picker/landing), or null if none. */
export function variantMiniIdForGameSpec(id: GameSpecId): VariantMiniId | null {
  return VARIANT_MINI_BY_GAME_SPEC[id] ?? null;
}

/** Mini-board id for a rating variant (leaderboard/profile), or null if none. */
export function variantMiniIdForRating(id: RatingVariantId): VariantMiniId | null {
  return VARIANTS.find((v) => v.id === id)?.miniId ?? null;
}

/**
 * Mini-board id for a raw persisted variant string (e.g. a FeaturedGame.variant
 * off the wire), normalizing legacy aliases (fog, draft960) through
 * their canonical game spec first. Null if the string maps to no marker.
 */
export function variantMiniIdForRawVariant(variant: string): VariantMiniId | null {
  const spec = maybeGameSpecForId(variant);
  return spec ? variantMiniIdForGameSpec(spec.id) : null;
}

/** Display label for a rating-variant id off the wire, or null if unknown. */
export function ratingVariantLabel(id: string): string | null {
  return VARIANTS.find((v) => v.id === id)?.label ?? null;
}

function currentRatingVariantForSpec(id: GameSpecId): RatingVariantId {
  const pool = ratingPoolForSpec(id);
  if (!pool) throw new Error(`game spec ${id} is not a current web rating variant`);
  return pool;
}
