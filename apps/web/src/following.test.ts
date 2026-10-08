import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FollowingEntry = {
  handle: string;
  displayName: string;
  title?: string | null;
  createdAt: string;
  bestRating: { variant: string; eloRating: number; provisional: boolean } | null;
  gamesTotal: number;
  lastSeenAt: string | null;
};

const SIGNED_IN = {
  user: { id: 'u1', handle: 'me', displayName: 'Me', accountRole: 'player' },
};

const entry = (over: Partial<FollowingEntry> = {}): FollowingEntry => ({
  handle: 'conan',
  displayName: 'Conan_The_Barbarian8',
  createdAt: '2026-07-01T00:00:00Z',
  bestRating: { variant: 'fog', eloRating: 2903, provisional: false },
  gamesTotal: 42,
  lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  ...over,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type FollowerEntry = {
  handle: string | null;
  displayName: string;
  title?: string | null;
  createdAt: string;
};

function stubFetch(opts: {
  signedIn?: boolean;
  entries?: FollowingEntry[];
  total?: number;
  followers?: FollowerEntry[];
  followersTotal?: number;
  onFollowersFetch?: (url: string) => void;
  onDelete?: (url: string) => void;
}): void {
  const signedIn = opts.signedIn ?? true;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(json(signedIn ? SIGNED_IN : { user: null }));
    }
    if (init?.method === 'DELETE' && url.includes('/follow')) {
      opts.onDelete?.(url);
      return Promise.resolve(json({ relation: { following: false, blocked: false } }));
    }
    if (url.includes('/api/relations/followers')) {
      opts.onFollowersFetch?.(url);
      const followers = opts.followers ?? [];
      return Promise.resolve(
        json({ entries: followers, total: opts.followersTotal ?? followers.length }),
      );
    }
    if (url.includes('/api/relations/following')) {
      const entries = opts.entries ?? [];
      return Promise.resolve(json({ entries, total: opts.total ?? entries.length }));
    }
    return Promise.resolve(json({}, 404));
  });
}

async function mount(): Promise<HTMLElement> {
  vi.resetModules();
  const root = document.createElement('div');
  document.body.append(root);
  const { mountFollowing } = await import('./following.js');
  await mountFollowing(root);
  return root;
}

describe('following page', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    window.history.replaceState(null, '', '/following');
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a sign-in prompt for an anonymous visitor instead of rows', async () => {
    stubFetch({ signedIn: false, entries: [entry()] });
    const root = await mount();
    expect(root.querySelector('.following-table')).toBeNull();
    const prompt = root.querySelector('.following-signed-out');
    expect(prompt).not.toBeNull();
    expect(prompt?.querySelector('h1')?.textContent).toBe('Sign in to see your friends');
    const cta = prompt?.querySelector<HTMLAnchorElement>('.following-sign-in');
    expect(cta?.getAttribute('href')).toContain('/account?tab=login');
  });

  it('renders a row per followed player with rating, games, and last-active', async () => {
    stubFetch({
      entries: [
        entry(),
        entry({
          handle: 'newbie',
          displayName: 'Newbie',
          bestRating: { variant: 'fog', eloRating: 1500, provisional: true },
          gamesTotal: 0,
          lastSeenAt: null,
        }),
      ],
    });
    const root = await mount();
    const rows = [...root.querySelectorAll('.following-row')];
    expect(rows).toHaveLength(2);

    const names = rows.map((row) => row.querySelector('.following-player-name')?.textContent);
    expect(names).toEqual(['Conan_The_Barbarian8', 'Newbie']);
    expect(rows[0]?.querySelector('.following-player-link')?.getAttribute('href')).toBe('/@/conan');

    expect(rows[0]?.querySelector('.following-rating')?.textContent).toBe('2903');
    expect(rows[1]?.querySelector('.following-rating')?.textContent).toBe('1500?');
    expect(rows[0]?.querySelector('.following-games')?.textContent).toBe('42');
    expect(rows[0]?.querySelector('.following-last-seen')?.textContent).toBe('2 hours ago');
    // NULL last-seen renders the quiet fallback, never an error.
    expect(rows[1]?.querySelector('.following-last-seen')?.textContent).toBe('a while ago');

    expect(root.querySelector('.following-sub')?.textContent).toBe('2 players');
  });

  it('badges a titled player inside the name link, before the name', async () => {
    stubFetch({ entries: [entry({ title: 'xgm' }), entry({ handle: 'plain', title: null })] });
    const root = await mount();
    const rows = [...root.querySelectorAll('.following-row')];

    const badge = rows[0]?.querySelector('.following-player-link .title-badge');
    expect(badge?.textContent).toBe('XGM');
    expect(badge?.getAttribute('title')).toBe('Xiangqi Grandmaster');
    // Badge precedes the name, so the row reads "XGM Conan_The_Barbarian8".
    expect(rows[0]?.querySelector('.following-player-link')?.firstElementChild).toBe(badge);
    // An untitled player gets no badge and no empty node in its place.
    expect(rows[1]?.querySelector('.title-badge')).toBeNull();
  });

  it('renders a dash when a player has no rated pool yet', async () => {
    stubFetch({ entries: [entry({ bestRating: null })] });
    const root = await mount();
    expect(root.querySelector('.following-rating')?.textContent).toBe('–');
  });

  it('shows the empty state when the viewer follows nobody', async () => {
    stubFetch({ entries: [] });
    const root = await mount();
    expect(root.querySelector('.following-table')).toBeNull();
    expect(root.querySelector('.following-empty')?.textContent).toContain(
      'not following anyone yet',
    );
  });

  it('unfollows via DELETE and removes the row', async () => {
    const deletes: string[] = [];
    stubFetch({ entries: [entry()], onDelete: (url) => deletes.push(url) });
    const root = await mount();

    root.querySelector<HTMLButtonElement>('.following-unfollow')?.click();
    await flushDom();

    expect(deletes).toEqual(['/api/users/conan/follow']);
    expect(root.querySelector('.following-row')).toBeNull();
    expect(root.querySelector('.following-empty')).not.toBeNull();
  });
});

