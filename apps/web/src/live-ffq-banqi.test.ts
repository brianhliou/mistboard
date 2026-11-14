import {
  applyFFQBanqiMove,
  type BanqiColor,
  type BanqiPieceRole,
  createInitialFFQBanqiState,
  type FFQBanqiEndReason,
  type FFQBanqiPlayerView,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { banqiRevealChance, banqiRevealOdds } from './banqi-reveal-odds.js';
import { ffqBanqiSquare } from './ffq-banqi-board.js';
import type { Locale } from './i18n/locale.js';
import { playSound, playTerminalPlan } from './live-sound.js';
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
vi.mock('./live-sound.js', async (original) => ({
  ...(await original<typeof import('./live-sound.js')>()),
  playSound: vi.fn(),
  playTerminalPlan: vi.fn(),
}));

const ROOM = 'ffqb_webtest';
function initial(): FFQBanqiPlayerView {
  return getFFQBanqiPlayerView(createInitialFFQBanqiState(ROOM, 7), 'red');
}
function coveredCapture() {
  const state = createInitialFFQBanqiState(ROOM, 7);
  // Keep the deal's multiset and each square's face while arranging a cannon
  // shot over square 10 onto its own covered general on 14.
  for (const [square, color, role] of [
    [6, 'red', 'cannon'],
    [14, 'red', 'general'],
    [15, 'black', 'general'],
    [16, 'red', 'soldier'],
    [25, 'black', 'soldier'],
  ] as const) {
    const source = state.board.findIndex((piece) => piece?.color === color && piece.role === role);
    const displaced = state.board[square]!;
    state.board[source] = { ...displaced, faceDown: state.board[source]!.faceDown };
    state.board[square] = { color, role, faceDown: displaced.faceDown };
  }
  const next = applyFFQBanqiMove(state, { from: 6, to: 14 });
  expect(next.captures).toEqual([
    { owner: 'red', role: 'general', capturedBy: 'red', wasFaceDown: true },
  ]);
  return next;
}
function faceDownRow(ink: BanqiColor): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `.hidden-pool [data-seat="${ink}"] [data-line="face-down"]`,
  );
  if (!row) throw new Error(`Missing ${ink} face-down row`);
  return row;
}
function renderedChance(ink: BanqiColor, role: BanqiPieceRole): string | null {
  return (
    faceDownRow(ink).querySelector(`[data-role="${role}"] .reveal-odds-chip__pct`)?.textContent ??
    null
  );
}
function chaseView(): FFQBanqiPlayerView {
  const state = createInitialFFQBanqiState(ROOM, 7);
  state.board.fill(null);
  state.board[0] = { color: 'red', role: 'chariot', faceDown: false };
  state.board[2] = { color: 'black', role: 'horse', faceDown: false };
  state.board[4] = { color: 'red', role: 'soldier', faceDown: false };
  state.board[31] = { color: 'red', role: 'soldier', faceDown: false };
  state.chaseCounts.red = 4;
  return getFFQBanqiPlayerView(state, 'red');
}
async function mount(
  view = initial(),
  seat = 'red',
  extra: Record<string, unknown> = {},
  locale: Locale = 'en',
): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  vi.resetModules();
  const { setStoredLocale } = await import('./i18n/locale.js');
  setStoredLocale(locale);
  const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
  await ensureLocaleCatalog(locale);
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
  vi.clearAllMocks();
  socket.options = null;
  socket.sent = [];
  socket.connection = 'connected';
  vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});
