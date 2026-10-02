import {
  type FortressXiangqiBoardMove,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  isFortressXiangqiDropMove,
} from '@mistboard/game';
import { fillDropPocket } from './drop-pocket.js';
import { renderFortressXiangqiPieceInline } from './fortress-xiangqi-render.js';
import { readStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';

export function fortressXiangqiBoardMoves(
  view: FortressXiangqiPlayerView,
  from?: FortressXiangqiSquare | null,
): FortressXiangqiBoardMove[] {
  return view.legalMoves.filter(
    (move): move is FortressXiangqiBoardMove =>
      !isFortressXiangqiDropMove(move) &&
      (from === undefined || from === null || move.from === from),
  );
}

export function fortressXiangqiDropTargets(
  view: FortressXiangqiPlayerView,
  role: FortressXiangqiDropRole | null,
): FortressXiangqiSquare[] {
  if (!role) return [];
  return view.legalMoves
    .filter((move) => isFortressXiangqiDropMove(move) && move.drop === role)
    .map((move) => (move as { to: FortressXiangqiSquare }).to);
}

const DROP_ROLE_LETTER: Record<FortressXiangqiDropRole, string> = {
  chariot: 'R',
  horse: 'N',
  cannon: 'C',
  soldier: 'P',
  treasure: 'T',
  advisor: 'A',
  elephant: 'E',
};

export function fortressXiangqiMoveLabel(move: FortressXiangqiMove): string {
  if (isFortressXiangqiDropMove(move)) return `${DROP_ROLE_LETTER[move.drop]}@${move.to}`;
  return `${move.from}-${move.to}`;
}

/**
 * Pocket display order, the lichess crazyhouse order carried to xiangqi: the
 * attackers from cheapest up (soldier, cannon, horse, chariot), then the
 * defenders (elephant, advisor) and Fortress's own Treasure, which joined them.
 * Display only: FEN and engine spell hands in FORTRESS_DROP_ROLES order.
 */
export const FORTRESS_XIANGQI_POCKET_ORDER = [
  'soldier',
  'cannon',
  'horse',
  'chariot',
  'elephant',
  'advisor',
  'treasure',
] as const satisfies readonly FortressXiangqiDropRole[];

export function fillFortressXiangqiReserve(
  host: HTMLElement,
  view: Pick<FortressXiangqiPlayerView, 'hands'>,
  owner: FortressXiangqiColor,
  options: {
    interactive?: boolean;
    selectedRole?: FortressXiangqiDropRole | null;
    onSelect?(role: FortressXiangqiDropRole): void;
    /** Render a slot for EVERY droppable role, ghosting the ones held zero
     *  times, the way lichess draws a crazyhouse pocket. Used by the replay
     *  panes, which style the row themselves. */
    allRoles?: boolean;
    /** The lichess pocket bar (drop-pocket.ts): live room, review, postgame. */
    pocket?: boolean;
  } = {},
): void {
  const pieceSet = readStoredXiangqiPieceSet();
  fillDropPocket(host, {
    owner,
    entries: FORTRESS_XIANGQI_POCKET_ORDER.map((role) => ({
      role,
      count: view.hands[owner][role] ?? 0,
    })),
    ...options,
    renderPiece: (role) => renderFortressXiangqiPieceInline({ color: owner, role }, pieceSet),
  });
}
