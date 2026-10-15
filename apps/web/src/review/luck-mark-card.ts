// Hover / tap card for the on-board luck mark (board-luck-mark.ts): what the hidden piece
// turned out to be (the mover's own on a reveal, the opponent's on a face-down capture), the
// odds of that, the swing, and the bag it came out of.
//
// The card and its triggers are mark-card.ts's, shared with the move-grade card; this file
// says what the luck card shows and where its mark is: the piece's hit disc and the die on
// its corner. The move list's luck badge opens the same card for its own move
// (attachLuckBadgeCard).

import type { JieqiPieceRole } from '@mistboard/game';
import { luckDieIconSvg } from '../board-luck-mark.js';
import { t } from '../i18n/catalog.js';
import { overGradeBadge } from './grade-mark-card.js';
import {
  type JieqiChanceKind,
  luckPoints,
  luckSize,
  luckSizeTone,
  type RevealOdds,
} from './jieqi-luck-mark.js';
import { attachBoardMarkCard, attachListBadgeCard, type MarkCardContent } from './mark-card.js';

export type LuckCardDetail = {
  /** The square the mark is drawn on; the card only opens over a mark on this square. */
  square: string;
  color: 'red' | 'black';
  luck: number;
  /** What the move resolved; absent means a reveal. */
  kind?: JieqiChanceKind;
  /** The reveal's odds (the mover's pool). Null when unknown, or when nothing was revealed:
   *  the card then states only the swing. */
  odds: RevealOdds | null;
  /** The face-down capture's odds (the victim's pool as the capturer knew it). */
  capture?: RevealOdds | null;
};

type RoleKey =
  | 'review.luckCard.role.chariot'
  | 'review.luckCard.role.cannon'
  | 'review.luckCard.role.horse'
  | 'review.luckCard.role.elephant'
  | 'review.luckCard.role.advisor'
  | 'review.luckCard.role.soldier'
  | 'review.luckCard.role.general';

function roleName(role: JieqiPieceRole): string {
  return t(`review.luckCard.role.${role}` as RoleKey);
}

/** The tone the card paints in: the die's, so a one-pip reveal is grey on both. */
export function luckCardTone(detail: LuckCardDetail): 'lucky' | 'unlucky' | 'even' {
  return luckSizeTone(detail.luck);
}

type PieceSvg = (role: JieqiPieceRole, color: 'red' | 'black') => string;

function poolHtml(
  color: 'red' | 'black',
  odds: RevealOdds,
  label: string,
  pieceSvg: PieceSvg,
): string {
  return (
    `<div class="luck-card__pool-label">${label}</div>` +
    `<div class="luck-card__pool">${odds.pool
      .map(
        (entry) =>
          `<span class="luck-card__chip${entry.role === odds.role ? ' luck-card__chip--drawn' : ''}" title="${roleName(entry.role)}">` +
          `${pieceSvg(entry.role, color)}<span class="luck-card__count">×${entry.count}</span></span>`,
      )
      .join('')}</div>`
  );
}

function headHtml(piece: string, text: string): string {
  return (
    `<div class="luck-card__head">${piece ? `<span class="luck-card__piece">${piece}</span>` : ''}` +
    `<span class="luck-card__title luck-card__lead">${text}</span></div>`
  );
}

/**
 * The card's markup: every number explained in the sentence it sits in. A lead line that names
 * the draw and its odds ("Lucky reveal: Chariot (2 in 9)", "Unlucky capture: Soldier (5 in
 * 12)"), what it did to the mover's win chance against an average draw, the die's size bucket
 * in a word beside the die itself, then what else the piece could have been. A move that both
 * reveals and captures a dark piece has one combined luck number (the server averages over
 * both bags at once), so its card names both draws with their odds under one luck line and
 * leaves the bags out. Pure: piece art comes in through `pieceSvg` so tests need no board.
 */
