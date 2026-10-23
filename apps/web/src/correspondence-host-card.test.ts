import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildHostCard,
  buildHostLauncher,
  fetchHostInfo,
  type HostInfo,
} from './correspondence.js';

// The /correspondence "Play the host" card (2026-10-23): one button that starts a
// casual game against the site owner, from GET/POST /api/correspondence/host.
function info(overrides: Partial<HostInfo> = {}): HostInfo {
  return {
    host: { handle: 'brianhliou-dev', displayName: 'Brian' },
    daysPerMove: 2,
    gameSpecIds: ['xiangqi', 'jieqi'],
    limits: { perPlayer: 2, total: 15 },
    signedIn: true,
    isHost: false,
    canPlay: true,
    reason: null,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('correspondence host card', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the host and the terms', () => {
    const card = buildHostCard(info());
    expect(card.querySelector('h2')?.textContent).toBe('Play Brian H. Liou, who builds Mistboard');
    expect(card.textContent).toContain('2 days per move');
    expect(card.querySelector('button[type="submit"]')?.textContent).toBe('Play Brian H. Liou');
  });

  it('offers only the variants the server says the host plays', () => {
    const card = buildHostCard(info({ gameSpecIds: ['jieqi', 'not-a-variant'] }));
    const options = [...card.querySelectorAll('option')].map((option) => option.value);
    expect(options).toEqual(['jieqi']);
    // A single variant needs no picker.
    expect(card.querySelector('select')?.closest('label')?.hidden).toBe(true);
  });

  it('posts the variant and side, then opens the game', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { roomId: 'r1', url: '/xiangqi/r1', rated: false }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const navigate = vi.fn();
    const card = buildHostCard(info(), { navigate });
    [...card.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
      .find((button) => button.dataset.value === 'second')
      ?.click();
    card.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/correspondence/host');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ gameSpecId: 'xiangqi', side: 'second' });
    expect(navigate).toHaveBeenCalledWith('/xiangqi/r1');
  });

  it('says why when the player is at the per-player cap, and keeps the button off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(409, { error: 'player_limit_reached', limit: 2 })),
    );
    const card = buildHostCard(info());
    card.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    const status = card.querySelector<HTMLElement>('.correspondence-form-status');
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe(
      'You already have 2 games going with Brian H. Liou. Finish one to start another.',
    );
    expect(card.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('opens already refused when GET says the host is full', () => {
    const card = buildHostCard(info({ canPlay: false, reason: 'host_full' }));
    expect(card.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(card.querySelector('.correspondence-form-status')?.textContent).toBe(
      'Brian H. Liou has 15 games going, the most at once. Try again in a few days.',
    );
  });

  it('signed out, the card is the offer and a sign-in link, no form', () => {
    const card = buildHostCard(info({ signedIn: false }));
    expect(card.querySelector('form')).toBeNull();
    const link = card.querySelector<HTMLAnchorElement>('a.correspondence-host-signin');
    expect(link?.textContent).toBe('Sign in to play');
    expect(link?.getAttribute('href')).toContain('/account');
  });

  it('the host sees a note, not a button', () => {
    const card = buildHostCard(info({ isHost: true, canPlay: false }));
    expect(card.querySelector('form')).toBeNull();
    expect(card.textContent).toContain('This is you.');
  });

  it('is absent while the server answers 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(404, { error: 'host_disabled' })),
    );
    expect(await fetchHostInfo()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await fetchHostInfo()).toBeNull();
  });
});

// The signed-in page shows the offer as a tile; its form opens in a dialog
// (2026-10-23: the two full-width forms filled the first screen).
describe('correspondence host tile', () => {
  it('names the host by full name and opens the form in a dialog', () => {
    const { tile } = buildHostLauncher(info());
    expect(tile.querySelector('h2')?.textContent).toBe('Play Brian H. Liou');
    expect(tile.querySelector('img.correspondence-host-photo')).not.toBeNull();
    const dialog = tile.querySelector('dialog');
    expect(dialog?.open).toBe(false);
    tile.querySelector<HTMLButtonElement>(':scope > .correspondence-btn')?.click();
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('form')).not.toBeNull();
  });

  it('says why on the tile, button off, when the host is full', () => {
    const { tile } = buildHostLauncher(info({ canPlay: false, reason: 'host_full' }));
    expect(tile.querySelector<HTMLButtonElement>(':scope > .correspondence-btn')?.disabled).toBe(
      true,
    );
    expect(tile.querySelector('.correspondence-launcher-text')?.textContent).toContain(
      'Brian H. Liou has 15 games going',
    );
  });

  it('tells the host it is them, button off', () => {
    const { tile } = buildHostLauncher(info({ isHost: true, canPlay: false }));
    expect(tile.querySelector<HTMLButtonElement>(':scope > .correspondence-btn')?.disabled).toBe(
      true,
    );
    expect(tile.textContent).toContain('This is you.');
  });
});
