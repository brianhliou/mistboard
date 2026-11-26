/**
 * The shared KataGo jungle process (jungle-katago-session.ts), against a fake
 * engine that speaks the same GTP: one reply block ("= ...\n\n") per command,
 * two genmoves to a move. The fake logs every spawn and every line it reads, so
 * the tests can see how many processes ran and what each search was sent.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createInitialJungleState, getJungleLegalMoves } from '@mistboard/game';
import { jungleMoveToEngineUci, jungleStateToEngineFen } from './jungle-fen.js';
import {
  KATAGO_JUNGLE_ENGINE_ID,
  katagoJungleLiveEngineMove,
  katagoJungleMove,
  prewarmKatagoJungle,
} from './jungle-katago-engine.js';
import {
  gtpProcessSpawner,
  KATAGO_SESSION_IDLE_MS,
  KatagoJungleSession,
  type KatagoSessionTimers,
} from './jungle-katago-session.js';
import {
  type JungleEngineMoveProvider,
  playJungleEngineMoveIfReady,
} from './server-jungle-engine.js';
import { createJungleLiveRoom } from './server-jungle-room-factory.js';

const dir = mkdtempSync(join(tmpdir(), 'katago-jungle-session-'));
const script = join(dir, 'fake-gtp.mjs');
writeFileSync(
  script,
  `import { appendFileSync } from 'node:fs';
const log = (line) => appendFileSync(process.env.FAKE_GTP_LOG, line + '\\n');
const delay = Number(process.env.FAKE_GTP_GENMOVE_MS ?? 0);
log('spawn ' + process.pid);
let buffer = '';
let pending = Promise.resolve();
const reply = (text) => process.stdout.write(text + '\\n\\n');
let stage = 0;
function answer(line) {
  log(line);
  if (line === 'hang') return null;
  if (line === 'die') process.exit(3);
  if (line === 'name') return '= fake';
  if (line.startsWith('echo ')) return '= ' + line.slice(5);
  if (line.startsWith('setfen')) stage = 0;
  if (line.startsWith('genmove')) {
    stage += 1;
    return new Promise((done) =>
      setTimeout(() => done(stage === 1 ? '= G1' : '= G2'), delay),
    );
  }
  return '= ';
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    pending = pending.then(async () => {
      const text = await answer(line);
      if (text !== null) reply(text);
      else await new Promise(() => {});
    });
  }
});
`,
);

let logCount = 0;
function fakeEngine(env: Record<string, string> = {}) {
  logCount += 1;
  const log = join(dir, `log-${logCount}`);
  writeFileSync(log, '');
  const spawner = gtpProcessSpawner(() => ({
    bin: process.execPath,
    args: [script],
    env: { ...process.env, FAKE_GTP_LOG: log, ...env },
  }));
  const lines = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return {
    spawner,
    lines,
    spawns: () => lines().filter((line) => line.startsWith('spawn ')).length,
    /** The lines each search was sent, one array per move, in arrival order. */
    moves: () => {
      const out: string[][] = [];
      for (const line of lines()) {
        if (line === 'clear_board') out.push([]);
        if (out.length > 0 && !line.startsWith('spawn ')) out.at(-1)!.push(line);
      }
      return out;
    },
  };
}

function session(t: TestContext, options: ConstructorParameters<typeof KatagoJungleSession>[0]) {
  const s = new KatagoJungleSession(options);
  t.after(() => s.close('test over'));
  return s;
}

/** Let the queue's bookkeeping after a resolved request run. */
const settle = () => new Promise<void>((done) => setImmediate(done));

/** Timers the test fires by hand; nothing runs on its own. */
function manualTimers() {
  let now = 0;
  const pending = new Set<{ fn: () => void; ms: number }>();
  const timers: KatagoSessionTimers = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms };
      pending.add(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as { fn: () => void; ms: number });
    },
  };
  return {
    timers,
    advance: (ms: number) => {
      now += ms;
    },
    /** Fire every pending timer set for exactly `ms`. */
    fire: (ms: number) => {
      const due = [...pending].filter((timer) => timer.ms === ms);
      for (const timer of due) {
        pending.delete(timer);
        timer.fn();
      }
      return due.length;
    },
    count: (ms: number) => [...pending].filter((timer) => timer.ms === ms).length,
  };
}

