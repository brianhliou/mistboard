/**
 * Puzzle-board adapters for the Mini Xiangqi family. Mini and Drop Mini share
 * the 7x7 mini renderer (Drop Mini via a mini-shaped board view plus
 * crazyhouse-style reserve strips), so both adapters are built from one
 * factory over the shared paint/interaction code.
 */

import {
  applyDropMiniXiangqiMove,
  applyMiniXiangqiOpenMove,
  DROP_MINI_XIANGQI_DROP_ROLES,
  DROP_MINI_XIANGQI_SPEC_ID,
  type DropMiniXiangqiDropRole,
  type DropMiniXiangqiGameState,
  type DropMiniXiangqiMove,
  getDropMiniXiangqiPlayerView,
  getMiniXiangqiOpenPlayerView,
  MINI_XIANGQI_SPEC_ID,
  type MiniXiangqiColor,
  type MiniXiangqiGameState,
  type MiniXiangqiMove,
  type MiniXiangqiSquare,
} from '@mistboard/game';
import '../drop-mini-xiangqi.css';
import {
  dropMiniXiangqiBoardMoves,
  dropMiniXiangqiBoardView,
  dropMiniXiangqiDropTargets,
  dropMiniXiangqiTargetMoves,
  fillDropMiniXiangqiReserve,
} from '../drop-mini-xiangqi-view.js';
import { t } from '../i18n/catalog.js';
import {
  animateMiniXiangqiBoardMove,
  installMiniXiangqiBoardStyles,
  MINI_XIANGQI_PIECE_PX,
  miniXiangqiPieceGhostSvg,
  renderMiniXiangqiBoardSvg,
} from '../live-mini-xiangqi-render.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
import { installHandDrag } from '../variant-tenant/hand-drag.js';
import {
  activeTurn,
  dropRoleLabel,
  isReplayLive,
  type PuzzleBoardAdapter,
  type PuzzleBoardContext,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleSession,
  type PuzzleState,
} from './adapter.js';

// Paint the interactive board (+ reserves for Drop Mini) and wire drag. Mini
// paints straight onto the board host; Drop Mini through a reserve shell.
function paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void {
  const { session } = ctx;
  const { boardView, dropView } = puzzleViews(session, ctx.displayState);
  const boardTarget = dropView ? renderPuzzleBoardShell(board, ctx, dropView) : board;
  const legalMoves = highlightedBoardMoves(session);
  boardTarget.innerHTML = renderMiniXiangqiBoardSvg(boardView, boardView.perspective, {
    interactive: true,
    showFog: false,
    selectedSquare: session.selectedSquare as MiniXiangqiSquare | null,
    legalMoves,
    draggingFrom: session.draggingFrom as MiniXiangqiSquare | null,
  });
  installBoardDrag({
    board: boardTarget,
    ghostSizePx: MINI_XIANGQI_PIECE_PX,
    onSquareClick: (square) => {
      if (!isReplayLive(session)) return;
      void handleBoardClick(ctx, square as MiniXiangqiSquare);
    },
    canDragFrom: (square) => canDragBoardPiece(session, square as MiniXiangqiSquare),
    ghostHtml: (square) => {
      const entry = boardView.board[square as MiniXiangqiSquare];
      if (entry?.shrouded !== false) return null;
      return miniXiangqiPieceGhostSvg(entry.piece);
    },
    onDragStart: (from) => {
      session.selectedSquare = from as MiniXiangqiSquare;
      session.selectedDrop = null;
      session.draggingFrom = from as MiniXiangqiSquare;
      ctx.renderSession();
    },
    onDrop: (from, to) => {
      void handleBoardDrop(
        ctx,
        from as MiniXiangqiSquare,
        (to as MiniXiangqiSquare | null) ?? null,
      );
    },
  });
}

function renderPuzzleBoardShell(
  host: HTMLElement,
  ctx: PuzzleBoardContext,
  view: ReturnType<typeof getDropMiniXiangqiPlayerView>,
): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'puzzle-board-shell board-shell drop-mini-reserve-container';
  const topReserve = document.createElement('div');
  topReserve.className = 'captures-strip captures-strip-top puzzle-board-reserve';
  topReserve.setAttribute('aria-label', 'Top reserve');
  const boardSurface = document.createElement('div');
  boardSurface.className = 'puzzle-board-surface';
  const bottomReserve = document.createElement('div');
  bottomReserve.className = 'captures-strip captures-strip-bottom puzzle-board-reserve';
  bottomReserve.setAttribute('aria-label', 'Bottom reserve');

  const bottom = view.perspective;
  const top = bottom === 'red' ? 'black' : 'red';
  fillPuzzleReserveStrip(topReserve, ctx, view, top, false);
  fillPuzzleReserveStrip(bottomReserve, ctx, view, bottom, true);

  shell.append(topReserve, boardSurface, bottomReserve);
  host.append(shell);
  return boardSurface;
}

