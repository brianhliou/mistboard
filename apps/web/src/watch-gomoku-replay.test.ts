import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuColor,
  type GomokuOpening,
  type GomokuPlayerView,
  type GomokuSquare,
  getGomokuPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeDisplayPreference } from './display-preferences.js';
import type { ReplayHandle } from './replay.js';
import { type GomokuWatchPayload, mountGomokuWatchReplay } from './watch-gomoku-replay.js';
import { formatClock } from './web-utils.js';

const BASE = 1_700_000_000_000;
const OPENING: GomokuOpening = {
  stones: [
    { square: 'h8', color: 'black' },
    { square: 'i8', color: 'white' },
    { square: 'h9', color: 'black' },
  ],
  turn: 'white',
};
const handles: ReplayHandle[] = [];

function fixture(opening?: GomokuOpening, moves: GomokuSquare[] = ['a1', 'b1', 'a2']) {
  let state = createGomokuRoomState('gmk_watch', opening);
  const clock = (activeColor: GomokuColor | null, black: number, white: number, at: number) => ({
    activeColor,
    initialMs: 60_000,
    incrementMs: 2_000,
    remainingMs: { black, white },
    runningSince: activeColor ? at : null,
  });
  const history = [
    {
      ply: 0,
      at: BASE,
      view: getGomokuPlayerView(state, 'black', true),
      clock: clock(null, 60_000, 60_000, BASE),
    },
  ];
  const timeline: GomokuWatchPayload['timeline'] = [];
  for (const [index, to] of moves.entries()) {
    if (state.status.type !== 'playing') throw new Error('fixture ended early');
    const color = state.status.turn;
    state = applyGomokuRoomMove(state, { to });
    const at = BASE + [1_000, 2_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000, 11_000][index]!;
    timeline.push({ type: 'move-played', at, color, move: { to }, ply: index + 1 });
    history.push({
      ply: index + 1,
      at,
      view: getGomokuPlayerView(state, 'black', true),
      clock: clock(
        state.status.type === 'playing' && index >= 1 ? state.status.turn : null,
        index < 2 ? 62_000 : 59_000,
        index < 1 ? 60_000 : 62_000,
        at,
      ),
    });
  }
  const payload: GomokuWatchPayload = {
    game: {
      roomId: 'gmk_watch',
      variant: 'gomoku',
      mode: 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: moves.length,
      initialMs: 60_000,
      incrementMs: 2_000,
      rated: false,
      startedAt: new Date(BASE).toISOString(),
    },
    state: { clock: history.at(-1)!.clock, timeControl: { initialMs: 60_000, incrementMs: 2_000 } },
    history: { truth: history },
    timeline,
  };
  return payload;
}

function finish(payload: GomokuWatchPayload, winner: GomokuColor | null, reason = 'resignation') {
  payload.game.result = winner ? `${winner}-wins` : 'draw';
  payload.game.termination = reason;
  const last = payload.history.truth.at(-1)!;
  last.view = {
    ...last.view,
    status: { type: 'finished', winner, reason } as GomokuPlayerView['status'],
  };
  payload.timeline.push({ type: winner ? 'seat-resigned' : 'draw-agreed', at: last.at + 1_000 });
  return payload;
}

function serve(payload: GomokuWatchPayload) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

async function mount(
  payload: GomokuWatchPayload,
  options: Parameters<typeof mountGomokuWatchReplay>[2] = {},
) {
  serve(payload);
  const root = document.createElement('div');
  const handle = await mountGomokuWatchReplay(root, payload.game.roomId, {
    autoplay: false,
    ...options,
  });
  handles.push(handle);
  return { root, handle };
}

function seats(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('[data-seat]')].map((row) => ({
    side: row.dataset.seat,
    name: row.querySelector('.showcase-seat-name, .replay-clock-side')?.textContent,
    clock: row.querySelector('.showcase-seat-clock, .replay-clock-time')?.textContent,
    active: row.classList.contains('active'),
    won: row.classList.contains('result-win'),
  }));
}

