import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as analytics from './analytics.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import { openLandingSetupDialog, setRoomNavigator } from './landing-play.js';

const seek = {
  seekId: 'waiting-seek',
  gameSpecId: 'jieqi',
  rated: false,
  timeControl: { initialMs: 300000, incrementMs: 5000 },
  waitingMs: 2000,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const prompt = () => document.querySelector<HTMLButtonElement>('.landing-seek-prompt');
const close = () => document.querySelector<HTMLButtonElement>('.landing-setup-close')?.click();

beforeEach(() => {
  const data = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
      clear: () => data.clear(),
    },
  });
});

afterEach(() => {
  close();
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setRoomNavigator(null);
});

it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
  '#1194: shows a localized casual jieqi offer with its clock (%s)',
  async (locale) => {
    vi.useFakeTimers();
    await ensureLocaleCatalog(locale);
    const tracked = vi.spyOn(analytics, 'track');
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => json({ requests: [seek] }));
    vi.stubGlobal('fetch', fetchSpy);
    openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi', locale });
    await flush();
    expect(prompt()?.hidden).toBe(false);
    const jieqi = { en: 'Jieqi', 'zh-Hans': '揭棋', 'zh-Hant': '揭棋' }[locale];
    expect(prompt()?.textContent).toBe(
      t('setup.waitingPlayer', { variant: jieqi, clock: '5+5' }, locale),
    );
    expect(prompt()?.textContent).toContain(jieqi);
    expect(prompt()?.textContent).toContain('5+5');
    expect(prompt()?.textContent).not.toMatch(/[—{}]/);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/lobby?prompt=jieqi');
    expect(tracked.mock.calls.filter(([name]) => name === 'lobby_seek_prompt_shown')).toHaveLength(
      1,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
    expect(tracked.mock.calls.filter(([name]) => name === 'lobby_seek_prompt_shown')).toHaveLength(
      1,
    );
    close();
    const count = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchSpy).toHaveBeenCalledTimes(count);
  },
);

it('#1194: hides taken and withdrawn seeks and counts each newly displayed seek', async () => {
  vi.useFakeTimers();
  const tracked = vi.spyOn(analytics, 'track');
  let requests = [seek];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ requests })),
  );
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  await flush();
  expect(prompt()?.hidden).toBe(false);
  requests = [];
  await vi.advanceTimersByTimeAsync(2000);
  expect(prompt()?.hidden).toBe(true);
  requests = [{ ...seek, seekId: 'new-seek' }];
  await vi.advanceTimersByTimeAsync(2000);
  expect(prompt()?.hidden).toBe(false);
  expect(tracked.mock.calls.filter(([name]) => name === 'lobby_seek_prompt_shown')).toHaveLength(2);
});

it('#1194: one tap accepts through the lobby with the offered casual clock', async () => {
  vi.useFakeTimers();
  const tracked = vi.spyOn(analytics, 'track');
  const navigate = vi.fn();
  setRoomNavigator(navigate);
  const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? json({ status: 'matched', ticketId: 'joined', url: '/room/jq_paired' }, 201)
      : json({ requests: [seek] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  await flush();
  prompt()?.click();
  await flush();
  const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/lobby');
  expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
    gameSpecId: 'jieqi',
    rated: false,
    timeControl: seek.timeControl,
  });
  expect(navigate).toHaveBeenCalledWith('/room/jq_paired');
  expect(tracked).toHaveBeenCalledWith(
    'lobby_seek_prompt_accepted',
    expect.objectContaining({ gameSpecId: 'jieqi', surface: 'bot-setup', ...seek.timeControl }),
  );
});

it('#1194: the English line reads as the wanted copy', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({ requests: [{ ...seek, timeControl: { initialMs: 600000, incrementMs: 5000 } }] }),
    ),
  );
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  await flush();
  expect(prompt()?.textContent).toBe('A player is waiting for Jieqi, 10+5. Play them');
});

