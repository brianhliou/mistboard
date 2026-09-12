// Unit tests for the generic live-client core: frame application, replay
// capture policies, the two-column move list (masked and unmasked), the
// disabled branch, the replay-history rebuild hook (per-ply views from the
// event log on mount/reconnect, #80), the custom move-list renderer hook
// (clickable ply jump, #84), and the fog hidden-info regression for the
// replay path. Drives a client through the socketFactory test seam with a
// minimal two-color test variant; no real WebSocket.

import { BANQI_SPEC_ID } from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPostHogInstance } from '../analytics.js';
import type { LiveRefs } from '../live-state.js';
import {
  createTenantLiveClient,
  type TenantLiveClient,
  type TenantLiveClientConfig,
  type TenantLiveEvent,
  type TenantLiveFrame,
  type TenantMoveListRenderContext,
  type TenantMovePlayed,
  type TenantPendingAnimation,
} from './live-client.js';
import { createTenantReplayController } from './replay-controller.js';
import type { TenantWebView, WebVariantTenant } from './room-chrome.js';
import type { TenantSocketClientOptions } from './socket-client.js';

type TColor = 'red' | 'blue';
type TMove = { from: string; to: string };
type TView = TenantWebView<TColor> & {
  perspective: TColor;
  squares: Record<string, TColor>;
};

const tenant: WebVariantTenant<TColor> = {
  displayName: 'Testline',
  colors: ['red', 'blue'],
  isColor: (value): value is TColor => value === 'red' || value === 'blue',
  oppositeColor: (color) => (color === 'red' ? 'blue' : 'red'),
  enabled: () => enabledFlag,
  reviewUrl: (roomId) => `/testline/game/${roomId}`,
  reasonPhrase: () => 'the rules',
  disabledTitle: 'Testline disabled',
  disabledBody: 'off',
  rejectedBody: 'rejected',
  spectatorBody: 'watching',
  selectInstruction: 'pick',
};

let enabledFlag = true;

function isTestMoveEvent(event: TenantLiveEvent): event is TenantMovePlayed<TColor, TMove> {
  return event.type === 'move-played';
}

function view(overrides: Partial<TView> = {}): TView {
  return {
    id: 'room1',
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    perspective: 'red',
    squares: {},
    ...overrides,
  };
}

type Harness = {
  client: TenantLiveClient<TColor, TView>;
  feedHello(frame: Partial<TenantLiveFrame<TColor, TView>>): void;
  feedSnapshot(frame: Partial<TenantLiveFrame<TColor, TView>>): void;
  feedEvent(frame: Partial<TenantLiveFrame<TColor, TView>>): void;
  sent: unknown[];
  boardRenders: Array<TView | null>;
  refs(): LiveRefs;
};

