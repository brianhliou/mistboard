import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { rampMs, runBenchmark, summarizeRun } from './benchmark.js';
import { main, parseArgs } from './cli.js';
import {
  finalSnapshotAckSeq,
  type GameResult,
  matchesAcknowledgment,
  runScenario,
  type StateMessage,
  validateTarget,
} from './runner.js';
import { scenarios } from './scenarios.js';
import { summarize } from './stats.js';

type Seat = 'white' | 'black';
type Mode = 'normal' | 'stale' | 'timeout' | 'reject' | 'black-reject' | 'late' | 'final';
const moves = { white: { from: 'a2', to: 'a3' }, black: { from: 'a7', to: 'a6' } } as const;

function transport(mode: Mode = 'normal', delayedSearch = false, earlyTimerMs = 0) {
  let clock = 0;
  let connected = 0;
  let disconnected = 0;
  const clients: FakeClient[] = [];
  const fetchCalls: RequestInit[] = [];
  const state = (turn: Seat) => ({
    status: { type: 'playing', turn },
    moveNumber: 1,
    legalMoves: [moves[turn]],
  });
  class FakeClient {
    messages: StateMessage[] = [];
    receipts = new WeakMap<object, number>();
    constructor(readonly seat: Seat) {
      this.emit({ type: 'event-appended', seq: 10, state: state('white') });
    }
    emit(message: StateMessage & { reason?: string }) {
      this.messages.push(message);
      this.receipts.set(message, clock);
    }
    receivedAt(message: object) {
      return this.receipts.get(message);
    }
    send() {
      if (mode === 'timeout') return;
      if (mode === 'reject' || (mode === 'black-reject' && this.seat === 'black')) {
        clock += 2;
        this.emit({ type: 'error', reason: 'illegal move' });
        return;
      }
      const seq = this.seat === 'white' ? 12 : 13;
      if (mode === 'final') {
        // The server ends a game with a full snapshot, never a delta.
        clock += 4;
        const events = Array.from({ length: seq }, () => null) as StateMessage['events'];
        events!.push({ type: 'move-played', color: this.seat, move: moves[this.seat] });
        for (const client of clients) {
          client.emit({
            type: 'snapshot',
            events: client === this ? events : events!.map(() => null),
            state: { status: { type: 'finished', winner: this.seat, reason: 'king-captured' } },
          });
        }
        return;
      }
      if (mode === 'stale') {
        clock++;
        this.emit({
          type: 'event-appended',
          seq: 10,
          event: { type: 'move-played', color: this.seat, move: moves[this.seat] },
        });
        this.emit({
          type: 'event-appended',
          seq: 11,
          event: {
            type: 'move-played',
            color: this.seat,
            move: { ...moves[this.seat], promotion: 'queen' },
          },
        });
      }
      clock += this.seat === 'white' ? (mode === 'stale' ? 2 : 3) : 5;
      if (mode === 'late') clock += 1000;
      const turn = this.seat === 'white' ? 'black' : 'white';
      for (const client of clients) {
        client.emit({
          type: 'event-appended',
          seq,
          ...(client === this
            ? { event: { type: 'move-played', color: this.seat, move: moves[this.seat] } }
            : {}),
          state: state(turn),
        });
      }
      if (delayedSearch) clock += 700;
    }
    async waitFor<T = StateMessage>(
      predicate: (m: StateMessage) => boolean,
      opts: { timeoutMs: number },
    ): Promise<T> {
      // Yield so the other seat can submit before searching buffered messages.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const existing = this.messages.find(predicate);
      if (existing) return existing as T;
      clock += opts.timeoutMs - earlyTimerMs;
      throw new Error('wait timeout');
    }
    async disconnect() {
      disconnected++;
    }
    isClosed() {
      return false;
    }
  }
  return {
    io: {
      now: () => clock,
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        fetchCalls.push(init ?? {});
        return new Response(JSON.stringify({ roomId: `local-${connected}` }), { status: 201 });
      },
      connect: async () => {
        const client = new FakeClient(connected++ % 2 === 0 ? 'white' : 'black');
        clients.push(client);
        return client;
      },
    },
    clients,
    fetchCalls,
    advance: (ms: number) => {
      clock += ms;
    },
    disconnected: () => disconnected,
  };
}

const options = () => ({
  serverUrl: 'ws://127.0.0.1:3001',
  scenario: { ...scenarios['pvp-blitz'], maxMoves: 1 },
  concurrency: 1,
  seed: 42,
});

