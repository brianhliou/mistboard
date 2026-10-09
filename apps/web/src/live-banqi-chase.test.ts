// The 長捉 (perpetual chase) affordance in the live banqi room: a move the rule
// forbids is drawn as a red cross where its dot would be, and clicking it sends
// nothing and says why in a bubble on the board, over the cross. Drives the real banqi live client over a
// fake socket (the generic client's socketFactory seam, injected by mocking the
// factory), so the board, the click path and the notice are the shipped ones.

import type { BanqiMove } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from './i18n/catalog.js';
import type { BanqiWireView } from './live-banqi.js';
import { noticeReadMs, placeChaseBubble } from './live-banqi-chase-bubble.js';
import type { TenantLiveFrame } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const harness = vi.hoisted(() => ({
  options: null as unknown,
  sent: [] as unknown[],
}));

vi.mock('./variant-tenant/live-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variant-tenant/live-client.js')>();
  return {
    ...actual,
    createTenantLiveClient: ((config: Parameters<typeof actual.createTenantLiveClient>[0]) =>
      actual.createTenantLiveClient({
        ...config,
        socketFactory: (options: TenantSocketClientOptions) => {
          harness.options = options;
          return {
            connect: () => {},
            close: () => {},
            reconnectNow: () => {},
            send: (payload: unknown) => {
              harness.sent.push(payload);
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
      })) as typeof actual.createTenantLiveClient,
  };
});

const CHASE: BanqiMove = { from: 'c3', to: 'c2' };

// Red (the seat to move, red ink) has shuttled its advisor c3/c2 after black's
// chariot twice; c3-c2 again would make a position appear a third time.
const chaseView: BanqiWireView = {
  id: 'bq_chase',
  perspective: 'red',
  board: {
    c3: { color: 'red', role: 'advisor', faceDown: false },
    d2: { color: 'black', role: 'chariot', faceDown: false },
    h1: { color: 'red', role: 'soldier', faceDown: false },
    a4: { color: 'black', role: 'soldier', faceDown: false },
  },
  legalMoves: [
    { from: 'c3', to: 'b3' },
    { from: 'c3', to: 'c4' },
    { from: 'c3', to: 'd3' },
    { from: 'h1', to: 'g1' },
    { from: 'h1', to: 'h2' },
  ],
  captured: [],
  status: { type: 'playing', turn: 'red' },
  ply: 18,
  firstColor: 'red',
  moveNumber: 10,
  lastMove: { from: 'd3', to: 'd2' },
  chaseRule: 'repetition',
  forbiddenMoves: [CHASE],
};

async function mountRoom(view: BanqiWireView) {
  // The room's side fetches (chat, profiles) have nothing to talk to here.
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/room/bq_chase');
  harness.sent.length = 0;
  const { bootstrapBanqiLiveRoom } = await import('./live-banqi.js');
  bootstrapBanqiLiveRoom();
  const options = harness.options as TenantSocketClientOptions;
  options.applySnapshot({
    type: 'snapshot',
    seat: 'red',
    seats: {},
    state: view,
  } as unknown as TenantLiveFrame<string, BanqiWireView>);
  options.render();
}

function click(square: string): void {
  const hit = document.querySelector(`.banqi-live-board [data-square="${square}"]`);
  if (!hit) throw new Error(`no hit target for ${square}`);
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function chaseNotice(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-banqi-chase-notice]');
}

describe('live banqi: the 長捉 forbidden move', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the forbidden destination, refuses it with a notice, and sends nothing', async () => {
    await mountRoom(chaseView);
    expect(document.querySelector('[data-forbidden-move]')).toBeNull();

    click('c3');
    const cross = document.querySelector('[data-square="c2"][data-forbidden-move]');
    expect(cross?.querySelector('.banqi-hint-forbidden')).not.toBeNull();
    // The legal destinations keep their dots; the forbidden one has none.
    expect(document.querySelector('[data-square="d3"] .banqi-hint')).not.toBeNull();
    expect(document.querySelector('[data-square="c2"] .banqi-hint')).toBeNull();

    click('c2');
    expect(harness.sent).toEqual([]);
    expect(chaseNotice()?.textContent).toBe(
      'Perpetual chase (長捉): this move would repeat the position a third time. Play another move.',
    );
    // On the board (its stage overlay), not in the side column's action area.
    expect(chaseNotice()?.closest('.board-stage')).not.toBeNull();
    expect(chaseNotice()?.closest('[data-action-status]')).toBeNull();
    expect(document.querySelector('[data-action-status] .action-notice.danger')).toBeNull();
    // The piece stays selected, so the cross stays in view.
    expect(document.querySelector('[data-square="c2"][data-forbidden-move]')).not.toBeNull();

    // The next selection clears it; a legal move still goes out.
    click('h1');
    expect(chaseNotice()).toBeNull();
    click('g1');
    expect(harness.sent).toEqual([{ type: 'move', from: 'h1', to: 'g1' }]);
  });

  it('keeps a board notice up long enough to read, scaled by length', () => {
    expect(noticeReadMs('長捉：這步棋會讓同一局面第三次出現。請走別的著法。')).toBe(6000);
    const en =
      'Perpetual chase (長捉): this move would repeat the position a third time. Play another move.';
    expect(noticeReadMs(en)).toBeGreaterThan(6000);
    expect(noticeReadMs(en)).toBeLessThan(10000);
  });

  it('clears the notice after its reading time, keeping the selection', async () => {
    vi.useFakeTimers();
    await mountRoom(chaseView);
    click('c3');
    click('c2');
    expect(chaseNotice()).not.toBeNull();
    const ms = noticeReadMs(t('live.banqiChaseForbidden'));
    vi.advanceTimersByTime(ms - 100);
    expect(chaseNotice()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(chaseNotice()).toBeNull();
    expect(document.querySelector('[data-square="c2"][data-forbidden-move]')).not.toBeNull();
    expect(harness.sent).toEqual([]);
  });

  it('draws no cross when the view carries no forbidden moves', async () => {
    const { forbiddenMoves: _none, ...plain } = chaseView;
    await mountRoom(plain);
    click('c3');
    expect(document.querySelector('[data-forbidden-move]')).toBeNull();
    click('c2');
    expect(harness.sent).toEqual([]);
    expect(chaseNotice()).toBeNull();
  });
});