function createHarness(
  configOverrides: Partial<TenantLiveClientConfig<TColor, TView, TMove>> = {},
  { masked = false }: { masked?: boolean } = {},
): Harness {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/room/tst_room1');

  let socketOptions: TenantSocketClientOptions | null = null;
  const sent: unknown[] = [];
  const boardRenders: Array<TView | null> = [];
  let liveRefs: LiveRefs | null = null;

  const client = createTenantLiveClient<TColor, TView, TMove>({
    tenant,
    gameSpecId: 'testline',
    defaultRoomId: 'tst_dev',
    boardClass: 'testline-live-board',
    playAgainRequestBody: () => ({ mode: 'pvp', gameSpecId: 'testline' }),
    renderBoard: (refs, v) => {
      liveRefs = refs;
      boardRenders.push(v);
      refs.board.className = 'board testline-live-board';
    },
    setup: () => {},
    moveList: {
      rowClass: 'move-row test-move-row',
      cellPrefix: 'test-move-row',
      masked,
      notate: (move) => `${move.from}-${move.to}`,
      isMoveEvent: isTestMoveEvent,
    },
    replayCapture: {
      positionKey: (v) => JSON.stringify(v.squares),
      plyForView: (_v, ctx) => ctx.events.filter(isTestMoveEvent).length,
    },
    socketFactory: (options) => {
      socketOptions = options;
      return {
        connect: () => {},
        close: () => {},
        reconnectNow: () => {},
        send: (payload: unknown) => {
          sent.push(payload);
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
    ...configOverrides,
  });

  client.bootstrap();
  if (!socketOptions) throw new Error('socketFactory was not called');
  const options: TenantSocketClientOptions = socketOptions;

  function base(frame: Partial<TenantLiveFrame<TColor, TView>>): TenantLiveFrame<TColor, TView> {
    return {
      type: 'snapshot',
      seat: 'red',
      seats: {},
      state: view(),
      ...frame,
    } as TenantLiveFrame<TColor, TView>;
  }

  return {
    client,
    sent,
    boardRenders,
    refs: () => {
      if (!liveRefs) throw new Error('renderBoard never ran');
      return liveRefs;
    },
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
  };
}

function moveEvent(color: TColor, from: string, to: string, ply: number): TenantLiveEvent {
  return { type: 'move-played', color, move: { from, to }, at: 0, ply };
}

beforeEach(() => {
  enabledFlag = true;
});

describe('tenant live-client core', () => {
  it('applies hello frames into shared state', () => {
    const h = createHarness();
    h.feedHello({
      seat: 'blue',
      state: view({ status: { type: 'playing', turn: 'red' } }),
      timeControl: { initialMs: 60_000, incrementMs: 1_000 },
      connectedSeats: { red: true, blue: false },
      events: [moveEvent('red', 'a1', 'a2', 1)],
    });
    expect(h.client.state.seat).toBe('blue');
    expect(h.client.state.timeControl).toEqual({ initialMs: 60_000, incrementMs: 1_000 });
    expect(h.client.state.connectedSeats).toEqual({ red: true, blue: false });
    expect(h.client.state.events).toHaveLength(1);
  });

  it('event frames append to the existing event log', () => {
    const h = createHarness();
    h.feedHello({ events: [moveEvent('red', 'a1', 'a2', 1)] });
    h.feedEvent({ event: moveEvent('blue', 'b1', 'b2', 2) });
    expect(h.client.state.events).toHaveLength(2);
  });

  it('keeps sticky fields when later frames omit them', () => {
    const h = createHarness();
    h.feedHello({ timeControl: { initialMs: 60_000, incrementMs: 0 } });
    h.feedSnapshot({});
    expect(h.client.state.timeControl).toEqual({ initialMs: 60_000, incrementMs: 0 });
  });

  it('drives the shared lifecycle frame from viewer-safe room state', () => {
    const h = createHarness();
    h.feedHello({
      seat: 'red',
      connectedSeats: { red: true, blue: false },
      state: view(),
    });
    const stage = h.refs().board.closest<HTMLElement>('.board-stage');
    expect(stage?.dataset.liveLifecycleEffect).toBeUndefined();

    h.feedSnapshot({
      seat: 'red',
      connectedSeats: { red: true, blue: true },
      state: view(),
    });
    expect(stage?.dataset.liveLifecycleEffect).toBe('start');

    h.feedEvent({
      seat: 'red',
      connectedSeats: { red: true, blue: true },
      event: { type: 'game-ended', at: 0 },
      state: view({
        moveNumber: 8,
        status: { type: 'finished', winner: 'red', reason: 'the-rules' },
      }),
    });
    expect(stage?.dataset.liveLifecycleEffect).toBe('finish-win');
  });

  it('renders the unmasked two-column move list with a fallback for missing plies', () => {
    const h = createHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' } }),
    });
    const rows = [...h.refs().moveList.querySelectorAll('li')];
    expect(rows).toHaveLength(1);
    // Number cell stays a span; both played plies are jump buttons.
    expect(rows[0].querySelector('span')?.textContent).toBe('1.');
    const cells = [...rows[0].querySelectorAll('button.move-jump')];
    expect(cells.map((cell) => cell.textContent)).toEqual(['a1-a2', 'b1-b2']);
  });

  it('scrubs to the clicked ply from the move list', () => {
    const h = createHarness();
    // Fed ply by ply so the capture policy banks a snapshot per position: a
    // fresh hello into a played game holds ONE view, and a jump inside a
    // single-snapshot history correctly stays live (there is nowhere to go).
    h.feedHello({ events: [], state: view({}) });
    h.feedEvent({
      event: moveEvent('red', 'a1', 'a2', 1),
      state: view({ squares: { a2: 'red' } }),
    });
    h.feedEvent({
      event: moveEvent('blue', 'b1', 'b2', 2),
      state: view({ squares: { a2: 'red', b2: 'blue' } }),
    });
    expect(h.client.replay.isLive()).toBe(true);
    const first = h.refs().moveList.querySelector<HTMLButtonElement>('button.move-jump');
    first?.click();
    // Off live, anchored at the clicked ply, and the list marks it active.
    expect(h.client.replay.isLive()).toBe(false);
    expect(h.client.replay.activePly()).toBe(1);
    expect(h.refs().moveList.querySelector('.active')?.textContent).toBe('a1-a2');
  });

  it('leaves an unplayed cell inert rather than offering a jump to it', () => {
    const h = createHarness();
    // One ply played: blue's half of the row is an empty, unclickable cell.
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1)],
      state: view({ squares: { a2: 'red' } }),
    });
    const row = h.refs().moveList.querySelector('li');
    expect(row?.querySelectorAll('button.move-jump')).toHaveLength(1);
    expect(row?.lastElementChild?.tagName).toBe('SPAN');
    expect(row?.lastElementChild?.textContent).toBe('');
  });

  it('masks redacted plies in fog mode instead of leaving them blank', () => {
    const h = createHarness(
      {
        replayCapture: {
          positionKey: (v) => JSON.stringify(v.squares),
          // Fog policy: derive the ply from moveNumber + turn (red moves first),
          // since redacted opponent moves never arrive as events.
          plyForView: (v) =>
            Math.max(0, v.moveNumber - 1) * 2 +
            (v.status.type === 'playing' && v.status.turn === 'red' ? 0 : 1),
        },
      },
      { masked: true },
    );
    // Two plies played (moveNumber 2, red to move), but only the viewer's own
    // move arrived on the wire — ply 2 is the opponent's redacted move.
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1)],
      state: view({ moveNumber: 2, squares: { a2: 'red', z9: 'blue' } }),
    });
    const masked = h.refs().moveList.querySelector('.test-move-row__move.masked');
    expect(masked).not.toBeNull();
  });

  it('captures one replay snapshot per distinct position', () => {
    const h = createHarness();
    h.feedHello({ state: view({ squares: {} }) });
    expect(h.client.replay.historyLength()).toBe(1);
    const moved = view({ squares: { a2: 'red' } });
    h.feedSnapshot({ events: [moveEvent('red', 'a1', 'a2', 1)], state: moved });
    expect(h.client.replay.historyLength()).toBe(2);
    expect(h.client.replay.latestPly()).toBe(1);
    // Same position re-sent: no duplicate snapshot.
    h.feedSnapshot({ events: [moveEvent('red', 'a1', 'a2', 1)], state: { ...moved } });
    expect(h.client.replay.historyLength()).toBe(2);
  });

  it('clears the board and skips the move list when the tenant flag is off', () => {
    let disabledCalls = 0;
    const h = createHarness({ onDisabled: () => (disabledCalls += 1) });
    h.feedHello({});
    enabledFlag = false;
    h.client.renderAll();
    expect(disabledCalls).toBeGreaterThan(0);
    const board = document.querySelector('.testline-live-board--disabled');
    expect(board).not.toBeNull();
  });

  it('routes send through the socket', () => {
    const h = createHarness();
    h.feedHello({});
    expect(h.client.send({ type: 'move', from: 'a1', to: 'a2' })).toBe(true);
    expect(h.sent).toContainEqual({ type: 'move', from: 'a1', to: 'a2' });
  });
});

