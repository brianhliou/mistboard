// Coordinate labels for a xiangqi-family board, derived from the reader's move
// NOTATION preference rather than being their own setting.
//
// That coupling is the point. Xiangqi notation numbers files from each player's
// own right, so red's file 2 and black's file 2 are opposite ends of the board;
// a board labelled one way while the move list reads the other teaches nothing.
// It also settles ranks without a second toggle: WXF and Chinese never name a
// rank (a move is a piece, a file, a direction, and either a destination file or
// a count of ranks travelled), so those styles get file labels only. Coordinate,
// ICCS and algebraic are absolute square names, where a rank genuinely is part
// of the address, so they get both.

import type { XiangqiNotationStyle } from '@mistboard/game';
import type { XiangqiCoordLabels } from './xiangqi-board-surface.js';

const ARABIC_BY_OWN_RIGHT = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const CHINESE_BY_OWN_RIGHT = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;
const ALGEBRAIC_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;

/** Labels indexed by LOGICAL file (0 = file a), for a board of `fileCount`. */
export function xiangqiCoordLabels(
  style: XiangqiNotationStyle,
  fileCount: number,
  rankCount: number,
): XiangqiCoordLabels {
  if (style === 'coordinate' || style === 'iccs' || style === 'algebraic') {
    // Absolute square names: one label per file and per rank, the same for both
    // players, because the name of a square does not depend on who is looking.
    const files = ALGEBRAIC_FILES.slice(0, fileCount);
    return {
      red: files,
      black: files,
      ranks: Array.from({ length: rankCount }, (_, i) => String(i + 1)),
    };
  }
  // Relative notations: each side counts files from ITS OWN right, so the same
  // logical file carries a different number for each player. Red is written in
  // Chinese numerals and black in Arabic, which is the convention that lets a
  // reader tell whose move a token belongs to without being told.
  const chinese = style === 'chinese-simplified' || style === 'chinese-traditional';
  const red: string[] = [];
  const black: string[] = [];
  for (let file = 0; file < fileCount; file += 1) {
    // Red's file 1 is the rightmost on the board (highest index); black's is the
    // leftmost. Mirrors wxfFileNumber in packages/game.
    const redNumber = fileCount - file;
    const blackNumber = file + 1;
    red.push((chinese ? CHINESE_BY_OWN_RIGHT : ARABIC_BY_OWN_RIGHT)[redNumber - 1] ?? '');
    black.push(ARABIC_BY_OWN_RIGHT[blackNumber - 1] ?? '');
  }
  return { red, black };
}
