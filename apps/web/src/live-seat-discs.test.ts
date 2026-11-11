import { readFileSync } from 'node:fs';
import {
  applyBanqiMove,
  applyJungleFlipMove,
  applyThreeKingdomsBanqiMove,
  createGomokuRoomState,
  createInitialBanqiState,
  createInitialJungleFlipState,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getBanqiLegalMoves,
  getBanqiPlayerView,
  getGomokuPlayerView,
  getJungleFlipLegalMoves,
  getJungleFlipPlayerView,
  getThreeKingdomsBanqiLegalMoves,
  getThreeKingdomsBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({ options: null as TenantSocketClientOptions | null }));
vi.mock('./variant-tenant/socket-client.js', () => ({
  createTenantSocketClient: (options: TenantSocketClientOptions) => {
    socket.options = options;
    return {
      connect: () => {},
      close: () => {},
      reconnectNow: () => {},
      startPing: () => {},
      send: () => true,
      connection: () => 'connected',
      noticeTier: () => 'none',
      closeReason: () => '',
      clientId: () => 'disc-test',
      latencyMs: () => null,
      reconnectAttempt: () => 0,
    };
  },
}));

const ROOM = 'seat_discs';
const timeControl = { initialMs: 180_000, incrementMs: 2000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
  vi.stubEnv('VITE_BANQI_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function mount(bootstrap: () => Promise<void>) {
  await bootstrap();
  if (!socket.options) throw new Error('live room did not create its socket');
  return socket.options;
}

function frame(
  view: { id: string; status: unknown },
  seat: string,
  colors: readonly string[],
  armed: boolean,
): TenantSocketFrame {
  return {
    type: 'hello',
    seat,
    seats: Object.fromEntries(colors.map((color) => [color, `client-${color}`])),
    seatDisplayNames: Object.fromEntries(colors.map((color) => [color, `Player ${color}`])),
    state: view,
    events: [],
    timeControl,
    roomMode: 'pvp',
    clock: armed
      ? {
          ...timeControl,
          activeColor: colors[0],
          remainingMs: Object.fromEntries(colors.map((color) => [color, 175_000])),
          runningSince: null,
        }
      : null,
  } as TenantSocketFrame;
}

function assertDiscs(inks: readonly string[], family?: string) {
  const rows = [...document.querySelectorAll('.clock-player-line')];
  expect(rows).toHaveLength(2);
  const discs = rows.map((row) => row.querySelector('.clock-seat-disc'));
  expect(discs.map((disc) => disc?.className)).toEqual(
    inks.map((ink) => `clock-seat-disc seat-disc seat-disc--${ink}`),
  );
  for (const disc of discs) {
    expect(disc?.nextElementSibling?.classList).toContain('clock-name');
    expect(disc?.getAttribute('aria-hidden')).toBe('true');
    if (family)
      expect(disc?.closest('[data-seat-ink-family]')?.getAttribute('data-seat-ink-family')).toBe(
        family,
      );
  }
}

const openView = {
  id: ROOM,
  perspective: 'red',
  board: {},
  legalMoves: [],
  visibleSquares: [],
  status: { type: 'playing', turn: 'red' },
  moveNumber: 1,
};

describe('live room shared seat discs', () => {
  it.each(['red', 'spectator'])(
    'shows Xiangqi red/black beside names for %s before and after clocks arm',
    async (seat) => {
      const options = await mount(async () => {
        const { bootstrapXiangqiLiveRoom } = await import('./live-xiangqi.js');
        bootstrapXiangqiLiveRoom();
      });
      for (const armed of [false, true]) {
        options.applyHello(frame(openView, seat, ['red', 'black'], armed));
        options.render();
        assertDiscs(['black', 'red']);
      }
    },
  );

  it('scopes Jungle dark ink to the shared blue palette', async () => {
    const options = await mount(async () => {
      const { bootstrapJungleLiveRoom } = await import('./live-jungle.js');
      bootstrapJungleLiveRoom();
    });
    for (const armed of [false, true]) {
      options.applyHello(frame(openView, 'red', ['red', 'black'], armed));
      options.render();
      assertDiscs(['black', 'red'], 'jungle');
    }
  });

  it.each(['red', 'black', 'spectator'] as const)(
    'keeps both Banqi seats unbound for %s, then follows the public first flip',
    async (seat) => {
      const options = await mount(async () => {
        const { bootstrapBanqiLiveRoom } = await import('./live-banqi.js');
        bootstrapBanqiLiveRoom();
      });
      const initial = createInitialBanqiState(ROOM);
      const move = getBanqiLegalMoves(initial).find(
        ({ to }) => initial.board[to]?.color === 'black',
      )!;
      const flipped = applyBanqiMove(initial, move);
      expect(flipped.firstColor).toBe('black');
      for (const armed of [false, true]) {
        for (const state of [initial, flipped]) {
          // Only masked PlayerViews reach the client, including the spectator.
          const view = getBanqiPlayerView(state, seat === 'black' ? 'black' : 'red');
          const payload = frame(view, seat, ['red', 'black'], armed);
          const serialized = JSON.stringify(payload);
          if (state.firstColor === null) expect(serialized).not.toMatch(/"role":|"color":/);
          for (const piece of Object.values(view.board)) {
            if (piece?.faceDown) expect(piece).toEqual({ faceDown: true });
          }
          options.applyHello(payload);
          options.render();
          const bound = state.firstColor !== null;
          const inks = bound ? ['red', 'black'] : ['unbound', 'unbound'];
          assertDiscs(seat === 'black' && bound ? ['black', 'red'] : inks);
          expect(JSON.stringify(payload)).toBe(serialized);
        }
      }
    },
  );

  it('keeps Flip Jungle unbound and then paints the ink assigned by its first flip', async () => {
    const options = await mount(async () => {
      const { bootstrapJungleFlipLiveRoom } = await import('./live-jungle-flip.js');
      bootstrapJungleFlipLiveRoom();
    });
    const initial = createInitialJungleFlipState(ROOM);
    const move = getJungleFlipLegalMoves(initial).find(
      ({ to }) => initial.board[to]?.color === 'black',
    )!;
    const flipped = applyJungleFlipMove(initial, move);
    expect(flipped.firstColor).toBe('black');
    for (const state of [initial, flipped]) {
      options.applyHello(
        frame(getJungleFlipPlayerView(state, 'red'), 'spectator', ['red', 'black'], false),
      );
      options.render();
      assertDiscs(state.firstColor ? ['red', 'black'] : ['unbound', 'unbound'], 'jungle');
    }
  });

  it('uses the public ink binding for Three Kingdoms banqi', async () => {
    const options = await mount(async () => {
      const { bootstrapThreeKingdomsBanqiLiveRoom } = await import(
        './live-three-kingdoms-banqi.js'
      );
      bootstrapThreeKingdomsBanqiLiveRoom();
    });
    const initial = createThreeKingdomsBanqiStateFromSetup(
      ROOM,
      createThreeKingdomsBanqiSetup(() => 0.5),
    );
    const move = getThreeKingdomsBanqiLegalMoves(initial).find(
      ({ to }) => initial.board[to]?.color === 'black',
    )!;
    const flipped = applyThreeKingdomsBanqiMove(initial, move);
    expect(flipped.firstColor).toBe('black');
    for (const state of [initial, flipped]) {
      options.applyHello(
        frame(getThreeKingdomsBanqiPlayerView(state, 'red'), 'red', ['red', 'black'], false),
      );
      options.render();
      assertDiscs(state.firstColor ? ['red', 'black'] : ['unbound', 'unbound']);
    }
  });

  it('uses shared black/white discs for Gomoku and has no custom clock stone', async () => {
    const options = await mount(async () => {
      const { bootstrapGomokuLiveRoom } = await import('./live-gomoku.js');
      bootstrapGomokuLiveRoom();
    });
    const view = getGomokuPlayerView(createGomokuRoomState(ROOM), 'black', true);
    for (const armed of [false, true]) {
      options.applyHello(frame(view, 'spectator', ['black', 'white'], armed));
      options.render();
      assertDiscs(['white', 'black']);
    }
    for (const path of ['src/live-gomoku.ts', 'src/gomoku-board.css']) {
      expect(readFileSync(path, 'utf8')).not.toContain('clock-seat-stone');
    }
  });
});
