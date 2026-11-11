import {
  applyGomokuRoomMove,
  type GomokuMove,
  type GomokuRoomState,
  getGomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import type { EmbedBoardHandle } from './embed/embed-card.js';
import { type GomokuBoardMarker, gomokuBoardSvg, numberGomokuStones } from './gomoku-board.js';
import { moveGlyphTone } from './review/move-glyph.js';
import {
  type ChapterShape,
  type ChapterSideline,
  GLYPH_SUFFIX_CLASS,
} from './study-chapter-annotations.js';
import './board-glyph-marker.css';
import './gomoku-board.css';

/** A chapter's annotations as the study page shows them (jungle-replay-board.ts
 *  has the same shape): glyphs on the sheet and as a badge on the stone, verdicts
 *  in the sheet's eval slot, comments under their moves, the first sideline per
 *  move (steppable on the board) and the drawn rings. */
export type GomokuReplayAnnotations = {
  /** Judgment glyph per 1-based mainline ply. */
  glyphs?: Record<number, string>;
  /** The chapter's comment on a mainline move, by ply. */
  notes?: Record<number, string>;
  /** A sideline hung off the position mainline move `ply` was played in. */
  lines?: Record<number, ChapterSideline>;
  /** A verdict on a mainline move's own position, by ply. */
  assessments?: Record<number, string>;
  /** Shapes drawn on the position after `ply` mainline moves (0 = the root). */
  shapes?: Record<number, ChapterShape[]>;
};

/** Root-relative replay: dealt stones are the position, never synthetic plies.
 * Invalid or illegal tokens stop the line at the last kernel-accepted state. */
export function replayGomokuLine(root: GomokuRoomState, tokens: readonly string[]) {
  const states = [root];
  const played: GomokuMove[] = [];
  for (const token of tokens) {
    const move = parseGomokuMove(token);
    if (!move) break;
    const before = states.at(-1)!;
    const after = applyGomokuRoomMove(before, move);
    if (after === before) break;
    states.push(after);
    played.push(move);
  }
  return { states, played };
}

/** Gomoku moves are points, so a drawn shape is a ring on its first square, as
 *  the review board draws it (gomoku-review.ts shapeToMarker). */
function shapeMarkers(shapes: readonly ChapterShape[] | undefined): GomokuBoardMarker[] {
  return (shapes ?? []).map((shape) => ({ kind: 'circle', square: shape.orig }));
}

/** The judgment badge on the stone a move placed (gomoku-review.ts moveGlyphMarker). */
function glyphMarker(move: GomokuMove | undefined, glyph: string | undefined): GomokuBoardMarker[] {
  if (!move || !glyph) return [];
  const tone = moveGlyphTone(glyph, GLYPH_SUFFIX_CLASS[glyph]);
  return tone ? [{ kind: 'glyph', square: move.to, text: glyph, tone }] : [];
}

export function mountGomokuReplayBoard(
  host: HTMLElement,
  line: ReturnType<typeof replayGomokuLine>,
  hooks: { onPlyChange: (ply: number, maxPly: number) => void },
  notes: GomokuReplayAnnotations = {},
): EmbedBoardHandle &
  Required<Pick<EmbedBoardHandle, 'jumpToPly' | 'moveEntries'>> & {
    jumpToLine: (atPly: number, cursor: number) => void;
  } {
  const frame = document.createElement('div');
  frame.className = 'gomoku-live-board';
  host.replaceChildren(frame);
  const total = line.played.length;
  // Sidelines replayed from the position their move was played in.
  const sidelines = new Map<number, ReturnType<typeof replayGomokuLine>>();
  for (const [key, side] of Object.entries(notes.lines ?? {})) {
    const at = Number(key);
    const from = line.states[at - 1];
    if (!from || at > total) continue;
    const replayed = replayGomokuLine(from, side.moves);
    if (replayed.played.length) sidelines.set(at, replayed);
  }
  let ply = 0;
  let inLine: { atPly: number; cursor: number } | null = null;
  // Coordinates stay fixed as in every Gomoku board, with Black below. Every
  // placed stone carries its move number; dealt opening stones carry none.
  const render = () => {
    if (inLine) {
      const side = sidelines.get(inLine.atPly)!;
      frame.innerHTML = gomokuBoardSvg(
        getGomokuPlayerView(side.states[inLine.cursor]!, 'black'),
        false,
      );
      numberGomokuStones(frame, [
        ...line.played.slice(0, inLine.atPly - 1),
        ...side.played.slice(0, inLine.cursor),
      ]);
      return;
    }
    frame.innerHTML = gomokuBoardSvg(getGomokuPlayerView(line.states[ply]!, 'black'), false, [
      ...shapeMarkers(notes.shapes?.[ply]),
      ...glyphMarker(ply > 0 ? line.played[ply - 1] : undefined, notes.glyphs?.[ply]),
    ]);
    numberGomokuStones(frame, line.played.slice(0, ply));
    hooks.onPlyChange(ply, total);
  };
  render();
  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (next) => {
      if (!Number.isFinite(next)) return;
      inLine = null;
      ply = Math.max(0, Math.min(total, Math.trunc(next)));
      render();
    },
    jumpToLine: (atPly, cursor) => {
      const side = sidelines.get(atPly);
      if (!side) return;
      inLine = { atPly, cursor: Math.max(1, Math.min(side.played.length, Math.trunc(cursor))) };
      render();
    },
    plyCount: () => total,
    moveEntries: () =>
      line.played.map((move, i) => {
        const at = i + 1;
        const glyph = notes.glyphs?.[at];
        const note = notes.notes?.[at];
        const assessment = notes.assessments?.[at];
        const side = sidelines.get(at);
        const meta = notes.lines?.[at];
        return {
          ply: at,
          label: move.to,
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(assessment ? { assessment } : {}),
          ...(side
            ? {
                line: {
                  moves: side.played.map((m) => m.to),
                  ...(meta?.verdict ? { verdict: meta.verdict } : {}),
                  ...(meta?.note ? { note: meta.note } : {}),
                },
              }
            : {}),
        };
      }),
    playedMoves: () => line.played.map((move, i) => ({ ply: i + 1, to: move.to })),
    moveNumbering: () => ({
      firstMover:
        line.states[0]!.status.type === 'playing' && line.states[0]!.status.turn === 'white'
          ? 'b'
          : 'a',
      firstNumber: 1,
    }),
    bottomSeat: () => 'first',
  };
}
