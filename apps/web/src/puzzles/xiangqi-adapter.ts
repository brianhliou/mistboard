/**
 * Puzzle-board adapter for standard Xiangqi (the mined real-game corpus).
 * Renders on the canonical 9x10 intersection board (xiangqi-board.ts, shared
 * with the live room / replay / analysis). No reserves, so it paints straight
 * onto the board host like Jungle; selection state lives on the shared session
 * and the pure xiangqiClickResult decides click-to-move.
 *
 * This is also the only adapter (so far) exposing createAnalysis: the
 * post-completion local-engine panel. It maps to the ceval 'xiangqi' variant
 * and we can serialize its state to an engine FEN (standardXiangqiEngineFen).
 * As each family gets its own engine (Fortress already has a ceval variant;
 * Mini/Jungle will follow), give its adapter a createAnalysis too.
 */

import {
  applyStandardXiangqiMove,
  coordOf,
  fsfUciToXiangqiSquares,
  getStandardXiangqiPlayerView,
  type StandardXiangqiPlayerView,
  standardXiangqiEngineFen,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import '../live-xiangqi.css';
import { t } from '../i18n/catalog.js';
import { engineArrowsFromLines } from '../review/engine/engine-arrows.js';
import { createEnginePanel } from '../review/engine/engine-panel.js';
import { installBoardDrag } from '../variant-tenant/board-drag.js';
import {
  animateXiangqiBoardMove,
  XIANGQI_PIECE_SIZE,
  type XiangqiBoardArrow,
  xiangqiArrowSvg,
  xiangqiBoardSvg,
  xiangqiClickResult,
  xiangqiPieceGhostSvg,
} from '../xiangqi-board.js';
import { drawsCrossedSoldier } from '../xiangqi-crossed-soldier.js';
import {
  activeTurn,
  isReplayLive,
  type PuzzleAnalysisController,
  type PuzzleBoardAdapter,
  type PuzzleBoardContext,
  type PuzzleDetail,
  type PuzzleMove,
  type PuzzleSession,
} from './adapter.js';

function paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void {
  const { session } = ctx;
  const perspective = xiangqiPerspective(session);
  const view = getStandardXiangqiPlayerView(ctx.displayState as XiangqiGameState, perspective);
  const host = document.createElement('div');
  // xiangqi-live-board carries the canonical 552:612 aspect + corner clipping;
  // puzzle-xiangqi-board binds its footprint to the puzzle height budget.
  host.className = 'xiangqi-live-board puzzle-xiangqi-board';
  host.innerHTML = xiangqiBoardSvg(view, perspective, {
    interactive: true,
    // The click layer derives target hints from the view + selection, so drop
    // the selection while scrubbing history instead of painting stale targets.
    selectedSquare: isReplayLive(session) ? (session.selectedSquare as XiangqiSquare | null) : null,
    draggingFrom: session.draggingFrom as XiangqiSquare | null,
  });
  board.append(host);
  installBoardDrag({
    board: host,
    ghostSizePx: XIANGQI_PIECE_SIZE,
    onSquareClick: (square) => {
      if (!isReplayLive(session)) return;
      void handleXiangqiBoardClick(ctx, square as XiangqiSquare);
    },
    canDragFrom: (square) => canDragXiangqiPiece(session, square as XiangqiSquare),
    ghostHtml: (square) => {
      const piece = view.board[square as XiangqiSquare];
      if (!piece) return null;
      return xiangqiPieceGhostSvg(
        piece,
        drawsCrossedSoldier(piece, coordOf(square as XiangqiSquare).rank),
      );
    },
    onDragStart: (from) => {
      session.selectedSquare = from as XiangqiSquare;
      session.selectedDrop = null;
      session.draggingFrom = from as XiangqiSquare;
      ctx.renderSession();
    },
    onDrop: (from, to) => {
      void handleXiangqiBoardDrop(ctx, from as XiangqiSquare, (to as XiangqiSquare | null) ?? null);
    },
  });
}

function xiangqiPerspective(session: PuzzleSession): XiangqiColor {
  return session.puzzle.sideToMove ?? 'red';
}

function xiangqiLiveView(session: PuzzleSession): StandardXiangqiPlayerView {
  return getStandardXiangqiPlayerView(
    session.state as XiangqiGameState,
    xiangqiPerspective(session),
  );
}

function canDragXiangqiPiece(session: PuzzleSession, square: XiangqiSquare): boolean {
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return false;
  }
  const view = xiangqiLiveView(session);
  const piece = view.board[square];
  // Any of your pieces can be lifted on your turn, even one with no legal move:
  // it shows the origin highlight + faded source, no destination dots, and snaps
  // back on drop. The tap sibling lives in handleXiangqiBoardClick.
  return !!piece && piece.color === activeTurn(session);
}

