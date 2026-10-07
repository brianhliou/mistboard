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
//
// A chapter's annotations ride along as the study page shows them, as on the
// jungle embed (jungle-replay-board.ts): move glyphs on the sheet and as a
// badge on the square the move landed on, position verdicts in the sheet's
// eval slot, comments under their moves, the first sideline per move under it
// with its closing verdict (steppable on the board, replayed against the same
// deal from the position before that move), and the chapter's drawn arrows and
// rings. The board side is the review board's own renderers (jieqi-review.ts
// moveGlyphMarker / shapeToArrow).
import {
  applyJieqiMove,
  getJieqiPlayerView,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  jieqiMoveLabel,
  parseJieqiFen,
} from '@mistboard/game';
import {
  animateJieqiBoardMove,
  installJieqiBoardStyles,
  type JieqiBoardArrow,
  type JieqiBoardMarker,
  renderJieqiBoardSvg,
} from './live-jieqi-render.js';
import { moveGlyphTone } from './review/move-glyph.js';
import {
  type ChapterShape,
  type ChapterSideline,
  GLYPH_SUFFIX_CLASS,
} from './study-chapter-annotations.js';
import './board-glyph-marker.css';
import './live-xiangqi.css';
import './variant-tenant/board-annotations.css';

export type JieqiReplayLine = { states: JieqiGameState[]; played: JieqiMove[] };

/** The chapter's annotations, keyed as chapterAnnotations returns them. */
export type JieqiReplayAnnotations = {
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

// Squares are a1-i10, so a token is 4-6 characters and the rank may be two
// digits (`c10e8`); the file letters are the split points.
const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

function tokenToMove(token: string): JieqiMove | null {
  const m = TOKEN.exec(token);
  return m ? { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare } : null;
}

/** Replay tokens from a truth state as far as the kernel accepts them; a token
 *  it refuses ends the line there rather than drawing a position that never
 *  happened. */
function replayFrom(start: JieqiGameState, tokens: readonly string[]): JieqiReplayLine {
  const states: JieqiGameState[] = [start];
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
  return replayFrom(parsed.state, tokens);
}

// from-to plus the check mark of the position the move left (states[i + 1]).
const label = (line: JieqiReplayLine, index: number): string => {
  const move = line.played[index]!;
  const after = line.states[index + 1];
  return after ? jieqiMoveLabel(move, after) : `${move.from}-${move.to}`;
};

/** A study shape as the review board draws it (jieqi-review.ts shapeToArrow):
 *  the same classes, so the brush colours match. A ring is a circle marker in
 *  the brush's class, as on the jungle embed. */
function shapeOverlay(shapes: readonly ChapterShape[]): {
  arrows: JieqiBoardArrow[];
  markers: JieqiBoardMarker[];
} {
  const arrows: JieqiBoardArrow[] = [];
  const markers: JieqiBoardMarker[] = [];
  for (const s of shapes) {
    if (s.dest && s.dest !== s.orig) {
      arrows.push({
        from: s.orig as JieqiSquare,
        to: s.dest as JieqiSquare,
        className: `xq-arrow--draw xq-shape--${s.brush}`,
      });
    } else {
      markers.push({
        square: s.orig as JieqiSquare,
        kind: 'circle',
        className: `xq-shape--${s.brush}`,
      });
    }
  }
  return { arrows, markers };
}

/** The judgment badge on the square a move landed on, as the review board pins
 *  it (jieqi-review.ts moveGlyphMarker, the same tone function). */
function glyphMarker(move: JieqiMove, glyph: string | undefined): JieqiBoardMarker[] {
  if (!glyph) return [];
  const tone = moveGlyphTone(glyph, GLYPH_SUFFIX_CLASS[glyph]);
  return tone
    ? [{ square: move.to, kind: 'glyph', text: glyph, className: `xq-marker--${tone}` }]
    : [];
}

export function mountJieqiReplayBoard(
  host: HTMLElement,
  line: JieqiReplayLine,
  options: { perspective?: JieqiColor } & JieqiReplayAnnotations = {},
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
  installJieqiBoardStyles();
  const { states, played } = line;
  const total = played.length;
  const perspective = options.perspective ?? 'red';
  // Sidelines replayed against the same deal from the position their move was
  // played in.
  const lines = new Map<number, JieqiReplayLine>();
  for (const [key, side] of Object.entries(options.lines ?? {})) {
    const ply = Number(key);
    const from = states[ply - 1];
    if (!from || ply > total) continue;
    const replayed = replayFrom(from, side.moves);
    if (replayed.played.length) lines.set(ply, replayed);
  }
  let inLine: { atPly: number; cursor: number } | null = null;

  const frame = document.createElement('div');
  frame.className = 'jieqi-embed-board';
  host.replaceChildren(frame);

  let index = 0;
  const paint = (): void => {
    if (inLine) {
      const side = lines.get(inLine.atPly)!;
      frame.innerHTML = renderJieqiBoardSvg(
        getJieqiPlayerView(side.states[inLine.cursor]!, perspective),
        perspective,
      );
      return;
    }
    // The chapter's own shapes on this position, and the move's glyph on the
    // square it landed on: what the study page's board shows.
    const drawn = shapeOverlay(options.shapes?.[index] ?? []);
    const last = index > 0 ? (played[index - 1] ?? null) : null;
    frame.innerHTML = renderJieqiBoardSvg(
      getJieqiPlayerView(states[index]!, perspective),
      perspective,
      {
        arrows: drawn.arrows,
        markers: [...drawn.markers, ...(last ? glyphMarker(last, options.glyphs?.[index]) : [])],
      },
    );
  };
  const render = (glide?: { move: JieqiMove; reverse: boolean }): void => {
    paint();
    if (glide) animateJieqiBoardMove(frame, glide.move, perspective, { reverse: glide.reverse });
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
      const side = lines.get(atPly);
      if (!side) return;
      const prev = inLine;
      inLine = { atPly, cursor: Math.max(1, Math.min(side.played.length, Math.trunc(cursor))) };
      if (!prev || prev.atPly !== atPly || Math.abs(inLine.cursor - prev.cursor) !== 1) {
        return render();
      }
      const forward = inLine.cursor > prev.cursor;
      const move = side.played[Math.max(inLine.cursor, prev.cursor) - 1];
      render(move ? { move, reverse: !forward } : undefined);
    },
    plyCount: () => total,
    moveEntries: () =>
      played.map((_move, i) => {
        const ply = i + 1;
        const glyph = options.glyphs?.[ply];
        const note = options.notes?.[ply];
        const side = lines.get(ply);
        const meta = options.lines?.[ply];
        const assessment = options.assessments?.[ply];
        return {
          ply,
          label: label(line, i),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(assessment ? { assessment } : {}),
          ...(side
            ? {
                line: {
                  moves: side.played.map((_, j) => label(side, j)),
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
