import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  GOMOKU_OPENINGS,
  type GomokuOpening,
  getGomokuPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GomokuPostgameResponse } from './gomoku-postgame.js';

const ROOM = 'gmk_review';

function fixture(opening?: GomokuOpening): GomokuPostgameResponse {
  let state = createGomokuRoomState(ROOM, opening);
  const history = [{ ply: 0, at: 1000, view: getGomokuPlayerView(state, 'black', true) }];
  const timeline: GomokuPostgameResponse['timeline'] = [];
  for (const [index, to] of (['a1', 'b1', 'a2'] as const).entries()) {
    const color = state.status.type === 'playing' ? state.status.turn : 'black';
    state = applyGomokuRoomMove(state, { to });
    const ply = index + 1;
    timeline.push({ type: 'move-played', color, move: { to }, ply, at: 1000 + ply * 1000 });
    history.push({ ply, at: 1000 + ply * 1000, view: getGomokuPlayerView(state, 'black', true) });
  }
  state = { ...state, status: { type: 'finished', winner: 'black', reason: 'resignation' } };
  history[3] = { ply: 3, at: 5000, view: getGomokuPlayerView(state, 'black', true) };
  return {
    game: {
      roomId: ROOM,
      variant: 'gomoku',
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: 3,
      rated: false,
      initialMs: null,
      incrementMs: null,
      players: [
        { color: 'black', name: 'Alice' },
        { color: 'white', name: 'Bob' },
      ],
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    view: getGomokuPlayerView(state, 'black', true),
    history: { truth: history },
    timeline,
  };
}

const capture = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
  window.history.replaceState(null, '', `/gomoku/game/${ROOM}`);
  document.body.innerHTML = '<div id="app"></div>';
  capture.mockClear();
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount(payload: unknown, status = 200, admin?: boolean) {
  vi.resetModules();
  const { setResolvedAdmin } = await import('./signed-in-state.js');
  setResolvedAdmin(admin);
  const { setPostHogInstance } = await import('./analytics.js');
  setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).startsWith('/api/gomoku/games/') ? payload : {}), {
        status: String(input).startsWith('/api/gomoku/games/') ? status : 404,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchSpy);
  const { mountGomokuPostgame } = await import('./gomoku-postgame.js');
  const root = document.querySelector<HTMLDivElement>('#app')!;
  mountGomokuPostgame(root, ROOM);
  await vi.advanceTimersByTimeAsync(0);
  return { root, fetchSpy };
}

const key = (name: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name }));