/** Real timers, every delay divided by `factor`: a 3.6 s deadline in 72 ms. */
function fastTimers(factor: number): KatagoSessionTimers {
  return {
    now: () => Date.now() * factor,
    setTimeout: (fn, ms) => {
      const timer = setTimeout(fn, ms / factor);
      timer.unref();
      return timer;
    },
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  };
}

const START = jungleStateToEngineFen(createInitialJungleState('jgl_session_a'));
const OTHER = (() => {
  const state = createInitialJungleState('jgl_session_b');
  const move = getJungleLegalMoves(state)[0]!;
  return { fen: START.replace(' r ', ' b '), uci: jungleMoveToEngineUci(move) };
})();

test('two moves reuse one process: the first starts it, the second finds it loaded', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const first = await katagoJungleMove(START, 'red', { session: s });
  const second = await katagoJungleMove(START, 'red', { session: s });
  assert.equal(first.best, 'a1a2');
  assert.equal(second.best, 'a1a2');
  assert.equal(first.process, 'cold');
  assert.equal(second.process, 'warm');
  assert.equal(engine.spawns(), 1);
  assert.equal(s.stats().spawns, 1);
  assert.equal(s.stats().requests, 2);
});

test('requests are served one at a time, in the order they came', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const settled: string[] = [];
  const all = ['1', '2', '3', '4'].map((id) =>
    s
      .request(() => ({ commands: [`echo ${id}`], deadlineMs: 5_000 }))
      .then((result) => {
        settled.push(result.replies[0]!);
        // One search at a time: nothing else is in flight while this one finishes.
        assert.ok(s.stats().queued <= 3);
      }),
  );
  assert.equal(s.stats().queued, 3, 'one running, three waiting');
  await Promise.all(all);
  assert.deepEqual(settled, ['= 1', '= 2', '= 3', '= 4']);
  assert.deepEqual(
    engine.lines().filter((line) => line.startsWith('echo ')),
    ['echo 1', 'echo 2', 'echo 3', 'echo 4'],
  );
  assert.equal(engine.spawns(), 1);
});

test('a request past its deadline kills the process; the next queued one gets a fresh one', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const stuck = s.request(() => ({ commands: ['hang'], deadlineMs: 150 }));
  const next = s.request(() => ({ commands: ['echo after'], deadlineMs: 5_000 }));
  await assert.rejects(stuck, /timed out after 150 ms/);
  const served = await next;
  assert.deepEqual(served.replies, ['= after']);
  assert.equal(served.warm, false, 'it paid a fresh start');
  assert.equal(engine.spawns(), 2);
  assert.equal(s.stats().kills, 1);
});

test('each request says where its wait went: behind another move, or starting the process', async (t) => {
  const engine = fakeEngine({ FAKE_GTP_GENMOVE_MS: '150' });
  const s = session(t, { spawner: engine.spawner });
  const first = s.request(() => ({ commands: ['genmove b'], deadlineMs: 5_000 }));
  const second = s.request(() => ({ commands: ['echo 2'], deadlineMs: 5_000 }));
  const [a, b] = await Promise.all([first, second]);
  // The first paid the start and queued behind nothing.
  assert.ok(a.queuedMs < 50, `first queued ${a.queuedMs} ms`);
  assert.ok(a.startMs > 0);
  assert.equal(a.startMs + a.queuedMs, a.waitedMs);
  assert.equal(a.restart, false, 'a first start is not a restart');
  // The second waited out the first's 150 ms search, on the loaded process.
  assert.ok(b.queuedMs >= 120, `second queued ${b.queuedMs} ms`);
  assert.equal(b.startMs, 0);
  assert.equal(b.warm, true);
});

test('a start that replaces a killed process is a restart; the one after is not', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  await assert.rejects(s.request(() => ({ commands: ['hang'], deadlineMs: 150 })));
  const after = await s.request(() => ({ commands: ['echo after'], deadlineMs: 5_000 }));
  assert.equal(after.warm, false);
  assert.equal(after.restart, true);
  const next = await s.request(() => ({ commands: ['echo next'], deadlineMs: 5_000 }));
  assert.equal(next.restart, false);
});

test('a process that dies mid-request is replaced for the request behind it', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const dying = s.request(() => ({ commands: ['die'], deadlineMs: 5_000 }));
  const next = s.request(() => ({ commands: ['echo alive'], deadlineMs: 5_000 }));
  await assert.rejects(dying, /exited/);
  assert.deepEqual((await next).replies, ['= alive']);
  assert.equal(engine.spawns(), 2);
});