describe('placeChaseBubble', () => {
  const board = { left: 0, top: 0, width: 360, height: 200 };
  const bubble = { width: 200, height: 40 };

  it('sits above the square, centred on it', () => {
    const anchor = { left: 150, top: 100, width: 40, height: 40 };
    const placed = placeChaseBubble(anchor, board, bubble);
    expect(placed.below).toBe(false);
    expect(placed.top).toBe(100 - 6 - 40);
    expect(placed.left).toBe(170 - 100);
    expect(placed.caretX).toBe(100);
  });

  it('hangs below a top-row square', () => {
    const anchor = { left: 150, top: 10, width: 40, height: 40 };
    const placed = placeChaseBubble(anchor, board, bubble);
    expect(placed.below).toBe(true);
    expect(placed.top).toBe(10 + 40 + 6);
  });

  it('sits on the side away from the selected piece', () => {
    const anchor = { left: 150, top: 100, width: 40, height: 40 };
    // Piece above the cross: below, even with room above.
    const pieceAbove = { left: 150, top: 60, width: 40, height: 40 };
    expect(placeChaseBubble(anchor, board, bubble, pieceAbove).below).toBe(true);
    // Piece below the cross: above, even on a row with no room above.
    const high = { left: 150, top: 10, width: 40, height: 40 };
    const pieceBelow = { left: 150, top: 50, width: 40, height: 40 };
    expect(placeChaseBubble(high, board, bubble, pieceBelow).below).toBe(false);
    // Piece beside it on the row: above, falling back to below with no room.
    const beside = { left: 190, top: 100, width: 40, height: 40 };
    expect(placeChaseBubble(anchor, board, bubble, beside).below).toBe(false);
    const besideHigh = { left: 190, top: 10, width: 40, height: 40 };
    expect(placeChaseBubble(high, board, bubble, besideHigh).below).toBe(true);
  });

  it('stays inside the board at either edge, caret still on the square', () => {
    const right = placeChaseBubble({ left: 320, top: 100, width: 40, height: 40 }, board, bubble);
    expect(right.left + bubble.width).toBeLessThanOrEqual(board.width);
    expect(right.left + right.caretX).toBeGreaterThan(320);
    const left = placeChaseBubble({ left: 0, top: 100, width: 40, height: 40 }, board, bubble);
    expect(left.left).toBeGreaterThanOrEqual(0);
    expect(left.left + left.caretX).toBeLessThan(40);
  });
});
