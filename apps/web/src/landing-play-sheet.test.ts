import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLandingPlayPanel,
  type LandingGameSpecId,
  setRoomNavigator,
  variantLabelForGameSpec,
} from './landing-play.js';
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
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    document.body.replaceChildren();
    document.documentElement.className = '';
    window.localStorage.clear();
    setRatedModeEnabled(false);
    setResolvedSignedIn(undefined);
    setRoomNavigator(null);
    vi.unstubAllGlobals();
  });

  const mountPanel = (): HTMLElement => {
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    return panel;
  };
  const openQuick = (panel: HTMLElement, mode: 'pve' | 'pvp'): HTMLButtonElement => {
    const button = panel.querySelector<HTMLButtonElement>(
      `.landing-play-quick-action[data-play-mode="${mode}"]`,
    );
    expect(button).not.toBeNull();
    button!.focus();
    button!.click();
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
    openQuick(mountPanel(), 'pve');

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
      openQuick(mountPanel(), mode);
      const desktop = pickerEntries('.landing-variant-card[data-game-spec]');
      document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
      document.body.replaceChildren();

      stubViewport(true);
      openQuick(mountPanel(), mode);
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
    openQuick(mountPanel(), 'pvp');
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
    openQuick(mountPanel(), 'pve');

    const start = document.querySelector<HTMLButtonElement>('.landing-setup-start');
    const footer = start?.closest<HTMLElement>('.landing-setup-footer');
    expect(footer).not.toBeNull();
    expect(dialog()?.lastElementChild).toBe(footer);
    expect(start?.closest('.landing-setup-scroll')).toBeNull();
    expect(document.querySelector('.landing-setup-scroll .landing-setup-accordion')).not.toBeNull();
  });

  it('locks page scroll while open and returns focus on close', () => {
    stubViewport(true);
    const panel = mountPanel();
    const html = document.documentElement;

    const opener = openQuick(panel, 'pve');
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

    openQuick(panel, 'pvp');
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
    expect(document.querySelector('.landing-setup-summary')).not.toBeNull();
    expect(document.documentElement.classList.contains('landing-setup-open')).toBe(false);
    document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();
    expect(document.activeElement).toBe(play);
  });
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
