import type { XiangqiColor, XiangqiMove, XiangqiSquare } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DarkXiangqiPostgameResponse } from './dark-xiangqi-postgame.js';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import { mountDarkXiangqiWatchReplay } from './watch-dark-xiangqi-replay.js';

describe('Dark Xiangqi watch replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts a fog triptych with seats, controls, and per-view fog masks', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(postgameFixture(String(input).split('/').pop() ?? 'dxq_watch')),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    const handle = await mountDarkXiangqiWatchReplay(root, 'dxq_watch', { autoplay: false });

    expect(fetchSpy).toHaveBeenCalledWith('/api/dark-xiangqi/games/dxq_watch');
    expect(handle.activeSampleId()).toBe('dxq_watch');
    expect(root.textContent).toContain('Human vs human');
    expect(root.textContent).toContain('Red wins');
    expect(root.textContent).toContain('Ply 0 / 1');
    // Fog variant → a red/truth/black triptych (three boards), unlike Banqi's
    // single truth pane.
    const boards = [...root.querySelectorAll('svg.xq-live-svg')];
    expect(boards).toHaveLength(3);

    // Each fogged pane owns a distinct mask id (red vs black), and the truth pane
    // carries no fog mask. This is the per-view fog guarantee — sharing a mask id
    // would mask the black board with red's fog.
    const maskIds = boards
      .map((svg) => svg.querySelector('mask')?.id ?? null)
      .filter((id): id is string => id !== null);
    expect(maskIds).toHaveLength(2);
    expect(new Set(maskIds).size).toBe(2);
    expect(maskIds.some((id) => id.endsWith('-red'))).toBe(true);
    expect(maskIds.some((id) => id.endsWith('-black'))).toBe(true);

    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    expect(root.textContent).toContain('Ply 1 / 1 - Red wins');

    handle.destroy();
    expect(root.childElementCount).toBe(0);
  });

  // Mistboard TV's rail: each seat's captures from the ledger on the view the board
  // shows, so the pov toggle's choice is what the strips read.
  it('fills the TV rail capture strips from the view the board shows', async () => {
    const postgame = postgameFixture('dxq_mat');
    for (const key of ['red', 'truth', 'black'] as const) {
      const ply1 = postgame.history?.[key]?.[1];
      if (ply1) ply1.view = { ...ply1.view, captures: { red: [], black: ['soldier'] } };
    }
    const blackPly1 = postgame.history?.black?.[1];
    if (blackPly1)
      blackPly1.view = { ...blackPly1.view, captures: { red: ['horse'], black: ['soldier'] } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgame)),
    );
    const root = document.createElement('div');
    const handle = await mountDarkXiangqiWatchReplay(root, 'dxq_mat', {
      autoplay: false,
      compact: true,
    });
    const slots = railSlots();

    expect(handle.fillMaterial).toBeTypeOf('function');
    handle.setPov?.('truth');
    handle.jumpToPly?.(0);
    handle.fillMaterial?.(slots);
    expect(railLabels(slots.top)).toEqual([]);
    expect(railLabels(slots.bottom)).toEqual([]);

    handle.jumpToPly?.(1);
    handle.fillMaterial?.(slots);
    // Red (bottom) took a black soldier; nothing of red's is gone.
    expect(railLabels(slots.top)).toEqual([]);
    expect(railLabels(slots.bottom)).toEqual(['black soldier']);

    handle.setPov?.('black');
    handle.fillMaterial?.(slots);
    expect(railLabels(slots.top)).toEqual(['red horse']);
    handle.destroy();
  });
});

function postgameFixture(roomId: string): DarkXiangqiPostgameResponse {
  const move: XiangqiMove = { from: 'e3', to: 'e10' };
  const finished = {
    type: 'finished' as const,
    winner: 'red' as const,
    reason: 'general-captured' as const,
  };
  const playingRed = { type: 'playing' as const, turn: 'red' as const };
  const playingBlack = { type: 'playing' as const, turn: 'black' as const };

  return {
    game: {
      roomId,
      variant: 'dark-xiangqi',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'general-captured',
      plyCount: 1,
      startedAt: '2026-06-18T00:00:00.000Z',
      endedAt: '2026-06-18T00:05:00.000Z',
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
      { type: 'general-captured', at: 3, winner: 'red' },
    ],
    view: xqView('red', ['b1', 'b2'], finished),
    views: {
      red: xqView('red', ['b1', 'b2'], finished),
      truth: xqView('red', ['b1', 'b2'], finished),
      black: xqView('black', ['b9', 'b10'], finished),
    },
    history: {
      red: [
        { ply: 0, view: xqView('red', ['b1', 'b2'], playingRed) },
        { ply: 1, view: xqView('red', ['b1', 'b2'], finished) },
      ],
      truth: [
        { ply: 0, view: xqView('red', ['b1', 'b2'], playingRed) },
        { ply: 1, view: xqView('red', ['b1', 'b2'], finished) },
      ],
      black: [
        { ply: 0, view: xqView('black', ['b9', 'b10'], playingBlack) },
        { ply: 1, view: xqView('black', ['b9', 'b10'], finished) },
      ],
    },
  };
}

function xqView(
  perspective: XiangqiColor,
  visibleSquares: XiangqiSquare[],
  status: DarkXiangqiWireView['status'],
): DarkXiangqiWireView {
  return {
    id: 'dxq-watch-game',
    perspective,
    board: {
      e1: { piece: { color: 'red', role: 'general' }, shrouded: false },
      e10: { piece: { color: 'black', role: 'general' }, shrouded: false },
    },
    visibleSquares,
    legalMoves: [],
    status,
    moveNumber: 1,
    captures: { red: [], black: [] },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}

function railSlots(): { top: HTMLElement; bottom: HTMLElement; pool: HTMLElement } {
  return {
    top: document.createElement('div'),
    bottom: document.createElement('div'),
    pool: document.createElement('div'),
  };
}

function railLabels(slot: HTMLElement): string[] {
  return [...slot.querySelectorAll('.review-capture-piece')].map(
    (piece) => piece.getAttribute('aria-label') ?? '',
  );
}
