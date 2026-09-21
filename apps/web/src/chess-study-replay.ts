// Read-only standard-chess replay board for the STUDY embed: a chapter's
// mainline stepped on the open chess board renderer, with SAN labels for the
// card's score sheet. The chess-family sibling of duck-xiangqi-replay's mount:
// the same handle shape the embed card drives, no controls of its own.
// (chess-replay.ts next door is the ARTICLE widget over chessground; this one
// reads a live study chapter, which is the embed's whole promise.)

import {
  type GameState,
  type Move,
  parseStandardChessFen,
  type Square,
  standardChessSan,
  standardChessVariant,
} from '@mistboard/game';
import { ASSESSMENT_GLYPH } from './assessment-glyphs.js';
import { renderDarkChessBoardSvg } from './dark-chess-render.js';
import { chessUciToMove } from './review/chess-tree-adapter.js';
import type { StudyChapterPayload, StudyTreeNode } from './study-chapter-spec.js';

export type ChessReplaySpec = {
  /** Start position; the standard opening when absent. */
  rootFen?: string;
  /** Mainline moves, plain chess UCI. */
  moves: string[];
  perspective?: 'white' | 'black';
  /** Judgment glyph per 1-based mainline ply, from the chapter's NAGs. */
  glyphs?: Record<number, string>;
  /** The chapter's comment on a mainline move, by ply. */
  notes?: Record<number, string>;
  /** A verdict NAG on a mainline move's own position, by ply. */
  assessments?: Record<number, string>;
  /** The first sideline hung off the position a mainline move was played in,
   *  by that move's ply: plain UCI, its verdict (the assessment NAG on its last
   *  node), and its own comment (on its first move). */
  lines?: Record<number, { moves: string[]; verdict?: string; note?: string }>;
};

/** NAG codes as the study stores them, to the glyph the board and sheet show. */
const NAG_GLYPH: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 6: '?!' };
const GLYPH_SUFFIX_CLASS: Record<string, string> = {
  '??': 'blunder',
  '?': 'mistake',
  '?!': 'inaccuracy',
  '!!': 'brilliant',
  '!': 'great',
};

/** A chess chapter's tree as the embed shows it: the FIRST child at every node
 *  is the mainline, in the tree adapter's own UCI; any later child is a
 *  sideline hung off the same position, kept with its verdict and comment so
 *  the embed shows what the chapter argues (the same walk as
 *  studyChapterToReplaySpec, which the xiangqi embed reads). */
export function chessChapterToReplaySpec(chapter: StudyChapterPayload): ChessReplaySpec | null {
  const moves: string[] = [];
  const glyphs: Record<number, string> = {};
  const notes: Record<number, string> = {};
  const assessments: Record<number, string> = {};
  const lines: Record<number, { moves: string[]; verdict?: string; note?: string }> = {};
  let node: StudyTreeNode | undefined = chapter.root?.root;
  while (node?.children?.length) {
    const played = node.children[0];
    if (!played?.uci) break;
    moves.push(played.uci);
    const ply = moves.length;
    const glyph = (played.annotations?.glyphs ?? []).map((code) => NAG_GLYPH[code]).find(Boolean);
    if (glyph) glyphs[ply] = glyph;
    const note = played.annotations?.comments?.[0]?.text;
    if (note) notes[ply] = note;
    const assessedCode = (played.annotations?.glyphs ?? []).find(
      (code) => ASSESSMENT_GLYPH[code] !== undefined,
    );
    if (assessedCode !== undefined) assessments[ply] = ASSESSMENT_GLYPH[assessedCode];
    const sibling = node.children[1];
    if (sibling?.uci) {
      const line: string[] = [];
      let verdict: string | undefined;
      let variation: StudyTreeNode | undefined = sibling;
      while (variation?.uci) {
        line.push(variation.uci);
        const assessed = (variation.annotations?.glyphs ?? []).find(
          (code) => ASSESSMENT_GLYPH[code] !== undefined,
        );
        verdict = assessed === undefined ? undefined : ASSESSMENT_GLYPH[assessed];
        variation = variation.children?.[0];
      }
      const lineNote = sibling.annotations?.comments?.[0]?.text;
      lines[ply] = {
        moves: line,
        ...(verdict ? { verdict } : {}),
        ...(lineNote ? { note: lineNote } : {}),
      };
    }
    node = played;
  }
  if (!moves.length) return null;
  const rootFen = chapter.root?.rootFen;
  return {
    ...(rootFen ? { rootFen } : {}),
    moves,
    perspective: chapter.orientation === 'black' ? 'black' : 'white',
    glyphs,
    notes,
    assessments,
    lines,
  };
}