describe('animateBoard hook (one-shot pending-animation channel)', () => {
  type Pending = TenantPendingAnimation<TColor, TView, TMove> | null;

  function animatedHarness(opts: { masked?: boolean } = {}): Harness & { pendings: Pending[] } {
    const pendings: Pending[] = [];
    const h = createHarness(
      {
        animateBoard: (_refs, _view, takePendingAnimation) => {
          pendings.push(takePendingAnimation());
        },
      },
      opts,
    );
    return Object.assign(h, { pendings });
  }

  it('delivers a live pending exactly once for a move event that passes the move gate', () => {
    const h = animatedHarness();
    h.feedHello({});
    expect(h.pendings.at(-1)).toBeNull();
    h.feedEvent({
      event: moveEvent('blue', 'b1', 'b2', 1),
      state: view({ squares: { b2: 'blue' } }),
    });
    expect(h.pendings.at(-1)).toEqual({
      kind: 'live',
      move: { from: 'b1', to: 'b2' },
      color: 'blue',
    });
    // One-shot: the channel is drained by the render that followed the event.
    h.client.renderAll();
    expect(h.pendings.at(-1)).toBeNull();
  });

  it('fog safety: a redacted opponent event changes the board but NEVER arms an animation', () => {
    // On fog tenants the server strips opponent move payloads; what arrives is
    // a non-move event plus a new view. The hook must see NO pending for it —
    // the client never derives a glide by diffing the two boards, so a fogged
    // origin square can never be implied client-side. Only events that pass
    // the tenant's isMoveEvent gate (here: the viewer's own move) animate.
    const h = animatedHarness({ masked: true });
    h.feedHello({ seat: 'red' });
    // Own move arrives as a real move event: pending delivered.
    h.feedEvent({
      seat: 'red',
      event: moveEvent('red', 'a1', 'a2', 1),
      state: view({ squares: { a2: 'red' } }),
    });
    expect(h.pendings.at(-1)).toEqual({
      kind: 'live',
      move: { from: 'a1', to: 'a2' },
      color: 'red',
    });
    // Redacted opponent ply: the view changes (a blue piece appears) but the
    // event carries no move shape, so the channel stays empty.
    h.feedEvent({
      seat: 'red',
      event: { type: 'ply-advanced', color: 'blue', at: 0 },
      state: view({ moveNumber: 2, squares: { a2: 'red', z9: 'blue' } }),
    });
    expect(h.pendings.at(-1)).toBeNull();
  });

  it('maps adjacent replay steps to scrub pendings carrying the previously displayed view', () => {
    const h = animatedHarness();
    h.feedHello({ state: view({ squares: {} }) });
    const moved = view({ squares: { a2: 'red' } });
    h.feedSnapshot({ events: [moveEvent('red', 'a1', 'a2', 1)], state: moved });
    expect(h.client.replay.historyLength()).toBe(2);

    h.client.replay.handleControl('prev');
    h.client.renderAll();
    const back = h.pendings.at(-1);
    expect(back).toMatchObject({ kind: 'scrub', direction: 'back' });
    // prevView is the view we stepped away from — its lastMove is what a
    // tenant reverse-animates.
    expect((back as Extract<Pending, { kind: 'scrub' }>).prevView?.squares).toEqual({ a2: 'red' });

    h.client.replay.handleControl('next');
    h.client.renderAll();
    expect(h.pendings.at(-1)).toMatchObject({ kind: 'scrub', direction: 'forward' });
    // Drained again on the following render.
    h.client.renderAll();
    expect(h.pendings.at(-1)).toBeNull();
  });
});

