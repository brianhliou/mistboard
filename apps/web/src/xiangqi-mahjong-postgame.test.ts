import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  type XmjTile,
  xmjBotAction,
  xmjOrderedTiles,
  xmjPendingAction,
  xmjReviewViewFor,
  xmjViewFor,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantLiveClientConfig, TenantLiveFrame } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';
import {
  type XmjPostgameResponse,
  xmjInitialPly,
  xmjPostgameClockAt,
  xmjPostgameLastPly,
  xmjRecordingFrame,
} from './xiangqi-mahjong-postgame.js';

const liveHarness = vi.hoisted(() => ({
  config: null as unknown,
  options: null as unknown,
  sent: [] as unknown[],
}));
vi.mock('./variant-tenant/live-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variant-tenant/live-client.js')>();
  return {
    ...actual,
    createTenantLiveClient: ((config: Parameters<typeof actual.createTenantLiveClient>[0]) => {
      liveHarness.config = config;
      return actual.createTenantLiveClient({
        ...config,
        socketFactory: (options: TenantSocketClientOptions) => {
          liveHarness.options = options;
          return {
            connect: () => {},
            close: () => {},
            reconnectNow: () => {},
            send: (payload: unknown) => {
              liveHarness.sent.push(payload);
              return true;
            },
            startPing: () => {},
            connection: () => 'connected',
            noticeTier: () => 'none',
            closeReason: () => '',
            clientId: () => 'xmj-test',
            latencyMs: () => null,
            reconnectAttempt: () => 0,
          };
        },
      });
    }) as typeof actual.createTenantLiveClient,
  };
});

function declarationStart(draw: XmjTile = 'rP'): XmjRoomState {
  const tiles: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'bR', 'bP', draw];
  const rest = xmjOrderedTiles();
  for (const tile of tiles) rest.splice(rest.indexOf(tile), 1);
  const wall = [...tiles, ...rest];
  return createXmjRoomState(
    { walls: [wall, wall], firstDealer: 'east', taiTable: 3 },
    'xmj_review',
  );
}

const DECLARATION_MOVES: XmjMove[] = [
  { by: 'east', at: 1000, action: 'declare-ready', tile: 'bH' },
  { by: 'west', at: 3000, action: 'pass' },
  { by: 'west', at: 4000, action: 'discard', tile: 'bR' },
  { by: 'east', at: 6000, action: 'pass' },
  { by: 'east', at: 7000, action: 'self-draw' },
  { by: 'east', at: 8000, action: 'next-hand' },
  { by: 'west', at: 9000, action: 'next-hand' },
];

// The review page is the live room (live-xiangqi-mahjong.ts) played back from
// the finished-only route's per-ply views. These tests drive the real room.