/** Replay the line against the kernel; an unreadable or illegal move truncates
 *  the line rather than poisoning every position after it. */
function replayChess(spec: ChessReplaySpec): { states: GameState[]; labels: string[] } {
  const parsed = spec.rootFen ? parseStandardChessFen(spec.rootFen, 'embed') : null;
  const start: GameState = parsed?.ok
    ? parsed.state
    : standardChessVariant.createInitialState('embed');
  return replayFrom(start, spec.moves);
}

/** Replay `moves` from `start`; the same truncation rule for a sideline as for
 *  the mainline. */
function replayFrom(start: GameState, moves: string[]): { states: GameState[]; labels: string[] } {
  let state = start;
  const states = [state];
  const labels: string[] = [];
  for (const uci of moves) {
    const move: Move | null = chessUciToMove(uci);
    if (!move || state.status.type !== 'playing') break;
    const legal = standardChessVariant
      .getLegalMoves(state, state.status.turn)
      .find((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
    if (!legal) break;
    labels.push(standardChessSan(state, legal));
    state = standardChessVariant.applyMove(state, legal);
    states.push(state);
  }
  return { states, labels };
}

/** Every square: the open board hides nothing, so the fog-capable renderer
 *  gets the full set and paints no fog. */
const ALL_SQUARES: Square[] = (() => {
  const squares: Square[] = [];
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 1; rank <= 8; rank += 1) {
      squares.push(`${String.fromCharCode(97 + file)}${rank}` as Square);
    }
  }
  return squares;
})();

export function mountChessReplayBoard(
  host: HTMLElement,
  spec: ChessReplaySpec,
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
  moveNumbering: () => { firstMover: 'a' | 'b'; firstNumber: number };
} {
  const perspective = spec.perspective ?? 'white';
  const { states, labels } = replayChess(spec);
  const total = labels.length;
  // Sidelines replayed from the position their judged move was played in.
  const lines = new Map<number, { states: GameState[]; labels: string[] }>();
  for (const [key, line] of Object.entries(spec.lines ?? {})) {
    const ply = Number(key);
    const from = states[ply - 1];
    if (!from || ply > total) continue;
    const replayed = replayFrom(from, line.moves);
    if (replayed.labels.length) lines.set(ply, replayed);
  }
  let inLine: { atPly: number; cursor: number } | null = null;

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-chess';
  host.replaceChildren(frame);

  let index = 0;
  const render = (): void => {
    if (inLine) {
      const line = lines.get(inLine.atPly);
      const state = line?.states[inLine.cursor] ?? states[inLine.atPly - 1]!;
      frame.innerHTML = renderDarkChessBoardSvg(
        { board: state.board, visibleSquares: ALL_SQUARES, lastMove: state.lastMove },
        { perspective, showFog: false },
      );
      return;
    }
    const state = states[index]!;
    const glyph = index > 0 ? spec.glyphs?.[index] : undefined;
    frame.innerHTML = renderDarkChessBoardSvg(
      { board: state.board, visibleSquares: ALL_SQUARES, lastMove: state.lastMove },
      { perspective, showFog: false, ...(glyph ? { glyph } : {}) },
    );
    hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (ply: number) => {
      inLine = null;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render();
    },
    jumpToLine: (atPly: number, cursor: number) => {
      const line = lines.get(atPly);
      if (!line) return;
      inLine = { atPly, cursor: Math.max(1, Math.min(line.labels.length, Math.trunc(cursor))) };
      render();
    },
    plyCount: () => total,
    moveEntries: () =>
      labels.map((label, i) => {
        const ply = i + 1;
        const glyph = spec.glyphs?.[ply];
        const note = spec.notes?.[ply];
        const assessment = spec.assessments?.[ply];
        const line = lines.get(ply);
        const meta = spec.lines?.[ply];
        return {
          ply,
          label,
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(assessment ? { assessment } : {}),
          ...(line
            ? {
                line: {
                  moves: line.labels,
                  ...(meta?.verdict ? { verdict: meta.verdict } : {}),
                  ...(meta?.note ? { note: meta.note } : {}),
                },
              }
            : {}),
        };
      }),
    // White moves first, so a white-perspective board puts the first mover at
    // the bottom.
    bottomSeat: () => (perspective === 'white' ? 'first' : 'second'),
    // The root's own side to move and move number, so a composition reads
    // "20... Bxe4" on the sheet rather than "1. Bxe4".
    moveNumbering: () => {
      const root = states[0]!;
      return {
        firstMover: root.status.type === 'playing' && root.status.turn === 'black' ? 'b' : 'a',
        firstNumber: root.moveNumber,
      };
    },
  };
}
