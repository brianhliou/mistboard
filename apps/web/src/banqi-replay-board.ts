// A banqi study chapter on the shared embed card: the chapter's dealt root
// (rootFen, the deal included) replayed through the kernel, drawn by the same
// renderer the room, watch and review pages use. The card owns the seat rows,
// the score sheet and the stepper; this owns the board and the ply cursor,
// like mountAtomicXiangqiReplayBoard.
import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  banqiTruthView,
  parseBanqiFen,
} from '@mistboard/game';
import {
  animateBanqiBoardMove,
  installBanqiBoardStyles,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';

export type BanqiReplayBoardSpec = {
  /** The chapter's dealt FEN (six fields); the deal is what makes the moves replayable. */
  rootFen: string;
  /** Mainline tokens, `from+to`, a flip spelled as `b2b2`. */
  moves: readonly string[];
  perspective?: 'red' | 'black';
};

const TOKEN = /^([a-h][1-4])([a-h][1-4])$/;

function tokenToMove(token: string): BanqiMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as BanqiSquare, to: m[2] as BanqiSquare } : null;
}

/** The label the review sheet uses: a flip is its square, a move is from-to. */
export function banqiMoveLabel(move: BanqiMove): string {
  return move.from === move.to ? move.from : `${move.from}-${move.to}`;
}

export function mountBanqiReplayBoard(
  host: HTMLElement,
  spec: BanqiReplayBoardSpec,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  installBanqiBoardStyles();
  const parsed = parseBanqiFen(spec.rootFen);
  if (!parsed.ok) throw new Error(`banqi replay: ${parsed.error}`);
  // Replay as far as the kernel accepts; a token it refuses ends the line
  // there rather than drawing a position that never happened.
  const states: BanqiGameState[] = [parsed.state];
  const labels: string[] = [];
  const played: BanqiMove[] = [];
  for (const token of spec.moves) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1];
    const next = applyBanqiMove(before, move);
    if (next === before) break;
    states.push(next);
    played.push(move);
    labels.push(banqiMoveLabel(move));
  }
  const total = labels.length;
  const perspective = spec.perspective ?? 'red';

  const frame = document.createElement('div');
  frame.className = 'banqi-replay-board';
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    frame.innerHTML = renderBanqiBoardSvg(banqiTruthView(states[index]), perspective);
  };
  const render = (animateFrom?: number): void => {
    paint();
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      if (move) animateBanqiBoardMove(frame, move, { reverse: !forward });
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
    moveEntries: () => labels.map((label, i) => ({ ply: i + 1, label })),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
