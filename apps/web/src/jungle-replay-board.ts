// A jungle study chapter on the shared embed card: the chapter's root FEN
// replayed through the kernel, drawn by the same renderer the room, watch and
// review pages use. The card owns the seat rows, the score sheet and the
// stepper; this owns the board and the ply cursor, like mountBanqiReplayBoard.
// A chapter's comments, move glyphs and first sideline per move ride along the
// same way the chess study board carries them (chess-study-replay.ts): the
// sheet shows the glyph and the comment under the move and lists the sideline
// under it, and the board steps into the sideline when the sheet asks.
import {
  applyJungleMove,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
  parseJungleFen,
} from '@mistboard/game';
import { animateJungleBoardMove, renderJungleBoardSvg } from './jungle-render.js';
import { type ChapterSideline, GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';
import './live-xiangqi.css';

export type JungleReplayBoardSpec = {
  /** The chapter's root FEN (jungleStateToEngineFen), the start position for a match game. */
  rootFen: string;
  /** Mainline tokens, `from+to` in the kernel's coordinates (`a1b1`; a river jump is `b3b7`). */
  moves: readonly string[];
  perspective?: JungleColor;
  /** Judgment glyph per 1-based mainline ply. */
  glyphs?: Record<number, string>;
  /** The chapter's comment on a mainline move, by ply. */
  notes?: Record<number, string>;
  /** A sideline hung off the position mainline move `ply` was played in. */
  lines?: Record<number, ChapterSideline>;
};

const TOKEN = /^([a-g][1-9])([a-g][1-9])$/;
// The green of a study's suggestion arrows, on the position a sideline leaves from.
const LINE_ARROW = { color: '#15781b', opacity: 0.8 } as const;

function tokenToMove(token: string): JungleMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JungleSquare, to: m[2] as JungleSquare } : null;
}

/** Replay as far as the kernel accepts; a token it refuses ends the line there
 *  rather than drawing a position that never happened. */
function replayLine(
  start: JungleGameState,
  tokens: readonly string[],
): { states: JungleGameState[]; played: JungleMove[] } {
  const states: JungleGameState[] = [start];
  const played: JungleMove[] = [];
  for (const token of tokens) {
    const move = tokenToMove(token);
    if (!move) break;
    const before = states[states.length - 1]!;
    if (before.status.type !== 'playing') break;
    const next = applyJungleMove(before, move);
    if (!next) break;
    states.push(next);
    played.push(move);
  }
  return { states, played };
}

const label = (move: JungleMove): string => `${move.from}-${move.to}`;

export function mountJungleReplayBoard(
  host: HTMLElement,
  spec: JungleReplayBoardSpec,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  jumpToLine: (atPly: number, cursor: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{
    ply: number;
    label: string;
    suffix?: string;
    suffixClass?: string;
    note?: string;
    line?: { moves: string[]; note?: string };
  }>;
  bottomSeat: () => 'first' | 'second';
} {
  const parsed = parseJungleFen(spec.rootFen);
  if (!parsed.ok) throw new Error(`jungle replay: ${parsed.error}`);
  const { states, played } = replayLine(parsed.state, spec.moves);
  const total = played.length;
  const perspective = spec.perspective ?? 'red';
  // Sidelines replayed from the position their move was played in.
  const lines = new Map<number, { states: JungleGameState[]; played: JungleMove[] }>();
  for (const [key, line] of Object.entries(spec.lines ?? {})) {
    const ply = Number(key);
    const from = states[ply - 1];
    if (!from || ply > total) continue;
    const replayed = replayLine(from, line.moves);
    if (replayed.played.length) lines.set(ply, replayed);
  }
  let inLine: { atPly: number; cursor: number } | null = null;

  const frame = document.createElement('div');
  frame.className = 'jungle-replay-board';
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    if (inLine) {
      const line = lines.get(inLine.atPly)!;
      frame.innerHTML = renderJungleBoardSvg(line.states[inLine.cursor]!.board, {
        perspective,
        lastMove: line.played[inLine.cursor - 1] ?? null,
      });
      return;
    }
    // The position a sideline leaves from shows the sideline's first move as
    // an arrow, so the alternative is on the board before it is clicked.
    const next = lines.get(index + 1)?.played[0];
    frame.innerHTML = renderJungleBoardSvg(states[index]!.board, {
      perspective,
      lastMove: index > 0 ? (played[index - 1] ?? null) : null,
      ...(next ? { arrows: [{ from: next.from, to: next.to, ...LINE_ARROW }] } : {}),
    });
  };
  const render = (glide?: { move: JungleMove; reverse: boolean }): void => {
    paint();
    if (glide) animateJungleBoardMove(frame, glide.move, perspective, { reverse: glide.reverse });
    if (!inLine) hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => {
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      const wasInLine = inLine !== null;
      const from = index;
      inLine = null;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      // One mainline step glides; a jump, or leaving a line, repaints instantly.
      if (wasInLine || Math.abs(index - from) !== 1) return render();
      const forward = index > from;
      const move = forward ? played[index - 1] : played[from - 1];
      render(move ? { move, reverse: !forward } : undefined);
    },
    jumpToLine: (atPly: number, cursor: number) => {
      const line = lines.get(atPly);
      if (!line) return;
      const prev = inLine;
      inLine = { atPly, cursor: Math.max(1, Math.min(line.played.length, Math.trunc(cursor))) };
      if (!prev || prev.atPly !== atPly || Math.abs(inLine.cursor - prev.cursor) !== 1) {
        return render();
      }
      const forward = inLine.cursor > prev.cursor;
      const move = line.played[Math.max(inLine.cursor, prev.cursor) - 1];
      render(move ? { move, reverse: !forward } : undefined);
    },
    plyCount: () => total,
    moveEntries: () =>
      played.map((move, i) => {
        const ply = i + 1;
        const glyph = spec.glyphs?.[ply];
        const note = spec.notes?.[ply];
        const line = lines.get(ply);
        const lineNote = spec.lines?.[ply]?.note;
        return {
          ply,
          label: label(move),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(line
            ? { line: { moves: line.played.map(label), ...(lineNote ? { note: lineNote } : {}) } }
            : {}),
        };
      }),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
