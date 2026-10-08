import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isArticleTranslationPublished, translateArticle } from './article-i18n.js';
import { articles } from './articles-data.js';
import { t } from './i18n/catalog.js';
import {
  articlesIndexPrerenderHead,
  mountAbout,
  mountContact,
  mountFaq,
  mountNews,
  mountNotFound,
  mountPrivacy,
  mountSource,
  mountTerms,
  PIECE_SET_SOURCE_URLS,
  renderArticlesIndexShellForPrerender,
  renderRulesIndexShellForPrerender,
  rulesIndexPrerenderHead,
} from './pages-static.js';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('about page platform activity', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/about');
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('hydrates public platform activity stats', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        generatedAt: '2026-05-29T12:00:00.000Z',
        totalCompletedGames: 1234,
        last30dCompletedGames: 56,
        publicGames: 78,
        modeTotals: { pvp: 42, pve: 31, eve: 9 },
        dailyCompletedGames: [
          { date: '2026-05-11', completedGames: 10, cumulativeGames: 10 },
          { date: '2026-05-12', completedGames: 0, cumulativeGames: 10 },
          { date: '2026-05-13', completedGames: 20, cumulativeGames: 30 },
          { date: '2026-05-14', completedGames: 0, cumulativeGames: 30 },
          { date: '2026-05-15', completedGames: 26, cumulativeGames: 56 },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const root = document.createElement('main');
    document.body.append(root);
    mountAbout(root);

    expect(root.textContent).toContain('Loading activity totals...');
    expect(root.querySelector('.static-page-rail')).not.toBeNull();
    expect(
      root.querySelector<HTMLAnchorElement>('.static-page-rail-link.active')?.textContent,
    ).toBe('About Mistboard');
    expect(
      root
        .querySelector<HTMLAnchorElement>('.static-page-rail-link.active')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    expect(
      Array.from(root.querySelectorAll<HTMLAnchorElement>('.static-page-rail-link')).map(
        (link) => link.textContent,
      ),
    ).toEqual([
      'About Mistboard',
      'Statistics',
      'Mistboard updates',
      'Changelog',
      'FAQ',
      'Contact',
      'Mistboard Patron',
      'Terms of Use',
      'Privacy',
      'Title verification',
      'Source code',
      'Contribute',
      'Work with us',
      'Engine champions',
      'Developers',
      'Game data',
      'API',
      'Thank you',
      'Is Mistboard lagging?',
    ]);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith('/api/stats/public', { credentials: 'same-origin' });
    expect(root.textContent).toContain('Player game activity');
    expect(root.textContent).toContain('finished games');
    expect(root.textContent).toContain('1,234');
    expect(root.textContent).toContain('last 30 days');
    expect(root.textContent).toContain('Player vs player');
    expect(root.textContent).not.toContain('Engine lab');
    const pageText = root.textContent ?? '';
    expect(pageText.indexOf('Open source foundation')).toBeLessThan(
      pageText.indexOf('Player game activity'),
    );
    expect(root.querySelectorAll('.platform-activity-metric')).toHaveLength(0);
    // The chart lives on /stats; the about section links there instead.
    expect(root.querySelector('.platform-activity-chart')).toBeNull();
    const more = root.querySelector<HTMLAnchorElement>('.platform-activity-more');
    expect(more?.textContent).toBe('Full statistics');
    expect(more?.getAttribute('href')).toBe('/stats');
    const modeItems = root.querySelectorAll('.platform-activity-mode-item');
    expect(modeItems).toHaveLength(2);
    expect(modeItems[0]?.textContent).toBe('Player vs player 42');
    expect(modeItems[1]?.textContent).toBe('Player vs engine 31');
    expect(root.querySelector('.platform-activity-mode-list')?.getAttribute('aria-label')).toBe(
      'Mode split',
    );
    expect(root.querySelector('.platform-activity-mode-heading')).toBeNull();
    expect(root.querySelector('.platform-activity-markers')).toBeNull();
  });

  it('keeps the about page readable when stats are unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );

    const root = document.createElement('main');
    document.body.append(root);
    mountAbout(root);
    await flushPromises();

    expect(root.textContent).toContain("Game totals can't be shown right now.");
    expect(root.textContent).toContain('Trust by design');
  });

  it('localizes Traditional Chinese about copy and activity stats', async () => {
    window.history.replaceState(null, '', '/zh-hant/about');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        generatedAt: '2026-05-29T12:00:00.000Z',
        totalCompletedGames: 1234,
        last30dCompletedGames: 56,
        publicGames: 78,
        modeTotals: { pvp: 42, pve: 31, eve: 9 },
        dailyCompletedGames: [
          { date: '2026-05-11', completedGames: 10, cumulativeGames: 10 },
          { date: '2026-05-12', completedGames: 0, cumulativeGames: 10 },
          { date: '2026-05-13', completedGames: 20, cumulativeGames: 30 },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const root = document.createElement('main');
    document.body.append(root);
    mountAbout(root);

    expect(root.textContent).toContain('正在載入活動統計...');
    await flushPromises();

    expect(root.querySelector('h1')?.textContent).toBe('關於 Mistboard');
    expect(root.textContent).toContain('以設計建立信任');
    expect(root.textContent).toContain('玩家對局活動');
    expect(root.textContent).toContain('共 1,234 局已完成的對局');
    expect(root.textContent).toContain('過去 30 天有 56 局');
    expect(root.textContent).toContain('玩家對玩家');
    expect(root.textContent).toContain('玩家對引擎');
    expect(root.querySelector('.platform-activity-mode-list')?.getAttribute('aria-label')).toBe(
      '模式分布',
    );
    expect(root.querySelector('.platform-activity-more')?.textContent).toBe('完整統計');
  });

  it('localizes Traditional Chinese source page chrome', () => {
    window.history.replaceState(null, '', '/zh-hant/source');

    const root = document.createElement('main');
    document.body.append(root);
    mountSource(root);

    expect(root.querySelector('h1')?.textContent).toBe('原始碼');
    expect(root.querySelector('.static-page-rail-link.active')?.textContent).toBe('原始碼');
    expect(root.textContent).toContain('專案原始碼');
    expect(root.textContent).toContain('GitHub 儲存庫');
    expect(root.textContent).toContain('第三方元件');
    expect(root.textContent).toContain('專案身份');
  });

  it('credits Pikafish on the source page with its site, weights license and repository', () => {
    const cases = [
      ['/source', 'Pikafish by the Pikafish developers', 'https://www.pikafish.com/en/list.html'],
      ['/zh-hans/source', '皮卡鱼（Pikafish）', 'https://www.pikafish.com/list.html'],
      ['/zh-hant/source', '皮卡魚（Pikafish）', 'https://www.pikafish.com/zh-hant/list.html'],
    ] as const;
    for (const [path, credit, licenseUrl] of cases) {
      window.history.replaceState(null, '', path);
      const root = document.createElement('main');
      document.body.append(root);
      mountSource(root);

      const line = root.querySelector('.source-credit-pikafish');
      expect(line, path).not.toBeNull();
      expect(line?.textContent).toContain(credit);
      const hrefs = [...(line?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual([
        'https://github.com/official-pikafish/Pikafish',
        'https://pikafish.com/',
        licenseUrl,
      ]);
      expect(line?.textContent).not.toContain('\u2014');
      root.remove();
    }
  });

  it('credits the five third-party xiangqi piece sets, with the CC BY licence on Wood', () => {
    const cases = [
      ['/source', 'by Kadagaden, CC BY 4.0'],
      ['/zh-hans/source', 'Kadagaden 的“gmchess style wood piece set”，CC BY 4.0'],
      ['/zh-hant/source', 'Kadagaden 的「gmchess style wood piece set」，CC BY 4.0'],
    ] as const;
    for (const [path, woodCredit] of cases) {
      window.history.replaceState(null, '', path);
      const root = document.createElement('main');
      document.body.append(root);
      mountSource(root);

      const hrefs = [...root.querySelectorAll('a')].map((a) => a.getAttribute('href'));
      for (const url of Object.values(PIECE_SET_SOURCE_URLS)) {
        expect(hrefs, `${path} ${url}`).toContain(url);
      }
      const wood = root.querySelector('.source-credit-wood');
      expect(wood?.textContent).toContain(woodCredit);
      expect([...(wood?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))).toEqual([
        PIECE_SET_SOURCE_URLS.wood,
        'https://creativecommons.org/licenses/by/4.0/',
      ]);
      expect(root.textContent).toContain('gbtami');
      expect(root.textContent).toContain('Andrew West');
      expect(root.textContent).not.toContain('\u2014');
      root.remove();
    }
  });

  it('renders feed and contact inside the static rail', async () => {
    window.history.replaceState(null, '', '/feed');

    const newsRoot = document.createElement('main');
    document.body.append(newsRoot);
    await mountNews(newsRoot);

    expect(newsRoot.querySelector('h1')?.textContent).toBe('Mistboard updates');
    expect(newsRoot.querySelector('.news-page-list')).not.toBeNull();
    expect(newsRoot.querySelector('.static-page-rail-link.active')?.textContent).toBe(
      'Mistboard updates',
    );
    expect(
      newsRoot
        .querySelector<HTMLAnchorElement>('.static-page-rail-link.active')
        ?.getAttribute('href'),
    ).toBe('/feed');

    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/contact');

    const contactRoot = document.createElement('main');
    document.body.append(contactRoot);
    mountContact(contactRoot);
    await flushPromises();

    expect(contactRoot.querySelector('h1')?.textContent).toBe('Contact');
    expect(contactRoot.querySelector('form.contact-form')).not.toBeNull();
    expect(contactRoot.querySelector('.static-page-rail-link.active')?.textContent).toBe('Contact');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { credentials: 'same-origin' });
  });

  it('localizes Traditional Chinese FAQ page chrome', () => {
    window.history.replaceState(null, '', '/zh-hant/faq');

    const root = document.createElement('main');
    document.body.append(root);
    mountFaq(root);

    expect(root.querySelector('h1')?.textContent).toBe('常見問題');
    expect(root.textContent).toContain('Mistboard 上可以玩什麼？');
    expect(root.textContent).toContain('規則參考列出了目前遊戲。');
    expect(root.textContent).toContain('我需要帳號嗎？');
    expect(root.textContent).toContain('如何回報 bug 或聯絡？');
    expect(root.textContent).toContain('Mistboard 引擎會看到完整棋盤嗎？');
    expect(root.textContent).toContain('計分對局如何運作？');
  });

  // A payment processor and a prospective patron both need the recurring-charge,
  // cancellation, and refund rules to exist on a durable page and to be reachable
  // from /patron. Losing either half is a silent compliance regression, so both
  // the section and the link out of it are asserted here.
  it('states the billing and refund policy on the terms page', () => {
    window.history.replaceState(null, '', '/terms');

    const root = document.createElement('main');
    document.body.append(root);
    mountTerms(root);

    const text = root.textContent ?? '';
    expect(text).toContain('Patron support and billing');
    expect(text).toContain('charged every month until you cancel');
    expect(text).toContain('not tax-deductible');
    expect(text).toContain('Cancelling and refunds');
    expect(text).toContain('within 30 days of the charge and we will refund it');

    const hrefs = [...root.querySelectorAll<HTMLAnchorElement>('a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/patron');
    expect(hrefs).toContain('/contact');
  });

  it('localizes Traditional Chinese terms page chrome', () => {
    window.history.replaceState(null, '', '/zh-hant/terms');

    const root = document.createElement('main');
    document.body.append(root);
    mountTerms(root);

    expect(root.querySelector('h1')?.textContent).toBe('使用條款');
    expect(root.textContent).toContain('網站按現狀提供');
    expect(root.textContent).toContain('計分對局需要帳號');
    expect(root.textContent).toContain('公平性資料');
    expect(root.textContent).toContain('我們收集什麼見隱私。');
    expect(root.textContent).toContain('已結束對局預設公開');
    expect(root.textContent).toContain('授權與鳴謝見原始碼。');
  });

  it('localizes Traditional Chinese privacy page chrome', () => {
    window.history.replaceState(null, '', '/zh-hant/privacy');

    const root = document.createElement('main');
    document.body.append(root);
    mountPrivacy(root);

    expect(root.querySelector('h1')?.textContent).toBe('隱私');
    expect(root.textContent).toContain('我們收集什麼');
    expect(root.textContent).toContain('我們不會做什麼');
    expect(root.textContent).toContain('你的對局是公開的');
    expect(root.textContent).toContain(
      '已結束的對局是公開的，並按月發布在對局資料頁面供下載，採用 CC BY 4.0 授權。',
    );
    expect(root.textContent).toContain('我們承諾什麼，以及不承諾什麼');
  });

  it('localizes Traditional Chinese not-found page chrome', () => {
    window.history.replaceState(null, '', '/zh-hant/missing');

    const root = document.createElement('main');
    document.body.append(root);
    mountNotFound(root);

    expect(root.querySelector('h1')?.textContent).toBe('找不到頁面');
    expect(root.textContent).toContain('這個頁面不存在，或已經移動。');
    expect(root.textContent).toContain('返回首頁');
    expect(root.textContent).toContain('還是找不到？聯絡。');
  });
});

// The zh blog indexes were served as a client-rendered shell with no canonical
// or hreflang until 2026-10-02; the prerender now bakes one per locale. The
// baked DOM must be the localized list, and every member of the group must
// name the same alternates with its own canonical.
describe('prerendered blog index', () => {
  it('bakes the Chinese post titles into the zh indexes', async () => {
    const zhOnly = articles.filter(
      (a) =>
        a.kind === 'article' &&
        a.status === 'published' &&
        isArticleTranslationPublished(a.slug) &&
        translateArticle(a, 'zh-Hans').title !== a.title,
    );
    expect(zhOnly.length).toBeGreaterThan(0);
    const sample = zhOnly[0];
    if (!sample) throw new Error('no translated article');

    const hans = await renderArticlesIndexShellForPrerender('zh-Hans');
    const hant = await renderArticlesIndexShellForPrerender('zh-Hant');
    const en = await renderArticlesIndexShellForPrerender();
    expect(hans).toContain(translateArticle(sample, 'zh-Hans').title);
    expect(hant).toContain(translateArticle(sample, 'zh-Hant').title);
    expect(en).toContain(sample.title);
    expect(hans).not.toBe(en);
  });

  it('gives each index a self canonical and the same alternate set', () => {
    const host = 'https://mistboard.com';
    const heads = [undefined, 'zh-Hans', 'zh-Hant'].map((lang) =>
      articlesIndexPrerenderHead(host, lang as 'zh-Hans' | 'zh-Hant' | undefined),
    );
    expect(heads.map((h) => h.url)).toEqual([
      `${host}/blog`,
      `${host}/zh-hans/blog`,
      `${host}/zh-hant/blog`,
    ]);
    const alternatesOf = (links: string) =>
      (links.match(/<link rel="alternate" hreflang=[^>]*>/g) ?? []).join('');
    for (const head of heads) {
      expect(head.headLinks).toContain(`<link rel="canonical" href="${head.url}" />`);
      expect(alternatesOf(head.headLinks)).toBe(alternatesOf(heads[0]?.headLinks ?? ''));
    }
    const alternates = alternatesOf(heads[0]?.headLinks ?? '');
    for (const [lang, href] of [
      ['en', `${host}/blog`],
      ['zh-Hans', `${host}/zh-hans/blog`],
      ['zh-Hant', `${host}/zh-hant/blog`],
      ['x-default', `${host}/blog`],
    ]) {
      expect(alternates).toContain(`hreflang="${lang}" href="${href}"`);
    }
    expect(heads[1]?.title).toBe('文章 | Mistboard');
  });
});

// /rules, /zh-hans/rules and /zh-hant/rules sat in the sitemap answering with
// the 4.9KB client shell (no canonical, no hreflang, no text) until 2026-10-02.
// The prerender bakes one per locale: the baked DOM must carry that locale's
// own copy, and every member names the same alternates with its own canonical.
describe('prerendered rules index', () => {
  it('bakes each locale its own heading, intro and rules tiles', async () => {
    // The prerender points the DOM at each page's own URL while it bakes, so a
    // widget that reads currentLocale() itself gets the right language.
    window.history.replaceState(null, '', '/rules');
    const en = await renderRulesIndexShellForPrerender();
    window.history.replaceState(null, '', '/zh-hans/rules');
    const hans = await renderRulesIndexShellForPrerender('zh-Hans');
    window.history.replaceState(null, '', '/zh-hant/rules');
    const hant = await renderRulesIndexShellForPrerender('zh-Hant');
    window.history.replaceState(null, '', '/');
    for (const [html, locale] of [
      [en, 'en'],
      [hans, 'zh-Hans'],
      [hant, 'zh-Hant'],
    ] as const) {
      expect(html).toContain(t('rules.heading', {}, locale));
      expect(html).toContain(t('rules.intro', {}, locale));
      expect(html).toContain(t('rules.body1', {}, locale));
      expect(html).toContain('rules-landing-tile');
    }
    expect(t('rules.intro', {}, 'zh-Hans')).not.toBe(t('rules.intro', {}, 'en'));
    expect(hans).toContain('href="/zh-hans/rules/');
    expect(hant).toContain('href="/zh-hant/rules/');
    expect(en).not.toContain('href="/zh-hans/rules/');
  });

  it('gives each index a self canonical and the same alternate set', () => {
    const host = 'https://mistboard.com';
    const heads = [undefined, 'zh-Hans', 'zh-Hant'].map((lang) =>
      rulesIndexPrerenderHead(host, lang as 'zh-Hans' | 'zh-Hant' | undefined),
    );
    expect(heads.map((h) => h.url)).toEqual([
      `${host}/rules`,
      `${host}/zh-hans/rules`,
      `${host}/zh-hant/rules`,
    ]);
    const alternatesOf = (links: string) =>
      (links.match(/<link rel="alternate" hreflang=[^>]*>/g) ?? []).join('');
    for (const head of heads) {
      expect(head.headLinks).toContain(`<link rel="canonical" href="${head.url}" />`);
      expect(alternatesOf(head.headLinks)).toBe(alternatesOf(heads[0]?.headLinks ?? ''));
    }
    const alternates = alternatesOf(heads[0]?.headLinks ?? '');
    for (const [lang, href] of [
      ['en', `${host}/rules`],
      ['zh-Hans', `${host}/zh-hans/rules`],
      ['zh-Hant', `${host}/zh-hant/rules`],
      ['x-default', `${host}/rules`],
    ]) {
      expect(alternates).toContain(`hreflang="${lang}" href="${href}"`);
    }
    expect(heads.map((h) => h.title)).toEqual([
      'Rules | Mistboard',
      '规则 | Mistboard',
      '規則 | Mistboard',
    ]);
  });
});
