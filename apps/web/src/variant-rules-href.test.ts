import { GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { findArticle } from './articles-data.js';
import { timeControlLabelForGame } from './game-meta.js';
import { correspondenceLabelFromMs } from './replay-meta.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { reviewTimeControlLabel } from './review/game-review-meta.js';
import { localizedRulesHrefForRoom, rulesHrefForGameSpec } from './variant-public-surfaces.js';

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

describe('localizedRulesHrefForRoom', () => {
  // Review pages know the room, not the spec: the tenant's room-id prefix
  // resolves it.
  it('resolves a room id to its variant rules page', () => {
    expect(localizedRulesHrefForRoom('xq_4959feb1')).toBe('/rules/xiangqi');
    expect(localizedRulesHrefForRoom('jgf_bbe6109c')).toBe('/rules/jungle-flip');
    expect(localizedRulesHrefForRoom('nope_123')).toBeNull();
  });
});

// A games row keeps only initialMs/incrementMs, so a finished 3-day game read
// "72:00:00" on the /watch and review cards (2026-10-03).
describe('correspondence time-control label', () => {
  const DAY_MS = 86_400_000;
  it('names the allowance in days on every card', () => {
    expect(correspondenceLabelFromMs(3 * DAY_MS, 0)).toBe('3 days');
    expect(correspondenceLabelFromMs(DAY_MS, 0)).toBe('1 day');
    expect(reviewTimeControlLabel({ initialMs: 7 * DAY_MS, incrementMs: 0 })).toBe('7 days');
    expect(
      timeControlLabelForGame({ initialMs: 3 * DAY_MS, incrementMs: 0 } as Parameters<
        typeof timeControlLabelForGame
      >[0]),
    ).toBe('3 days');
  });

  it('leaves live clocks and unofficial allowances alone', () => {
    expect(correspondenceLabelFromMs(600_000, 5_000)).toBeNull();
    expect(correspondenceLabelFromMs(3 * DAY_MS, 1_000)).toBeNull();
    expect(correspondenceLabelFromMs(2 * DAY_MS, 0)).toBeNull();
    expect(reviewTimeControlLabel({ initialMs: 600_000, incrementMs: 5_000 })).toBe('10:00+5');
  });
});

describe('game meta card variant link', () => {
  it('opens in a new tab when asked (a live room)', () => {
    const card = createGameMetaCard({
      headline: [],
      variantName: 'Xiangqi',
      variantHref: '/rules/xiangqi',
      variantHrefNewTab: true,
    });
    const anchor = card.el.querySelector<HTMLAnchorElement>('a.game-meta-card__variant');
    expect(anchor?.target).toBe('_blank');
    expect(anchor?.rel).toBe('noopener');
  });

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
