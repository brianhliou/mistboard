import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBlockedForViewer } from './viewer-geo.js';

// The Streamers nav link is derived from the curated directory, so these tests
// drive nav-items.ts against a mocked list rather than the shipped (empty) one.
afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./streamers-data.js');
  document.cookie = 'mb_cc=; Max-Age=0; Path=/';
});

describe('watch nav', () => {
  it('drives CN video visibility from the manual catalogue gate in both menus', async () => {
    document.cookie = 'mb_cc=CN; Path=/';
    const { watchNavItems, siteMenuSections, VIDEOS_OPEN_IN_CN } = await import('./nav-items.js');
    const visible = (items: ReturnType<typeof watchNavItems>) =>
      items.filter((item) => !isBlockedForViewer(item.blockedIn)).map((item) => item.href);
    expect(visible(watchNavItems()).includes('/videos')).toBe(VIDEOS_OPEN_IN_CN);
    const watch = siteMenuSections().find((section) => section.labelKey === 'nav.watch')!;
    expect(visible(watch.items).includes('/videos')).toBe(VIDEOS_OPEN_IN_CN);
  });

  it.each([null, 'US', 'HK', 'TW', 'SG', 'MY', 'MO'])(
    'keeps the library visible outside CN (%s)',
    async (country) => {
      if (country) document.cookie = `mb_cc=${country}; Path=/`;
      const { watchNavItems, VIDEOS_OPEN_IN_CN, YOUTUBE_BLOCKED_IN } = await import(
        './nav-items.js'
      );
      const video = watchNavItems().find((item) => item.href === '/videos')!;
      expect(video.blockedIn).toEqual(VIDEOS_OPEN_IN_CN ? undefined : YOUTUBE_BLOCKED_IN);
      expect(isBlockedForViewer(video.blockedIn)).toBe(false);
    },
  );

  it('hides Streamers while nobody is listed', async () => {
    vi.doMock('./streamers-data.js', () => ({ STREAMERS: [] }));
    const { watchNavItems } = await import('./nav-items.js');

    expect(watchNavItems().map((item) => item.label)).toEqual([
      'Broadcasts',
      'Mistboard TV',
      'Current games',
      'Video library',
    ]);
  });

  it('shows Streamers as soon as the directory has someone in it', async () => {
    vi.resetModules();
    vi.doMock('./streamers-data.js', () => ({
      STREAMERS: [
        {
          name: 'Riverbank',
          platform: 'twitch',
          url: 'https://twitch.tv/riverbank',
          blurb: 'Xiangqi for chess players.',
          language: 'English',
          addedAt: '2026-08-27',
        },
      ],
    }));
    const { watchNavItems } = await import('./nav-items.js');

    const items = watchNavItems();
    expect(items.map((item) => item.label)).toEqual([
      'Broadcasts',
      'Mistboard TV',
      'Current games',
      'Streamers',
      'Video library',
    ]);
    expect(items.find((item) => item.label === 'Streamers')?.href).toBe('/streamer');
  });
});

describe('puzzle nav', () => {
  it('offers Puzzle Storm after Puzzle Streak and before Puzzle Dashboard', async () => {
    const { puzzleNavItems } = await import('./nav-items.js');
    expect(puzzleNavItems().map(({ label, labelKey, href }) => [label, labelKey, href])).toEqual([
      ['Puzzles', 'nav.puzzles', '/puzzles'],
      ['Puzzle Themes', 'nav.puzzleThemes', '/puzzles/themes'],
      ['Puzzle Streak', 'nav.puzzleStreak', '/puzzles?mode=streak'],
      ['Puzzle Storm', 'puzzle.stormTitle', '/puzzles?mode=storm'],
      ['Puzzle Dashboard', 'puzzle.dashboardTitle', '/puzzles/dashboard'],
    ]);
  });
});