describe('Gomoku watch replay', () => {
  afterEach(() => {
    for (const handle of handles.splice(0)) handle.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders a legacy empty opening, placements, navigation and the White result without Red seats', async () => {
    const { root, handle } = await mount(finish(fixture(), 'white'));
    expect(fetch).toHaveBeenCalledWith('/api/gomoku/games/gmk_watch', {
      credentials: 'same-origin',
    });
    expect(root.querySelectorAll('svg.gomoku-svg')).toHaveLength(1);
    expect(root.querySelector('.gomoku-live-board')).not.toBeNull();
    expect(root.textContent).toContain('White wins');
    expect(root.textContent).not.toContain('Red');
    expect(seats(root).map((seat) => [seat.name, seat.active])).toEqual([
      ['Black', true],
      ['White', false],
    ]);
    expect(root.querySelectorAll('.gomoku-stone, .gomoku-last')).toHaveLength(0);
    expect(root.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')!.click();
    expect(root.querySelector('[data-square="a1"] .gomoku-stone--black')).not.toBeNull();
    expect(root.querySelector('[data-square="a1"] .gomoku-last')).not.toBeNull();
    expect(root.textContent).toContain('Ply 1 / 3');
    root.querySelector<HTMLButtonElement>('[aria-label="Last move"]')!.click();
    expect(root.textContent).toContain('Ply 3 / 3 - White wins');
    expect(handle.clockAtPly?.()?.toMove).toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="Previous move"]')!.click();
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(2);
    root.querySelector<HTMLButtonElement>('[aria-label="First move"]')!.click();
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(0);
    expect(handle.moveEntries?.()).toEqual([
      { ply: 1, label: 'a1' },
      { ply: 2, label: 'b1' },
      { ply: 3, label: 'a2' },
    ]);
    expect(handle.playedMoves?.()).toEqual([
      { ply: 1, to: 'a1' },
      { ply: 2, to: 'b1' },
      { ply: 3, to: 'a2' },
    ]);
    expect(handle.moveSoundAtPly?.(0)).toBeNull();
    expect(handle.moveSoundAtPly?.(1)).toBe('move');
    expect(handle.moveSoundAtPly?.(4)).toBeNull();
    expect(handle.availablePovs?.()).toEqual(['truth']);
    expect(handle.gameResult?.()).toBe('white-wins');
  });

  it('uses event plies and the view turn for a White-next dealt opening, keeping first=Black clocks', async () => {
    const payload = fixture(OPENING);
    const { root, handle } = await mount(payload, { compact: true, seatDiscs: true });
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
    expect(handle.plyCount?.()).toBe(3);
    expect(handle.bottomSeat?.()).toBe('first');
    expect(seats(root).map((seat) => [seat.side, seat.name, seat.active])).toEqual([
      ['second', 'White', true],
      ['first', 'Black', false],
    ]);
    expect([...root.querySelectorAll('.seat-disc')].map((el) => el.className)).toEqual([
      'seat-disc seat-disc--white',
      'seat-disc seat-disc--black',
    ]);
    expect(handle.clockAtPly?.()).toEqual({
      first: 60_000,
      second: 60_000,
      toMove: 'second',
      initialMs: 60_000,
    });
    handle.jumpToPly?.(1);
    expect(root.querySelector('[data-square="a1"] .gomoku-stone--white')).not.toBeNull();
    expect(handle.clockAtPly?.()?.toMove).toBe('first');
  });

  it('keeps a1 bottom left for both colour POVs while arranging the seat rows', async () => {
    const { root, handle } = await mount(fixture(OPENING), {
      compact: true,
      pov: 'white',
      namesByRoomId: { gmk_watch: { first: 'Black player', second: 'White player' } },
    });
    expect(handle.bottomSeat?.()).toBe('second');
    expect(seats(root).map((seat) => seat.name)).toEqual(['Black player', 'White player']);
    handle.jumpToPly?.(1);
    const stone = () => root.querySelector('[data-square="a1"] .gomoku-stone')!;
    expect([stone().getAttribute('cx'), stone().getAttribute('cy')]).toEqual(['32', '480']);
    handle.setPov?.('black');
    expect(stone().getAttribute('cx')).toBe('32');
    expect(handle.bottomSeat?.()).toBe('first');
    expect(seats(root).map((seat) => seat.name)).toEqual(['White player', 'Black player']);
    handle.setPov?.('white');
    expect([stone().getAttribute('cx'), stone().getAttribute('cy')]).toEqual(['32', '480']);
    handle.setPov?.('truth');
    expect(handle.bottomSeat?.()).toBe('first');
  });

  it('draws winning-line marks only on the terminal view, with Black winning the first seat', async () => {
    const payload = fixture(undefined, ['a1', 'b1', 'a2', 'b2', 'a3', 'b3', 'a4', 'b4', 'a5']);
    payload.game.result = 'black-wins';
    payload.game.termination = 'five';
    const { root, handle } = await mount(payload, { compact: true });
    handle.jumpToPly?.(8);
    expect(root.querySelectorAll('.gomoku-winning')).toHaveLength(0);
    handle.jumpToPly?.(9);
    expect(root.querySelectorAll('.gomoku-winning')).toHaveLength(5);
    expect(root.querySelector('[data-square="a5"] .gomoku-last')).not.toBeNull();
    expect(seats(root).map((seat) => [seat.side, seat.clock, seat.won])).toEqual([
      ['second', '0', false],
      ['first', '1', true],
    ]);
    expect(handle.clockAtPly?.()?.toMove).toBeNull();
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'reuses localized result, colour and five-in-a-row strings in %s',
    async (locale) => {
      const payload = finish(fixture(), 'white', 'five');
      const { root } = await mount(payload, { locale });
      const expected = {
        en: ['White wins', 'five in a row'],
        'zh-Hans': ['白方获胜', '五子连线'],
        'zh-Hant': ['白方獲勝', '五子連線'],
      }[locale];
      for (const label of expected) expect(root.textContent).toContain(label);
      expect(root.textContent).not.toContain('Red');
    },
  );

  it.each(['resignation', 'timeout', 'abandonment', 'agreement', 'board-full'])(
    'shows terminal %s without inventing a placement',
    async (reason) => {
      const winner = reason === 'agreement' || reason === 'board-full' ? null : 'white';
      const { root, handle } = await mount(finish(fixture(OPENING, []), winner, reason), {
        compact: true,
      });
      expect(handle.plyCount?.()).toBe(0);
      expect(handle.moveEntries?.()).toEqual([]);
      expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
      expect(seats(root).map((seat) => seat.clock)).toEqual(winner ? ['1', '0'] : ['½', '½']);
      expect(seats(root).every((seat) => !seat.active)).toBe(true);
    },
  );

  it('reads authoritative per-ply clocks, projects live White, and preserves a scrubbed view on updates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 5_500);
    let payload = fixture(undefined, ['a1', 'b1', 'a2']);
    const { root, handle } = await mount(payload, {
      compact: true,
      live: true,
      loadPostgameOverride: async () => ({ ok: true, postgame: payload }),
    });
    expect(handle.clockAtPly?.()).toEqual({
      first: 59_000,
      second: 61_500,
      toMove: 'second',
      initialMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(handle.clockAtPly?.()?.second).toBe(60_000);
    expect(seats(root)[0]!.clock).toBe(formatClock(60_000));
    handle.jumpToPly?.(2);
    expect(handle.clockAtPly?.()).toEqual({
      first: 62_000,
      second: 62_000,
      toMove: 'first',
      initialMs: 60_000,
    });
    payload = fixture(undefined, ['a1', 'b1', 'a2', 'b2']);
    await handle.loadGame('gmk_watch');
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(2);
    handle.jumpToPly?.(4);
    payload = fixture(undefined, ['a1', 'b1', 'a2', 'b2', 'a3']);
    await handle.loadGame('gmk_watch');
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(5);
    expect(handle.plyCount?.()).toBe(5);
  });

  it('plays at recorded times, ticks only the running seat at real speed, and pauses on navigation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const ended = vi.fn();
    const changed = vi.fn();
    const { root, handle } = await mount(finish(fixture(), 'black'), {
      compact: true,
      autoplay: true,
      onGameEnd: ended,
      onPlyChange: changed,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(1);
    expect(handle.clockAtPly?.()?.first).toBe(62_000); // pre-arm: no countdown
    await vi.advanceTimersByTimeAsync(1_500);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(2);
    expect(handle.clockAtPly?.()).toEqual({
      first: 61_000,
      second: 62_000,
      toMove: 'first',
      initialMs: 60_000,
    });
    handle.jumpToPly?.(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
    await handle.loadGame('gmk_watch', { initialPly: 2, startAutoplay: true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(ended).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ended).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(3, 3);
  });

  it('hands live playback to the finished endpoint and freezes its filed terminal clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 5_000);
    const livePayload = fixture();
    const finished = finish(fixture(), 'white', 'timeout');
    const finalClock = finished.history.truth.at(-1)!.clock!;
    finalClock.remainingMs = { black: 0, white: 57_321 };
    // A legacy runningSince in a finished payload must not drain its clocks.
    let following = true;
    const { root, handle } = await mount(finished, {
      compact: true,
      live: true,
      loadPostgameOverride: async () =>
        following ? { ok: true, postgame: livePayload } : { ok: false },
    });
    following = false;
    await handle.loadGame('gmk_watch');
    expect(handle.gameResult?.()).toBe('white-wins');
    expect(handle.clockAtPly?.()).toEqual({
      first: 0,
      second: 57_321,
      toMove: null,
      initialMs: 60_000,
    });
    expect(seats(root).map((seat) => seat.clock)).toEqual(['1', '0']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handle.clockAtPly?.()?.second).toBe(57_321);
  });

  it('keeps an untimed game clockless and renders a failed load in the requested locale', async () => {
    const payload = fixture();
    payload.game.initialMs = null;
    delete payload.state.clock;
    delete payload.state.timeControl;
    for (const frame of payload.history.truth) delete frame.clock;
    const { handle } = await mount(payload);
    expect(handle.clockAtPly?.()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const root = document.createElement('div');
    const failed = await mountGomokuWatchReplay(root, 'missing', {
      autoplay: false,
      locale: 'zh-Hans',
    });
    handles.push(failed);
    expect(root.querySelector('.watch-empty')?.textContent).toBe('无法加载这盘棋。');
  });

  it('ignores stale loads and cleans timers and keyboard listeners on destroy', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const { root, handle } = await mount(finish(fixture(), 'black'), { autoplay: true });
    handle.jumpToPly?.(1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(2);
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('slow')
          ? pending
          : Promise.resolve(new Response(JSON.stringify(finish(fixture(), 'white')))),
      ),
    );
    const slow = handle.loadGame('slow');
    await handle.loadGame('fast');
    resolve(new Response(JSON.stringify(finish(fixture(), 'black'))));
    await slow;
    expect(handle.activeSampleId()).toBe('fast');
    expect(handle.gameResult?.()).toBe('white-wins');
    const removed = vi.spyOn(window, 'removeEventListener');
    const removeVisibility = vi.spyOn(document, 'removeEventListener');
    const afterDestroy = handle.loadGame('slow');
    handle.destroy();
    await afterDestroy;
    expect(root.childElementCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeVisibility).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('supports full-view play controls without a board flip and ignores shortcuts inside inputs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
    const { root, handle } = await mount(finish(fixture(OPENING), 'white'));
    const play = root.querySelector<HTMLButtonElement>('[aria-label="Play / pause"]');
    expect(play).not.toBeNull();
    play!.click();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(root.querySelector('[data-square="a1"] .gomoku-stone--white')).not.toBeNull();
    play!.click();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(4);
    expect(root.querySelector('[aria-label="Flip boards"]')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    expect(root.querySelector('[data-square="a1"] .gomoku-stone')!.getAttribute('cx')).toBe('32');
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(4);
    input.remove();
    handle.jumpToPly?.(99);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(6);
    handle.jumpToPly?.(-99);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
    handle.jumpToPly?.(Number.NaN);
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
  });

  it('reacts to coordinate preferences and removes the subscription on destroy', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const { root, handle } = await mount(fixture(), { pov: 'white' });
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
    writeDisplayPreference('boardCoordinates', true);
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(30);
    expect(root.querySelector('.gomoku-ghost')).toBeNull();
    writeDisplayPreference('boardCoordinates', false);
    expect(root.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
    const remove = vi.spyOn(window, 'removeEventListener');
    handle.destroy();
    expect(remove).toHaveBeenCalledWith(
      'mistboard:display-preferences-change',
      expect.any(Function),
    );
  });

  it('joins delayed air at the current recorded ply and catches up after a hidden-tab stall', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE + 3_000);
    const { root, handle } = await mount(finish(fixture(), 'black'), {
      compact: true,
      autoplay: true,
      airStartMs: BASE,
    });
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(2);
    expect(handle.clockAtPly?.()?.first).toBe(61_000);
    vi.setSystemTime(BASE + 5_500);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root.querySelectorAll('.gomoku-stone')).toHaveLength(3);
  });

  it('rejects another variant or malformed frames and can preserve the last board on a failed live load', async () => {
    let value: unknown = fixture();
    const onLoadError = vi.fn(() => true);
    const { root, handle } = await mount(fixture(), {
      compact: true,
      live: true,
      onLoadError,
      loadPostgameOverride: async () => ({ ok: true, postgame: value }),
    });
    const before = root.innerHTML;
    value = { ...fixture(), game: { ...fixture().game, variant: 'chess' } };
    await handle.loadGame('gmk_watch');
    expect(onLoadError).toHaveBeenCalledTimes(1);
    expect(root.innerHTML).toBe(before);
    value = { ...fixture(), history: { truth: [{ ply: 5 }] } };
    await handle.loadGame('gmk_watch');
    expect(onLoadError).toHaveBeenCalledTimes(2);
    expect(root.innerHTML).toBe(before);
  });
});
