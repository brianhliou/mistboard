import type { JungleFlipMove, JungleFlipPlayerBoard, JungleFlipPlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JungleFlipPostgameResponse } from './live-jungle-flip-postgame.js';
import { mountJungleFlipWatchReplay } from './watch-jungle-flip-replay.js';

describe('Flip Jungle watch replay', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts a Flip Jungle TV replay with one masked board, a Reveal control, and seat-ink result', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      return jsonResponse(postgameFixture(String(input).split('/').pop() ?? 'jgf_watch'));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    const handle = await mountJungleFlipWatchReplay(root, 'jgf_watch', { autoplay: false });

    expect(fetchSpy).toHaveBeenCalledWith('/api/jungle-flip/games/jgf_watch');
    expect(handle.activeSampleId()).toBe('jgf_watch');
    expect(root.textContent).toContain('Human vs human');
    // Seat 'red' (first mover) bound the navy ink, so 'red-wins' reads "Blue wins".
    expect(root.textContent).toContain('Blue wins');
    expect(root.querySelectorAll('svg.jungle-flip-live-svg')).toHaveLength(1);
    // The /watch move list names the animal the opening flip turned up, never "a1-a1".
    expect(handle.moveEntries?.().map((entry) => entry.label)).toEqual(['a1(r)']);
    // Hidden identities → a Reveal control is present.
    const reveal = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (el) => el.textContent === 'Reveal',
    );
    expect(reveal).not.toBeUndefined();

    // At ply 0 the as-played mask paints a face-down back (banqi-style jade disc).
    const board = () => root.querySelector('svg.jungle-flip-live-svg') as SVGElement;
    expect(board().outerHTML).toContain('fill="#2f8f6b"');
    reveal!.click();
    // Revealed overlay: no tile shows the back disc.
    expect(board().outerHTML).not.toContain('fill="#2f8f6b"');

    handle.destroy();
    expect(root.childElementCount).toBe(0);
  });

  // Mistboard TV's rail: the room's material from the masked view the board shows.
  // The first seat flipped black, so the bottom strip holds what black captured.
  it('fills the TV rail with the captured animals and the face-down pool at the ply', async () => {
    const postgame = postgameFixture('jgf_mat');
    const ply1 = postgame.history?.truth?.[1];
    if (ply1) ply1.view = { ...ply1.view, captured: [{ owner: 'red', role: 'cat' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgame)),
    );
    const root = document.createElement('div');
    const handle = await mountJungleFlipWatchReplay(root, 'jgf_mat', {
      autoplay: false,
      compact: true,
    });
    const slots = railSlots();

    expect(handle.fillMaterial).toBeTypeOf('function');
    handle.jumpToPly?.(0);
    handle.fillMaterial?.(slots);
    expect(railLabels(slots.bottom)).toEqual([]);
    expect(slots.pool.querySelectorAll('.hidden-pool__row')).toHaveLength(2);

    handle.jumpToPly?.(1);
    handle.fillMaterial?.(slots);
    expect(railLabels(slots.top)).toEqual([]);
    expect(railLabels(slots.bottom)).toEqual(['red cat']);
    handle.destroy();
  });
});

function postgameFixture(roomId: string): JungleFlipPostgameResponse {
  const move: JungleFlipMove = { from: 'a1', to: 'a1' };
  const finished = {
    type: 'finished' as const,
    winner: 'red' as const,
    reason: 'resignation' as const,
  };
  const playingBlack = { type: 'playing' as const, turn: 'black' as const };
  const maskedStart: JungleFlipPlayerBoard = { a1: { faceDown: true }, b2: { faceDown: true } };
  const revealedBoard: JungleFlipPlayerBoard = {
    a1: { color: 'black', role: 'rat', faceDown: false },
    b2: { color: 'red', role: 'elephant', faceDown: false },
  };

  return {
    game: {
      roomId,
      variant: 'jungle-flip',
      mode: 'pvp',
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
    // First mover ('red' seat) flipped black, so firstColor is 'black'.
    view: view(revealedBoard, move, finished, 1),
    history: {
      truth: [
        { ply: 0, view: view(maskedStart, undefined, playingBlack, 0) },
        { ply: 1, view: view(revealedBoard, move, finished, 1) },
      ],
      revealed: [
        { ply: 0, view: view(revealedBoard, undefined, playingBlack, 0) },
        { ply: 1, view: view(revealedBoard, move, finished, 1) },
      ],
    },
  };
}

function view(
  board: JungleFlipPlayerBoard,
  lastMove: JungleFlipMove | undefined,
  status: JungleFlipPlayerView['status'],
  ply: number,
): JungleFlipPlayerView {
  return {
    id: `${Object.keys(board).join('')}-${ply}`,
    perspective: 'red',
    board,
    legalMoves: [],
    captured: [],
    status,
    ply,
    firstColor: 'black',
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
