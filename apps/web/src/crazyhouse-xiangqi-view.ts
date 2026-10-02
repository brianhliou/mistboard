// What a Crazyhouse Xiangqi board needs on top of a xiangqi board, shared by
// the live room and the postgame so they cannot disagree:
//
//   - the BOARD VIEW: a CrazyhouseXiangqiPlayerView narrowed to the standard
//     xiangqi view the shared board renders (xiangqi-board.ts). Drops leave
//     legalMoves (the board's click layer only knows from/to), and a drop as
//     the last move becomes `lastDropSquare`, the destination ring alone;
//   - the HANDS: the shared drop pocket (drop-pocket.ts) in the reader's
//     xiangqi piece set;
//   - drop targets, move notation, the end-of-game phrase.

import {
  CRAZYHOUSE_XIANGQI_DROP_ROLES,
  type CrazyhouseXiangqiBoardMove,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiDropRole,
  type CrazyhouseXiangqiMove,
  type CrazyhouseXiangqiPlayerView,
  type CrazyhouseXiangqiSquare,
  isCrazyhouseXiangqiDropMove,
  type StandardXiangqiPlayerView,
} from '@mistboard/game';
import { fillDropPocket } from './drop-pocket.js';
import type { TenantReasonKey } from './variant-tenant/room-chrome.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

/** The board half of the view, in the shape the shared xiangqi board renders. */
export function crazyhouseXiangqiBoardView(
  view: CrazyhouseXiangqiPlayerView,
): StandardXiangqiPlayerView {
  const lastMove = view.lastMove;
  return {
    id: view.id,
    perspective: view.perspective,
    board: view.board,
    legalMoves: crazyhouseXiangqiBoardMoves(view),
    status: view.status,
    moveNumber: view.moveNumber,
    ...(lastMove && !isCrazyhouseXiangqiDropMove(lastMove) ? { lastMove } : {}),
  };
}

/** The point the last move dropped a piece on, or null after a board move. */
export function crazyhouseXiangqiLastDrop(
  view: CrazyhouseXiangqiPlayerView,
): CrazyhouseXiangqiSquare | null {
  const lastMove = view.lastMove;
  return lastMove && isCrazyhouseXiangqiDropMove(lastMove) ? lastMove.to : null;
}

export function crazyhouseXiangqiBoardMoves(
  view: CrazyhouseXiangqiPlayerView,
  from?: CrazyhouseXiangqiSquare | null,
): CrazyhouseXiangqiBoardMove[] {
  return view.legalMoves.filter(
    (move): move is CrazyhouseXiangqiBoardMove =>
      !isCrazyhouseXiangqiDropMove(move) && (from == null || move.from === from),
  );
}

/** Every point the side to move may drop `role` on (none when role is null). */
export function crazyhouseXiangqiDropTargets(
  view: CrazyhouseXiangqiPlayerView,
  role: CrazyhouseXiangqiDropRole | null,
): CrazyhouseXiangqiSquare[] {
  if (!role) return [];
  const targets: CrazyhouseXiangqiSquare[] = [];
  for (const move of view.legalMoves) {
    if (isCrazyhouseXiangqiDropMove(move) && move.drop === role) targets.push(move.to);
  }
  return targets;
}

// The drop letters are Fairy-Stockfish's for this variant (B = elephant), the
// same spelling the engine and the JSON export use.
const DROP_ROLE_LETTER: Record<CrazyhouseXiangqiDropRole, string> = {
  chariot: 'R',
  horse: 'N',
  elephant: 'B',
  advisor: 'A',
  cannon: 'C',
  soldier: 'P',
};

/** Move-list notation: coordinate pairs, and drops as `N@e5`. */
export function crazyhouseXiangqiMoveLabel(move: CrazyhouseXiangqiMove): string {
  if (isCrazyhouseXiangqiDropMove(move)) return `${DROP_ROLE_LETTER[move.drop]}@${move.to}`;
  return `${move.from}-${move.to}`;
}

export function isCrazyhouseXiangqiDropRole(value: string): value is CrazyhouseXiangqiDropRole {
  return (CRAZYHOUSE_XIANGQI_DROP_ROLES as readonly string[]).includes(value);
}

/**
 * Pocket display order, the lichess crazyhouse order carried to xiangqi: the
 * attackers from cheapest up, then the defenders. Display only: the FEN and the
 * engine spell hands in CRAZYHOUSE_XIANGQI_DROP_ROLES order (R N B A C P).
 */
export const CRAZYHOUSE_XIANGQI_POCKET_ORDER = [
  'soldier',
  'cannon',
  'horse',
  'chariot',
  'elephant',
  'advisor',
] as const satisfies readonly CrazyhouseXiangqiDropRole[];

/** One side's hand as a pocket. Interactive only for the side that may drop. */
export function fillCrazyhouseXiangqiReserve(
  host: HTMLElement,
  view: Pick<CrazyhouseXiangqiPlayerView, 'hands'>,
  owner: CrazyhouseXiangqiColor,
  options: {
    interactive?: boolean;
    selectedRole?: CrazyhouseXiangqiDropRole | null;
    onSelect?(role: CrazyhouseXiangqiDropRole): void;
    /** The lichess pocket bar (drop-pocket.ts); off draws a held-only strip. */
    pocket?: boolean;
    /** Every role ghosted in place without the pocket bar: the TV showcase's
     *  strip (landing.css `--all-roles`), the shape Fortress's showcase uses. */
    allRoles?: boolean;
  } = {},
): void {
  fillDropPocket(host, {
    owner,
    entries: CRAZYHOUSE_XIANGQI_POCKET_ORDER.map((role) => ({
      role,
      count: view.hands[owner][role] ?? 0,
    })),
    ...options,
    // A piece in hand has no point, so it cannot answer the river question:
    // draw the plain soldier, which is what it is until it lands.
    renderPiece: (role) =>
      renderXiangqiPiece({ color: owner, role }, { ariaLabel: `${owner} ${role}`, crossed: false }),
  });
}

/** The reason phrase for the room chrome's and the postgame's end-of-game line. */
export function crazyhouseXiangqiReasonPhrase(reason: string): TenantReasonKey {
  switch (reason) {
    case 'checkmate':
      return 'result.checkmate';
    case 'stalemate':
      return 'result.stalemate';
    case 'timeout':
      return 'result.timeout';
    case 'resignation':
      return 'result.resignation';
    case 'abandonment':
      return 'result.abandonment';
    case 'repetition':
      return 'result.threefoldRepetition';
    case 'chasing':
      return 'result.perpetualCheck';
    case 'progress-clock':
      return 'result.sixtyPliesNoCapture';
    default:
      return 'result.gameRules';
  }
}
