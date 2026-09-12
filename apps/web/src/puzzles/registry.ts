/**
 * The puzzle-variant -> board-adapter registry. This is the ONLY place the
 * puzzles page enumerates variants; the session/panel core dispatches every
 * per-variant behavior (paint, animate, apply, labels, icons, analysis)
 * through here.
 *
 * Adding puzzle variant N+1 = one new adapter module + one id in
 * PUZZLE_VARIANT_IDS (puzzles/variant-ids.ts) + one entry in
 * PUZZLE_BOARD_ADAPTERS below, with no edits to the shared core. The
 * Record<PuzzleVariant, ...> annotation makes a missing adapter entry a
 * compile error, and registry.test.ts fails loudly if a corpus in
 * @mistboard/game ships puzzles for a variant with no adapter.
 *
 * Fail-closed (repo invariant): an unknown variant throws. Never add a
 * fallback that maps an unknown id to another variant's board.
 */

import {
  FORTRESS_XIANGQI_SPEC_ID,
  hasOwnKey,
  JUNGLE_SPEC_ID,
  MINI_XIANGQI_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import type { PuzzleBoardAdapter } from './adapter.js';
import { fortressXiangqiPuzzleAdapter } from './fortress-xiangqi-adapter.js';
import { junglePuzzleAdapter } from './jungle-adapter.js';
import { miniXiangqiPuzzleAdapter } from './mini-xiangqi-adapter.js';
import type { PuzzleVariant } from './variant-ids.js';
import { xiangqiPuzzleAdapter } from './xiangqi-adapter.js';

export { PUZZLE_VARIANT_IDS, type PuzzleVariant } from './variant-ids.js';

const PUZZLE_BOARD_ADAPTERS: Record<PuzzleVariant, PuzzleBoardAdapter> = {
  [MINI_XIANGQI_SPEC_ID]: miniXiangqiPuzzleAdapter,
  [FORTRESS_XIANGQI_SPEC_ID]: fortressXiangqiPuzzleAdapter,
  [JUNGLE_SPEC_ID]: junglePuzzleAdapter,
  [XIANGQI_SPEC_ID]: xiangqiPuzzleAdapter,
};

export function isPuzzleVariant(value: string): value is PuzzleVariant {
  return hasOwnKey(PUZZLE_BOARD_ADAPTERS, value);
}

export function puzzleBoardAdapter(variant: string): PuzzleBoardAdapter {
  if (!isPuzzleVariant(variant)) {
    throw new Error(`Unknown puzzle variant: ${variant} (no board adapter registered)`);
  }
  return PUZZLE_BOARD_ADAPTERS[variant];
}

export function allPuzzleBoardAdapters(): readonly PuzzleBoardAdapter[] {
  return Object.values(PUZZLE_BOARD_ADAPTERS);
}
