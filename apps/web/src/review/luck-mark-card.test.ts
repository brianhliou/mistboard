import { afterEach, describe, expect, it } from 'vitest';
import { svgBoardLuckMark } from '../board-luck-mark.js';
import type { RevealOdds } from './jieqi-luck-mark.js';
import {
  attachLuckBadgeCard,
  attachLuckMarkCard,
  type LuckCardDetail,
  luckCardHtml,
  luckCardTone,
  luckMarkContains,
} from './luck-mark-card.js';

const stubPiece = (role: string, color: string): string =>
  `<svg data-piece="${color}-${role}"></svg>`;

const ODDS: RevealOdds = {
  role: 'soldier',
  count: 2,
  total: 5,
  pool: [
    { role: 'chariot', count: 2 },
    { role: 'soldier', count: 2 },
    { role: 'elephant', count: 1 },
  ],
};

describe('luckCardHtml', () => {
  const text = (html: string): string =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  it('says an unlucky reveal in words: odds, cost, size, the bag', () => {
    const html = luckCardHtml({ square: 'd3', color: 'red', luck: -35, odds: ODDS }, stubPiece);
    const words = text(html);
    expect(words).toContain('Unlucky reveal: Soldier (2 in 5)');
    expect(words).toContain('Cost Red 35 points of win chance vs. an average reveal');
    expect(words).toContain('Decisive swing');
    expect(words).toContain('It could have been');
    expect(html).toContain('luck-card__swing--unlucky');
    // The size line carries the board's die: six pips, the deepest unlucky ink.
    expect(html).toContain('class="luck-mark luck-mark--unlucky luck-mark--s6"');
    expect(html.match(/class="luck-mark__pip"/g)).toHaveLength(6);
    // No signed percentages, no "draw" wording, no em dashes.
    expect(words).not.toMatch(/[−+]\d|%|draw|\u2014/);
  });

  it('says a lucky reveal for the side that made it', () => {
    const html = luckCardHtml(
      { square: 'e9', color: 'black', luck: 13.6, odds: { ...ODDS, role: 'chariot' } },
      stubPiece,
    );
    const words = text(html);
    expect(words).toContain('Lucky reveal: Chariot (2 in 5)');
    expect(words).toContain("Raised Black's win chance by 14 points vs. an average reveal");
    expect(words).toContain('Big swing');
    expect(html.match(/class="luck-mark__pip"/g)).toHaveLength(4);
  });

  it('calls a tiny swing an average reveal, with no number', () => {
    const detail = { square: 'a2', color: 'red' as const, luck: 1.2, odds: ODDS };
    const words = text(luckCardHtml(detail, stubPiece));
    expect(words).toContain('Average reveal: Soldier (2 in 5)');
    expect(words).toContain('About as good for Red as an average reveal');
    expect(words).toContain('Tiny swing');
    expect(words).not.toMatch(/\d+ points?/);
    // Grey like the one-pip die, though the rounded number is +1.
    expect(luckCardTone(detail)).toBe('even');
  });

  it('drops the odds and the bag when the deal is unknown', () => {
    const words = text(
      luckCardHtml({ square: 'a2', color: 'red', luck: -7, odds: null }, stubPiece),
    );
    expect(words).toContain('Unlucky reveal');
    expect(words).toContain('Cost Red 7 points of win chance vs. an average reveal');
    expect(words).toContain('Moderate swing');
    expect(words).not.toContain('could have been');
  });

  const VICTIM: RevealOdds = {
    role: 'soldier',
    count: 5,
    total: 12,
    pool: [
      { role: 'soldier', count: 5 },
      { role: 'cannon', count: 2 },
      { role: 'chariot', count: 1 },
    ],
  };

  it('says a face-down capture is a capture, with the victim’s odds and bag in its colour', () => {
    const html = luckCardHtml(
      { square: 'c7', color: 'red', luck: -8, kind: 'capture', odds: null, capture: VICTIM },
      stubPiece,
    );
    const words = text(html);
    expect(words).toContain('Unlucky capture: Soldier (5 in 12)');
    expect(words).toContain('Cost Red 8 points of win chance vs. an average capture');
    expect(words).toContain('It could have been');
    expect(words).not.toMatch(/reveal|\u2014/i);
    // The taken piece and its bag are the victim's (Black's), not the capturer's.
    expect(html).toContain('data-piece="black-soldier"');
    expect(html).toContain('data-piece="black-chariot"');
    expect(html).not.toContain('data-piece="red-');
  });

  it('says a lucky capture without odds when the victim’s deal is unknown', () => {
    const words = text(
      luckCardHtml(
        { square: 'c7', color: 'black', luck: 22, kind: 'capture', odds: null, capture: null },
        stubPiece,
      ),
    );
    expect(words).toContain('Lucky capture');
    expect(words).toContain("Raised Black's win chance by 22 points vs. an average capture");
    expect(words).not.toContain('could have been');
  });

  it('names both draws of a reveal-and-capture under one luck line', () => {
    const html = luckCardHtml(
      {
        square: 'c7',
        color: 'red',
        luck: 12,
        kind: 'both',
        odds: { ...ODDS, role: 'chariot' },
        capture: VICTIM,
      },
      stubPiece,
    );
    const words = text(html);
    expect(words).toContain('Lucky reveal and capture');
    expect(words).toContain('Revealed Chariot (2 in 5)');
    expect(words).toContain('Captured Soldier (5 in 12)');
    expect(words).toContain("Raised Red's win chance by 12 points vs. an average outcome");
    expect(words).toContain('Big swing');
    // Compact: one luck line, no bags.
    expect(html.match(/luck-card__swing--/g)).toHaveLength(1);
    expect(words).not.toContain('could have been');
    expect(html).toContain('data-piece="red-chariot"');
    expect(html).toContain('data-piece="black-soldier"');
  });
});

