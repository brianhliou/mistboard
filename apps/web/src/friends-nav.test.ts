import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trackMock = vi.hoisted(() => vi.fn());
vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: trackMock,
}));

type Friend = {
  handle: string;
  displayName: string;
  title: string | null;
  rating: { variant: string; eloRating: number; provisional: boolean } | null;
  playing: boolean;
  roomUrl: string | null;
};

const friend = (over: Partial<Friend> = {}): Friend => ({
  handle: 'conan',
  displayName: 'Conan',
  title: null,
  rating: null,
  playing: false,
  roomUrl: null,
  ...over,
});

const ONLINE = '/api/relations/online-following';
let fetchedUrls: string[] = [];

// Route fetch by URL: auth resolves signed in; every other call (the bell's
// counts) answers empty.
function stubFetch(friends: Friend[] | 'fail'): void {
  fetchedUrls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      fetchedUrls.push(url);
      if (url.includes(ONLINE)) {
        if (friends === 'fail') return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ players: friends, count: 0 }) };
      }
      if (url.includes('/api/auth/me')) {
        return { ok: true, status: 200, json: async () => ({ user: testUser('me') }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

const onlineFetches = () => fetchedUrls.filter((url) => url.includes(ONLINE)).length;

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

type Modules = {
  accountNav: typeof import('./account-nav.js');
  shell: typeof import('./site-shell.js');
  notifications: typeof import('./notification-nav.js');
};

async function load(): Promise<Modules> {
  return {
    accountNav: await import('./account-nav.js'),
    shell: await import('./site-shell.js'),
    notifications: await import('./notification-nav.js'),
  };
}

function testUser(handle: string) {
  return {
    id: `user-${handle}`,
    email: `${handle}@example.com`,
    emailVerified: true,
    handle,
    handleChangedAt: null,
    displayName: handle,
    displayNameChangedAt: null,
    profileVisibility: 'public' as const,
    accountRole: 'player' as const,
    locale: null,
  };
}

// A signed-in desktop bar with the bell mounted, as main.ts sets it up.
async function signedInBar(friends: Friend[] | 'fail'): Promise<Modules> {
  stubFetch(friends);
  const modules = await load();
  modules.notifications.registerNotificationSource({ read: () => ({ count: 0, entries: [] }) });
  document.body.append(modules.shell.buildNav('en'));
  modules.accountNav.setAccountNavUser(testUser('me') as never);
  await flush();
  return modules;
}

function trigger(): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>('[data-friends-nav] .friends-nav-trigger');
  if (!el) throw new Error('no Friends trigger');
  return el;
}

async function openPanel(): Promise<HTMLElement> {
  trigger().click();
  await flush();
  return document.querySelector<HTMLElement>('[data-friends-nav] .friends-nav-panel')!;
}

describe('header Friends menu', () => {
  beforeEach(() => {
    vi.resetModules();
    trackMock.mockClear();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    // Sign the module instance out so its body observer stops re-mounting
    // into later tests (as account-nav.test.ts does).
    const { setAccountNavUser } = await import('./account-nav.js');
    setAccountNavUser(null);
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('sits immediately left of the bell, signed in only, and fetches nothing until opened', async () => {
    const { accountNav } = await signedInBar([friend()]);
    const control = document.querySelector('[data-friends-nav]');
    expect(control).not.toBeNull();
    expect(control?.nextElementSibling?.hasAttribute('data-notification-nav')).toBe(true);
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-label')).toBe('Friends online');
    // No badge on the icon, and no poll.
    expect(control?.querySelector('.notif-nav-badge')).toBeNull();
    expect(onlineFetches()).toBe(0);

    accountNav.setAccountNavUser(null);
    expect(document.querySelector('[data-friends-nav]')).toBeNull();
  });

  it('opens on click, fetches then, and lists friends with Watch for one in a game', async () => {
    await signedInBar([
      friend({ handle: 'amy', displayName: 'Amy', title: 'gm' }),
      friend({ handle: 'zed', displayName: 'Zed', playing: true, roomUrl: '/room/r%201' }),
    ]);
    const panel = await openPanel();
    expect(onlineFetches()).toBe(1);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-friends-nav]')?.classList).toContain('friends-nav-open');
    expect(panel.getAttribute('role')).toBe('menu');
    expect(panel.querySelector('.friends-nav-header')?.textContent).toBe('2 friends online');

    const rows = [...panel.querySelectorAll<HTMLElement>('.friends-nav-row')];
    expect(rows.map((row) => row.querySelector('.friends-nav-name')?.textContent)).toEqual([
      'Amy',
      'Zed',
    ]);
    const amy = rows[0]!.querySelector<HTMLAnchorElement>('.friends-nav-link')!;
    expect(amy.getAttribute('href')).toBe('/@/amy');
    expect(amy.querySelector('.friends-nav-dot')).not.toBeNull();
    expect(amy.querySelector('.title-badge')).not.toBeNull();
    expect(rows[0]!.querySelector('.friends-nav-watch')).toBeNull();

    const watch = rows[1]!.querySelector<HTMLAnchorElement>('.friends-nav-watch')!;
    expect(watch.getAttribute('href')).toBe('/room/r%201');
    expect(watch.textContent).toBe('Watch');
    expect(watch.getAttribute('aria-label')).toBe('Watch Zed play');

    const all = panel.querySelector<HTMLAnchorElement>('.friends-nav-all')!;
    expect(all.getAttribute('href')).toBe('/following');
    expect(all.textContent).toBe('All friends');

    expect(trackMock).toHaveBeenCalledWith('friends_menu_opened', { online: 2, surface: 'header' });
    watch.addEventListener('click', (event) => event.preventDefault());
    watch.click();
    expect(trackMock).toHaveBeenCalledWith('friends_watch_clicked', { surface: 'header' });
  });

  it('never links a room that is not a room page', async () => {
    await signedInBar([friend({ playing: true, roomUrl: 'https://evil.example/room/x' })]);
    const panel = await openPanel();
    expect(panel.querySelector('.friends-nav-watch')).toBeNull();
  });

  it('shows the empty state with guidance and the All friends link', async () => {
    await signedInBar([]);
    const panel = await openPanel();
    expect(panel.querySelector('.friends-nav-header')?.textContent).toBe('0 friends online');
    expect(panel.querySelector('.friends-nav-empty-title')?.textContent).toBe('No friends online');
    expect(panel.querySelector('.friends-nav-empty-hint')?.textContent).toContain('Follow players');
    expect(panel.querySelector('.friends-nav-all')?.getAttribute('href')).toBe('/following');
    expect(trackMock).toHaveBeenCalledWith('friends_menu_opened', { online: 0, surface: 'header' });
  });

  it('says so when the list cannot load', async () => {
    await signedInBar('fail');
    const panel = await openPanel();
    expect(panel.querySelector('.friends-nav-note')?.textContent).toBe(
      'Could not load friends. Try again.',
    );
    expect(trackMock).not.toHaveBeenCalledWith('friends_menu_opened', expect.anything());
  });

  it('closes on Escape, on an outside click and on a second click, and refetches on reopen', async () => {
    await signedInBar([friend()]);
    const control = () => document.querySelector('[data-friends-nav]')!;

    await openPanel();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(control().classList).not.toContain('friends-nav-open');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    await openPanel();
    document.body.click();
    expect(control().classList).not.toContain('friends-nav-open');

    await openPanel();
    trigger().click();
    expect(control().classList).not.toContain('friends-nav-open');
    expect(onlineFetches()).toBe(3);
  });
});

describe('phone site menu Friends count', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    vi.resetModules();
    trackMock.mockClear();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    document.body.innerHTML = '';
  });

  afterEach(async () => {
    const { closeSiteMenu } = await import('./site-shell.js');
    closeSiteMenu({ restoreFocus: false });
    const { setAccountNavUser } = await import('./account-nav.js');
    setAccountNavUser(null);
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  async function openPhoneMenu(friends: Friend[]): Promise<HTMLAnchorElement> {
    stubFetch(friends);
    const { accountNav, shell } = await load();
    window.matchMedia = ((query: string) =>
      ({
        matches: query === shell.navPhoneMediaQuery,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    accountNav.initializeAccountNav();
    const nav = shell.buildNav('en');
    document.body.append(nav);
    accountNav.setAccountNavUser(testUser('me') as never);
    await flush();
    shell.openSiteMenu(nav.querySelector<HTMLElement>('.site-nav-toggle')!, 'en');
    await flush();
    const link = document.querySelector<HTMLAnchorElement>(
      '#site-menu a.site-menu-link[data-nav-href="/following"]',
    );
    if (!link) throw new Error('no Friends item in the site menu');
    return link;
  }

  it('shows how many friends are online when any are', async () => {
    const link = await openPhoneMenu([friend(), friend({ handle: 'zed' })]);
    expect(link.querySelector('.site-menu-count')?.textContent).toBe('2 online');
    expect(trackMock).toHaveBeenCalledWith('friends_menu_opened', { online: 2, surface: 'menu' });
  });

  it('shows no count when none are', async () => {
    const link = await openPhoneMenu([]);
    expect(link.querySelector('.site-menu-count')).toBeNull();
    expect(link.textContent).toBe('Friends');
  });
});

describe('/following online marks', () => {
  it('dots an online friend and adds Watch for one in a game', async () => {
    vi.resetModules();
    const { decorateFollowingRows } = await import('./friends-nav.js');
    const tbody = document.createElement('tbody');
    for (const handle of ['Amy', 'bob', 'zed']) {
      const row = document.createElement('tr');
      row.dataset.handle = handle;
      row.innerHTML =
        '<td class="following-player"><a class="following-player-link"><span>n</span></a></td><td class="following-actions"><button>Unfollow</button></td>';
      tbody.append(row);
    }
    const friends = [
      friend({ handle: 'amy' }),
      friend({ handle: 'zed', displayName: 'Zed', playing: true, roomUrl: '/room/z' }),
    ];
    decorateFollowingRows(tbody, friends, 'en');
    decorateFollowingRows(tbody, friends, 'en'); // idempotent (load more re-runs it)
    const [amy, bob, zed] = [...tbody.querySelectorAll<HTMLElement>('tr')];
    expect(amy!.querySelectorAll('.friends-nav-dot')).toHaveLength(1);
    expect(amy!.querySelector('.friends-nav-watch')).toBeNull();
    expect(bob!.querySelector('.friends-nav-dot')).toBeNull();
    expect(zed!.querySelector('.following-actions .friends-nav-watch')?.getAttribute('href')).toBe(
      '/room/z',
    );
    expect(zed!.querySelectorAll('.friends-nav-watch')).toHaveLength(1);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
