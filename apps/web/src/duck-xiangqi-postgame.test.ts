import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  getDuckXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISPLAY_PREFERENCES_CHANGE_EVENT } from './display-preferences.js';
import * as duckXiangqiBoard from './duck-xiangqi-board.js';
import {
  type DuckXiangqiPostgameResponse,
  duckXiangqiPostgameApiUrl,
  mountDuckXiangqiPostgame,
} from './duck-xiangqi-postgame.js';
import { duckXiangqiTurnLabel } from './duck-xiangqi-turn-label.js';

const ROOM_ID = 'dkx_postgame';

// Two real turns through the kernel, so the fixture's per-ply snapshots carry
// the duck exactly as the server would send them.
const TURNS: DuckXiangqiTurn[] = [
  { from: 'a4', to: 'a5', duckTo: 'e5' },
  { from: 'a7', to: 'a6', duckTo: 'e6' },
];

describe('Duck Xiangqi postgame page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds the public postgame API URL', () => {
    expect(duckXiangqiPostgameApiUrl('dkx room')).toBe('/api/duck-xiangqi/games/dkx%20room');
  });

  it('writes a turn as from-to@duck, and a general capture as x…#', () => {
    expect(duckXiangqiTurnLabel({ from: 'a4', to: 'a5', duckTo: 'e5' })).toBe('a4-a5@e5');
    expect(duckXiangqiTurnLabel({ from: 'e3', to: 'e10', duckTo: null })).toBe('e3xe10#');
  });

  it('mounts the review with the board, the duck, and the @ move notation', async () => {
    const fixture = postgameFixture();
    const fetchSpy = vi.fn(async () => jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountDuckXiangqiPostgame(root, ROOM_ID);
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith(`/api/duck-xiangqi/games/${ROOM_ID}`);
    expect(root.querySelector('.site-nav')).not.toBeNull();
    expect(root.querySelector('.review-shell')).not.toBeNull();
    expect(root.textContent).toContain('Duck Xiangqi');
    expect(root.textContent).toContain('Black is victorious');

    // The board is one perfect-information host (no per-seat POV secondaries).
    const boards = root.querySelectorAll('.duck-xiangqi-postgame__board');
    expect(boards).toHaveLength(1);
    expect(boards[0]?.querySelector('svg.dkx-live-svg')).not.toBeNull();
    // Non-interactive: no click layer and no target dots on a finished game.
    expect(boards[0]?.querySelector('.dkx-click')).toBeNull();
    expect(boards[0]?.querySelector('.dkx-target--duck')).toBeNull();

    // The move list writes the whole turn, duck half included.
    const moveButtons = root.querySelectorAll<HTMLButtonElement>('.review-move-list__move');
    expect(moveButtons).toHaveLength(2);
    expect(moveButtons[0]?.textContent).toContain('a4-a5@e5');
    expect(moveButtons[1]?.textContent).toContain('a7-a6@e6');
  });

  it('draws the duck on every ply, and nothing on ply 0 where it is off the board', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(postgameFixture()));
    const root = document.createElement('div');

    mountDuckXiangqiPostgame(root, ROOM_ID);
    await flushPromises();

    const duckSquare = (): string | null =>
      root.querySelector('.dkx-duck')?.getAttribute('data-duck-square') ?? null;

    // Mount lands on the last ply.
    expect(duckSquare()).toBe('e6');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(duckSquare()).toBe('e5');

    // Ply 0 is the start position: the duck has not been placed yet, so the
    // layer draws nothing rather than a stale square from the next ply.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(duckSquare()).toBeNull();
    // The board itself is still there — an absent duck is not an absent board.
    expect(root.querySelector('svg.dkx-live-svg')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(duckSquare()).toBe('e6');
  });

  it('glides adjacent replay steps in either direction, but not the first paint or jumps', async () => {
    const fixture = postgameFixture();
    vi.stubGlobal('fetch', async () => jsonResponse(fixture));
    const animate = vi.spyOn(duckXiangqiBoard, 'animateDuckXiangqiTurn');
    const root = document.createElement('div');

    mountDuckXiangqiPostgame(root, ROOM_ID);
    await flushPromises();

    const board = root.querySelector('.duck-xiangqi-postgame__board');
    const history = fixture.history!.truth!;
    const navigate = (action: string): void =>
      root.querySelector<HTMLButtonElement>(`[data-replay="${action}"]`)!.click();
    expect(animate).not.toHaveBeenCalled();
    navigate('first');
    expect(animate).not.toHaveBeenCalled();

    for (const ply of [1, 2]) {
      navigate('next');
      expect(animate).toHaveBeenCalledExactlyOnceWith(
        board,
        history[ply - 1]!.view,
        history[ply]!.view,
        'red',
        { reverse: false },
      );
      expect(board?.querySelector('.dkx-duck')?.getAttribute('data-duck-square')).toBe(
        history[ply]!.view.duck,
      );
      animate.mockClear();
    }

    for (const ply of [2, 1]) {
      navigate('prev');
      expect(animate).toHaveBeenCalledExactlyOnceWith(
        board,
        history[ply - 1]!.view,
        history[ply]!.view,
        'red',
        { reverse: true },
      );
      animate.mockClear();
    }

    navigate('latest');
    expect(animate).not.toHaveBeenCalled();
    expect(board?.querySelector('.dkx-duck')?.getAttribute('data-duck-square')).toBe('e6');
  });

  it('repaints flips and appearance changes without gliding, then steps from the new orientation', async () => {
    const fixture = postgameFixture();
    vi.stubGlobal('fetch', async () => jsonResponse(fixture));
    const animate = vi.spyOn(duckXiangqiBoard, 'animateDuckXiangqiTurn');
    const root = document.createElement('div');

    mountDuckXiangqiPostgame(root, ROOM_ID);
    await flushPromises();

    const flip = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find(
      (item) => item.textContent?.trim() === 'Flip board',
    );
    expect(flip).toBeDefined();
    flip!.click();
    expect(animate).not.toHaveBeenCalled();

    root.querySelector<HTMLButtonElement>('[data-replay="prev"]')!.click();
    expect(animate).toHaveBeenCalledExactlyOnceWith(
      root.querySelector('.duck-xiangqi-postgame__board'),
      fixture.history!.truth![1]!.view,
      fixture.history!.truth![2]!.view,
      'black',
      { reverse: true },
    );
    animate.mockClear();

    window.dispatchEvent(new Event(DISPLAY_PREFERENCES_CHANGE_EVENT));
    expect(animate).not.toHaveBeenCalled();
  });
});

