import { DISPLAY_PREFERENCES_CHANGE_EVENT } from '../display-preferences.js';
import '../gomoku-board.css';
import {
  type GomokuColor,
  type GomokuMove,
  type GomokuOpening,
  type GomokuRoomState,
  parseGomokuMove,
} from '@mistboard/game';
import type { RapfiPosition } from '../engine/rapfi.js';
import type { GomokuBoardMarker } from '../gomoku-board.js';
import { t } from '../i18n/catalog.js';
import { formatGomokuEvalCompact } from './engine/gomoku-eval-format.js';
import type { NodeShape } from './game-tree.js';
import { createGomokuReviewBoard } from './gomoku-review-board.js';
import { type GomokuReviewView, makeGomokuTreeAdapter } from './gomoku-tree-adapter.js';
import {
  mountTreeReview,
  type TreePresentation,
  type TreeReviewConfig,
  type TreeReviewHandle,
} from './tree-review.js';

const ENGINE_CHOICE = 'mistboard.review.gomoku.localEngine';

export type GomokuReviewConfig = Omit<
  TreeReviewConfig<GomokuMove, GomokuRoomState>,
  'localEngine'
> & {
  opening?: GomokuOpening;
};

/** Rapfi's existing validated JSON dialect, with the current node's entire
 * public board. Per-position requests preserve dealt roots and White turns. */
export function gomokuReviewPosition(truth: GomokuRoomState): string {
  const position: RapfiPosition = {
    turn: truth.status.type === 'playing' && truth.status.turn === 'white' ? 2 : 1,
    stones: [],
  };
  const stones: RapfiPosition['stones'][number][] = [];
  truth.board.forEach((color, index) => {
    if (color)
      stones.push({ x: index % 15, y: Math.floor(index / 15), player: color === 'black' ? 1 : 2 });
  });
  return JSON.stringify({ ...position, stones });
}

function readEngineChoice(): boolean {
  try {
    return window.localStorage.getItem(ENGINE_CHOICE) === 'on';
  } catch {
    return false;
  }
}
function writeEngineChoice(on: boolean): void {
  try {
    window.localStorage.setItem(ENGINE_CHOICE, on ? 'on' : 'off');
  } catch {
    /* The current switch still works. */
  }
}

/** Capability only. A gated route/review owner may mount it; no catalog,
 * offering, menu link or route is registered here. */
export function mountGomokuReview(root: HTMLElement, config: GomokuReviewConfig): TreeReviewHandle {
  const chapterRoot = config.root?.truth;
  const presentation: TreePresentation<
    GomokuMove,
    GomokuRoomState,
    GomokuReviewView,
    GomokuColor,
    NodeShape,
    GomokuBoardMarker
  > = {
    adapter: makeGomokuTreeAdapter(chapterRoot ?? config.opening),
    hideAcpl: true,
    engine: {
      panelVariant: 'gomoku',
      positionMode: 'fen',
      fen: gomokuReviewPosition,
      canEvaluatePosition: (truth) => truth.status.type === 'playing',
      formatPvMove: (uci) => uci,
      engineMarkersFromLines: (lines) => {
        const moves: GomokuMove[] = [];
        for (const uci of lines[0]?.pvUci ?? []) {
          const move = parseGomokuMove(uci);
          if (!move) break;
          moves.push(move);
        }
        return moves.length
          ? [
              { kind: 'pv', moves },
              { kind: 'best', square: moves[0]!.to },
            ]
          : [];
      },
      bestMoveMarker: (best) =>
        best && parseGomokuMove(best) ? [{ kind: 'best', square: best }] : [],
      showStoredBestWhenOff: false,
    },
    // Terminal scores encode the known result, not a distance to a future five.
    moveEvalVisible: (truth) => truth.status.type === 'playing',
    formatEval: formatGomokuEvalCompact,
    moveGlyphMarker: (move, glyph) => ({
      kind: 'glyph',
      square: move.to,
      text: glyph.text,
      tone: glyph.tone,
    }),
    formatBestMove: (uci) => uci,
    boardHostClassName: 'gomoku-live-board',
    boardWrapClassName: 'review-board-host',
    defaultBoardAriaLabel: t('live.gomokuBoard'),
    boardAspect: 1,
    boardCols: 15,
    fixedOrientation: true,
    appearanceEvent: DISPLAY_PREFERENCES_CHANGE_EVENT,
    perspective: (flipped) => (flipped ? 'white' : 'black'),
    seatFor: (view) => (view.status.type === 'playing' ? view.status.turn : null),
    createBoard: createGomokuReviewBoard,
    animateMove: () => {},
    shapeToArrow: (shape) => shape,
    shapeToMarker: (shape) => ({ kind: 'circle', square: shape.orig }),
  };
  const handle = mountTreeReview(root, presentation, {
    seatColors: { red: 'black', black: 'white' },
    firstMover:
      (chapterRoot?.status.type === 'playing' ? chapterRoot.status.turn : config.opening?.turn) ===
      'white'
        ? 'black'
        : 'red',
    ...config,
    localEngine: { enabled: readEngineChoice(), onToggle: writeEngineChoice },
  });
  // Scope ink to this mount's chrome, so reusing the host for another variant
  // cannot carry Gomoku's Black-first palette into that page.
  for (const child of root.children) {
    if (child instanceof HTMLElement) child.dataset.seatInkFamily = 'gomoku';
  }
  return handle;
}
