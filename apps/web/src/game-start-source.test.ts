import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameLifecycleTracker, setPostHogInstance } from './analytics.js';
import {
  rememberGameStartSource,
  resetTrackedGameStartsForTests,
  takeGameStartSource,
} from './game-start-source.js';

describe('game start source', () => {
  beforeEach(() => {
    sessionStorage.clear();
    globalThis.localStorage?.clear();
    resetTrackedGameStartsForTests();
  });

  it('is read once, then reads as none', () => {
    rememberGameStartSource('panel-bot', 1_000);
    expect(takeGameStartSource(2_000)).toBe('panel-bot');
    expect(takeGameStartSource(3_000)).toBe('none');
  });

  it('expires after ten minutes so a later link start is not mislabeled', () => {
    rememberGameStartSource('panel-person', 0);
    expect(takeGameStartSource(10 * 60 * 1_000 + 1)).toBe('none');
  });

  it('labels the next game_started and only that one', () => {
    const capture = vi.fn();
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
    const started = () =>
      (capture.mock.calls as Array<[string, Record<string, unknown>]>).filter(
        ([name]) => name === 'game_started',
      );

    rememberGameStartSource('panel-play-again');
    const first = createGameLifecycleTracker();
    first.update({ statusType: 'playing', baseProps: { gameId: 'g1' } });
    expect(started()[0]?.[1]).toMatchObject({ gameId: 'g1', entry_source: 'panel-play-again' });

    // A reload of the same game is not a start at all (#437); the next game,
    // started without a click that labels it, reads as none.
    const reload = createGameLifecycleTracker();
    reload.update({ statusType: 'playing', baseProps: { gameId: 'g1' } });
    expect(started()).toHaveLength(1);
    createGameLifecycleTracker().update({ statusType: 'playing', baseProps: { gameId: 'g2' } });
    expect(started()[1]?.[1]).toMatchObject({ gameId: 'g2', entry_source: 'none' });
  });
});
