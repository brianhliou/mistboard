import { DARK_CHESS_SPEC_ID, gameSpecForId } from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyTimeControl,
  createGameLifecycleTracker,
  gameSpecAnalyticsProps,
  puzzleAttemptedProps,
  reviewOpenedProps,
  reviewRouteForAnalytics,
  roomModeAnalyticsProps,
  setPostHogInstance,
} from './analytics.js';

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