describe('replayHistory hook (per-ply rebuild from the event log, #80)', () => {
  // Toy kernel: replay move events onto an empty square map (ply = move count,
  // ply 0 = initial position) — the shape real tenants implement with their
  // variant kernel from @mistboard/game.
  function rebuildFromLog(events: readonly TenantLiveEvent[]): Array<{ ply: number; view: TView }> {
    const squares: Record<string, TColor> = {};
    const snapshots = [{ ply: 0, view: view({ squares: { ...squares } }) }];
    for (const event of events) {
      if (!isTestMoveEvent(event)) continue;
      squares[event.move.to] = event.color;
      snapshots.push({ ply: snapshots.length, view: view({ squares: { ...squares } }) });
    }
    return snapshots;
  }

  function rebuildHarness(): Harness {
    return createHarness({
      replayHistory: { rebuild: ({ events }) => rebuildFromLog(events) },
    });
  }

  it('rebuilds the full per-ply history from a hello frame (fresh mount of a played game)', () => {
    const h = rebuildHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    expect(h.client.replay.historyLength()).toBe(3);
    expect(h.client.replay.latestPly()).toBe(2);
    // Stepping works immediately: the board shows the rebuilt earlier plies.
    h.client.replay.handleControl('prev');
    h.client.renderAll();
    expect(h.boardRenders.at(-1)?.squares).toEqual({ a2: 'red' });
    h.client.replay.handleControl('first');
    h.client.renderAll();
    expect(h.boardRenders.at(-1)?.squares).toEqual({});
  });

  it('#80: a reconnect snapshot restores stepping for a client that only held the final view', () => {
    const h = rebuildHarness();
    h.feedHello({ state: view() });
    expect(h.client.replay.historyLength()).toBe(1);
    // Reconnect/resync delivers the final state + the full event log in one
    // snapshot — previously the client kept a single ply and ‹/› were dead.
    h.feedSnapshot({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    expect(h.client.replay.historyLength()).toBe(3);
    expect(h.client.replay.controlDisabled('prev')).toBe(false);
    h.client.replay.handleControl('prev');
    h.client.renderAll();
    expect(h.boardRenders.at(-1)?.squares).toEqual({ a2: 'red' });
  });

  it('does not re-capture the rebuilt live view on subsequent renders', () => {
    const h = rebuildHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1)],
      state: view({ squares: { a2: 'red' } }),
    });
    expect(h.client.replay.historyLength()).toBe(2);
    h.client.renderAll();
    h.client.renderAll();
    expect(h.client.replay.historyLength()).toBe(2);
  });

  it('a null rebuild keeps the incrementally captured history (kernel-reject fallback)', () => {
    const h = createHarness({ replayHistory: { rebuild: () => null } });
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    // Capture-only: the single received view.
    expect(h.client.replay.historyLength()).toBe(1);
  });
});