describe('followers tab', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    window.history.replaceState(null, '', '/following?tab=followers');
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const follower = (over: Partial<FollowerEntry> = {}): FollowerEntry => ({
    handle: 'conan',
    displayName: 'Conan',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ...over,
  });

  it('lists who follows the viewer, linking only linkable profiles', async () => {
    const fetched: string[] = [];
    stubFetch({
      followers: [follower(), follower({ handle: null, displayName: 'Quiet One', title: 'xgm' })],
      onFollowersFetch: (url) => fetched.push(url),
    });
    const root = await mount();

    expect(fetched).toEqual(['/api/relations/followers?offset=0&limit=50']);
    const rows = [...root.querySelectorAll('.follower-row')];
    expect(rows.map((row) => row.querySelector('.following-player-name')?.textContent)).toEqual([
      'Conan',
      'Quiet One',
    ]);
    expect(rows[0]?.querySelector('a.following-player-link')?.getAttribute('href')).toBe(
      '/@/conan',
    );
    // A private follower: named (with their title), but no link anywhere in the row.
    expect(rows[1]?.querySelector('a')).toBeNull();
    expect(rows[1]?.querySelector('.title-badge')?.textContent).toBe('XGM');
    expect(rows[0]?.querySelector('.follower-since')?.textContent).toBe('3 hours ago');
    // Followers carry no unfollow button: that action belongs to the Following tab.
    expect(root.querySelector('.following-unfollow')).toBeNull();
    expect(root.querySelector('.following-sub')?.textContent).toBe('2 players');
  });

  it('marks the Followers tab current and links both tabs', async () => {
    stubFetch({ followers: [follower()] });
    const root = await mount();
    const tabs = [...root.querySelectorAll<HTMLAnchorElement>('.following-tab')];
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
      ['Following', '/following'],
      ['Followers', '/following?tab=followers'],
    ]);
    expect(tabs[1]?.getAttribute('aria-current')).toBe('page');
    expect(tabs[0]?.hasAttribute('aria-current')).toBe(false);
  });

  it('shows the followers empty state', async () => {
    stubFetch({ followers: [] });
    const root = await mount();
    expect(root.querySelector('.following-table')).toBeNull();
    expect(root.querySelector('.following-empty')?.textContent).toBe('Nobody follows you yet.');
  });

  it('pages further followers on Load more', async () => {
    const fetched: string[] = [];
    stubFetch({
      followers: [follower()],
      followersTotal: 2,
      onFollowersFetch: (url) => fetched.push(url),
    });
    const root = await mount();
    root.querySelector<HTMLButtonElement>('.following-load-more')?.click();
    await flushDom();
    expect(fetched[1]).toBe('/api/relations/followers?offset=1&limit=50');
  });

  it('keeps the Following tab as the default view', async () => {
    window.history.replaceState(null, '', '/following');
    const fetched: string[] = [];
    stubFetch({ entries: [entry()], onFollowersFetch: (url) => fetched.push(url) });
    const root = await mount();
    expect(fetched).toEqual([]);
    expect(root.querySelectorAll('.following-row')).toHaveLength(1);
    expect(root.querySelector('.following-tab[aria-current="page"]')?.textContent).toBe(
      'Following',
    );
  });
});

describe('friends nav gating', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    window.history.replaceState(null, '', '/');
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Select by href, not by "the first signed-in-only link": Correspondence is
  // also signed-in-only and renders ahead of Friends, so a positional query
  // silently starts asserting against the wrong link.
  function friendsLink(): HTMLAnchorElement | null {
    return document.querySelector<HTMLAnchorElement>('[data-signed-in-only][href="/following"]');
  }

  it('points Friends at /following and hides it before any sign-in', async () => {
    const { buildNav } = await import('./site-shell.js');
    document.body.append(buildNav());
    const link = friendsLink();
    expect(link?.getAttribute('href')).toBe('/following');
    expect(link?.textContent).toBe('Friends');
    expect(link?.hidden).toBe(true);
  });

  it('reveals Friends when auth resolves signed in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(SIGNED_IN)),
    );
    const { initializeAccountNav } = await import('./account-nav.js');
    const { buildNav } = await import('./site-shell.js');

    document.body.append(buildNav());
    expect(friendsLink()?.hidden).toBe(true);

    initializeAccountNav();
    await flushDom();
    expect(friendsLink()?.hidden).toBe(false);
  });

  it('paints Friends visible from the signed-in hint, then hides it if auth resolves signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ user: null })),
    );
    const { writeSignedInHint } = await import('./signed-in-state.js');
    writeSignedInHint(true);

    const { buildNav } = await import('./site-shell.js');
    const { initializeAccountNav } = await import('./account-nav.js');

    // The stale hint paints the link visible immediately (no reveal jank for
    // returning signed-in users)...
    document.body.append(buildNav());
    expect(friendsLink()?.hidden).toBe(false);

    // ...and the authoritative signed-out resolution hides it again.
    initializeAccountNav();
    await flushDom();
    expect(friendsLink()?.hidden).toBe(true);
  });
});

async function flushDom(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  } as Storage;
}
