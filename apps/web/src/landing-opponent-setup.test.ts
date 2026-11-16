import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track, trackCorrespondenceSeekPosted } from './analytics.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import { buildLandingPlayPanel, openLandingSetupDialog, setRoomNavigator } from './landing-play.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn } from './signed-in-state.js';
import { navPhoneMediaQuery } from './site-shell.js';

vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: vi.fn(),
  trackCorrespondenceSeekPosted: vi.fn(),
}));

describe('#1123 opponent-first setup', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
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
        removeItem: (key: string) => {
          values.delete(key);
        },
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });
    vi.clearAllMocks();
    vi.stubEnv('VITE_CORRESPONDENCE_ENABLED', 'true');
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === navPhoneMediaQuery,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/relations/following'))
        return json({
          entries: [
            { handle: 'offline', displayName: 'Offline' },
            { handle: 'mutual', displayName: 'Mutual' },
            { handle: 'online', displayName: 'Online' },
          ],
          total: 3,
        });
      if (url.startsWith('/api/relations/followers'))
        return json({
          entries: [
            { handle: 'mutual', displayName: 'Mutual' },
            { handle: 'follower', displayName: 'Follower' },
            { handle: null, displayName: 'Private' },
          ],
          total: 3,
        });
      if (url === '/api/relations/online-following')
        return json({ players: [{ handle: 'online' }] });
      if (url.includes('/api/live-invites/availability?'))
        return json({ players: [{ handle: 'online', availability: 'available' }] });
      if (url === '/api/correspondence/seeks' && init?.method === 'POST') {
        return json({ challengeUrl: '/challenge/sent', seek: { gameSpecId: 'jieqi' } }, 201);
      }
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    navigate = vi.fn();
    setRoomNavigator(navigate);
    setResolvedSignedIn(true);
    setRatedModeEnabled(true, true);
  });

  afterEach(() => {
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    document.body.replaceChildren();
    document.documentElement.className = '';
    window.localStorage.clear();
    setRoomNavigator(null);
    setResolvedSignedIn(undefined);
    setRatedModeEnabled(false);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const open = (mode: 'pve' | 'lobby' | 'pvp' = 'pve', correspondence = false) =>
    openLandingSetupDialog({
      mode,
      modeSwitcher: true,
      initialGameSpecId: 'jieqi',
      initialRated: false,
      initialTimeMode: correspondence ? 'correspondence' : 'realtime',
    });
  const section = (id: string) =>
    document.querySelector<HTMLElement>(`[data-setup-section="${id}"]`);
  const start = () => document.querySelector<HTMLButtonElement>('button.landing-setup-start')!;
  const click = (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull();
    button!.click();
  };

  it('keeps rated off when the homepage reopens a human opponent while rated play is off', () => {
    setRatedModeEnabled(false, true);
    window.localStorage.setItem('mistboard:setup:lastMode', 'pvp');
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    panel.querySelector<HTMLButtonElement>('.landing-play-action')!.click();
    const rated = document.querySelector<HTMLButtonElement>(
      '[data-setup-section="gameType"] .landing-start-option',
    );
    expect(rated?.disabled).toBe(true);
    expect(rated?.textContent).toContain('coming soon');
  });

  it('has one homepage Play entry, remembers the last opponent, and records its origin', () => {
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    const play = panel.querySelector<HTMLButtonElement>('.landing-play-action')!;
    expect(panel.querySelector('.landing-play-quick')).toBeNull();
    play.click();
    expect(
      section('opponent')?.querySelector('[aria-checked="true"]')?.getAttribute('data-play-mode'),
    ).toBe('pve');
    expect(track).toHaveBeenCalledWith(
      'setup_dialog_opened',
      expect.objectContaining({ source: 'hero', mode_from: 'default', mode: 'pve' }),
    );
    click('[data-play-mode="lobby"]');
    click('.landing-setup-close');
    play.click();
    expect(
      section('opponent')?.querySelector('[aria-checked="true"]')?.getAttribute('data-play-mode'),
    ).toBe('lobby');
    expect(track).toHaveBeenLastCalledWith(
      'setup_dialog_opened',
      expect.objectContaining({ source: 'hero', mode_from: 'stored', mode: 'lobby' }),
    );
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'puts Opponent first, with ordered labels and hints (%s)',
    async (locale) => {
      await ensureLocaleCatalog(locale);
      openLandingSetupDialog({ mode: 'pve', modeSwitcher: true, locale });
      const rows = [...document.querySelectorAll<HTMLElement>('[data-setup-section]')].filter(
        (el) => !el.hidden,
      );
      expect(rows[0]?.dataset.setupSection).toBe('opponent');
      expect(rows[1]?.dataset.setupSection).toBe('engine');
      const buttons = [...section('opponent')!.querySelectorAll<HTMLButtonElement>('button')];
      expect(buttons.map((button) => button.dataset.playMode)).toEqual(['pve', 'lobby', 'pvp']);
      expect(
        buttons.map((button) => button.querySelector('.landing-start-option-text')?.textContent),
      ).toEqual([
        t('play.opponentEngine', {}, locale),
        t('play.opponentLobby', {}, locale),
        t('play.opponentFriend', {}, locale),
      ]);
      expect(
        buttons.map((button) => button.querySelector('.landing-setup-option-hint')?.textContent),
      ).toEqual([
        t('play.opponentEngineHint', {}, locale),
        t('play.opponentLobbyHint', {}, locale),
        t('play.opponentFriendHint', {}, locale),
      ]);
    },
  );

  it.each(['pve', 'lobby', 'pvp'] as const)(
    'shows Pace for human opponents and units for real time only (%s)',
    (mode) => {
      open(mode);
      expect(section('pace')?.hidden ?? true).toBe(mode === 'pve');
      expect(section('time')?.querySelector('.landing-setup-row-hint')?.textContent).toBe(
        'minutes + seconds per move',
      );
      if (mode === 'pve') return;
      const visibleRows = [
        ...document.querySelectorAll<HTMLElement>('[data-setup-section]'),
      ].filter((el) => !el.hidden);
      expect(visibleRows[1]?.dataset.setupSection).toBe('pace');
      expect(section('pace')?.textContent).toContain('on the clock');
      expect(section('pace')?.textContent).toContain('a move a day');
      click('.landing-time-mode button:nth-child(2)');
      expect(document.querySelector<HTMLElement>('.landing-correspondence-presets')?.hidden).toBe(
        false,
      );
      expect(section('time')?.querySelector('.landing-setup-row-hint')?.textContent).toBe('');
      click('.landing-time-mode button:first-child');
      expect(document.querySelector<HTMLElement>('.landing-correspondence-presets')?.hidden).toBe(
        true,
      );
    },
  );

  it('starts Computer on the first mover and people on Random, with a stored side taking priority', () => {
    const selectedSide = () =>
      document.querySelector('.landing-color-option.selected .landing-color-label')?.textContent;
    // Find opponent has no side picker; the server seats lobby games.
    open('pvp');
    expect(selectedSide()).toBe('Random');
    click('.landing-setup-close');
    open();
    expect(selectedSide()).toBe('Red');
    click('.landing-setup-close');
    window.localStorage.setItem('mistboard:setup:pve', JSON.stringify({ preferredColor: 'black' }));
    open();
    expect(selectedSide()).toBe('Black');
  });

  it('offers Send to only for signed-in Friend at either pace and defaults to a link', () => {
    for (const mode of ['pve', 'lobby', 'pvp'] as const) {
      open(mode);
      expect(section('sendTo')?.hidden ?? true).toBe(mode !== 'pvp');
    }
    setResolvedSignedIn(false);
    open('pvp', true);
    expect(section('sendTo')?.hidden ?? true).toBe(true);
    setResolvedSignedIn(true);
    open('pvp', true);
    expect(section('sendTo')?.hidden).toBe(false);
    expect(section('sendTo')?.querySelector('[aria-checked="true"]')?.textContent).toBe(
      'Share a link',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('replaces setup with a searchable, deduplicated, online-first player list and sends a directed seek', async () => {
    open('pvp', true);
    click('[data-send-to="player"]');
    click('.landing-challenge-player-row');
    await flush();
    expect(document.querySelector<HTMLElement>('.landing-setup-scroll')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.landing-setup-footer')?.hidden).toBe(true);
    const options = () => [
      ...document.querySelectorAll<HTMLButtonElement>('.landing-challenge-player-option'),
    ];
    expect(options().map((el) => el.dataset.handle)).toEqual([
      'online',
      'follower',
      'mutual',
      'offline',
    ]);
    expect(options()[0]?.querySelector('.landing-player-online-dot')).not.toBeNull();
    expect(options().map((el) => el.textContent)).toEqual([
      expect.stringContaining('online now'),
      expect.stringContaining('follows you'),
      expect.stringContaining('you follow each other'),
      expect.stringContaining('you follow'),
    ]);
    const search = document.querySelector<HTMLInputElement>('.landing-challenge-player-search')!;
    search.value = 'MuTu';
    search.dispatchEvent(new Event('input'));
    expect(
      options()
        .filter((el) => !el.hidden)
        .map((el) => el.dataset.handle),
    ).toEqual(['mutual']);
    click('[data-handle="mutual"]');
    expect(document.querySelector<HTMLElement>('.landing-setup-scroll')?.hidden).toBe(false);
    expect(document.querySelector('.landing-challenge-player-row')?.textContent).toContain(
      '@mutual',
    );
    expect(start().textContent).toBe('Send challenge to @mutual');
    start().click();
    await flush();
    const post = fetchSpy.mock.calls.find(
      ([url, init]) => String(url) === '/api/correspondence/seeks' && init?.method === 'POST',
    );
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({
      targetHandle: 'mutual',
      gameSpecId: 'jieqi',
      preferredColor: 'random',
      daysPerMove: 3,
    });
    expect(navigate).toHaveBeenCalledWith('/challenge/sent');
    expect(trackCorrespondenceSeekPosted).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'direct', source: 'setup', send_to: 'player' }),
    );
  });

  it('keeps an unselected player from becoming a public/link challenge and lets Back restore the form', async () => {
    open('pvp', true);
    click('[data-send-to="player"]');
    expect(start().disabled).toBe(true);
    click('.landing-challenge-player-row');
    await flush();
    click('.landing-setup-sheet-back');
    expect(document.querySelector<HTMLElement>('.landing-challenge-player-picker')?.hidden).toBe(
      true,
    );
    expect(document.querySelector<HTMLElement>('.landing-setup-scroll')?.hidden).toBe(false);
    expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows an empty state and handles a failed relation read with a retry', async () => {
    fetchSpy.mockImplementation(async () => json({}, 503));
    open('pvp', true);
    click('[data-send-to="player"]');
    click('.landing-challenge-player-row');
    await flush();
    expect(document.querySelector('.landing-challenge-player-picker')?.textContent).toContain(
      'Could not load players',
    );
    fetchSpy.mockImplementation(async () => json({ entries: [], players: [], total: 0 }));
    click('.landing-challenge-player-retry');
    await flush();
    expect(document.querySelector('.landing-challenge-player-picker')?.textContent).toContain(
      'Follow players from their profile to challenge them here.',
    );
  });

  it('loads every page of following and followers and deduplicates handles without case sensitivity', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('online-following')) return json({ players: [] });
      if (url.includes('/followers')) return json({ entries: [{ handle: 'FIRST' }], total: 1 });
      if (url.includes('offset=0')) return json({ entries: [{ handle: 'first' }], total: 2 });
      return json({ entries: [{ handle: 'second' }], total: 2 });
    });
    open('pvp', true);
    click('[data-send-to="player"]');
    click('.landing-challenge-player-row');
    await flush();
    expect(document.querySelectorAll('.landing-challenge-player-option')).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledWith('/api/relations/following?limit=50&offset=1');
    expect(document.querySelector('.landing-challenge-player-list')?.textContent).toContain(
      'you follow each other',
    );
  });

  it('uses the same in-place list on desktop, with Escape returning focus before dismissing setup', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    open('pvp', true);
    click('[data-send-to="player"]');
    click('.landing-challenge-player-row');
    await flush();
    expect(document.querySelector<HTMLElement>('.landing-setup-accordion')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.landing-challenge-player-picker')?.hidden).toBe(
      false,
    );
    expect(document.activeElement).toBe(document.querySelector('.landing-challenge-player-search'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector<HTMLElement>('.landing-setup-accordion')?.hidden).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('.landing-challenge-player-row'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.landing-setup-dialog')).toBeNull();
  });

  it.each(['pvp', 'lobby'] as const)(
    'records link delivery for a correspondence seek from %s',
    async (mode) => {
      open(mode, true);
      start().click();
      await flush();
      expect(trackCorrespondenceSeekPosted).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'setup', send_to: 'link' }),
      );
      const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(post![1]!.body as string)).not.toHaveProperty('targetHandle');
    },
  );

  it('keeps the selected player through pace switches, and only Share a link changes the delivery', async () => {
    open('pvp', true);
    click('[data-send-to="player"]');
    click('.landing-challenge-player-row');
    await flush();
    click('[data-handle="online"]');
    click('.landing-time-mode button:first-child');
    await flush();
    expect(section('sendTo')?.hidden).toBe(false);
    expect(start().textContent).toBe('Send challenge to @online');
    click('.landing-time-mode button:nth-child(2)');
    expect(start().textContent).toBe('Send challenge to @online');
    click('[data-send-to="link"]');
    expect(start().textContent).toBe('Create room');
    expect(document.querySelector<HTMLElement>('.landing-challenge-player-row')?.hidden).toBe(true);
  });

  it('falls back to Computer for an invalid stored opponent', () => {
    window.localStorage.setItem('mistboard:setup:lastMode', 'invalid-mode');
    const panel = buildLandingPlayPanel([]);
    panel.querySelector<HTMLButtonElement>('.landing-play-action')!.click();
    expect(track).toHaveBeenCalledWith(
      'setup_dialog_opened',
      expect.objectContaining({ mode: 'pve', mode_from: 'default' }),
    );
  });

  it('puts the correspondence account explanation directly above sign-in, preserving guest friend links', () => {
    setResolvedSignedIn(false);
    open('lobby', true);
    const signIn = document.querySelector<HTMLAnchorElement>('a.landing-setup-start')!;
    expect(signIn.hidden).toBe(false);
    expect(signIn.previousElementSibling?.textContent).toBe(
      "We save correspondence games to your account and email you when it's your move.",
    );
    expect(section('time')?.textContent).not.toContain('Correspondence games need an account.');
    open('pvp', true);
    expect(document.querySelector<HTMLAnchorElement>('a.landing-setup-start')?.hidden).toBe(true);
    expect(start().hidden).toBe(false);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
