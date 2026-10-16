import { describe, expect, it } from 'vitest';
import { createGameMetaCard } from './game-meta-card.js';

// The variant is the card's title line and the time control / mode sit under
// it. On one line ("1 day per move • Casual • Jieqi") the headline wrapped in
// the ~190px room rail, and long names ("Crazyhouse Xiangqi") always did.
describe('game meta card head', () => {
  it('puts the variant on the title line and the time control under it', () => {
    const card = createGameMetaCard({
      headline: ['1 day', null, 'Casual'],
      variantName: 'Crazyhouse Xiangqi',
      subline: 'Playing right now',
    });
    const lines = [...card.el.querySelectorAll('.game-meta-card__head-text > p')].map((line) => [
      line.className,
      line.textContent,
    ]);
    expect(lines).toEqual([
      ['game-meta-card__title', 'Crazyhouse Xiangqi'],
      ['game-meta-card__headline', '1 day • Casual'],
      ['game-meta-card__subline', 'Playing right now'],
    ]);
  });

  it('drops the empty time-control line when there are no segments', () => {
    const card = createGameMetaCard({ headline: [], variantName: 'Xiangqi' });
    expect(card.el.querySelector('.game-meta-card__title')?.textContent).toBe('Xiangqi');
    expect(card.el.querySelector('.game-meta-card__headline')).toBeNull();
  });

  it('keeps a headline link (a broadcast event) on the line under the variant', () => {
    const card = createGameMetaCard({
      headline: ['WXF Open'],
      headlineHref: '/broadcast/xiangqi/wxf',
      variantName: 'Xiangqi',
    });
    const link = card.el.querySelector<HTMLAnchorElement>(
      '.game-meta-card__headline a.game-meta-card__headline-link',
    );
    expect(link?.getAttribute('href')).toBe('/broadcast/xiangqi/wxf');
    expect(card.el.querySelector('.game-meta-card__title')?.textContent).toBe('Xiangqi');
  });

  it('makes the headline the title when there is no variant name', () => {
    const card = createGameMetaCard({ headline: ['Analysis board'] });
    expect(card.el.querySelector('.game-meta-card__title')?.textContent).toBe('Analysis board');
    expect(card.el.querySelector('.game-meta-card__headline')).toBeNull();
  });
});
