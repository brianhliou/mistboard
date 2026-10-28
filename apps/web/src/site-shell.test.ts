import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setResolvedAdmin } from './signed-in-state.js';
import {
  buildHomeFooter,
  buildNav,
  closeQuickPicker,
  closeSiteMenu,
  fitNavBrand,
  isQuickPickerOpen,
  isSiteMenuOpen,
  navPhoneMediaQuery,
  navTabletMediaQuery,
  openSiteMenu,
  placeNavAccount,
  syncAdminNavMenus,
} from './site-shell.js';
import {
  readStoredXiangqiPieceSet,
  setSiteThemePreference,
  setXiangqiPieceSetPreference,
} from './theme.js';
import { xiangqiPieceTilePreview } from './xiangqi-piece-sets.js';

type Viewport = 'desktop' | 'tablet' | 'phone';
const originalMatchMedia = window.matchMedia;
function stubViewport(viewport: Viewport): void {
  window.matchMedia = ((query: string) =>
    ({
      matches:
        (query === navTabletMediaQuery && viewport === 'tablet') ||
        (query === navPhoneMediaQuery && viewport === 'phone'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

describe('site shell nav', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('marks Puzzle Streak, not the trainer, as the current page in streak mode', () => {
    window.history.replaceState(null, '', '/puzzles?mode=streak');
    const nav = buildNav();
    document.body.append(nav);
    const current = [...nav.querySelectorAll<HTMLAnchorElement>('[aria-current="page"]')];
    expect(current.map((a) => a.getAttribute('href'))).toEqual(['/puzzles?mode=streak']);
    expect(
      nav.querySelector('.site-nav-menu-toggle[href="/puzzles"]')?.classList.contains('active'),
    ).toBe(true);
  });

  it('marks Puzzle Themes, not the trainer, as the current page on the themes index', () => {
    window.history.replaceState(null, '', '/puzzles/themes');
    const nav = buildNav();
    document.body.append(nav);
    const current = [...nav.querySelectorAll<HTMLAnchorElement>('[aria-current="page"]')];
    expect(current.map((a) => a.getAttribute('href'))).toEqual(['/puzzles/themes']);
    expect(
      nav.querySelector('.site-nav-menu-toggle[href="/puzzles"]')?.classList.contains('active'),
    ).toBe(true);
  });

  it('links to Puzzles from the primary nav and marks puzzle detail routes active', () => {
    window.history.replaceState(null, '', '/puzzles/xq-mined-hxq_4a41e15e9d8a17414cf249ee-41');

    const nav = buildNav();
    document.body.append(nav);

    const primaryLabels = [
      ...nav.querySelectorAll<HTMLElement>(
        '.site-nav-links > .site-nav-link:not([data-admin-only]), .site-nav-links > .site-nav-menu:not([data-admin-only]) > .site-nav-menu-toggle',
      ),
    ].map((link) => link.textContent);
    expect(primaryLabels).toEqual([
      'Play',
      'Puzzles',
      'Learn',
      'Watch',
      'Community',
      'Tools',
      'Support',
    ]);
    const donate = nav.querySelector<HTMLAnchorElement>('.site-nav-link-donate');
    expect(donate?.getAttribute('href')).toBe('/patron');
    expect(donate?.querySelector('.site-nav-donate-icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );

    // No admin hint in a fresh test DOM, so the admin menu is not in the DOM at
    // all: a hidden menu still put its labels in the prerendered HTML.
    expect(nav.querySelector('[data-admin-only]')).toBeNull();

    // Puzzles is a split menu (lichess parity): the title goes to the trainer,
    // the panel repeats it and adds Puzzle Streak.
    const puzzleToggle = nav.querySelector<HTMLAnchorElement>(
      '.site-nav-menu-toggle[href="/puzzles"]',
    );
    expect(puzzleToggle?.textContent).toBe('Puzzles');
    expect(puzzleToggle?.classList.contains('active')).toBe(true);
    const puzzlePanel = puzzleToggle?.parentElement?.querySelector('.site-nav-menu-panel');
    expect(
      [...(puzzlePanel?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].map((a) => [
        a.getAttribute('href'),
        a.textContent,
      ]),
    ).toEqual([
      ['/puzzles', 'Puzzles'],
      ['/puzzles/themes', 'Puzzle Themes'],
      ['/puzzles?mode=streak', 'Puzzle Streak'],
    ]);
    const puzzleLink = puzzlePanel?.querySelector<HTMLAnchorElement>('a[href="/puzzles"]');
    expect(puzzleLink?.classList.contains('active')).toBe(true);
    expect(puzzleLink?.getAttribute('aria-current')).toBe('page');
    // Identify the Learn toggle by its href, not by being the first toggle in
    // the DOM: Play became a dropdown too, and a positional selector silently
    // starts asserting against a different menu.
    expect(
      nav.querySelector<HTMLAnchorElement>('.site-nav-menu-toggle[href="/rules"]')?.textContent,
    ).toBe('Learn');
    // Play is a split menu now: the title navigates to the lobby, the panel
    // carries Correspondence, shown to everyone (signed out lands on its explainer).
    const playMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Play',
    );
    const correspondence = playMenu?.querySelector<HTMLAnchorElement>('a[href="/correspondence"]');
    expect(correspondence?.textContent).toBe('Correspondence');
    expect(correspondence?.hidden).toBe(false);
    expect(nav.querySelector<HTMLAnchorElement>('a[href="/forum"]')?.textContent).toBe('Forum');
    // Community dropdown: Leaderboard, Pro players, Bots, Friends, Forum, Blog.
    // The title also links to /player, so scope item lookups to the panel.
    const communityMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Community',
    );
    const communityPanel = communityMenu?.querySelector<HTMLElement>('.site-nav-menu-panel');
    // Friends is signed-in only, so it renders hidden here but stays in the DOM.
    expect(
      [...(communityPanel?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].map((link) => [
        link.getAttribute('href'),
        link.textContent,
      ]),
    ).toEqual([
      ['/player', 'Leaderboard'],
      ['/players', 'Pro players'],
      ['/bots', 'Bots'],
      ['/following', 'Friends'],
      ['/forum', 'Forum'],
      ['/blog', 'Blog'],
    ]);
    // The Discord invite was pulled from this dropdown on 2026-08-28. It is
    // still in the footer, so the assertion moves rather than disappearing.
    expect(communityPanel?.querySelector('a[href^="https://discord.gg/"]')).toBeNull();
    // The Community title is a link to the leaderboard, not just a toggle.
    const communityToggle = [
      ...nav.querySelectorAll<HTMLElement>('.site-nav-menu > .site-nav-menu-toggle'),
    ].find((el) => el.textContent === 'Community');
    expect(communityToggle?.tagName).toBe('A');
    expect((communityToggle as HTMLAnchorElement).getAttribute('href')).toBe('/player');
    // Rating stats stays in the community rail only.
    expect(nav.querySelector('a[href="/player/rating-stats"]')).toBeNull();

    // Watch is a split menu: the title links to Mistboard TV (/watch) and the
    // panel lists Broadcasts first, then Mistboard TV explicitly.
    const watchMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Watch',
    );
    const watchToggle = watchMenu?.querySelector<HTMLAnchorElement>('.site-nav-menu-toggle');
    expect(watchToggle?.tagName).toBe('A');
    expect(watchToggle?.getAttribute('href')).toBe('/watch');
    const watchPanel = watchMenu?.querySelector<HTMLElement>('.site-nav-menu-panel');
    expect(watchPanel?.querySelector<HTMLAnchorElement>('a[href="/watch"]')?.textContent).toBe(
      'Mistboard TV',
    );
    expect(
      watchPanel?.querySelector<HTMLAnchorElement>('a[href="/broadcast/xiangqi"]')?.textContent,
    ).toBe('Broadcasts');
    expect(
      [...(watchPanel?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].map(
        (link) => link.textContent,
      ),
    ).toEqual(['Broadcasts', 'Mistboard TV', 'Current games', 'Video library']);
    expect(watchPanel?.querySelector<HTMLAnchorElement>('a[href="/games"]')?.textContent).toBe(
      'Current games',
    );

    // Tools dropdown surfaces the analysis board, and the games database, which
    // moved here out of Watch (and to /games/search once /games became the
    // current-games page). It is reachable only by typing its URL if this entry
    // goes missing, so assert the rendered link, not just the item list.
    const toolsMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Tools',
    );
    const toolsPanel = toolsMenu?.querySelector<HTMLElement>('.site-nav-menu-panel');
    expect(
      toolsPanel?.querySelector<HTMLAnchorElement>('a[href="/analysis/xiangqi"]')?.textContent,
    ).toBe('Analysis board');
    expect(
      toolsPanel?.querySelector<HTMLAnchorElement>('a[href="/games/search"]')?.textContent,
    ).toBe('Advanced search');
    expect(toolsPanel?.querySelector<HTMLAnchorElement>('a[href="/games"]')).toBeNull();

    const learnMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Learn',
    );
    expect(
      [...(learnMenu?.querySelectorAll<HTMLAnchorElement>('.site-nav-menu-panel a') ?? [])].map(
        (link) => link.textContent,
      ),
    ).toEqual(['Rules', 'Xiangqi Basics', 'Practice', 'Study', 'Coaches']);
    expect(
      learnMenu?.querySelector<HTMLAnchorElement>('.site-nav-menu-toggle')?.getAttribute('href'),
    ).toBe('/rules');
  });

  // Each Community entry lights up on its own page and on the pages beneath it,
  // and lights the Community title with it. /player and /players share a
  // prefix, so each must light only its own entry.
  it.each([
    ['/player', '/player'],
    ['/leaderboard', '/player'],
    ['/player/rating-stats', '/player'],
    ['/players', '/players'],
    ['/players/teams', '/players'],
    ['/players/wang-tianyi', '/players'],
    ['/bots', '/bots'],
    ['/bot/misty', '/bots'],
  ])('marks the Community entry active on %s', (path, activeHref) => {
    window.history.replaceState(null, '', path);
    const nav = buildNav();
    document.body.append(nav);
    const communityMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Community',
    );
    const active = [
      ...(communityMenu?.querySelectorAll<HTMLAnchorElement>('.site-nav-menu-panel a.active') ??
        []),
    ].map((link) => link.getAttribute('href'));
    expect(active).toEqual([activeHref]);
    expect(
      communityMenu?.querySelector('.site-nav-menu-panel a.active')?.getAttribute('aria-current'),
    ).toBe('page');
    expect(
      communityMenu?.querySelector('.site-nav-menu-toggle')?.classList.contains('active'),
    ).toBe(true);
  });

  it('labels the new Community entries in both Chinese scripts', () => {
    for (const [locale, labels] of [
      ['zh-Hans', ['排行榜', '职业棋手', '机器人']],
      ['zh-Hant', ['排行榜', '職業棋手', '機器人']],
    ] as const) {
      const nav = buildNav(locale);
      const panel = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')]
        .find((menu) => menu.querySelector('.site-nav-menu-toggle[href$="/player"]'))
        ?.querySelector('.site-nav-menu-panel');
      expect(
        [...(panel?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]
          .slice(0, 3)
          .map((link) => link.textContent),
        locale,
      ).toEqual(labels);
    }
  });

  it('renders the admin menu only for a likely admin, and syncs it in and out', () => {
    setResolvedAdmin(true);
    try {
      const nav = buildNav();
      document.body.append(nav);
      const adminMenu = () => nav.querySelector<HTMLElement>('.site-nav-menu[data-admin-only]');
      expect(adminMenu()?.querySelector('.site-nav-menu-toggle')?.textContent).toBe('Admin');
      expect(
        [...(adminMenu()?.querySelectorAll<HTMLAnchorElement>('.site-nav-menu-panel a') ?? [])].map(
          (link) => link.textContent,
        ),
      ).toEqual([
        'Database',
        'Engines',
        'Accounts',
        'Titles',
        'Readouts',
        'Metrics',
        'Broadcast ops',
      ]);
      // Last on the bar, right after Donate.
      expect(adminMenu()?.previousElementSibling?.classList.contains('site-nav-link-donate')).toBe(
        true,
      );

      syncAdminNavMenus(false);
      expect(adminMenu()).toBeNull();
      syncAdminNavMenus(true);
      syncAdminNavMenus(true);
      expect(nav.querySelectorAll('[data-admin-only]')).toHaveLength(1);
      expect(adminMenu()?.previousElementSibling?.classList.contains('site-nav-link-donate')).toBe(
        true,
      );
    } finally {
      setResolvedAdmin(undefined);
    }
  });

  it('keeps admin labels out of a signed-out zh nav entirely', () => {
    window.history.replaceState(null, '', '/zh-hans');
    const nav = buildNav('zh-Hans');
    document.body.append(nav);
    const html = nav.outerHTML;
    for (const label of ['管理', '数据库', '运营简报', '转播运维', '/database', '/readouts']) {
      expect(html, label).not.toContain(label);
    }
  });

  it('localizes launch nav labels and translated content links', () => {
    window.history.replaceState(null, '', '/zh-hant/rules/banqi');

    const nav = buildNav('zh-Hant');
    document.body.append(nav);

    const primaryLabels = [
      ...nav.querySelectorAll<HTMLElement>(
        '.site-nav-links > .site-nav-link:not([data-admin-only]), .site-nav-links > .site-nav-menu:not([data-admin-only]) > .site-nav-menu-toggle',
      ),
    ].map((link) => link.textContent);

    expect(primaryLabels).toEqual(['對弈', '題目', '學習', '觀看', '社群', '工具', '支持']);
    expect(nav.getAttribute('aria-label')).toBe('主導覽');
    expect(nav.querySelector('.site-nav-language')).toBeNull();
    // The Learn dropdown's Rules item is the localized content link (規則).
    expect(
      nav.querySelector<HTMLAnchorElement>('.site-nav-menu-panel a[href="/zh-hant/rules"]')
        ?.textContent,
    ).toBe('規則');
    expect(
      nav
        .querySelector<HTMLAnchorElement>('.site-nav-menu-panel a[href="/zh-hant/rules"]')
        ?.classList.contains('active'),
    ).toBe(true);
    // The Learn title links to Rules, which also leads the dropdown. The toggle
    // stays active on a /rules route via that child.
    const learnToggle = nav.querySelector<HTMLAnchorElement>(
      '.site-nav-menu-toggle[href="/zh-hant/rules"]',
    );
    expect(learnToggle?.textContent).toBe('學習');
    expect(learnToggle?.classList.contains('active')).toBe(true);
    // Articles now surface as "Blog" (網誌) in the Community dropdown.
    expect(nav.querySelector<HTMLAnchorElement>('a[href="/zh-hant/blog"]')?.textContent).toBe(
      '網誌',
    );
    expect(nav.querySelector<HTMLAnchorElement>('a[href="/account?tab=login"]')?.textContent).toBe(
      '登入',
    );
    expect(
      nav.querySelector<HTMLAnchorElement>('a[href="/account?tab=register"]')?.textContent,
    ).toBe('註冊');
  });

  it('localizes homepage footer labels and content links', () => {
    const footer = buildHomeFooter('zh-Hant');

    expect(footer.querySelector<HTMLAnchorElement>('a[href="/zh-hant/rules"]')).toBeNull();
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/zh-hant/blog"]')).toBeNull();
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/about"]')?.textContent).toBe('關於');
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/contact"]')?.textContent).toBe('聯絡');
    // The Discord invite left the footer on 2026-08-31 (see nav-items.ts): the
    // room is not ready to be promoted.
    expect(footer.querySelector('a[href^="https://discord.gg/"]')).toBeNull();
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/privacy"]')?.textContent).toBe('隱私');
  });
});

// The stylesheet is not applied under jsdom, so phone rules are asserted as CSS text.
const siteShellCss = readFileSync(
  ['src/site-shell.css', 'apps/web/src/site-shell.css']
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(candidate)) as string,
  'utf8',
);

describe('site shell footer', () => {
  // The footer is the way into the /about rail: four links and the identity
  // line, the same on every width, so no phone-only hide rule.
  it('carries About, Contact, Terms, Privacy and the identity line on every width', () => {
    const footer = buildHomeFooter();
    expect([...footer.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/about',
      '/contact',
      '/terms',
      '/privacy',
    ]);
    expect(footer.querySelector('.landing-footer-identity')?.textContent).toBe(
      '© 2026 Mistboard · AGPL-3.0',
    );
    expect(siteShellCss).not.toContain('[data-phone-menu]');
  });
});

describe('site shell geo-blocked links', () => {
  afterEach(() => {
    document.cookie = 'mb_cc=; Max-Age=0; Path=/';
    document.body.innerHTML = '';
  });

  // Nothing on the site carries the Discord invite any more, so there is no
  // country-gated link left to observe anywhere. The gate primitive stays
  // covered by viewer-geo.test.ts, ready for the next off-site link.
  it('offers no off-site invite from the shell, in China or anywhere else', () => {
    for (const country of ['CN', 'US']) {
      document.cookie = `mb_cc=${country}; Path=/`;
      expect(buildNav().querySelector('a[href="/forum"]')).not.toBeNull();
      expect(buildNav().querySelector('a[href^="https://discord.gg/"]')).toBeNull();
      expect(buildHomeFooter().querySelector('a[href^="https://discord.gg/"]')).toBeNull();
    }
  });
});

describe('site shell nav account placement', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  it('keeps the account slot inside the utilities on desktop', () => {
    stubViewport('desktop');
    const nav = buildNav();
    const account = nav.querySelector<HTMLElement>('.site-nav-account');
    expect(account?.parentElement?.classList.contains('site-nav-utilities')).toBe(true);
    expect(account?.querySelector('[data-account-slot]')).not.toBeNull();
  });

  it('moves the account slot onto the bar beside the hamburger on tablets, and back', () => {
    stubViewport('tablet');
    const nav = buildNav();
    const account = nav.querySelector<HTMLElement>('.site-nav-account');
    expect(account?.parentElement).toBe(nav);
    expect(account?.nextElementSibling?.classList.contains('site-nav-toggle')).toBe(true);
    // The drawer no longer holds it, so the sign-in link is reachable without
    // opening the menu.
    expect(nav.querySelector('.site-nav-collapse .site-nav-auth')).toBeNull();

    stubViewport('desktop');
    placeNavAccount(nav);
    expect(account?.parentElement?.classList.contains('site-nav-utilities')).toBe(true);
    expect(nav.querySelector('.site-nav-utilities')?.firstElementChild).toBe(account);
  });

  it('puts the account slot last on the phone bar, out of the folded links, and back', () => {
    stubViewport('phone');
    const nav = buildNav();
    const account = nav.querySelector<HTMLElement>('.site-nav-account');
    expect(account?.parentElement).toBe(nav);
    expect(nav.lastElementChild).toBe(account);
    expect(nav.querySelector('.site-nav-collapse .site-nav-auth')).toBeNull();
    expect(account?.querySelector('.site-nav-link-signin')).not.toBeNull();

    stubViewport('desktop');
    placeNavAccount(nav);
    expect(account?.parentElement?.classList.contains('site-nav-utilities')).toBe(true);
  });
});

describe('site shell phone menu', () => {
  afterEach(() => {
    closeQuickPicker({ restoreFocus: false });
    closeSiteMenu({ restoreFocus: false });
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
    window.history.replaceState(null, '', '/');
    try {
      window.localStorage.clear();
    } catch {}
  });

  function phoneNav(): { nav: HTMLElement; toggle: HTMLButtonElement } {
    stubViewport('phone');
    const nav = buildNav();
    document.body.append(nav);
    const toggle = nav.querySelector<HTMLButtonElement>('.site-nav-toggle');
    if (!toggle) throw new Error('missing toggle');
    return { nav, toggle };
  }

  const menuPanel = () => document.querySelector<HTMLElement>('.site-menu');

  it('opens and closes from the menu button, with aria-expanded, focus and scroll lock', () => {
    const { nav, toggle } = phoneNav();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(menuPanel()).toBeNull();

    toggle.click();
    const panel = menuPanel();
    expect(panel).not.toBeNull();
    expect(isSiteMenuOpen()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(panel?.id);
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    // Outside the bar, so the bar's auto-hide transform never moves it.
    expect(panel?.parentElement).toBe(document.body);
    expect(nav.contains(panel)).toBe(false);
    // Phones never use the drawer.
    expect(nav.classList.contains('nav-open')).toBe(false);
    expect(document.activeElement).toBe(panel?.querySelector('.site-menu-close'));
    expect(document.documentElement.classList.contains('site-menu-open')).toBe(true);

    panel?.querySelector<HTMLButtonElement>('.site-menu-close')?.click();
    expect(menuPanel()).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.classList.contains('site-menu-open')).toBe(false);

    // The button itself toggles too.
    toggle.click();
    expect(menuPanel()).not.toBeNull();
    toggle.click();
    expect(menuPanel()).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and returns focus to the menu button', () => {
    const { toggle } = phoneNav();
    toggle.click();
    expect(menuPanel()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menuPanel()).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(document.documentElement.classList.contains('site-menu-open')).toBe(false);
  });

  it('keeps the tablet drawer on tablets', () => {
    stubViewport('tablet');
    const nav = buildNav();
    document.body.append(nav);
    nav.querySelector<HTMLButtonElement>('.site-nav-toggle')?.click();
    expect(nav.classList.contains('nav-open')).toBe(true);
    expect(menuPanel()).toBeNull();
  });

  // The source of truth is the desktop bar itself: every href it renders (menu
  // titles, panel items, Puzzles, Support, and the admin menu for an admin)
  // must be reachable from the phone menu.
  it('carries every destination on the desktop bar, admin included', () => {
    setResolvedAdmin(true);
    try {
      stubViewport('desktop');
      const desktop = buildNav();
      const barHrefs = new Set(
        [...desktop.querySelectorAll<HTMLAnchorElement>('.site-nav-links a[href]')].map((a) =>
          a.getAttribute('href'),
        ),
      );
      expect(barHrefs.size).toBeGreaterThan(20);
      expect(barHrefs.has('/database')).toBe(true);

      const { toggle } = phoneNav();
      toggle.click();
      const menuHrefs = new Set(
        [...(menuPanel()?.querySelectorAll<HTMLAnchorElement>('.site-menu-link') ?? [])].map((a) =>
          a.getAttribute('href'),
        ),
      );
      const missing = [...barHrefs].filter((href) => !menuHrefs.has(href));
      expect(missing).toEqual([]);
    } finally {
      setResolvedAdmin(undefined);
    }
  });

  it('groups destinations into Play, Watch, Tools, Learn, Community and Mistboard, no admin for others', () => {
    const { toggle } = phoneNav();
    toggle.click();
    const headings = [
      ...(menuPanel()?.querySelectorAll<HTMLElement>('.site-menu-heading') ?? []),
    ].map((h) => h.textContent);
    expect(headings).toEqual(['Play', 'Watch', 'Tools', 'Learn', 'Community', 'Mistboard']);
    const play = menuPanel()?.querySelector('.site-menu-section');
    expect(
      [...(play?.querySelectorAll<HTMLAnchorElement>('.site-menu-link') ?? [])].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual(['/', '/correspondence', '/puzzles', '/puzzles/themes', '/puzzles?mode=streak']);
    expect(menuPanel()?.querySelector('a[href="/patron"]')).not.toBeNull();
    expect(menuPanel()?.querySelector('a[href="/database"]')).toBeNull();
  });

  // The info pages a phone reaches from any page close the menu. Patron is
  // not among them: Community's Support row already reaches it. Admin slots in
  // before it, so Mistboard stays last for admins too.
  it('ends with a Mistboard section of the info pages', () => {
    for (const admin of [false, true]) {
      setResolvedAdmin(admin);
      try {
        const { toggle } = phoneNav();
        openSiteMenu(toggle, 'zh-Hant');
        const last = [...(menuPanel()?.querySelectorAll('.site-menu-section') ?? [])].at(-1);
        expect(last?.querySelector('.site-menu-heading')?.textContent).toBe('Mistboard');
        expect(
          [...(last?.querySelectorAll<HTMLAnchorElement>('.site-menu-link') ?? [])].map((a) =>
            a.getAttribute('href'),
          ),
        ).toEqual(['/stats', '/feed', '/faq', '/contact', '/source', '/developers', '/data']);
        expect(menuPanel()?.querySelectorAll('a[href="/patron"]')).toHaveLength(1);
        if (admin) expect(menuPanel()?.querySelector('a[href="/database"]')).not.toBeNull();
        closeSiteMenu({ restoreFocus: false });
        document.body.innerHTML = '';
      } finally {
        setResolvedAdmin(undefined);
      }
    }
  });

  it('marks the current page bold with a dot', () => {
    window.history.replaceState(null, '', '/puzzles/some-puzzle');
    const { toggle } = phoneNav();
    toggle.click();
    const current = menuPanel()?.querySelectorAll<HTMLAnchorElement>('[aria-current="page"]');
    expect([...(current ?? [])].map((a) => a.getAttribute('href'))).toEqual(['/puzzles']);
    expect(current?.[0]?.classList.contains('active')).toBe(true);
    expect(current?.[0]?.querySelector('.site-menu-dot')).not.toBeNull();
  });

  it('ends with the link sections: no settings chip row at the bottom of the menu', () => {
    const { toggle } = phoneNav();
    toggle.click();
    expect(menuPanel()?.querySelector('.site-menu-footer')).toBeNull();
    expect(menuPanel()?.querySelector('[data-site-menu-chip]')).toBeNull();
    expect(menuPanel()?.lastElementChild?.classList.contains('site-menu-body')).toBe(true);
  });

  it('puts language, pieces and dark mode between the brand and the menu button', () => {
    const { nav } = phoneNav();
    const quick = nav.querySelector<HTMLElement>(':scope > .site-nav-quick');
    expect(quick?.previousElementSibling?.classList.contains('site-nav-brand')).toBe(true);
    const buttons = [...(quick?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    expect(buttons.map((b) => b.dataset.siteNavQuick)).toEqual(['language', 'pieces', 'dark']);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Language: English',
      'Pieces',
      'Dark mode',
    ]);
    // The account slot still ends the phone bar.
    expect(nav.lastElementChild?.classList.contains('site-nav-account')).toBe(true);
  });

  it('localizes the quick control labels from the existing strings', () => {
    stubViewport('phone');
    const nav = buildNav('zh-Hant');
    document.body.append(nav);
    const labels = [...nav.querySelectorAll<HTMLButtonElement>('.site-nav-quick button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels[0]?.startsWith('語言: ')).toBe(true);
    expect(labels.slice(1)).toEqual(['棋子', '深色模式']);
    expect(labels.join(' ')).not.toContain('\u2014');
  });

  it('opens the language list straight away in a dropdown under the bar; Escape closes it', async () => {
    const { nav } = phoneNav();
    const language = nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="language"]');
    language?.click();
    const panel = nav.querySelector<HTMLElement>('.site-nav-quick-panel');
    expect(panel?.dataset.siteNavQuickPanel).toBe('language');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(language?.getAttribute('aria-expanded')).toBe('true');
    expect(language?.getAttribute('aria-controls')).toBe(panel?.id);
    // No settings list and no site menu: the options themselves.
    expect(isSiteMenuOpen()).toBe(false);
    await vi.waitFor(() =>
      expect(panel?.querySelectorAll('.appearance-language-option').length).toBeGreaterThan(1),
    );
    expect(panel?.querySelector('.appearance-menu-root')).toBeNull();
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isQuickPickerOpen()).toBe(false);
    expect(nav.querySelector('.site-nav-quick-panel')).toBeNull();
    expect(language?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(language);
  });

  it('closes the dropdown on an outside tap and on a second tap of its button', async () => {
    const { nav } = phoneNav();
    const language = nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="language"]');
    language?.click();
    expect(isQuickPickerOpen()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isQuickPickerOpen()).toBe(false);
    language?.click();
    expect(isQuickPickerOpen()).toBe(true);
    language?.click();
    expect(isQuickPickerOpen()).toBe(false);
    // One dropdown at a time: opening Pieces replaces Language.
    language?.click();
    nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="pieces"]')?.click();
    expect(nav.querySelectorAll('.site-nav-quick-panel').length).toBe(1);
    expect(nav.querySelector<HTMLElement>('.site-nav-quick-panel')?.dataset.siteNavQuickPanel).toBe(
      'pieces',
    );
    expect(language?.getAttribute('aria-expanded')).toBe('false');
    closeQuickPicker({ restoreFocus: false });
  });

  it('shows the piece-set tiles from the pieces button; a pick applies, closes and redraws the icon', async () => {
    stubMemoryStorage();
    setXiangqiPieceSetPreference('international');
    const { nav } = phoneNav();
    const pieces = nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="pieces"]');
    pieces?.click();
    const panel = nav.querySelector<HTMLElement>('.site-nav-quick-panel');
    await vi.waitFor(() =>
      expect(panel?.querySelectorAll('[data-theme-tile="xqpiece"]').length).toBeGreaterThan(1),
    );
    expect(isSiteMenuOpen()).toBe(false);
    expect(panel?.querySelector('.appearance-menu-root')).toBeNull();
    expect(
      panel
        ?.querySelector('[data-theme-tile="xqpiece"][aria-checked="true"]')
        ?.getAttribute('data-id'),
    ).toBe('international');
    panel
      ?.querySelector<HTMLButtonElement>('[data-theme-tile="xqpiece"][data-id="traditional"]')
      ?.click();
    expect(readStoredXiangqiPieceSet()).toBe('traditional');
    expect(isQuickPickerOpen()).toBe(false);
    expect(nav.querySelector<HTMLElement>('.site-nav-quick-piece')?.dataset.pieceSet).toBe(
      'traditional',
    );
    expect(document.activeElement).toBe(pieces);
  });

  it('reaches the rest of the settings from the pieces dropdown', async () => {
    const { nav } = phoneNav();
    nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="pieces"]')?.click();
    const panel = nav.querySelector<HTMLElement>('.site-nav-quick-panel');
    await vi.waitFor(() => expect(panel?.querySelector('.site-nav-quick-more')).not.toBeNull());
    expect(panel?.querySelector('.site-nav-quick-more')?.textContent).toBe('Settings');
    panel?.querySelector<HTMLButtonElement>('.site-nav-quick-more')?.click();
    expect(isQuickPickerOpen()).toBe(false);
    expect(isSiteMenuOpen()).toBe(true);
    expect(menuPanel()?.querySelector<HTMLElement>('.site-menu-sections')?.hidden).toBe(true);
    expect(menuPanel()?.querySelector<HTMLElement>('.site-menu-settings')?.hidden).toBe(false);
  });

  it("draws the reader's red general on the pieces button and follows a set change", () => {
    // Serialized through the DOM so both sides close their tags the same way.
    const tileMark = (set: 'international' | 'traditional') => {
      const holder = document.createElement('span');
      holder.innerHTML = xiangqiPieceTilePreview(set).markup;
      return holder.innerHTML;
    };
    stubMemoryStorage();
    setXiangqiPieceSetPreference('international');
    const { nav } = phoneNav();
    const slot = nav.querySelector<HTMLElement>('.site-nav-quick-piece');
    expect(slot?.dataset.pieceSet).toBe('international');
    expect(slot?.innerHTML).toBe(tileMark('international'));
    setXiangqiPieceSetPreference('traditional');
    expect(slot?.dataset.pieceSet).toBe('traditional');
    expect(slot?.innerHTML).toBe(tileMark('traditional'));
  });

  it('toggles dark mode from the moon and shows the state', () => {
    setSiteThemePreference('light');
    const { nav } = phoneNav();
    const dark = nav.querySelector<HTMLButtonElement>('[data-site-nav-quick="dark"]');
    expect(dark?.getAttribute('aria-pressed')).toBe('false');
    dark?.click();
    expect(document.documentElement.dataset.effectiveTheme).toBe('dark');
    expect(dark?.getAttribute('aria-pressed')).toBe('true');
    // A theme set elsewhere (the settings view) re-syncs the bar's moon.
    setSiteThemePreference('light');
    expect(dark?.getAttribute('aria-pressed')).toBe('false');
    expect(isSiteMenuOpen()).toBe(false);
  });
});

