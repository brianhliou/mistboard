// The one hover preview arrow: the move under the reader's cursor in the opening
// book or the tablebase table. Same solid shaft and head as the engine's best
// arrow (BEST_STYLE), so a previewed move reads as a move, not as a separate
// annotation grammar; only the ink says where it came from.
//
// Tablebase tones follow the site's "good / bad for the mover" grammar (the jieqi
// luck die, board-luck-mark.css step 5): teal for a win, grey for a draw, violet
// for a loss, never red or green, since red is the Red player. Opening-book moves
// carry no verdict, so they take a neutral slate that is neither the engine's
// blue nor any result tone.

import type { SvgBoardArrowStyle } from '../svg-board-arrow.js';
import { BEST_STYLE } from './engine/engine-arrows.js';

export type HoverArrowTone = 'book' | 'win' | 'draw' | 'loss';

export const HOVER_ARROW_INK: Readonly<Record<HoverArrowTone, string>> = {
  book: '#45505c',
  win: '#016f53',
  draw: '#7a7771',
  loss: '#692db6',
};

/** A touch heavier than the engine's 0.4 so the preview sits visibly over the
 *  engine arrow when both point at the same move. */
const HOVER_OPACITY = 0.55;

export function hoverArrowStyle(
  tone: HoverArrowTone,
  classPrefix = 'xq-arrow',
): SvgBoardArrowStyle & { className: string } {
  return {
    width: BEST_STYLE.width,
    opacity: HOVER_OPACITY,
    color: HOVER_ARROW_INK[tone],
    className: `${classPrefix}--hover ${classPrefix}--hover-${tone}`,
  };
}