test('the process closes after ten idle minutes and comes back on demand', async (t) => {
  const engine = fakeEngine();
  const clock = manualTimers();
  const s = session(t, { spawner: engine.spawner, timers: clock.timers });
  await s.request(() => ({ commands: ['echo one'], deadlineMs: 5_000 }));
  await settle();
  assert.equal(KATAGO_SESSION_IDLE_MS, 600_000);
  assert.equal(clock.count(KATAGO_SESSION_IDLE_MS), 1, 'the idle close is armed');
  assert.equal(s.warm, true);
  clock.advance(KATAGO_SESSION_IDLE_MS);
  assert.equal(clock.fire(KATAGO_SESSION_IDLE_MS), 1);
  assert.equal(s.warm, false);
  assert.equal(s.stats().running, false);
  const again = await s.request(() => ({ commands: ['echo two'], deadlineMs: 5_000 }));
  assert.equal(again.warm, false);
  assert.deepEqual(again.replies, ['= two']);
  assert.equal(engine.spawns(), 2);
  // A request that lands before the ten minutes are up cancels the close.
  clock.advance(KATAGO_SESSION_IDLE_MS - 1);
  await s.request(() => ({ commands: ['echo three'], deadlineMs: 5_000 }));
  await settle();
  assert.equal(clock.count(KATAGO_SESSION_IDLE_MS), 1, 'one close armed, from the last request');
  assert.equal(s.warm, true);
  assert.equal(engine.spawns(), 2);
});

test('a prewarm loads the process so the first move is warm', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  await s.prewarm();
  assert.equal(engine.spawns(), 1);
  // A second prewarm with the process up does nothing.
  await s.prewarm();
  assert.equal(engine.spawns(), 1);
  const move = await katagoJungleMove(START, 'red', { session: s });
  assert.equal(move.process, 'warm');
  assert.equal(engine.spawns(), 1);
});

test('creating a room against the KataGo seat prewarms it; a Misty room does not', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const saved = process.env.MISTBOARD_JUNGLE_ENABLED;
  process.env.MISTBOARD_JUNGLE_ENABLED = 'true';
  t.after(() => {
    if (saved === undefined) delete process.env.MISTBOARD_JUNGLE_ENABLED;
    else process.env.MISTBOARD_JUNGLE_ENABLED = saved;
  });
  let prewarms = 0;
  let warming: Promise<void> = Promise.resolve();
  let id = 0;
  const ctx = {
    jungleRooms: new Map(),
    isRoomIdTaken: () => false,
    appendRoomEvent: async () => {},
    createRoomId: () => {
      id += 1;
      return `jgl_prewarm_${id}`;
    },
    isPersistenceEnabled: () => false,
    recordPersistenceError: () => {},
    prewarmKatago: () => {
      prewarms += 1;
      warming = s.prewarm();
    },
  };
  const katago = await createJungleLiveRoom(ctx, undefined, undefined, {
    engineId: KATAGO_JUNGLE_ENGINE_ID,
    seat: 'red',
  });
  assert.equal(katago.ok, true);
  assert.equal(prewarms, 1);
  const misty = await createJungleLiveRoom(ctx, undefined, undefined, {
    engineId: 'misty-jungle-level-2',
    seat: 'red',
  });
  assert.equal(misty.ok, true);
  const pvp = await createJungleLiveRoom(ctx);
  assert.equal(pvp.ok, true);
  assert.equal(prewarms, 1, 'only the KataGo room loads the process');
  // The prewarm reached the shared process and left it loaded.
  await warming;
  assert.equal(engine.spawns(), 1);
  assert.equal(s.warm, true);
});

test('prewarm is a no-op where the KataGo assets do not resolve', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  const saved = process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH;
  process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH = join(dir, 'missing-katago');
  t.after(() => {
    if (saved === undefined) delete process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH;
    else process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH = saved;
  });
  prewarmKatagoJungle(s);
  assert.equal(s.stats().queued + (s.stats().busy ? 1 : 0), 0);
  assert.equal(engine.spawns(), 0);
});

