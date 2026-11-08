import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CRAWLER_CONTENT_MANIFEST } from '../../server/src/crawler-content-manifest.js';
import { crawlerCopyProblems } from '../scripts/prerender-copy-check.mjs';
import { renderAnalysisShellForPrerender } from './analysis-page.js';
import { renderApiDocsShellForPrerender } from './api-docs-page.js';
import { renderChampionsShellForPrerender } from './champions-page.js';
import { buildContact } from './contact.js';
import { renderContributeShellForPrerender } from './contribute-page.js';
import { renderCreatorsShellForPrerender } from './creators-page.js';
import { renderDataAboutShellForPrerender } from './data-page.js';
import { renderDevelopersShellForPrerender } from './developers-page.js';
import { renderEditorShellForPrerender } from './editor/editor-page.js';
import { renderForumEtiquetteShellForPrerender } from './forum.js';
import { renderGamesSearchShellForPrerender } from './historical-xiangqi-search.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES } from './i18n/locale.js';
import { renderLearnXiangqiShellForPrerender } from './learn-xiangqi/learn-xiangqi-page.js';
import {
  mountAbout,
  renderAboutShellForPrerender,
  renderContactShellForPrerender,
  renderFaqShellForPrerender,
  renderPrivacyShellForPrerender,
  renderSourceShellForPrerender,
  renderTermsShellForPrerender,
} from './pages-static.js';
import { renderPracticeShellForPrerender } from './practice-index.js';
import { prerenderMount } from './prerender-copy.js';
import { captureServerRender } from './server-render-fallback.js';
import { renderVideosShellForPrerender } from './videos.js';
import { renderImportShellForPrerender } from './xiangqi-import-page.js';

// Node's native storage can shadow happy-dom's storage in the test worker.
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  document.body.replaceChildren();
});

const renderers = [
  [renderDevelopersShellForPrerender, 'developers.heading', '/developers'],
  [renderAboutShellForPrerender, 'about.lede', '/about'],
  [renderSourceShellForPrerender, 'source.intro', '/source'],
  [renderFaqShellForPrerender, 'faq.playWebQuestion', '/faq'],
  [renderTermsShellForPrerender, 'terms.intro', '/terms'],
  [renderPrivacyShellForPrerender, 'privacy.intro', '/privacy'],
  [renderContactShellForPrerender, 'contact.introAnon', '/contact'],
  [renderContributeShellForPrerender, 'contribute.intro', '/contribute'],
  [renderCreatorsShellForPrerender, 'creators.intro', '/creators'],
  [renderChampionsShellForPrerender, 'champions.intro', '/champions'],
  [renderVideosShellForPrerender, 'videos.heading', '/videos'],
  [renderDataAboutShellForPrerender, 'data.aboutHeading', '/data/about'],
  [renderForumEtiquetteShellForPrerender, 'forum.etiquetteLede', '/forum/etiquette'],
  [renderImportShellForPrerender, 'review.import.lede', '/import'],
  [renderGamesSearchShellForPrerender, 'historical.heading', '/games/search'],
  [renderPracticeShellForPrerender, 'practice.subtitle', '/practice'],
] as const;

it.each(SUPPORTED_LOCALES)(
  'bakes the existing catalog copy in %s without a fetch',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    const fetch = vi.fn(() => {
      throw new Error('prerenders must not fetch');
    });
    vi.stubGlobal('fetch', fetch);
    window.history.replaceState(null, '', '/');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    for (const [render, phrase] of renderers) {
      const html = await render(locale);
      expect(crawlerCopyProblems(html)).toEqual([]);
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      expect(parsed.querySelector('h1')?.textContent?.trim()).toBeTruthy();
      expect(parsed.body.textContent).toContain(t(phrase, {}, locale));
      expect(window.location.pathname).toBe('/');
      expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    }
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each(SUPPORTED_LOCALES)(
  'tools use visible controls in %s, without adding explanatory prose',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    const editor = await renderEditorShellForPrerender(locale, 'xiangqi');
    expect(editor).toContain(t('editor.startPosition', {}, locale));
    const analysis = await renderAnalysisShellForPrerender(locale, 'xiangqi');
    expect(analysis).toContain(t('analysis.editPosition', {}, locale));
    for (const html of [editor, analysis]) {
      expect(crawlerCopyProblems(html)).toEqual([]);
      expect(new DOMParser().parseFromString(html, 'text/html').querySelector('h1')).not.toBeNull();
    }
  },
);

function contentText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const node of doc.querySelectorAll(
    'script,style,template,svg,header,nav,footer,.site-nav,#site-menu',
  ))
    node.remove();
  return (doc.body.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

it('static page renderers meet their unchanged manifest floors', async () => {
  for (const [render, , path] of renderers) {
    const entry = CRAWLER_CONTENT_MANIFEST.find((row) => row.path === path)!;
    if (entry.knownGap) continue;
    expect(contentText(await render('en')).length, entry.path).toBeGreaterThanOrEqual(
      entry.minChars,
    );
  }
});

it.each(SUPPORTED_LOCALES)(
  'contact includes visible field hints in %s crawler text',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    const live = buildContact(null, false, locale).el;
    const html = await renderContactShellForPrerender(locale);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const field of live.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[placeholder],textarea[placeholder]',
    ))
      expect(contentText(html)).toContain(field.placeholder);
    expect(parsed.querySelector('[aria-hidden="true"] input[name="website"]')).toBeNull();
    expect(crawlerCopyProblems(html)).toEqual([]);
    if (locale === 'en') {
      const entry = CRAWLER_CONTENT_MANIFEST.find((row) => row.path === '/contact')!;
      // Planted regression: the same form with its hints only in attributes.
      expect(contentText(live.outerHTML).length).toBeLessThan(entry.minChars);
      expect(contentText(html).length).toBeGreaterThanOrEqual(entry.minChars);
    }
  },
);

