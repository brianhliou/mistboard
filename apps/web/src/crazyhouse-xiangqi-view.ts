// What a Crazyhouse Xiangqi board needs on top of a xiangqi board, shared by
// the live room and the postgame so they cannot disagree:
//
//   - the BOARD VIEW: a CrazyhouseXiangqiPlayerView narrowed to the standard
//     xiangqi view the shared board renders (xiangqi-board.ts). Drops leave
//     legalMoves (the board's click layer only knows from/to), and a drop as
//     the last move becomes `lastDropSquare`, the destination ring alone;
//   - the HANDS: the shared pocket strip (drop-reserve.css) in the xiangqi
//     piece set, a held-only strip per side;
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

/** One side's hand as a pocket strip. Interactive only for the side that may drop. */
export function fillCrazyhouseXiangqiReserve(
  host: HTMLElement,
  view: Pick<CrazyhouseXiangqiPlayerView, 'hands'>,
  owner: CrazyhouseXiangqiColor,
  options: {
    interactive?: boolean;
    selectedRole?: CrazyhouseXiangqiDropRole | null;
    onSelect?(role: CrazyhouseXiangqiDropRole): void;
  } = {},
): void {
  host.classList.add('drop-mini-reserve-strip');
  host
    .closest<HTMLElement>('.board-shell, .replay-pane')
    ?.classList.add('drop-mini-reserve-container');
  host.replaceChildren();
  host.dataset.hand = owner;
  const held = CRAZYHOUSE_XIANGQI_DROP_ROLES.map((role) => ({
    role,
    count: view.hands[owner][role] ?? 0,
  })).filter((entry) => entry.count > 0);
  host.classList.toggle('has-captures', held.length > 0);
  if (held.length === 0) return;

  const row = document.createElement('div');
  row.className = 'drop-mini-reserve-row';
  for (const entry of held) {
    const tile = options.interactive
      ? document.createElement('button')
      : document.createElement('span');
    tile.className = [
      'drop-mini-reserve-piece',
      entry.count > 1 ? 'has-count' : '',
      options.selectedRole === entry.role ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (tile instanceof HTMLButtonElement) {
      tile.type = 'button';
      tile.dataset.drop = entry.role;
      tile.setAttribute('aria-grabbed', options.selectedRole === entry.role ? 'true' : 'false');
      tile.addEventListener('click', () => options.onSelect?.(entry.role));
    }
    tile.setAttribute('aria-label', `${owner} ${entry.role} x${entry.count}`);
    // A piece in hand has no point, so it cannot answer the river question:
    // draw the plain soldier, which is what it is until it lands.
    tile.innerHTML = renderXiangqiPiece(
      { color: owner, role: entry.role },
      { ariaLabel: `${owner} ${entry.role}`, crossed: false },
    );
    if (entry.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'captures-count-badge';
      badge.textContent = String(entry.count);
      tile.append(badge);
    }
    row.append(tile);
  }
  host.append(row);
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
