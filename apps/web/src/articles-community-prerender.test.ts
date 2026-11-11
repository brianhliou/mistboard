import { expect, it } from 'vitest';
import { CRAWLER_CONTENT_MANIFEST } from '../../server/src/crawler-content-manifest.js';
import { crawlerCopyProblems } from '../scripts/prerender-copy-check.mjs';
import { publishedArticleLang, translateArticle } from './article-i18n.js';
import { scheduledArticleIndexEntry } from './article-index-schedule.js';
import { buildArticlesIndex, buildRulesIndex } from './articles.js';
import { articles } from './articles-data.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import {
  articlesIndexPrerenderHead,
  renderArticlesIndexShellForPrerender,
} from './pages-static.js';

it.each(SUPPORTED_LOCALES)(
  'prerenders the same community content as the %s client',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    const lang = locale === 'en' ? undefined : locale;
    const html = await renderArticlesIndexShellForPrerender(lang, 'community');
    expect(crawlerCopyProblems(html)).toEqual([]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const client = buildArticlesIndex(lang, 'community');
    expect(doc.querySelector('main')?.outerHTML).toBe(client.outerHTML);
    expect(doc.querySelector('h1')?.textContent).toBe(t('articles.writer.heading', {}, locale));
    expect(doc.querySelectorAll('.articles-community-pitch-benefits li')).toHaveLength(4);
    expect(doc.querySelectorAll('.articles-community-pitch-steps li')).toHaveLength(3);
    if (locale !== 'en') {
      expect(client.textContent).not.toMatch(
        /Become a Mistboard|What you get|Example:|Apply to contribute/,
      );
    }
    // Measure only page-owned copy, as the crawler floor does.
    for (const node of doc.querySelectorAll(
      'script,style,template,svg,header,nav,footer,.site-nav,#site-menu',
    ))
      node.remove();
    const text = doc.body.textContent.replace(/\s+/gu, ' ').trim();
    const path = `${locale === 'en' ? '' : `/${locale.toLowerCase()}`}/blog/community`;
    const contract = CRAWLER_CONTENT_MANIFEST.find((entry) => entry.path === path);
    expect(contract, path).toBeDefined();
    expect(contract?.knownGap).toBeUndefined();
    expect(text).toContain(contract!.phrase);
    expect(text.length).toBeGreaterThanOrEqual(contract!.minChars);
    const head = articlesIndexPrerenderHead('https://mistboard.test', lang, 'community');
    const prefix = locale === 'en' ? '' : `/${locale.toLowerCase()}`;
    expect(head.url).toBe(`https://mistboard.test${prefix}/blog/community`);
    for (const other of SUPPORTED_LOCALES) {
      const otherPrefix = other === 'en' ? '' : `/${other.toLowerCase()}`;
      expect(head.headLinks).toContain(
        `hreflang="${other}" href="https://mistboard.test${otherPrefix}/blog/community"`,
      );
    }
    // Planted failure: the exact same text must fail ownership without its wrapper.
    expect(crawlerCopyProblems(client.outerHTML)).toContain('page text outside crawler-copy');
  },
);

it('exports scheduled cards with the client listing policy and translations', async () => {
  const article = articles.find((entry) => entry.slug === 'jieqi-openings');
  if (article?.kind !== 'article') throw new Error('missing translated blog fixture');
  const entry = scheduledArticleIndexEntry(article);
  expect(entry?.kind).toBe('article');
  expect(entry?.publisher).toBe('mistboard');
  for (const locale of SUPPORTED_LOCALES) {
    const lang = publishedArticleLang(article.slug, locale === 'en' ? undefined : locale);
    const localized = lang ? translateArticle(article, lang) : article;
    expect(entry?.locales[locale.toLowerCase()]).toEqual({
      title: localized.title,
      summary: localized.summary,
      href: `${locale === 'en' ? '' : `/${locale.toLowerCase()}`}/blog/jieqi-openings`,
    });
  }
  for (const hidden of [
    { ...article, showInIndex: false },
    { ...article, noindex: true },
    { ...article, sourceLang: 'vi' as const },
    { ...article, kind: 'rules' as const, slug: 'fortress-xiangqi', gameSpecId: undefined },
  ])
    expect(scheduledArticleIndexEntry(hidden)).toBeNull();
  expect(scheduledArticleIndexEntry({ ...article, publisher: 'community' })?.publisher).toBe(
    'community',
  );
});

it('exports only the labels the rules index displays, without article summaries', () => {
  const rules = articles.find((article) => article.slug === 'xiangqi');
  if (!rules) throw new Error('missing rules fixture');
  const entry = scheduledArticleIndexEntry(rules);
  for (const locale of SUPPORTED_LOCALES) {
    const lang = locale === 'en' ? undefined : locale;
    const label = buildRulesIndex(lang).querySelector(
      `a[href$="/rules/xiangqi"] .rules-landing-tile-label`,
    );
    expect(entry?.locales[locale.toLowerCase()]?.title).toBe(label?.textContent);
    expect(entry?.locales[locale.toLowerCase()]?.summary).toBe('');
  }
});
