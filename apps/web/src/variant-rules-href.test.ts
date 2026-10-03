import { GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { findArticle } from './articles-data.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { rulesHrefForGameSpec } from './variant-public-surfaces.js';

// The /watch meta card links its green variant name to the rules page. The
// spec -> slug direction had no helper (every rules link was a hand-typed
// string), so this pins it against the article registry: a link that is
// offered must land on a rules page, and the two fog aliases resolve.
describe('rulesHrefForGameSpec', () => {
  it('every offered href lands on a rules article', () => {
    const offered = GAME_SPECS.map((spec) => rulesHrefForGameSpec(spec.id)).filter(
      (href): href is string => href !== null,
    );
    expect(offered.length).toBeGreaterThan(5);
    for (const href of offered) {
      expect(findArticle(href.slice('/rules/'.length))?.kind, href).toBe('rules');
    }
  });

  it('maps the fog specs to their public slugs', () => {
    expect(rulesHrefForGameSpec('dark-chess')).toBe('/rules/fog-chess');
    expect(rulesHrefForGameSpec('dark-xiangqi')).toBe('/rules/fog-xiangqi');
    expect(rulesHrefForGameSpec('xiangqi')).toBe('/rules/xiangqi');
  });

  it('offers nothing for study-only, unlisted, or unknown variants', () => {
    expect(rulesHrefForGameSpec('chess')).toBeNull();
    expect(rulesHrefForGameSpec('mahjong')).toBeNull();
    expect(rulesHrefForGameSpec('not-a-variant')).toBeNull();
  });
});

describe('game meta card variant link', () => {
  it('renders the variant name as a link only when given an href', () => {
    const linked = createGameMetaCard({
      headline: ['10 + 5'],
      variantName: 'Fog Chess',
      variantHref: '/rules/fog-chess',
    });
    const anchor = linked.el.querySelector<HTMLAnchorElement>('a.game-meta-card__variant');
    expect(anchor?.getAttribute('href')).toBe('/rules/fog-chess');
    expect(anchor?.textContent).toBe('Fog Chess');

    const plain = createGameMetaCard({ headline: ['10 + 5'], variantName: 'Fog Chess' });
    expect(plain.el.querySelector('a.game-meta-card__variant')).toBeNull();
    expect(plain.el.querySelector('span.game-meta-card__variant')?.textContent).toBe('Fog Chess');
  });
});