function fillPuzzleReserveStrip(
  reserve: HTMLElement,
  ctx: PuzzleBoardContext,
  view: ReturnType<typeof getDropMiniXiangqiPlayerView>,
  color: MiniXiangqiColor,
  isBottom: boolean,
): void {
  const { session } = ctx;
  fillDropMiniXiangqiReserve(reserve, view, color, {
    interactive:
      isBottom &&
      color === activeTurn(session) &&
      session.state.status.type === 'playing' &&
      isReplayLive(session) &&
      !session.submitting,
    selectedRole:
      isBottom &&
      color === activeTurn(session) &&
      session.state.status.type === 'playing' &&
      isReplayLive(session) &&
      !session.submitting
        ? (session.selectedDrop as DropMiniXiangqiDropRole | null)
        : null,
    onSelect: (role) => {
      if (
        !isBottom ||
        color !== activeTurn(session) ||
        session.state.status.type !== 'playing' ||
        !isReplayLive(session)
      ) {
        return;
      }
      session.selectedDrop = session.selectedDrop === role ? null : role;
      session.selectedSquare = null;
      session.feedback = { kind: 'neutral', text: `${dropRoleLabel(role)} selected.` };
      ctx.renderSession();
    },
  });
  installHandDrag({
    hand: reserve,
    ghostSizePx: MINI_XIANGQI_PIECE_PX,
    isRole: isDropRole,
    canDragRole: (role) =>
      isBottom &&
      color === activeTurn(session) &&
      session.state.status.type === 'playing' &&
      isReplayLive(session) &&
      !session.submitting &&
      (view.hands[color][role] ?? 0) > 0,
    ghostHtml: (role) => miniXiangqiPieceGhostSvg({ color, role }),
    onDragStart: (role) => {
      if (
        !isBottom ||
        color !== activeTurn(session) ||
        session.state.status.type !== 'playing' ||
        !isReplayLive(session)
      ) {
        return;
      }
      session.selectedDrop = role;
      session.selectedSquare = null;
      session.draggingFrom = null;
      session.feedback = { kind: 'neutral', text: `${dropRoleLabel(role)} selected.` };
      ctx.renderSession();
    },
    onDrop: (role, to) => {
      void handleReserveDrop(ctx, role, to as MiniXiangqiSquare | null);
    },
  });
}

async function handleBoardClick(ctx: PuzzleBoardContext, square: MiniXiangqiSquare): Promise<void> {
  const { session } = ctx;
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return;
  }
  if (session.selectedDrop) {
    const drop = session.selectedDrop as DropMiniXiangqiDropRole;
    const targets = dropTargetsFor(session, drop);
    if (targets.includes(square)) {
      await ctx.submitMove({ drop, to: square });
      return;
    }
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: 'Reserve cleared.' };
    ctx.renderSession();
    return;
  }

  if (session.selectedSquare) {
    const move = boardMovesFor(session, session.selectedSquare as MiniXiangqiSquare).find(
      (m) => m.to === square,
    );
    if (move) {
      await ctx.submitMove(move);
      return;
    }
  }

  if (isSelectablePiece(session, square)) {
    session.selectedSquare = square;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: `${square} selected.` };
  } else {
    session.selectedSquare = null;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  }
  ctx.renderSession();
}