describe('tools nav', () => {
  it('lists the analysis board first and the board editor beside it', async () => {
    const { toolsNavItems } = await import('./nav-items.js');
    const items = toolsNavItems();
    expect(items.slice(0, 2).map((item) => item.label)).toEqual(['Analysis board', 'Board editor']);
    expect(items[0]?.href).toBe('/analysis/xiangqi');
    expect(items[1]?.href).toBe('/editor/xiangqi');
    expect(items[1]?.labelKey).toBe('nav.editor');
  });

  // The games database is the one nav entry that has moved menus, so assert it
  // is HERE (at /games/search) and not in Watch. A one-sided check would pass
  // with it in both. Watch carries /games, which is now the current-games page.
  it('carries the games database at /games/search, and Watch carries current games at /games', async () => {
    const { toolsNavItems, watchNavItems } = await import('./nav-items.js');
    const search = toolsNavItems().find((item) => item.href === '/games/search');
    expect(search?.label).toBe('Advanced search');
    expect(search?.labelKey).toBe('nav.gamesSearch');
    expect(toolsNavItems().some((item) => item.href === '/games')).toBe(false);
    const current = watchNavItems().find((item) => item.href === '/games');
    expect(current?.label).toBe('Current games');
    expect(current?.labelKey).toBe('nav.currentGames');
    expect(watchNavItems().some((item) => item.href === '/games/search')).toBe(false);
  });

  it('offers the import door, which is otherwise reachable only by URL', async () => {
    const { toolsNavItems } = await import('./nav-items.js');
    const imported = toolsNavItems().find((item) => item.href === '/import');
    expect(imported?.label).toBe('Import game');
    expect(imported?.labelKey).toBe('nav.import');
  });

  it('never links to the invalid Lab route, even with the old flag enabled', async () => {
    vi.stubEnv('VITE_SHOW_ENGINE_LAB_NAV', 'true');
    vi.resetModules();
    try {
      const { toolsNavItems, siteMenuSections } = await import('./nav-items.js');
      expect(toolsNavItems().map((item) => item.href)).not.toContain('/lab');
      expect(
        siteMenuSections().flatMap((section) => section.items.map((item) => item.href)),
      ).not.toContain('/lab');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('community nav', () => {
  it('lists Leaderboard, Pro players and Bots ahead of the social entries', async () => {
    const { communityNavItems } = await import('./nav-items.js');
    expect(communityNavItems().map((item) => [item.labelKey, item.href])).toEqual([
      ['nav.leaderboard', '/player'],
      ['nav.proPlayers', '/players'],
      ['nav.bots', '/bots'],
      ['nav.friends', '/following'],
      ['nav.forum', '/forum'],
    ]);
  });

  it('uses Bots for the same destination in the dropdown and community rail', async () => {
    const { communityNavItems, communityRailItems } = await import('./nav-items.js');
    const bot = communityNavItems().find((item) => item.href === '/bots');
    expect(bot).toEqual({ label: 'Bots', labelKey: 'nav.bots', href: '/bots' });
    expect(communityRailItems().find((item) => item.href === '/bots')).toEqual(bot);
  });

  // "Players" for the leaderboard beside "Pro players" read as one page twice.
  it('no longer labels the leaderboard "Players"', async () => {
    const { communityNavItems } = await import('./nav-items.js');
    expect(communityNavItems().some((item) => item.labelKey === 'nav.players')).toBe(false);
  });
});

describe('learn nav', () => {
  it('ends with Blog after the existing learning destinations', async () => {
    const { learnNavItems } = await import('./nav-items.js');
    expect(learnNavItems().map((item) => [item.label, item.labelKey, item.href])).toEqual([
      ['Rules', 'nav.rules', '/rules'],
      ['Xiangqi Basics', 'nav.learnXiangqi', '/learn/xiangqi'],
      ['Practice', 'nav.practice', '/practice'],
      ['Study', 'nav.studies', '/study'],
      ['Coaches', 'nav.coaches', '/coach'],
      ['Blog', 'nav.blog', '/blog'],
    ]);
  });
});

describe('phone nav', () => {
  it.each([false, true])(
    'orders sections with separate Puzzles and closing Mistboard (admin=%s)',
    async (admin) => {
      const { siteMenuSections, playNavItems, puzzleNavItems, communityNavItems } = await import(
        './nav-items.js'
      );
      const sections = siteMenuSections({ admin });
      expect(sections.map((section) => section.labelKey)).toEqual([
        'nav.play',
        'nav.puzzles',
        'nav.learn',
        'nav.watch',
        'nav.community',
        'nav.tools',
        ...(admin ? ['nav.admin'] : []),
        'nav.mistboard',
      ]);
      expect(sections[0]?.items).toEqual(playNavItems());
      expect(sections[1]?.items).toEqual(puzzleNavItems());
      expect(sections.find((section) => section.labelKey === 'nav.community')?.items).toEqual(
        communityNavItems(),
      );
      expect(
        sections.flatMap((section) => section.items).filter((item) => item.href === '/patron'),
      ).toHaveLength(1);
    },
  );

  it('lists the About destinations in their rail order', async () => {
    const { mistboardMenuItems } = await import('./nav-items.js');
    expect(mistboardMenuItems().map((item) => item.href)).toEqual([
      '/about',
      '/stats',
      '/feed',
      '/changelog',
      '/faq',
      '/contact',
      '/lag',
      '/verify-title',
      '/patron',
      '/terms',
      '/privacy',
      '/source',
      '/contribute',
      '/creators',
      '/champions',
      '/developers',
      '/data',
      '/api-docs',
      '/thanks',
    ]);
  });
});

describe('play menu', () => {
  it('opens the Play a game dialog on the Anyone tab, like lichess Create lobby game', async () => {
    const { playNavItems } = await import('./nav-items.js');
    expect(playNavItems()[0]).toMatchObject({ labelKey: 'nav.createGame', href: '/?play=lobby' });
  });
});
