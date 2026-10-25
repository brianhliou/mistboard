import {
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjRoomState,
  xmjBotAction,
  xmjPendingAction,
  xmjReviewViewFor,
  xmjViewFor,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type XmjPostgameResponse,
  xmjInitialPly,
  xmjPostgameClockAt,
  xmjPostgameLastPly,
  xmjRecordingFrame,
} from './xiangqi-mahjong-postgame.js';

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
