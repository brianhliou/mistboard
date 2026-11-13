import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStartForm } from './correspondence.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedAdmin, setResolvedStatsExcluded } from './signed-in-state.js';

// The /correspondence Start a game form's Casual/Rated control. Rated correspondence is
// held behind the server's MISTBOARD_CORRESPONDENCE_RATED_ENABLED (off by default), so
// the control is absent until /api/server-status says otherwise.
// The form is laid out as the Play a game panel: one labelled row per choice.
function setupRow(form: HTMLElement, id: string, label: string): HTMLElement | undefined {
  const row = form.querySelector<HTMLElement>(`.landing-setup-row[data-setup-section="${id}"]`);
  return row?.querySelector('.landing-setup-row-label')?.firstChild?.textContent === label
    ? row
    : undefined;
}

function gameTypeField(form: HTMLElement): HTMLElement | undefined {
  return setupRow(form, 'gameType', 'Rating');
}

function postedBody(form: HTMLElement, fetchMock: ReturnType<typeof vi.fn>) {
  form.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { rated?: boolean };
}

describe('correspondence Start a game: Casual/Rated', () => {
  // The last pick is remembered in browser storage, so every test starts from a
  // player who never chose.
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setRatedModeEnabled(false);
    setResolvedStatsExcluded(undefined);
  });

  // An account excluded from stats never rates (the server refuses it). Its Rated
  // button is disabled and says why, as in the challenge dialog, including when the
  // account answer lands after the form is drawn.
  it('labels Rated as unavailable for an account excluded from stats', () => {
    setRatedModeEnabled(true, true);
    const panel = buildStartForm(() => {}, { gameSpecId: 'xiangqi' });
    const ratedButton = () => gameTypeField(panel)?.querySelectorAll('button')[1];
    expect(ratedButton()?.disabled).toBe(false);
    expect(ratedButton()?.textContent).toBe('Rated');
    setResolvedStatsExcluded(true);
    expect(ratedButton()?.disabled).toBe(true);
    // The reason is the option's muted second line, as Play a game draws it.
    expect(ratedButton()?.querySelector('.landing-start-option-text')?.textContent).toBe('Rated');
    expect(ratedButton()?.querySelector('.landing-start-option-hint')?.textContent).toBe(
      'not available on this account',
    );
    setResolvedStatsExcluded(false);
    expect(ratedButton()?.disabled).toBe(false);
    expect(ratedButton()?.textContent).toBe('Rated');
  });

  it('is absent while rated correspondence is held, and the seek posts casual', () => {
    setRatedModeEnabled(true); // live rated on, correspondence rated held
    const panel = buildStartForm(() => {});
    expect(gameTypeField(panel)?.hidden).toBe(true);
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    expect('rated' in postedBody(panel, fetchMock)).toBe(false);
  });

  it('appears when the server enables it, and Rated posts rated', () => {
    const panel = buildStartForm(() => {});
    expect(gameTypeField(panel)?.hidden).toBe(true);
    setRatedModeEnabled(true, true);
    const field = gameTypeField(panel);
    expect(field?.hidden).toBe(false);
    [...(field?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Rated')?.click();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(postedBody(panel, fetchMock).rated).toBe(true);
  });

  // Decided 2026-11-12: rated is a choice the player makes, so with rated
  // correspondence on, a form nobody touched still posts casual.
  it('posts casual unless the player picks Rated, with rated correspondence on', () => {
    setRatedModeEnabled(true, true);
    for (const gameSpecId of ['jieqi', 'xiangqi']) {
      const panel = buildStartForm(() => {}, { gameSpecId });
      expect(gameTypeField(panel)?.hidden).toBe(false);
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      expect(postedBody(panel, fetchMock).rated).not.toBe(true);
    }
  });

  // Decided 2026-11-12: once the player picks, the form opens on their last pick.
  it('opens on the last pick, and a forced Casual on an unratable variant is not saved', () => {
    setRatedModeEnabled(true, true);
    const pick = (panel: HTMLElement, label: string) =>
      [...(gameTypeField(panel)?.querySelectorAll('button') ?? [])]
        .find((b) => b.textContent === label)
        ?.click();
    const opensOn = (panel: HTMLElement) =>
      gameTypeField(panel)?.querySelector('button.selected')?.textContent;

    pick(
      buildStartForm(() => {}, { gameSpecId: 'jieqi' }),
      'Rated',
    );
    const again = buildStartForm(() => {}, { gameSpecId: 'jieqi' });
    expect(opensOn(again)).toBe('Rated');
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(postedBody(again, fetchMock).rated).toBe(true);

    // Gomoku cannot rate: it opens on Casual, and that does not overwrite the pick.
    expect(opensOn(buildStartForm(() => {}, { gameSpecId: 'gomoku' }))).toBe('Casual');
    expect(opensOn(buildStartForm(() => {}, { gameSpecId: 'xiangqi' }))).toBe('Rated');

    pick(
      buildStartForm(() => {}, { gameSpecId: 'xiangqi' }),
      'Casual',
    );
    expect(opensOn(buildStartForm(() => {}, { gameSpecId: 'jieqi' }))).toBe('Casual');
  });

  it('offers Gomoku with Black/White sides and keeps it casual when rated correspondence is on', () => {
    setRatedModeEnabled(true, true);
    const panel = buildStartForm(() => {}, { gameSpecId: 'gomoku', rated: true });
    const picker = panel.querySelector<HTMLSelectElement>('select');
    expect([...picker!.options].some((option) => option.value === 'gomoku')).toBe(true);
    expect(picker?.value).toBe('gomoku');
    const ratedButton = [...gameTypeField(panel)!.querySelectorAll('button')].find(
      (button) => button.textContent === 'Rated',
    );
    expect(ratedButton?.disabled).toBe(true);
    expect([...panel.querySelectorAll('button')].map((button) => button.textContent)).toEqual(
      expect.arrayContaining(['Black', 'White']),
    );
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const body = postedBody(panel, fetchMock);
    expect(body).toMatchObject({ gameSpecId: 'gomoku' });
    expect(body.rated).not.toBe(true);
  });
});

