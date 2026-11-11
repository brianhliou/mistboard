import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  createInitialGomokuState,
  GOMOKU_OPENINGS,
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  getGomokuLegalMoves,
  getGomokuPlayerView,
  RAPFI_LEVELS,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeDisplayPreference } from './display-preferences.js';
import { gomokuBoardSvg } from './gomoku-board.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
  connection: 'connected',
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
  };
});

const ROOM = 'gmk_webtest';
const CREATED = { type: 'room-created', roomId: ROOM, gameSpecId: 'gomoku', at: 0 };
const line = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1'] as const;
const moves = line.map((to) => ({ to }));
const events = (count: number) => [
  CREATED,
  ...moves.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'black' : 'white',
    move,
    at: index + 1,
    ply: index + 1,
  })),
];
function position(count: number) {
  return moves
    .slice(0, count)
    .reduce((state, move) => applyGomokuRoomMove(state, move), createGomokuRoomState(ROOM));
}

async function mount(
  state: GomokuRoomState,
  seat: GomokuColor | 'spectator',
  count = state.ply,
  extras: Record<string, unknown> = {},
) {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.sent = [];
  socket.options = null;
  socket.connection = 'connected';
  vi.resetModules();
  const { setResolvedAdmin } = await import('./signed-in-state.js');
  setResolvedAdmin(extras.admin === true);
  const { bootstrapGomokuLiveRoom } = await import('./live-gomoku.js');
  bootstrapGomokuLiveRoom();
  const options = socket.options as TenantSocketClientOptions | null;
  if (!options) throw new Error('no socket');
  options.applyHello({
    type: 'hello',
    seat,
    seats: { black: 'black-player', white: 'white-player' },
    state: getGomokuPlayerView(state, seat === 'white' ? 'white' : 'black', seat === 'spectator'),
    events: events(count),
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    roomMode: 'pvp',
    ...extras,
  } as TenantSocketFrame);
  options.render();
  return options;
}

function click(square: string) {
  document
    .querySelector<SVGElement>(`[data-square="${square}"] .gomoku-hit`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
function pointer(coarse: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      media,
      matches: media === '(pointer: coarse)' && coarse,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    })),
  );
}
const sentMoves = () => socket.sent.filter((value) => (value as { type?: string }).type === 'move');