function successfulGames(count: number): GameResult[] {
  return [
    {
      scenario: 'pvp-blitz',
      gameIdx: 0,
      seed: 42,
      durationMs: 1000,
      finishedNaturally: false,
      moveLatencies: [],
      failures: [],
      moveAttempts: Array.from({ length: count }, (_, i) => ({
        color: 'white',
        move: moves.white,
        submittedMs: 100 + i,
        receivedMs: 101 + 2 * i,
        seq: i + 1,
        latencyMs: i + 1,
        phase: 'measurement',
        outcome: 'acknowledged',
      })),
    },
  ];
}

test('loadtest: empty samples cannot produce latency percentiles', () => {
  assert.equal(summarize([]), null);
  assert.throws(() => summarize([NaN]), /finite/);
});

test('loadtest: nearest-rank percentiles reconstruct exactly without sorting raw data', () => {
  const raw = Array.from({ length: 101 }, (_, i) => 101 - i);
  const summary = summarize(raw)!;
  for (const [key, p] of [
    ['p50', 0.5],
    ['p95', 0.95],
    ['p99', 0.99],
  ] as const) {
    assert.equal(summary[key], [...raw].sort((a, b) => a - b)[Math.ceil(p * raw.length) - 1]);
  }
  assert.equal(raw[0], 101);
});

test('loadtest: acknowledgment requires mover, exact move/promotion and a newer sequence', () => {
  const good = {
    type: 'event-appended',
    seq: 11,
    event: { type: 'move-played', color: 'white', move: moves.white },
  } as const;
  assert.equal(matchesAcknowledgment(good, moves.white, 'white', 10), true);
  const badFrames: StateMessage[] = [
    { ...good, seq: 10 },
    { ...good, seq: 9 },
    { ...good, seq: undefined },
    { ...good, seq: 11.2 },
    { ...good, type: 'snapshot' },
    { ...good, event: undefined },
    { ...good, event: { ...good.event, color: 'black' } },
    { ...good, event: { ...good.event, move: { ...moves.white, to: 'a4' } } },
    { ...good, event: { ...good.event, move: { ...moves.white, promotion: 'queen' } } },
  ];
  for (const bad of badFrames)
    assert.equal(matchesAcknowledgment(bad, moves.white, 'white', 10), false);
});

test('loadtest: both movers use receipt timestamps, without awaiting an opponent reply', async () => {
  const fake = transport('normal', true);
  const [game] = await runScenario(options(), fake.io);
  assert.deepEqual(game.failures, []);
  assert.deepEqual(
    game!.moveAttempts.map((a) => a.latencyMs),
    [3, 5],
  );
  assert.deepEqual(
    game.moveAttempts.map((a: { color: string }) => a.color),
    ['white', 'black'],
  );
  assert.equal(fake.disconnected(), 2);
  assert.equal(fake.fetchCalls[0]?.redirect, 'error');
});

test('loadtest: a ramp spreads room setup instead of opening every room at once', async () => {
  const fake = transport('normal');
  const pauses: number[] = [];
  const io = {
    ...fake.io,
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
  };
  const games = await runScenario({ ...options(), concurrency: 4, rampMs: 400 }, io);
  assert.equal(games.length, 4);
  // The fake serves one room, so only the stagger is asserted here.
  // The first worker starts at once; the rest wait their share of the ramp.
  assert.deepEqual(pauses, [100, 200, 300]);
  assert.equal(rampMs(200, 10_000), 2000);
  assert.equal(rampMs(200, 1000), 500);
  await assert.rejects(runScenario({ ...options(), rampMs: -1 }, fake.io));
  // Planted failure: with no ramp nothing is staggered.
  const flat = transport('normal');
  let calls = 0;
  await runScenario(
    { ...options(), concurrency: 4 },
    { ...flat.io, sleep: async () => void calls++ },
  );
  assert.equal(calls, 0);
});