// ── Triggers: the board's die, and the move list's badge ──

const DETAIL: LuckCardDetail = { square: 'd3', color: 'red', luck: -7, odds: ODDS };

function stubRect(el: Element | null, rect: DOMRect): void {
  if (!el) throw new Error('missing element');
  (el as Element).getBoundingClientRect = () => rect;
}

function pointer(
  target: EventTarget,
  type: string,
  init: { pointerType: string; x?: number; y?: number; relatedTarget?: EventTarget | null },
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      pointerType: init.pointerType,
      clientX: init.x ?? 0,
      clientY: init.y ?? 0,
      relatedTarget: init.relatedTarget ?? null,
    }),
  );
}

const openCard = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.luck-card.luck-card--open:not([hidden])');

describe('luck card triggers', () => {
  let detach: (() => void) | null = null;
  afterEach(() => {
    detach?.();
    detach = null;
    document.body.replaceChildren();
  });

  // A piece at (100, 100), 60px across; its die pinned down-left, mostly outside the disc.
  function boardWithMark(): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = `<svg>${svgBoardLuckMark({ luck: -7 }, { x: 100, y: 100 }, { piece: 60, cell: 72 }, 'd3')}</svg>`;
    document.body.append(host);
    stubRect(host.querySelector('.luck-mark__hit'), new DOMRect(70, 70, 60, 60));
    stubRect(host.querySelector('.luck-mark__cube'), new DOMRect(58, 112, 30, 30));
    return host;
  }

  it('opens from the die’s outer corner, outside the piece', () => {
    const host = boardWithMark();
    detach = attachLuckMarkCard(host, () => DETAIL, stubPiece);
    // (60, 140) is on the die and ~56px from the piece's centre: outside its 30px disc.
    pointer(host, 'pointermove', { pointerType: 'mouse', x: 60, y: 140 });
    expect(openCard()?.textContent).toContain('Unlucky reveal');
    // Off both the piece and the die: closed.
    pointer(host, 'pointermove', { pointerType: 'mouse', x: 20, y: 20 });
    expect(openCard()).toBeNull();
  });

  it('pins open on a tap on the die', () => {
    const host = boardWithMark();
    detach = attachLuckMarkCard(host, () => DETAIL, stubPiece);
    pointer(host, 'pointerdown', { pointerType: 'touch', x: 60, y: 140 });
    expect(openCard()).not.toBeNull();
    pointer(host, 'pointermove', { pointerType: 'touch', x: 20, y: 20 });
    expect(openCard()).not.toBeNull();
  });

  it('measures the die as part of the mark', () => {
    const piece = new DOMRect(70, 70, 60, 60);
    const die = new DOMRect(58, 112, 30, 30);
    expect(luckMarkContains(piece, die, 100, 100)).toBe(true);
    expect(luckMarkContains(piece, null, 60, 140)).toBe(false);
    expect(luckMarkContains(piece, die, 60, 140)).toBe(true);
    expect(luckMarkContains(piece, die, 20, 20)).toBe(false);
  });

  function listWithBadge(onJump: () => void): { list: HTMLElement; badge: HTMLElement } {
    const list = document.createElement('section');
    list.innerHTML =
      '<button type="button" class="review-move-list__move"><span class="review-move-list__san">c4-c5</span>' +
      '<span class="review-move-list__luck" data-luck-path="a/b">🎲 -7%</span></button>' +
      '<button type="button" class="review-move-list__move"><span class="review-move-list__san">h2-e2</span>' +
      '<span class="review-move-list__luck"></span></button>';
    document.body.append(list);
    list.querySelector('button')!.addEventListener('click', onJump);
    const badge = list.querySelector<HTMLElement>('[data-luck-path]')!;
    stubRect(badge, new DOMRect(300, 400, 50, 18));
    return { list, badge };
  }

  it('opens from a move-list badge on hover, for that badge’s move', () => {
    const { list, badge } = listWithBadge(() => {});
    const asked: string[] = [];
    detach = attachLuckBadgeCard(
      list,
      (el) => {
        asked.push(el.dataset.luckPath ?? '');
        return DETAIL;
      },
      stubPiece,
    );
    pointer(badge, 'pointerover', { pointerType: 'mouse' });
    expect(asked).toEqual(['a/b']);
    expect(openCard()?.textContent).toContain('Cost Red 7 points');
    // Leaving the badge for its move button closes it.
    pointer(badge, 'pointerout', {
      pointerType: 'mouse',
      relatedTarget: list.querySelector('.review-move-list__san'),
    });
    expect(openCard()).toBeNull();
    // An empty badge slot (a move with no luck) opens nothing.
    pointer(list.querySelectorAll('.review-move-list__luck')[1]!, 'pointerover', {
      pointerType: 'mouse',
    });
    expect(openCard()).toBeNull();
  });

  it('a tap on the badge pins the card and still selects the move', () => {
    let jumps = 0;
    const { list, badge } = listWithBadge(() => {
      jumps += 1;
    });
    detach = attachLuckBadgeCard(list, () => DETAIL, stubPiece);
    pointer(badge, 'pointerdown', { pointerType: 'touch' });
    badge.click();
    expect(jumps).toBe(1);
    expect(openCard()).not.toBeNull();
    // A second tap on the same badge closes it (and re-selects the same move, a no-op).
    pointer(badge, 'pointerdown', { pointerType: 'touch' });
    expect(openCard()).toBeNull();
    // A tap elsewhere closes a pinned card.
    pointer(badge, 'pointerdown', { pointerType: 'touch' });
    expect(openCard()).not.toBeNull();
    pointer(document.body, 'pointerdown', { pointerType: 'touch' });
    expect(openCard()).toBeNull();
  });
});
