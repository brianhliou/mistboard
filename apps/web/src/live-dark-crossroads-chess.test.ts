// Hidden-info regression for the Dark Crossroads Chess live room's replay path
// (repo rule: any replay/payload change adds one). Drives the REAL tenant
// config through the core's socket test seam with golden-wire-shaped fog
// frames: per-seat move-played redaction (opponent move events are OMITTED
// from this seat's log — dark-crossroads-chess-golden-wire.test.ts pins that)
// and a fog PlayerView (shrouded silhouettes + visibleSquares).
//
// The invariants:
//   * the replay path only ever holds views the server actually sent this
//     client — after a fresh mount/reconnect into a played game the history is
//     a single ply and stepping stays disabled (the client must NOT rebuild
//     per-ply views from its redacted event log, and the server must not be
//     asked for more);
//   * the move list masks redacted opponent plies and never renders an
//     opponent move.

import type { CrossroadsChessPlayerView } from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDarkCrossroadsChessLiveClientForTest } from './live-dark-crossroads-chess.js';
import type { TenantLiveClient } from './variant-tenant/live-client.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

type Seat = 'white' | 'red' | 'spectator';

function fogView(overrides: Partial<CrossroadsChessPlayerView> = {}): CrossroadsChessPlayerView {
  return {
    id: 'ddchess_fog1',
    perspective: 'white',
    board: {
      a1: { piece: { color: 'white', role: 'chariot' }, shrouded: false },
      a2: { piece: { color: 'white', role: 'soldier' }, shrouded: false },
      // A shrouded enemy silhouette: the viewer knows something is there, never what.
      a5: { color: 'red', shrouded: true },
    },
    visibleSquares: ['a1', 'a2', 'a3', 'a5'],
    legalMoves: [],
    status: { type: 'playing', turn: 'white' },
    moveNumber: 1,
    ...overrides,
  };
}

type Harness = {
  client: TenantLiveClient<'white' | 'red', CrossroadsChessPlayerView>;
  feedHello(frame: Record<string, unknown>): void;
  feedSnapshot(frame: Record<string, unknown>): void;
  feedEvent(frame: Record<string, unknown>): void;
  moveList(): HTMLElement;
};

function createHarness(seat: Seat = 'white'): Harness {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/room/ddchess_fog1');

  let socketOptions: TenantSocketClientOptions | null = null;
  const client = createDarkCrossroadsChessLiveClientForTest((options) => {
    socketOptions = options;
    return {
      connect: () => {},
      close: () => {},
      reconnectNow: () => {},
      send: () => true,
      startPing: () => {},
      connection: () => 'connected',
      noticeTier: () => 'none',
      closeReason: () => '',
      clientId: () => 'test-client',
      latencyMs: () => null,
      reconnectAttempt: () => 0,
    };
  });
  client.bootstrap();
  if (!socketOptions) throw new Error('socketFactory was not called');
  const options: TenantSocketClientOptions = socketOptions;

  function base(frame: Record<string, unknown>): TenantSocketFrame {
    return {
      type: 'snapshot',
      seat,
      seats: {},
      state: fogView(),
      ...frame,
    } as unknown as TenantSocketFrame;
  }

  return {
    client,
    feedHello: (frame) => {
      options.applyHello(base({ type: 'hello', ...frame }));
      options.render();
    },
    feedSnapshot: (frame) => {
      options.applySnapshot(base(frame));
      options.render();
    },
    feedEvent: (frame) => {
      options.applyEvent(base({ type: 'event-appended', ...frame }));
      options.render();
    },
    moveList: () => {
      const list = document.querySelector<HTMLElement>('.move-list, ol');
      if (!list) throw new Error('missing move list');
      return list;
    },
  };
}

function whiteMove(from: string, to: string, ply: number) {
  return { type: 'move-played', color: 'white', move: { from, to }, at: ply, ply };
}

beforeEach(() => {
  vi.stubEnv('VITE_DARK_CROSSROADS_CHESS_ENABLED', 'true');
});

