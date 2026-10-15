// Rematch is on by default in every tenant room (server: variant-tenant/rematch.ts,
// offered from the shared snapshot `rematch` block). The web half lives in
// variant-tenant/live-client.ts, so a tenant needs no rematch code of its own:
// banqi stands in for every PvP tenant here. Fog Xiangqi used to send no
// roomMode, so a finished bot game read as PvP and showed no Rematch at all.
// Drives the real room modules through a stubbed socket.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
}));

vi.mock('./variant-tenant/socket-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variant-tenant/socket-client.js')>();
  return {
    ...actual,
    createTenantSocketClient: (options: TenantSocketClientOptions) => {
      socket.options = options;
      return {
        connect: () => {},
        close: () => {},
        reconnectNow: () => {},
        send: (payload: unknown) => {
          socket.sent.push(payload);
          return true;
        },
        startPing: () => {},
        connection: () => 'connected',
        noticeTier: () => 'none',
        closeReason: () => '',
        clientId: () => 'test-client',
        latencyMs: () => null,
        reconnectAttempt: () => 0,
      };
    },
  };
});

type Snapshot = Parameters<TenantSocketClientOptions['applySnapshot']>[0];

async function mount(
  room: string,
  boot: () => Promise<void>,
  snapshot: Record<string, unknown>,
): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${room}`);
  socket.options = null;
  socket.sent = [];
  vi.resetModules();
  await boot();
  const options = socket.options as TenantSocketClientOptions | null;
  if (!options) throw new Error('socket was not created');
  options.applySnapshot({ type: 'snapshot', ...snapshot } as Snapshot);
  options.render();
  return options;
}

const FINISHED_EVENTS = (room: string) => [
  { type: 'room-created', roomId: room, at: 0 },
  { type: 'game-finished', winner: 'red', reason: 'resignation', at: 1 },
];

function banqiSnapshot(seat: string, extra: Record<string, unknown> = {}) {
  return {
    seat,
    seats: { red: 'c-red', black: 'c-black' },
    roomMode: 'pvp',
    state: {
      id: 'bq_rematch',
      perspective: seat === 'black' ? 'black' : 'red',
      board: {},
      legalMoves: [],
      captured: [],
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      ply: 0,
      firstColor: 'red',
      moveNumber: 1,
    },
    events: FINISHED_EVENTS('bq_rematch'),
    rematch: { offers: { red: false, black: false }, finalizedRoomId: null },
    ...extra,
  };
}

function darkXiangqiSnapshot(extra: Record<string, unknown>) {
  return {
    seat: 'red',
    seats: { red: 'c-red', black: 'engine' },
    state: {
      id: 'dxq_rematch',
      perspective: 'red',
      board: {},
      visibleSquares: [],
      legalMoves: [],
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: 1,
      captures: { red: [], black: [] },
    },
    events: FINISHED_EVENTS('dxq_rematch'),
    ...extra,
  };
}

const bootBanqi = async () => (await import('./live-banqi.js')).bootstrapBanqiLiveRoom();
const bootDarkXiangqi = async () =>
  (await import('./live-dark-xiangqi.js')).bootstrapDarkXiangqiLiveRoom();

function rematchBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.room-rematch');
}

function buttonsNamed(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
    (button) => button.textContent === label,
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = '';
  fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetchSpy);
});

describe('tenant PvP rematch, on by default', () => {
  it('offers each banqi seat the shared Rematch block, which sends the offer', async () => {
    for (const seat of ['red', 'black'] as const) {
      await mount('bq_rematch', bootBanqi, banqiSnapshot(seat));
      const block = rematchBlock();
      expect(block).not.toBeNull();
      const rematch = [...(block?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Rematch',
      );
      rematch?.click();
      expect(socket.sent).toContainEqual({ type: 'rematch:offer' });
    }
  });

  it('reads an opponent offer from rematch:state through the shared client', async () => {
    const options = await mount('bq_rematch', bootBanqi, banqiSnapshot('red'));
    options.onRematchState?.({
      type: 'rematch:state',
      offers: { red: false, black: true },
      finalizedRoomId: null,
    });
    options.render();
    expect(rematchBlock()?.textContent).toContain('Accept');
  });

  it('shows no rematch block to a spectator', async () => {
    await mount('bq_rematch', bootBanqi, banqiSnapshot('spectator'));
    expect(rematchBlock()).toBeNull();
  });
});

describe('Fog Xiangqi bot rematch', () => {
  it('shows Rematch on a finished bot game and opens a new bot room, colours swapped', async () => {
    await mount(
      'dxq_rematch',
      bootDarkXiangqi,
      darkXiangqiSnapshot({ roomMode: 'pve', pveEngineId: 'dxq-bot-l3' }),
    );
    expect(rematchBlock()).toBeNull();
    const [rematch] = buttonsNamed('Rematch');
    expect(rematch).toBeDefined();
    const roomPosts = () =>
      (fetchSpy.mock.calls as [string, RequestInit][]).filter(([url]) => url === '/api/rooms');
    rematch?.click();
    await vi.waitFor(() => expect(roomPosts()).toHaveLength(1));
    const [[, init]] = roomPosts();
    expect(JSON.parse(String(init.body))).toMatchObject({
      mode: 'pve',
      gameSpecId: 'dark-xiangqi',
      engineId: 'dxq-bot-l3',
      preferredColor: 'black',
    });
  });

  it('a PvP room still gets the person rematch, not a bot room', async () => {
    await mount(
      'dxq_rematch',
      bootDarkXiangqi,
      darkXiangqiSnapshot({
        roomMode: 'pvp',
        seats: { red: 'c-red', black: 'c-black' },
        rematch: { offers: { red: false, black: false }, finalizedRoomId: null },
      }),
    );
    expect(rematchBlock()).not.toBeNull();
  });
});
