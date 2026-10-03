import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildStartForm } from './correspondence.js';
import { setRatedModeEnabled } from './rated-flag.js';

// The /correspondence Start a game form's Casual/Rated control. Rated correspondence is
// held behind the server's MISTBOARD_CORRESPONDENCE_RATED_ENABLED (off by default), so
// the control is absent until /api/server-status says otherwise.
function gameTypeField(form: HTMLElement): HTMLElement | undefined {
  return [...form.querySelectorAll<HTMLElement>('.correspondence-field')].find(
    (field) => field.querySelector('.correspondence-field-label')?.textContent === 'Game type',
  );
}

function postedBody(form: HTMLElement, fetchMock: ReturnType<typeof vi.fn>) {
  form.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { rated?: boolean };
}

describe('correspondence Start a game: Casual/Rated', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setRatedModeEnabled(false);
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