export function luckCardHtml(detail: LuckCardDetail, pieceSvg: PieceSvg): string {
  const tone = luckSizeTone(detail.luck);
  const kind = detail.kind ?? 'reveal';
  const victim = detail.color === 'red' ? 'black' : 'red';
  const side = t(detail.color === 'red' ? 'summary.red' : 'summary.black');
  const points = luckPoints(detail.luck);
  const swing = (text: string) =>
    `<div class="luck-card__swing luck-card__swing--${tone}">${text}</div>`;
  const size =
    `<div class="luck-card__size">${luckDieIconSvg(detail.luck)}` +
    `<span>${t(`review.luckCard.size.${luckSize(detail.luck)}`)}</span></div>`;
  if (kind === 'both') {
    const draw = (
      odds: RevealOdds | null | undefined,
      key: 'review.luckCard.drawRevealed' | 'review.luckCard.drawCaptured',
      color: 'red' | 'black',
    ): string =>
      odds
        ? `<div class="luck-card__draw">${headHtml(
            pieceSvg(odds.role, color),
            t(key, { piece: roleName(odds.role), count: odds.count, total: odds.total }),
          )}</div>`
        : '';
    return (
      headHtml('', t(`review.luckCard.bothLead.${tone}`)) +
      draw(detail.odds, 'review.luckCard.drawRevealed', detail.color) +
      draw(detail.capture, 'review.luckCard.drawCaptured', victim) +
      swing(t(`review.luckCard.bothEffect.${tone}`, { side, points })) +
      size
    );
  }
  const capture = kind === 'capture';
  const odds = capture ? (detail.capture ?? null) : detail.odds;
  const pieceColor = capture ? victim : detail.color;
  const lead = odds
    ? t(capture ? `review.luckCard.captureLead.${tone}` : `review.luckCard.lead.${tone}`, {
        piece: roleName(odds.role),
        count: odds.count,
        total: odds.total,
      })
    : t(capture ? `review.luckCard.captureLeadBare.${tone}` : `review.luckCard.leadBare.${tone}`);
  const effect = t(
    capture ? `review.luckCard.captureEffect.${tone}` : `review.luckCard.effect.${tone}`,
    { side, points },
  );
  const poolLabel = t(
    capture ? 'review.luckCard.couldHaveBeenCaptured' : 'review.luckCard.couldHaveBeen',
  );
  return (
    headHtml(odds ? pieceSvg(odds.role, pieceColor) : '', lead) +
    swing(effect) +
    size +
    (odds ? poolHtml(pieceColor, odds, poolLabel, pieceSvg) : '')
  );
}

/** The card's content for `detail`, keyed so an unchanged card is not redrawn. One builder
 *  for the board mark and the move-list badge. */
function luckCardContent(detail: LuckCardDetail, pieceSvg: PieceSvg): MarkCardContent {
  return {
    key: `${detail.square}:${detail.kind ?? 'reveal'}:${detail.luck}`,
    html: luckCardHtml(detail, pieceSvg),
    tone: luckCardTone(detail),
  };
}

/** Slack around the die's square, in px: its white edge (stroke) is drawn outside the
 *  rect's geometry, which is all getBoundingClientRect measures. */
const DIE_HIT_SLACK = 2;

/** Whether (x, y) is on the mark: the piece's disc, or the die pinned to its corner (which
 *  sits mostly outside the disc, so pointing at the die is pointing at the luck too). */
export function luckMarkContains(
  piece: DOMRect,
  die: DOMRect | null,
  x: number,
  y: number,
): boolean {
  const r = piece.width / 2;
  const dx = x - (piece.left + r);
  const dy = y - (piece.top + piece.height / 2);
  if (dx * dx + dy * dy <= r * r) return true;
  if (!die) return false;
  return (
    x >= die.left - DIE_HIT_SLACK &&
    x <= die.right + DIE_HIT_SLACK &&
    y >= die.top - DIE_HIT_SLACK &&
    y <= die.bottom + DIE_HIT_SLACK
  );
}

/**
 * Wire the card to a board host. `getDetail` returns the detail of the mark currently
 * drawn (or null); the card opens only while a `.luck-mark` for that square is in the DOM,
 * so navigating away closes it without the caller having to. Returns a detach function.
 */
export function attachLuckMarkCard(
  boardHost: HTMLElement,
  getDetail: () => LuckCardDetail | null,
  pieceSvg: PieceSvg,
): () => void {
  return attachBoardMarkCard(boardHost, () => {
    const detail = getDetail();
    if (!detail) return null;
    const mark = boardHost.querySelector(
      `.luck-mark[data-luck-square="${CSS.escape(detail.square)}"]`,
    );
    const hit = mark?.querySelector('.luck-mark__hit');
    if (!mark || !hit) return null;
    const rect = hit.getBoundingClientRect();
    const cube = mark.querySelector('.luck-mark__cube');
    const die = cube ? cube.getBoundingClientRect() : null;
    return {
      rect,
      contains: (x, y) => luckMarkContains(rect, die, x, y) && !overGradeBadge(boardHost, x, y),
      content: luckCardContent(detail, pieceSvg),
    };
  });
}

/** The attribute move-tree.ts puts on a luck badge: the path key of the move it labels. */
export const LUCK_BADGE_SELECTOR = '.review-move-list__luck[data-luck-path]';

/**
 * Wire the same card to the move list's luck badges ("🎲 -7%"). `getDetail` maps a badge to
 * its move's detail, so any move's card opens, not only the current one's. Mouse: hover
 * opens, leaving closes; the click still lands on the move button and navigates. Touch and
 * pen: a tap on a badge opens the card pinned AND selects the move (the tap reaches the
 * move button untouched, so the list keeps one tap behaviour); a second tap on the same
 * badge, or a tap anywhere else, closes it. Returns a detach function.
 */
export function attachLuckBadgeCard(
  list: HTMLElement,
  getDetail: (badge: HTMLElement) => LuckCardDetail | null,
  pieceSvg: PieceSvg,
): () => void {
  return attachListBadgeCard(list, {
    selector: LUCK_BADGE_SELECTOR,
    pathAttr: 'luckPath',
    content: (badge) => {
      const detail = getDetail(badge);
      return detail ? luckCardContent(detail, pieceSvg) : null;
    },
  });
}
