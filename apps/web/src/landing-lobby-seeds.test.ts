import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLobbyPanel } from './landing-play.js';

// The Lobby tab carries a compact table of rotating bot "seeks" (always-available
// computer opponents) so the hooks surface is never empty at zero human
// liquidity. These are client-derived launchers, not server seeks: the pool is
// deterministic per six-hour UTC bucket, one click creates the PvE room directly, and the
// invariants worth pinning are honesty (labeled engine), separation from the
// human seek table, and the bucket-stable rotation.

// Six-hour bucket 82622: lineup C. The bucket still picks WHICH variants show;
// the Xiangqi ladder itself is fixed (Levels 2/5/8) and no longer rotates.
const FIXED_DATE = new Date('2026-07-21T12:00:00Z');

describe('landing lobby bot seeks', () => {
  // Every test gets its own device memory. On CI window.localStorage is a
  // working store, so a one-click row start in one test would otherwise leak
  // the remembered engine into the next test's "fresh device" (#365).
  let restoreDeviceStorage: () => void = () => {};

  beforeEach(() => {
    restoreDeviceStorage = installMemoryStorage();
    // Freeze only Date so the six-hour rotation is fixed; timers stay real for the
    // async fetch flushes below.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    restoreDeviceStorage();
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('renders seven distinct variants, opening with the ascending xiangqi ladder', () => {
    const panel = buildLobbyPanel('en', { hydrate: false });
    const seeds = [...panel.querySelectorAll<HTMLElement>('.landing-lobby-seed')];
    expect(seeds).toHaveLength(9);

    const signature = seeds.map((seed) => `${seed.dataset.botId}|${seed.dataset.gameSpec}`);
    expect(signature).toEqual([
      'fairy-stockfish-level-2|xiangqi',
      'fairy-stockfish-level-5|xiangqi',
      'fairy-stockfish-level-8|xiangqi',
      'misty|banqi',
      'fairy-stockfish-level-4|duck-xiangqi',
      'misty|dark-xiangqi',
      'misty|dark-chess',
      'misty|jungle',
      'misty|jungle-flip',
    ]);
    expect(new Set(signature).size).toBe(9);
    expect(new Set(seeds.map((seed) => seed.dataset.gameSpec)).size).toBe(7);
    // Three paces show here, for three different reasons, in the row order
    // asserted above:
    //   xiangqi x3 at 10+5 — a deliberate variant, whose own default is slower
    //     because guests could not finish a full-board game at 3+2;
    //   duck at 5+5 — its own default too, for the same reason (~177 plies);
    //   fog xiangqi and fog chess at 5+5 — an engine PIN, not a preference:
    //     Misty's per-move floor outruns a 2s increment and it loses on time
    //     (#283);
    //   banqi, jungle, jungle-flip at 3+2 — the house pace, and their guests
    //     essentially never flag at it.
    expect(
      seeds.map((seed) => seed.querySelector('.landing-lobby-seed-time')?.textContent),
    ).toEqual(['10+5', '10+5', '10+5', '3+2', '5+5', '5+5', '5+5', '3+2', '3+2']);
  });

  it('labels each seed as an engine game rather than a human seek', () => {
    const panel = buildLobbyPanel('en', { hydrate: false });
    const seeds = [...panel.querySelectorAll<HTMLElement>('.landing-lobby-seed')];
    expect(seeds.length).toBeGreaterThan(0);
    for (const seed of seeds) {
      expect(seed.getAttribute('aria-label')?.startsWith('Play a bot')).toBe(true);
      const opponent = seed.querySelector('.landing-lobby-seed-opponent');
      // A bot icon plus a non-empty engine name is the honesty signal.
      expect(opponent?.querySelector('.landing-lobby-seed-boticon')).not.toBeNull();
      expect((opponent?.textContent ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('tags every bot row as a bot and keeps it out of the human seek block', () => {
    const panel = buildLobbyPanel('en', { hydrate: false });
    const seedsBlock = panel.querySelector('.landing-lobby-seeds');
    expect(seedsBlock).not.toBeNull();
    expect(panel.querySelector('.landing-lobby-thead')).not.toBeNull();
    // Seeds are their own row grammar; they must not masquerade as
    // .landing-lobby-trow human seek rows (which carry the join action).
    expect(seedsBlock?.querySelector('.landing-lobby-trow')).toBeNull();
    // Bots and humans share one list, so the honesty signal is per-row: an
    // explicit Bot tag on every seed, never a section heading above them.
    expect(panel.querySelector('.landing-lobby-seeds-divider')).toBeNull();
    for (const seed of seedsBlock?.querySelectorAll('.landing-lobby-seed') ?? []) {
      expect(seed.querySelector('.landing-lobby-kind')?.textContent).toBe('Bot');
    }
  });

  it('creates and joins the bot game on a single row click', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/bot_seek' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en', { hydrate: false });
    document.body.append(panel);

    const row = panel.querySelector<HTMLButtonElement>(
      '.landing-lobby-seed[data-bot-id="misty"][data-game-spec="dark-chess"]',
    );
    expect(row).not.toBeNull();
    row!.click();
    await flushPromises();

    const call = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/rooms' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({
      mode: 'pve',
      botId: 'misty',
      gameSpecId: 'dark-chess',
      // Pinned pace, not the house 3+2 (#283) — and the row's label matches, so
      // the click starts the clock it advertised.
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      preferredColor: 'random',
      rated: false,
    });
    expect(window.location.pathname).toBe('/room/bot_seek');
  });

  it('starts the picked ladder rung, not just the canonical one', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/xiangqi/room/fsf_8' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en', { hydrate: false });
    document.body.append(panel);

    const row = panel.querySelector<HTMLButtonElement>(
      '.landing-lobby-seed[data-bot-id="fairy-stockfish-level-8"][data-game-spec="xiangqi"]',
    );
    expect(row?.getAttribute('aria-label')).toContain('Fairy-Stockfish Level 8');
    row!.click();
    await flushPromises();

    const call = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/rooms' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({
      mode: 'pve',
      botId: 'fairy-stockfish-level-8',
      gameSpecId: 'xiangqi',
    });
    expect(window.location.pathname).toBe('/xiangqi/room/fsf_8');
  });

  it('fills rating cells from the /api/bots roster', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/bots') {
        return jsonResponse({
          bots: [
            {
              id: 'misty',
              displayName: 'Misty',
              ratings: [
                {
                  gameSpecId: 'dark-chess',
                  timeClass: 'blitz',
                  rating: 1874.4,
                  provisional: false,
                },
              ],
            },
            {
              id: 'fairy-stockfish-level-5',
              displayName: 'Fairy-Stockfish Level 5',
              // No blitz entry for the 3+2 xiangqi seed: falls back to the
              // variant's only rating, keeping the provisional '?' suffix.
              ratings: [
                { gameSpecId: 'xiangqi', timeClass: 'rapid', rating: 2450, provisional: true },
              ],
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en');
    document.body.append(panel);
    await flushPromises();

    const misty = panel.querySelector(
      '.landing-lobby-seed[data-bot-id="misty"][data-game-spec="dark-chess"] .landing-lobby-seed-rating',
    );
    // The pool number never renders as text (#373): it reads as a player
    // rating and is not one. It rides the tooltip, labelled with its scale.
    expect(misty?.textContent).toBe('—');
    expect(misty?.getAttribute('data-pool-rating')).toBe('1874');
    expect(misty?.getAttribute('title')).toContain('1874');
    expect(misty?.getAttribute('title')).toContain('Not a player rating');
    const xiangqi = panel.querySelector(
      '.landing-lobby-seed[data-bot-id="fairy-stockfish-level-5"][data-game-spec="xiangqi"] .landing-lobby-seed-rating',
    );
    expect(xiangqi?.textContent).toBe('—');
    expect(xiangqi?.getAttribute('data-pool-rating')).toBe('2450?');
    // Unmatched bots keep the placeholder rather than guessing a number.
    const banqi = panel.querySelector(
      '.landing-lobby-seed[data-bot-id="misty"][data-game-spec="banqi"] .landing-lobby-seed-rating',
    );
    expect(banqi?.textContent).toBe('—');
    expect(banqi?.getAttribute('title')).toBeNull();
  });

  it('lists human seeks above the bots in one table with the same column grammar', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/lobby') {
        return jsonResponse({
          requests: [
            {
              id: 'seek_1',
              gameSpecId: 'xiangqi',
              rated: false,
              timeControl: { initialMs: 180_000, incrementMs: 2_000 },
              waitingMs: 4_000,
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en');
    document.body.append(panel);
    await flushPromises();

    // The header is the panel's first child: one header for the whole table,
    // never a second one wedged between the bot and human blocks.
    const lobbyTab = panel.querySelector('.landing-lobby-tabpanel');
    expect(lobbyTab?.firstElementChild?.classList.contains('landing-lobby-thead')).toBe(true);
    // Scoped to this tab: the correspondence tab carries its own four-column
    // header, so a whole-panel count would no longer measure this claim.
    expect(lobbyTab?.querySelectorAll('.landing-lobby-thead').length).toBe(1);

    // Rows on both sides of the Players divider carry the same five cells, so
    // the rating/time/mode columns line up down the panel.
    const seedCells = panel.querySelector('.landing-lobby-seed')?.children.length;
    const row = panel.querySelector<HTMLButtonElement>('.landing-lobby-trow');
    expect(row?.children.length).toBe(seedCells);
    // The whole row is the join control (no per-row Join button).
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.querySelector('.landing-lobby-join')).toBeNull();
    expect(row?.querySelector('.landing-lobby-seed-variant')?.textContent).toBe('Xiangqi');
    expect(row?.querySelector('.landing-lobby-seed-time')?.textContent).toBe('3+2');
    expect(row?.querySelector('.landing-lobby-td-mode')?.textContent).toBe('Casual');
    // Human seeks are tagged as such and sit ABOVE the bot block in the DOM.
    expect(row?.querySelector('.landing-lobby-kind')?.textContent).toBe('Human');
    const blocks = [...(lobbyTab?.children ?? [])].map((child) => child.className);
    expect(blocks).toEqual(['landing-lobby-thead', 'landing-lobby-tbody', 'landing-lobby-seeds']);
  });

  it('starts the pairing straight from a quick-pairing chip, with no setup dialog', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/lobby') return jsonResponse({ ticketId: 'ticket_1' });
      return jsonResponse({ requests: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en', { hydrate: false });
    document.body.append(panel);

    const chip = panel.querySelector<HTMLButtonElement>(
      '.landing-quickpair-row[data-game-spec="xiangqi"] .landing-quickpair-chip[data-time-control="3m2"]',
    );
    expect(chip).not.toBeNull();
    chip!.click();
    await flushPromises();

    // The click posts the seek itself: no modal, and the chip shows it is live.
    expect(document.querySelector('.landing-setup-overlay')).toBeNull();
    const post = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/lobby' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(post).toBeDefined();
    expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
      gameSpecId: 'xiangqi',
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    });
    expect(chip?.classList.contains('is-waiting')).toBe(true);
    // The visible chip label never changes (the waiting text goes to the hidden
    // live label), so the pool row cannot reflow mid-wait.
    expect(chip?.querySelector('.landing-quickpair-chip-text')?.textContent).toBe('3+2');
  });

  it('promotes the whole product catalog in the quick-pair table, in canonical order', () => {
    const panel = buildLobbyPanel('en', { hydrate: false });
    const specs = [
      ...panel.querySelectorAll<HTMLElement>('.landing-quickpair-row[data-game-spec]'),
    ].map((row) => row.dataset.gameSpec);

    expect(specs).toEqual([
      'xiangqi',
      'banqi',
      'jieqi',
      'fortress-xiangqi',
      'duck-xiangqi',
      'dark-xiangqi',
      'dark-chess',
      'jungle',
      'jungle-flip',
    ]);
  });

  it('uses the same pinned bot and default pace in Quick Pairing', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/quick_bot' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en', { hydrate: false });
    document.body.append(panel);

    const chip = panel.querySelector<HTMLButtonElement>(
      '.landing-quickpair-row[data-game-spec="xiangqi"] .landing-quickpair-bot',
    );
    // A fresh device (no remembered xiangqi engine) starts at the bottom rung.
    expect(chip?.dataset.botId).toBe('fairy-stockfish-level-2');
    chip!.click();
    await flushPromises();

    const post = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input) === '/api/rooms' && (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(String((post![1] as RequestInit).body))).toMatchObject({
      botId: 'fairy-stockfish-level-2',
      gameSpecId: 'xiangqi',
      // 10+5, xiangqi's own default: the chip advertises it, and the room the
      // click creates has to actually start there. This is the end of the
      // chain the guest-timeout fix depends on.
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    });
  });

  it('starts a returning device at the xiangqi level it last chose, and records one-click starts', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/quick_bot' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const restoreStorage = installMemoryStorage();
    window.localStorage.setItem(
      'mistboard:setup:pve',
      JSON.stringify({ engineIdByGameSpec: { xiangqi: 'fairy-stockfish-level-8' } }),
    );
    try {
      const panel = buildLobbyPanel('en', { hydrate: false });
      document.body.append(panel);
      const chip = panel.querySelector<HTMLButtonElement>(
        '.landing-quickpair-row[data-game-spec="xiangqi"] .landing-quickpair-bot',
      );
      expect(chip?.dataset.botId).toBe('fairy-stockfish-level-8');

      // A one-click Lobby row start records its engine, so the memory follows
      // the player's actual last game rather than only the setup dialog.
      const row = panel.querySelector<HTMLButtonElement>(
        '.landing-lobby-seed[data-bot-id="fairy-stockfish-level-5"][data-game-spec="xiangqi"]',
      );
      row!.click();
      await flushPromises();
      const stored = JSON.parse(window.localStorage.getItem('mistboard:setup:pve') ?? '{}');
      expect(stored.engineIdByGameSpec.xiangqi).toBe('fairy-stockfish-level-5');
    } finally {
      restoreStorage();
    }
  });

  it('opens the correspondence CTA on days-per-move, not real-time clocks', () => {
    vi.stubEnv('VITE_CORRESPONDENCE_ENABLED', 'true');
    const panel = buildLobbyPanel('en', { hydrate: false });
    document.body.append(panel);

    const create = panel.querySelector<HTMLButtonElement>('.landing-lobby-create');
    expect(create).not.toBeNull();
    create!.click();

    const overlay = document.querySelector('.landing-setup-overlay');
    expect(overlay).not.toBeNull();
    // The Correspondence segment is live and a day option is pre-picked; the
    // real-time preset chips are hidden. Before the eligibility fix this opened
    // on whatever variant was stored, where correspondence is never offered.
    const corrGroup = overlay?.querySelector('.landing-correspondence-presets');
    expect((corrGroup as HTMLElement | null)?.hidden).toBe(false);
    expect(corrGroup?.querySelector('.selected')).not.toBeNull();
    const presets = overlay?.querySelector(
      '.landing-time-presets:not(.landing-correspondence-presets)',
    );
    expect((presets as HTMLElement | null)?.hidden).toBe(true);

    overlay?.remove();
  });

  it('badges a quick-pair chip with the players already waiting in that pool', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/lobby') {
        return jsonResponse({
          requests: [
            // Two in the xiangqi 3+2 pool...
            {
              gameSpecId: 'xiangqi',
              rated: false,
              hiddenDraft960: false,
              timeControl: { initialMs: 180_000, incrementMs: 2_000 },
              waitingMs: 4_000,
            },
            {
              gameSpecId: 'xiangqi',
              rated: false,
              hiddenDraft960: false,
              timeControl: { initialMs: 180_000, incrementMs: 2_000 },
              waitingMs: 9_000,
            },
            // ...and one rated seek at the same variant + clock, which is a
            // different pool: these chips post casual.
            {
              gameSpecId: 'xiangqi',
              rated: true,
              hiddenDraft960: false,
              timeControl: { initialMs: 180_000, incrementMs: 2_000 },
              waitingMs: 2_000,
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en');
    document.body.append(panel);
    await flushPromises();

    const row = '.landing-quickpair-row[data-game-spec="xiangqi"] ';
    const hot = panel.querySelector<HTMLButtonElement>(`${row}[data-time-control="3m2"]`);
    expect(hot?.querySelector('.landing-quickpair-waiting')?.textContent).toBe('2');
    expect(hot?.classList.contains('has-waiting')).toBe(true);
    expect(hot?.getAttribute('aria-label')).toBe('Xiangqi 3+2, 2 waiting');

    // A pool nobody is in stays cold, badge hidden rather than badged "0".
    const cold = panel.querySelector<HTMLButtonElement>(`${row}[data-time-control="5m5"]`);
    const coldBadge = cold?.querySelector<HTMLElement>('.landing-quickpair-waiting');
    expect(coldBadge?.hidden).toBe(true);
    expect(cold?.classList.contains('has-waiting')).toBe(false);
  });

  it('shows the coming-soon line only when the server says correspondence is off', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/correspondence/seeks') {
        return jsonResponse({ error: 'correspondence_disabled' }, { status: 404 });
      }
      return jsonResponse({ requests: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en');
    document.body.append(panel);
    await flushPromises();

    const corrPanel = [...panel.querySelectorAll('.landing-lobby-tabpanel')][2];
    expect(corrPanel?.textContent).toContain('Correspondence play is coming soon.');
    // No CTA that would 404 against a gated server.
    expect(corrPanel?.querySelector('.landing-lobby-create')).toBeNull();
    expect(corrPanel?.querySelector<HTMLElement>('.landing-lobby-thead-corr')?.hidden).toBe(true);
  });

  it('keeps the create CTA available once the seek board has rows', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/correspondence/seeks') {
        return jsonResponse({
          seeks: [
            {
              id: 'seek_1',
              gameSpecId: 'xiangqi',
              daysPerMove: 3,
              creatorName: 'someone',
              isMine: false,
            },
          ],
        });
      }
      return jsonResponse({ requests: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLobbyPanel('en');
    document.body.append(panel);
    await flushPromises();

    const corrPanel = [...panel.querySelectorAll('.landing-lobby-tabpanel')][2];
    expect(corrPanel?.querySelectorAll('.landing-lobby-trow-corr').length).toBe(1);
    // The header labels the rows it now has, and posting your own game does not
    // require the board to be empty.
    expect(corrPanel?.querySelector<HTMLElement>('.landing-lobby-thead-corr')?.hidden).toBe(false);
    expect(
      corrPanel?.querySelector('.landing-lobby-corr-footer .landing-lobby-create'),
    ).not.toBeNull();
  });

  it('renders the same seed list for two builds in the same bucket', () => {
    const signature = (panel: HTMLElement): string[] =>
      [...panel.querySelectorAll<HTMLElement>('.landing-lobby-seed')].map(
        (seed) => `${seed.dataset.botId}|${seed.dataset.gameSpec}|${seed.dataset.timeClass}`,
      );
    const first = signature(buildLobbyPanel('en', { hydrate: false }));
    const second = signature(buildLobbyPanel('en', { hydrate: false }));
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});

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

// happy-dom's window carries no usable localStorage under vitest (Node's own
// experimental global shadows it), so the memory test installs a minimal
// in-memory Storage, the way puzzles/storage.test.ts does.
function installMemoryStorage(): () => void {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return () => {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else delete (window as { localStorage?: unknown }).localStorage;
  };
}
