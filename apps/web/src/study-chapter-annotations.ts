// What a study chapter argues, read off its tree for the read-only boards the
// embed draws: the FIRST child at every node is the mainline; later children
// are sidelines hung off the same position, kept with their verdict and
// comment. Shared by the chess and jungle study embeds (the xiangqi embed reads
// the same shape through studyChapterToReplaySpec). Imports nothing heavy: the
// embed bundle loads it.

import { ASSESSMENT_GLYPH } from './assessment-glyphs.js';
import type { StudyChapterPayload, StudyTreeNode } from './study-chapter-spec.js';

/** NAG codes as the study stores them, to the glyph the board and sheet show. */
export const NAG_GLYPH: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 6: '?!' };

/** The score sheet's colour class for a move glyph (the review's judgment palette). */
export const GLYPH_SUFFIX_CLASS: Record<string, string> = {
  '??': 'blunder',
  '?': 'mistake',
  '?!': 'inaccuracy',
  '!!': 'brilliant',
  '!': 'great',
};

export type ChapterSideline = {
  moves: string[];
  verdict?: string;
  note?: string;
  replies?: Record<number, ChapterSideline[]>;
};

/** Mainline → sideline → reply; deeper variations are deliberately omitted. */
export function chapterSideline(sibling: StudyTreeNode, depth = 1): ChapterSideline {
  const moves: string[] = [];
  const replies: Record<number, ChapterSideline[]> = {};
  let verdict: string | undefined;
  let node: StudyTreeNode | undefined = sibling;
  while (node?.uci) {
    moves.push(node.uci);
    const assessed = (node.annotations?.glyphs ?? []).find(
      (code) => ASSESSMENT_GLYPH[code] !== undefined,
    );
    verdict = assessed === undefined ? undefined : ASSESSMENT_GLYPH[assessed];
    const alternatives = node.children?.slice(1).filter((child) => child.uci) ?? [];
    if (depth < 2 && alternatives.length) {
      replies[moves.length + 1] = alternatives.map((child) => chapterSideline(child, depth + 1));
    }
    node = node.children?.[0];
  }
  const note = sibling.annotations?.comments?.[0]?.text;
  return {
    moves,
    ...(verdict ? { verdict } : {}),
    ...(note ? { note } : {}),
    ...(Object.keys(replies).length ? { replies } : {}),
  };
}

/** A drawn shape on a position: an arrow (orig → dest) or a ringed square. */
export type ChapterShape = { orig: string; dest?: string; brush: string };

export type ChapterAnnotations = {
  /** Mainline moves, in the chapter's own token spelling. */
  moves: string[];
  /** Judgment glyph per 1-based mainline ply, from the chapter's NAGs. */
  glyphs: Record<number, string>;
  /** The chapter's comment on a mainline move, by ply. */
  notes: Record<number, string>;
  /** A verdict NAG on a mainline move's own position, by ply. */
  assessments: Record<number, string>;
  /** The first sideline hung off the position a mainline move was played in,
   *  by that move's ply: its tokens, its verdict (the assessment NAG on its
   *  last node) and its own comment (on its first move). */
  lines: Record<number, ChapterSideline>;
  /** Present only when the legacy single line cannot express the tree. */
  branches?: Record<number, ChapterSideline[]>;
  /** The shapes drawn on the position after `ply` mainline moves (0 = the root). */
  shapes: Record<number, ChapterShape[]>;
};

type NodeShape = { orig?: string; dest?: string; brush?: string };
function shapesOf(node: StudyTreeNode | undefined): ChapterShape[] {
  const raw = (node?.annotations as { shapes?: NodeShape[] } | undefined)?.shapes ?? [];
  return raw
    .filter((s): s is NodeShape & { orig: string } => typeof s.orig === 'string')
    .map((s) => ({ orig: s.orig, ...(s.dest ? { dest: s.dest } : {}), brush: s.brush ?? 'green' }));
}

export function chapterAnnotations(chapter: StudyChapterPayload): ChapterAnnotations {
  const moves: string[] = [];
  const glyphs: Record<number, string> = {};
  const notes: Record<number, string> = {};
  const assessments: Record<number, string> = {};
  const lines: Record<number, ChapterSideline> = {};
  const shapes: Record<number, ChapterShape[]> = {};
  const branches: Record<number, ChapterSideline[]> = {};
  let node: StudyTreeNode | undefined = chapter.root?.root;
  const rootShapes = shapesOf(node);
  if (rootShapes.length) shapes[0] = rootShapes;
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
    const drawn = shapesOf(played);
    if (drawn.length) shapes[ply] = drawn;
    const siblings = node.children
      .slice(1)
      .filter((child) => child.uci)
      .map((child) => chapterSideline(child));
    if (siblings[0]) lines[ply] = siblings[0];
    if (siblings.length > 1 || siblings[0]?.replies) branches[ply] = siblings;
    node = played;
  }
  return {
    moves,
    glyphs,
    notes,
    assessments,
    lines,
    shapes,
    ...(Object.keys(branches).length ? { branches } : {}),
  };
}