test('two interleaved games share the process and never see each other', async (t) => {
  const engine = fakeEngine();
  const s = session(t, { spawner: engine.spawner });
  // Game A, game B, game A again, all queued at once.
  const results = await Promise.all([
    katagoJungleMove(START, 'red', { session: s }),
    katagoJungleMove(OTHER.fen, 'black', { session: s }),
    katagoJungleMove(START, 'red', { session: s }),
  ]);
  assert.equal(engine.spawns(), 1);
  const sent = engine.moves();
  assert.equal(sent.length, 3);
  const setfen = (fen: string) =>
    engine
      .lines()
      .find(
        (line) => line.startsWith('setfen') && line.endsWith(fen.includes(' r ') ? ' w' : ' b'),
      );
  for (const [index, mover] of (['red', 'black', 'red'] as const).entries()) {
    const lines = sent[index]!;
    // Every search starts from nothing: board, history and tree cleared, then
    // the whole position of its own game, then its own side's two stages.
    assert.deepEqual(lines.slice(0, 2), ['clear_board', 'clear_cache']);
    assert.equal(lines.filter((line) => line.startsWith('setfen')).length, 1);
    assert.equal(lines.filter((line) => line.startsWith('play')).length, 0, 'no move history');
    const colour = mover === 'red' ? 'b' : 'w';
    assert.deepEqual(lines.slice(-2), [`genmove ${colour}`, `genmove ${colour}`]);
  }
  assert.equal(
    sent[0]!.find((line) => line.startsWith('setfen')),
    setfen(START),
  );
  assert.equal(
    sent[1]!.find((line) => line.startsWith('setfen')),
    setfen(OTHER.fen),
  );
  assert.notEqual(sent[0]![4], sent[1]![4]);
  assert.deepEqual(sent[0], sent[2], 'game A asked the same thing both times');
  assert.deepEqual(
    results.map((result) => result.process),
    ['cold', 'warm', 'warm'],
  );
});

test('a planted slow engine resigns the seat: no MistyJungle move, no hang', async (t) => {
  // Genmove answers after 20 s; scaled timers make the 3.6 s deadline 72 ms.
  const engine = fakeEngine({ FAKE_GTP_GENMOVE_MS: '20000' });
  const s = session(t, {
    spawner: engine.spawner,
    timers: fastTimers(50),
    startTimeoutMs: 500_000,
  });
  const state = createInitialJungleState('jgl_session_slow');
  const room = {
    id: 'jgl_session_slow',
    events: [],
    projection: {
      state,
      seats: { red: KATAGO_JUNGLE_ENGINE_ID, black: 'human-client' },
      clock: {
        activeColor: 'red',
        incrementMs: 1_000,
        initialMs: 60_000,
        remainingMs: { red: 20_000, black: 60_000 },
        runningSince: 1_000_000,
      },
    },
  };
  const appended: Array<{ type: string }> = [];
  const ctx = {
    now: () => 1_000_000,
    appendEvent: async (_room: unknown, event: { type: string }) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  };
  let mistyCalls = 0;
  const misty: JungleEngineMoveProvider = async () => {
    mistyCalls += 1;
    throw new Error('MistyJungle asked to move for the KataGo seat');
  };
  const assets = mkdtempSync(join(tmpdir(), 'katago-jungle-assets-'));
  for (const file of ['katago-jungle', 'katago-jungle-net.bin.gz']) {
    writeFileSync(join(assets, file), '');
  }
  const saved = {
    engine: process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH,
    net: process.env.MISTBOARD_KATAGO_JUNGLE_NET_PATH,
  };
  process.env.MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH = join(assets, 'katago-jungle');
  process.env.MISTBOARD_KATAGO_JUNGLE_NET_PATH = join(assets, 'katago-jungle-net.bin.gz');
  t.after(() => {
    for (const [key, value] of [
      ['MISTBOARD_KATAGO_JUNGLE_ENGINE_PATH', saved.engine],
      ['MISTBOARD_KATAGO_JUNGLE_NET_PATH', saved.net],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  await playJungleEngineMoveIfReady(ctx as never, room as never, misty, (fen, mover, opts) =>
    katagoJungleLiveEngineMove(fen, mover, { ...opts, session: s }),
  );
  assert.equal(mistyCalls, 0);
  assert.deepEqual(
    appended.map((event) => event.type),
    ['seat-resigned'],
  );
  // Each attempt was killed at its deadline and the retry got a fresh process.
  assert.equal(s.stats().kills, 2);
  assert.equal(engine.spawns(), 2);
});
