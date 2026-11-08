// @vitest-environment happy-dom
// Drive the real live client and delegated tap/drop handlers. The public warning
// calculation is tested separately against the kernel and hidden-identity swaps.
import { createInitialJieqiState, getJieqiPlayerView, type JieqiMove } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('./jieqi-repetition-warning.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./jieqi-repetition-warning.js')>()),
  jieqiRepetitionWarning: () => ({
    losingMoves: [{ move: { from: 'a1', to: 'a2' }, loser: 'red', reason: 'perpetual-chase' }],
  }),
}));

const move: JieqiMove = { from: 'a1', to: 'a2' };
const view = getJieqiPlayerView(createInitialJieqiState('jq_dialog'), 'red');
let client: TenantSocketClientOptions;

function snapshot(state = view, rule: unknown = 'jqe-v1') {
  client.applySnapshot({
    type: 'snapshot',
    seat: 'red',
    seats: { red: 'test-client' },
    roomMode: 'pvp',
    adjudicationRule: rule,
    state,
    events: [{ type: 'room-created', roomId: view.id, at: 0 }],
  } as Parameters<TenantSocketClientOptions['applySnapshot']>[0]);
  client.render();
}
function point(square: string) {
  return document.querySelector<HTMLElement>(`.jieqi-live-board [data-square="${square}"] rect`)!;
}
function attempt(method: string) {
  if (method !== 'drop') {
    point('a1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[data-repetition-label=a2]')?.textContent).toBe(
      'Loses: perpetual chase',
    );
    point('a2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  } else {
    point('a1').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }),
    );
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 20 }));
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => point('a2'));
    document.dispatchEvent(new PointerEvent('pointerup', { clientX: 20, clientY: 20 }));
  }
}
function moves() {
  return socket.sent.filter((item) => (item as { type: string }).type === 'move');
}
function dialogButton(which: string) {
  return document.querySelector<HTMLButtonElement>(`.confirm-dialog-${which}`)!;
}
function piece(square: string) {
  return document.querySelector(`[data-piece-square="${square}"]`);
}

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/room/jq_dialog');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  vi.resetModules();
  const { bootstrapJieqiLiveRoom } = await import('./live-jieqi.js');
  bootstrapJieqiLiveRoom();
  client = socket.options!;
  socket.sent = [];
  snapshot();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('live Jieqi repetition confirmation', () => {
  it.each(['tap', 'drop'])(
    '%s previews the destination and Confirm sends exactly one move',
    (method) => {
      attempt(method);
      expect(document.querySelector('dialog[open]')).not.toBeNull();
      expect(piece('a1')).toBeNull();
      expect(piece('a2')).not.toBeNull();
      expect(moves()).toEqual([]);
      client.render(); // clocks/repaints must not snap the piece back
      expect(piece('a1')).toBeNull();
      expect(piece('a2')).not.toBeNull();
      dialogButton('confirm').click();
      expect(moves()).toEqual([{ type: 'move', ...move }]);
    },
  );
  it.each(['tap', 'drop'])('%s Cancel restores origin and never sends', (method) => {
    attempt(method);
    dialogButton('cancel').click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(piece('a1')).not.toBeNull();
    expect(piece('a2')).toBeNull();
    expect(moves()).toEqual([]);
  });
  it.each(['tap', 'drop'])('%s with the preference off sends immediately', async (method) => {
    const { writeAccountPreference } = await import('./account-preferences.js');
    writeAccountPreference('confirmGameActions', false);
    attempt(method);
    expect(document.querySelector('dialog')).toBeNull();
    expect(moves()).toEqual([{ type: 'move', ...move }]);
  });
  it('an opponent move closes the dialog and cannot confirm a stale move', () => {
    attempt('tap');
    const stale = dialogButton('confirm');
    client.applyEvent({
      type: 'event-appended',
      adjudicationRule: 'jqe-v1',
      state: {
        ...view,
        moveNumber: view.moveNumber + 1,
        lastMove: { from: 'b10', to: 'c8' },
        status: { type: 'playing', turn: 'black' },
      },
      event: {
        type: 'move-played',
        color: 'black',
        move: { from: 'b10', to: 'c8' },
        at: 1,
        ply: 1,
      },
    } as Parameters<TenantSocketClientOptions['applyEvent']>[0]);
    client.render();
    expect(document.querySelector('dialog')).toBeNull();
    stale.click();
    expect(moves()).toEqual([]);
  });
  it('legacy-rule games never label or confirm a move', () => {
    snapshot(view, 'legacy');
    point('a1').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[data-repetition-label]')).toBeNull();
    point('a2').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('dialog')).toBeNull();
    expect(moves()).toEqual([{ type: 'move', ...move }]);
  });
});
