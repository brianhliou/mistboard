// A "Just finished" card on /games names each player above or below the final
// position, on the side of the thumbnail their pieces start from. The names are
// placed before the board mounts (FINISHED_BOARD_BOTTOM_SEAT), then follow the
// mounted board's own bottomSeat(); these tests pin the expected seat to what
// both renderers actually draw with the options /games mounts them with.
import {
  applyCrazyhouseXiangqiMove,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  type GameEvent,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { buildFinishedTile, placeFinishedSeats } from './current-games.js';
import {
  FINISHED_BOARD_BOTTOM_SEAT,
  FINISHED_BOARD_POV,
  finishedBoardTenantPov,
  seatsTopToBottom,
} from './current-games-model.js';
import type { FeaturedGame, GameParticipant } from './game-display.js';
import { mountShowcaseBoard } from './showcase-board.js';

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: null, visibility: 'public' };
}

function finishedGame(overrides: Partial<FeaturedGame>): FeaturedGame {
  return {
    roomId: 'finished-room',
    variant: 'xiangqi',
    result: 'red-wins',
    termination: 'checkmate',
    plyCount: 2,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt: '2026-10-09T12:00:00.000Z',
    ...overrides,
  };
}

// The tile's rows top to bottom, as "seat:text" ("board" for the thumbnail).
function rowOrder(tile: HTMLElement): string[] {
  return [...tile.children].map((child) => {
    const el = child as HTMLElement;
    if (el.classList.contains('current-game-board')) return 'board';
    if (el.classList.contains('current-game-finished-seat'))
      return `${el.dataset.seat}:${el.textContent}`;
    return el.className;
  });
}

describe('seatsTopToBottom', () => {
  it('puts the bottom seat below the board and the other above', () => {
    expect(seatsTopToBottom(['Red', 'Black'], 'first')).toEqual(['Black', 'Red']);
  });

  it('swaps the rows for a board turned to the second seat', () => {
    expect(seatsTopToBottom(['Red', 'Black'], 'second')).toEqual(['Red', 'Black']);
  });
});

describe('finished card name rows', () => {
  it('places a xiangqi game: Black above the board, Red below', () => {
    const tile = buildFinishedTile(
      finishedGame({
        participants: [participant('red', 'Fairy-Stockfish'), participant('black', 'Opponent')],
      }),
    );
    expect(rowOrder(tile)).toEqual([
      'second:Opponent',
      'board',
      'first:Fairy-Stockfish',
      'current-game-finished-line',
    ]);
    // The full names stay on the rows for the hover title, ellipsis or not.
    expect(tile.querySelector<HTMLElement>('[data-seat="first"]')?.title).toBe('Fairy-Stockfish');
  });

  it('places a chess-family game: Black above, White below', () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: 'dark-chess',
        result: 'white-wins',
        participants: [participant('black', 'Black player'), participant('white', 'White player')],
      }),
    );
    expect(rowOrder(tile).slice(0, 3)).toEqual([
      'second:Black player',
      'board',
      'first:White player',
    ]);
  });

  it('follows a board turned to the second seat, and back', () => {
    const tile = buildFinishedTile(
      finishedGame({
        participants: [participant('red', 'Red player'), participant('black', 'Black player')],
      }),
    );
    placeFinishedSeats(tile, 'second');
    expect(rowOrder(tile).slice(0, 3)).toEqual([
      'first:Red player',
      'board',
      'second:Black player',
    ]);
    placeFinishedSeats(tile, 'first');
    expect(rowOrder(tile).slice(0, 3)).toEqual([
      'second:Black player',
      'board',
      'first:Red player',
    ]);
  });
});

const ROOM_ID = 'finished-seat-room';
const NAMES = { [ROOM_ID]: { first: 'First seat', second: 'Second seat' } };

