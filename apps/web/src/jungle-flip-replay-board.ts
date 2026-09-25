// A Flip Jungle study chapter on the shared embed card: the chapter's dealt
// root (rootFen, jungleFlipStateToDealtFen: the sixth field is the deal)
// replayed through the kernel, drawn by the live flip-jungle renderer. The
// card owns the seat rows, the score sheet and the stepper; this owns the
// board and the ply cursor, like mountBanqiReplayBoard.
//
// The board is the as-played view, as in the rules article's replay: a tile
// nobody has turned over is face down, and shows its dealt animal from the
// ply it is flipped. Tokens are the tree's own (`a1a1` flips a1, `a1b1` moves).
import {
  applyJungleFlipMove,
  getJungleFlipPlayerView,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSquare,
  jungleFlipLastMoverInk,
  parseJungleFlipFen,
} from '@mistboard/game';
import {
  animateJungleFlipBoardMove,
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';

export type JungleFlipReplayLine = { states: JungleFlipGameState[]; played: JungleFlipMove[] };

const TOKEN = /^([a-d][1-4])([a-d][1-4])$/;

function tokenToMove(token: string): JungleFlipMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JungleFlipSquare, to: m[2] as JungleFlipSquare } : null;
}

/** The sheet's spelling, the tree adapter's: a flip is its bare square. */
export function jungleFlipMoveLabel(move: JungleFlipMove): string {
  return move.from === move.to ? move.from : `${move.from}-${move.to}`;
}

/**
 * Replay a chapter's mainline from its dealt root as far as the kernel accepts
 * it; a token it refuses ends the line there. Null when the root is missing,
 * does not parse, or carries no deal (a sampled deal flips up animals that
 * were never there).
 */
export function replayJungleFlipLine(
  rootFen: string | undefined,
  tokens: readonly string[],
): JungleFlipReplayLine | null {
  if (!rootFen) return null;
  const parsed = parseJungleFlipFen(rootFen, { gameId: 'study-embed' });
  if (!parsed.ok || parsed.sampled) return null;
  const states: JungleFlipGameState[] = [parsed.state];
  const played: JungleFlipMove[] = [];
  for (const token of tokens) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    const next = applyJungleFlipMove(before, move);
    if (next === before) break;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

export function mountJungleFlipReplayBoard(
  host: HTMLElement,
  line: JungleFlipReplayLine,
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

  const frame = document.createElement('div');
  frame.className = 'jungle-flip-embed-board';
  host.replaceChildren(frame);

  let index = 0;
  const render = (animateFrom?: number): void => {
    // The renderer draws one fixed orientation (the deal has no sides), so
    // the seat the view is projected for only decides legal-move hints, which
    // a replay does not draw.
    const view = getJungleFlipPlayerView(states[index]!, 'red');
    frame.innerHTML = renderJungleFlipBoardSvg(view.board as JungleFlipRenderBoard, {
      lastMove: view.lastMove ?? null,
      lastMoveInk: jungleFlipLastMoverInk(view),
    });
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = forward ? played[index - 1] : played[animateFrom - 1];
      if (move) animateJungleFlipBoardMove(frame, move, 'red', { reverse: !forward });
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
    moveEntries: () => played.map((move, i) => ({ ply: i + 1, label: jungleFlipMoveLabel(move) })),
    // One fixed orientation, first mover's seat row under it.
    bottomSeat: () => 'first',
  };
}
