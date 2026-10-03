// A jungle study chapter on the shared embed card: the chapter's root FEN
// replayed through the kernel, drawn by the same renderer the room, watch and
// review pages use. The card owns the seat rows, the score sheet and the
// stepper; this owns the board and the ply cursor, like mountBanqiReplayBoard.
// A chapter's annotations ride along as the study page shows them: move glyphs
// on the sheet and as a badge on the square the move landed on, position
// verdicts in the sheet's eval slot, comments under their moves, the first
// sideline per move under it with its closing verdict (steppable on the board),
// and the chapter's drawn arrows and rings. The sheet side is the chess study
// board's shape (chess-study-replay.ts); the board side is the review board's
// own renderers (jungle-review.ts moveGlyphMarker / shapeToArrow).
import {
  applyJungleMove,
  type JungleColor,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
  parseJungleFen,
} from '@mistboard/game';
import {
  animateJungleBoardMove,
  type JungleBoardArrow,
  type JungleBoardMarker,
  renderJungleBoardSvg,
} from './jungle-render.js';
import { moveGlyphTone } from './review/move-glyph.js';
import {
  type ChapterShape,
  type ChapterSideline,
  GLYPH_SUFFIX_CLASS,
} from './study-chapter-annotations.js';
import './board-glyph-marker.css';
import './live-xiangqi.css';
import './variant-tenant/board-annotations.css';

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
  /** A verdict on a mainline move's own position, by ply (the sheet's eval slot). */
  assessments?: Record<number, string>;
  /** Shapes drawn on the position after `ply` mainline moves (0 = the root). */
  shapes?: Record<number, ChapterShape[]>;
};

const TOKEN = /^([a-g][1-9])([a-g][1-9])$/;

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

/** A study shape as the review board draws it (jungle-review.ts shapeToArrow /
 *  shapeToMarker): the same classes, so the brush colours match. */
function shapeOverlay(shapes: readonly ChapterShape[]): {
  arrows: JungleBoardArrow[];
  markers: JungleBoardMarker[];
} {
  const arrows: JungleBoardArrow[] = [];
  const markers: JungleBoardMarker[] = [];
  for (const s of shapes) {
    if (s.dest && s.dest !== s.orig) {
      arrows.push({
        from: s.orig as JungleSquare,
        to: s.dest as JungleSquare,
        className: `xq-arrow--draw xq-shape--${s.brush}`,
      });
    } else {
      markers.push({
        square: s.orig as JungleSquare,
        kind: 'circle',
        className: `xq-shape--${s.brush}`,
      });
    }
  }
  return { arrows, markers };
}

/** The judgment badge on the square a move landed on, as the review board pins
 *  it (jungle-review.ts moveGlyphMarker, the same tone function). */
function glyphMarker(move: JungleMove, glyph: string | undefined): JungleBoardMarker[] {
  if (!glyph) return [];
  const tone = moveGlyphTone(glyph, GLYPH_SUFFIX_CLASS[glyph]);
  return tone
    ? [{ square: move.to, kind: 'glyph', text: glyph, className: `xq-marker--${tone}` }]
    : [];
}

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
    assessment?: string;
    line?: { moves: string[]; verdict?: string; note?: string };
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
    // The chapter's own shapes on this position, and the move's glyph on the
    // square it landed on: what the study page's board shows.
    const drawn = shapeOverlay(spec.shapes?.[index] ?? []);
    const last = index > 0 ? (played[index - 1] ?? null) : null;
    frame.innerHTML = renderJungleBoardSvg(states[index]!.board, {
      perspective,
      lastMove: last,
      arrows: drawn.arrows,
      markers: [...drawn.markers, ...(last ? glyphMarker(last, spec.glyphs?.[index]) : [])],
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
        const meta = spec.lines?.[ply];
        const assessment = spec.assessments?.[ply];
        return {
          ply,
          label: label(move),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(assessment ? { assessment } : {}),
          ...(line
            ? {
                line: {
                  moves: line.played.map(label),
                  ...(meta?.verdict ? { verdict: meta.verdict } : {}),
                  ...(meta?.note ? { note: meta.note } : {}),
                },
              }
            : {}),
        };
      }),
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
