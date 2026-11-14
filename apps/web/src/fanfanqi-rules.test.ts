import {
  FFQ_BANQI_FACE_UP_SQUARES,
  FFQ_BANQI_RULES,
  FFQ_BANQI_SPEC_ID,
  gameSpecForId,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARTICLE_META,
  articleIsIndexable,
  articleIsUnpublished,
  canonicalArticleBase,
} from '../../server/src/article-meta.js';
import { isArticleTranslationPublished } from './article-i18n.js';
import { articleProse } from './article-prose.js';
import { buildArticlePage, buildRulesIndex } from './articles.js';
import { findArticle } from './articles-data.js';
import { FANFANQI_CHASE_RUN_STEPS } from './fanfanqi-rules-diagrams.js';
import {
  gameSpecIdFromRulesSlug,
  rulesHrefForGameSpec,
  rulesSlugForGameSpec,
  rulesSlugPublicSurfaceEnabled,
  variantPublicSurfaceEnabled,
  variantSupportsPve,
} from './variant-public-surfaces.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Fanfanqi rules registration', () => {
  it('publishes the English rules slug for the launched spec on both ends', () => {
    expect(gameSpecForId(FFQ_BANQI_SPEC_ID).publicName).toBe('Fanfanqi');
    expect(findArticle('fanfanqi')).toMatchObject({
      kind: 'rules',
      status: 'published',
      title: 'Fanfanqi Rules',
    });
    expect(rulesSlugForGameSpec(FFQ_BANQI_SPEC_ID)).toBe('fanfanqi');
    expect(gameSpecIdFromRulesSlug('fanfanqi')).toBe(FFQ_BANQI_SPEC_ID);
    expect(canonicalArticleBase('fanfanqi')).toBe('rules');
    expect(ARTICLE_META.fanfanqi).toMatchObject({ kind: 'rules', title: 'Fanfanqi Rules' });
    expect(articleIsUnpublished('fanfanqi')).toBe(false);
    expect(articleIsIndexable('fanfanqi')).toBe(true);
    expect(isArticleTranslationPublished('fanfanqi')).toBe(true);
  });

  it('lists the launched English rules in production even with play disabled', () => {
    // The page goes live at 16:00 UTC on its publishedAt date.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T16:00:00Z') });
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'false');
    vi.stubEnv('DEV', false);
    expect(buildArticlePage('fanfanqi').dataset.articleSlug).toBe('fanfanqi');
    expect(rulesSlugPublicSurfaceEnabled('fanfanqi')).toBe(true);
    expect(buildRulesIndex().querySelector('a[href="/rules/fanfanqi"]')).not.toBeNull();
    for (const slug of ['banqi', 'fanfanqi']) {
      expect(
        buildArticlePage(slug).querySelector('.article-variant-sidebar a[href="/rules/fanfanqi"]'),
      ).not.toBeNull();
    }
  });

  it('lists Fanfanqi with its own marker and the standard play buttons', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    expect(variantPublicSurfaceEnabled(FFQ_BANQI_SPEC_ID)).toBe(true);
    expect(rulesHrefForGameSpec(FFQ_BANQI_SPEC_ID)).toBe('/rules/fanfanqi');
    expect(rulesSlugPublicSurfaceEnabled('fanfanqi')).toBe(true);
    const index = buildRulesIndex();
    const tile = index.querySelector('.rules-landing-tile[href="/rules/fanfanqi"]');
    expect(tile?.querySelector('.rules-landing-tile-label')?.textContent).toBe('Fanfanqi');
    for (const surface of [index, buildArticlePage('banqi'), buildArticlePage('fanfanqi')]) {
      const link = surface.querySelector('.article-variant-sidebar a[href="/rules/fanfanqi"]');
      expect(link?.querySelector('[data-variant-marker-id="ffq-banqi"]')).not.toBeNull();
    }
    const page = buildArticlePage('fanfanqi');
    expect(page.querySelector('h1')?.textContent).toBe('Fanfanqi Rules');
    const rows = [...page.querySelectorAll('.article-cta-row')];
    expect(rows).toHaveLength(2);
    const buttons = (row: Element) =>
      [...row.querySelectorAll('a.article-cta')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]);
    // Both rows are the generated play row: friend play alone until the bot
    // registers, then "Play Fanfanqi" (computer) beside "Play a friend".
    const expected = variantSupportsPve(FFQ_BANQI_SPEC_ID)
      ? [
          ['Play Fanfanqi', '/?play=computer&gameSpecId=ffq-banqi'],
          ['Play a friend', '/?play=friend&gameSpecId=ffq-banqi'],
        ]
      : [['Play Fanfanqi', '/?play=friend&gameSpecId=ffq-banqi']];
    for (const row of rows) expect(buttons(row)).toEqual(expected);
  });
});