async function handleXiangqiBoardClick(
  ctx: PuzzleBoardContext,
  square: XiangqiSquare,
): Promise<void> {
  const { session } = ctx;
  if (
    session.submitting ||
    session.revealed ||
    session.state.status.type !== 'playing' ||
    !isReplayLive(session)
  ) {
    return;
  }
  const view = xiangqiLiveView(session);
  const result = xiangqiClickResult(
    view,
    activeTurn(session),
    session.selectedSquare as XiangqiSquare | null,
    square,
  );
  if (result.kind === 'move') {
    await ctx.submitMove(result.move);
    return;
  }
  if (result.kind === 'select') {
    session.selectedSquare = result.square;
    session.selectedDrop = null;
    session.feedback = { kind: 'neutral', text: `${result.square} selected.` };
  } else if (result.kind === 'clear') {
    // xiangqiClickResult only 'select's a piece that has a legal move. Let the
    // solver also tap-pick one of their pieces that has no legal move (origin
    // highlight, no dest dots) instead of clearing — the tap sibling of
    // canDragXiangqiPiece.
    const piece = view.board[square];
    const ownDeadPiece =
      !!piece && piece.color === activeTurn(session) && square !== session.selectedSquare;
    if (ownDeadPiece) {
      session.selectedSquare = square;
      session.selectedDrop = null;
      session.feedback = { kind: 'neutral', text: `${square} selected.` };
    } else {
      session.selectedSquare = null;
      session.selectedDrop = null;
      session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
    }
  }
  ctx.renderSession();
}

async function handleXiangqiBoardDrop(
  ctx: PuzzleBoardContext,
  from: XiangqiSquare,
  to: XiangqiSquare | null,
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
  const move = xiangqiLiveView(session).legalMoves.find(
    (candidate) => candidate.from === from && candidate.to === to,
  );
  if (move) {
    await ctx.submitMove(move);
    return;
  }
  session.selectedSquare = null;
  session.selectedDrop = null;
  session.feedback = { kind: 'neutral', text: t('puzzle.findBestMove') };
  ctx.renderSession();
}

function formatXiangqiEngineMove(uci: string): string {
  const squares = fsfUciToXiangqiSquares(uci);
  return squares ? `${squares.from}-${squares.to}` : uci;
}