function postgameFixture(): DuckXiangqiPostgameResponse {
  const finalStatus = { type: 'finished', winner: 'black', reason: 'resignation' } as const;
  let state: DuckXiangqiGameState = createInitialDuckXiangqiState(ROOM_ID);
  const history = [{ ply: 0, view: getDuckXiangqiPlayerView(state, 'red') }];
  TURNS.forEach((turn, index) => {
    state = applyDuckXiangqiTurn(state, turn);
    history.push({ ply: index + 1, view: getDuckXiangqiPlayerView(state, 'red') });
  });
  const truth = {
    ...getDuckXiangqiPlayerView(state, 'red'),
    status: finalStatus,
  };
  return {
    game: {
      roomId: ROOM_ID,
      variant: 'duck-xiangqi',
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: TURNS.length,
      startedAt: '2026-09-09T08:00:00.000Z',
      endedAt: '2026-09-09T08:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 300000,
      incrementMs: 5000,
      players: [
        { color: 'red', name: 'Red player', rating: null, kind: 'guest' },
        { color: 'black', name: 'Black player', rating: null, kind: 'guest' },
      ],
    },
    state: {
      status: finalStatus,
      moveNumber: state.moveNumber,
      timeControl: { initialMs: 300000, incrementMs: 5000 },
    },
    timeline: TURNS.map((move, index) => ({
      type: 'move-played',
      at: 10 + index,
      color: index % 2 === 0 ? ('red' as const) : ('black' as const),
      move,
      ply: index + 1,
    })),
    view: truth,
    views: { truth },
    history: { truth: history },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}
