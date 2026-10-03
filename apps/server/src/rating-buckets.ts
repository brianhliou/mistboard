import {
  DARK_CHESS_SPEC_ID,
  findTimeControl,
  type GameSpecId,
  isCorrespondenceRatedSpec,
  isRatedPoolBase,
  maybeGameSpecForId,
  officialCorrespondenceDays,
  type RatedTimeClass,
  type RatingVariant,
  ratingPoolForSpec,
} from '@mistboard/game';
import { correspondenceRatedEnabled } from './feature-flags.js';

// Rated-pool vocabulary lives on the game spec (single source of truth):
// RatingVariant + ratingPoolForSpec derive from each spec's `rated` flag.
// Re-exported here so existing server importers keep their import path.
export type { RatingVariant } from '@mistboard/game';
// RatedTimeClass, not TimeClass: the classifier returns 'classical' for slow
// enough paces, but user_ratings.time_class only accepts bullet/blitz/rapid plus
// 'correspondence' (migrations 026, 160). Keeping the bucket type narrow makes a
// rated classical pace a compile error in bucketForGame rather than a CHECK
// violation in prod.
//
// 'correspondence' is its own pool per variant (Brian, 2026-10-02): days-per-move
// games never share a ladder with any live pace. It is not a live pace, so it is
// not in RatedTimeClass (which types TIME_CONTROLS); it exists only here.
export const CORRESPONDENCE_RATING_TIME_CLASS = 'correspondence' as const;
export type RatingTimeClass = RatedTimeClass | typeof CORRESPONDENCE_RATING_TIME_CLASS;

export type RatingBucket = {
  variant: RatingVariant;
  timeClass: RatingTimeClass;
};

// The DEFAULT public ladder, not the only one: leaderboard/profile surfaces
// show this class unless the caller asks for another. Every rated live pace
// writes to its own bucket (bucketForGame below).
export const PUBLIC_RATING_TIME_CLASS: RatingTimeClass = 'blitz';

// Every time class that can hold rated games, ordered for display: the three live
// paces, then correspondence last (the slowest, and the newest ladder).
export const PUBLIC_RATING_TIME_CLASSES: readonly RatingTimeClass[] = [
  'bullet',
  'blitz',
  'rapid',
  CORRESPONDENCE_RATING_TIME_CLASS,
];

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
  // A correspondence game is recognised from its stored pace alone (days * DAY_MS,
  // no increment, which no live preset equals) and rates in the variant's own
  // 'correspondence' pool, only for a spec isCorrespondenceRatedSpec admits. A
  // compressed dev allowance matches no official option and stays unrated.
  if (officialCorrespondenceDays(input.initialMs, input.incrementMs) !== null) {
    if (!isCorrespondenceRatedSpec(input.variant)) return null;
    const gameSpec = maybeGameSpecForId(input.variant);
    const variant = gameSpec ? ratingPoolForSpec(gameSpec.id) : null;
    return variant ? { variant, timeClass: CORRESPONDENCE_RATING_TIME_CLASS } : null;
  }
  // Fail closed twice over: an unofficial pace and a pace whose spec is not
  // rated both yield no bucket, so the game is simply not rated.
  const spec = findTimeControl(input.initialMs, input.incrementMs);
  if (!spec?.rated) return null;
  // Same for a casual-only game spec (no active rating pool) and for a variant
  // string the registry no longer knows: no bucket rather than mis-crediting
  // the game to fog. Until 2026-09-12 an unknown variant fell back to the
  // dark-chess spec, which was inert while every persisted variant was still
  // registered; the #396 deletions turned it live, and a rated Dark Mini
  // Xiangqi game from June showed up on a fog-chess rating graph.
  const gameSpec = maybeGameSpecForId(input.variant);
  if (!gameSpec) return null;
  const variant = ratingPoolForSpec(gameSpec.id);
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

// The time classes a rating SURFACE may show (profile rail, players page, rating
// history). Correspondence is held back while MISTBOARD_CORRESPONDENCE_RATED_ENABLED
// is off, so no correspondence rating is shown while rated correspondence is held.
export function visibleRatingTimeClasses(
  correspondenceShown: boolean = correspondenceRatedEnabled(),
): readonly RatingTimeClass[] {
  return correspondenceShown
    ? PUBLIC_RATING_TIME_CLASSES
    : PUBLIC_RATING_TIME_CLASSES.filter((tc) => tc !== CORRESPONDENCE_RATING_TIME_CLASS);
}

// parseRatingTimeClass narrowed to the classes a surface may show.
export function parseVisibleRatingTimeClass(
  value: string | null | undefined,
): RatingTimeClass | null {
  const parsed = parseRatingTimeClass(value);
  return parsed && visibleRatingTimeClasses().includes(parsed) ? parsed : null;
}

export function parseRatingTimeClass(value: string | null | undefined): RatingTimeClass | null {
  if (value === 'bullet') return 'bullet';
  if (value === 'blitz') return 'blitz';
  if (value === 'rapid') return 'rapid';
  if (value === CORRESPONDENCE_RATING_TIME_CLASS) return CORRESPONDENCE_RATING_TIME_CLASS;
  return null;
}

function currentRatingVariantForSpec(id: GameSpecId): RatingVariant {
  const pool = ratingPoolForSpec(id);
  if (!pool) throw new Error(`game spec ${id} is not a current rating variant`);
  return pool;
}