// Node's native localStorage can shadow happy-dom's storage in the test worker.
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.removeItem('mistboard.locale');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('FFQ banqi live room', () => {
  it('plays the move sound when sending a click move', async () => {
    const view = initial();
    view.board[0] = { color: 'red', role: 'chariot', faceDown: false };
    view.board[1] = null;
    view.legalMoves = [{ from: 0, to: 1 }];
    await mount(view);
    click(0);
    expect(playSound).not.toHaveBeenCalled();
    click(1);
    expect(moves()).toEqual([{ type: 'move', from: 0, to: 1 }]);
    expect(playSound).toHaveBeenCalledExactlyOnceWith('move');
  });

  it.each(['snapshot', 'event-appended'] as const)(
    'hears the first opponent flip from %s and stays quiet on reconnect',
    async (type) => {
      const state = createInitialFFQBanqiState(ROOM, 7);
      const options = await mount(getFFQBanqiPlayerView(state, 'black'), 'black');
      const move = getFFQBanqiPlayerView(state, 'red').legalMoves.find((m) => m.from === m.to)!;
      const next = applyFFQBanqiMove(state, move);
      const frame = {
        type,
        seat: 'black',
        state: getFFQBanqiPlayerView(next, 'black'),
        event: { type: 'move-played', color: 'red', move, at: 1, ply: 1 },
      };
      expect(playSound).not.toHaveBeenCalled();
      if (type === 'snapshot') options.applySnapshot(frame);
      else options.applyEvent(frame);
      expect(playSound).toHaveBeenCalledExactlyOnceWith('flip');
      options.applySnapshot({ ...structuredClone(frame), type: 'snapshot' });
      options.applyHello({ ...structuredClone(frame), type: 'hello' });
      expect(playSound).toHaveBeenCalledTimes(1);
    },
  );

  it('sounds a spectator result once from a finished snapshot', async () => {
    const view = initial();
    const options = await mount(view, 'spectator');
    view.status = { type: 'finished', winner: 'red', reason: 'resignation' };
    options.applySnapshot({
      type: 'snapshot',
      seat: 'spectator',
      state: view,
    } as TenantSocketFrame);
    options.applySnapshot({
      type: 'snapshot',
      seat: 'spectator',
      state: view,
    } as TenantSocketFrame);
    expect(playTerminalPlan).toHaveBeenCalledExactlyOnceWith('draw', null);
    expect(playSound).not.toHaveBeenCalled();
  });

  it('draws all 32 hit targets, four open tiles, fixed seats and the HP seat panel', async () => {
    await mount();
    expect(document.querySelector('#app.live-route--banqi.live-route--ffq-banqi')).not.toBeNull();
    expect(document.querySelectorAll('.banqi-live-board [data-square]')).toHaveLength(32);
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(4);
    // Three Kingdoms' seat panel under the board, the top seat first: HP where
    // it shows points, then each seat's captures ("None" before any).
    const blocks = [...document.querySelectorAll<HTMLElement>('.hidden-pool .tk-seat.tk-seat--hp')];
    expect(blocks.map((block) => block.dataset.seat)).toEqual(['black', 'red']);
    for (const block of blocks) {
      expect(block.querySelector('.tk-seat__name')?.textContent).toBe(
        block.dataset.seat === 'red' ? 'Red' : 'Black',
      );
      expect(block.querySelector('.tk-seat__head .ffq-banqi-hp-meter progress')).not.toBeNull();
      expect(block.querySelectorAll('.tk-seat__line')).toHaveLength(2);
      expect(block.querySelector('[data-line="captured"] .tk-seat__key')?.textContent).toBe(
        'Captured',
      );
      expect(block.querySelector('[data-line="captured"] .tk-seat__none')?.textContent).toBe(
        'None',
      );
    }
    const bars = [
      ...document.querySelectorAll<HTMLProgressElement>(
        '.hidden-pool .ffq-banqi-hp-meter progress',
      ),
    ];
    expect(bars.map((bar) => [bar.value, bar.max])).toEqual([
      [60, 60],
      [60, 60],
    ]);
    // No progress or chase readouts: those are rules, shown on the board only
    // when a move would break one.
    expect(document.querySelector('.ffq-banqi-progress, .ffq-banqi-counters')).toBeNull();
    expect(document.querySelector('.hidden-pool')?.textContent).not.toMatch(/progress|chase/i);
    // One disc per seat on each surface: the meta card and the clock rows (#901).
    for (const surface of ['.game-meta-card', '.clock-player-line']) {
      expect(document.querySelectorAll(`${surface} .seat-disc--red`)).toHaveLength(1);
      expect(document.querySelectorAll(`${surface} .seat-disc--black`)).toHaveLength(1);
    }
    expect(document.querySelector('.seat-disc--unbound')).toBeNull();
    expect(document.body.textContent).not.toMatch(/First to move|Second to move|first flip|binds/i);
  });

  it('uses the remaining public pool after a covered capture, with one denominator for both inks', async () => {
    const view = getFFQBanqiPlayerView(coveredCapture(), 'red');
    const expected = {
      red: { general: 0, advisor: 2, elephant: 2, chariot: 2, horse: 2, cannon: 1, soldier: 4 },
      black: { general: 0, advisor: 2, elephant: 2, chariot: 2, horse: 2, cannon: 2, soldier: 4 },
    };
    expect(view.pool).toEqual(expected);
    // Only the supplied remaining pool enters the odds code, with no truth
    // board or reconstruction of already-public covered captures.
    const odds = banqiRevealOdds({ pool: view.pool });
    expect(odds.total).toBe(27);
    let total = 0;
    for (const ink of ['red', 'black'] as const) {
      for (const [role, count] of Object.entries(expected[ink])) {
        const chance = banqiRevealChance(odds, ink, role as BanqiPieceRole);
        expect(chance).toBeCloseTo(count / 27);
        total += chance;
      }
    }
    expect(total).toBeCloseTo(1);
    await mount(view);
    expect(renderedChance('red', 'cannon')).toBe('4%');
    expect(renderedChance('black', 'cannon')).toBe('7%');
    expect(renderedChance('red', 'soldier')).toBe('15%');
    expect(renderedChance('red', 'general')).toBeNull();
    expect(renderedChance('black', 'general')).toBeNull();
  });

  it.each(['red', 'black', 'spectator'])(
    'keeps rendered odds identical for %s when covered identities swap, casual or rated',
    async (seat) => {
      const state = coveredCapture();
      const other = structuredClone(state);
      const a = other.board.findIndex((piece) => piece?.faceDown);
      const b = other.board.findIndex(
        (piece) => piece?.faceDown && piece.color !== other.board[a]!.color,
      );
      [other.board[a], other.board[b]] = [other.board[b]!, other.board[a]!];
      expect(other.board).not.toEqual(state.board);
      const perspective = seat === 'spectator' ? 'observer' : (seat as BanqiColor);
      const view = getFFQBanqiPlayerView(state, perspective);
      const swapped = getFFQBanqiPlayerView(other, perspective);
      expect(JSON.stringify(swapped)).toBe(JSON.stringify(view));
      const panels: string[] = [];
      for (const rated of [false, true]) {
        for (const masked of [view, swapped]) {
          await mount(masked, seat, { rated });
          for (const ink of ['red', 'black'] as const) {
            expect(faceDownRow(ink).querySelectorAll('.hidden-pool__chip')).toHaveLength(6);
          }
          panels.push(document.querySelector('.hidden-pool')!.innerHTML);
        }
      }
      expect(new Set(panels).size).toBe(1);
    },
  );

  it.each<[Locale, string]>([
    ['en', 'Still face-down'],
    ['zh-Hans', '尚未翻开'],
    ['zh-Hant', '尚未翻開'],
  ])('keeps final odds without a move log and reuses %s labels', async (locale, label) => {
    const view = getFFQBanqiPlayerView(coveredCapture(), 'observer');
    view.status = { type: 'finished', reason: 'resignation', winner: 'black' };
    view.legalMoves = [];
    await mount(view, 'spectator', {}, locale);
    for (const ink of ['red', 'black'] as const) {
      expect(faceDownRow(ink).querySelector('.tk-seat__key')?.textContent).toBe(label);
      expect(renderedChance(ink, 'soldier')).toBe('15%');
    }
  });

  it('keeps both face-down lines when the pool is empty, without invalid percentages', async () => {
    const state = createInitialFFQBanqiState(ROOM, 7);
    for (const piece of state.board) if (piece) piece.faceDown = false;
    await mount(getFFQBanqiPlayerView(state, 'red'));
    for (const ink of ['red', 'black'] as const) {
      expect(faceDownRow(ink).querySelector('.tk-seat__none')?.textContent).toBe('None');
    }
    expect(document.querySelector('.hidden-pool .reveal-odds-chip__pct')).toBeNull();
  });

  it('refreshes odds after a flip and restores each masked pool while scrubbing', async () => {
    const state = createInitialFFQBanqiState(ROOM, 7);
    const square = state.board.findIndex((piece) => piece?.faceDown && piece.role === 'general');
    const ink = state.board[square]!.color;
    const start = getFFQBanqiPlayerView(state, 'red');
    const next = applyFFQBanqiMove(state, { from: square, to: square });
    const options = await mount(start);
    expect(renderedChance(ink, 'general')).toBe('4%');
    options.applySnapshot({
      type: 'snapshot',
      state: getFFQBanqiPlayerView(next, 'red'),
    } as TenantSocketFrame);
    options.render();
    expect(renderedChance(ink, 'general')).toBeNull();
    next.status = { type: 'finished', winner: 'black', reason: 'resignation' };
    const end = getFFQBanqiPlayerView(next, 'red');
    await mount(end, 'red', {
      liveHistory: [
        { ply: 0, view: start },
        { ply: 1, view: end },
      ],
      events: [
        { type: 'move-played', color: 'red', move: { from: square, to: square }, at: 1, ply: 1 },
      ],
    });
    expect(renderedChance(ink, 'general')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    expect(renderedChance(ink, 'general')).toBe('4%');
    document.querySelector<HTMLButtonElement>('[data-replay="latest"]')!.click();
    expect(renderedChance(ink, 'general')).toBeNull();
  });

  it('sends a numeric flip, keeps Red after a black flip and lets Black move next', async () => {
    const state = createInitialFFQBanqiState(ROOM, 7);
    const target = state.board.findIndex((entry) => entry?.faceDown && entry.color === 'black');
    const options = await mount();
    click(target);
    expect(moves()).toEqual([{ type: 'move', from: target, to: target }]);
    expect(playSound).toHaveBeenCalledExactlyOnceWith('flip');
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
    // One disc per seat on each surface: the meta card and the clock rows (#901).
    for (const surface of ['.game-meta-card', '.clock-player-line']) {
      expect(document.querySelectorAll(`${surface} .seat-disc--red`)).toHaveLength(1);
      expect(document.querySelectorAll(`${surface} .seat-disc--black`)).toHaveLength(1);
    }
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
    expect(playSound).toHaveBeenCalledExactlyOnceWith('capture');
  });

  it.each<[Locale, string]>([
    [
      'en',
      'Fanfanqi allows only four chases in a row. This move would be your fifth. Play another move.',
    ],
    ['zh-Hans', '翻翻棋最多允许连续捉子四次。这步棋会是第五次。请走别的着法。'],
    ['zh-Hant', '翻翻棋最多允許連續捉子四次。這步棋會是第五次。請走別的著法。'],
  ])(
    'marks a fifth chase with a cross and explains it in %s without sending a move',
    async (locale, copy) => {
      const view = chaseView();
      await mount(view, 'red', {}, locale);
      expect(document.querySelector('[data-forbidden-move]')).toBeNull();
      // This piece has only forbidden moves, but must remain selectable.
      expect(view.legalMoves.some((move) => move.from === 0)).toBe(false);
      click(0);
      const cross = document.querySelector('[data-square="a2"][data-forbidden-move]');
      expect(cross?.querySelector('.banqi-hint-forbidden')).not.toBeNull();
      expect(cross?.querySelector('.banqi-hint')).toBeNull();
      expect(document.querySelectorAll('[data-forbidden-move]')).toHaveLength(1);
      click(1);
      expect(moves()).toEqual([]);
      const bubble = document.querySelector('[data-banqi-chase-notice]');
      expect(bubble?.textContent).toBe(copy);
      expect(bubble?.closest('.board-stage')).not.toBeNull();
      expect(document.querySelector('[data-square="a2"][data-forbidden-move]')).not.toBeNull();
      click(31);
      expect(document.querySelector('[data-banqi-chase-notice]')).toBeNull();
      expect(document.querySelector('[data-forbidden-move]')).toBeNull();
      expect(document.querySelector('[data-square="h3"] .banqi-hint')).not.toBeNull();
      click(30);
      expect(moves()).toEqual([{ type: 'move', from: 31, to: 30 }]);
    },
  );

  it('clears the chase bubble after its reading time and on a fresh snapshot', async () => {
    vi.useFakeTimers();
    const view = chaseView();
    const options = await mount(view);
    const { noticeReadMs } = await import('./live-banqi-chase-bubble.js');
    click(0);
    click(1);
    const text = document.querySelector('[data-banqi-chase-notice]')!.textContent!;
    vi.advanceTimersByTime(noticeReadMs(text) - 1);
    expect(document.querySelector('[data-banqi-chase-notice]')).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(document.querySelector('[data-banqi-chase-notice]')).toBeNull();
    expect(document.querySelector('[data-forbidden-move]')).not.toBeNull();
    click(1);
    expect(document.querySelector('[data-banqi-chase-notice]')).not.toBeNull();
    options.applySnapshot({ type: 'snapshot', state: view } as TenantSocketFrame);
    options.render();
    expect(document.querySelector('[data-banqi-chase-notice]')).toBeNull();
    expect(document.querySelector('[data-forbidden-move]')).toBeNull();
    expect(moves()).toEqual([]);
  });

  it('shows no cross or bubble when the view has no forbidden moves', async () => {
    const view = chaseView();
    delete view.forbiddenMoves;
    await mount(view);
    click(0);
    click(1);
    expect(document.querySelector('[data-forbidden-move]')).toBeNull();
    expect(document.querySelector('[data-banqi-chase-notice]')).toBeNull();
    expect(moves()).toEqual([]);
  });

  it('shows crosses only for the selected piece', async () => {
    const view = chaseView();
    view.board[29] = { color: 'black', role: 'general', faceDown: false };
    // h4-h3 would chase the black general on h2.
    view.legalMoves = view.legalMoves.filter((move) => !(move.from === 31 && move.to === 30));
    view.forbiddenMoves!.push({ from: 31, to: 30 });
    await mount(view);
    click(0);
    expect(document.querySelector('[data-square="a2"][data-forbidden-move]')).not.toBeNull();
    expect(document.querySelector('[data-square="h3"][data-forbidden-move]')).toBeNull();
    click(31);
    expect(document.querySelector('[data-square="a2"][data-forbidden-move]')).toBeNull();
    expect(document.querySelector('[data-square="h3"][data-forbidden-move]')).not.toBeNull();
  });

  it('shows each seat its captured pieces and HP from the view, including a friendly covered capture', async () => {
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
    expect(document.querySelector('[data-seat="red"] .tk-seat__head')?.textContent).toBe(
      'Red58/60 HP',
    );
    expect(document.querySelector('[data-seat="black"] .tk-seat__head')?.textContent).toBe(
      'Black15/60 HP',
    );
    const bars = [
      ...document.querySelectorAll<HTMLProgressElement>(
        '.hidden-pool .ffq-banqi-hp-meter progress',
      ),
    ];
    expect(bars.map((bar) => [bar.value, bar.max, bar.getAttribute('aria-label')])).toEqual([
      [15, 60, 'Black'],
      [58, 60, 'Red'],
    ]);
    // Red took three black pieces and, with a cannon, its own covered soldier;
    // a covered capture is shaded, as banqi shades one.
    const taken = [
      ...document.querySelectorAll(
        '[data-seat="red"] [data-line="captured"] .review-capture-piece',
      ),
    ];
    expect(taken.map((piece) => piece.getAttribute('aria-label'))).toEqual([
      'black general, captured face-down',
      'black advisor, captured face-down',
      'black cannon, captured face-down',
      'red soldier, captured face-down',
    ]);
    expect(taken.every((piece) => piece.classList.contains('is-taken-face-down'))).toBe(true);
    expect(
      document.querySelector('[data-seat="black"] [data-line="captured"] .tk-seat__none'),
    ).not.toBeNull();
    expect(document.querySelector('.ffq-banqi-progress, .ffq-banqi-counters')).toBeNull();
    expect(document.querySelector('.hidden-pool')?.textContent).not.toMatch(/progress|chase/i);
  });

  it('builds the seat panel from the viewer view alone: swapping two covered pieces changes nothing', async () => {
    const panels: string[] = [];
    for (const swap of [false, true]) {
      const state = createInitialFFQBanqiState(ROOM, 7);
      state.board[0] = { color: 'red', role: 'cannon', faceDown: false };
      state.board[1] = { color: 'black', role: 'soldier', faceDown: true };
      state.board[2] = { color: 'black', role: 'horse', faceDown: true };
      const covered = state.board
        .map((entry, index) => (entry?.faceDown && index > 2 ? index : -1))
        .filter((index) => index >= 0);
      const [a, b] = covered.filter(
        (index, _, all) =>
          state.board[index]!.color !== state.board[all[0]!]!.color ||
          state.board[index]!.role !== state.board[all[0]!]!.role ||
          index === all[0],
      );
      if (swap) [state.board[a!], state.board[b!]] = [state.board[b!], state.board[a!]];
      const captured = applyFFQBanqiMove(state, { from: 0, to: 2 });
      const view = getFFQBanqiPlayerView(captured, 'black');
      await mount(view, 'black');
      panels.push(document.querySelector('.hidden-pool')!.innerHTML);
    }
    expect(panels[0]).toContain('black horse, captured face-down');
    expect(panels[1]).toBe(panels[0]);
  });

  it('renders a cannon covered capture role for the non-capturer and observer, live and finished', async () => {
    const state = createInitialFFQBanqiState(ROOM, 7);
    state.board[0] = { color: 'red', role: 'cannon', faceDown: false };
    state.board[1] = { color: 'black', role: 'soldier', faceDown: true };
    state.board[2] = { color: 'black', role: 'horse', faceDown: true };
    const captured = applyFFQBanqiMove(state, { from: 0, to: 2 });
    for (const finished of [false, true]) {
      if (finished) captured.status = { type: 'finished', winner: 'red', reason: 'resignation' };
      for (const perspective of ['black', 'observer'] as const) {
        const view = getFFQBanqiPlayerView(captured, perspective);
        await mount(view, perspective === 'observer' ? 'spectator' : perspective);
        const taken = [
          ...document.querySelectorAll(
            '[data-seat="red"] [data-line="captured"] .review-capture-piece',
          ),
        ];
        expect(taken.map((piece) => piece.getAttribute('aria-label'))).toEqual([
          'black horse, captured face-down',
        ]);
        expect(view.board[1]).toEqual({ faceDown: true });
      }
    }
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
    expect(playSound).toHaveBeenCalledExactlyOnceWith('move');
    expect(document.querySelector('.banqi-selection')).toBeNull();
  });

  it('keeps a forbidden-only piece selected after dragging to its cross and sends nothing', async () => {
    await mount(chaseView());
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
    expect(moves()).toEqual([]);
    expect(playSound).not.toHaveBeenCalled();
    expect(document.querySelector('[data-forbidden-move]')).not.toBeNull();
    expect(document.querySelector('[data-banqi-chase-notice]')?.textContent).toContain(
      'four chases in a row',
    );
    expect(document.querySelector('.banqi-selection')).not.toBeNull();
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
      expect(document.querySelectorAll('.hidden-pool .ffq-banqi-hp-meter')).toHaveLength(2);
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

  it('adopts finished masked history and repaints HP when scrubbing', async () => {
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
