// A Crazyhouse Xiangqi study chapter (or a bare /embed/line) on the shared
// embed card: the chapter's mainline replayed through the kernel from its root
// (the standard start when the chapter carries no rootFen), the board drawn by
// the live renderer (xiangqiBoardSvg through crazyhouse-xiangqi-view.ts) and
// each hand as the game room's pocket above and below it. The card owns the
// seat rows, the score sheet and the stepper; this owns the board, the hands
// and the ply cursor, like mountFortressXiangqiReplayBoard. The hands' band
// height is EMBED_HAND_BAND_RATIO in embed/embed-card.ts.
//
// Tokens are the FSF UCI the study tree stores (crazyhouse-xiangqi-tree-adapter):
// a board move is `h3e3`, a drop is `P@e5` (B = elephant).
import './live-xiangqi.css';
import './drop-reserve.css';
import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiMoveFromUci,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
  isCrazyhouseXiangqiLegalMove,
  oppositeCrazyhouseXiangqiColor,
  parseCrazyhouseXiangqiFen,
} from '@mistboard/game';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
} from './crazyhouse-xiangqi-view.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { animateXiangqiBoardMove, xiangqiBoardSvg } from './xiangqi-board.js';

export type CrazyhouseXiangqiReplayLine = {
  states: CrazyhouseXiangqiGameState[];
  played: CrazyhouseXiangqiMove[];
};

/**
 * Replay a chapter's mainline as far as the kernel accepts it. A token it
 * refuses (unparseable, illegal, or after the game ended) ends the line there
 * rather than drawing a position that never happened. Null when the root FEN
 * itself does not parse.
 */
export function replayCrazyhouseXiangqiLine(
  rootFen: string | undefined,
  tokens: readonly string[],
): CrazyhouseXiangqiReplayLine | null {
  let root: CrazyhouseXiangqiGameState;
  if (rootFen) {
    const parsed = parseCrazyhouseXiangqiFen(rootFen, 'study-embed');
    if (!parsed.ok) return null;
    root = parsed.state;
  } else {
    root = createInitialCrazyhouseXiangqiState('study-embed');
  }
  const states: CrazyhouseXiangqiGameState[] = [root];
  const played: CrazyhouseXiangqiMove[] = [];
  for (const token of tokens) {
    const move = crazyhouseXiangqiMoveFromUci(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    // applyCrazyhouseXiangqiMove throws on an illegal move, so ask first.
    if (before.status.type !== 'playing' || !isCrazyhouseXiangqiLegalMove(before, move)) break;
    states.push(applyCrazyhouseXiangqiMove(before, move));
    played.push(move);
  }
  return { states, played };
}

export function mountCrazyhouseXiangqiReplayBoard(
  host: HTMLElement,
  line: CrazyhouseXiangqiReplayLine,
  options: { perspective?: CrazyhouseXiangqiColor } = {},
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  const { states, played } = line;
  const total = played.length;
  const perspective = options.perspective ?? 'red';
  const topColor = oppositeCrazyhouseXiangqiColor(perspective);

  const frame = document.createElement('div');
  frame.className = 'chx-embed-board';
  const hand = (owner: CrazyhouseXiangqiColor): HTMLElement => {
    const band = document.createElement('div');
    band.className = 'chx-embed-hand-band';
    const pocket = document.createElement('div');
    pocket.className = 'chx-embed-hand';
    pocket.dataset.owner = owner;
    band.append(pocket);
    frame.append(band);
    return pocket;
  };
  const topHand = hand(topColor);
  const board = document.createElement('div');
  board.className = 'chx-embed-board-svg';
  frame.append(board);
  const bottomHand = hand(perspective);
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    const view = getCrazyhouseXiangqiPlayerView(states[index]!, perspective);
    board.innerHTML = xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), perspective, {
      interactive: false,
      selectedSquare: null,
      draggingFrom: null,
      coordinates: false,
      lastDropSquare: crazyhouseXiangqiLastDrop(view),
    });
    // The game room's pocket: a slot for every droppable role, the ones held
    // none of faded in place, a count badge from two up.
    fillCrazyhouseXiangqiReserve(topHand, view, topColor, { pocket: true });
    fillCrazyhouseXiangqiReserve(bottomHand, view, perspective, { pocket: true });
  };
  const render = (animateFrom?: number): void => {
    paint();
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      // A drop has no origin square to glide from; it just appears.
      if (move && !isCrazyhouseXiangqiDropMove(move)) {
        animateXiangqiBoardMove(board, move, perspective, { reverse: !forward });
      }
    }
    hooks.onPlyChange?.(index, total);
  };
  // The reader's board theme and piece set, changed in another tab or the
  // settings sheet, repaint the frame as they do the live board.
  const onAppearance = (): void => paint();
  window.addEventListener(xiangqiAppearanceChangedEvent, onAppearance);
  render();

  return {
    destroy: () => {
      window.removeEventListener(xiangqiAppearanceChangedEvent, onAppearance);
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      const from = index;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render(from);
    },
    plyCount: () => total,
    moveEntries: () =>
      played.map((move, i) => ({ ply: i + 1, label: crazyhouseXiangqiMoveLabel(move) })),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
