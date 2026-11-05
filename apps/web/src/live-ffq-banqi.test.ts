import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  FFQ_BANQI_DAMAGE,
  type FFQBanqiEndReason,
  type FFQBanqiPlayerView,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
  connection: 'connected',
}));
vi.mock('./variant-tenant/socket-client.js', async (original) => ({
  ...(await original<typeof import('./variant-tenant/socket-client.js')>()),
  createTenantSocketClient: (options: TenantSocketClientOptions) => {
    socket.options = options;
    return {
      connect: () => {},
      close: () => {},
      reconnectNow: () => {},
      startPing: () => {},
      send: (payload: unknown) => {
        socket.sent.push(payload);
        return true;
      },
      connection: () => socket.connection,
      noticeTier: () => 'none',
      closeReason: () => '',
      clientId: () => 'test-client',
      latencyMs: () => null,
      reconnectAttempt: () => 0,
    };
  },
}));
vi.mock('./board-anim.js', async (original) => ({
  ...(await original<typeof import('./board-anim.js')>()),
  pieceAnimationDurationMs: () => 0,
  pieceFlipDurationMs: () => 0,
}));

const ROOM = 'ffqb_webtest';
function initial(): FFQBanqiPlayerView {
  return getFFQBanqiPlayerView(createInitialFFQBanqiState(ROOM, 7), 'red');
}
async function mount(
  view = initial(),
  seat = 'red',
  extra: Record<string, unknown> = {},
): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  vi.resetModules();
  const { bootstrapFFQBanqiLiveRoom } = await import('./live-ffq-banqi.js');
  bootstrapFFQBanqiLiveRoom();
  const options = socket.options;
  if (!options) throw new Error('No socket');
  options.applyHello({
    type: 'hello',
    seat,
    state: view,
    events: [{ type: 'room-created', roomId: ROOM, at: 0 }],
    ...extra,
  } as TenantSocketFrame);
  options.render();
  return options;
}
function click(index: number): void {
  const hit = document.querySelector(`[data-square="${ffqBanqiSquare(index)}"] rect`);
  if (!hit) throw new Error(`Missing hit ${index}`);
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
function moves(): unknown[] {
  return socket.sent.filter((p) => (p as { type: string }).type === 'move');
}
function resultText(): string | null | undefined {
  return document.querySelector('[data-game-result]')?.textContent;
}
beforeEach(() => {
  socket.options = null;
  socket.sent = [];
  socket.connection = 'connected';
  vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FFQ banqi live room', () => {
  it('draws all 32 hit targets, four open tiles, fixed seats, HP and quiet counters', async () => {
    await mount();
    expect(document.querySelector('#app.live-route--banqi')).not.toBeNull();
    expect(document.querySelectorAll('.banqi-live-board [data-square]')).toHaveLength(32);
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(4);
    const bars = [...document.querySelectorAll<HTMLProgressElement>('.ffq-banqi-hp progress')];
    expect(bars.map((bar) => [bar.value, bar.max])).toEqual([
      [60, 60],
      [60, 60],
    ]);
    expect(document.querySelector('.ffq-banqi-counters')?.textContent).toBe(
      'No progress 0/30 · Red chase 0/4 · Black chase 0/4',
    );
    expect(document.querySelectorAll('.seat-disc--red')).toHaveLength(1);
    expect(document.querySelectorAll('.seat-disc--black')).toHaveLength(1);
    expect(document.querySelector('.seat-disc--unbound')).toBeNull();
    expect(document.body.textContent).not.toMatch(/First to move|Second to move|first flip|binds/i);
  });

  it('sends a numeric flip, keeps Red after a black flip and lets Black move next', async () => {
    const state = createInitialFFQBanqiState(ROOM, 7);
    const target = state.board.findIndex((entry) => entry?.faceDown && entry.color === 'black');
    const options = await mount();
    click(target);
    expect(moves()).toEqual([{ type: 'move', from: target, to: target }]);
    const next = applyFFQBanqiMove(state, { from: target, to: target });
    options.applyHello({
      type: 'hello',
      seat: 'black',
      state: getFFQBanqiPlayerView(next, 'black'),
      events: [],
    } as TenantSocketFrame);
    options.render();
    const flip = getFFQBanqiPlayerView(next, 'black').legalMoves.find((m) => m.from === m.to)!;
    click(flip.to);
    expect(moves().at(-1)).toEqual({ type: 'move', from: flip.to, to: flip.to });
    expect(document.querySelector('[data-player-top]')?.textContent).toContain('Red');
    expect(document.querySelectorAll('.seat-disc--red')).toHaveLength(1);
    expect(document.querySelectorAll('.seat-disc--black')).toHaveLength(1);
  });

  it('selects and moves, rejects illegal clicks, and captures a covered cannon target', async () => {
    const view = initial();
    view.board[0] = { color: 'red', role: 'cannon', faceDown: false };
    view.board[2] = { faceDown: true };
    view.legalMoves = [
      { from: 0, to: 2 },
      { from: 2, to: 2 },
    ];
    await mount(view);
    click(0);
    expect(document.querySelector('.banqi-selection')).not.toBeNull();
    click(2);
    expect(moves()).toEqual([{ type: 'move', from: 0, to: 2 }]);
    click(15);
    expect(moves()).toHaveLength(1);
  });

  it('shows each capture damage against its owner, including a friendly covered capture', async () => {
    const view = initial();
    view.hp = { red: 58, black: 15 };
    view.noProgressClock = 29;
    view.chaseCounts = { red: 3, black: 4 };
    view.captured = [
      { owner: 'red', role: 'soldier', capturedBy: 'red', wasFaceDown: true },
      ...(['general', 'advisor', 'cannon'] as const).map((role) => ({
        owner: 'black' as const,
        role,
        capturedBy: 'red' as const,
        wasFaceDown: true,
      })),
    ];
    await mount(view);
    expect(document.querySelector('[data-side="red"]')?.textContent).toContain('58/60 HP');
    expect(document.querySelector('[data-side="black"]')?.textContent).toContain('15/60 HP');
    const damage = [...document.querySelectorAll('.ffq-banqi-captures li')].map(
      (li) => li.textContent,
    );
    for (const [i, capture] of view.captured.entries())
      expect(damage[i]).toContain(`−${FFQ_BANQI_DAMAGE[capture.role!]} HP`);
    expect(damage[0]).toBe('Red captured Red Soldier: Red −2 HP');
    expect(document.querySelector('.ffq-banqi-counters')?.textContent).toBe(
      'No progress 29/30 · Red chase 3/4 · Black chase 4/4',
    );
  });

  it('does not render a role or damage label for a masked covered capture', async () => {
    const view = initial();
    view.captured = [{ owner: 'black', role: null, capturedBy: 'red', wasFaceDown: true }];
    await mount(view);
    expect(document.querySelectorAll('.ffq-banqi-captures li')).toHaveLength(0);
    expect(document.querySelector('.ffq-banqi-captures')?.textContent).toBe('');
  });

  it('drags a revealed piece to a legal target using numeric wire coordinates', async () => {
    const view = initial();
    view.board[0] = { color: 'red', role: 'chariot', faceDown: false };
    view.board[1] = null;
    view.legalMoves = [{ from: 0, to: 1 }];
    await mount(view);
    const source = document.querySelector('[data-square="a1"] rect')!;
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() =>
      document.querySelector('[data-square="a2"] rect'),
    );
    source.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 60, clientY: 60 }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, clientX: 60, clientY: 60 }),
    );
    expect(moves()).toEqual([{ type: 'move', from: 0, to: 1 }]);
    expect(document.querySelector('.banqi-selection')).toBeNull();
  });

  it.each<[FFQBanqiEndReason, string]>([
    ['hp', 'HP depletion'],
    ['no-progress', 'no progress'],
    ['no-legal-move', 'no legal move'],
  ])('shows the %s result and keeps unrevealed tiles covered', async (reason, label) => {
    const view = initial();
    view.status = { type: 'finished', winner: reason === 'no-progress' ? null : 'red', reason };
    view.legalMoves = [];
    if (reason === 'hp') view.hp.black = 0;
    await mount(view);
    expect(resultText()?.toLowerCase()).toContain(label.toLowerCase());
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(4);
    expect(document.querySelectorAll('.banqi-back').length).toBe(28);
    click(0);
    expect(moves()).toEqual([]);
  });

  it.each(['spectator', 'black'])(
    'blocks input from %s and still shows both HP totals',
    async (seat) => {
      await mount(initial(), seat);
      click(0);
      expect(moves()).toEqual([]);
      expect(document.querySelectorAll('.ffq-banqi-hp')).toHaveLength(2);
    },
  );

  it('blocks disconnected input and disables the board with the flag off', async () => {
    await mount();
    socket.connection = 'disconnected';
    click(0);
    expect(moves()).toEqual([]);
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'false');
    socket.connection = 'connected';
    await mount();
    expect(document.querySelector('.banqi-live-board--disabled')).not.toBeNull();
    expect(document.querySelector('[data-square]')).toBeNull();
    expect(moves()).toEqual([]);
  });

  it('adopts finished masked history and repaints HP and counters when scrubbing', async () => {
    const start = initial();
    const end = initial();
    end.ply = 1;
    end.hp.black = 30;
    end.status = { type: 'finished', winner: 'red', reason: 'hp' };
    end.legalMoves = [];
    await mount(end, 'red', {
      liveHistory: [
        { ply: 0, view: start },
        { ply: 1, view: end },
      ],
      events: [{ type: 'move-played', color: 'red', move: { from: 0, to: 0 }, at: 1, ply: 1 }],
    });
    expect(document.querySelector('[data-side="black"]')?.textContent).toContain('30/60 HP');
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelector('[data-side="black"]')?.textContent).toContain('60/60 HP');
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(4);
    click(0);
    expect(moves()).toEqual([]);
  });
});