describe('custom move-list renderer hook (clickable ply jump, #84)', () => {
  type ListCtx = TenantMoveListRenderContext<TColor, TMove>;

  function customHarness(): Harness & { listContexts: ListCtx[] } {
    const listContexts: ListCtx[] = [];
    const h = createHarness({
      replayHistory: {
        rebuild: ({ events }) => {
          const squares: Record<string, TColor> = {};
          const snapshots = [{ ply: 0, view: view({ squares: { ...squares } }) }];
          for (const event of events) {
            if (!isTestMoveEvent(event)) continue;
            squares[event.move.to] = event.color;
            snapshots.push({ ply: snapshots.length, view: view({ squares: { ...squares } }) });
          }
          return snapshots;
        },
      },
      moveList: {
        rowClass: 'move-row test-move-row',
        cellPrefix: 'test-move-row',
        masked: false,
        notate: (move) => `${move.from}-${move.to}`,
        isMoveEvent: isTestMoveEvent,
        render: (ctx) => {
          listContexts.push(ctx);
          ctx.refs.moveList.replaceChildren();
          ctx.moves.forEach((move, index) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'jump';
            button.textContent = `${move.move.from}-${move.move.to}`;
            button.addEventListener('click', () => ctx.jumpToPly(index + 1));
            item.append(button);
            ctx.refs.moveList.append(item);
          });
        },
      },
    });
    return Object.assign(h, { listContexts });
  }

  function jumpButtons(h: Harness): HTMLButtonElement[] {
    return [...h.refs().moveList.querySelectorAll<HTMLButtonElement>('button.jump')];
  }

  it('delegates the list to the tenant renderer instead of the standard two-column rows', () => {
    const h = customHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    expect(jumpButtons(h)).toHaveLength(2);
    expect(h.refs().moveList.querySelector('.test-move-row__move')).toBeNull();
  });

  it('jumpToPly scrubs the board to the clicked ply and re-renders', () => {
    const h = customHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    jumpButtons(h)[0].click();
    expect(h.client.replay.isLive()).toBe(false);
    expect(h.client.replay.activePly()).toBe(1);
    expect(h.boardRenders.at(-1)?.squares).toEqual({ a2: 'red' });
    // The re-render handed the renderer the scrubbed context.
    expect(h.listContexts.at(-1)?.activePly).toBe(1);
  });

  it('jumping to the latest ply returns to live', () => {
    const h = customHarness();
    h.feedHello({
      events: [moveEvent('red', 'a1', 'a2', 1), moveEvent('blue', 'b1', 'b2', 2)],
      state: view({ squares: { a2: 'red', b2: 'blue' }, moveNumber: 2 }),
    });
    jumpButtons(h)[0].click();
    expect(h.client.replay.isLive()).toBe(false);
    jumpButtons(h)[1].click();
    expect(h.client.replay.isLive()).toBe(true);
  });
});