const workers: TestWorker[] = [];
class TestWorker {
  constructor(readonly url: string) {
    workers.push(this);
  }
  postMessage() {}
  terminate() {}
}
const pveFrame = (seat: GomokuColor, level = 1): Record<string, unknown> => ({
  roomMode: 'pve',
  pveEngineId: `rapfi-level-${level}`,
  seats: { [seat]: 'test-client', [seat === 'black' ? 'white' : 'black']: `rapfi-level-${level}` },
});
const refresh = (options: TenantSocketClientOptions, state: GomokuRoomState, seat: GomokuColor) => {
  options.applySnapshot({
    type: 'snapshot',
    seat,
    state: getGomokuPlayerView(state, seat),
    events: events(state.ply),
  } as TenantSocketFrame);
  options.render();
};

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
  });
  workers.length = 0;
  vi.stubGlobal('Worker', TestWorker);
  pointer(false);
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Gomoku touch confirmation', () => {
  const preview = () => document.querySelector('.gomoku-preview');
  const previewPoint = () => preview()?.closest('[data-square]')?.getAttribute('data-square');

  it.each(['pvp', 'pve'] as const)(
    'previews the first tap and sends only the second tap in %s for either colour',
    async (mode) => {
      pointer(true);
      for (const seat of ['black', 'white'] as const) {
        await mount(
          position(seat === 'black' ? 0 : 1),
          seat,
          undefined,
          mode === 'pve' ? pveFrame(seat) : {},
        );
        click('h8');
        expect(sentMoves()).toEqual([]);
        expect(previewPoint()).toBe('h8');
        expect(preview()?.getAttribute('visibility')).toBe('visible');
        expect(preview()?.classList.contains(`gomoku-stone--${seat}`)).toBe(true);
        expect(document.querySelector('[data-piece-square="h8"]')).toBeNull();
        click('h8');
        expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
        expect(preview()).toBeNull();
      }
    },
  );

  it('moves the preview from A to B without sending', async () => {
    pointer(true);
    await mount(position(0), 'black');
    click('h8');
    click('i8');
    expect(sentMoves()).toEqual([]);
    expect(previewPoint()).toBe('i8');
    expect(document.querySelectorAll('.gomoku-preview')).toHaveLength(1);
    expect(
      document.querySelector('[data-square="h8"] .gomoku-ghost')?.getAttribute('visibility'),
    ).toBe('hidden');
    click('i8');
    expect(sentMoves()).toEqual([{ type: 'move', to: 'i8' }]);
  });

  it('sends the first click with a fine pointer', async () => {
    pointer(false);
    await mount(position(0), 'black');
    click('h8');
    expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
    expect(preview()).toBeNull();
  });

  it('sends the first tap when confirmation is disabled and clears any preview', async () => {
    pointer(true);
    await mount(position(0), 'black');
    click('h8');
    expect(previewPoint()).toBe('h8');
    writeDisplayPreference('confirmMovesOnTouch', false);
    expect(preview()).toBeNull();
    click('i8');
    expect(sentMoves()).toEqual([{ type: 'move', to: 'i8' }]);
    // The preference survives remounting a room.
    await mount(position(0), 'black');
    click('h8');
    expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
  });

  it('clears on occupied points, the board margin, and outside the board', async () => {
    pointer(true);
    await mount(position(1), 'white');
    for (const clear of [
      () => click('a1'),
      () =>
        document
          .querySelector('.gomoku-wood')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true })),
      () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    ]) {
      click('h8');
      expect(previewPoint()).toBe('h8');
      clear();
      expect(preview()).toBeNull();
    }
    expect(sentMoves()).toEqual([]);
  });

  it('clears after an opponent move even if it is still our turn on reconnect', async () => {
    pointer(true);
    const options = await mount(position(0), 'black');
    click('h8');
    expect(previewPoint()).toBe('h8');
    refresh(options, position(2), 'black');
    expect(preview()).toBeNull();
    click('h8');
    expect(sentMoves()).toEqual([]);
    expect(previewPoint()).toBe('h8');
  });

  it.each(['turn', 'end', 'illegal'] as const)('clears when the %s changes', async (change) => {
    pointer(true);
    const options = await mount(position(0), 'black');
    click('h8');
    expect(previewPoint()).toBe('h8');
    if (change === 'illegal') {
      const view = getGomokuPlayerView(position(0), 'black');
      options.applySnapshot({
        type: 'snapshot',
        seat: 'black',
        state: {
          ...view,
          legalMoves: view.legalMoves.filter((move) => move.to !== 'h8'),
        },
      } as TenantSocketFrame);
      options.render();
    } else {
      refresh(options, position(change === 'turn' ? 1 : 9), 'black');
    }
    expect(preview()).toBeNull();
    expect(sentMoves()).toEqual([]);
  });

  it('does not show a preview off turn, for spectators, or in replay', async () => {
    pointer(true);
    for (const seat of ['white', 'spectator'] as const) {
      await mount(position(0), seat);
      click('h8');
      expect(preview()).toBeNull();
      expect(sentMoves()).toEqual([]);
    }
    await mount(position(2), 'black');
    click('h8');
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    expect(preview()).toBeNull();
    click('i8');
    expect(preview()).toBeNull();
    expect(sentMoves()).toEqual([]);
  });

  it('keeps keyboard activation immediate on a coarse pointer', async () => {
    pointer(true);
    await mount(position(0), 'black');
    document
      .querySelector('[data-square="h8"] .gomoku-hit')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
    expect(preview()).toBeNull();
  });
});

