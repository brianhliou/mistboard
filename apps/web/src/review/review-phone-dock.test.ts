import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMoveList } from './move-list.js';
import { createReviewScaffold, mountReviewLayout } from './review-layout.js';
import { mountXiangqiReview } from './xiangqi-review.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function host(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

describe('phone review dock', () => {
  it.each(['game', 'analysis', 'study'] as const)(
    'reserves dock space only for the game surface (%s)',
    (reviewSurface) => {
      const root = host();
      const abort = new AbortController();
      createReviewScaffold(root, {
        signal: abort.signal,
        reviewSurface,
        phoneOneScreen: true,
        ariaLabel: 'Review',
        title: '',
        summary: '',
        boards: [{ key: 'truth', tier: 'primary', el: document.createElement('div') }],
        boardAspect: 568 / 312,
        navigation: document.createElement('nav'),
        moves: createMoveList([], { title: 'Moves' }).el,
      });
      const spacer = root.querySelector('.review-phone-spacer');
      expect(Boolean(spacer)).toBe(reviewSurface === 'game');
      if (spacer) {
        expect(spacer.previousElementSibling?.classList.contains('review-stage')).toBe(true);
        expect(spacer.getAttribute('aria-hidden')).toBe('true');
      }
      abort.abort();
    },
  );

  it.each([undefined, true, false])('defaults game reviews into the phone sheet (%s)', (optIn) => {
    const root = host();
    const handle = mountXiangqiReview(root, {
      ariaLabel: 'Review',
      title: '',
      summary: '',
      moves: [],
      metaCard: document.createElement('section'),
      phoneInfoSheet: optIn,
      analysis: {
        requestLabel: 'Analyse',
        fetchCached: async () => null,
        run: vi.fn(),
      },
    });
    expect(root.classList.contains('has-review-info-sheet')).toBe(optIn !== false);
    const spacer = root.querySelector('.review-phone-spacer');
    const strip = root.querySelector('.review-phone-analysis');
    if (optIn !== false) {
      expect(spacer).not.toBeNull();
      expect(spacer?.nextElementSibling).toBe(strip);
      expect(root.querySelector('[data-review-info="game"]')).not.toBeNull();
    } else {
      expect(spacer).toBeNull();
    }
    handle.destroy();
  });

  it('keeps a snapshot review one screen while preserving its game info, export and chat', () => {
    const root = host();
    const metaCard = document.createElement('section');
    const underboard = document.createElement('div');
    const details = document.createElement('div');
    const renderBoards = vi.fn();
    mountReviewLayout(root, {
      ariaLabel: 'Duck Xiangqi',
      title: '',
      summary: '',
      metaCard,
      details,
      underboard,
      boards: [{ key: 'truth', tier: 'primary', el: document.createElement('div') }],
      boardAspect: 552 / 612,
      moves: createMoveList([{ ply: 1, label: 'a1-a2' }], { title: 'Moves' }).el,
      maxPly: 1,
      renderBoards,
    });
    expect(root.classList.contains('has-review-info-sheet')).toBe(true);
    expect(root.querySelector('.review-phone-spacer')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('.move-nav-menu__item[data-review-info="game"]')!.click();
    const gameSheet = root.querySelector('.review-info-sheet[data-review-info="game"]')!;
    expect(gameSheet.contains(metaCard)).toBe(true);
    expect(gameSheet.contains(underboard)).toBe(true);
    gameSheet.querySelector<HTMLButtonElement>('.review-info-sheet__close')!.click();
    expect(root.querySelector('.review-shell')?.contains(metaCard)).toBe(true);
    root.querySelector<HTMLButtonElement>('.move-nav-menu__item[data-review-info="chat"]')!.click();
    const chatSheet = root.querySelector('.review-info-sheet[data-review-info="chat"]')!;
    expect(chatSheet.contains(details)).toBe(true);
    chatSheet.querySelector<HTMLButtonElement>('.review-info-sheet__close')!.click();
    root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    expect(renderBoards).toHaveBeenLastCalledWith({ ply: 0, flipped: false, primaryKey: 'truth' });
  });

  it('gives the phone a viewport-sized stack with a flexible gap above the controls', () => {
    const css = readFileSync(resolve(__dirname, 'review-info-sheet.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'));
    const rule = (end: string) => {
      const at = phone.indexOf(`${end} {`);
      expect(at).toBeGreaterThan(-1);
      return phone.slice(at, phone.indexOf('}', at));
    };
    const cluster = rule('.review-shell__cluster.review-shell__cluster--col1-stack');
    expect(cluster).toContain('display: flex;');
    expect(cluster).toContain('flex-direction: column;');
    expect(cluster).toContain('height: calc(100dvh - 52px - env(safe-area-inset-bottom, 0px));');
    expect(cluster).toContain('box-sizing: border-box;');
    expect(rule('.has-review-info-sheet .review-shell .review-phone-spacer')).toContain(
      'flex: 1 0 0px;',
    );
    // Boards and controls keep their natural height; only the gap flexes.
    expect(rule('.has-review-info-sheet .review-shell .review-phone-analysis')).toContain(
      'flex: none;',
    );
    expect(css.slice(0, css.indexOf('@media'))).toContain(
      '.review-phone-spacer {\n  display: none;',
    );
  });
});