const CHESS_EVENTS: GameEvent[] = [
  { type: 'room-created', at: 1, roomId: ROOM_ID, variant: 'dark-chess' },
  { type: 'move-played', at: 2, roomId: ROOM_ID, color: 'white', move: { from: 'e2', to: 'e4' } },
  { type: 'move-played', at: 3, roomId: ROOM_ID, color: 'black', move: { from: 'e7', to: 'e5' } },
];

// A finished Crazyhouse Xiangqi postgame (the tenant compact renderer).
function tenantPostgame(): Record<string, unknown> {
  const line: CrazyhouseXiangqiMove[] = [
    { from: 'h3', to: 'h10' },
    { from: 'i10', to: 'h10' },
  ];
  let state = createInitialCrazyhouseXiangqiState(ROOM_ID);
  const truth = [{ ply: 0, view: getCrazyhouseXiangqiPlayerView(state, 'red') }];
  const timeline: Array<Record<string, unknown>> = [];
  line.forEach((move, index) => {
    const color = state.status.type === 'playing' ? state.status.turn : 'red';
    state = applyCrazyhouseXiangqiMove(state, move);
    timeline.push({ type: 'move-played', at: 10 + index, color, move, ply: index + 1 });
    truth.push({ ply: index + 1, view: getCrazyhouseXiangqiPlayerView(state, 'red') });
  });
  const view = getCrazyhouseXiangqiPlayerView(state, 'red');
  return {
    game: {
      roomId: ROOM_ID,
      variant: CRAZYHOUSE_XIANGQI_SPEC_ID,
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: line.length,
      startedAt: '2026-10-09T12:00:00.000Z',
      endedAt: '2026-10-09T12:05:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 300_000,
      incrementMs: 5_000,
    },
    state: {
      status: view.status,
      moveNumber: view.moveNumber,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    },
    timeline,
    view,
    views: { truth: view },
    history: { truth },
  };
}

// The options current-games.ts mountFinishedBoard passes, with the fetches
// replaced by fixtures.
async function mountFinished(root: HTMLElement, specId: string) {
  const tenantPov = finishedBoardTenantPov(specId);
  const postgame = tenantPostgame();
  return mountShowcaseBoard(root, specId, ROOM_ID, {
    autoplay: false,
    hideReserve: true,
    loaderForId: async () => CHESS_EVENTS,
    loadPostgameOverride: async () => ({ ok: true, postgame }),
    metadataByRoomId: {},
    namesByRoomId: NAMES,
    onLoadError: () => true,
    pov: FINISHED_BOARD_POV,
    revealOnFinish: true,
    ...(tenantPov ? { tenantPov } : {}),
  });
}

describe('the thumbnail orientation the names follow', () => {
  it('chess renderer: the first mover (White) is at the bottom', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountFinished(root, 'dark-chess');
    try {
      expect(handle.bottomSeat?.()).toBe(FINISHED_BOARD_BOTTOM_SEAT);
    } finally {
      handle.destroy();
      root.remove();
    }
  });

  it('tenant renderer: the first mover (Red) is at the bottom', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const handle = await mountFinished(root, CRAZYHOUSE_XIANGQI_SPEC_ID);
    try {
      expect(handle.bottomSeat?.()).toBe(FINISHED_BOARD_BOTTOM_SEAT);
      // The renderer's own (hidden) seat rows agree: the first seat's name last.
      const seats = [...root.querySelectorAll('.showcase-seat')].map((el) => el.textContent ?? '');
      expect(seats.at(-1)).toContain('First seat');
      expect(seats[0]).toContain('Second seat');
    } finally {
      handle.destroy();
      root.remove();
    }
  });

  it('draws fog games with the fog off, open games as the tenant picks', () => {
    expect(finishedBoardTenantPov('dark-xiangqi')).toBe('truth');
    expect(finishedBoardTenantPov('xiangqi')).toBeNull();
    expect(finishedBoardTenantPov('jieqi')).toBeNull();
  });
});