describe('server-owned Gomoku PvE', () => {
  it('does not import the browser Rapfi adapter or delegate bot moves', () => {
    const source = readFileSync(resolve(__dirname, 'live-gomoku.ts'), 'utf8');
    expect(source).not.toContain('engine/rapfi');
    expect(source).not.toContain('browserBot');
  });

  it.each(['black', 'white'] as const)(
    'waits for the server bot for a %s human at every level',
    async (human) => {
      for (const tier of RAPFI_LEVELS) {
        const state = position(human === 'black' ? 1 : 0);
        const options = await mount(state, human, state.ply, pveFrame(human, tier.level));
        options.render();
        expect(workers).toHaveLength(0);
        expect(sentMoves()).toEqual([]);
        expect(document.querySelector('[data-gomoku-bot-action]')).toBeNull();
        refresh(options, position(state.ply + 1), human);
        expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply + 1);
        click('h8');
        expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
        expect(workers).toHaveLength(0);
      }
    },
  );

  it('keeps admitted admin playtests working with the public flag off', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'false');
    await mount(position(0), 'white', 0, { ...pveFrame('white'), admin: true });
    expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
    expect(workers).toHaveLength(0);
    expect(sentMoves()).toEqual([]);
  });

  it('links the finished room to review and reports the postgame action', async () => {
    await mount(position(9), 'white');
    const capture = vi.fn();
    const { setPostHogInstance } = await import('./analytics.js');
    setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
    const link = document.querySelector<HTMLAnchorElement>('.postgame-actions a[href*="/game/"]');
    expect(link?.getAttribute('href')).toBe(`/gomoku/game/${ROOM}`);
    link?.addEventListener('click', (event) => event.preventDefault());
    link?.click();
    expect(capture).toHaveBeenCalledWith('postgame_action', {
      action: 'review',
      variant: 'gomoku',
      mode: 'pvp',
    });
  });
});

