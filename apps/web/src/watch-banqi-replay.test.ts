import type { BanqiMove, BanqiPlayerBoard, BanqiPlayerView, BanqiSeat } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BanqiPostgameResponse } from './live-banqi-postgame.js';
import { mountBanqiWatchReplay } from './watch-banqi-replay.js';

describe('Banqi watch replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts a Banqi TV replay with a single truth board, seats, and controls', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      return jsonResponse(postgameFixture(String(input).split('/').pop() ?? 'bq_watch'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    const handle = await mountBanqiWatchReplay(root, 'bq_watch', { autoplay: false });

    expect(fetchSpy).toHaveBeenCalledWith('/api/banqi/games/bq_watch');
    expect(handle.activeSampleId()).toBe('bq_watch');
    expect(root.textContent).toContain('Human vs engine');
    expect(root.textContent).toContain('Red wins');
    expect(root.textContent).toContain('by Resignation');
    expect(root.textContent).toContain('1 plies');
    expect(root.textContent).toContain('Casual');
    expect(root.textContent).toContain('Ply 0 / 1');
    // Banqi is symmetric → a single Truth pane (not the jieqi triptych).
    expect(root.querySelectorAll('.banqi-board')).toHaveLength(1);

    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    expect(root.textContent).toContain('Ply 1 / 1 - Red wins');

    await handle.loadGame('bq_next');
    expect(fetchSpy).toHaveBeenCalledWith('/api/banqi/games/bq_next');
    expect(handle.activeSampleId()).toBe('bq_next');

    handle.destroy();
    expect(root.childElementCount).toBe(0);
  });

  it('localizes Banqi TV replay chrome', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      return jsonResponse(postgameFixture(String(input).split('/').pop() ?? 'bq_watch'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountBanqiWatchReplay(root, 'bq_watch', { autoplay: false, locale: 'zh-Hant' });

    expect(root.textContent).toContain('人類對引擎');
    expect(root.textContent).toContain('紅方獲勝');
    expect(root.textContent).toContain('原因：認輸');
    expect(root.textContent).toContain('1 手');
    expect(root.textContent).toContain('休閒');
    expect(root.textContent).toContain('第 0 / 1 手');
    expect(root.querySelector<HTMLButtonElement>('[aria-label="下一手"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('[aria-label="下一手"]')?.click();
    expect(root.textContent).toContain('第 1 / 1 手 - 紅方獲勝');
  });
});

// A minimal one-ply fixture: red flips a1 (revealing a chariot); only the truth
// surface is present, matching banqi's symmetric postgame (no per-color views).
function postgameFixture(roomId: string): BanqiPostgameResponse {
  const startBoard: BanqiPlayerBoard = {
    a1: { faceDown: true },
    h4: { color: 'black', role: 'general', faceDown: false },
  };
  const movedBoard: BanqiPlayerBoard = {
    a1: { color: 'red', role: 'chariot', faceDown: false },
    h4: { color: 'black', role: 'general', faceDown: false },
  };
  const move: BanqiMove = { from: 'a1', to: 'a1' };
  const finished = {
    type: 'finished' as const,
    winner: 'red' as const,
    reason: 'resignation' as const,
  };
  const playingRed = { type: 'playing' as const, turn: 'red' as const };
  const playingBlack = { type: 'playing' as const, turn: 'black' as const };

  return {
    game: {
      roomId,
      variant: 'banqi',
      mode: 'pve',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-06-16T21:36:00.000Z',
      endedAt: '2026-06-16T21:40:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 180_000,
      incrementMs: 2_000,
    },
    state: {
      status: finished,
      moveNumber: 1,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    },
    timeline: [
      { type: 'move-played', at: 2, color: 'red', move, ply: 1 },
      { type: 'seat-resigned', at: 3, color: 'black', winner: 'red' },
    ],
    view: view('red', movedBoard, move, finished, 1),
    views: { truth: view('red', movedBoard, move, finished, 1) },
    history: {
      truth: [
        { ply: 0, view: view('red', startBoard, undefined, playingRed, 0) },
        { ply: 1, view: view('red', movedBoard, move, playingBlack, 1) },
      ],
    },
  };
}

function view(
  perspective: BanqiSeat,
  board: BanqiPlayerBoard,
  lastMove: BanqiMove | undefined,
  status: BanqiPlayerView['status'],
  ply: number,
): BanqiPlayerView {
  return {
    id: `${perspective}-${Object.keys(board).join('')}-${ply}`,
    perspective,
    board,
    legalMoves: [],
    captured: [],
    status,
    ply,
    firstColor: 'red',
    moveNumber: 1,
    ...(lastMove ? { lastMove } : {}),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}