function seeded(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

function botMove(state: XmjRoomState): XmjMove {
  for (const seat of ['east', 'west'] as const) {
    const action = xmjBotAction(xmjViewFor(state, seat), seat);
    if (action) return { ...action, by: seat, at: 0 };
  }
  const pending = xmjPendingAction(state);
  if (pending) return pending.move;
  throw new Error('nobody can act');
}

/** A whole bot match in the server's payload shape (routes/xiangqi-mahjong-games.ts). */
function postgameFixture(): XmjPostgameResponse {
  let state = createXmjRoomState(createXmjSetup(seeded(7)), 'xmj_review');
  const history = [{ ply: 0, view: xmjReviewViewFor(state) }];
  const timeline: XmjPostgameResponse['timeline'] = [];
  for (let ply = 1; state.status.type === 'playing'; ply += 1) {
    if (ply > 5000) throw new Error('the match did not end');
    const move = botMove(state);
    state = applyXmjMove(state, move);
    timeline.push({ type: 'move-played', at: ply, color: move.by, move, ply });
    history.push({ ply, view: xmjReviewViewFor(state) });
  }
  return {
    game: {
      roomId: 'xmj_review',
      variant: XIANGQI_MAHJONG_SPEC_ID,
      mode: 'pvp',
      result: 'east-wins',
      termination: 'points',
      plyCount: timeline.length,
      startedAt: '2026-10-16T00:00:00.000Z',
      endedAt: '2026-10-16T00:10:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: null,
      incrementMs: null,
      players: [
        { color: 'east', name: 'alice', rating: null, kind: 'account' },
        { color: 'west', name: 'Guest', rating: null, kind: 'guest' },
      ],
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    timeline,
    view: xmjReviewViewFor(state),
    history,
  };
}

const FIXTURE = postgameFixture();
const LAST = xmjPostgameLastPly(FIXTURE);

function declarationFixture(): XmjPostgameResponse {
  let state = declarationStart();
  const history = [{ ply: 0, view: xmjReviewViewFor(state) }];
  const timeline: XmjPostgameResponse['timeline'] = [];
  for (let ply = 1; state.status.type === 'playing'; ply += 1) {
    if (ply > 5000) throw new Error('declaration match did not end');
    const move = DECLARATION_MOVES[ply - 1] ?? botMove(state);
    const after = applyXmjMove(state, move);
    if (after === state) throw new Error(`illegal fixture move ${JSON.stringify(move)}`);
    state = after;
    timeline.push({ type: 'move-played', at: move.at, color: move.by, move, ply });
    history.push({ ply, view: xmjReviewViewFor(state) });
  }
  return {
    ...FIXTURE,
    game: { ...FIXTURE.game, plyCount: timeline.length },
    state: { status: state.status, moveNumber: state.moveNumber },
    timeline,
    history,
    view: xmjReviewViewFor(state),
  };
}

const TIMED: XmjPostgameResponse = {
  ...FIXTURE,
  state: { ...FIXTURE.state, timeControl: { initialMs: 600_000, incrementMs: 0 } },
  // East loses a second a ply, west two.
  history: FIXTURE.history.map((snapshot) => ({
    ...snapshot,
    clock: {
      remainingMs: { east: 600_000 - snapshot.ply * 1000, west: 600_000 - snapshot.ply * 2000 },
      active: snapshot.ply % 2 === 0 ? 'east' : 'west',
    },
  })),
};

describe('Xiangqi Mahjong review helpers', () => {
  it('opens at ?ply= clamped to the match, and keeps the clock at or before a ply', () => {
    expect(xmjInitialPly('?ply=3', LAST)).toBe(3);
    expect(xmjInitialPly(`?ply=${LAST + 50}`, LAST)).toBe(LAST);
    expect(xmjInitialPly('?ply=-1', LAST)).toBe(LAST);
    expect(xmjInitialPly('', LAST)).toBe(LAST);
    expect(xmjPostgameClockAt(TIMED, 3)?.remainingMs).toEqual({ east: 597_000, west: 594_000 });
    expect(xmjPostgameClockAt(FIXTURE, 3)).toBeNull();
  });

  it('turns the match into the hello a spectator of the finished room gets', () => {
    const frame = xmjRecordingFrame(TIMED);
    expect(frame.seat).toBe('spectator');
    expect(frame.state).toBe(TIMED.view);
    // A nameless guest is left to the room's own guest word.
    expect(frame.seatDisplayNames).toEqual({ east: 'alice' });
    expect(frame.timeControl).toEqual({ initialMs: 600_000, incrementMs: 0 });
    expect(frame.events).toHaveLength(LAST);
    expect(frame.liveHistory).toHaveLength(LAST + 1);
    expect(xmjRecordingFrame(FIXTURE).timeControl).toBeNull();
  });
});

describe('Xiangqi Mahjong review page', () => {
  const capture = vi.fn();

  beforeEach(() => {
    capture.mockClear();
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  /** Mounts the page as the router does, on a fresh room module. */
  async function mount(postgame: unknown, status = 200): Promise<HTMLDivElement> {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/xiangqi-mahjong/games/')
        ? jsonResponse(postgame, status)
        : jsonResponse({ error: 'not_found' }, 404),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);
    // The room client is a module singleton with document-level key handlers:
    // a fresh module per test keeps one test's keys from stepping another's.
    vi.resetModules();
    const { setPostHogInstance } = await import('./analytics.js');
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
    const { mountXiangqiMahjongPostgame } = await import('./xiangqi-mahjong-postgame.js');
    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();
    expect(fetchSpy).toHaveBeenCalledWith('/api/xiangqi-mahjong/games/xmj_review');
    return root;
  }

  const key = (name: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name }));

  it('rewinds declarations, their score, and their reset in an explicit table-3 recording', async () => {
    const fixture = declarationFixture();
    const root = await mount(fixture);
    key('Home');
    expect(root.querySelector('.xmj-badge--declared')).toBeNull();
    key('ArrowRight');
    expect(root.querySelectorAll('.xmj-badge--declared')).toHaveLength(1);
    const row = root.querySelector<HTMLButtonElement>('[data-xmj-ply="1"]');
    expect(row?.textContent).toContain('declares ready, discards');
    key('ArrowLeft');
    expect(root.querySelector('.xmj-badge--declared')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-xmj-hand="1"]')?.click();
    root.querySelector<HTMLButtonElement>('[data-xmj-ply="1"]')?.click();
    expect(root.querySelector('.xmj-badge--declared')).not.toBeNull();
    for (let ply = 2; ply <= 5; ply += 1) key('ArrowRight');
    expect(
      [...root.querySelectorAll('.xmj-line--on')].find((line) =>
        line.textContent?.includes('Declared ready'),
      )?.textContent,
    ).toContain('+1');
    key('ArrowRight');
    key('ArrowRight');
    expect(root.querySelector('.xmj-badge--declared')).toBeNull();
    expect(
      root.querySelector('[data-xmj-declare], [data-xmj-tile], [data-xmj-selfdraw]'),
    ).toBeNull();
  });

  async function mountLive(view: XmjPlayerView): Promise<(next?: XmjPlayerView) => void> {
    vi.resetModules();
    vi.stubGlobal('fetch', async () => jsonResponse({}, 404));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState(null, '', '/room/xmj_review');
    liveHarness.sent.length = 0;
    const { bootstrapXiangqiMahjongLiveRoom } = await import('./live-xiangqi-mahjong.js');
    bootstrapXiangqiMahjongLiveRoom();
    const options = liveHarness.options as TenantSocketClientOptions;
    const frame = (next = view) => {
      view = next;
      options.applySnapshot({
        type: 'snapshot',
        seat: view.perspective,
        seats: {},
        state: view,
      } as unknown as TenantLiveFrame<XmjSeat, XmjPlayerView>);
      options.render();
    };
    frame();
    return frame;
  }

  const click = (selector: string) => {
    const target = document.querySelector<HTMLElement>(selector);
    expect(target, selector).not.toBeNull();
    target?.click();
  };

  function claimStart(): XmjRoomState {
    const front: XmjTile[] = ['rK', 'rA', 'rE', 'rP', 'bH', 'bK', 'bA', 'bE', 'rP', 'rP'];
    const rest = xmjOrderedTiles();
    for (const tile of front) rest.splice(rest.indexOf(tile), 1);
    const wall = [...front, ...rest];
    return createXmjRoomState(
      { walls: [wall, wall], firstDealer: 'east', taiTable: 2 },
      'xmj_review',
    );
  }

  it('sends a claimant pass immediately during the pause', async () => {
    const state = applyXmjMove(claimStart(), {
      action: 'discard',
      by: 'east',
      tile: 'rP',
      at: Date.now(),
    });
    const view = xmjViewFor(state, 'west');
    expect(view.legal.pass).toBe(true);
    expect(view.claimPauseEndsAt).toBeGreaterThan(Date.now());
    await mountLive(view);
    click('[data-xmj-pass]');
    expect(liveHarness.sent).toEqual([{ type: 'move', action: 'pass' }]);
  });

  it('renders the released pass and discard in one snapshot, preserving replay plies', async () => {
    const start = claimStart();
    const moves: XmjMove[] = [
      { action: 'discard', by: 'east', tile: 'rP', at: 4000 },
      { action: 'pass', by: 'west', at: 4100 },
      { action: 'discard', by: 'west', tile: 'bK', at: 12000 },
    ];
    const states = [start];
    for (const move of moves) states.push(applyXmjMove(states.at(-1)!, move));
    await mountLive(xmjViewFor(states[1]!, 'east'));
    expect(document.querySelector('[data-xmj-ply="3"]')).toBeNull();
    const options = liveHarness.options as TenantSocketClientOptions;
    const events = moves.map((move, index) => ({
      type: 'move-played',
      move,
      color: move.by,
      at: move.at,
      ply: index + 1,
    }));
    options.applySnapshot({
      type: 'snapshot',
      seat: 'east',
      seats: {},
      events,
      event: events.at(-1),
      state: xmjViewFor(states[3]!, 'east'),
      liveHistory: states.map((state, ply) => ({ ply, view: xmjViewFor(state, 'east') })),
    } as unknown as TenantLiveFrame<XmjSeat, XmjPlayerView>);
    options.render();
    expect(document.querySelectorAll('[data-xmj-pond="west"] .xmj-pond > .xmj-tile')).toHaveLength(
      1,
    );
    expect(document.querySelector('.xmj-log [data-xmj-ply="3"]')).not.toBeNull();
    click('.xmj-log [data-xmj-ply="1"]');
    expect(document.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe('1');
    expect(document.querySelectorAll('[data-xmj-pond="west"] .xmj-pond > .xmj-tile')).toHaveLength(
      0,
    );
    expect(liveHarness.sent).toEqual([]);
  });

  it('enters and cancels declaration mode, and sends one atomic discard', async () => {
    const view = xmjViewFor(declarationStart(), 'east');
    const redraw = await mountLive(view);
    click('[data-xmj-declare]');
    expect(document.querySelector('[data-xmj-declare]')?.getAttribute('aria-pressed')).toBe('true');
    redraw();
    expect(document.querySelector('[data-xmj-declare]')?.getAttribute('aria-pressed')).toBe('true');
    click('[data-xmj-declare]');
    expect(document.querySelector('[data-xmj-declare]')?.textContent).toBe('Declare ready');
    expect(liveHarness.sent).toEqual([]);
    click('[data-xmj-declare]');
    click('[data-xmj-tile="bH"]');
    expect(liveHarness.sent).toEqual([{ type: 'move', action: 'declare-ready', tiles: ['bH'] }]);

    const config = liveHarness.config as TenantLiveClientConfig<XmjSeat, XmjPlayerView, XmjMove>;
    expect(config.replayCapture?.positionKey?.(view)).not.toBe(
      config.replayCapture?.positionKey?.({ ...view, declared: { east: true, west: false } }),
    );
    expect(config.moveList.notate(DECLARATION_MOVES[0]!)).toContain('Declare ready');
    expect(config.moveList.playedByPlayer?.(DECLARATION_MOVES[0]!)).toBe(true);
    click('[data-xmj-declare]');
    redraw(xmjViewFor(applyXmjMove(declarationStart(), DECLARATION_MOVES[0]!), 'east'));
    redraw(view);
    expect(document.querySelector('[data-xmj-declare]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('distinguishes a declaration discard from a twin in hand or the drawn slot', async () => {
    let state = declarationStart('rA');
    for (const original of DECLARATION_MOVES.slice(0, 4)) {
      const move: XmjMove =
        original.action === 'declare-ready' ? { ...original, action: 'discard' } : original;
      state = applyXmjMove(state, move);
    }
    const view = xmjViewFor(state, 'east');
    expect(view.legal.declareReady).toContain('rA');
    await mountLive(view);
    click('[data-xmj-declare]');
    click('[data-xmj-tile="rA"]:not(.xmj-tile--drawn)');
    expect(liveHarness.sent).toEqual([
      { type: 'move', action: 'declare-ready-hand', tiles: ['rA'] },
    ]);
    await mountLive(view);
    click('[data-xmj-declare]');
    click('[data-xmj-tile="rA"].xmj-tile--drawn');
    expect(liveHarness.sent).toEqual([{ type: 'move', action: 'declare-ready', tiles: ['rA'] }]);
  });

  it('sends only the drawn tile after locking, retaining confirmation for a winning draw', async () => {
    for (const draw of ['rA', 'rP'] as const) {
      let state = declarationStart(draw);
      for (const move of DECLARATION_MOVES.slice(0, 4)) state = applyXmjMove(state, move);
      await mountLive(xmjViewFor(state, 'east'));
      expect(document.querySelectorAll('[data-xmj-tile]')).toHaveLength(1);
      expect(document.querySelector('[data-xmj-declare]')).toBeNull();
      expect(document.querySelector('[data-player-bottom]')?.textContent).toContain(
        'Declared ready',
      );
      click('[data-xmj-tile].xmj-tile--drawn');
      if (draw === 'rP') {
        expect(liveHarness.sent).toEqual([]);
        click('[data-xmj-tile].xmj-tile--drawn');
      }
      expect(liveHarness.sent).toEqual([{ type: 'move', action: 'discard', tiles: [draw] }]);
    }
  });

  it('keeps the win-discard confirmation visible while choosing a declaration', async () => {
    let state = declarationStart();
    for (const original of DECLARATION_MOVES.slice(0, 4)) {
      const move: XmjMove =
        original.action === 'declare-ready' ? { ...original, action: 'discard' } : original;
      state = applyXmjMove(state, move);
    }
    await mountLive(xmjViewFor(state, 'east'));
    click('[data-xmj-declare]');
    click('[data-xmj-tile="rP"].xmj-tile--drawn');
    expect(liveHarness.sent).toEqual([]);
    expect(document.querySelector('.xmj-actions__hint')?.textContent).toContain('again');
    click('[data-xmj-tile="rP"].xmj-tile--drawn');
    expect(liveHarness.sent).toEqual([{ type: 'move', action: 'declare-ready', tiles: ['rP'] }]);
  });

  it('counts one review open and no gameplay events when stepping through the recording', async () => {
    const root = await mount(FIXTURE);
    const reviewCalls = () => capture.mock.calls.filter(([name]) => name === 'review_opened');
    const gameplayCalls = () =>
      capture.mock.calls.filter(([name]) => name === 'game_started' || name === 'game_finished');
    expect(reviewCalls()).toEqual([
      [
        'review_opened',
        expect.objectContaining({
          variant: 'xiangqi-mahjong',
          game_spec: 'xiangqi-mahjong',
          review_surface: 'game',
          route: '/xiangqi-mahjong/game/:id',
          has_analysis: false,
        }),
      ],
    ]);
    expect(gameplayCalls()).toEqual([]);

    key('Home');
    key('ArrowRight');
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe('1');
    key('ArrowLeft');
    const row = [...root.querySelectorAll<HTMLElement>('.xmj-log [data-xmj-ply]')].find(
      (each) => Number(each.dataset.xmjPly) > 2,
    );
    const target = row?.dataset.xmjPly;
    expect(target).toBeDefined();
    row?.click();
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe(target);
    key('End');
    await flushPromises();

    expect(reviewCalls()).toHaveLength(1);
    expect(gameplayCalls()).toEqual([]);
  });

  it('steps through the match with both hands face up and nothing to act on', async () => {
    const root = await mount(FIXTURE);
    const board = root.querySelector('.xiangqi-mahjong-live-board');
    expect(board?.querySelector('.xmj-table')).not.toBeNull();
    // Every tile is face up; no seat's hand is a row of backs.
    expect(board?.querySelectorAll('.xmj-tile--back')).toHaveLength(0);
    // A replay, not a seat: no discard taps, claims, next hand or rematch.
    expect(board?.querySelector('[data-xmj-tile], [data-xmj-claim], [data-xmj-next]')).toBeNull();
    expect(root.querySelector('.room-actions-row, .postgame-actions')).toBeNull();
    expect(root.querySelector('.presence-dot')).toBeNull();
    expect(root.querySelector('.xmj-hands')).not.toBeNull();
    expect(root.querySelectorAll('.xmj-log .xmj-log__hand').length).toBe(
      FIXTURE.view.results.length,
    );

    // Home goes to the deal: both hands dealt, each concealed tile shown.
    key('Home');
    const deal = FIXTURE.history[0]!.view;
    const shown = root.querySelectorAll('.xmj-seat .xmj-concealed > .xmj-tile').length;
    expect(shown).toBe((deal.hands.east?.length ?? 0) + (deal.hands.west?.length ?? 0));

    key('ArrowRight');
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe('1');

    // A log row jumps to its ply; End returns to the finished table.
    const row = [...root.querySelectorAll<HTMLElement>('.xmj-log [data-xmj-ply]')].find(
      (each) => Number(each.dataset.xmjPly) > 2,
    );
    const target = row?.dataset.xmjPly;
    expect(target).toBeDefined();
    row?.click();
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe(target);
    key('End');
    expect(root.querySelector('.xmj-result')).not.toBeNull();
  });

  it("is the room's own layout, with each seat's clock at the ply on show", async () => {
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review?ply=3');
    const root = await mount(TIMED);
    const table = root.querySelector('.review-shell__right .game-console');
    expect(table?.querySelector('.move-list.xmj-log')).not.toBeNull();
    // The room's resize grip comes with it.
    expect(root.querySelector('.board-resize-grip')).not.toBeNull();
    const clock = (slot: string) =>
      table?.querySelector(`[data-clock-${slot}] .clock-time-row strong`)?.textContent;
    const name = (slot: string) =>
      table?.querySelector(`[data-player-${slot}] .clock-name`)?.textContent;
    // West above, east below, as on the table.
    expect(name('top')).toBe('Guest');
    expect(name('bottom')).toBe('alice');
    expect(clock('top')).toBe('09:54');
    expect(clock('bottom')).toBe('09:57');
    expect(table?.querySelector('[data-clock-top] .clock-time-row')?.classList).toContain('active');
    key('Home');
    expect(clock('top')).toBe('10:00');
    // No seat disc on a wind-seated table.
    expect(root.querySelector('.game-meta-card__disc')).toBeNull();
  });

  it('shows no clock for a match that kept none', async () => {
    const root = await mount(FIXTURE);
    const rows = [...root.querySelectorAll<HTMLElement>('.game-console .clock-time-row')];
    expect(rows.every((row) => row.hidden || row.closest('[hidden]') !== null)).toBe(true);
  });

  it('opens at the ply in the link', async () => {
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review?ply=2');
    const root = await mount(FIXTURE);
    const view = FIXTURE.history[2]!.view;
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe('2');
    const shown = root.querySelectorAll('.xmj-seat .xmj-concealed > .xmj-tile').length;
    expect(shown).toBe((view.hands.east?.length ?? 0) + (view.hands.west?.length ?? 0));
  });

  it('names the winner on the meta card the way the room does', async () => {
    // The bot match is the kernel's: the winner is whoever its view says.
    const status = FIXTURE.view.status;
    const winner = status.type === 'finished' ? status.winner : null;
    expect(winner === 'east' || winner === 'west').toBe(true);
    const root = await mount(FIXTURE);
    expect(root.querySelector('.game-meta-card__status')?.textContent).toBe(
      `${winner === 'east' ? 'alice' : 'Guest'} wins on points`,
    );
  });

  it('says the game was not found when the server refuses (a live match)', async () => {
    const root = await mount({ error: 'not_found' }, 404);
    expect(root.textContent).toContain('Game not found');
    expect(root.querySelector('.xmj-table')).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