test('loadtest: think time delays submission and never enters a latency sample', async () => {
  const fake = transport('normal');
  const pauses: number[] = [];
  const io = {
    ...fake.io,
    sleep: async (ms: number) => {
      pauses.push(ms);
      fake.advance(ms);
    },
  };
  const [game] = await runScenario({ ...options(), thinkMs: 1000 }, io);
  assert.deepEqual(game!.failures, []);
  assert.equal(pauses.length, 2);
  for (const pause of pauses) assert.ok(pause >= 500 && pause < 1500, String(pause));
  assert.deepEqual(
    game!.moveAttempts.map((a) => a.latencyMs),
    [3, 5],
  );
  // Each submission comes after that seat's own pause.
  assert.ok(game!.moveAttempts.every((a) => a.submittedMs >= 500));
  await assert.rejects(runScenario({ ...options(), thinkMs: -1 }, fake.io));
  // No pause is requested when think time is off.
  const closed = transport('normal');
  let calls = 0;
  await runScenario(options(), { ...closed.io, sleep: async () => void calls++ });
  assert.equal(calls, 0);
});

test('loadtest: a game-ending move is acknowledged by the final snapshot that carries it', async () => {
  const fake = transport('final');
  const [game] = await runScenario(options(), fake.io);
  assert.deepEqual(game!.failures, []);
  assert.deepEqual(
    game!.moveAttempts.map((a) => [a.color, a.outcome, a.latencyMs, a.seq]),
    [['white', 'acknowledged', 4, 12]],
  );
  assert.equal(game!.finishedNaturally, true);
  const snapshot = (events: StateMessage['events'], type = 'finished'): StateMessage => ({
    type: 'snapshot',
    events,
    state: { status: { type } },
  });
  const mine = { type: 'move-played', color: 'white', move: moves.white } as const;
  assert.equal(finalSnapshotAckSeq(snapshot([null, mine]), moves.white, 'white', 0), 1);
  // Planted failures: an old copy of the move, another seat's move, a live
  // snapshot and a finish that does not contain the move (opponent resigned).
  assert.equal(finalSnapshotAckSeq(snapshot([null, mine]), moves.white, 'white', 1), -1);
  assert.equal(finalSnapshotAckSeq(snapshot([null, mine]), moves.white, 'black', 0), -1);
  assert.equal(finalSnapshotAckSeq(snapshot([null, mine], 'playing'), moves.white, 'white', 0), -1);
  assert.equal(
    finalSnapshotAckSeq(
      snapshot([null, { type: 'resigned', color: 'black' }]),
      moves.white,
      'white',
      0,
    ),
    -1,
  );
});

test('loadtest: stale, duplicate and unrelated frames cannot acknowledge a move twice', async () => {
  const fake = transport('stale');
  const [game] = await runScenario(options(), fake.io);
  assert.deepEqual(game.failures, []);
  assert.equal(game.moveAttempts.length, 2);
  assert.equal(game.moveAttempts[0].seq, 12);
  assert.equal(game.moveAttempts[0].latencyMs, 3);
});

test('loadtest: illegal moves are retained as failed attempts, never latency samples', async () => {
  const [game] = await runScenario(options(), transport('reject').io);
  assert.ok(game.failures.includes('white-move-rejected'));
  assert.equal(game.moveAttempts[0].outcome, 'rejected');
  assert.equal(game.moveAttempts[0].latencyMs, undefined);
});

test('loadtest: black failure is retained along with prior white samples', async () => {
  const [game] = await runScenario(options(), transport('black-reject').io);
  assert.ok(game.failures.includes('black-move-rejected'));
  assert.equal(game.moveAttempts[0].latencyMs, 3);
  assert.equal(game.moveAttempts[1].outcome, 'rejected');
});

test('loadtest: move timeout is a failed attempt and stops worker retries', async () => {
  const fake = transport('timeout');
  const games = await runScenario({ ...options(), durationMs: 60_000 }, fake.io);
  assert.equal(games.length, 1);
  assert.ok(games[0].failures.some((f: string) => f.includes('timeout')));
  assert.equal(games[0].moveAttempts[0].outcome, 'timeout');
});

test('loadtest: the measurement deadline censors late acknowledgments without inventing timeouts', async () => {
  const [game] = await runScenario({ ...options(), durationMs: 100 }, transport('late').io);
  assert.deepEqual(game.failures, []);
  assert.equal(game.moveAttempts[0].outcome, 'window-ended');
  assert.equal(game.moveAttempts[0].latencyMs, undefined);
});

