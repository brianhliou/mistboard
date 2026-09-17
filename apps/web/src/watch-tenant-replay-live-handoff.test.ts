// The homepage TV's live→finished handoff reuses the LIVE handle to load the
// finished record (landing-tv.ts finishLiveHandoff). The compact seats must
// then read the result marks (1 / 0 / ½) off the loaded payload, not off the
// mount-time `live` flag, or the board sits on the final clocks with a side
// still "to move" until the visitor refreshes.
import { createInitialXiangqiState, getStandardXiangqiPlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountXiangqiWatchReplay } from './watch-xiangqi-replay.js';
import type { XiangqiPostgameResponse } from './xiangqi-postgame.js';

describe('tenant watch replay: live handle after the game ends', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows result marks once the same live handle loads the finished game', async () => {
    let override: XiangqiPostgameResponse | null = postgameFixture('in-progress');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture('red-wins'))),
    );
    const root = document.createElement('div');
    const handle = await mountXiangqiWatchReplay(root, 'xq_live', {
      autoplay: false,
      compact: true,
      live: true,
      loadPostgameOverride: async () =>
        override ? { ok: true, postgame: override } : { ok: false },
    });

    // Following: an in-progress frame shows clocks, and red is on the move.
    const clocks = () =>
      [...root.querySelectorAll<HTMLElement>('.showcase-seat-clock')].map((el) => el.textContent);
    expect(clocks()).not.toContain('1');
    expect(root.querySelector('.showcase-seat-result')).toBeNull();
    expect(root.querySelector('.showcase-seat.active')).not.toBeNull();

    // Handoff: the override stops answering and the finished record loads
    // through the same handle.
    override = null;
    await handle.loadGame('xq_live');
    handle.jumpToPly?.(handle.plyCount?.() ?? 0);

    expect(clocks().sort()).toEqual(['0', '1']);
    expect(root.querySelectorAll('.showcase-seat-result')).toHaveLength(2);
    expect(root.querySelector('.showcase-seat.active')).toBeNull();
    handle.destroy();
  });
});

function postgameFixture(result: 'in-progress' | 'red-wins'): XiangqiPostgameResponse {
  const state = createInitialXiangqiState('xq_live');
  const view = getStandardXiangqiPlayerView(state, 'red');
  return {
    game: {
      roomId: 'xq_live',
      variant: 'xiangqi',
      mode: 'pvp',
      result,
      termination: result === 'in-progress' ? 'in-progress' : 'resignation',
      plyCount: 1,
      startedAt: '2026-07-01T12:00:00.000Z',
      endedAt: '2026-07-01T12:05:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 180_000,
      incrementMs: 2_000,
    },
    state: {
      status: view.status,
      moveNumber: view.moveNumber,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    },
    timeline: [],
    view,
    views: { truth: view },
    history: {
      truth: [
        { ply: 0, view },
        { ply: 1, view },
      ],
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
