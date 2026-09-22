// A jungle study chapter on the shared embed card: the chapter's root FEN
// replayed through the kernel, drawn by the same renderer the room, watch and
// review pages use. The card owns the seat rows, the score sheet and the
// stepper; this owns the board and the ply cursor, like mountBanqiReplayBoard.
import {
  applyJungleMove,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
  parseJungleFen,
} from '@mistboard/game';
import { animateJungleBoardMove, renderJungleBoardSvg } from './jungle-render.js';
import './live-xiangqi.css';

export type JungleReplayBoardSpec = {
  /** The chapter's root FEN (jungleStateToEngineFen), the start position for a match game. */
  rootFen: string;
  /** Mainline tokens, `from+to` in the kernel's coordinates (`a1b1`; a river jump is `b3b7`). */
  moves: readonly string[];
  perspective?: JungleColor;
};

const TOKEN = /^([a-g][1-9])([a-g][1-9])$/;

function tokenToMove(token: string): JungleMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JungleSquare, to: m[2] as JungleSquare } : null;
}

export function mountJungleReplayBoard(
  host: HTMLElement,
  spec: JungleReplayBoardSpec,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  const parsed = parseJungleFen(spec.rootFen);
  if (!parsed.ok) throw new Error(`jungle replay: ${parsed.error}`);
  // Replay as far as the kernel accepts; a token it refuses ends the line
  // there rather than drawing a position that never happened.
  const states: JungleGameState[] = [parsed.state];
  const played: JungleMove[] = [];
  for (const token of spec.moves) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    if (before.status.type !== 'playing') break;
    const next = applyJungleMove(before, move);
    if (!next) break;
    states.push(next);
    played.push(move);
  }
  const total = played.length;
  const perspective = spec.perspective ?? 'red';

  const frame = document.createElement('div');
  frame.className = 'jungle-replay-board';
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    frame.innerHTML = renderJungleBoardSvg(states[index]!.board, {
      perspective,
      lastMove: index > 0 ? (played[index - 1] ?? null) : null,
    });
  };
  const render = (animateFrom?: number): void => {
    paint();
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      if (move) animateJungleBoardMove(frame, move, perspective, { reverse: !forward });
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
    moveEntries: () => played.map((move, i) => ({ ply: i + 1, label: `${move.from}-${move.to}` })),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
