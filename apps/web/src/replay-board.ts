import './game-shell.css';
import { boardFen, hiddenSquareClasses, mountBoard } from '@mistboard/board-render/interactive';
import type { Color, GameState, Move, Piece, PieceRole, PlayerView, Square } from '@mistboard/game';
import type { Api } from 'chessground/api';
import type * as cg from 'chessground/types';
import { chessgroundAnimation } from './board-anim.js';
import { captureRow } from './capture-render.js';
import { t } from './i18n/catalog.js';

export type ReplayPaneHandle = {
  el: HTMLDivElement;
  boardEl: HTMLDivElement;
  capturesEl: HTMLDivElement;
  topCapturesEl: HTMLDivElement;
  clockSlot: HTMLDivElement;
  labelEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  statusEl: HTMLDivElement;
};

export type ReplayCaptureLayout = 'single' | 'split';

export function createPane(
  label: string,
  kind: 'white' | 'truth' | 'black',
  showCaptures = true,
  captureLayout: ReplayCaptureLayout = 'single',
): ReplayPaneHandle {
  const el = document.createElement('div');
  el.className = `replay-pane replay-pane-${kind}`;
  const labelEl = document.createElement('div');
  labelEl.className = 'replay-pane-label';
  labelEl.textContent = label;
  const nameEl = document.createElement('div');
  nameEl.className = 'replay-pane-name';
  const boardEl = document.createElement('div');
  boardEl.className = 'board replay-board';
  const topCapturesEl = document.createElement('div');
  topCapturesEl.className = 'captures-strip replay-captures replay-captures-top';
  topCapturesEl.setAttribute('aria-label', t('replay.piecesCaptured'));
  const capturesEl = document.createElement('div');
  capturesEl.className = 'captures-strip replay-captures replay-captures-bottom';
  if (kind === 'truth') capturesEl.classList.add('replay-captures-truth');
  capturesEl.setAttribute('aria-label', t('replay.piecesCaptured'));
  const clockSlot = document.createElement('div');
  clockSlot.className = 'replay-pane-clock-slot';
  const statusEl = document.createElement('div');
  statusEl.className = 'replay-pane-status';
  if (showCaptures && captureLayout === 'split') {
    el.append(labelEl, nameEl, topCapturesEl, boardEl, capturesEl, clockSlot, statusEl);
  } else if (showCaptures) {
    el.append(labelEl, nameEl, boardEl, capturesEl, clockSlot, statusEl);
  } else {
    el.append(labelEl, nameEl, boardEl, clockSlot, statusEl);
  }
  return { el, boardEl, capturesEl, topCapturesEl, clockSlot, labelEl, nameEl, statusEl };
}

export function renderPaneCaptures(
  target: HTMLDivElement,
  capturedRoles: PieceRole[],
  capturedColor: Color,
): void {
  target.replaceChildren();
  target.classList.toggle('has-captures', capturedRoles.length > 0);
  if (capturedRoles.length === 0) return;
  const row = captureRow(capturedRoles, capturedColor);
  if (row) target.append(row);
}

export function renderTruthCaptures(
  target: HTMLDivElement,
  captures: Record<Color, PieceRole[]>,
): void {
  target.replaceChildren();
  const whiteCaptureRow = captureRow(captures.white, 'black');
  const blackCaptureRow = captureRow(captures.black, 'white');
  const hasCaptures = whiteCaptureRow !== null || blackCaptureRow !== null;
  target.classList.toggle('has-captures', hasCaptures);
  if (!hasCaptures) return;

  const split = document.createElement('div');
  split.className = 'captures-truth-split';

  const whiteSide = document.createElement('div');
  whiteSide.className = 'captures-truth-side captures-truth-side-white';
  whiteSide.setAttribute('aria-label', t('replay.blackPiecesCapturedByWhite'));
  if (whiteCaptureRow) whiteSide.append(whiteCaptureRow);

  const blackSide = document.createElement('div');
  blackSide.className = 'captures-truth-side captures-truth-side-black';
  blackSide.setAttribute('aria-label', t('replay.whitePiecesCapturedByBlack'));
  if (blackCaptureRow) blackSide.append(blackCaptureRow);

  split.append(whiteSide, blackSide);
  target.append(split);
}

