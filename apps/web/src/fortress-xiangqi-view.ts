import {
  FORTRESS_DROP_ROLES,
  type FortressXiangqiBoardMove,
  type FortressXiangqiColor,
  type FortressXiangqiDropRole,
  type FortressXiangqiMove,
  type FortressXiangqiPlayerView,
  type FortressXiangqiSquare,
  isFortressXiangqiDropMove,
} from '@mistboard/game';
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

export function fillFortressXiangqiReserve(
  host: HTMLElement,
  view: FortressXiangqiPlayerView,
  owner: FortressXiangqiColor,
  options: {
    interactive?: boolean;
    selectedRole?: FortressXiangqiDropRole | null;
    onSelect?(role: FortressXiangqiDropRole): void;
    /** Render a slot for EVERY droppable role, ghosting the ones held zero
     *  times, the way lichess draws a crazyhouse pocket. An empty pocket then
     *  reads as a fixed set of waiting slots instead of blank space, and the
     *  row never changes width as pieces come and go — the slot a piece will
     *  appear in is already on screen. Used by the review rail; the live room
     *  keeps the compact held-only strip beside the board. */
    allRoles?: boolean;
  } = {},
): void {
  // Reuse the shared reserve styling (drop-reserve.css) for a consistent pocket look.
  host.classList.add('drop-mini-reserve-strip');
  host
    .closest<HTMLElement>('.board-shell, .replay-pane')
    ?.classList.add('drop-mini-reserve-container');
  host.replaceChildren();
  const held = FORTRESS_DROP_ROLES.map((role) => ({
    role,
    count: view.hands[owner][role] ?? 0,
  }));
  const entries = options.allRoles ? held : held.filter((entry) => entry.count > 0);
  host.classList.toggle(
    'has-captures',
    held.some((entry) => entry.count > 0),
  );
  host.classList.toggle('drop-mini-reserve-strip--all-roles', options.allRoles === true);
  if (entries.length === 0) return;

  const pieceSet = readStoredXiangqiPieceSet();
  const row = document.createElement('div');
  row.className = 'drop-mini-reserve-row';
  for (const entry of entries) {
    const tile = options.interactive
      ? document.createElement('button')
      : document.createElement('span');
    tile.className = [
      'drop-mini-reserve-piece',
      entry.count > 1 ? 'has-count' : '',
      entry.count === 0 ? 'is-empty' : '',
      options.selectedRole === entry.role ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (tile instanceof HTMLButtonElement) {
      tile.type = 'button';
      // A ghosted slot holds space for a piece you do not have; it is not a
      // control, so it stays out of the tab order and ignores clicks.
      tile.disabled = entry.count === 0;
      tile.dataset.drop = entry.role;
      tile.setAttribute('aria-grabbed', options.selectedRole === entry.role ? 'true' : 'false');
      tile.addEventListener('click', () => options.onSelect?.(entry.role));
    }
    tile.setAttribute('aria-label', `${owner} ${entry.role} x${entry.count}`);
    tile.innerHTML = renderFortressXiangqiPieceInline({ color: owner, role: entry.role }, pieceSet);
    if (entry.count > 1) tile.append(countBadge(entry.count));
    row.append(tile);
  }
  host.append(row);
}

function countBadge(count: number): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'captures-count-badge';
  badge.textContent = String(count);
  return badge;
}