describe('Gomoku finished-game review', () => {
  for (const enabled of [false, true]) {
    it.each([undefined, false, true])(
      `admits review by role with flag ${enabled}: admin %s`,
      async (admin) => {
        vi.stubEnv('VITE_GOMOKU_ENABLED', String(enabled));
        const { root, fetchSpy } = await mount(fixture(), 200, admin);
        const admitted = enabled || admin === true;
        expect(
          fetchSpy.mock.calls.some(([input]) => String(input).startsWith('/api/gomoku/')),
        ).toBe(admitted);
        expect(Boolean(root.querySelector('.gomoku-live-board'))).toBe(admitted);
      },
    );
  }

  it.each([3, 4, 5])(
    'keeps the recorded %i-stone opening through board and move-list navigation',
    async (count) => {
      const opening = GOMOKU_OPENINGS.find((entry) => entry.stones.length === count)!;
      const payload = fixture(opening);
      const { root, fetchSpy } = await mount(payload);
      expect(fetchSpy).toHaveBeenCalledWith(`/api/gomoku/games/${ROOM}`);
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 3);
      expect(root.querySelector('.game-meta-card')?.textContent).toContain('Gomoku');
      expect(root.querySelector('.move-list')?.textContent).toContain('a1');
      key('Home');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      for (const { square, color } of opening.stones) {
        expect(
          root.querySelector(`[data-piece-square="${square}"]`)?.getAttribute('class'),
        ).toContain(color);
      }
      key('ArrowRight');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 1);
      const second = [
        ...root.querySelectorAll<HTMLButtonElement>('.move-list button.move-jump'),
      ].find((button) => button.textContent === 'b1');
      expect(second).toBeDefined();
      second?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 2);
      key('End');
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count + 3);
      root.querySelector<HTMLElement>('[data-replay="first"]')?.click();
      expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      expect(
        root.querySelector('[data-square="b2"] .gomoku-hit')?.getAttribute('tabindex'),
      ).not.toBe('0');
      expect(root.querySelector('.presence-dot, .postgame-actions')).toBeNull();
      expect(capture.mock.calls.filter(([name]) => name === 'review_opened')).toEqual([
        [
          'review_opened',
          expect.objectContaining({
            variant: 'gomoku',
            game_spec: 'gomoku',
            route: '/gomoku/game/:id',
            review_surface: 'game',
            has_analysis: false,
          }),
        ],
      ]);
      expect(
        capture.mock.calls.filter(([name]) => ['game_started', 'game_finished'].includes(name)),
      ).toEqual([]);
    },
  );

  it('opens at the linked ply and reads the recorded clocks without advancing them', async () => {
    const payload = fixture(GOMOKU_OPENINGS.find((entry) => entry.stones.length === 3)!);
    payload.state.timeControl = { initialMs: 60_000, incrementMs: 1000 };
    payload.history.truth = payload.history.truth.map((frame) => ({
      ...frame,
      clock: {
        remainingMs: { black: 60_000 - frame.ply * 1000, white: 60_000 - frame.ply * 2000 },
        activeColor: frame.view.status.type === 'playing' ? frame.view.status.turn : null,
        runningSince: frame.at,
        initialMs: 60_000,
        incrementMs: 1000,
      },
    }));
    window.history.replaceState(null, '', `/gomoku/game/${ROOM}?ply=1`);
    const { root } = await mount(payload);
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(4);
    const clocks = () =>
      [...root.querySelectorAll('.clock-time-row strong')].map((el) => el.textContent);
    expect(clocks()).toContain('00:59');
    expect(clocks()).toContain('00:58');
    const before = clocks();
    await vi.advanceTimersByTimeAsync(5000);
    expect(clocks()).toEqual(before);
  });

  it('supports legacy empty-board recordings and clamps a linked ply to the end', async () => {
    window.history.replaceState(null, '', `/gomoku/game/${ROOM}?ply=9999`);
    const { root } = await mount(fixture());
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(3);
    key('Home');
    expect(root.querySelectorAll('[data-piece-square]')).toHaveLength(0);
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'])(
    'uses existing localized review strings in %s',
    async (locale) => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      });
      window.history.replaceState(null, '', `/gomoku/game/${ROOM}?lang=${locale}`);
      const { root } = await mount({ error: 'not_found' }, 404);
      expect(root.querySelector('.gomoku-live-board')).toBeNull();
      expect(root.querySelector('h1')?.textContent).toBeTruthy();
      expect(root.textContent).toContain(locale === 'en' ? 'Gomoku' : '五子棋');
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('does not fetch or count a review while the flag is off', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    const { root, fetchSpy } = await mount(fixture());
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/gomoku/')),
    ).toEqual([]);
    expect(root.querySelector('.gomoku-live-board')).toBeNull();
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(['unfinished', 'missing-root', 'wrong-room', 'wrong-variant', 'rated'])(
    'refuses a %s recording',
    async (kind) => {
      const payload = fixture();
      if (kind === 'unfinished') payload.view = payload.history.truth[0]!.view;
      if (kind === 'missing-root') payload.history.truth = payload.history.truth.slice(1);
      if (kind === 'wrong-room') payload.game.roomId = 'gmk_other';
      if (kind === 'wrong-variant') (payload.game as { variant: string }).variant = 'xiangqi';
      if (kind === 'rated') payload.game.rated = true;
      const { root } = await mount(payload);
      expect(root.querySelector('.gomoku-live-board')).toBeNull();
      expect(capture).not.toHaveBeenCalled();
    },
  );
});
