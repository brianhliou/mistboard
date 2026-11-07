import { FFQ_BANQI_RULES, FFQ_BANQI_SPEC_ID, gameSpecForId } from '@mistboard/game';
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
import {
  gameSpecIdFromRulesSlug,
  rulesHrefForGameSpec,
  rulesSlugForGameSpec,
  rulesSlugPublicSurfaceEnabled,
  variantPublicSurfaceEnabled,
} from './variant-public-surfaces.js';

afterEach(() => vi.unstubAllEnvs());

describe('Fanfanqi rules registration', () => {
  it('maps the English rules slug to the unchanged hidden spec on both ends', () => {
    expect(gameSpecForId(FFQ_BANQI_SPEC_ID).publicName).toBe('Fanfanqi');
    expect(findArticle('fanfanqi')).toMatchObject({
      kind: 'rules',
      status: 'draft',
      title: 'Fanfanqi Rules',
    });
    expect(rulesSlugForGameSpec(FFQ_BANQI_SPEC_ID)).toBe('fanfanqi');
    expect(gameSpecIdFromRulesSlug('fanfanqi')).toBe(FFQ_BANQI_SPEC_ID);
    expect(canonicalArticleBase('fanfanqi')).toBe('rules');
    expect(ARTICLE_META.fanfanqi).toMatchObject({ kind: 'rules', title: 'Fanfanqi Rules' });
    expect(articleIsUnpublished('fanfanqi')).toBe(true);
    expect(articleIsIndexable('fanfanqi')).toBe(false);
    expect(isArticleTranslationPublished('fanfanqi')).toBe(false);
  });

  it('hides the page in production, and keeps local listings and play off without the flag', () => {
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'false');
    vi.stubEnv('DEV', false);
    expect(buildArticlePage('fanfanqi').dataset.articleSlug).toBeUndefined();
    expect(rulesSlugPublicSurfaceEnabled('fanfanqi')).toBe(false);
    for (const dev of [false, true]) {
      vi.stubEnv('DEV', dev);
      expect(buildRulesIndex().querySelector('a[href="/rules/fanfanqi"]')).toBeNull();
      const page = buildArticlePage('fanfanqi');
      expect(page.querySelector('a[href*="gameSpecId=ffq-banqi"]')).toBeNull();
      expect(page.querySelector('.article-variant-sidebar a[href="/rules/fanfanqi"]')).toBeNull();
    }
  });

  it('lists the local playtest with its own marker and offers friend play in both rows', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    expect(variantPublicSurfaceEnabled(FFQ_BANQI_SPEC_ID)).toBe(false);
    expect(rulesHrefForGameSpec(FFQ_BANQI_SPEC_ID)).toBeNull();
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
    for (const row of rows) {
      const buttons = [...row.querySelectorAll('a.article-cta')];
      expect(buttons.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
        ['Play Fanfanqi', '/?play=friend&gameSpecId=ffq-banqi'],
      ]);
    }
  });
});

describe('Fanfanqi rules match the kernel', () => {
  it('keeps every damage value and the rank ladder aligned with FFQ_BANQI_RULES', () => {
    const article = findArticle('fanfanqi')!;
    const tables = article.sections.flatMap((section) =>
      (section.blocks ?? []).filter((block) => block.kind === 'table'),
    );
    expect(tables).toHaveLength(1);
    const damage = Object.fromEntries(
      tables[0]!.rows.map(([piece, value]) => [piece!.toLowerCase(), Number(value)]),
    );
    expect(damage).toEqual(FFQ_BANQI_RULES.captureDamage);
    const prose = articleProse(article)
      .map(({ text }) => text)
      .join('\n');
    expect(prose).toContain(FFQ_BANQI_RULES.captureRankOrder.join(' > '));
    expect(prose).toContain(`${FFQ_BANQI_RULES.startingHP} HP`);
    expect(prose).toContain(`After ${FFQ_BANQI_RULES.noProgressPlies} plies`);
    expect(prose).not.toContain('—');
    expect(prose.match(/翻翻棋/g)).toHaveLength(1);
    expect(article.sections.at(-1)?.blocks?.at(-1)?.kind).toBe('cta');
  });
});
