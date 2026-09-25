// A Fortress Xiangqi study chapter on the shared embed card: the chapter's
// mainline replayed through the kernel from its root (the standard start when
// the chapter carries no rootFen), drawn by the live renderer with both hands
// as pockets above and below the board. The card owns the seat rows, the score
// sheet and the stepper; this owns the board, the hands and the ply cursor,
// like mountBanqiReplayBoard.
//
// Tokens are the FSF UCI the study tree stores (fortress-xiangqi-tree-adapter):
// a board move is `d1b3`, a drop is `N@f4`, and the treasure drops as `Q@e5`.
import {
  applyFortressXiangqiMove,
  createInitialFortressXiangqiState,
  type FortressXiangqiColor,
  type FortressXiangqiGameState,
  type FortressXiangqiMove,
  fsfUciToFortressXiangqiMove,
  getFortressXiangqiPlayerView,
  isFortressXiangqiDropMove,
  oppositeFortressXiangqiColor,
  parseFortressXiangqiFen,
} from '@mistboard/game';
import './drop-reserve.css';
import {
  animateFortressXiangqiBoardMove,
  installFortressXiangqiBoardStyles,
  renderFortressXiangqiBoardSvg,
} from './fortress-xiangqi-render.js';
import { fillFortressXiangqiReserve, fortressXiangqiMoveLabel } from './fortress-xiangqi-view.js';

export type FortressXiangqiReplayLine = {
  states: FortressXiangqiGameState[];
  played: FortressXiangqiMove[];
};

/**
 * Replay a chapter's mainline as far as the kernel accepts it. A token it
 * refuses (unparseable, illegal, or after the game ended) ends the line there
 * rather than drawing a position that never happened. Null when the root FEN
 * itself does not parse.
 */
export function replayFortressXiangqiLine(
  rootFen: string | undefined,
  tokens: readonly string[],
): FortressXiangqiReplayLine | null {
  let root: FortressXiangqiGameState;
  if (rootFen) {
    const parsed = parseFortressXiangqiFen(rootFen, 'study-embed');
    if (!parsed.ok) return null;
    root = parsed.state;
  } else {
    root = createInitialFortressXiangqiState('study-embed');
  }
  const states: FortressXiangqiGameState[] = [root];
  const played: FortressXiangqiMove[] = [];
  for (const token of tokens) {
    const move = fsfUciToFortressXiangqiMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    const next = applyFortressXiangqiMove(before, move);
    if (next === before) break;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

/** Each hand's band height as a share of the board's width: the pocket piece is
 *  62/516 of the board (drop-reserve.css, the review pocket), plus its gap. The
 *  card sizes the board column from one aspect ratio, so the hands have to
 *  scale with the board for that ratio to hold (embed.css keeps the number). */
export const FORTRESS_EMBED_HAND_RATIO = 0.13;

export function mountFortressXiangqiReplayBoard(
  host: HTMLElement,
  line: FortressXiangqiReplayLine,
  options: { perspective?: FortressXiangqiColor } = {},
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  installFortressXiangqiBoardStyles();
  const { states, played } = line;
  const total = played.length;
  const perspective = options.perspective ?? 'red';
  const topColor = oppositeFortressXiangqiColor(perspective);

  const frame = document.createElement('div');
  frame.className = 'fxq-embed-board';
  const topHand = document.createElement('div');
  topHand.className = 'fxq-embed-hand';
  topHand.dataset.owner = topColor;
  const board = document.createElement('div');
  board.className = 'fxq-embed-board-svg';
  const bottomHand = document.createElement('div');
  bottomHand.className = 'fxq-embed-hand';
  bottomHand.dataset.owner = perspective;
  frame.append(topHand, board, bottomHand);
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    const view = getFortressXiangqiPlayerView(states[index]!, perspective);
    board.innerHTML = renderFortressXiangqiBoardSvg(view, perspective);
    // Every droppable role, the ones held none of ghosted: the pocket keeps
    // its width as pieces come and go, the way the review rail draws it.
    fillFortressXiangqiReserve(topHand, view, topColor, { allRoles: true });
    fillFortressXiangqiReserve(bottomHand, view, perspective, { allRoles: true });
  };
  const render = (animateFrom?: number): void => {
    paint();
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      // A drop has no origin square to glide from; it just appears.
      if (move && !isFortressXiangqiDropMove(move)) {
        animateFortressXiangqiBoardMove(board, move, perspective, { reverse: !forward });
      }
    }
    hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => {
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      const from = index;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render(from);
    },
    plyCount: () => total,
    moveEntries: () =>
      played.map((move, i) => ({ ply: i + 1, label: fortressXiangqiMoveLabel(move) })),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