describe('site shell nav wordmark fit', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // jsdom has no layout, so pin the widths fitNavBrand reads: a 223px brand
  // with its wordmark, 524px of links, 255px of utilities, no padding or gap.
  function sizedNav(navWidth: number, linksShown = true): HTMLElement {
    const nav = buildNav();
    document.body.append(nav);
    const pin = (el: Element | null, prop: string, value: unknown) =>
      Object.defineProperty(el, prop, { configurable: true, get: () => value });
    pin(nav, 'clientWidth', navWidth);
    pin(nav.querySelector('.site-nav-brand'), 'offsetWidth', 223);
    const links = nav.querySelector('.site-nav-links');
    pin(links, 'scrollWidth', 524);
    pin(links, 'offsetParent', linksShown ? nav : null);
    pin(nav.querySelector('.site-nav-utilities'), 'scrollWidth', 255);
    return nav;
  }

  it('keeps the wordmark while the whole bar fits', () => {
    const nav = sizedNav(1002);
    fitNavBrand(nav);
    expect(nav.dataset.brand).toBeUndefined();
  });

  it('drops to the logo alone when the wordmark would not fit, and back', () => {
    const nav = sizedNav(1001);
    fitNavBrand(nav);
    expect(nav.dataset.brand).toBe('mark');
    Object.defineProperty(nav, 'clientWidth', { configurable: true, get: () => 1100 });
    fitNavBrand(nav);
    expect(nav.dataset.brand).toBeUndefined();
  });

  it('leaves the drawer bar alone (links folded away)', () => {
    const nav = sizedNav(400, false);
    fitNavBrand(nav);
    expect(nav.dataset.brand).toBeUndefined();
  });
});

// The test DOM has no working localStorage; the stored piece set needs one.
function stubMemoryStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
}
