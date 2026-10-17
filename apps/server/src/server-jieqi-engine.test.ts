import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiHomeSquares,
  jieqiMoveToPikafishUci,
} from '@mistboard/game';
import {
  ABJCHESS_LIVE_QUEUE_TIMEOUT_MS,
  JIEQI_ABJCHESS_ENGINE_ID,
  JIEQI_JQE_ENGINE_ID,
  type JieqiEngineTier,
  JQE_LIVE_QUEUE_TIMEOUT_MS,
  jieqiEngineTierFor,
  jieqiLiveEngineMove,
  jieqiLivePool,
} from './jieqi-engine.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jieqiLiveMoveBudgetMs, playJieqiEngineMoveIfReady } from './server-jieqi-engine.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

const FEN =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';

const ab = jieqiEngineTierFor(JIEQI_ABJCHESS_ENGINE_ID) as JieqiEngineTier;

// The ceiling stays the tier's 4 s at every time control (an 8 s timed ceiling was
// measured on 2026-10-06 and parked: no measurable strength gain, longer waits).
test('AB-JChess keeps its 4 s ceiling at every time control', () => {
  const firstMove = (minutes: number, incrementSeconds: number) =>
    jieqiLiveMoveBudgetMs({
      ceilingMs: ab.movetimeMs,
      remainingMs: minutes * 60_000,
      incrementMs: incrementSeconds * 1_000,
    });
  assert.equal(firstMove(1, 1), 2_767, '1+1: the clock binds');
  assert.equal(firstMove(3, 2), 4_000);
  assert.equal(firstMove(5, 5), 4_000);
  assert.equal(firstMove(10, 5), 4_000);
  assert.equal(
    jieqiLiveMoveBudgetMs({ ceilingMs: ab.movetimeMs, remainingMs: null, incrementMs: 0 }),
    4_000,
    'untimed',
  );
});

test('a move that waited for a slot pays the wait out of its own budget', () => {
  const at = (remainingMs: number, waitedMs: number) =>
    jieqiLiveMoveBudgetMs({ ceilingMs: 4_000, remainingMs, incrementMs: 5_000, waitedMs });
  assert.equal(at(300_000, 0), 4_000, 'a healthy clock still gets the ceiling');
  assert.equal(at(31_000, 0), 4_000);
  assert.equal(at(6_000, 0), 4_000, 'unqueued: 5 s usable pays the full 4 s');
  assert.equal(at(6_000, 4_000), 1_000, 'queued 4 s: only the 1 s still usable');
  assert.equal(at(5_000, 5_000), 50, 'the wait ate the clock: think the floor');
});

// The live pool was shared by every jieqi bot: two processes and a 5 s queue timeout,
// so two AB searches could hold every slot a ladder move needs.
test('AB-JChess live moves run in their own pool, so its searches never queue the ladder', async () => {
  const abPool = jieqiLivePool('ab-jchess');
  const ladderPool = jieqiLivePool();
  assert.notEqual(abPool, ladderPool);
  const held: Array<() => void> = [];
  try {
    const slots = abPool.stats().maxProcesses;
    assert.equal(slots, 2, 'two AB processes at most, as the shared pool allowed');
    for (let i = 0; i < slots; i += 1) held.push(await abPool.acquire());
    assert.equal(abPool.stats().active, slots, 'every AB slot is busy');
    const before = ladderPool.stats().waited;
    const release = await ladderPool.acquire();
    release();
    assert.equal(ladderPool.stats().waited, before, 'a ladder move took a slot without waiting');
  } finally {
    for (const release of held) release();
  }
});

test('an AB move queued behind another waits it out instead of being shed', () => {
  // The longest a slot can be held: the tier movetime plus the move's process deadline
  // over it (jieqiEngineSearch: movetime + 4 s).
  assert.ok(ABJCHESS_LIVE_QUEUE_TIMEOUT_MS > ab.movetimeMs + 4_000);
  assert.equal(jieqiLivePool('ab-jchess').stats().name, 'abjchess-live');
});

