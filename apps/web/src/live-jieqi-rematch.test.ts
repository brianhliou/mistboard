// A finished jieqi PvP room offers both seats a mutual rematch (server:
// variant-tenant/rematch.ts through jieqi-registration). Before this, a seated
// player got only New opponent and Review (docs-private/jieqi-loop-qa-2026-10.md,
// issue 1). Drives the real room module (live-jieqi.ts) through a stubbed socket.

import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  jieqiTruthBoard,
  jieqiTruthCaptures,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JIEQI_SAMPLE_GAME } from './jieqi-sample-game.js';
import type { JieqiWireView } from './live-jieqi.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
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

const ROOM = 'jq_rematch';
const MOVES: JieqiMove[] = JIEQI_SAMPLE_GAME.moves
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((token) => {
    const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token)!;
    return { from: match[1], to: match[2] } as JieqiMove;
  });

function finishedState(): JieqiGameState {
  let state = createInitialJieqiState(ROOM, JIEQI_SAMPLE_GAME.deal);
  for (const move of MOVES) state = applyJieqiMove(state, move);
  return { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
}

function truthView(state: JieqiGameState): JieqiWireView {
  return {
    ...getJieqiPlayerView(state, 'red'),
    board: jieqiTruthBoard(state),
    captured: jieqiTruthCaptures(state),
    legalMoves: [],
  } as JieqiWireView;
}

const EVENTS: TenantLiveEvent[] = [
  { type: 'room-created', roomId: ROOM, at: 0 },
  ...MOVES.map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'red' : 'black',
    move,
    at: index + 1,
    ply: index + 1,
  })),
  { type: 'game-finished', winner: 'red', reason: 'resignation', at: 9 },
];

async function mountFinished(
  seat: JieqiColor | 'spectator',
  extra: Record<string, unknown> = {},
): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  socket.sent = [];
  vi.resetModules();
  const { bootstrapJieqiLiveRoom } = await import('./live-jieqi.js');
  bootstrapJieqiLiveRoom();
  const options = socket.options as TenantSocketClientOptions | null;
  if (!options) throw new Error('socket was not created');
  // The extras ride the frame untyped, as on the wire.
  const snapshot: Record<string, unknown> = {
    type: 'snapshot',
    seat,
    seats: { red: 'c-red', black: 'c-black' },
    roomMode: 'pvp',
    state: truthView(finishedState()),
    events: EVENTS,
    rematch: { offers: { red: false, black: false }, finalizedRoomId: null },
    ...extra,
  };
  options.applySnapshot(snapshot as Parameters<TenantSocketClientOptions['applySnapshot']>[0]);
  options.render();
  return options;
}

function rematchBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.room-rematch');
}
function labels(): string[] {
  return [...(rematchBlock()?.querySelectorAll('button') ?? [])].map((b) => b.textContent ?? '');
}
function click(label: string): void {
  const button = [...(rematchBlock()?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`no ${label} button in ${labels().join(', ')}`);
  button.click();
}
function noteText(): string | null {
  return rematchBlock()?.querySelector('.room-rematch-note')?.textContent ?? null;
}
function state(
  offers: Partial<Record<JieqiColor, boolean>>,
  finalizedRoomId: string | null = null,
) {
  return { type: 'rematch:state', offers, finalizedRoomId };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

describe('jieqi PvP rematch', () => {
  it('offers each seat a Rematch button beside Review, and sends the offer', async () => {
    for (const seat of ['red', 'black'] as const) {
      await mountFinished(seat);
      expect(labels()).toEqual(['Rematch']);
      // Same action stack as Review game, so it shares its place above the fold.
      const actions = rematchBlock()?.closest('.postgame-actions, .room-actions-row');
      expect(actions?.textContent).toContain('Review game');
      click('Rematch');
      expect(socket.sent).toContainEqual({ type: 'rematch:offer' });
    }
  });

  it('shows no rematch to a spectator', async () => {
    await mountFinished('spectator');
    expect(rematchBlock()).toBeNull();
  });

  it('shows no rematch in a bot room', async () => {
    await mountFinished('red', { roomMode: 'pve', rematch: undefined });
    expect(rematchBlock()).toBeNull();
  });

  it('the opponent offer reads as Decline / Accept, each sending its message', async () => {
    const options = await mountFinished('red');
    options.onRematchState?.(state({ black: true }));
    options.render();
    expect(noteText()).toBe('Your opponent wants a rematch');
    expect(labels()).toEqual(['Decline', 'Accept']);
    click('Accept');
    expect(socket.sent).toContainEqual({ type: 'rematch:offer' });
    click('Decline');
    expect(socket.sent).toContainEqual({ type: 'rematch:decline' });
  });

  it('restores a pending opponent offer from the reconnect snapshot', async () => {
    await mountFinished('black', {
      rematch: { offers: { red: true, black: false }, finalizedRoomId: null },
    });
    expect(labels()).toEqual(['Decline', 'Accept']);
  });

  it('my offer waits with Cancel; a cancel is not read as a decline', async () => {
    const options = await mountFinished('red');
    options.onRematchState?.(state({ red: true }));
    options.render();
    expect(noteText()).toBe('Waiting for opponent…');
    click('Cancel rematch');
    expect(socket.sent).toContainEqual({ type: 'rematch:cancel' });
    options.onRematchState?.(state({}));
    options.render();
    expect(labels()).toEqual(['Rematch']);
    expect(noteText()).toBeNull();
  });

  it('an offer cleared by the opponent reads as declined, until the next offer', async () => {
    const options = await mountFinished('red');
    options.onRematchState?.(state({ red: true }));
    options.render();
    options.onRematchState?.(state({}));
    options.render();
    expect(noteText()).toBe('Your opponent declined the rematch.');
    expect(labels()).toEqual(['Rematch']);
    options.onRematchState?.(state({ black: true }));
    options.render();
    expect(noteText()).toBe('Your opponent wants a rematch');
  });

  it('both offers show the rematch starting, disabled', async () => {
    const options = await mountFinished('black');
    options.onRematchState?.(state({ red: true, black: true }, 'jq_next'));
    options.render();
    const buttons = [...(rematchBlock()?.querySelectorAll('button') ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.disabled).toBe(true);
  });
});