async function handleBoardDrop(
  ctx: PuzzleBoardContext,
  from: MiniXiangqiSquare,
  to: MiniXiangqiSquare | null,
): Promise<void> {
  const { session } = ctx;
  session.draggingFrom = null;
  if (
    session.submitting ||
    session.state.status.type !== 'playing' ||
    !to ||
    !isReplayLive(session)
  ) {
    session.selectedSquare = null;
    session.selectedDrop = null;
    ctx.renderSession();
    return;
  }

  const move = boardMovesFor(session, from).find((candidate) => candidate.to === to);
  if (move) {
    await ctx.submitMove(move);
    return;
  }

  session.selectedSquare = null;
  session.selectedDrop = null;
  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

async function handleReserveDrop(
  ctx: PuzzleBoardContext,
  role: DropMiniXiangqiDropRole,
  to: MiniXiangqiSquare | null,
): Promise<void> {
  const { session } = ctx;
  session.draggingFrom = null;
  session.selectedSquare = null;
  session.selectedDrop = null;
  if (
    session.submitting ||
    session.state.status.type !== 'playing' ||
    !to ||
    !isReplayLive(session)
  ) {
    ctx.renderSession();
    return;
  }

  if (dropTargetsFor(session, role).includes(to)) {
    await ctx.submitMove({ drop: role, to });
    return;
  }

  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

function puzzleViews(
  session: PuzzleSession,
  state: PuzzleState = session.state,
): {
  boardView: ReturnType<typeof getMiniXiangqiOpenPlayerView>;
  dropView: ReturnType<typeof getDropMiniXiangqiPlayerView> | null;
} {
  const turn = session.puzzle.sideToMove ?? activeTurn(session);
  if (session.puzzle.variant === DROP_MINI_XIANGQI_SPEC_ID) {
    const dropView = getDropMiniXiangqiPlayerView(state as DropMiniXiangqiGameState, turn);
    return { boardView: dropMiniXiangqiBoardView(dropView), dropView };
  }
  return {
    boardView: getMiniXiangqiOpenPlayerView(state as MiniXiangqiGameState, turn),
    dropView: null,
  };
}

function highlightedBoardMoves(session: PuzzleSession): MiniXiangqiMove[] {
  if (!isReplayLive(session)) return [];
  if (session.selectedDrop)
    return dropMiniXiangqiTargetMoves(
      dropTargetsFor(session, session.selectedDrop as DropMiniXiangqiDropRole),
    );
  if (!session.selectedSquare) return [];
  return boardMovesFor(session, session.selectedSquare as MiniXiangqiSquare);
}

function boardMovesFor(session: PuzzleSession, from: MiniXiangqiSquare): MiniXiangqiMove[] {
  const { boardView, dropView } = puzzleViews(session);
  if (dropView) return dropMiniXiangqiBoardMoves(dropView, from);
  return boardView.legalMoves.filter((move) => move.from === from);
}

function dropTargetsFor(
  session: PuzzleSession,
  role: DropMiniXiangqiDropRole,
): MiniXiangqiSquare[] {
  const { dropView } = puzzleViews(session);
  return dropView ? dropMiniXiangqiDropTargets(dropView, role) : [];
}

function isSelectablePiece(session: PuzzleSession, square: MiniXiangqiSquare): boolean {
  const { boardView } = puzzleViews(session);
  const entry = boardView.board[square];
  return entry?.shrouded === false && entry.piece.color === activeTurn(session);
}

function canDragBoardPiece(session: PuzzleSession, square: MiniXiangqiSquare): boolean {
  return (
    !session.submitting &&
    session.state.status.type === 'playing' &&
    isReplayLive(session) &&
    isSelectablePiece(session, square)
  );
}

function isDropRole(value: string): value is DropMiniXiangqiDropRole {
  return (DROP_MINI_XIANGQI_DROP_ROLES as readonly string[]).includes(value);
}

function dropRoleSymbol(role: DropMiniXiangqiDropRole): string {
  switch (role) {
    case 'chariot':
      return 'R';
    case 'horse':
      return 'H';
    case 'cannon':
      return 'C';
    case 'soldier':
      return 'S';
  }
}

function animateMove(
  board: HTMLElement,
  session: PuzzleSession,
  move: { from: string; to: string },
  opts: { reverse?: boolean },
): void {
  // Mini + Drop Mini share the mini renderer; the drop shell paints onto
  // .puzzle-board-surface, plain mini straight onto the board host.
  const host = board.querySelector<HTMLElement>('.puzzle-board-surface') ?? board;
  animateMiniXiangqiBoardMove(
    host,
    move as { from: MiniXiangqiSquare; to: MiniXiangqiSquare },
    session.puzzle.sideToMove ?? activeTurn(session),
    opts,
  );
}

function moveLabel(move: PuzzleMove): string {
  if ('drop' in move) return `${dropRoleSymbol(move.drop as DropMiniXiangqiDropRole)}@${move.to}`;
  return `${move.from}-${move.to}`;
}

function sideIconSvg(puzzle: PuzzleDetail): string {
  return miniXiangqiPieceGhostSvg({ color: puzzle.sideToMove ?? 'red', role: 'general' });
}

function miniFamilyAdapter(
  variant: typeof MINI_XIANGQI_SPEC_ID | typeof DROP_MINI_XIANGQI_SPEC_ID,
  labelKey: PuzzleBoardAdapter['labelKey'],
  markerId: PuzzleBoardAdapter['markerId'],
): PuzzleBoardAdapter {
  return {
    variant,
    labelKey,
    markerId,
    installStyles: installMiniXiangqiBoardStyles,
    paintBoard,
    animateMove,
    applyMove: (state, move) =>
      variant === DROP_MINI_XIANGQI_SPEC_ID
        ? applyDropMiniXiangqiMove(state as DropMiniXiangqiGameState, move as DropMiniXiangqiMove)
        : applyMiniXiangqiOpenMove(state as MiniXiangqiGameState, move as MiniXiangqiMove),
    moveLabel,
    sideIconSvg,
  };
}

export const miniXiangqiPuzzleAdapter = miniFamilyAdapter(
  MINI_XIANGQI_SPEC_ID,
  'variant.miniXiangqi.name',
  'mini-xiangqi',
);

export const dropMiniXiangqiPuzzleAdapter = miniFamilyAdapter(
  DROP_MINI_XIANGQI_SPEC_ID,
  'variant.dropMiniXiangqi.name',
  'drop-mini-xiangqi',
);