test('a move that queued for an AB slot re-derives its budget from the wait', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'abjchess-live-'));
  const goLog = join(dir, 'go.log');
  const bin = join(dir, 'ab-jchess.mjs');
  // Answers the handshake and every `go` with a fixed move, logging each go line.
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line === 'uci') {
      process.stdout.write('option name EvalFile type string default\\n');
      process.stdout.write('option name Hash type spin default 16 min 1 max 4096\\n');
      process.stdout.write('option name Threads type spin default 1 min 1 max 16\\n');
      process.stdout.write('uciok\\n');
    }
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) {
      appendFileSync(${JSON.stringify(goLog)}, line + '\\n');
      process.stdout.write('info depth 3 score cp 12 nodes 30 time 2 pv b2e2\\nbestmove b2e2\\n');
    }
  }
});
`,
  );
  chmodSync(bin, 0o755);
  const prior = {
    path: process.env.MISTBOARD_ABJCHESS_PATH,
    net: process.env.MISTBOARD_ABJCHESS_NET,
  };
  process.env.MISTBOARD_ABJCHESS_PATH = bin;
  process.env.MISTBOARD_ABJCHESS_NET = process.execPath; // any file that exists
  const pool = jieqiLivePool('ab-jchess');
  const held: Array<() => void> = [];
  try {
    for (let i = 0; i < pool.stats().maxProcesses; i += 1) held.push(await pool.acquire());
    let waited = -1;
    const move = jieqiLiveEngineMove(JIEQI_ABJCHESS_ENGINE_ID, FEN, {
      movetimeMs: 4_000,
      budgetAfterWait: (waitedMs) => {
        waited = waitedMs;
        return 1_234;
      },
      newGame: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    held.pop()?.();
    const result = await move;
    assert.equal(result.best, 'b2e2');
    assert.ok(waited >= 30, `the wait was measured (${waited} ms)`);
    assert.deepEqual(readFileSync(goLog, 'utf8').trim().split('\n'), ['go movetime 1234']);
  } finally {
    for (const release of held) release();
    if (prior.path === undefined) delete process.env.MISTBOARD_ABJCHESS_PATH;
    else process.env.MISTBOARD_ABJCHESS_PATH = prior.path;
    if (prior.net === undefined) delete process.env.MISTBOARD_ABJCHESS_NET;
    else process.env.MISTBOARD_ABJCHESS_NET = prior.net;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── jqe (held behind MISTBOARD_JQE_ENABLED) ─────────────────────────────────────

/** A fake UCI engine that answers the handshake and every `go` with `best`, and logs
 *  EVERY line it is sent: the whole request, handshake included. */
function writeLoggingEngine(path: string, log: string, best: string): void {
  writeFileSync(
    path,
    `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) appendFileSync(${JSON.stringify(log)}, line + '\\n');
    if (line === 'uci') {
      process.stdout.write('option name EvalFile type string default\\n');
      process.stdout.write('option name Hash type spin default 16 min 1 max 4096\\n');
      process.stdout.write('option name Threads type spin default 1 min 1 max 16\\n');
      process.stdout.write('option name MultiPV type spin default 1 min 1 max 128\\n');
      process.stdout.write('uciok\\n');
    }
    if (line === 'isready') process.stdout.write('readyok\\n');
    if (line.startsWith('go')) {
      process.stdout.write('info depth 3 multipv 1 score cp 12 nodes 30 time 2 pv ${best}\\nbestmove ${best}\\n');
    }
  }
});
`,
  );
  chmodSync(path, 0o755);
}

test('jqe live moves run in their own pool, which waits out a queued move', () => {
  const jqe = jieqiEngineTierFor(JIEQI_JQE_ENGINE_ID) as JieqiEngineTier;
  const pool = jieqiLivePool('jqe');
  assert.notEqual(pool, jieqiLivePool());
  assert.notEqual(pool, jieqiLivePool('ab-jchess'));
  assert.equal(pool.stats().name, 'jqe-live');
  assert.equal(pool.stats().maxProcesses, 2);
  assert.ok(JQE_LIVE_QUEUE_TIMEOUT_MS > jqe.movetimeMs + 4_000);
});

type JieqiRoomEvent = TenantRoomEvent<'red' | 'black', JieqiMove, typeof JIEQI_SPEC_ID>;

const roles = (line: string) => line.split(' ') as JieqiPieceRole[];
const BASE_DEAL: JieqiDeal = {
  red: roles(
    'soldier elephant chariot soldier horse soldier cannon soldier soldier chariot horse cannon advisor elephant advisor',
  ),
  black: roles(
    'horse soldier soldier soldier chariot advisor soldier cannon cannon elephant chariot soldier advisor horse elephant',
  ),
};
// Red's dark cannons take two of black's dark horses (h10, b10) and black reveals its
// a7 piece: black, the engine's seat, is to move with two of its pieces captured face
// down. Red knows what they were; black was never told.
const LINE: JieqiMove[] = [
  { from: 'h3', to: 'h10' },
  { from: 'a7', to: 'a6' },
  { from: 'b3', to: 'b10' },
] as JieqiMove[];
const MOVED_OR_CAPTURED = new Set(['h3', 'h10', 'a7', 'b3', 'b10']);

/** The deal with the roles on `squares` of `color` rotated by one. */
function rotateRoles(deal: JieqiDeal, color: JieqiColor, squares: JieqiSquare[]): JieqiDeal {
  const home = jieqiHomeSquares(color);
  const next = [...deal[color]];
  const idx = squares.map((sq) => home.indexOf(sq));
  idx.forEach((i, k) => {
    next[i] = deal[color][idx[(k + 1) % idx.length]!]!;
  });
  return { ...deal, [color]: next };
}

/** Everything black may not know: red's pieces still dark, black's own pieces still
 *  dark, and black's two pieces red captured face down. */
function reshuffleWhatBlackCannotSee(deal: JieqiDeal): JieqiDeal {
  const redDark = jieqiHomeSquares('red').filter((sq) => !MOVED_OR_CAPTURED.has(sq));
  const blackUnseen = jieqiHomeSquares('black').filter((sq) => sq !== 'a7');
  // Black's captured h10/b10 trade identities with dark ones still on the board.
  return rotateRoles(rotateRoles(deal, 'red', redDark), 'black', blackUnseen);
}

/** Seat jqe as black on a room dealt `deal`, play LINE, let the server serve black's
 *  move through the real jqe request path, and return every line jqe was sent. */
async function jqeRequestFor(deal: JieqiDeal, dir: string, tag: string): Promise<string[]> {
  const roomId = `jq_jqe_hidden_${tag}`;
  const events: JieqiRoomEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId,
      gameSpecId: JIEQI_SPEC_ID,
      setup: { ...deal, repetition: true },
    },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'human', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: JIEQI_JQE_ENGINE_ID, seat: 'black' },
    ...LINE.map(
      (move, i): JieqiRoomEvent => ({
        type: 'move-played',
        at: 4 + i,
        roomId,
        color: i % 2 === 0 ? 'red' : 'black',
        move,
      }),
    ),
  ];
  const hydrated = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  if (!hydrated.ok) throw new Error(hydrated.error);
  const room = hydrated.room as unknown as Parameters<typeof playJieqiEngineMoveIfReady>[1];
  const state = room.projection.state;
  assert.deepEqual(state.status, { type: 'playing', turn: 'black' });
  const best = jieqiMoveToPikafishUci(getJieqiLegalMoves(state)[0]!);
  // One binary per room: warm sessions key on the binary, so each room's request is
  // logged from a fresh handshake.
  const bin = join(dir, `jqe-${tag}.mjs`);
  const log = join(dir, `jqe-${tag}.log`);
  writeLoggingEngine(bin, log, best);
  const appended: JieqiRoomEvent[] = [];
  const ctx = {
    appendEvent: async (_room: unknown, event: JieqiRoomEvent) => {
      appended.push(event);
      return appended.length;
    },
    broadcastEventAppended: () => {},
  } as unknown as Parameters<typeof playJieqiEngineMoveIfReady>[0];
  const prior = process.env.MISTBOARD_JQE_PATH;
  process.env.MISTBOARD_JQE_PATH = bin;
  try {
    await playJieqiEngineMoveIfReady(ctx, room);
  } finally {
    if (prior === undefined) delete process.env.MISTBOARD_JQE_PATH;
    else process.env.MISTBOARD_JQE_PATH = prior;
  }
  assert.ok(
    appended.some((event) => event.type === 'move-played'),
    'the served jqe move was played',
  );
  return readFileSync(log, 'utf8').trim().split('\n');
}

// Hidden information is enforced in the data: jqe gets only the redacted FEN its seat
// may know. Serialize the WHOLE request (handshake, position, go) and require it to be
// byte-identical under any reshuffle of what black cannot see; a control reshuffle of
// a piece black did see must change it, so the comparison is not vacuous.
test('hidden info: the whole jqe request is the same under any reshuffle of what its seat cannot see', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jqe-hidden-'));
  const prior = { net: process.env.MISTBOARD_JQE_NET, enabled: process.env.MISTBOARD_JQE_ENABLED };
  process.env.MISTBOARD_JQE_NET = process.execPath; // any file that exists
  process.env.MISTBOARD_JQE_ENABLED = '1';
  try {
    const reshuffled = reshuffleWhatBlackCannotSee(BASE_DEAL);
    assert.notDeepEqual(reshuffled, BASE_DEAL, 'the reshuffle moved hidden identities');
    // h3 (revealed when it moved, so black saw it) trades with a dark red square of
    // another role.
    const redHome = jieqiHomeSquares('red');
    const h3Role = BASE_DEAL.red[redHome.indexOf('h3' as JieqiSquare)];
    const other = redHome.find(
      (sq) => !MOVED_OR_CAPTURED.has(sq) && BASE_DEAL.red[redHome.indexOf(sq)] !== h3Role,
    )!;
    const control = rotateRoles(BASE_DEAL, 'red', ['h3' as JieqiSquare, other]);

    const base = await jqeRequestFor(BASE_DEAL, dir, 'base');
    const hidden = await jqeRequestFor(reshuffled, dir, 'reshuffled');
    const seen = await jqeRequestFor(control, dir, 'control');

    assert.ok(
      base.includes(`setoption name EvalFile value ${process.execPath}`),
      'jqe loaded its net',
    );
    assert.ok(base.some((line) => line.startsWith('position fen ')));
    assert.ok(base.some((line) => line.startsWith('go ')));
    assert.deepEqual(hidden, base, 'nothing black cannot see reaches jqe');
    assert.notDeepEqual(seen, base, 'a piece black did see does change the request');
  } finally {
    if (prior.net === undefined) delete process.env.MISTBOARD_JQE_NET;
    else process.env.MISTBOARD_JQE_NET = prior.net;
    if (prior.enabled === undefined) delete process.env.MISTBOARD_JQE_ENABLED;
    else process.env.MISTBOARD_JQE_ENABLED = prior.enabled;
    rmSync(dir, { recursive: true, force: true });
  }
});
