// A banqi study chapter on the shared embed card: the chapter's dealt root
// (rootFen, the deal included) replayed through the kernel, drawn by the same
// renderer the room, watch and review pages use. The card owns the seat rows,
// the score sheet and the stepper; this owns the board and the ply cursor,
// like mountAtomicXiangqiReplayBoard.
import {
  applyBanqiMove,
  BANQI_STUDY_MOVE_OPTIONS,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  banqiMoveLabelOnBoard,
  getBanqiPlayerView,
  parseBanqiFen,
} from '@mistboard/game';
import {
  animateBanqiBoardMove,
  type BanqiBoardArrow,
  banqiArrowSvg,
  installBanqiBoardStyles,
  renderBanqiBoardSvg,
} from './live-banqi-render.js';

export type BanqiReplayBoardSpec = {
  /** The chapter's dealt FEN (six fields); the deal is what makes the moves replayable. */
  rootFen: string;
  /** Mainline tokens, `from+to`, a flip spelled as `b2b2`. */
  moves: readonly string[];
  perspective?: 'red' | 'black';
  /** Sidelines by the 1-based mainline ply whose move they replace: tokens
   *  played from the position before that move. The sheet lists each as a
   *  branch under its move, and the board steps through it (jumpToLine). */
  lines?: ReadonlyMap<number, readonly string[]>;
};

const TOKEN = /^([a-h][1-4])([a-h][1-4])$/;

function tokenToMove(token: string): BanqiMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as BanqiSquare, to: m[2] as BanqiSquare } : null;
}

/** The chapter's line through the kernel, as far as the kernel accepts; a
 *  token it refuses ends the line there rather than drawing a position that
 *  never happened. A study chapter plays on past the no-progress clock, like the
 *  study board it embeds. */
export function replayBanqiLine(spec: Pick<BanqiReplayBoardSpec, 'rootFen' | 'moves'>): {
  states: BanqiGameState[];
  played: BanqiMove[];
  labels: string[];
} {
  const parsed = parseBanqiFen(spec.rootFen);
  if (!parsed.ok) throw new Error(`banqi replay: ${parsed.error}`);
  return replayBanqiLineFrom(parsed.state, spec.moves);
}

/** `replayBanqiLine` from a position already parsed (a sideline's start). */
export function replayBanqiLineFrom(
  root: BanqiGameState,
  moves: readonly string[],
): ReturnType<typeof replayBanqiLine> {
  const states: BanqiGameState[] = [root];
  const labels: string[] = [];
  const played: BanqiMove[] = [];
  for (const token of moves) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1];
    const next = applyBanqiMove(before, move, BANQI_STUDY_MOVE_OPTIONS);
    if (next === before) break;
    states.push(next);
    played.push(move);
    labels.push(banqiMoveLabelOnBoard(move, next.board));
  }
  return { states, played, labels };
}

export function mountBanqiReplayBoard(
  host: HTMLElement,
  spec: BanqiReplayBoardSpec,
  hooks: {
    onPlyChange?: (ply: number, maxPly: number) => void;
    /** The board now shows `cursor` moves into the sideline at `atPly`. */
    onLineChange?: (atPly: number, cursor: number) => void;
  } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  jumpToLine: (atPly: number, cursor: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string; line?: { moves: string[] } }>;
  bottomSeat: () => 'first' | 'second';
  /** One arrow over the position shown (a hovered tablebase row), or none.
   *  Any step repaints the board and drops it. */
  previewArrow: (arrow: BanqiBoardArrow | null) => void;
} {
  installBanqiBoardStyles();
  const { states, played, labels } = replayBanqiLine(spec);
  const total = labels.length;
  const perspective = spec.perspective ?? 'red';
  // Each sideline replayed from the position its move was played in.
  const lines = new Map<number, ReturnType<typeof replayBanqiLine>>();
  for (const [ply, moves] of spec.lines ?? []) {
    if (ply < 1 || ply > total) continue;
    const replayed = replayBanqiLineFrom(states[ply - 1]!, moves);
    if (replayed.played.length) lines.set(ply, replayed);
  }
  let inLine: { atPly: number; cursor: number } | null = null;

  const frame = document.createElement('div');
  frame.className = 'banqi-replay-board';
  host.replaceChildren(frame);

  let index = 0;
  // The player view, not the truth view: a tile nobody has flipped yet is a
  // face-down disc in a replay too, the way it was to the players. The truth
  // view (every identity revealed) is the postgame's, for reading a finished
  // game with the deal known.
  const shownState = (): BanqiGameState =>
    inLine ? lines.get(inLine.atPly)!.states[inLine.cursor]! : states[index]!;
  const paint = (): void => {
    frame.innerHTML = renderBanqiBoardSvg(
      getBanqiPlayerView(shownState(), perspective),
      perspective,
    );
  };
  const render = (glide?: { move: BanqiMove | undefined; reverse: boolean }): void => {
    paint();
    if (glide?.move) animateBanqiBoardMove(frame, glide.move, { reverse: glide.reverse });
    if (inLine) hooks.onLineChange?.(inLine.atPly, inLine.cursor);
    else hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => {
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      const left = inLine;
      const from = index;
      inLine = null;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      // One step glides: along the mainline, or back off a line's first move to
      // the position it left. A jump repaints instantly.
      if (left) {
        const first = lines.get(left.atPly)?.played[0];
        if (left.cursor === 1 && index === left.atPly - 1 && first) {
          return render({ move: first, reverse: true });
        }
        return render();
      }
      if (Math.abs(index - from) !== 1) return render();
      const forward = index > from;
      render({ move: forward ? played[index - 1] : played[from - 1], reverse: !forward });
    },
    jumpToLine: (atPly: number, cursor: number) => {
      const line = lines.get(atPly);
      if (!line) return;
      const prev = inLine;
      inLine = { atPly, cursor: Math.max(1, Math.min(line.played.length, Math.trunc(cursor))) };
      // Onto a line's first move from the position it leaves is one step too.
      if (!prev && index === atPly - 1 && inLine.cursor === 1) {
        return render({ move: line.played[0], reverse: false });
      }
      if (!prev || prev.atPly !== atPly || Math.abs(inLine.cursor - prev.cursor) !== 1) {
        return render();
      }
      const forward = inLine.cursor > prev.cursor;
      render({ move: line.played[Math.max(inLine.cursor, prev.cursor) - 1], reverse: !forward });
    },
    plyCount: () => total,
    moveEntries: () =>
      labels.map((label, i) => {
        const line = lines.get(i + 1);
        return { ply: i + 1, label, ...(line ? { line: { moves: line.labels } } : {}) };
      }),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
    previewArrow: (arrow) => {
      const layer = frame.querySelector('.banqi-board-arrows');
      if (layer) layer.innerHTML = arrow ? banqiArrowSvg(arrow) : '';
    },
  };
}
