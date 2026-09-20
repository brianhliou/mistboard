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

/** The mainline of a chess chapter's tree: the FIRST child at every node, in
 *  the tree adapter's own UCI. Sidelines are the study page's; the embed shows
 *  the line the author put first. */
export function chessChapterToReplaySpec(chapter: StudyChapterPayload): ChessReplaySpec | null {
  const moves: string[] = [];
  const glyphs: Record<number, string> = {};
  let node: StudyTreeNode | undefined = chapter.root?.root;
  while (node?.children?.length) {
    const played = node.children[0];
    if (!played?.uci) break;
    moves.push(played.uci);
    const glyph = (played.annotations?.glyphs ?? []).map((code) => NAG_GLYPH[code]).find(Boolean);
    if (glyph) glyphs[moves.length] = glyph;
    node = played;
  }
  if (!moves.length) return null;
  const rootFen = chapter.root?.rootFen;
  return {
    ...(rootFen ? { rootFen } : {}),
    moves,
    perspective: chapter.orientation === 'black' ? 'black' : 'white',
    glyphs,
  };
}

/** Replay the line against the kernel; an unreadable or illegal move truncates
 *  the line rather than poisoning every position after it. */
function replayChess(spec: ChessReplaySpec): { states: GameState[]; labels: string[] } {
  const parsed = spec.rootFen ? parseStandardChessFen(spec.rootFen, 'embed') : null;
  let state: GameState = parsed?.ok
    ? parsed.state
    : standardChessVariant.createInitialState('embed');
  const states = [state];
  const labels: string[] = [];
  for (const uci of spec.moves) {
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
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string; suffix?: string; suffixClass?: string }>;
  bottomSeat: () => 'first' | 'second';
  moveNumbering: () => { firstMover: 'a' | 'b'; firstNumber: number };
} {
  const perspective = spec.perspective ?? 'white';
  const { states, labels } = replayChess(spec);
  const total = labels.length;

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-chess';
  host.replaceChildren(frame);

  let index = 0;
  const render = (): void => {
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
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render();
    },
    plyCount: () => total,
    moveEntries: () =>
      labels.map((label, i) => {
        const glyph = spec.glyphs?.[i + 1];
        return {
          ply: i + 1,
          label,
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
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
