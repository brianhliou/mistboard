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
  mountXiangqiMahjongPostgame,
  type XmjPostgameResponse,
  xmjInitialPly,
  xmjPostgameClockAt,
  xmjPostgameLastPly,
  xmjPostgameNames,
  xmjPostgameStatusLine,
  xmjPostgameViewAt,
} from './xiangqi-mahjong-postgame.js';

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

describe('Xiangqi Mahjong review helpers', () => {
  it('picks the snapshot at or before a ply, and opens at ?ply= clamped to the match', () => {
    expect(xmjPostgameViewAt(FIXTURE, 0)).toBe(FIXTURE.history[0]?.view);
    expect(xmjPostgameViewAt(FIXTURE, 3)).toBe(FIXTURE.history[3]?.view);
    expect(xmjInitialPly('?ply=3', LAST)).toBe(3);
    expect(xmjInitialPly(`?ply=${LAST + 50}`, LAST)).toBe(LAST);
    expect(xmjInitialPly('?ply=-1', LAST)).toBe(LAST);
    expect(xmjInitialPly('', LAST)).toBe(LAST);
  });

  it('names each seat by its player, a nameless guest by the room word', () => {
    expect(xmjPostgameNames(FIXTURE.game.players)).toEqual({ east: 'alice', west: 'Guest' });
    expect(xmjPostgameNames(undefined)).toEqual({ east: 'Guest', west: 'Guest' });
  });
});

describe('Xiangqi Mahjong review page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('steps through the match with both hands face up and nothing to act on', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(FIXTURE));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);

    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/xiangqi-mahjong/games/xmj_review');
    const board = root.querySelector('.xiangqi-mahjong-live-board');
    expect(board?.querySelector('.xmj-table')).not.toBeNull();
    // Every tile is face up; no seat's hand is a row of backs.
    expect(board?.querySelectorAll('.xmj-tile--back')).toHaveLength(0);
    // A replay, not a seat: no discard taps, claims or a next-hand button.
    expect(board?.querySelector('[data-xmj-tile], [data-xmj-claim], [data-xmj-next]')).toBeNull();
    expect(root.querySelector('.xmj-hands')).not.toBeNull();
    expect(root.querySelectorAll('.xmj-log .xmj-log__hand').length).toBe(
      FIXTURE.view.results.length,
    );

    // Home goes to the deal: both hands dealt, each concealed tile shown.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(new URLSearchParams(window.location.search).get('ply')).toBe('0');
    const deal = FIXTURE.history[0]!.view;
    const shown = root.querySelectorAll('.xmj-seat .xmj-concealed > .xmj-tile').length;
    expect(shown).toBe((deal.hands.east?.length ?? 0) + (deal.hands.west?.length ?? 0));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(new URLSearchParams(window.location.search).get('ply')).toBe('1');

    // A log row jumps to its ply; End returns to the finished table.
    const row = [...root.querySelectorAll<HTMLElement>('.xmj-log [data-xmj-ply]')].find(
      (each) => Number(each.dataset.xmjPly) > 2,
    );
    const target = row?.dataset.xmjPly;
    expect(target).toBeDefined();
    row?.click();
    expect(new URLSearchParams(window.location.search).get('ply')).toBe(target);
    expect(root.querySelector('.xmj-log__row.active')?.getAttribute('data-xmj-ply')).toBe(target);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(window.location.search).toBe('');
    expect(root.querySelector('.xmj-result')).not.toBeNull();
  });

  it("sits in the room's game table with each seat's clock at the ply on show", async () => {
    // A timed match: east loses a second a ply, west two.
    const timed: XmjPostgameResponse = {
      ...FIXTURE,
      state: { ...FIXTURE.state, timeControl: { initialMs: 600_000, incrementMs: 0 } },
      history: FIXTURE.history.map((snapshot) => ({
        ...snapshot,
        clock: {
          remainingMs: { east: 600_000 - snapshot.ply * 1000, west: 600_000 - snapshot.ply * 2000 },
          active: snapshot.ply % 2 === 0 ? 'east' : 'west',
        },
      })),
    };
    expect(xmjPostgameClockAt(timed, 3)?.remainingMs).toEqual({ east: 597_000, west: 594_000 });
    expect(xmjPostgameClockAt(FIXTURE, 3)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(timed)),
    );
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review?ply=3');
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();
    const table = root.querySelector('.review-shell__right .game-console');
    expect(table?.querySelector('.round-table__box .move-list.xmj-log')).not.toBeNull();
    const clock = (slot: string) =>
      table?.querySelector(`[data-clock-${slot}] .clock-time-row strong`)?.textContent;
    const name = (slot: string) => table?.querySelector(`[data-player-${slot}] .clock-name`);
    // West above, east below, as on the board.
    expect(name('top')?.textContent).toBe('Guest');
    expect(name('bottom')?.textContent).toBe('alice');
    expect(clock('top')).toBe('09:54');
    expect(clock('bottom')).toBe('09:57');
    expect(table?.querySelector('[data-clock-top] .clock-time-row')?.classList).toContain('active');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(clock('top')).toBe('10:00');
    // No seat disc on a wind-seated table.
    expect(root.querySelector('.game-meta-card__disc')).toBeNull();
  });

  it('shows no clock for a match that kept none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(FIXTURE)),
    );
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();
    const rows = [...root.querySelectorAll<HTMLElement>('.game-console .clock-time-row')];
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.hidden)).toBe(true);
  });

  it('opens at the ply in the link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(FIXTURE)),
    );
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review?ply=2');
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();
    const view = FIXTURE.history[2]!.view;
    expect(root.querySelector('.xmj-seat--self .xmj-concealed')?.children.length).toBe(
      view.hands.east?.length,
    );
  });

  it('says the game was not found when the server refuses (a live match)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'not_found' }, 404)),
    );
    const root = document.createElement('div');
    mountXiangqiMahjongPostgame(root, 'xmj_live');
    await flushPromises();
    expect(root.textContent).toContain('Game not found');
    expect(root.querySelector('.xmj-table')).toBeNull();
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

describe('xiangqi mahjong review result line', () => {
  const names = { east: 'brianhliou', west: 'Misty' };

  it('names the winner the way the room does, never a bare "Won"', () => {
    expect(xmjPostgameStatusLine({ result: 'east-wins', termination: 'points' }, names)).toBe(
      'brianhliou wins on points',
    );
    expect(xmjPostgameStatusLine({ result: 'west-wins', termination: 'resignation' }, names)).toBe(
      'Misty wins by resignation',
    );
    expect(xmjPostgameStatusLine({ result: 'west-wins', termination: 'timeout' }, names)).toBe(
      'Misty wins on time',
    );
    // A level match is stored as draw/draw; the room calls it a tie on points.
    expect(xmjPostgameStatusLine({ result: 'draw', termination: 'draw' }, names)).toBe(
      'Match drawn on points',
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('puts the winner line on the meta card', async () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(FIXTURE)),
    );
    window.history.replaceState(null, '', '/xiangqi-mahjong/game/xmj_review');
    const root = document.createElement('div');
    document.body.append(root);
    mountXiangqiMahjongPostgame(root, 'xmj_review');
    await flushPromises();
    expect(root.querySelector('.game-meta-card__status')?.textContent).toBe('alice wins on points');
  });
});