test('loadtest: a wait cut short by the window is censored even when its timer fires early', async () => {
  // The move is never answered and the timer fires 0.5ms before the deadline.
  const [game] = await runScenario(
    { ...options(), durationMs: 100 },
    transport('timeout', false, 0.5).io,
  );
  assert.deepEqual(game!.failures, []);
  assert.deepEqual(
    game!.moveAttempts.map((a) => [a.outcome, a.latencyMs]),
    [['window-ended', undefined]],
  );
  // Planted failure: the same silence with the whole move timeout available is a timeout.
  const [stuck] = await runScenario(options(), transport('timeout', false, 0.5).io);
  assert.equal(stuck!.moveAttempts[0]!.outcome, 'timeout');
  assert.ok(stuck!.failures.includes('white-ack-timeout'));
});

test('loadtest: failed room creation produces a sanitized failure for every worker', async () => {
  const fake = transport();
  fake.io.fetch = async () => new Response('private body must not escape', { status: 503 });
  const games = await runScenario({ ...options(), concurrency: 2 }, fake.io);
  assert.equal(games.length, 2);
  assert.ok(games.every((g) => g.error === 'room-create-503'));
  assert.equal(JSON.stringify(games).includes('private body'), false);
  assert.equal(fake.clients.length, 0);
});

test('loadtest: first socket is closed if opening the second fails', async () => {
  const fake = transport();
  const connect = fake.io.connect;
  let count = 0;
  fake.io.connect = async () => {
    if (count++) throw new Error('private URL');
    return connect();
  };
  const [game] = await runScenario(options(), fake.io);
  assert.equal(game.error, 'transport-or-setup-failed');
  assert.equal(fake.disconnected(), 1);
});

test('loadtest: summary excludes warmup, integrates actual activity and reconstructs p50/p95', () => {
  const games = successfulGames(100);
  games[0]!.moveAttempts.push({ ...games[0]!.moveAttempts[0]!, phase: 'warmup', latencyMs: 9999 });
  const summary = summarizeRun(
    games,
    [
      { atMs: 0, activeGames: 0 },
      { atMs: 50, activeGames: 2 },
      { atMs: 600, activeGames: 1 },
    ],
    100,
    1000,
    1100,
  );
  assert.equal(summary.sampleCount, 100);
  assert.equal(summary.acknowledgmentMs!.p50, 50);
  assert.equal(summary.acknowledgmentMs!.p95, 95);
  assert.equal(summary.achievedMovesPerSecond, 100);
  assert.equal(summary.activeGames.mean, 1.5);
  assert.equal(summary.activeGames.min, 1);
  assert.equal(summary.activeGames.max, 2);
});

test('loadtest: insufficient samples, incomplete windows and failures suppress claims', () => {
  assert.equal(summarizeRun(successfulGames(99), [], 0, 1000, 1000).acknowledgmentMs, null);
  assert.equal(summarizeRun(successfulGames(100), [], 0, 1000, 999).acknowledgmentMs, null);
  const failed = successfulGames(100);
  failed[0]!.failures.push('black-ack-timeout');
  assert.equal(summarizeRun(failed, [], 0, 1000, 1000).acknowledgmentMs, null);
});

test('loadtest: benchmark retains all six failed repetitions, source metadata and raw results', async () => {
  const fake = transport();
  fake.io.fetch = async () => new Response('', { status: 503 });
  const record = await runBenchmark(
    {
      ...options(),
      concurrencies: [1, 50],
      repetitions: 3,
      warmupMs: 10_000,
      durationMs: 60_000,
      persistence: 'memory',
      placement: 'same-host-separate-process',
    },
    fake.io,
  );
  assert.equal(record.runs.length, 6);
  assert.equal(
    record.runs.reduce((n: number, r: { games: object[] }) => n + r.games.length, 0),
    153,
  );
  assert.equal(record.eligible, false);
  assert.ok(
    record.runs.every(
      (r: { summary: { acknowledgmentMs: unknown } }) => r.summary.acknowledgmentMs === null,
    ),
  );
  assert.match(record.metadata.sourceRevision, /^[a-f0-9]{40}$/);
  assert.match(record.metadata.harnessSha256, /^[a-f0-9]{64}$/);
});

