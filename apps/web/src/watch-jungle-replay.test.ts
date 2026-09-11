import type { JungleBoard, JungleMove, JunglePlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JUNGLE_LAST_MOVE } from './jungle-art.js';
import type { JunglePostgameResponse } from './live-jungle-postgame.js';
import { mountJungleWatchReplay } from './watch-jungle-replay.js';
import { formatClock } from './web-utils.js';

describe('Jungle watch replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts a Jungle TV replay with a single perfect-info board and controls', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      return jsonResponse(postgameFixture(String(input).split('/').pop() ?? 'jgl_watch'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    const handle = await mountJungleWatchReplay(root, 'jgl_watch', { autoplay: false });

    expect(fetchSpy).toHaveBeenCalledWith('/api/jungle/games/jgl_watch');
    expect(handle.activeSampleId()).toBe('jgl_watch');
    expect(root.textContent).toContain('Human vs engine');
    expect(root.textContent).toContain('Red wins');
    expect(root.textContent).toContain('Ply 0 / 1');
    // Perfect-info: one truth board, no triptych.
    expect(root.querySelectorAll('svg.jungle-live-svg')).toHaveLength(1);
    expectJungleBoardHasInteriorGridOnly(root.querySelector('svg.jungle-live-svg'));
    // No hidden identities, so no Reveal control (unlike Flip Jungle).
    expect(root.textContent).not.toContain('Reveal');

    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    expect(root.textContent).toContain('Ply 1 / 1 - Red wins');

    handle.destroy();
    expect(root.childElementCount).toBe(0);
  });

  it('draws the last-move marks at a nonzero ply and none at the start', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture('jgl_lastmove'))),
    );
    const root = document.createElement('div');

    const handle = await mountJungleWatchReplay(root, 'jgl_lastmove', { autoplay: false });

    // Ply 0: no move played yet, so no last-move marks on the board.
    const boardSvg = () => root.querySelector('svg.jungle-live-svg');
    expect(boardSvg()).not.toBeNull();
    expect(boardSvg()!.querySelector('[class^="jungle-last-move"]')).toBeNull();

    // Ply 1: the a3-a4 move tints a3 and a4 in the mover's ink (shared
    // JUNGLE_LAST_MOVE grammar).
    root.querySelector<HTMLButtonElement>('[aria-label="Next move"]')?.click();
    const marks = [...boardSvg()!.querySelectorAll('[class^="jungle-last-move"]')];
    expect(marks.map((m) => m.getAttribute('class'))).toEqual([
      'jungle-last-move-from',
      'jungle-last-move-to',
    ]);
    expect(marks.map((m) => m.getAttribute('fill'))).toEqual([
      JUNGLE_LAST_MOVE.fill.red.from,
      JUNGLE_LAST_MOVE.fill.red.to,
    ]);

    handle.destroy();
  });

  it("live follow (homepage): the mover's clock counts down from the server snapshot between polls", async () => {
    // The reconstruction from move timestamps only knows about moves that have
    // landed, so on its own the clock froze between polls. A live frame carries the
    // server clock; the compact board projects it to now on every tick.
    vi.useFakeTimers();
    const base = 1_700_000_000_000;
    vi.setSystemTime(base);
    const fixture = postgameFixture('jgl_live');
    const livePostgame: JunglePostgameResponse = {
      ...fixture,
      game: { ...fixture.game, result: 'in-progress', termination: 'in-progress' },
      state: {
        ...fixture.state,
        clock: {
          activeColor: 'black',
          incrementMs: 2_000,
          initialMs: 180_000,
          remainingMs: { red: 178_000, black: 170_000 },
          runningSince: base - 500,
        },
      },
    };
    const root = document.createElement('div');
    // Keyed by seat name so the assertion holds whichever side the board seats at the bottom.
    const clockText = (): Record<string, string> =>
      Object.fromEntries(
        [...root.querySelectorAll<HTMLElement>('.showcase-seat')].map((row) => [
          row.querySelector('.showcase-seat-name')?.textContent ?? '',
          row.querySelector('.showcase-seat-clock')?.textContent ?? '',
        ]),
      );

    const handle = await mountJungleWatchReplay(root, 'jgl_live', {
      autoplay: false,
      compact: true,
      live: true,
      loadPostgameOverride: async () => ({ ok: true, postgame: livePostgame }),
      namesByRoomId: { jgl_live: { first: 'RedSeat', second: 'BlackSeat' } },
    });
    handle.jumpToPly?.(1);
    // Black is on the move and already 500ms into it when the frame lands.
    expect(clockText()).toEqual({ RedSeat: formatClock(178_000), BlackSeat: formatClock(169_500) });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(clockText()).toEqual({ RedSeat: formatClock(178_000), BlackSeat: formatClock(168_000) });
    expect(handle.clockAtPly?.()).toEqual({ first: 178_000, second: 168_000, toMove: 'second' });

    // Scrubbed back from the newest ply, the recorded value shows, not the projection.
    handle.jumpToPly?.(0);
    expect(clockText()).toEqual({ RedSeat: formatClock(180_000), BlackSeat: formatClock(180_000) });

    handle.destroy();
    vi.useRealTimers();
  });

  it('compact pov=black seats Black at the bottom; a perfect-info game keeps the truth board', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture('jgl_pov'))),
    );
    const seatNames = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>('.showcase-seat-name')].map((el) => el.textContent);
    const names = { jgl_pov: { first: 'RedSeat', second: 'BlackSeat' } };

    const plain = document.createElement('div');
    const plainHandle = await mountJungleWatchReplay(plain, 'jgl_pov', {
      autoplay: false,
      compact: true,
      namesByRoomId: names,
    });
    // Jungle is perfect information: the showcase seats Red at the bottom.
    expect(seatNames(plain)).toEqual(['BlackSeat', 'RedSeat']);
    plainHandle.destroy();

    const flipped = document.createElement('div');
    const flippedHandle = await mountJungleWatchReplay(flipped, 'jgl_pov', {
      autoplay: false,
      compact: true,
      pov: 'black',
      namesByRoomId: names,
    });
    expect(seatNames(flipped)).toEqual(['RedSeat', 'BlackSeat']);
    // Still one board, still the truth view: pov on a perfect-info game is a turn, not a mask.
    expect(flipped.querySelectorAll('.showcase-board, .replay-board').length).toBeGreaterThan(0);
    flippedHandle.destroy();
  });

  it('a finished game never projects a stored clock, even one left running', async () => {
    vi.useFakeTimers();
    const base = 1_700_000_000_000;
    vi.setSystemTime(base);
    const fixture = postgameFixture('jgl_done');
    const finished: JunglePostgameResponse = {
      ...fixture,
      state: {
        ...fixture.state,
        clock: {
          activeColor: 'black',
          incrementMs: 2_000,
          initialMs: 180_000,
          remainingMs: { red: 178_000, black: 170_000 },
          runningSince: base - 500,
        },
      },
    };
    const root = document.createElement('div');
    const handle = await mountJungleWatchReplay(root, 'jgl_done', {
      autoplay: false,
      compact: true,
      live: true,
      loadPostgameOverride: async () => ({ ok: true, postgame: finished }),
    });
    handle.jumpToPly?.(1);
    const before = [...root.querySelectorAll<HTMLElement>('.showcase-seat-clock')].map(
      (el) => el.textContent,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    const after = [...root.querySelectorAll<HTMLElement>('.showcase-seat-clock')].map(
      (el) => el.textContent,
    );
    expect(after).toEqual(before);
    handle.destroy();
    vi.useRealTimers();
  });
});