it('API docs use the supplied OpenAPI operations and developers do not fetch demo data', () => {
  const fetch = vi.fn(() => {
    throw new Error('no build-time network');
  });
  vi.stubGlobal('fetch', fetch);
  const doc = {
    info: { title: 'API', version: '0', description: 'Public API' },
    paths: {
      '/api/planted-endpoint': {
        get: { summary: 'Planted operation', responses: { '200': { description: 'OK' } } },
      },
    },
  };
  const html = renderApiDocsShellForPrerender('en', doc);
  expect(html).toContain('/api/planted-endpoint');
  expect(html).toContain('Planted operation');
  const developers = renderDevelopersShellForPrerender('en');
  expect(developers).toContain('Embed a study chapter');
  expect(
    new DOMParser().parseFromString(developers, 'text/html').querySelector('iframe'),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('about mounts replace the baked wrapper with the same page content and restore it on failure', async () => {
  const root = document.createElement('div');
  root.innerHTML = await renderAboutShellForPrerender('en');
  const snapshot = captureServerRender(root);
  const before = root.textContent;
  mountAbout(root);
  expect(root.querySelector('.crawler-copy')).toBeNull();
  expect(root.textContent).toBe(before);
  snapshot.restore();
  expect(root.dataset.serverRender).toBe('restored');
  expect(root.querySelector('.crawler-copy')).not.toBeNull();
});

it('restores locale and URL when an existing mount fails during prerender', async () => {
  window.history.replaceState(null, '', '/import?keep=1#anchor');
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
  await expect(
    prerenderMount('zh-Hans', () => {
      throw new Error('planted mount failure');
    }),
  ).rejects.toThrow('planted mount failure');
  expect(window.location.pathname + window.location.search + window.location.hash).toBe(
    '/import?keep=1#anchor',
  );
  expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
});

it.each(SUPPORTED_LOCALES)('tool copy keeps honest manifest gaps in %s', async (locale) => {
  await ensureLocaleCatalog(locale);
  const prefix = locale === 'en' ? '' : `/${locale.toLowerCase()}`;
  const tools = [
    ['/analysis/xiangqi', () => renderAnalysisShellForPrerender(locale, 'xiangqi')],
    ['/editor/xiangqi', () => renderEditorShellForPrerender(locale, 'xiangqi')],
    ['/practice', () => renderPracticeShellForPrerender(locale)],
    ...(locale === 'en'
      ? ([
          ['/import', () => renderImportShellForPrerender(locale)],
          ['/games/search', () => renderGamesSearchShellForPrerender(locale)],
        ] as const)
      : []),
  ] as const;
  for (const [path, render] of tools) {
    const entry = CRAWLER_CONTENT_MANIFEST.find((row) => row.path === `${prefix}${path}`)!;
    const doc = new DOMParser().parseFromString(await render(), 'text/html');
    for (const node of doc.querySelectorAll(
      'script,style,template,svg,header,nav,footer,.site-nav,#site-menu',
    ))
      node.remove();
    const text = (doc.body.textContent ?? '').replace(/\s+/gu, ' ').trim();
    expect
      .soft(text.length >= entry.minChars, `${entry.path}: ${text.length} chars`)
      .toBe(!entry.knownGap || entry.knownGap.includes('alternates'));
  }
});

const localizedStaticPaths = [
  '/about',
  '/faq',
  '/terms',
  '/privacy',
  '/source',
  '/contribute',
  '/creators',
  '/data/about',
];

it.each(SUPPORTED_LOCALES)(
  'locale static pages and course preserve their existing copy in %s',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    const prefix = locale === 'en' ? '' : `/${locale.toLowerCase()}`;
    for (const [render, , path] of renderers) {
      if (!localizedStaticPaths.includes(path)) continue;
      const html = await render(locale);
      const text = contentText(html);
      const entry = CRAWLER_CONTENT_MANIFEST.find((row) => row.path === `${prefix}${path}`);
      expect(entry, `${prefix}${path}`).toBeDefined();
      if (entry) {
        expect(text, entry.path).toContain(entry.phrase);
        expect(text.length, entry.path).toBeGreaterThanOrEqual(entry.minChars);
      }
      expect(crawlerCopyProblems(html)).toEqual([]);
    }
    const html = await renderLearnXiangqiShellForPrerender(locale);
    const entry = CRAWLER_CONTENT_MANIFEST.find((row) => row.path === `${prefix}/learn/xiangqi`)!;
    expect(contentText(html)).toContain(entry.phrase);
    expect(contentText(html).length).toBeGreaterThanOrEqual(entry.minChars);
    expect(crawlerCopyProblems(html)).toEqual([]);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  },
);

it.each(['zh-Hans', 'zh-Hant'] as const)(
  'about follows the %s URL over stored English and replaces its crawler copy',
  async (locale) => {
    await ensureLocaleCatalog(locale);
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    window.history.replaceState(null, '', `/${locale.toLowerCase()}/about`);
    const root = document.createElement('div');
    root.innerHTML = await renderAboutShellForPrerender(locale);
    const text = contentText(root.outerHTML);
    mountAbout(root);
    expect(root.querySelector('.crawler-copy')).toBeNull();
    expect(contentText(root.outerHTML)).toBe(text);
    expect(root.textContent).toContain(t('about.lede', {}, locale));
  },
);
