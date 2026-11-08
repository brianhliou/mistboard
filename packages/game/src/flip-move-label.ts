// The move-list label of the two flip variants (banqi, Flip Jungle). Every
// surface that lists their moves calls these: the live room, the review tree
// and its engine line, Mistboard TV and the article/embed replays. Before
// there was one, TV fell through to the generic from-to label and printed a
// flip, which is the self-move { from: X, to: X }, as "f2-f2".
//
// The shape is ICGA's (Chen, Shen and Hsu, ICGA Journal 2010) on the site's own
// board and letters, so a list reads against the board the reader sees:
//   board move or capture   `b1-b2`
//   flip                    `f2(C)`, the piece it turned up, upper case red and
//                           lower case black, letters from the variant's FEN
//   flip, identity unknown  `f2(?)` (an engine line: the flip has not happened)
// A flipped piece is face up for both seats and every spectator the moment it
// turns over, so naming it carries nothing a viewer could not already see.
// The export's PGN keeps ICGA's own board and letters (hidden-piece-record.ts).

import { banqiPieceLetter } from './banqi-fen.js';
import { jungleFlipPieceLetter } from './jungle-flip-fen.js';
import type { BanqiColor, BanqiMove, BanqiPieceRole, BanqiSquare } from './variants-banqi.js';
import type {
  JungleFlipColor,
  JungleFlipMove,
  JungleFlipPieceRole,
  JungleFlipSquare,
} from './variants-jungle-flip.js';
import type { ThreeKingdomsBanqiMove } from './variants-three-kingdoms-banqi.js';

type BoardEntry<C, R> = { faceDown: boolean; color?: C; role?: R };
type Identity<C, R> = { color: C; role: R };

function faceUpAt<S extends string, C, R>(
  board: Partial<Record<S, BoardEntry<C, R>>> | null | undefined,
  square: S,
): Identity<C, R> | null {
  const entry = board?.[square];
  if (!entry || entry.faceDown || entry.color === undefined || entry.role === undefined)
    return null;
  return { color: entry.color, role: entry.role };
}

function flipLabel<C, R>(
  square: string,
  revealed: Identity<C, R> | null | undefined,
  letter: (piece: Identity<C, R>) => string,
): string {
  return `${square}(${revealed ? letter(revealed) : '?'})`;
}

/** A banqi move's label; `revealed` is what a flip turned up (null: not known). */
export function banqiMoveLabel(
  move: BanqiMove,
  revealed: Identity<BanqiColor, BanqiPieceRole> | null | undefined,
): string {
  if (move.from !== move.to) return `${move.from}-${move.to}`;
  return flipLabel(move.from, revealed, banqiPieceLetter);
}

/** A banqi move's label, reading a flip's piece off the board after the move. */
export function banqiMoveLabelOnBoard(
  move: BanqiMove,
  boardAfter:
    | Partial<Record<BanqiSquare, BoardEntry<BanqiColor, BanqiPieceRole>>>
    | null
    | undefined,
): string {
  return banqiMoveLabel(move, faceUpAt(boardAfter, move.to));
}

/** A Three Kingdoms banqi move's label (#628): banqi's pieces and letters on
 *  the 9x5 point board, so a study reads like a banqi one. */
export function threeKingdomsBanqiMoveLabel(
  move: ThreeKingdomsBanqiMove,
  revealed: Identity<BanqiColor, BanqiPieceRole> | null | undefined,
): string {
  if (move.from !== move.to) return `${move.from}-${move.to}`;
  return flipLabel(move.from, revealed, banqiPieceLetter);
}

/** A Flip Jungle move's label; `revealed` is what a flip turned up (null: not known). */
export function jungleFlipMoveLabel(
  move: JungleFlipMove,
  revealed: Identity<JungleFlipColor, JungleFlipPieceRole> | null | undefined,
): string {
  if (move.from !== move.to) return `${move.from}-${move.to}`;
  return flipLabel(move.from, revealed, jungleFlipPieceLetter);
}

/** A Flip Jungle move's label, reading a flip's piece off the board after the move. */
export function jungleFlipMoveLabelOnBoard(
  move: JungleFlipMove,
  boardAfter:
    | Partial<Record<JungleFlipSquare, BoardEntry<JungleFlipColor, JungleFlipPieceRole>>>
    | null
    | undefined,
): string {
  return jungleFlipMoveLabel(move, faceUpAt(boardAfter, move.to));
}
