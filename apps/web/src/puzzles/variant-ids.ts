/**
 * The closed list of GameSpecIds with a puzzle board adapter. Kept in a leaf
 * module (no imports beyond @mistboard/game) so both the session model
 * (adapter.ts) and the adapter map (registry.ts) can depend on it without a
 * cycle.
 *
 * Adding puzzle variant N+1 starts here: add its spec id to this list, and the
 * Record<PuzzleVariant, PuzzleBoardAdapter> annotation in registry.ts fails to
 * compile until the matching adapter entry exists.
 */

import {
  FORTRESS_XIANGQI_SPEC_ID,
  JUNGLE_SPEC_ID,
  MINI_XIANGQI_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';

export const PUZZLE_VARIANT_IDS = [
  MINI_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  JUNGLE_SPEC_ID,
  XIANGQI_SPEC_ID,
] as const;

export type PuzzleVariant = (typeof PUZZLE_VARIANT_IDS)[number];
