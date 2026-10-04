import { DARK_CHESS_SPEC_ID, gameSpecForId } from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsTimeClass,
  applyInternalTag,
  classifyTimeControl,
  createGameLifecycleTracker,
  gameSpecAnalyticsProps,
  isInternalBrowser,
  markInternalBrowser,
  puzzleAttemptedProps,
  resetIdentity,
  reviewOpenedProps,
  reviewRouteForAnalytics,
  roomModeAnalyticsProps,
  setPostHogInstance,
} from './analytics.js';
import { rememberCorrespondenceStartSource, rememberGameStartSource } from './game-start-source.js';

describe('classifyTimeControl', () => {
  it('classifies bullet (1+0)', () => {
    expect(classifyTimeControl(60_000, 0)).toBe('bullet');
  });

  it('classifies blitz (3+2)', () => {
    expect(classifyTimeControl(3 * 60_000, 2_000)).toBe('blitz');
  });

  it('classifies official rapid (5+5)', () => {
    expect(classifyTimeControl(5 * 60_000, 5_000)).toBe('rapid');
  });

  it('classifies rapid (10+0)', () => {
    expect(classifyTimeControl(10 * 60_000, 0)).toBe('rapid');
  });

  it('classifies classical (30+0)', () => {
    expect(classifyTimeControl(30 * 60_000, 0)).toBe('classical');
  });

  it('uses increment in estimate (1+3 → blitz)', () => {
    // 1*60000 + 40*3000 = 60000 + 120000 = 180000 = 3 min → bullet boundary exact → blitz
    expect(classifyTimeControl(60_000, 3_000)).toBe('blitz');
  });
});

describe('gameSpecAnalyticsProps', () => {
  it('maps standard Dark chess to structured analytics fields', () => {
    const spec = gameSpecForId(DARK_CHESS_SPEC_ID);

    expect(gameSpecAnalyticsProps({ variant: 'dark-chess' })).toEqual({
      game_spec: spec.id,
      family: spec.family,
      setup: spec.setup,
      visibility: spec.visibility,
      rating_pool: spec.ratingPoolBase,
    });
  });
});

describe('createGameLifecycleTracker', () => {
  const capture = vi.fn();
  const calls = () => capture.mock.calls as Array<[string, Record<string, unknown>]>;
  const named = (name: string) => calls().filter(([n]) => n === name);
  const base = { gameId: 'g1', game_spec: 'dark-mini-xiangqi' };

  beforeEach(() => {
    capture.mockReset();
    // track() routes through the posthog instance; install a spy so emissions
    // are observable even outside PROD (enqueue runs the action immediately).
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  });

  it('emits game_started once on entering playing, and not on repeats', () => {
    const t = createGameLifecycleTracker();
    t.update({ statusType: 'playing', baseProps: base });
    t.update({ statusType: 'playing', baseProps: base });
    expect(named('game_started')).toHaveLength(1);
    expect(named('game_started')[0][1]).toMatchObject(base);
  });

  it('emits game_finished with outcome fields and a numeric durationMs', () => {
    const t = createGameLifecycleTracker();
    t.update({ statusType: 'playing', baseProps: base });
    t.update({
      statusType: 'finished',
      baseProps: base,
      outcome: { winner: 'red', reason: 'general-captured', moveNumber: 12 },
    });
    expect(named('game_finished')).toHaveLength(1);
    expect(named('game_finished')[0][1]).toMatchObject({
      winner: 'red',
      reason: 'general-captured',
      moveNumber: 12,
    });
    expect(typeof named('game_finished')[0][1].durationMs).toBe('number');
  });

  it('treats null updates as no-ops', () => {
    const t = createGameLifecycleTracker();
    t.update(null);
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not emit game_finished without an outcome', () => {
    const t = createGameLifecycleTracker();
    t.update({ statusType: 'playing', baseProps: base });
    t.update({ statusType: 'finished', baseProps: base, outcome: null });
    expect(named('game_finished')).toHaveLength(0);
  });

  it('re-arms the start transition after reset', () => {
    const t = createGameLifecycleTracker();
    t.update({ statusType: 'playing', baseProps: base });
    t.reset();
    t.update({ statusType: 'playing', baseProps: base });
    expect(named('game_started')).toHaveLength(2);
  });

  it('keeps separate trackers from bleeding transitions into each other', () => {
    const chess = createGameLifecycleTracker();
    const dmx = createGameLifecycleTracker();
    chess.update({ statusType: 'playing', baseProps: { game_spec: 'dark-chess' } });
    dmx.update({ statusType: 'playing', baseProps: base });
    // Both fire independently; one tracker reaching 'playing' must not suppress
    // the other's game_started.
    expect(named('game_started')).toHaveLength(2);
  });
});

