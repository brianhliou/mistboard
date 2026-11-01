import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasAppTranslation, type I18nKey, t } from '../i18n/catalog.js';
import { type Locale, SUPPORTED_LOCALES, setStoredLocale } from '../i18n/locale.js';
import { puzzleNavItems } from '../nav-items.js';
import {
  centreActivePuzzleMenuItem,
  type PuzzleMenuPage,
  renderPuzzleMenu,
  renderPuzzleMenuLayout,
} from './puzzle-menu.js';

const DASHBOARD_COPY = {
  'puzzle.dashboardTitle': ['Puzzle Dashboard', '解题面板', '解題面板'],
  'puzzle.dashboardSubtitle': ['Train, analyse, improve', '训练、分析、提高', '訓練、分析、進步'],
  'puzzle.historyTitle': ['Puzzle history', '解题记录', '解題紀錄'],
  'puzzle.dashboardPlayed': ['Played', '已练习', '已練習'],
  'puzzle.dashboardPerformance': ['Performance', '表现', '表現'],
  'puzzle.dashboardSolved': ['Solved', '已解开', '已解開'],
  'puzzle.dashboardToReplay': ['To replay', '待重做', '待重做'],
  'puzzle.dashboardEmpty': [
    'Nothing to show, go play some puzzles first!',
    '暂无数据，先去做几道题吧！',
    '暫無資料，先去做幾道題吧！',
  ],
  'puzzle.dashboardSignIn': [
    'Sign in to see your puzzle dashboard',
    '登录后查看你的解题面板',
    '登入後查看你的解題面板',
  ],
  'puzzle.dashboardDays': ['{n} days', '{n} 天', '{n} 天'],
  'puzzle.dashboardDay': ['1 day', '1 天', '1 天'],
} satisfies Partial<Record<I18nKey, readonly [string, string, string]>>;

describe('puzzle dashboard translations', () => {
  it.each(SUPPORTED_LOCALES)('supplies every dashboard string in %s', (locale) => {
    const localeIndex = SUPPORTED_LOCALES.indexOf(locale);
    for (const [key, values] of Object.entries(DASHBOARD_COPY)) {
      const i18nKey = key as I18nKey;
      expect(hasAppTranslation(locale, i18nKey), `${locale}:${key}`).toBe(true);
      expect(t(i18nKey, {}, locale)).toBe(values[localeIndex]);
      expect(t(i18nKey, {}, locale)).not.toContain('—');
    }
  });

  it.each([
    ['en', '1 day', '7 days'],
    ['zh-Hans', '1 天', '7 天'],
    ['zh-Hant', '1 天', '7 天'],
  ] as const)('formats singular and plural days in %s', (locale: Locale, one, many) => {
    expect(t('puzzle.dashboardDay', {}, locale)).toBe(one);
    expect(t('puzzle.dashboardDays', { n: 7 }, locale)).toBe(many);
  });
});

const PAGES = ['puzzles', 'themes', 'streak', 'dashboard', 'history'] as const;
const HREFS = [
  '/puzzles',
  '/puzzles/themes',
  '/puzzles?mode=streak',
  '/puzzles/dashboard',
  '/puzzles/history',
];

describe('shared puzzle menu', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    setStoredLocale('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('orders training links before dashboard and history, with one gap between groups', () => {
    const menu = renderPuzzleMenu('dashboard');
    expect(menu.tagName).toBe('NAV');
    expect(menu.getAttribute('aria-label')).toBe('Puzzles');
    expect([...menu.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(HREFS);
    const gap = menu.querySelector('.puzzle-menu__gap');
    expect(menu.children).toHaveLength(6);
    expect(menu.children[3]).toBe(gap);
    expect(gap?.getAttribute('aria-hidden')).toBe('true');
    expect(gap?.previousElementSibling?.getAttribute('href')).toBe('/puzzles?mode=streak');
    expect(gap?.nextElementSibling?.getAttribute('href')).toBe('/puzzles/dashboard');
  });

  it.each(PAGES)('marks only the %s link as the current page', (page: PuzzleMenuPage) => {
    const menu = renderPuzzleMenu(page);
    const active = menu.querySelectorAll('[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('href')).toBe(HREFS[PAGES.indexOf(page)]);
  });

  it.each([
    ['en', ['Puzzles', 'Puzzle Themes', 'Puzzle Streak', 'Puzzle Dashboard', 'Puzzle history']],
    ['zh-Hans', ['题目', '题目主题', '连续解题', '解题面板', '解题记录']],
    ['zh-Hant', ['題目', '題目主題', '連續解題', '解題面板', '解題紀錄']],
  ] as const)(
    'renders localized labels in %s using the existing training keys',
    (locale, labels) => {
      setStoredLocale(locale);
      const menu = renderPuzzleMenu('themes');
      const links = [...menu.querySelectorAll('a')];
      expect(links.map((link) => link.textContent)).toEqual(labels);
      expect(menu.getAttribute('aria-label')).toBe(labels[0]);
      for (const [index, item] of puzzleNavItems().entries()) {
        expect(links[index]?.textContent).toBe(t(item.labelKey));
        expect(links[index]?.getAttribute('href')).toBe(item.href);
      }
      expect(links.map((link) => link.getAttribute('href'))).toEqual(HREFS);
    },
  );

  it('places navigation before the supplied content without rebuilding it', () => {
    const content = document.createElement('main');
    content.className = 'dashboard';
    const layout = renderPuzzleMenuLayout('history', content);
    expect(layout.className).toBe('puzzle-menu-layout');
    expect(layout.children).toHaveLength(2);
    expect(layout.firstElementChild?.tagName).toBe('NAV');
    expect(layout.lastElementChild).toBe(content);
    expect(content.classList.contains('dashboard')).toBe(true);
    expect(content.classList.contains('puzzle-menu-content')).toBe(true);
    expect(layout.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(
      '/puzzles/history',
    );
  });

  it('scrolls a phone strip so the current page is in view, and leaves a strip that fits alone', () => {
    const menu = renderPuzzleMenu('dashboard');
    const active = menu.querySelector<HTMLElement>('[aria-current="page"]')!;
    const rect = (left: number, width: number) =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 44,
        height: 44,
        x: left,
        y: 0,
      }) as DOMRect;
    Object.defineProperty(menu, 'clientWidth', { value: 374 });
    Object.defineProperty(menu, 'scrollWidth', { value: 700 });
    menu.getBoundingClientRect = () => rect(8, 374);
    // Laid out unscrolled, the Dashboard item starts past the strip's right edge.
    active.getBoundingClientRect = () => rect(430, 150);
    centreActivePuzzleMenuItem(menu);
    expect(menu.scrollLeft).toBe(310);
    const item = 430 - menu.scrollLeft;
    expect(item).toBeGreaterThanOrEqual(8);
    expect(item + 150).toBeLessThanOrEqual(8 + 374);

    const fits = renderPuzzleMenu('dashboard');
    Object.defineProperty(fits, 'clientWidth', { value: 700 });
    Object.defineProperty(fits, 'scrollWidth', { value: 700 });
    centreActivePuzzleMenuItem(fits);
    expect(fits.scrollLeft).toBe(0);
  });
});
