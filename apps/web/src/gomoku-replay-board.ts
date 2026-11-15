import {
  applyGomokuRoomMove,
  type GomokuMove,
  type GomokuRoomState,
  getGomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import type { EmbedBoardHandle } from './embed/embed-card.js';
import { type GomokuBoardMarker, gomokuBoardSvg, numberGomokuStones } from './gomoku-board.js';
import './gomoku-board.css';
import { moveGlyphTone } from './review/move-glyph.js';
import { GLYPH_SUFFIX_CLASS } from './study-chapter-annotations.js';

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

/** A study chapter's marks by 1-based ply (chapterAnnotations): the move glyph
 *  on the sheet and as a badge beside the stone, the comment under its move. */
export type GomokuReplayAnnotations = {
  glyphs?: Readonly<Record<number, string>>;
  notes?: Readonly<Record<number, string>>;
};

/** The judgment badge on the point a move was played, as the review board pins
 *  it (gomoku-review.ts moveGlyphMarker, the same tone function). */
function glyphMarker(move: GomokuMove | undefined, glyph: string | undefined): GomokuBoardMarker[] {
  if (!move || !glyph) return [];
  const tone = moveGlyphTone(glyph, GLYPH_SUFFIX_CLASS[glyph]);
  return tone ? [{ kind: 'glyph', square: move.to, text: glyph, tone }] : [];
}

export function mountGomokuReplayBoard(
  host: HTMLElement,
  line: ReturnType<typeof replayGomokuLine>,
  hooks: { onPlyChange: (ply: number, maxPly: number) => void },
  annotations: GomokuReplayAnnotations = {},
): EmbedBoardHandle {
  const frame = document.createElement('div');
  frame.className = 'gomoku-live-board';
  host.replaceChildren(frame);
  let ply = 0;
  const render = () => {
    // Coordinates stay fixed as in every Gomoku board, with Black below.
    frame.innerHTML = gomokuBoardSvg(
      getGomokuPlayerView(line.states[ply]!, 'black'),
      false,
      glyphMarker(line.played[ply - 1], annotations.glyphs?.[ply]),
    );
    numberGomokuStones(frame, line.played.slice(0, ply));
    hooks.onPlyChange(ply, line.played.length);
  };
  render();
  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (next) => {
      if (!Number.isFinite(next)) return;
      ply = Math.max(0, Math.min(line.played.length, Math.trunc(next)));
      render();
    },
    plyCount: () => line.played.length,
    moveEntries: () =>
      line.played.map((move, i) => {
        const glyph = annotations.glyphs?.[i + 1];
        const note = annotations.notes?.[i + 1];
        return {
          ply: i + 1,
          label: move.to,
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
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
