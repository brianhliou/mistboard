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

  // The homepage TV's seat discs. Banqi seats are move-order slots, so the disc
  // must paint the ink the opening flip bound, not the seat id: when the first
  // mover flips a black piece, the first seat plays Black.
  it('compact seat discs paint the bound ink, the dashed ring before the flip, and nothing unasked', async () => {
    const discs = (root: HTMLElement): Record<string, string> =>
      Object.fromEntries(
        [...root.querySelectorAll<HTMLElement>('.showcase-seat')].map((row) => [
          row.querySelector('.showcase-seat-name')?.textContent ?? '',
          row.querySelector('.seat-disc')?.className ?? 'none',
        ]),
      );
    const names = { bq_disc: { first: 'FirstMover', second: 'SecondMover' } };
    const mount = async (firstColor: BanqiSeat | null, seatDiscs: boolean) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(postgameFixture('bq_disc', firstColor))),
      );
      const root = document.createElement('div');
      const handle = await mountBanqiWatchReplay(root, 'bq_disc', {
        autoplay: false,
        compact: true,
        namesByRoomId: names,
        seatDiscs,
      });
      const result = discs(root);
      handle.destroy();
      return result;
    };

    expect(await mount('black', true)).toEqual({
      FirstMover: 'seat-disc seat-disc--black',
      SecondMover: 'seat-disc seat-disc--red',
    });
    expect(await mount('red', true)).toEqual({
      FirstMover: 'seat-disc seat-disc--red',
      SecondMover: 'seat-disc seat-disc--black',
    });
    expect(await mount(null, true)).toEqual({
      FirstMover: 'seat-disc seat-disc--unbound',
      SecondMover: 'seat-disc seat-disc--unbound',
    });
    // Other compact hosts (current-games cards, /watch queue previews) style the
    // seat rows themselves; an unasked disc would shift their layout.
    expect(await mount('black', false)).toEqual({ FirstMover: 'none', SecondMover: 'none' });
  });

  it('live follow: the rings bind to the flipped ink when the next frame lands', async () => {
    const discs = (root: HTMLElement): string[] =>
      [...root.querySelectorAll<HTMLElement>('.showcase-seat')].map(
        (row) =>
          `${row.querySelector('.showcase-seat-name')?.textContent}:${row.querySelector('.seat-disc')?.className.replace('seat-disc seat-disc--', '')}`,
      );
    const frame = (firstColor: BanqiSeat | null): BanqiPostgameResponse => {
      const fixture = postgameFixture('bq_live', firstColor);
      return {
        ...fixture,
        game: { ...fixture.game, result: 'in-progress', termination: 'in-progress' },
      };
    };
    let current = frame(null);
    const root = document.createElement('div');
    const handle = await mountBanqiWatchReplay(root, 'bq_live', {
      autoplay: false,
      compact: true,
      live: true,
      seatDiscs: true,
      loadPostgameOverride: async () => ({ ok: true, postgame: current }),
      namesByRoomId: { bq_live: { first: 'FirstMover', second: 'SecondMover' } },
    });
    // No flip yet: nobody owns a colour, so both seats wear the dashed ring.
    expect(discs(root)).toEqual(['SecondMover:unbound', 'FirstMover:unbound']);

    // The first mover flips a black piece; the homepage reloads the live handle.
    current = frame('black');
    await handle.loadGame('bq_live');
    expect(discs(root)).toEqual(['SecondMover:red', 'FirstMover:black']);
    handle.destroy();
  });
});

// A minimal one-ply fixture: red flips a1 (revealing a chariot); only the truth
// surface is present, matching banqi's symmetric postgame (no per-color views).
function postgameFixture(
  roomId: string,
  firstColor: BanqiSeat | null = 'red',
): BanqiPostgameResponse {
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
    view: { ...view('red', movedBoard, move, finished, 1), firstColor },
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