describe('hidden-info regression: fog replay path never synthesizes views', () => {
  // Fog tenants must NOT configure replayHistory: their event logs are
  // redacted (opponent moves are omitted or stripped by the server), so a
  // client-side rebuild is impossible without widening the payload with
  // hidden information. The invariant under test: every view the replay path
  // ever shows is one the server actually sent this client, and a reconnect
  // leaves a single-ply history (stepping disabled) rather than fabricating
  // earlier positions.
  function fogHarness(): Harness {
    return createHarness(
      {
        replayCapture: {
          positionKey: (v) => JSON.stringify(v.squares),
          // Fog ply policy: derive from moveNumber + turn (red moves first);
          // redacted opponent moves never arrive as events.
          plyForView: (v) =>
            Math.max(0, v.moveNumber - 1) * 2 +
            (v.status.type === 'playing' && v.status.turn === 'red' ? 0 : 1),
        },
      },
      { masked: true },
    );
  }

  it('a fresh mount into a played fog game holds ONLY the received view; stepping stays disabled', () => {
    const h = fogHarness();
    // Reload/reconnect of a game after two plies: the hello carries the final
    // fog view + the REDACTED log (own move only; the opponent ply is absent).
    h.feedHello({
      seat: 'red',
      events: [moveEvent('red', 'a1', 'a2', 1)],
      state: view({ moveNumber: 2, squares: { a2: 'red', z9: 'blue' } }),
    });
    expect(h.client.replay.historyLength()).toBe(1);
    expect(h.client.replay.controlDisabled('prev')).toBe(true);
    expect(h.client.replay.controlDisabled('first')).toBe(true);
  });

  it('every view the board ever renders is a server-sent view object (identity)', () => {
    const h = fogHarness();
    const v0 = view({ squares: {} });
    const v1 = view({ status: { type: 'playing', turn: 'blue' }, squares: { a2: 'red' } });
    const v2 = view({ moveNumber: 2, squares: { a2: 'red', z9: 'blue' } });
    h.feedHello({ seat: 'red', state: v0 });
    h.feedEvent({ seat: 'red', event: moveEvent('red', 'a1', 'a2', 1), state: v1 });
    // Redacted opponent ply arrives with a new view but no move payload.
    h.feedEvent({ seat: 'red', event: { type: 'ply-advanced', color: 'blue', at: 0 }, state: v2 });
    expect(h.client.replay.historyLength()).toBe(3);
    h.client.replay.handleControl('prev');
    h.client.renderAll();
    h.client.replay.handleControl('first');
    h.client.renderAll();
    h.client.replay.handleControl('latest');
    h.client.renderAll();
    const served = new Set<TView | null>([v0, v1, v2, null]);
    for (const rendered of h.boardRenders) {
      expect(served.has(rendered)).toBe(true);
    }
  });
});

