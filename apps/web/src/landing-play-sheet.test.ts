import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLandingPlayPanel,
  type LandingGameSpecId,
  openLandingSetupDialog,
  setRoomNavigator,
  variantLabelForGameSpec,
} from './landing-play.js';
import {
  disposeLiveInvites,
  initializeLiveInvites,
  type LiveInviteView,
  setLiveInviteUser,
} from './live-invites.js';
import { resetLiveStatsCacheForTests } from './live-stats-client.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn } from './signed-in-state.js';
import { navPhoneMediaQuery } from './site-shell.js';

// At 600px and under, the setup dialog is a bottom sheet (mobile pass #576):
// one variant row that opens a list instead of the tile grid, every choice
// expanded as a compact row, Start pinned in a footer outside the scroller,
// and the page behind locked while it is open. Tablet and desktop keep the
// centred dialog with the grid.
describe('setup dialog on a phone', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const stubViewport = (phone: boolean): void => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: phone && query === navPhoneMediaQuery,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  };

  beforeEach(() => {
    resetLiveStatsCacheForTests();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/sheet_room' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
  });

  afterEach(() => {
    disposeLiveInvites();
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    document.body.replaceChildren();
    document.documentElement.className = '';
    window.localStorage.clear();
    setRatedModeEnabled(false);
    setResolvedSignedIn(undefined);
    setRoomNavigator(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const mountPanel = (): HTMLElement => {
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    return panel;
  };
  const openPlay = (panel: HTMLElement, mode: 'pve' | 'pvp'): HTMLButtonElement => {
    const button = panel.querySelector<HTMLButtonElement>('.landing-play-action');
    expect(button).not.toBeNull();
    button!.focus();
    button!.click();
    document
      .querySelector<HTMLButtonElement>(`.landing-setup-mode-switcher [data-play-mode="${mode}"]`)
      ?.click();
    return button!;
  };
  const dialog = () => document.querySelector<HTMLElement>('.landing-setup-dialog');
  const pickerEntries = (selector: string) =>
    [...document.querySelectorAll<HTMLButtonElement>(selector)].map((el) => ({
      spec: el.dataset.gameSpec,
      disabled: el.disabled,
    }));

  it('renders a bottom sheet with one variant row instead of the tile grid', () => {
    stubViewport(true);
    openPlay(mountPanel(), 'pve');

    expect(dialog()?.classList.contains('landing-setup-sheet')).toBe(true);
    expect(document.querySelector('.landing-setup-grabber')).not.toBeNull();
    expect(document.querySelector('.landing-variant-grid')).toBeNull();
    const row = document.querySelector<HTMLButtonElement>('.landing-variant-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Xiangqi');
    // Every choice is an expanded row: no accordion summaries to tap through.
    expect(document.querySelector('.landing-setup-summary')).toBeNull();
    const rows = [...document.querySelectorAll<HTMLElement>('.landing-setup-row')]
      .filter((el) => !el.hidden)
      .map((el) => el.dataset.setupSection);
    expect(rows).toEqual(expect.arrayContaining(['variant', 'time', 'gameType', 'opponent']));
    // The close button lives inside the sheet's header.
    expect(document.querySelector('.landing-setup-header .landing-setup-close')).not.toBeNull();
  });

  it('lists the same variants as the desktop grid, and a pick updates the row and the start payload', async () => {
    for (const mode of ['pve', 'pvp'] as const) {
      stubViewport(false);
      openPlay(mountPanel(), mode);
      const desktop = pickerEntries('.landing-variant-card[data-game-spec]');
      document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
      document.body.replaceChildren();

      stubViewport(true);
      openPlay(mountPanel(), mode);
      document.querySelector<HTMLButtonElement>('.landing-variant-row')?.click();
      const list = document.querySelector<HTMLElement>('.landing-variant-picker');
      expect(list?.hidden).toBe(false);
      expect(document.querySelector<HTMLElement>('.landing-setup-scroll')?.hidden).toBe(true);
      expect(desktop.length).toBeGreaterThan(1);
      expect(pickerEntries('.landing-variant-option[data-game-spec]')).toEqual(desktop);
      document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
      document.body.replaceChildren();
    }

    stubViewport(true);
    openPlay(mountPanel(), 'pvp');
    document.querySelector<HTMLButtonElement>('.landing-variant-row')?.click();
    document
      .querySelector<HTMLButtonElement>('.landing-variant-option[data-game-spec="banqi"]')
      ?.click();

    expect(document.querySelector<HTMLElement>('.landing-variant-picker')?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.landing-setup-scroll')?.hidden).toBe(false);
    expect(document.querySelector('.landing-variant-row')?.textContent).toContain(
      variantLabelForGameSpec('banqi' as LandingGameSpecId, 'en'),
    );

    document.querySelector<HTMLButtonElement>('.landing-setup-start')?.click();
    await flushPromises();
    const call = fetchSpy.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(call).toBeDefined();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
      mode: 'pvp',
      gameSpecId: 'banqi',
    });
  });

  it('pins Start game in a footer outside the scrolling content', () => {
    stubViewport(true);
    openPlay(mountPanel(), 'pve');

    const start = document.querySelector<HTMLButtonElement>('.landing-setup-start');
    const footer = start?.closest<HTMLElement>('.landing-setup-footer');
    expect(footer).not.toBeNull();
    expect(dialog()?.lastElementChild).toBe(footer);
    expect(start?.closest('.landing-setup-scroll')).toBeNull();
    expect(document.querySelector('.landing-setup-scroll .landing-setup-accordion')).not.toBeNull();
  });

  it('scrolls the selected variant into view when opening its list', () => {
    stubViewport(true);
    openPlay(mountPanel(), 'pvp');
    const selected = document.querySelector<HTMLElement>('.landing-variant-option.selected')!;
    selected.scrollIntoView = vi.fn();
    document.querySelector<HTMLButtonElement>('.landing-variant-row')?.click();
    expect(selected.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(document.activeElement).toBe(selected);
  });

  it('locks page scroll while open and returns focus on close', () => {
    stubViewport(true);
    const panel = mountPanel();
    const html = document.documentElement;

    const opener = openPlay(panel, 'pve');
    expect(html.classList.contains('landing-setup-open')).toBe(true);
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    // Switching opponent reopens the sheet in place; the page stays locked.
    document
      .querySelector<HTMLButtonElement>('.landing-setup-mode-switcher [data-play-mode="pvp"]')
      ?.click();
    expect(dialog()).not.toBeNull();
    expect(html.classList.contains('landing-setup-open')).toBe(true);
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    expect(dialog()).toBeNull();
    expect(html.classList.contains('landing-setup-open')).toBe(false);
    expect(document.activeElement).toBe(opener);

    openPlay(panel, 'pvp');
    expect(html.classList.contains('landing-setup-open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog()).toBeNull();
    expect(html.classList.contains('landing-setup-open')).toBe(false);
  });

  it('keeps the centred dialog and the variant grid on desktop', () => {
    stubViewport(false);
    const panel = mountPanel();
    const play = panel.querySelector<HTMLButtonElement>('.landing-play-action');
    play?.focus();
    play?.click();

    expect(dialog()?.classList.contains('landing-setup-sheet')).toBe(false);
    expect(document.querySelector('.landing-variant-grid')).not.toBeNull();
    expect(document.querySelector('.landing-variant-row')).toBeNull();
    // Every choice is open at once on desktop too: no accordion summaries.
    expect(document.querySelector('.landing-setup-summary')).toBeNull();
    const rows = [...document.querySelectorAll<HTMLElement>('.landing-setup-row')]
      .filter((el) => !el.hidden)
      .map((el) => el.dataset.setupSection);
    expect(rows).toEqual(expect.arrayContaining(['variant', 'time', 'opponent']));
    expect(document.documentElement.classList.contains('landing-setup-open')).toBe(false);
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    expect(document.activeElement).toBe(play);
  });

  it('keeps the old accordion on desktop behind ?setup=accordion', () => {
    stubViewport(false);
    window.history.replaceState(null, '', '/?setup=accordion');
    try {
      mountPanel().querySelector<HTMLButtonElement>('.landing-play-action')?.click();
      expect(document.querySelector('.landing-variant-grid')).not.toBeNull();
      expect(document.querySelector('.landing-setup-summary')).not.toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it.each([409, 401])(
    'sends the exact sheet terms for a follower-only player and handles HTTP %s without a fallback',
    async (httpStatus) => {
      stubViewport(true);
      setResolvedSignedIn(true);
      setRatedModeEnabled(true);
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/following?')) return jsonResponse({ entries: [], total: 0 });
        if (url.includes('/followers?'))
          return jsonResponse({
            entries: [{ handle: 'follower', displayName: 'Follower' }],
            total: 1,
          });
        if (url.includes('/availability?'))
          return jsonResponse({ players: [{ handle: 'follower', availability: 'available' }] });
        if (url === '/api/relations/online-following') return jsonResponse({ players: [] });
        if (url === '/api/live-invites' && init?.method === 'POST')
          return jsonResponse(
            { error: httpStatus === 401 ? 'not_signed_in' : 'target_unavailable' },
            { status: httpStatus },
          );
        return jsonResponse({}, { status: 404 });
      });
      openLandingSetupDialog({
        mode: 'pvp',
        initialGameSpecId: 'banqi',
        initialTimePresetId: '3m2',
        initialColor: 'black',
        initialRated: true,
      });
      expect(document.querySelector<HTMLElement>('[data-setup-section="sendTo"]')?.hidden).toBe(
        false,
      );
      document.querySelector<HTMLButtonElement>('[data-send-to="player"]')!.click();
      document.querySelector<HTMLButtonElement>('.landing-challenge-player-row')!.click();
      await flushPromises();
      const follower = document.querySelector<HTMLButtonElement>('[data-handle="follower"]')!;
      expect(follower.disabled).toBe(false);
      expect(follower.textContent).toContain('online now');
      follower.click();
      document.querySelector<HTMLButtonElement>('.landing-setup-start')!.click();
      await flushPromises();
      const post = fetchSpy.mock.calls.find(
        ([url, init]) => url === '/api/live-invites' && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        targetHandle: 'follower',
        gameSpecId: 'banqi',
        timeControl: { initialMs: 180000, incrementMs: 2000 },
        preferredColor: 'second',
        rated: true,
      });
      if (httpStatus === 401) {
        expect(document.querySelector<HTMLButtonElement>('.landing-setup-start')?.hidden).toBe(
          true,
        );
        expect(document.querySelector<HTMLAnchorElement>('a.landing-setup-start')?.hidden).toBe(
          false,
        );
      } else {
        expect(document.querySelector('.landing-setup-status')?.textContent).toContain(
          'Player unavailable',
        );
        expect(document.querySelector<HTMLButtonElement>('.landing-setup-start')?.disabled).toBe(
          true,
        );
      }
      expect(
        fetchSpy.mock.calls.some(
          ([url]) => url === '/api/rooms' || url === '/api/correspondence/seeks',
        ),
      ).toBe(false);
    },
  );

  it.each(['declined', 'cancelled', 'expired', 'accepted'] as const)(
    'opens the sender waiting state from the sheet and retains the %s outcome',
    async (outcome) => {
      vi.useFakeTimers();
      const drain = async () => {
        for (let i = 0; i < 60; i++) await Promise.resolve();
      };
      stubViewport(true);
      setResolvedSignedIn(true);
      let sent: LiveInviteView | undefined;
      fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/following?'))
          return jsonResponse({ entries: [{ handle: 'friend' }], total: 1 });
        if (url.includes('/followers?')) return jsonResponse({ entries: [], total: 0 });
        if (url.includes('online-following')) return jsonResponse({ players: [] });
        if (url.includes('/availability?'))
          return jsonResponse({ players: [{ handle: 'friend', availability: 'available' }] });
        if (url.endsWith('/heartbeat')) return jsonResponse({ leaseMs: 15000, pollAfterMs: 5000 });
        if (url === '/api/live-invites' && init?.method === 'POST') {
          sent = {
            ...JSON.parse(init.body as string),
            id: 'sheet-offer',
            sender: { handle: 'sender', displayName: 'Sender' },
            target: { handle: 'friend', displayName: 'Friend' },
            status: 'pending',
            isMine: true,
            canAccept: false,
            canDecline: false,
            canCancel: true,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          };
          return jsonResponse({ invite: sent }, { status: 201 });
        }
        if (url === '/api/live-invites')
          return jsonResponse({ incoming: [], outgoing: sent?.status === 'pending' ? [sent] : [] });
        if (url === '/api/live-invites/sheet-offer') {
          if (init?.method === 'DELETE') sent = { ...sent!, status: 'cancelled', canCancel: false };
          return jsonResponse({ invite: sent });
        }
        return jsonResponse({}, { status: 404 });
      });
      initializeLiveInvites();
      setLiveInviteUser('sender');
      await drain();
      openLandingSetupDialog({ mode: 'pvp', initialGameSpecId: 'banqi', initialRated: false });
      document.querySelector<HTMLButtonElement>('[data-send-to="player"]')!.click();
      document.querySelector<HTMLButtonElement>('.landing-challenge-player-row')!.click();
      await drain();
      document.querySelector<HTMLButtonElement>('[data-handle="friend"]')!.click();
      document.querySelector<HTMLButtonElement>('.landing-setup-start')!.click();
      await drain();
      expect(dialog()?.textContent).toContain('Waiting for a reply');
      expect(document.querySelector<HTMLElement>('.landing-setup-accordion')?.hidden).toBe(true);
      expect(document.querySelectorAll('.live-invite')).toHaveLength(2);
      if (outcome === 'cancelled') {
        [...dialog()!.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => button.textContent === 'Cancel')!
          .click();
        await drain();
      } else {
        sent = { ...sent!, status: outcome, canCancel: false };
        if (outcome === 'accepted')
          sent.room = { roomId: 'sheet_reserved', url: '/room/sheet_reserved', seat: 'red' };
        await vi.advanceTimersByTimeAsync(5000);
      }
      expect(dialog()?.textContent).toContain(`Invitation ${outcome}`);
      if (outcome === 'accepted')
        expect(dialog()?.querySelector('a')?.getAttribute('href')).toBe('/room/sheet_reserved');
      document.querySelector<HTMLButtonElement>('.landing-setup-close')!.click();
      expect(document.querySelector('.live-invites')?.textContent).toContain(
        `Invitation ${outcome}`,
      );
    },
  );
});

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
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
