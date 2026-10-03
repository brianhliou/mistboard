// What a study chapter argues, read off its tree for the read-only boards the
// embed draws: the FIRST child at every node is the mainline; the first later
// child is a sideline hung off the same position, kept with its verdict and
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

export type ChapterSideline = { moves: string[]; verdict?: string; note?: string };

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
};

export function chapterAnnotations(chapter: StudyChapterPayload): ChapterAnnotations {
  const moves: string[] = [];
  const glyphs: Record<number, string> = {};
  const notes: Record<number, string> = {};
  const assessments: Record<number, string> = {};
  const lines: Record<number, ChapterSideline> = {};
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
  return { moves, glyphs, notes, assessments, lines };
}
