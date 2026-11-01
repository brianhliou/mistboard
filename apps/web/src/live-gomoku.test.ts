import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RAPFI_LEVELS } from './engine/rapfi.js';
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
const sentMoves = () => socket.sent.filter((value) => (value as { type?: string }).type === 'move');

const workers: TestWorker[] = [];
class TestWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  messages: unknown[] = [];
  terminated = false;
  constructor(readonly url: string) {
    workers.push(this);
  }
  postMessage(message: { type: string }) {
    this.messages.push(message);
    if (message.type === 'init') this.onmessage?.({ data: { type: 'ready' } });
  }
  terminate() {
    this.terminated = true;
  }
  answer(x = 7, y = 7) {
    this.onmessage?.({ data: { type: 'line', line: `${x},${y}` } });
    this.onmessage?.({ data: { type: 'done', elapsedMs: 1 } });
  }
}
const flushBot = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
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
  workers.length = 0;
  vi.stubGlobal('Worker', TestWorker);
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

describe('Rapfi browser PvE', () => {
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

  it.each(['black', 'white'] as const)(
    'plays the bot turn for a %s human at every level',
    async (human) => {
      for (const tier of RAPFI_LEVELS) {
        workers.length = 0;
        const state = position(human === 'black' ? 1 : 0);
        const options = await mount(state, human, state.ply, pveFrame(human, tier.level));
        expect(workers).toHaveLength(1);
        const worker = workers[0]!;
        expect(worker.url).toContain('/engine/rapfi/worker.js');
        const search = worker.messages[1] as { commands: string[] };
        expect(search.commands).toContain(`INFO max_node ${tier.nodes}`);
        expect(search.commands.at(-1)).toBe(human === 'white' ? 'BEGIN' : 'BOARD\n0,0,2\nDONE');
        expect(document.querySelector('[data-gomoku-bot]')?.textContent).toContain('GPL-3.0');
        expect(document.querySelector('[data-gomoku-bot] a:last-child')?.getAttribute('href')).toBe(
          'https://github.com/dhbloo/rapfi/archive/1387d11312.tar.gz',
        );
        // Snapshot retries and repeated paints cannot start parallel searches.
        refresh(options, state, human);
        expect(worker.messages).toHaveLength(2);
        worker.answer();
        await flushBot();
        expect(sentMoves()).toEqual([
          { type: 'move', to: 'h8', browserBot: true, roomId: ROOM, expectedPly: state.ply },
        ]);
        options.render();
        expect(sentMoves()).toHaveLength(1);
        // Only the server's echo may add the stone to the board.
        expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply);
        window.dispatchEvent(new Event('pagehide'));
      }
    },
  );

  it('starts after a Black human move and reuses the worker on subsequent bot turns', async () => {
    const options = await mount(position(0), 'black', 0, pveFrame('black'));
    expect(workers).toHaveLength(0);
    refresh(options, position(1), 'black');
    expect(workers).toHaveLength(1);
    workers[0]?.answer(0, 1);
    await flushBot();
    refresh(options, position(2), 'black');
    refresh(options, position(3), 'black');
    expect(workers).toHaveLength(1);
    const search = workers[0]?.messages.at(-1) as { commands: string[] };
    expect(search.commands.at(-1)).toBe('BOARD\n0,0,2\n1,0,2\n0,1,1\nDONE');
  });

  it('cancels on disconnect, ignores the old result and resumes from the reconnect snapshot', async () => {
    const options = await mount(position(0), 'white', 0, pveFrame('white'));
    const old = workers[0]!;
    socket.connection = 'reconnecting';
    options.render();
    expect(old.terminated).toBe(true);
    old.answer();
    await flushBot();
    expect(sentMoves()).toEqual([]);
    socket.connection = 'connected';
    options.applyHello({
      type: 'hello',
      seat: 'white',
      ...pveFrame('white'),
      state: getGomokuPlayerView(position(2), 'white'),
      events: events(2),
    } as TenantSocketFrame);
    options.render();
    expect(workers).toHaveLength(2);
    workers[1]?.answer();
    await flushBot();
    expect(sentMoves()).toEqual([
      { type: 'move', to: 'h8', browserBot: true, roomId: ROOM, expectedPly: 2 },
    ]);
  });

  it.each(['load', 'illegal'] as const)(
    'shows a recoverable %s error and retries only on request',
    async (failure) => {
      const options = await mount(position(1), 'black', 1, pveFrame('black'));
      if (failure === 'load') workers[0]?.onerror?.({ message: 'network file unavailable' });
      else workers[0]?.answer(0, 0);
      await flushBot();
      expect(sentMoves()).toEqual([]);
      expect(workers[0]?.terminated).toBe(true);
      expect(document.querySelector('[data-gomoku-bot]')?.textContent).toContain('could not load');
      options.render();
      expect(workers).toHaveLength(1);
      document.querySelector<HTMLButtonElement>('[data-gomoku-bot-action="retry"]')?.click();
      expect(workers).toHaveLength(2);
      workers[1]?.answer();
      await flushBot();
      expect(sentMoves()).toHaveLength(1);
    },
  );

  it('supports cancel/resume and releases the worker on a terminal frame or page exit', async () => {
    const options = await mount(position(0), 'white', 0, pveFrame('white'));
    document.querySelector<HTMLButtonElement>('[data-gomoku-bot-action="cancel"]')?.click();
    expect(workers[0]?.terminated).toBe(true);
    options.render();
    expect(workers).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-gomoku-bot-action="retry"]')?.click();
    expect(workers).toHaveLength(2);
    refresh(options, position(9), 'white');
    expect(workers[1]?.terminated).toBe(true);
    workers[1]?.answer();
    await flushBot();
    expect(sentMoves()).toEqual([]);
    await mount(position(0), 'white', 0, pveFrame('white'));
    window.dispatchEvent(new Event('pagehide'));
    expect(workers.at(-1)?.terminated).toBe(true);
  });

  it('never computes a move for spectators, PvP, rated rooms or unknown engine ids', async () => {
    for (const [seat, extras] of [
      ['spectator', pveFrame('white')],
      ['white', {}],
      ['white', { ...pveFrame('white'), rated: true }],
      ['white', { ...pveFrame('white'), pveEngineId: 'rapfi-level-6' }],
    ] as const) {
      await mount(position(0), seat, 0, extras);
      expect(workers).toHaveLength(0);
    }
  });

  it('cancels a paused room search and restarts at the same ply after resume', async () => {
    const options = await mount(position(0), 'white', 0, pveFrame('white'));
    for (const paused of [true, false]) {
      options.applySnapshot({
        type: 'snapshot',
        seat: 'white',
        state: getGomokuPlayerView(position(0), 'white'),
        browserBotPaused: paused,
      } as TenantSocketFrame);
      options.render();
      if (paused) expect(workers[0]?.terminated).toBe(true);
    }
    expect(workers).toHaveLength(2);
    workers[1]?.answer();
    await flushBot();
    expect(sentMoves()).toHaveLength(1);
  });
});

