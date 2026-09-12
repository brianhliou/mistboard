import {
  DARK_CHESS_SPEC_ID,
  findTimeControl,
  type GameSpecId,
  isRatedPoolBase,
  maybeGameSpecForId,
  type RatedTimeClass,
  type RatingVariant,
  ratingPoolForSpec,
} from '@mistboard/game';

// Rated-pool vocabulary lives on the game spec (single source of truth):
// RatingVariant + ratingPoolForSpec derive from each spec's `rated` flag.
// Re-exported here so existing server importers keep their import path.
export type { RatingVariant } from '@mistboard/game';
// RatedTimeClass, not TimeClass: the classifier returns 'classical' for slow
// enough paces, but user_ratings.time_class only accepts bullet/blitz/rapid
// (migration 026). Keeping the bucket type narrow makes a rated classical pace
// a compile error in bucketForGame rather than a CHECK violation in prod.
export type RatingTimeClass = RatedTimeClass;

export type RatingBucket = {
  variant: RatingVariant;
  timeClass: RatingTimeClass;
};

// The DEFAULT public ladder, not the only one: leaderboard/profile surfaces
// show this class unless the caller asks for another. Every rated live pace
// writes to its own bucket (bucketForGame below).
export const PUBLIC_RATING_TIME_CLASS: RatingTimeClass = 'blitz';

// Every time class that can hold rated games, ordered for display.
export const PUBLIC_RATING_TIME_CLASSES: readonly RatingTimeClass[] = ['bullet', 'blitz', 'rapid'];

export const DEFAULT_RATING_BUCKET: RatingBucket = {
  variant: currentRatingVariantForSpec(DARK_CHESS_SPEC_ID),
  timeClass: PUBLIC_RATING_TIME_CLASS,
};

type BucketInput = {
  variant?: string | null;
  initialMs?: number | null;
  incrementMs?: number | null;
};

export function bucketForGame(input: BucketInput): RatingBucket | null {
  // Fail closed twice over: an unofficial pace (including every correspondence
  // cadence, whose ms values match no live spec) and a pace whose spec is not
  // rated both yield no bucket, so the game is simply not rated.
  const spec = findTimeControl(input.initialMs, input.incrementMs);
  if (!spec || !spec.rated) return null;
  // Same for a casual-only game spec (no active rating pool): no bucket rather
  // than mis-crediting the game to fog.
  const variant = ratingPoolForSpec(ratingSpecForGame(input));
  if (!variant) return null;
  return { variant, timeClass: spec.timeClass };
}

// Accepts a canonical pool name ('fog') or a game spec id ('dark-chess') and
// returns the rated pool, or null if casual.
export function parseRatingVariant(value: string | null | undefined): RatingVariant | null {
  if (isRatedPoolBase(value)) return value;
  const spec = maybeGameSpecForId(value);
  return spec ? ratingPoolForSpec(spec.id) : null;
}

export function parseRatingTimeClass(value: string | null | undefined): RatingTimeClass | null {
  if (value === 'bullet') return 'bullet';
  if (value === 'blitz') return 'blitz';
  if (value === 'rapid') return 'rapid';
  return null;
}

// Map a game's variant string to the spec whose rating pool it belongs to. Any
// known spec maps to itself (each rated variant buckets into its own pool);
// unknown/legacy values fall back to the dark-chess family. ratingPoolForSpec
// then fails closed for casual specs.
function ratingSpecForGame(input: BucketInput): GameSpecId {
  return maybeGameSpecForId(input.variant)?.id ?? DARK_CHESS_SPEC_ID;
}

function currentRatingVariantForSpec(id: GameSpecId): RatingVariant {
  const pool = ratingPoolForSpec(id);
  if (!pool) throw new Error(`game spec ${id} is not a current rating variant`);
  return pool;
}