describe('hidden Gomoku live room', () => {
  it('uses the shared Xiangqi board fill and ink tokens, including their default palette', () => {
    const css = readFileSync(resolve(__dirname, 'gomoku-board.css'), 'utf8');
    expect(css).toMatch(/\.gomoku-wood\s*\{\s*fill: var\(--xq-live-board-bg, #f5dca8\)/);
    for (const [selector, property] of [
      ['grid', 'stroke'],
      ['star', 'fill'],
      ['coordinate', 'fill'],
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.gomoku-${selector}\\s*\\{\\s*${property}: var\\(--xq-live-ink, #5a3a14\\)`),
      );
    }
  });

  it('shows a hover stone only on an empty legal point on your turn with a hovering pointer', async () => {
    const hover = (square: string, pointerType = 'mouse', buttons = 0) => {
      document
        .querySelector(`[data-square="${square}"] .gomoku-hit`)
        ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType, buttons }));
    };
    const ghost = () => document.querySelector('.gomoku-ghost[visibility="visible"]');
    for (const seat of ['black', 'white'] as const) {
      const options = await mount(position(seat === 'black' ? 2 : 1), seat);
      expect(ghost()).toBeNull();
      hover('h8');
      expect(ghost()?.classList.contains(`gomoku-stone--${seat}`)).toBe(true);
      expect(ghost()?.closest('[data-square]')?.getAttribute('data-square')).toBe('h8');
      hover('a1');
      expect(ghost()).toBeNull();
      for (const pointer of ['touch', '']) {
        hover('h8', pointer);
        expect(ghost()).toBeNull();
      }
      hover('h8', 'mouse', 1);
      expect(ghost()).toBeNull();
      hover('h8');
      document.querySelector('.gomoku-live-board')!.dispatchEvent(new PointerEvent('pointerleave'));
      expect(ghost()).toBeNull();
      hover('h8');
      socket.connection = 'reconnecting';
      options.render();
      hover('h8');
      expect(ghost()).toBeNull();
    }
    for (const seat of ['black', 'spectator'] as const) {
      await mount(position(1), seat);
      hover('h8');
      expect(ghost()).toBeNull();
    }
    await mount(position(2), 'black');
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    hover('h8');
    expect(ghost()).toBeNull();
    await mount(position(9), 'black');
    hover('h8');
    expect(ghost()).toBeNull();
  });

  it('has no browser bot status or retry controls on the server bot turn', async () => {
    await mount(position(0), 'white', 0, pveFrame('white'));
    expect(document.querySelector('[data-gomoku-bot]')).toBeNull();
    expect(document.querySelector('[data-gomoku-bot-action]')).toBeNull();
  });

  it('marks each player row with the shared disc of the stone that seat plays (phone, 2026-11-05)', async () => {
    await mount(position(0), 'white', 0, pveFrame('white'));
    const rows = [...document.querySelectorAll('.clock-player-line')];
    const discs = rows.map((row) => row.querySelector('.clock-seat-disc')?.className ?? null);
    expect(discs.sort()).toEqual([
      'clock-seat-disc seat-disc seat-disc--black',
      'clock-seat-disc seat-disc seat-disc--white',
    ]);
    const own = rows.find((row) => row.textContent?.includes('You'));
    expect(own?.querySelector('.seat-disc--white')).not.toBeNull();
    expect(document.querySelector('.clock-seat-stone')).toBeNull();
  });

  it('shows no bot panel while Rapfi is idle on the human turn', async () => {
    await mount(position(0), 'black', 0, pveFrame('black'));
    expect(document.querySelector('[data-gomoku-bot]')).toBeNull();
  });

  it('uses the Three Kingdoms paired move-list shape and shared current-move styling', async () => {
    const reference = readFileSync(resolve(__dirname, 'live-three-kingdoms-banqi.ts'), 'utf8');
    expect(reference).toContain("rowClass: 'move-row xiangqi-move-row'");
    expect(reference).toContain("cellPrefix: 'xiangqi-move-row'");
    expect(readFileSync(resolve(__dirname, 'live-gomoku.ts'), 'utf8')).toContain(
      "import './live-xiangqi.css'",
    );
    await mount(position(4), 'black');
    const list = document.querySelector('.move-list')!;
    expect(list.classList.contains('xiangqi-move-list')).toBe(true);
    const rows = [...list.querySelectorAll('.move-row.xiangqi-move-row')];
    expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
      ['1.', 'a1', 'a2'],
      ['2.', 'b1', 'b2'],
    ]);
    (rows[1]!.children[1] as HTMLButtonElement).click();
    expect(document.querySelector('.xiangqi-move-row__move.active')?.textContent).toBe('b1');
    document.querySelector<HTMLButtonElement>('.move-list .move-jump')!.click();
    expect(document.querySelector('.xiangqi-move-row__move.active')?.textContent).toBe('a1');
    expect(document.querySelectorAll('.move-row.xiangqi-move-row')).toHaveLength(2);
  });

  it('keeps A on the left and row 1 at the bottom for both seats, without a flip control', async () => {
    for (const seat of ['black', 'white'] as const) {
      await mount(position(1), seat);
      const stone = document.querySelector('[data-piece-square="a1"]')!;
      expect([stone.getAttribute('cx'), stone.getAttribute('cy')]).toEqual(['32', '480']);
      expect(document.querySelector('[data-square="o15"] .gomoku-hit')?.getAttribute('x')).toBe(
        '464',
      );
      expect(document.querySelector('[data-replay-flip]:not([hidden])')).toBeNull();
    }
  });

  it('hides coordinates by default and repaints when the site preference changes', async () => {
    await mount(position(1), 'white');
    expect(document.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
    writeDisplayPreference('boardCoordinates', true);
    expect(document.querySelectorAll('.gomoku-coordinate')).toHaveLength(30);
    const labels = [...document.querySelectorAll('.gomoku-coordinate')];
    expect(labels.find((label) => label.textContent === 'a')?.getAttribute('x')).toBe('32');
    expect(labels.find((label) => label.textContent === '1')?.getAttribute('y')).toBe('484');
    writeDisplayPreference('boardCoordinates', false);
    expect(document.querySelectorAll('.gomoku-coordinate')).toHaveLength(0);
  });

  it.each([3, 4, 5])(
    'keeps dealt %i-stone move-list jumps in chronological order',
    async (count) => {
      const stones = ['h8', 'h9', 'i9', 'i8', 'g7'].slice(0, count).map((square, i) => ({
        square: square as GomokuMove['to'],
        color: i % 2 ? ('white' as const) : ('black' as const),
      }));
      const turn = count % 2 ? 'white' : 'black';
      const first = applyGomokuRoomMove(createGomokuRoomState(ROOM, { stones, turn }), {
        to: 'a1',
      });
      const state = applyGomokuRoomMove(first, { to: 'b1' });
      await mount(state, 'spectator', 0, {
        events: [
          CREATED,
          { type: 'move-played', color: turn, move: { to: 'a1' }, at: 1, ply: 1 },
          {
            type: 'move-played',
            color: turn === 'white' ? 'black' : 'white',
            move: { to: 'b1' },
            at: 2,
            ply: 2,
          },
        ],
      });
      const buttons = [...document.querySelectorAll<HTMLButtonElement>('.move-list .move-jump')];
      expect(buttons.map((button) => button.textContent)).toEqual(['a1', 'b1']);
      buttons[0]!.click();
      expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(count + 1);
      expect(document.querySelector('[data-piece-square="a1"]')).not.toBeNull();
      expect(document.querySelector('[data-piece-square="b1"]')).toBeNull();
    },
  );

  it('replays from the dealt stones after reconnect, without replaying them as human moves', async () => {
    const opening = GOMOKU_OPENINGS[0]!;
    const start = createGomokuRoomState(ROOM, opening);
    const move = getGomokuLegalMoves(createInitialGomokuState(opening))[0]!;
    const state = applyGomokuRoomMove(start, move);
    await mount(state, 'spectator', 0, {
      events: [
        CREATED,
        {
          type: 'move-played',
          color: opening.turn,
          move,
          at: 1,
          ply: 1,
        },
      ],
    });
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply);
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(start.ply);
    for (const stone of opening.stones)
      expect(document.querySelector(`[data-piece-square="${stone.square}"]`)).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-replay="next"]')!.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply);
    expect(sentMoves()).toEqual([]);
  });

  it.each([3, 4, 5])(
    'renders the full %i-stone opening while waiting for the server',
    async (count) => {
      const stones = ['h8', 'h9', 'i9', 'i8', 'g7'].slice(0, count).map((square, i) => ({
        square: square as GomokuMove['to'],
        color: i % 2 ? ('white' as const) : ('black' as const),
      }));
      const turn = count % 2 ? 'white' : 'black';
      const human = turn === 'black' ? 'white' : 'black';
      const state = createGomokuRoomState(ROOM, { stones, turn });
      await mount(state, human, 0, { ...pveFrame(human), events: [CREATED] });
      expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(count);
      expect(workers).toHaveLength(0);
      expect(sentMoves()).toEqual([]);
    },
  );
  it.each(['black', 'white'] as const)(
    'places one stone from the %s seat with a click or keyboard',
    async (seat) => {
      const state = position(seat === 'black' ? 0 : 1);
      await mount(state, seat);
      expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
      expect(document.getElementById('app')?.classList.contains('live-route--gomoku')).toBe(true);
      click('h8');
      expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
      const target = document.querySelector('[data-square="i8"] .gomoku-hit');
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(sentMoves()).toContainEqual({ type: 'move', to: 'i8' });
      // No speculative placement: only the next server frame can put a stone down.
      expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply);
    },
  );

  it('blocks occupied points, the other turn, spectators, disconnected sockets and finished games', async () => {
    await mount(position(1), 'white');
    click('a1');
    expect(sentMoves()).toEqual([]);
    socket.connection = 'reconnecting';
    click('h8');
    expect(sentMoves()).toEqual([]);
    for (const seat of ['black', 'spectator'] as const) {
      await mount(position(1), seat);
      click('h8');
      expect(sentMoves()).toEqual([]);
    }
    await mount(position(9), 'black');
    click('h8');
    expect(sentMoves()).toEqual([]);
  });

  it('marks the latest placement and only highlights a completed winning line', async () => {
    await mount(position(8), 'black');
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(0);
    const options = await mount(position(9), 'white');
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(5);
    expect(document.querySelector('[data-square="e1"] .gomoku-last')).not.toBeNull();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(9);
    expect(document.querySelector('[data-replay="first"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    click('h8');
    expect(sentMoves()).toEqual([]);
    // A reconnect rebuilds history and restores the terminal board, including its marks.
    options.applyHello({
      type: 'hello',
      seat: 'white',
      state: getGomokuPlayerView(position(9), 'white'),
      events: events(9),
    } as TenantSocketFrame);
    options.render();
    document.querySelector<HTMLButtonElement>('[data-replay="latest"]')?.click();
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(5);
  });

  it('rebuilds every public ply after a live reload', async () => {
    await mount(position(6), 'black');
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(6);
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-replay="next"]')?.click();
    expect(document.querySelector('[data-piece-square="a1"]')).not.toBeNull();
    expect(document.querySelector('[data-square="a1"] .gomoku-last')).not.toBeNull();
    click('h8');
    expect(sentMoves()).toEqual([]);
  });

  it('shows an overline in full and preserves every edge hit target', () => {
    let state = createGomokuRoomState(ROOM);
    for (const to of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'e1', 'e2', 'f1', 'f2', 'd1'])
      state = applyGomokuRoomMove(state, { to } as GomokuMove);
    const view = getGomokuPlayerView(state, 'black');
    expect(view.winningLine).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
    document.body.innerHTML = gomokuBoardSvg(view, false);
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(6);
    expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
    expect(document.querySelector('[data-square="o15"] .gomoku-hit')?.getAttribute('x')).toBe(
      '464',
    );
  });
});