describe('replay controller: replaceHistory + jumpToPly', () => {
  function seeded() {
    const controller = createTenantReplayController<string>();
    controller.push({ ply: 0, view: 'start' });
    controller.push({ ply: 1, view: 'one' });
    controller.push({ ply: 2, view: 'two' });
    return controller;
  }

  it('replaceHistory keeps a live controller live', () => {
    const controller = seeded();
    controller.replaceHistory([
      { ply: 0, view: 'r0' },
      { ply: 1, view: 'r1' },
      { ply: 2, view: 'r2' },
    ]);
    expect(controller.isLive()).toBe(true);
    expect(controller.currentView('live')).toBe('live');
  });

  it('replaceHistory re-anchors a scrubbed controller to the same ply', () => {
    const controller = seeded();
    controller.handleControl('prev'); // ply 1
    controller.replaceHistory([
      { ply: 0, view: 'r0' },
      { ply: 1, view: 'r1' },
      { ply: 2, view: 'r2' },
      { ply: 3, view: 'r3' },
    ]);
    expect(controller.isLive()).toBe(false);
    expect(controller.currentView('live')).toBe('r1');
  });

  it('jumpToPly scrubs to the ply, records the step, and the latest ply returns live', () => {
    const controller = seeded();
    controller.jumpToPly(1);
    expect(controller.activePly()).toBe(1);
    expect(controller.currentView('live')).toBe('one');
    expect(controller.takeLastStep()).toEqual({ fromPly: 2, toPly: 1 });
    controller.jumpToPly(2);
    expect(controller.isLive()).toBe(true);
    expect(controller.currentView('live')).toBe('live');
  });
});

// The gap these cover: until 2026-08-28 `game_started` fired only from
// live-render.ts and Dark Mini Xiangqi, so every tenant variant (banqi, jieqi,
// xiangqi, fortress, fog xiangqi, jungle) emitted no game events at all. Ninety
// days of production data was 24 starts, all fog chess, which reads as nobody
// playing them and meant nobody measuring them. Nothing failed, because nothing
// asserted it.
describe('tenant game lifecycle analytics', () => {
  const capture = vi.fn();
  const named = (name: string) =>
    (capture.mock.calls as Array<[string, Record<string, unknown>]>).filter(([n]) => n === name);

  beforeEach(() => {
    capture.mockReset();
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
  });

  it('emits game_started for a tenant variant, sliced by spec and room mode', () => {
    const h = createHarness({
      gameSpecId: BANQI_SPEC_ID,
      chrome: { roomMode: () => 'pve' },
    });
    h.feedHello({
      state: view({ status: { type: 'setup' } }),
      timeControl: { initialMs: 5 * 60_000, incrementMs: 5_000 },
    });
    expect(named('game_started')).toHaveLength(0);

    h.feedSnapshot({ state: view({ status: { type: 'playing', turn: 'red' } }) });
    expect(named('game_started')).toHaveLength(1);
    expect(named('game_started')[0][1]).toMatchObject({
      gameId: 'room1',
      variant: BANQI_SPEC_ID,
      game_spec: BANQI_SPEC_ID,
      roomMode: 'pve',
      initialMs: 5 * 60_000,
      incrementMs: 5_000,
      time_class: 'rapid',
      // Unknown on this stack, never guessed: the legacy stack reports a real
      // value and a fabricated one here would silently pool with it.
      rated: null,
    });
  });

  it('emits game_finished once, with the winner and reason', () => {
    const h = createHarness({ gameSpecId: BANQI_SPEC_ID });
    h.feedHello({ state: view({ status: { type: 'playing', turn: 'red' } }) });
    h.feedSnapshot({
      state: view({
        status: { type: 'finished', winner: 'blue', reason: 'no-moves' },
        moveNumber: 21,
      }),
    });
    h.feedSnapshot({
      state: view({
        status: { type: 'finished', winner: 'blue', reason: 'no-moves' },
        moveNumber: 21,
      }),
    });
    expect(named('game_finished')).toHaveLength(1);
    expect(named('game_finished')[0][1]).toMatchObject({
      winner: 'blue',
      reason: 'no-moves',
      moveNumber: 21,
    });
  });

  it('survives a gameSpecId the registry does not know', () => {
    // Variant dispatch is fail-closed and throws on an unknown id. Measurement
    // must not: an analytics call that can take down a live room is worse than
    // one that loses a property.
    const h = createHarness({ gameSpecId: 'not-a-real-spec' });
    expect(() =>
      h.feedSnapshot({ state: view({ status: { type: 'playing', turn: 'red' } }) }),
    ).not.toThrow();
    expect(named('game_started')).toHaveLength(1);
    expect(named('game_started')[0][1]).toMatchObject({ variant: 'not-a-real-spec' });
    expect(named('game_started')[0][1]).not.toHaveProperty('game_spec');
  });
});