describe('Fanfanqi rules match the kernel', () => {
  it('keeps every damage value and the rank ladder aligned with FFQ_BANQI_RULES', () => {
    const article = findArticle('fanfanqi')!;
    const tableIn = (heading: string) => {
      const block = article.sections
        .find((section) => section.heading === heading)
        ?.blocks?.find((b) => b.kind === 'table');
      if (block?.kind !== 'table') throw new Error(`no table under ${heading}`);
      return block;
    };
    const damage = Object.fromEntries(
      tableIn('HP and capture damage').rows.map(([piece, value]) => [
        piece!.toLowerCase(),
        Number(value),
      ]),
    );
    expect(damage).toEqual(FFQ_BANQI_RULES.captureDamage);
    // One general, five soldiers, two of every other piece.
    const sideTotal = Object.entries(FFQ_BANQI_RULES.captureDamage).reduce(
      (sum, [role, hp]) => sum + hp * (role === 'general' ? 1 : role === 'soldier' ? 5 : 2),
      0,
    );
    const compared = Object.fromEntries(
      tableIn('How Fanfanqi differs from banqi').rows.map(([rule, , ffq]) => [rule, ffq]),
    );
    expect(compared.Draws).toBe(`${FFQ_BANQI_RULES.noProgressPlies} plies with no flip or capture`);
    const spelled = ['one', 'two', 'three', 'four', 'five', 'six'];
    expect(compared.Chases).toBe(
      `At most ${spelled[FFQ_BANQI_RULES.consecutiveChaseLimit - 1]} chases in a row`,
    );
    expect(compared.Start).toBe(`Four face up, ${32 - FFQ_BANQI_FACE_UP_SQUARES.length} face down`);
    const prose = articleProse(article)
      .map(({ text }) => text)
      .join('\n');
    expect(prose).toContain(FFQ_BANQI_RULES.captureRankOrder.join(' > '));
    expect(prose).toContain(`${FFQ_BANQI_RULES.startingHP} HP`);
    expect(prose).toContain(
      `add up to ${sideTotal} HP of damage against a start of ${FFQ_BANQI_RULES.startingHP}`,
    );
    expect(prose).toContain(`After ${FFQ_BANQI_RULES.noProgressPlies} plies`);
    expect(prose).not.toContain('—');
    // The name is glossed once; the page still describes the game by its rules, not a region.
    expect(prose).not.toMatch(/Taiwan|mainland/);
    expect(article.sections.at(-1)?.blocks?.at(-1)?.kind).toBe('cta');
  });

  it('chase run: moves show as the live cell tint, and the last frame dots the one step left', () => {
    const svgs = FANFANQI_CHASE_RUN_STEPS.map((step) => step.svg());
    for (const svg of svgs.slice(1)) {
      expect(svg).not.toContain('marker-end');
      expect((svg.match(/<rect [^>]*fill="rgba\((194, 32, 26|22, 40, 58)/g) ?? []).length).toBe(2);
    }
    expect(svgs.slice(0, -1).every((svg) => !/rgba\(31, 111, 91/.test(svg))).toBe(true);
    expect((svgs.at(-1)!.match(/<circle[^>]*rgba\(31, 111, 91/g) ?? []).length).toBe(1);
    expect((svgs.at(-1)!.match(/stroke="rgba\(178, 34, 28/g) ?? []).length).toBe(2);
  });
});