describe('hidden Gomoku setup conformance', () => {
  it('screens with the pinned evaluator despite CLI arguments and repeats with a cold hash', async () => {
    // @ts-expect-error The standalone Node script has no TypeScript declaration.
    const script = await import('../../../scripts/screen-gomoku-openings.mjs');
    const saved = process.argv;
    try {
      process.argv = [...saved, '--audit', '/tmp/unused-screen-test'];
      const engine = await script.loadEngine();
      const classic = script.classicOpenings()[0];
      const first = engine.search(classic, 10_000).screen;
      expect(first).not.toBeNull();
      expect(first.score, 'a missing evaluator would falsely report 0 / 50%').toBeLessThan(-100);
      expect(engine.search(classic, 10_000).screen).toEqual(first);
    } finally {
      process.argv = saved;
    }
  });

  it('omits opening selection in hidden Gomoku setup and preserves the selected colour', async () => {
    const { openLandingSetupDialog, closeActiveLandingDialog, setRoomNavigator } = await import(
      './landing-play.js'
    );
    const fetch = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ url: '/room/gmk_test' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const { setResolvedSignedIn } = await import('./signed-in-state.js');
    setResolvedSignedIn(true);
    const { setRatedModeEnabled } = await import('./rated-flag.js');
    setRatedModeEnabled(true);
    const navigate = vi.fn();
    setRoomNavigator(navigate);
    try {
      for (const mode of ['pvp', 'pve'] as const) {
        openLandingSetupDialog({
          mode,
          engineId: 'rapfi-level-1',
          initialGameSpecId: 'gomoku',
          initialColor: 'white',
          initialRated: mode === 'pvp',
          locale: 'en',
        });
        expect(document.querySelector('[data-gomoku-free-opening]')).toBeNull();
        expect(document.querySelector('[data-setup-section="opening"]')).toBeNull();
        document.querySelector<HTMLButtonElement>('.landing-setup-start')!.click();
        await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
        const call = fetch.mock.calls.find(([input]) => input === '/api/rooms');
        expect(JSON.parse(call![1]!.body as string)).toMatchObject({
          gameSpecId: 'gomoku',
          preferredColor: 'white',
          rated: mode === 'pvp',
        });
        expect(JSON.parse(call![1]!.body as string)).not.toHaveProperty('opening');
        fetch.mockClear();
        navigate.mockClear();
        closeActiveLandingDialog();
      }
    } finally {
      closeActiveLandingDialog();
      setRoomNavigator(null);
      setResolvedSignedIn(undefined);
      setRatedModeEnabled(false);
      window.localStorage?.clear();
      vi.unstubAllGlobals();
    }
  });

  it('omits opening fields in both casual request modes', async () => {
    const { roomCreationRequestBody } = await import('./landing-play.js');
    const setupFor = (gameSpecId: 'gomoku' | 'xiangqi') => ({
      gameSpecId,
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      preferredColor: 'white' as const,
    });
    for (const mode of ['pvp', 'pve'] as const) {
      for (const spec of ['gomoku', 'xiangqi'] as const) {
        expect(roomCreationRequestBody(mode, setupFor(spec), 'rapfi-level-1')).not.toHaveProperty(
          'opening',
        );
      }
    }
  });
});