it('#1194: xiangqi bot setup offers a casual xiangqi seek and joins it in one tap', async () => {
  vi.useFakeTimers();
  const tracked = vi.spyOn(analytics, 'track');
  const navigate = vi.fn();
  setRoomNavigator(navigate);
  const xiangqiSeek = { ...seek, seekId: 'xq-seek', gameSpecId: 'xiangqi' };
  const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? json({ status: 'matched', ticketId: 'joined', url: '/room/xq_paired' }, 201)
      : json({ requests: [xiangqiSeek] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'xiangqi' });
  await flush();
  expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/lobby?prompt=xiangqi');
  expect(prompt()?.textContent).toBe('A player is waiting for Xiangqi, 5+5. Play them');
  expect(tracked).toHaveBeenCalledWith(
    'lobby_seek_prompt_shown',
    expect.objectContaining({ gameSpecId: 'xiangqi', seekId: 'xq-seek' }),
  );
  prompt()?.click();
  await flush();
  const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
    gameSpecId: 'xiangqi',
    rated: false,
    timeControl: seek.timeControl,
  });
  expect(navigate).toHaveBeenCalledWith('/room/xq_paired');
  expect(tracked).toHaveBeenCalledWith(
    'lobby_seek_prompt_accepted',
    expect.objectContaining({ gameSpecId: 'xiangqi' }),
  );
});

it('#1194: a variant outside the list never asks the server for a prompt', async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
    json({ requests: [{ ...seek, gameSpecId: 'banqi' }] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'banqi' });
  await flush();
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('prompt='))).toBe(false);
  expect(prompt()?.hidden ?? true).toBe(true);
});

it('#1194: a stale offer returns to bot setup without waiting in an invisible seek', async () => {
  vi.useFakeTimers();
  const tracked = vi.spyOn(analytics, 'track');
  const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? json({ status: 'waiting', ticketId: 'stale-join' }, 202)
      : json({ requests: [seek] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  await flush();
  prompt()?.click();
  await flush();
  expect(
    fetchSpy.mock.calls.some(
      ([url, init]) => url === '/api/lobby/stale-join?how=offer_taken' && init?.method === 'DELETE',
    ),
  ).toBe(true);
  expect(prompt()?.hidden).toBe(true);
  expect(prompt()?.hasAttribute('aria-busy')).toBe(false);
  // The setup says the offer went, not "Waiting for an opponent".
  expect(document.querySelector('.landing-setup-dialog')?.textContent).toContain(
    'Offer just taken, try another',
  );
  expect(document.querySelector<HTMLButtonElement>('.landing-setup-start')?.disabled).toBe(false);
  expect(tracked.mock.calls.filter(([name]) => name === 'lobby_seek_prompt_accepted')).toHaveLength(
    0,
  );
});

it('#1194: rated and other-variant seeks never appear in bot setup', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        requests: [
          { ...seek, rated: true },
          { ...seek, gameSpecId: 'xiangqi', rated: true },
          { ...seek, gameSpecId: 'banqi' },
        ],
      }),
    ),
  );
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  await flush();
  expect(prompt()?.hidden).toBe(true);
  close();
  // Xiangqi setup: the rated xiangqi seek and the casual banqi one stay out.
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'xiangqi' });
  await flush();
  expect(prompt()?.hidden ?? true).toBe(true);
});

it('#1194: ignoring the prompt preserves bot choices and starts the bot', async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  setRoomNavigator(navigate);
  const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'POST' ? json({ url: '/room/jq_bot' }, 201) : json({ requests: [seek] }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi', initialTimePresetId: '3m2' });
  expect(document.querySelector('.landing-time-presets .selected')?.textContent).toBe('3 + 2');
  await flush();
  expect(prompt()?.hidden).toBe(false);
  expect(document.querySelector('.landing-time-presets .selected')?.textContent).toBe('3 + 2');
  document.querySelector<HTMLButtonElement>('.landing-setup-start')?.click();
  await flush();
  const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toBe('/api/rooms');
  expect(JSON.parse(post?.[1]?.body as string)).toMatchObject({
    gameSpecId: 'jieqi',
    mode: 'pve',
    timeControl: { initialMs: 180000, incrementMs: 2000 },
  });
  expect(navigate).toHaveBeenCalledWith('/room/jq_bot');
  // Starting closes the setup dialog, so the prompt is hidden or gone.
  expect(prompt()?.hidden ?? true).toBe(true);
});

it('#1194: switching away from jieqi discards an in-flight prompt response', async () => {
  vi.useFakeTimers();
  let respond!: (response: Response) => void;
  const fetchSpy = vi.fn(
    (_url: string, _init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        respond ??= resolve;
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  openLandingSetupDialog({ mode: 'pve', initialGameSpecId: 'jieqi' });
  document
    .querySelector<HTMLButtonElement>('.landing-variant-card[data-game-spec="xiangqi"]')
    ?.click();
  respond(json({ requests: [seek] }));
  await flush();
  expect(prompt()?.hidden).toBe(true);
  // The jieqi answer is dropped; from here the dialog asks for xiangqi only.
  expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
    '/api/lobby?prompt=jieqi',
    '/api/lobby?prompt=xiangqi',
  ]);
});