test('loadtest: non-loopback and credential-bearing targets are rejected before transport', async () => {
  for (const url of [
    'wss://mistboard.com',
    'ws://localhost:3001',
    'ws://0.0.0.0',
    'ws://192.168.1.2',
    'https://127.0.0.1',
    'ws://user:secret@127.0.0.1',
    'ws://127.0.0.1/?token=secret',
    'ws://[::ffff:127.0.0.1]',
    'ws://127.0.0.1/path',
  ]) {
    assert.throws(() => validateTarget(url), /loopback/);
  }
  assert.equal(validateTarget('ws://127.0.0.1:3001'), 'ws://127.0.0.1:3001');
  assert.equal(validateTarget('ws://[::1]:3001'), 'ws://[::1]:3001');
  let called = false;
  const fake = transport();
  fake.io.fetch = async () => {
    called = true;
    throw new Error();
  };
  await assert.rejects(
    runScenario({ ...options(), serverUrl: 'wss://mistboard.com' }, fake.io),
    /loopback/,
  );
  assert.equal(called, false);
});

test('loadtest: CLI defaults to loopback protocol, validates counts and rejects engines for PvP benchmarks', () => {
  const args = parseArgs(['--benchmark']);
  assert.equal(args.options.serverUrl, 'ws://127.0.0.1:3001');
  assert.deepEqual(args.options.concurrencies, [1, 50]);
  assert.equal(args.options.seed, 42);
  assert.equal(args.options.repetitions, 3);
  assert.equal(args.options.thinkMs, 0);
  assert.equal(parseArgs(['--benchmark', '--think', '750ms']).options.thinkMs, 750);
  assert.equal(parseArgs(['--benchmark', '--think', '1s']).options.thinkMs, 1000);
  for (const args of [
    ['--benchmark', '--concurrency', '-1'],
    ['--benchmark', '--concurrency', '1.5'],
    ['--benchmark', '--duration', '0s'],
    ['--benchmark', '--think', '-1s'],
    ['--benchmark', '--think', 'fast'],
    ['--benchmark', '--seed', 'NaN'],
    ['--benchmark', '--repetitions', '0'],
    ['--benchmark', '--mode', 'pve-blitz'],
    ['--benchmark', '--engine', 'builtin'],
    ['--benchmark', '--server', 'wss://mistboard.com'],
  ]) {
    assert.throws(() => parseArgs(args));
  }
});

test('loadtest: CLI failure exit and JSON preserve failed games', async () => {
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stdout.write;
  let output = '';
  globalThis.fetch = async () => new Response('', { status: 503 });
  process.stdout.write = ((chunk: string) => {
    output += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(['--mode', 'pvp-blitz', '--concurrency', '1', '--json']);
    assert.equal(code, 1);
    const record = JSON.parse(output);
    assert.equal(record.failed, true);
    assert.equal(record.games[0].error, 'room-create-503');
  } finally {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  }
});

test('loadtest: stored records retain every repetition and reconstruct every reported percentile', () => {
  const directory = new URL('../../../docs/perf/move-latency/', import.meta.url);
  const records = readdirSync(directory).filter((name) =>
    /^\d{4}-\d\d-\d\d-local-pvp\.json$/.test(name),
  );
  assert.ok(records.length > 0);
  for (const name of records) {
    const record = JSON.parse(readFileSync(new URL(name, directory), 'utf8')) as Awaited<
      ReturnType<typeof runBenchmark>
    >;
    assert.equal(
      record.runs.length,
      record.protocol.concurrencies.length * record.protocol.repetitions,
    );
    for (const concurrency of record.protocol.concurrencies) {
      assert.deepEqual(
        record.runs.filter((run) => run.concurrency === concurrency).map((run) => run.repetition),
        Array.from({ length: record.protocol.repetitions }, (_, i) => i + 1),
      );
    }
    for (const run of record.runs) {
      const sorted = run.games
        .flatMap((game) => game.moveAttempts)
        .filter(
          (a) =>
            a.phase === 'measurement' &&
            a.outcome === 'acknowledged' &&
            a.receivedMs! <= record.protocol.warmupMs + record.protocol.measurementMs,
        )
        .map((a) => a.latencyMs!)
        .sort((a, b) => a - b);
      assert.equal(run.summary.sampleCount, sorted.length);
      if (!record.eligible) assert.equal(run.summary.acknowledgmentMs, null);
      if (run.summary.acknowledgmentMs) {
        assert.ok(sorted.length >= record.protocol.minimumSamplesPerRepetition);
        assert.deepEqual(run.summary.failures, []);
        for (const [key, p] of [
          ['p50', 0.5],
          ['p95', 0.95],
          ['p99', 0.99],
        ] as const) {
          assert.equal(run.summary.acknowledgmentMs[key], sorted[Math.ceil(p * sorted.length) - 1]);
        }
      }
    }
  }
});