function expectJungleBoardHasInteriorGridOnly(board: SVGSVGElement | null): void {
  expect(board).not.toBeNull();
  const gridLines = [...(board?.querySelectorAll('line') ?? [])].filter(
    (line) => line.getAttribute('stroke') === 'rgba(91,74,50,0.55)',
  );

  expect(gridLines).toHaveLength(14);
  for (const line of gridLines) {
    const x1 = line.getAttribute('x1');
    const x2 = line.getAttribute('x2');
    const y1 = line.getAttribute('y1');
    const y2 = line.getAttribute('y2');
    if (x1 === x2) expect(x1).not.toMatch(/^(0|336)$/);
    if (y1 === y2) expect(y1).not.toMatch(/^(0|432)$/);
  }
}

function postgameFixture(roomId: string): JunglePostgameResponse {
  const move: JungleMove = { from: 'a3', to: 'a4' };
  const finished = {
    type: 'finished' as const,
    winner: 'red' as const,
    reason: 'resignation' as const,
  };
  const playingBlack = { type: 'playing' as const, turn: 'black' as const };

  return {
    game: {
      roomId,
      variant: 'jungle',
      mode: 'pve',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-06-24T12:00:00.000Z',
      endedAt: '2026-06-24T12:05:00.000Z',
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
    view: view({ a4: { color: 'red', role: 'rat' } }, move, finished, 1),
    history: [
      { ply: 0, view: view({ a3: { color: 'red', role: 'rat' } }, undefined, playingBlack, 0) },
      { ply: 1, view: view({ a4: { color: 'red', role: 'rat' } }, move, finished, 1) },
    ],
  };
}

function view(
  board: JungleBoard,
  lastMove: JungleMove | undefined,
  status: JunglePlayerView['status'],
  ply: number,
): JunglePlayerView {
  return {
    id: `${Object.keys(board).join('')}-${ply}`,
    perspective: 'red',
    board,
    visibleSquares: [],
    legalMoves: [],
    status,
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