describe('analyticsTimeClass', () => {
  it('reports a days-per-move control as correspondence, not the classical its ms fall in', () => {
    // 1 day = 86,400,000 ms with no increment; the pace formula says classical.
    expect(classifyTimeControl(86_400_000, 0)).toBe('classical');
    expect(analyticsTimeClass({ initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 })).toBe(
      'correspondence',
    );
  });

  it('trusts the room mode when the clock carries no daysPerMove (chess stack)', () => {
    expect(
      analyticsTimeClass({ initialMs: 86_400_000, incrementMs: 0 }, { correspondence: true }),
    ).toBe('correspondence');
  });

  it('keeps the live classes and null for a room with no clock', () => {
    expect(analyticsTimeClass({ initialMs: 5 * 60_000, incrementMs: 5_000 })).toBe('rapid');
    expect(analyticsTimeClass(null)).toBeNull();
  });
});

describe('correspondence game_started', () => {
  const capture = vi.fn();
  const started = () =>
    (capture.mock.calls as Array<[string, Record<string, unknown>]>).filter(
      ([name]) => name === 'game_started',
    );
  const corr = { gameId: 'jq_1', game_spec: 'jieqi', time_class: 'correspondence' };

  beforeEach(() => {
    capture.mockReset();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    sessionStorage.clear();
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  });

  it('fires once per game across page loads, not on every daily visit', () => {
    createGameLifecycleTracker().update({ statusType: 'playing', baseProps: corr });
    // The next day's visit is a fresh page with a fresh tracker.
    createGameLifecycleTracker().update({ statusType: 'playing', baseProps: corr });
    expect(started()).toHaveLength(1);
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { ...corr, gameId: 'jq_2' },
    });
    expect(started()).toHaveLength(2);
  });

  it('labels the accepter from the session source and the poster from the long-lived one', () => {
    rememberGameStartSource('home-correspondence');
    createGameLifecycleTracker().update({ statusType: 'playing', baseProps: corr });
    expect(started()[0]?.[1].entry_source).toBe('home-correspondence');

    // The poster: no session source (they came from an email days later).
    rememberCorrespondenceStartSource('home-correspondence', 'jieqi');
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { ...corr, gameId: 'jq_3' },
    });
    expect(started()[1]?.[1].entry_source).toBe('home-correspondence');
    // Consumed: a later correspondence game is unlabeled.
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { ...corr, gameId: 'jq_4' },
    });
    expect(started()[2]?.[1].entry_source).toBe('none');
  });

  it('does not hand the long-lived source to another variant or to a live game', () => {
    rememberCorrespondenceStartSource('home-correspondence', 'jieqi');
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { ...corr, gameId: 'xq_1', game_spec: 'xiangqi' },
    });
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { gameId: 'live_1', game_spec: 'jieqi', time_class: 'blitz' },
    });
    expect(started().map(([, props]) => props.entry_source)).toEqual(['none', 'none']);
    // Live games still fire on every fresh tracker, as before.
    createGameLifecycleTracker().update({
      statusType: 'playing',
      baseProps: { gameId: 'live_1', game_spec: 'jieqi', time_class: 'blitz' },
    });
    expect(started()).toHaveLength(3);
  });
});