describe('Dark Crossroads Chess live room (fog replay path)', () => {
  it('a fresh mount into a played game holds only the received fog view; stepping stays disabled', () => {
    const h = createHarness('white');
    // Reload/reconnect after 3 plies (white, red, white): the hello carries the
    // final fog view + the REDACTED log — white's own two moves, red's ply
    // omitted entirely (golden-wire shape).
    h.feedHello({
      events: [whiteMove('a2', 'a3', 1), whiteMove('a3', 'a4', 3)],
      state: fogView({ moveNumber: 2, status: { type: 'playing', turn: 'red' } }),
    });
    // No synthesized per-ply views: only the view the server sent.
    expect(h.client.replay.historyLength()).toBe(1);
    expect(h.client.replay.controlDisabled('prev')).toBe(true);
    expect(h.client.replay.controlDisabled('first')).toBe(true);
  });

  it('masks the redacted opponent ply in the move list and never renders an opponent move', () => {
    const h = createHarness('white');
    h.feedHello({
      events: [whiteMove('a2', 'a3', 1), whiteMove('a3', 'a4', 3)],
      state: fogView({ moveNumber: 2, status: { type: 'playing', turn: 'red' } }),
    });
    const listText = h.moveList().textContent ?? '';
    expect(listText).toContain('a2a3');
    expect(listText).toContain('a3a4');
    // Red's ply-2 cell renders the masked placeholder, never a move.
    const masked = h.moveList().querySelector('.ddchess-move-row__move.masked');
    expect(masked).not.toBeNull();
    expect(masked?.textContent).toBe('...');
    // Nothing anywhere in the room DOM carries a red move (none was ever sent).
    expect(document.body.innerHTML).not.toContain('a7a5');
  });

  it('live-captured fog views scrub back; a reconnect never resurrects them client-side', () => {
    const h = createHarness('white');
    const v0 = fogView();
    const v1 = fogView({
      status: { type: 'playing', turn: 'red' },
      lastMove: { from: 'a2', to: 'a3' },
    });
    // Red's reply arrives as a fresh snapshot (the redacted event stream never
    // carries the opponent move); the view advances, the log does not.
    const v2 = fogView({ moveNumber: 2, status: { type: 'playing', turn: 'white' } });
    h.feedHello({ state: v0, events: [] });
    h.feedEvent({ event: whiteMove('a2', 'a3', 1), state: v1 });
    h.feedSnapshot({ events: [whiteMove('a2', 'a3', 1)], state: v2 });
    // Live session: all three received views are scrubbable, by identity.
    expect(h.client.replay.historyLength()).toBe(3);
    h.client.replay.handleControl('prev');
    expect(h.client.replay.currentView(h.client.state.view)).toBe(v1);
    h.client.replay.handleControl('first');
    expect(h.client.replay.currentView(h.client.state.view)).toBe(v0);

    // A NEW client for the same room (reconnect/reload) receives only the
    // latest view + the redacted log: the captured history is gone and must
    // not be rebuilt from what the client holds.
    const fresh = createHarness('white');
    fresh.feedHello({
      events: [whiteMove('a2', 'a3', 1)],
      state: fogView({ moveNumber: 2, status: { type: 'playing', turn: 'white' } }),
    });
    expect(fresh.client.replay.historyLength()).toBe(1);
    expect(fresh.client.replay.controlDisabled('prev')).toBe(true);
  });

  it('shows the pending-Try banner only to the racer', () => {
    const racer = createHarness('white');
    racer.feedHello({
      events: [whiteMove('a2', 'a3', 1)],
      state: fogView({
        pendingTry: 'white',
        status: { type: 'playing', turn: 'red' },
      }),
    });
    expect(document.querySelector('.ddchess-try-banner')).not.toBeNull();

    // The opponent's wire never carries pendingTry (server-redacted): no banner.
    const opponent = createHarness('red');
    opponent.feedHello({
      seat: 'red',
      state: fogView({ perspective: 'red', status: { type: 'playing', turn: 'red' } }),
    });
    expect(document.querySelector('.ddchess-try-banner')).toBeNull();
  });

  it('renders the dimmed placeholder row before any visible ply', () => {
    const h = createHarness('white');
    h.feedHello({ state: fogView(), events: [] });
    const placeholder = document.querySelector('.ddchess-move-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toBe('No visible moves yet');
  });

  it('offers a ply jump only on moves this seat was sent, never on a masked one', () => {
    const h = createHarness('white');
    h.feedHello({
      events: [whiteMove('a2', 'a3', 1), whiteMove('a3', 'a4', 3)],
      state: fogView({ moveNumber: 2, status: { type: 'playing', turn: 'red' } }),
    });
    // White's own plies are buttons; red's redacted ply-2 cell stays an inert
    // span. A control on a masked cell would offer to navigate to a position
    // the server deliberately withheld from this seat.
    const jumps = h.moveList().querySelectorAll('button.move-jump');
    expect(jumps).toHaveLength(2);
    expect(Array.from(jumps, (b) => b.textContent)).toEqual(['a2a3', 'a3a4']);
    const masked = h.moveList().querySelector('.ddchess-move-row__move.masked');
    expect(masked?.tagName).toBe('SPAN');
    expect(masked?.matches('button, .move-jump')).toBe(false);
  });

  it('a ply jump lands on a captured view and never resurrects a withheld one', () => {
    const h = createHarness('white');
    const v0 = fogView();
    const v1 = fogView({
      status: { type: 'playing', turn: 'red' },
      lastMove: { from: 'a2', to: 'a3' },
    });
    const v2 = fogView({ moveNumber: 2, status: { type: 'playing', turn: 'white' } });
    h.feedHello({ state: v0, events: [] });
    h.feedEvent({ event: whiteMove('a2', 'a3', 1), state: v1 });
    h.feedSnapshot({ events: [whiteMove('a2', 'a3', 1)], state: v2 });

    const jump = h.moveList().querySelector<HTMLButtonElement>('button.move-jump');
    expect(jump).not.toBeNull();
    jump?.click();

    // The click scrubs through the same captured history the arrows walk: the
    // landed view is one the server actually sent, by identity, not a rebuild.
    const landed = h.client.replay.currentView(h.client.state.view);
    expect([v0, v1, v2]).toContain(landed);
    expect(h.client.replay.historyLength()).toBe(3);
    // Scrubbing does not widen what the list will show.
    expect(document.body.innerHTML).not.toContain('a7a5');
  });
});
