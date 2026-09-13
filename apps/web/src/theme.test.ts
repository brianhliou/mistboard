import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boardThemes,
  buildAppearanceMenu,
  fogThemes,
  initializeThemeSettings,
  pieceSets,
  readStoredFogTheme,
  readStoredPieceSet,
  readStoredSiteTheme,
  readStoredTheme,
  setSiteThemePreference,
  siteThemeOptions,
} from './theme.js';

// The chess board and piece pickers are GONE (board 2026-07-31, pieces
// 2026-07-26): each family ships one, and the wood board carries the
// accessibility floor itself rather than deferring to a High contrast tile. Fog
// still HAS options but no longer offers them (hidden 2026-08-27). These lock
// that shape so tiles cannot drift back in without a deliberate edit, and so any
// stored preference resolves to a shipping value.
describe('appearance option floor', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it('ships exactly one chess board, with no picker to choose it', () => {
    expect(boardThemes.map((theme) => theme.id)).toEqual(['standard']);
  });

  it('ships exactly one chess piece set, with no picker to choose it', () => {
    expect(pieceSets.map((set) => set.id)).toEqual(['cburnett']);
  });

  it('keeps three fog shading styles', () => {
    expect(fogThemes.map((theme) => theme.id)).toEqual(['solid', 'veil', 'invisible']);
  });

  // With one board there is no "nearest survivor" left to map onto: a player who
  // had picked High contrast or Tournament lands on the wood board like everyone
  // else. Covered explicitly because those two were shipping options, not just
  // legacy ids.
  it('resolves every retired board preference to the single board', () => {
    for (const retired of ['mono', 'blue', 'green', 'contrast', 'colorblind']) {
      window.localStorage.setItem('mistboard.boardTheme', retired);
      expect(readStoredTheme()).toBe('standard');
    }
  });

  it('maps a retired piece set and fog style to their survivors', () => {
    window.localStorage.setItem('mistboard.pieceSet', 'merida');
    expect(readStoredPieceSet()).toBe('cburnett');
    window.localStorage.setItem('mistboard.pieceSet', 'letter');
    expect(readStoredPieceSet()).toBe('cburnett');
    window.localStorage.setItem('mistboard.fogTheme', 'mistveil');
    expect(readStoredFogTheme()).toBe('veil');
    window.localStorage.setItem('mistboard.fogTheme', 'void');
    expect(readStoredFogTheme()).toBe('solid');
  });

  it('still falls back to the default for an unknown value', () => {
    window.localStorage.setItem('mistboard.boardTheme', 'not-a-theme');
    expect(readStoredTheme()).toBe('standard');
  });
});

describe('site appearance preference', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    document.documentElement.removeAttribute('data-site-theme');
    document.documentElement.removeAttribute('data-effective-theme');
    document.documentElement.removeAttribute('data-xiangqi-board-layout');
    document.documentElement.removeAttribute('style');
    document.head.innerHTML = '<meta name="theme-color" content="#1f2521">';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to system mode', () => {
    expect(readStoredSiteTheme()).toBe('system');
    expect(siteThemeOptions.map((option) => option.id)).toEqual(['system', 'light', 'dark']);
  });

  it('stores explicit dark mode and applies it to the root', () => {
    setSiteThemePreference('dark');

    expect(window.localStorage.getItem('mistboard.siteTheme')).toBe('dark');
    expect(document.documentElement.dataset.siteTheme).toBe('dark');
    expect(document.documentElement.dataset.effectiveTheme).toBe('dark');
    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
      '#121615',
    );
  });

  it('normalizes invalid stored values back to system', () => {
    window.localStorage.setItem('mistboard.siteTheme', 'sepia');

    expect(readStoredSiteTheme()).toBe('system');
  });

  it('resolves system mode from prefers-color-scheme', () => {
    stubPrefersDark(true);

    setSiteThemePreference('system');

    expect(document.documentElement.dataset.siteTheme).toBe('system');
    expect(document.documentElement.dataset.effectiveTheme).toBe('dark');
  });

  // The fog picker is hidden, so a choice made while it was visible must not keep
  // shading one player's boards differently from everyone else's. Storage is left
  // alone on purpose: this asserts the value is IGNORED, not deleted.
  it('ignores a stored fog style while the picker is hidden', () => {
    window.localStorage.setItem('mistboard.fogTheme', 'invisible');

    initializeThemeSettings();

    expect(document.documentElement.dataset.fogTheme).toBe('solid');
    expect(window.localStorage.getItem('mistboard.fogTheme')).toBe('invisible');
  });

  it('exposes the stored xiangqi layout to shared CSS sizing', () => {
    window.localStorage.setItem('mistboard.xiangqiBoardLayout', 'cell');
    window.localStorage.setItem('mistboard.xiangqiBoardLayoutVersion', '1');

    initializeThemeSettings();

    expect(document.documentElement.dataset.xiangqiBoardLayout).toBe('cell');
  });
});

