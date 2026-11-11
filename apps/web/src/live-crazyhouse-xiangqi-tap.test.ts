// Crazyhouse xiangqi plays by tapping, not only by dragging: tap a hand piece
// then a point drops it, tap a piece then a destination moves it (#618, the
// phone room). Drives the real live client over a fake socket (the generic
// client's socketFactory seam, as live-banqi-chase.test.ts does), so the
// pocket tiles, the board hit targets and the click path are the shipped ones.

import {
  type CrazyhouseXiangqiPlayerView,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
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

// The start: red to move, advisors and elephants in hand.
const startView: CrazyhouseXiangqiPlayerView = getCrazyhouseXiangqiPlayerView(
  createInitialCrazyhouseXiangqiState('chx_tap'),
  'red',
);

async function mountRoom(): Promise<void> {
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', '/room/chx_tap');
  harness.sent.length = 0;
  const { bootstrapCrazyhouseXiangqiLiveRoom } = await import('./live-crazyhouse-xiangqi.js');
  bootstrapCrazyhouseXiangqiLiveRoom();
  const options = harness.options as TenantSocketClientOptions;
  options.applySnapshot({
    type: 'snapshot',
    seat: 'red',
    seats: {},
    state: startView,
  } as unknown as TenantLiveFrame<string, CrazyhouseXiangqiPlayerView>);
  options.render();
}

// A tap: the pointer goes down and up in place, then the click the browser
// sends for it. Under the drag threshold the drag helpers leave it to click.
function tap(el: Element): void {
  const at = { bubbles: true, button: 0, clientX: 10, clientY: 10, pointerType: 'touch' };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  el.dispatchEvent(new PointerEvent('pointerup', at));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function point(square: string): Element {
  const hit = document.querySelector(`.xiangqi-live-board [data-square="${square}"]`);
  if (!hit) throw new Error(`no hit target for ${square}`);
  return hit;
}

function handTile(role: string): Element {
  const tile = document.querySelector(`[data-captures] button[data-drop="${role}"]`);
  if (!tile) throw new Error(`no hand tile for ${role}`);
  return tile;
}

describe('live crazyhouse xiangqi: tap to play', () => {
  it('drops a hand piece: tap it in the pocket, then tap a point', async () => {
    await mountRoom();
    const target = startView.legalMoves.find((move) => 'drop' in move && move.drop === 'advisor');
    if (!target) throw new Error('no advisor drop at the start');

    tap(handTile('advisor'));
    expect(handTile('advisor').getAttribute('aria-grabbed')).toBe('true');
    expect(harness.sent).toEqual([]);

    tap(point(target.to));
    expect(harness.sent).toEqual([{ type: 'move', drop: 'advisor', to: target.to }]);
  });

  it('moves a piece: tap it, then tap a destination', async () => {
    await mountRoom();
    // Red's left cannon slides two points up its file.
    expect(startView.legalMoves).toContainEqual({ from: 'b3', to: 'b5' });

    tap(point('b3'));
    expect(harness.sent).toEqual([]);

    tap(point('b5'));
    expect(harness.sent).toEqual([{ type: 'move', from: 'b3', to: 'b5' }]);
  });

  it('sends nothing for a tap on a point the hand piece cannot reach', async () => {
    await mountRoom();
    tap(handTile('advisor'));
    // e10 is black's general.
    tap(point('e10'));
    expect(harness.sent).toEqual([]);
  });
});