// Post-completion engine analysis: an on/off toggle, eval + principal-variation
// lines, and the engine's candidate moves drawn as arrows on the puzzle board.
// Reuses the review board's ceval stack unchanged; the only puzzle-specific bit
// is feeding the engine a FEN of the displayed position — mined puzzles begin
// mid-game, so there is no game-start move list for the engine to replay to it.
// The "Open in analysis board" link is separate (puzzleAnalysisHref): it seeds
// the full board from the puzzle's own start position plus the played line.
function createPuzzleAnalysis(): PuzzleAnalysisController {
  let arrows: XiangqiBoardArrow[] = [];
  let boardHost: HTMLElement | null = null;
  let perspective: XiangqiColor = 'red';
  let lastFen: string | null = null;

  const paintArrows = (): void => {
    const layer = boardHost?.querySelector('.xq-live-arrows');
    if (layer)
      layer.innerHTML = arrows.map((arrow) => xiangqiArrowSvg(arrow, perspective)).join('');
  };

  const panel = createEnginePanel({
    variant: 'xiangqi',
    formatPvMove: formatXiangqiEngineMove,
    onLines: (lines) => {
      arrows = lines?.length ? engineArrowsFromLines(lines) : [];
      paintArrows();
    },
  });

  // Jump to the full /analysis/xiangqi board seeded from the puzzle's START
  // position with the whole solution line as a navigable tree (?fen= the start,
  // ?moves= the played line), so the board opens where the puzzle began and the
  // solver can step through the moves — not just a snapshot of the end.
  const openLink = document.createElement('a');
  openLink.className = 'puzzle-analysis-open-link';
  openLink.textContent = 'Open in analysis board';

  return {
    // The engine bar and the jump-out link live in different spots on the puzzle
    // column (engine at the top of the move list, link below the scrub controls),
    // so they are handed back as two elements rather than one bundled section.
    engineEl: panel.el,
    openLinkEl: openLink,
    refresh(session, displayState, host) {
      boardHost = host;
      perspective = xiangqiPerspective(session);
      // Re-apply the last-known arrows onto the rebuilt board immediately (the
      // board's arrow layer is regenerated empty on every render).
      paintArrows();
      const fen = puzzleAnalysisFen(displayState as XiangqiGameState);
      openLink.href = puzzleAnalysisHref(session);
      if (fen !== lastFen) {
        lastFen = fen;
        // setPosition clears arrows (onLines(null)) then re-evaluates if the
        // engine is on; a no-op while the engine is off beyond storing the FEN.
        panel.setPosition([], fen);
      }
    },
    dispose() {
      panel.dispose();
    },
  };
}

// standardXiangqiEngineFen writes a 'w' fallback turn for a FINISHED state (a
// finished game has no side to move) — but the solved mate is exactly the
// position this panel shows. "Red to move" over a mated black is an illegal
// diagram (the mover could capture the general): the engine evaluates the
// wrong side and parseStandardXiangqiFen rejects the analysis link, silently
// opening the start position. Restore the real continuation turn: the side
// that did not win is to move in the final position.
// The "Open in analysis board" link. Seed the analysis board from the puzzle's
// START position (session.puzzle.initial — always the solver's turn, a legal
// 'playing' FEN, so no side-to-move fixup is needed) and pass the full played
// line as ?moves= coordinates. That reconstructs the whole puzzle as a
// navigable tree instead of dropping the solver at a single end snapshot.
// playedMoves holds the complete solution once the puzzle is complete (the
// accumulated attempt line on a solve, the fetched solution on a reveal); every
// standard-xiangqi puzzle move is a board move ({from,to}), never a drop.
function puzzleAnalysisHref(session: PuzzleSession): string {
  const fen = standardXiangqiEngineFen(session.puzzle.initial as XiangqiGameState);
  const moves = session.playedMoves
    .map((move) => ('drop' in move ? '' : `${move.from}-${move.to}`))
    .filter(Boolean)
    .join(' ');
  const params = new URLSearchParams({ fen });
  if (moves) params.set('moves', moves);
  return `/analysis/xiangqi?${params.toString()}`;
}

function puzzleAnalysisFen(state: XiangqiGameState): string {
  const fen = standardXiangqiEngineFen(state);
  if (state.status.type !== 'finished' || !state.status.winner) return fen;
  const parts = fen.split(' ');
  parts[1] = state.status.winner === 'red' ? 'b' : 'w';
  return parts.join(' ');
}

export const xiangqiPuzzleAdapter: PuzzleBoardAdapter = {
  variant: XIANGQI_SPEC_ID,
  labelKey: 'variant.xiangqi.name',
  markerId: 'xiangqi',
  paintBoard,
  animateMove: (board, session, move, opts) => {
    const host = board.querySelector<HTMLElement>('.puzzle-xiangqi-board') ?? board;
    animateXiangqiBoardMove(host, move as XiangqiMove, xiangqiPerspective(session), opts);
  },
  applyMove: (state, move) =>
    applyStandardXiangqiMove(state as XiangqiGameState, move as XiangqiMove),
  moveLabel: (move: PuzzleMove) => ('drop' in move ? `@${move.to}` : `${move.from}-${move.to}`),
  sideIconSvg: (puzzle: PuzzleDetail) =>
    xiangqiPieceGhostSvg({ color: puzzle.sideToMove ?? 'red', role: 'general' }),
  createAnalysis: createPuzzleAnalysis,
};