function stubPrefersDark(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) satisfies MediaQueryList,
  );
}

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

describe('appearance family gating', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    document.body.innerHTML = '<nav class="site-nav"><div class="site-nav-utilities"></div></nav>';
    document.documentElement.removeAttribute('data-board-family');
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('puts signed-out language choices inside the gear menu', async () => {
    window.history.replaceState(null, '', '/zh-hant/rules/banqi');

    await rebuildThemePanel();

    expect(document.querySelector('.site-nav-language')).toBeNull();
    expect(
      document.querySelector<HTMLElement>(
        '[data-theme-control] [data-appearance-target="language"]',
      )?.textContent,
    ).toBe('語言');
    expect(
      [...document.querySelectorAll<HTMLElement>('.appearance-language-option')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['English', '简体中文', '繁體中文']);
    expect(
      document
        .querySelector<HTMLElement>('.appearance-language-option.selected')
        ?.getAttribute('data-locale'),
    ).toBe('zh-Hant');
  });

  it('marks the language row with a glyph, and only that row', async () => {
    await rebuildThemePanel();

    const rows = [...document.querySelectorAll<HTMLElement>('[data-appearance-target]')];
    const withIcon = rows
      .filter((row) => row.querySelector('.appearance-menu-row-icon'))
      .map((row) => row.dataset.appearanceTarget);

    expect(rows.length).toBeGreaterThan(1);
    expect(withIcon).toEqual(['language']);
  });

  it('renders signed-out sound, appearance, and connection controls in the gear menu', async () => {
    await rebuildThemePanel();

    expect(document.querySelector('[data-theme-control] .account-nav-status')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-appearance-target="sound"]')?.click();
    expect(
      document.querySelector<HTMLElement>('[data-theme-control]')?.dataset.themeControlView,
    ).toBe('submenu');
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('button[data-sound-option]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Wood', 'Mist', 'Piano', 'SFX', 'Futuristic', 'NES', 'Silent']);
    expect(
      document
        .querySelector<HTMLButtonElement>('button[data-sound-option="wood"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');

    document.querySelector<HTMLButtonElement>('button[data-sound-option="silent"]')?.click();
    expect(window.localStorage.getItem('mistboard.soundMuted')).toBe('true');
    expect(
      document
        .querySelector<HTMLButtonElement>('button[data-sound-option="silent"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true');

    document.querySelector<HTMLButtonElement>('button[data-sound-option="mist"]')?.click();
    expect(window.localStorage.getItem('mistboard.soundMuted')).toBe('false');
    expect(window.localStorage.getItem('mistboard.soundSet')).toBe('mist');

    document.querySelector<HTMLButtonElement>('.appearance-submenu-back')?.click();
    expect(
      document.querySelector<HTMLElement>('[data-theme-control]')?.dataset.themeControlView,
    ).toBe('root');
    document.querySelector<HTMLButtonElement>('[data-appearance-target="theme"]')?.click();
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('button[data-site-theme-option]')].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Device theme', 'Light', 'Dark']);
  });

  it('surfaces current xiangqi and chess settings', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');

    await rebuildThemePanel();

    // Chess ships one board and one piece set, so both chess pickers are gone —
    // and with nothing left to scope, so is the Game selector.
    expect(document.querySelector('[data-board-family-select]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="board"]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="piece"]')).toBeNull();
    // Fog is hidden for now too, so the panel is xiangqi-only below the shared
    // Sound/Appearance rows.
    expect(document.querySelector('[data-theme-tile="fog"]')).toBeNull();
    expect(document.querySelector('[data-appearance-target="fog"]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="xqlayout"]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="xqboard"]')).not.toBeNull();
    expect(document.querySelector('[data-theme-tile="xqpiece"]')).not.toBeNull();
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-theme-tile="xqboard"]')].map((tile) =>
        tile.getAttribute('aria-label'),
      ),
    ).toEqual(['International', 'Traditional', 'Square grid']);

    document
      .querySelector<HTMLButtonElement>('[data-theme-tile="xqboard"][data-id="cell"]')
      ?.click();
    expect(window.localStorage.getItem('mistboard.xiangqiBoardLayout')).toBe('cell');
    expect(document.documentElement.dataset.xiangqiBoardLayout).toBe('cell');

    document
      .querySelector<HTMLButtonElement>('[data-theme-tile="xqboard"][data-id="traditional"]')
      ?.click();
    expect(window.localStorage.getItem('mistboard.xiangqiBoardTheme')).toBe('traditional');
    expect(window.localStorage.getItem('mistboard.xiangqiBoardLayout')).toBe('intersection');
    expect(document.documentElement.dataset.xiangqiBoardLayout).toBe('intersection');
  });

  it('surfaces the xiangqi pickers, with no Game toggle, without xiangqi env flags', async () => {
    await rebuildThemePanel();

    expect(document.querySelector('[data-board-family-select]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="xqlayout"]')).toBeNull();
    expect(document.querySelector('[data-theme-tile="xqboard"]')).not.toBeNull();
    expect(document.querySelector('[data-theme-tile="xqpiece"]')).not.toBeNull();
  });

  // Board and Pieces both drop straight into the xiangqi tiles now. This is the
  // empty-panel guard: while a Game selector was still in the panel, choosing
  // 'chess' gated away the only remaining field and left the sub-panel blank.
  it('opens Board and Pieces straight onto xiangqi tiles, never an empty panel', async () => {
    await rebuildThemePanel();

    for (const [key, tile] of [
      ['board', 'xqboard'],
      ['pieces', 'xqpiece'],
    ]) {
      document.querySelector<HTMLButtonElement>(`[data-appearance-target="${key}"]`)?.click();
      const submenu = document.querySelector<HTMLElement>(`.appearance-submenu[data-key="${key}"]`);

      expect(submenu?.querySelector('[data-board-family-select]')).toBeNull();
      expect(submenu?.querySelector(`[data-theme-tile="${tile}"]`)).not.toBeNull();
      // Nothing inside is family-gated, so no CSS rule can empty the panel.
      expect(submenu?.querySelector('[data-appearance-family]')).toBeNull();

      submenu?.querySelector<HTMLButtonElement>('.appearance-submenu-back')?.click();
    }
  });

  it('swaps the real appearance menu into the buildAppearanceMenu facade placeholder', async () => {
    // account-nav embeds the menu synchronously; the facade returns an empty
    // .appearance-menu holder and replaces it once the lazy settings chunk
    // lands, so the embed contract stays synchronous without the panel code
    // riding in the entry chunk.
    const host = document.createElement('div');
    document.body.append(host);
    const holder = buildAppearanceMenu();
    host.append(holder);

    expect(holder.classList.contains('appearance-menu')).toBe(true);
    expect(holder.querySelector('[data-appearance-target]')).toBeNull();

    await vi.waitFor(() => {
      if (!host.querySelector('[data-appearance-target="sound"]')) {
        throw new Error('appearance menu not swapped in yet');
      }
    });
    // The placeholder was replaced, not nested: still exactly one menu element.
    expect(host.querySelectorAll('.appearance-menu')).toHaveLength(1);
  });
});

// Drop any panel the persistent nav observer mounted before the flag stub, then
// rebuild from scratch so the panel reflects the env stubbed in this test. The
// panel body lives in the lazily loaded theme-settings-panel chunk and is built
// on first gear open, so exercise that real path: click the trigger and wait
// for the menu rows to land.
async function rebuildThemePanel(): Promise<void> {
  for (const control of document.querySelectorAll('[data-theme-control]')) control.remove();
  initializeThemeSettings();
  document.querySelector<HTMLButtonElement>('.theme-control-trigger')?.click();
  await vi.waitFor(() => {
    if (!document.querySelector('[data-theme-control] [data-appearance-target]')) {
      throw new Error('settings panel not populated yet');
    }
  });
}