describe('roomModeAnalyticsProps', () => {
  it('flags a bot room and carries the bot name', () => {
    expect(roomModeAnalyticsProps('pve', 'Misty')).toEqual({
      roomMode: 'pve',
      pve: true,
      bot_name: 'Misty',
    });
  });

  it('never names a bot in a human room', () => {
    expect(roomModeAnalyticsProps('pvp', 'Misty')).toEqual({
      roomMode: 'pvp',
      pve: false,
      bot_name: null,
    });
  });

  it('treats an unknown mode as human play', () => {
    expect(roomModeAnalyticsProps(undefined)).toEqual({
      roomMode: 'pvp',
      pve: false,
      bot_name: null,
    });
  });
});

describe('reviewOpenedProps', () => {
  it('strips ids from the route but keeps variant slugs', () => {
    expect(reviewRouteForAnalytics('/xiangqi/games/hxq_fbd5991a8240047ccb2f9145')).toBe(
      '/xiangqi/games/:id',
    );
    expect(reviewRouteForAnalytics('/game/b8054d34')).toBe('/game/:id');
  });

  it('resolves the variant from the route and classifies the referrer', () => {
    const base = {
      pathname: '/xiangqi/games/hxq_1',
      referrer: 'https://mistboard.com/room/xq_1',
      origin: 'https://mistboard.com',
      reviewSurface: 'game',
      hasAnalysis: true,
      pageClassName: 'xiangqi-review',
    };
    const props = reviewOpenedProps(base);
    expect(props.route).toBe('/xiangqi/games/:id');
    expect(props.variant).toBe('xiangqi');
    expect(props.game_spec).toBe('xiangqi');
    expect(props.referrer_kind).toBe('same-site');
    expect(props.has_analysis).toBe(true);
    expect(props.page_class).toBe('xiangqi-review');
    expect(reviewOpenedProps({ ...base, referrer: '' }).referrer_kind).toBe('none');
    expect(reviewOpenedProps({ ...base, referrer: 'https://lichess.org/' }).referrer_kind).toBe(
      'external',
    );
    expect(reviewOpenedProps({ ...base, pathname: '/game/b8054d34' }).variant).toBeNull();
  });
});

describe('puzzleAttemptedProps', () => {
  it('carries the spec identity, themes, and the clean-solve flag', () => {
    expect(
      puzzleAttemptedProps({
        puzzleId: 'p1',
        variant: 'xiangqi',
        themes: ['checkmate', 'matein2'],
        rated: true,
        mode: 'session',
        outcome: 'solved',
        clean: true,
      }),
    ).toMatchObject({
      puzzle_id: 'p1',
      variant: 'xiangqi',
      game_spec: 'xiangqi',
      themes: ['checkmate', 'matein2'],
      rated: true,
      mode: 'session',
      outcome: 'solved',
      clean: true,
    });
  });
});

describe('internal browser tag', () => {
  beforeEach(() => {
    // happy-dom here has no Storage; stub a fresh one per test (as account-nav.test does).
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
  });

  it('tags nothing for an ordinary browser', () => {
    const register = vi.fn();
    applyInternalTag({ register });
    expect(isInternalBrowser()).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('marks the browser and registers is_internal on the live instance', () => {
    const register = vi.fn();
    const setPersonProperties = vi.fn();
    setPostHogInstance({
      capture: vi.fn(),
      identify: vi.fn(),
      reset: vi.fn(),
      register,
      setPersonProperties,
    });
    markInternalBrowser();
    expect(isInternalBrowser()).toBe(true);
    expect(register).toHaveBeenCalledWith({ is_internal: true });
    expect(setPersonProperties).toHaveBeenCalledWith({ $internal_or_test_user: true });
  });

  it('re-tags after sign-out, because posthog.reset() clears super properties', () => {
    const calls: string[] = [];
    const register = vi.fn(() => calls.push('register'));
    const reset = vi.fn(() => calls.push('reset'));
    setPostHogInstance({ capture: vi.fn(), identify: vi.fn(), reset, register });
    markInternalBrowser();
    calls.length = 0;
    resetIdentity();
    expect(calls).toEqual(['reset', 'register']);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}
