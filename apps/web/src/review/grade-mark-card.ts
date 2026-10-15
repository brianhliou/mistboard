// Hover / tap card for a move-grade mark (?!, ?, ??): the grade, the win-chance points the
// move cost, and the better move ("Mistake / Lost 12 points of win chance / Better was
// c3-c4"). The same card as the luck die's (mark-card.ts), opened from the same two places:
// the badge pinned to the board, and the glyph after the move in the move list.
//
// The card reads the analysis mark the glyph itself came from (analysis-marks.ts), so it can
// never name a different grade or a different better move than the list's advice line. On a
// jieqi reveal that is the decision layer's luck-free values, never the hidden identity.

import '../board-luck-mark.css';
import { t } from '../i18n/catalog.js';
import type { MarkGrade } from './analysis-marks.js';
import { attachBoardMarkCard, attachListBadgeCard, type MarkCardContent } from './mark-card.js';

/** The board badge every renderer draws for a glyph marker (svg-board-marker.ts and the
 *  per-variant renderers share the class). */
const BOARD_GLYPH_SELECTOR = '.xq-marker--glyph';

/** The move list's glyph slot, once move-tree.ts has tagged it with its move's path key. */
export const GRADE_GLYPH_SELECTOR = '.review-move-list__suffix[data-grade-path]';

/** Slack around the badge's disc, in px: a small target, so the edge counts too. */
const BADGE_HIT_SLACK = 3;

/** The card's markup: the grade in its glyph colour, then each number in its own sentence.
 *  A line the analysis cannot fill (no cost, no quotable move) is left out, not guessed. */
export function gradeCardHtml(grade: MarkGrade): string {
  const lines = [
    `<div class="luck-card__head"><span class="luck-card__title review-move--${grade.judgment}">${t(`review.gradeCard.${grade.judgment}`)}</span></div>`,
  ];
  if (grade.loss !== undefined && grade.loss > 0) {
    lines.push(
      `<div class="luck-card__swing">${t('review.gradeCard.loss', { points: grade.loss })}</div>`,
    );
  }
  if (grade.best) {
    lines.push(
      `<div class="luck-card__draw">${t('review.gradeCard.best', { move: grade.best })}</div>`,
    );
  }
  return lines.join('');
}

function gradeCardContent(grade: MarkGrade): MarkCardContent {
  return {
    key: `${grade.judgment}:${grade.loss ?? ''}:${grade.best ?? ''}`,
    html: gradeCardHtml(grade),
    tone: grade.judgment,
  };
}

/** Whether (x, y) is on the badge's rect, with a little slack. */
export function gradeBadgeContains(badge: DOMRect, x: number, y: number): boolean {
  return (
    x >= badge.left - BADGE_HIT_SLACK &&
    x <= badge.right + BADGE_HIT_SLACK &&
    y >= badge.top - BADGE_HIT_SLACK &&
    y <= badge.bottom + BADGE_HIT_SLACK
  );
}

/** Whether (x, y) is on a grade badge drawn on this board. The luck card yields there: the
 *  badge is drawn over the revealed piece's corner, and one point opens one card. */
export function overGradeBadge(boardHost: HTMLElement, x: number, y: number): boolean {
  const badge = boardHost.querySelector(BOARD_GLYPH_SELECTOR);
  return badge ? gradeBadgeContains(badge.getBoundingClientRect(), x, y) : false;
}

/**
 * Wire the card to the board's grade badge. `getGrade` returns the grade of the badge drawn
 * now (the move that led to the current position), or null; the card opens only while a
 * badge is in the DOM. Returns a detach function.
 */
export function attachGradeMarkCard(
  boardHost: HTMLElement,
  getGrade: () => MarkGrade | null,
): () => void {
  return attachBoardMarkCard(boardHost, () => {
    const grade = getGrade();
    if (!grade) return null;
    const badge = boardHost.querySelector(BOARD_GLYPH_SELECTOR);
    if (!badge) return null;
    const rect = badge.getBoundingClientRect();
    return {
      rect,
      contains: (x, y) => gradeBadgeContains(rect, x, y),
      content: gradeCardContent(grade),
    };
  });
}

/** Wire the same card to the move list's glyphs, each for its own move. `gradeAt` maps a
 *  glyph's path key to its grade. Returns a detach function. */
export function attachGradeGlyphCard(
  list: HTMLElement,
  gradeAt: (pathKey: string) => MarkGrade | null,
): () => void {
  return attachListBadgeCard(list, {
    selector: GRADE_GLYPH_SELECTOR,
    pathAttr: 'gradePath',
    content: (glyph) => {
      const grade = gradeAt(glyph.dataset.gradePath ?? '');
      return grade ? gradeCardContent(grade) : null;
    },
  });
}