describe('correspondence Start a game: prefill', () => {
  it('opens set to the terms a link carries', () => {
    const panel = buildStartForm(() => {}, {
      gameSpecId: 'xiangqi',
      daysPerMove: 7,
      preferredColor: 'second',
    });
    expect(panel.id).toBe('start');
    expect(panel.querySelector<HTMLSelectElement>('select')?.value).toBe('xiangqi');
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const body = postedBody(panel, fetchMock) as Record<string, unknown>;
    expect(body).toMatchObject({ gameSpecId: 'xiangqi', daysPerMove: 7, preferredColor: 'second' });
    vi.unstubAllGlobals();
  });
});

describe('correspondence Start a game: the Play a game layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the variant from its tile and keeps the select and the sides in step', () => {
    const panel = buildStartForm(() => {}, { gameSpecId: 'xiangqi' });
    const select = panel.querySelector<HTMLSelectElement>('select');
    const tile = (id: string) =>
      panel.querySelector<HTMLButtonElement>(`.landing-variant-card[data-game-spec="${id}"]`);
    expect(tile('xiangqi')?.classList.contains('selected')).toBe(true);
    tile('gomoku')?.click();
    expect(select?.value).toBe('gomoku');
    expect(tile('gomoku')?.getAttribute('aria-checked')).toBe('true');
    expect(tile('xiangqi')?.classList.contains('selected')).toBe(false);
    const sides = [...(setupRow(panel, 'side', 'You play')?.querySelectorAll('button') ?? [])];
    expect(sides.map((button) => button.textContent)).toEqual(['Black', 'Random', 'White']);
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(postedBody(panel, fetchMock)).toMatchObject({ gameSpecId: 'gomoku' });
  });

  it('labels the day options with a days per move hint and posts the picked days', () => {
    const panel = buildStartForm(() => {});
    const row = setupRow(panel, 'time', 'Time control');
    expect(row?.querySelector('.landing-setup-row-hint')?.textContent).toBe('days per move');
    [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '7')?.click();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    expect(postedBody(panel, fetchMock)).toMatchObject({ daysPerMove: 7 });
  });
});

describe('correspondence Start a game: opponent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers Anyone and A link only; a player is challenged from their profile', () => {
    const panel = buildStartForm(() => {});
    const field = setupRow(panel, 'opponent', 'Opponent');
    const labels = [...(field?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(['Anyone', 'A link']);
    expect(panel.textContent).not.toContain('A player');
    expect(panel.querySelector('input[type="text"]')).toBeNull();
  });

  it('posts a link seek as private with no target', () => {
    const panel = buildStartForm(() => {});
    [...panel.querySelectorAll('button')].find((b) => b.textContent === 'A link')?.click();
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const body = postedBody(panel, fetchMock) as Record<string, unknown>;
    expect(body.visibility).toBe('private');
    expect('targetHandle' in body).toBe(false);
  });
});

describe('correspondence Start a game: restricted banqi', () => {
  afterEach(() => {
    setResolvedAdmin(undefined);
    setRatedModeEnabled(false);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses each tenant room gate for picker visibility and posts only casual', () => {
    const offered = () =>
      [...buildStartForm(() => {}).querySelector('select')!.options].map((option) => option.value);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'false');
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    setResolvedAdmin(false);
    expect(offered()).not.toContain('ffq-banqi');
    // Three Kingdoms launched (casual): offered to everyone.
    expect(offered()).toContain('three-kingdoms-banqi');
    setResolvedAdmin(true);
    expect(offered()).not.toContain('ffq-banqi');
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    expect(offered()).toContain('ffq-banqi');
    setResolvedAdmin(false);
    expect(offered()).not.toContain('ffq-banqi');
    setResolvedAdmin(true);
    setRatedModeEnabled(true, true);
    for (const gameSpecId of ['ffq-banqi', 'three-kingdoms-banqi']) {
      const panel = buildStartForm(() => {}, { gameSpecId, rated: true });
      expect(panel.querySelector('select')?.value).toBe(gameSpecId);
      const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', fetchMock);
      const body = postedBody(panel, fetchMock);
      expect(body).toMatchObject({ gameSpecId });
      expect(body.rated).not.toBe(true);
    }
  });
});

// The test DOM has no browser storage; give each test an empty one.
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