describe('hidden Gomoku live room', () => {
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
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>('.gomoku-move-row__move.move-jump'),
      ];
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
    'sends the full %i-stone opening to Rapfi on the actual side to move',
    async (count) => {
      const stones = ['h8', 'h9', 'i9', 'i8', 'g7'].slice(0, count).map((square, i) => ({
        square: square as GomokuMove['to'],
        color: i % 2 ? ('white' as const) : ('black' as const),
      }));
      const turn = count % 2 ? 'white' : 'black';
      const human = turn === 'black' ? 'white' : 'black';
      const state = createGomokuRoomState(ROOM, { stones, turn });
      await mount(state, human, 0, { ...pveFrame(human), events: [CREATED] });
      expect(workers).toHaveLength(1);
      const commands = (workers[0]!.messages[1] as { commands: string[] }).commands;
      expect(commands.at(-1)?.split('\n')).toHaveLength(count + 2);
      workers[0]!.answer(0, 0);
      await flushBot();
      expect(sentMoves()).toEqual([
        { type: 'move', to: 'a1', browserBot: true, roomId: ROOM, expectedPly: 0 },
      ]);
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

  it('shows an overline in full and preserves every edge hit target when flipped', () => {
    let state = createGomokuRoomState(ROOM);
    for (const to of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'e1', 'e2', 'f1', 'f2', 'd1'])
      state = applyGomokuRoomMove(state, { to } as GomokuMove);
    const view = getGomokuPlayerView(state, 'black');
    expect(view.winningLine).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
    document.body.innerHTML = gomokuBoardSvg(view, false, true);
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(6);
    expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
    expect(document.querySelector('[data-square="o15"] .gomoku-hit')?.getAttribute('x')).toBe('16');
  });
});

describe('hidden Gomoku setup conformance', () => {
  it('screens with the pinned evaluator despite CLI arguments and repeats with a cold hash', async () => {
    const script = await import(
      pathToFileURL(resolve(__dirname, '../../../scripts/screen-gomoku-openings.mjs')).href
    );
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

  it('offers a free opening in hidden Gomoku setup and preserves the selected colour', async () => {
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
    const navigate = vi.fn();
    setRoomNavigator(navigate);
    try {
      for (const free of [false, true]) {
        openLandingSetupDialog({
          mode: 'pvp',
          engineId: 'rapfi-level-1',
          initialGameSpecId: 'gomoku',
          initialColor: 'white',
          locale: 'en',
        });
        const checkbox = document.querySelector<HTMLInputElement>('[data-gomoku-free-opening]');
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(false);
        checkbox!.checked = free;
        checkbox!.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector<HTMLButtonElement>('.landing-setup-start')!.click();
        await vi.waitFor(() => expect(navigate).toHaveBeenCalled());
        const call = fetch.mock.calls.find(([input]) => input === '/api/rooms');
        expect(JSON.parse(call![1]!.body as string)).toMatchObject({
          gameSpecId: 'gomoku',
          preferredColor: 'white',
          opening: free ? 'free' : 'balanced',
          rated: false,
        });
        fetch.mockClear();
        navigate.mockClear();
        closeActiveLandingDialog();
      }
    } finally {
      closeActiveLandingDialog();
      setRoomNavigator(null);
      window.localStorage?.clear();
      vi.unstubAllGlobals();
    }
  });

  it('preserves balanced/free opening in both casual request modes without adding it to other variants', async () => {
    const { roomCreationRequestBody } = await import('./landing-play.js');
    const setupFor = (gameSpecId: 'gomoku' | 'xiangqi') => ({
      gameSpecId,
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      preferredColor: 'white' as const,
    });
    for (const mode of ['pvp', 'pve'] as const) {
      for (const opening of ['balanced', 'free'] as const) {
        expect(
          roomCreationRequestBody(mode, { ...setupFor('gomoku'), opening }, 'rapfi-level-1'),
        ).toMatchObject({ opening });
      }
      expect(roomCreationRequestBody(mode, setupFor('gomoku'))).toHaveProperty(
        'opening',
        'balanced',
      );
      expect(
        roomCreationRequestBody(mode, { ...setupFor('xiangqi'), opening: 'free' }),
      ).not.toHaveProperty('opening');
    }
  });
});
