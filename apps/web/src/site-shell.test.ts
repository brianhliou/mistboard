import { afterEach, describe, expect, it } from 'vitest';
import { buildHomeFooter, buildNav, navTabletMediaQuery, placeNavAccount } from './site-shell.js';

describe('site shell nav', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('links to Puzzles from the primary nav and marks puzzle detail routes active', () => {
    window.history.replaceState(null, '', '/puzzles/mini-xiangqi-red-back-rank-net-1');

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

    // The consolidated Admin menu stays hidden until account-nav resolves an
    // admin (no admin hint in a fresh test DOM).
    const adminMenu = nav.querySelector<HTMLElement>('.site-nav-menu[data-admin-only]');
    expect(adminMenu?.querySelector('.site-nav-menu-toggle')?.textContent).toBe('Admin');
    expect(
      [...(adminMenu?.querySelectorAll<HTMLAnchorElement>('.site-nav-menu-panel a') ?? [])].map(
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
    expect(adminMenu?.hidden).toBe(true);

    const puzzleLink = nav.querySelector<HTMLAnchorElement>('a[href="/puzzles"]');
    expect(puzzleLink?.textContent).toBe('Puzzles');
    expect(puzzleLink?.classList.contains('active')).toBe(true);
    expect(puzzleLink?.getAttribute('aria-current')).toBe('page');
    // Identify the Learn toggle by its href, not by being the first toggle in
    // the DOM: Play became a dropdown too, and a positional selector silently
    // starts asserting against a different menu.
    expect(
      nav.querySelector<HTMLAnchorElement>('.site-nav-menu-toggle[href="/rules"]')?.textContent,
    ).toBe('Learn');
    // Play is a split menu now: the title navigates to the lobby, the panel
    // carries Correspondence (signed-in only, so hidden until auth resolves).
    const playMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Play',
    );
    const correspondence = playMenu?.querySelector<HTMLAnchorElement>('a[href="/correspondence"]');
    expect(correspondence?.textContent).toBe('Correspondence');
    expect(correspondence?.hidden).toBe(true);
    expect(nav.querySelector<HTMLAnchorElement>('a[href="/forum"]')?.textContent).toBe('Forum');
    // Community dropdown: Players (the leaderboard), Friends, Forum, Blog. The
    // title also links to /player, so scope item lookups to the panel.
    const communityMenu = [...nav.querySelectorAll<HTMLElement>('.site-nav-menu')].find(
      (menu) => menu.querySelector('.site-nav-menu-toggle')?.textContent === 'Community',
    );
    const communityPanel = communityMenu?.querySelector<HTMLElement>('.site-nav-menu-panel');
    expect(communityPanel?.querySelector<HTMLAnchorElement>('a[href="/player"]')?.textContent).toBe(
      'Players',
    );
    expect(
      communityPanel?.querySelector<HTMLAnchorElement>('a[href="/following"]')?.textContent,
    ).toBe('Friends');
    expect(communityPanel?.querySelector<HTMLAnchorElement>('a[href="/blog"]')?.textContent).toBe(
      'Blog',
    );
    // The Discord invite was pulled from this dropdown on 2026-08-28. It is
    // still in the footer, so the assertion moves rather than disappearing.
    expect(communityPanel?.querySelector('a[href^="https://discord.gg/"]')).toBeNull();
    // The Community title is a link to the player page, not just a toggle.
    const communityToggle = [
      ...nav.querySelectorAll<HTMLElement>('.site-nav-menu > .site-nav-menu-toggle'),
    ].find((el) => el.textContent === 'Community');
    expect(communityToggle?.tagName).toBe('A');
    expect((communityToggle as HTMLAnchorElement).getAttribute('href')).toBe('/player');
    // /bots moved out of the top-nav dropdown into the community rail.
    expect(nav.querySelector<HTMLAnchorElement>('a[href="/bots"]')).toBeNull();

    // Watch is a split menu: the title links to Mistboard TV (/watch) and the
    // panel lists Mistboard TV explicitly alongside Broadcasts.
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
    ).toEqual(['Mistboard TV', 'Current games', 'Broadcasts', 'Video library']);
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
    // The announcement archive joined the footer 2026-08-27, when it stopped
    // being a noindexed dead end. It is not a content path, so it keeps its
    // bare href under a zh locale.
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/feed"]')?.textContent).toBe('更新');
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/contact"]')?.textContent).toBe('聯絡');
    // The Discord invite left the footer on 2026-08-31 (see nav-items.ts): the
    // room is not ready to be promoted.
    expect(footer.querySelector('a[href^="https://discord.gg/"]')).toBeNull();
    expect(footer.querySelector<HTMLAnchorElement>('a[href="/privacy"]')?.textContent).toBe('隱私');
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
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    document.body.innerHTML = '';
    window.matchMedia = originalMatchMedia;
  });

  function stubViewport(tablet: boolean): void {
    window.matchMedia = ((query: string) =>
      ({
        matches: query === navTabletMediaQuery && tablet,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }

  it('keeps the account slot inside the utilities on desktop and phones', () => {
    stubViewport(false);
    const nav = buildNav();
    const account = nav.querySelector<HTMLElement>('.site-nav-account');
    expect(account?.parentElement?.classList.contains('site-nav-utilities')).toBe(true);
    expect(account?.querySelector('[data-account-slot]')).not.toBeNull();
  });

  it('moves the account slot onto the bar beside the hamburger on tablets, and back', () => {
    stubViewport(true);
    const nav = buildNav();
    const account = nav.querySelector<HTMLElement>('.site-nav-account');
    expect(account?.parentElement).toBe(nav);
    expect(account?.nextElementSibling?.classList.contains('site-nav-toggle')).toBe(true);
    // The drawer no longer holds it, so the sign-in link is reachable without
    // opening the menu.
    expect(nav.querySelector('.site-nav-collapse .site-nav-auth')).toBeNull();

    stubViewport(false);
    placeNavAccount(nav);
    expect(account?.parentElement?.classList.contains('site-nav-utilities')).toBe(true);
    expect(nav.querySelector('.site-nav-utilities')?.firstElementChild).toBe(account);
  });
});
