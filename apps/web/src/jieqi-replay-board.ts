// A jieqi study chapter on the shared embed card: the chapter's dealt root
// (rootFen, whose sixth field is the deal) replayed through the kernel, drawn
// by the live jieqi renderer. The card owns the seat rows, the score sheet and
// the stepper; this owns the board and the ply cursor, like
// mountBanqiReplayBoard.
//
// The board is the masked as-played view, as in the rules article's replay: a
// dark piece is a dark disc until it first moves, then shows the identity the
// deal gave it. The deal is what makes the line replayable at all, since a
// revealed piece moves as what it turned out to be.
import {
  applyJieqiMove,
  getJieqiPlayerView,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  parseJieqiFen,
} from '@mistboard/game';
import {
  animateJieqiBoardMove,
  installJieqiBoardStyles,
  renderJieqiBoardSvg,
} from './live-jieqi-render.js';

export type JieqiReplayLine = { states: JieqiGameState[]; played: JieqiMove[] };

// Squares are a1-i10, so a token is 4-6 characters and the rank may be two
// digits (`c10e8`); the file letters are the split points.
const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

function tokenToMove(token: string): JieqiMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare } : null;
}

/**
 * Replay a chapter's mainline from its dealt root as far as the kernel accepts
 * it; a token it refuses ends the line there. Null when the root is missing,
 * does not parse, or carries no deal: a public five-field FEN would have the
 * parser sample one, and a sampled deal draws identities that never happened.
 */
export function replayJieqiLine(
  rootFen: string | undefined,
  tokens: readonly string[],
): JieqiReplayLine | null {
  if (!rootFen) return null;
  const parsed = parseJieqiFen(rootFen, { gameId: 'study-embed' });
  if (!parsed.ok || parsed.sampled) return null;
  const states: JieqiGameState[] = [parsed.state];
  const played: JieqiMove[] = [];
  for (const token of tokens) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    const next = applyJieqiMove(before, move);
    if (next === before) break;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

export function mountJieqiReplayBoard(
  host: HTMLElement,
  line: JieqiReplayLine,
  options: { perspective?: JieqiColor } = {},
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  installJieqiBoardStyles();
  const { states, played } = line;
  const total = played.length;
  const perspective = options.perspective ?? 'red';

  const frame = document.createElement('div');
  frame.className = 'jieqi-embed-board';
  host.replaceChildren(frame);

  let index = 0;
  const render = (animateFrom?: number): void => {
    frame.innerHTML = renderJieqiBoardSvg(
      getJieqiPlayerView(states[index]!, perspective),
      perspective,
    );
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      if (move) animateJieqiBoardMove(frame, move, perspective, { reverse: !forward });
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