export function renderSplitPaneCaptures(
  pane: ReplayPaneHandle,
  captures: Record<Color, PieceRole[]>,
  bottomColor: Color,
): void {
  const topColor = bottomColor === 'white' ? 'black' : 'white';
  renderPaneCaptures(pane.topCapturesEl, captures[topColor], bottomColor);
  renderPaneCaptures(pane.capturesEl, captures[bottomColor], topColor);
}

export function createBoard(el: HTMLElement, orientation: Color): Api {
  return mountBoard(el, {
    // Read once at mount; chessground then glides fen diffs between plies.
    animation: chessgroundAnimation(),
    coordinates: false,
    coordinatesOnSquares: false,
    fen: '8/8/8/8/8/8/8/8',
    orientation,
    movable: { free: false, color: undefined, dests: new Map() },
    draggable: { enabled: false },
    selectable: { enabled: false },
    premovable: { enabled: false },
    viewOnly: true,
  });
}

/** Compute algebraic square (e.g., "e4") from a click event on a chessground
 *  inner cg-board element. cg-board is rendered at full width of cg-wrap and
 *  matches the visible board exactly, unlike the outer .replay-board parent
 *  which can be wider/taller due to padding. Returns null if click is off the
 *  board or if the element isn't found. */
export function squareFromCgBoardClick(
  boardEl: HTMLElement,
  e: MouseEvent,
  orientation: Color,
): string | null {
  const cg = boardEl.querySelector('cg-board') as HTMLElement | null;
  if (!cg) return null;
  const rect = cg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  const fileIdx = Math.floor((x / rect.width) * 8);
  const rankIdx = Math.floor((y / rect.height) * 8);
  const fileChar =
    orientation === 'white'
      ? String.fromCharCode(97 + fileIdx)
      : String.fromCharCode(97 + (7 - fileIdx));
  const rankNum = orientation === 'white' ? 8 - rankIdx : 1 + rankIdx;
  if (fileChar < 'a' || fileChar > 'h' || rankNum < 1 || rankNum > 8) return null;
  return `${fileChar}${rankNum}`;
}

export function setBoardFromView(
  api: Api,
  view: PlayerView,
  orientation: Color,
  animate = true,
): void {
  const lastMove = view.lastMove ? ([view.lastMove.from, view.lastMove.to] as cg.Key[]) : undefined;
  api.set({
    // Passed explicitly on every set so a suppressed (fogged-side) move can't
    // leave animation disabled for the next allowed one. See the caller in
    // replay.ts: a POV pane animates only its OWN side's moves, because gliding
    // the fogged opponent implies a redacted origin square (board-anim.ts #158).
    animation: { enabled: animate },
    fen: boardFen(view.board),
    lastMove,
    highlight: {
      custom: hiddenSquareClasses(view, orientation, { preserveFogOnFinished: true }),
      lastMove: true,
    },
  });
}

export function setBoardFromState(api: Api, state: GameState, animate = true): void {
  const lastMove = state.lastMove
    ? ([state.lastMove.from, state.lastMove.to] as cg.Key[])
    : undefined;
  api.set({
    animation: { enabled: animate },
    fen: boardFen(state.board),
    lastMove,
    highlight: { custom: new Map(), lastMove: true },
  });
}

export function revealKingCaptureForLoser(
  view: PlayerView,
  lastMove: Move,
  attacker: Piece,
): PlayerView {
  const visible = new Set(view.visibleSquares);
  const board = { ...view.board };
  visible.add(lastMove.to);
  visible.add(lastMove.from);
  board[lastMove.to] = attacker;
  delete board[lastMove.from];
  return {
    ...view,
    board,
    visibleSquares: [...visible].sort() as Square[],
    lastMove,
  };
}
