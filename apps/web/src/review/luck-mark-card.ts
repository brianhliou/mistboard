// Hover / tap card for the on-board luck mark (board-luck-mark.ts): what the piece turned
// out to be, the odds of that, the swing, and the bag it came out of.
//
// The board's hit layer sits above the marker layer and owns every click (piece selection,
// drags), so the card does not listen on the mark itself. It watches pointer positions on
// the board host and tests them against the mark's hit disc, which keeps the board's own
// input untouched: a tap on the revealed piece still selects it, and also opens the card.

import type { JieqiPieceRole } from '@mistboard/game';
import { luckDieIconSvg } from '../board-luck-mark.js';
import { t } from '../i18n/catalog.js';
import { luckPoints, luckSize, luckSizeTone, type RevealOdds } from './jieqi-luck-mark.js';

export type LuckCardDetail = {
  /** The square the mark is drawn on; the card only opens over a mark on this square. */
  square: string;
  color: 'red' | 'black';
  luck: number;
  /** Null when the odds are unknown: the card then states only the swing. */
  odds: RevealOdds | null;
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

function poolHtml(
  detail: LuckCardDetail,
  odds: RevealOdds,
  label: string,
  pieceSvg: (role: JieqiPieceRole, color: 'red' | 'black') => string,
): string {
  return (
    `<div class="luck-card__pool-label">${label}</div>` +
    `<div class="luck-card__pool">${odds.pool
      .map(
        (entry) =>
          `<span class="luck-card__chip${entry.role === odds.role ? ' luck-card__chip--drawn' : ''}" title="${roleName(entry.role)}">` +
          `${pieceSvg(entry.role, detail.color)}<span class="luck-card__count">×${entry.count}</span></span>`,
      )
      .join('')}</div>`
  );
}

/**
 * The card's markup: every number explained in the sentence it sits in. A lead line that names
 * the reveal and its odds ("Lucky reveal: Chariot (2 in 9)"), what it did to the mover's
 * win chance against an average reveal, the die's size bucket in a word beside the die
 * itself, then what else the piece could have been. Pure: piece art comes in through
 * `pieceSvg` so tests need no board.
 */
export function luckCardHtml(
  detail: LuckCardDetail,
  pieceSvg: (role: JieqiPieceRole, color: 'red' | 'black') => string,
): string {
  const tone = luckSizeTone(detail.luck);
  const odds = detail.odds;
  const lead = odds
    ? t(`review.luckCard.lead.${tone}`, {
        piece: roleName(odds.role),
        count: odds.count,
        total: odds.total,
      })
    : t(`review.luckCard.leadBare.${tone}`);
  const side = t(detail.color === 'red' ? 'summary.red' : 'summary.black');
  const effect = t(`review.luckCard.effect.${tone}`, { side, points: luckPoints(detail.luck) });
  const size = t(`review.luckCard.size.${luckSize(detail.luck)}`);
  return (
    `<div class="luck-card__head">${odds ? `<span class="luck-card__piece">${pieceSvg(odds.role, detail.color)}</span>` : ''}` +
    `<span class="luck-card__title luck-card__lead">${lead}</span></div>` +
    `<div class="luck-card__swing luck-card__swing--${tone}">${effect}</div>` +
    `<div class="luck-card__size">${luckDieIconSvg(detail.luck)}<span>${size}</span></div>` +
    (odds ? poolHtml(detail, odds, t('review.luckCard.couldHaveBeen'), pieceSvg) : '')
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
  pieceSvg: (role: JieqiPieceRole, color: 'red' | 'black') => string,
): () => void {
  const card = document.createElement('div');
  card.className = 'luck-card';
  card.setAttribute('role', 'tooltip');
  card.hidden = true;
  document.body.append(card);
  let pinned = false;
  let shownFor: string | null = null;

  function markHit(): { el: Element; rect: DOMRect; detail: LuckCardDetail } | null {
    const detail = getDetail();
    if (!detail) return null;
    const mark = boardHost.querySelector(
      `.luck-mark[data-luck-square="${CSS.escape(detail.square)}"] .luck-mark__hit`,
    );
    if (!mark) return null;
    return { el: mark, rect: mark.getBoundingClientRect(), detail };
  }

  function inside(rect: DOMRect, x: number, y: number): boolean {
    const r = rect.width / 2;
    const dx = x - (rect.left + r);
    const dy = y - (rect.top + rect.height / 2);
    return dx * dx + dy * dy <= r * r;
  }

  function show(rect: DOMRect, detail: LuckCardDetail): void {
    const key = `${detail.square}:${detail.luck}`;
    if (shownFor !== key) {
      card.innerHTML = luckCardHtml(detail, pieceSvg);
      card.dataset.tone = luckCardTone(detail);
      shownFor = key;
    }
    card.hidden = false;
    // Measure after unhiding, then place above the piece; below when the top is tight.
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 10;
    const margin = 8;
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - cw - margin));
    const above = rect.top - ch - gap;
    const below = rect.bottom + gap;
    const top = above >= margin ? above : below;
    card.dataset.side = above >= margin ? 'above' : 'below';
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.classList.add('luck-card--open');
  }

  function hide(): void {
    pinned = false;
    card.classList.remove('luck-card--open');
    card.hidden = true;
  }

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || pinned) return;
    const hit = markHit();
    if (hit && inside(hit.rect, event.clientX, event.clientY)) show(hit.rect, hit.detail);
    else if (!card.hidden) hide();
  };
  const onLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && !pinned) hide();
  };
  // Touch and pen: a tap on the revealed piece pins the card open; any other tap closes it.
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const hit = markHit();
    if (hit && inside(hit.rect, event.clientX, event.clientY)) {
      if (pinned) hide();
      else {
        show(hit.rect, hit.detail);
        pinned = true;
      }
    } else hide();
  };
  const onDocDown = (event: PointerEvent): void => {
    if (!boardHost.contains(event.target as Node)) hide();
  };
  // Navigation re-renders the board: re-place the card over the new mark, or close it.
  const observer = new MutationObserver(() => {
    if (card.hidden) return;
    const hit = markHit();
    if (hit) show(hit.rect, hit.detail);
    else hide();
  });
  boardHost.addEventListener('pointermove', onMove);
  boardHost.addEventListener('pointerleave', onLeave);
  boardHost.addEventListener('pointerdown', onDown);
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  observer.observe(boardHost, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    boardHost.removeEventListener('pointermove', onMove);
    boardHost.removeEventListener('pointerleave', onLeave);
    boardHost.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    card.remove();
  };
}
