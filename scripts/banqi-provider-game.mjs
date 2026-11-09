// Local operator rehearsal: opaque worker process + real HTTP/WS + isolated Postgres.
// Credentials are ephemeral and remain in process memory, never printed or written.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { WebSocket } from 'ws';
import { ensureTestDatabase } from './ensure-test-database.mjs';

const option = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const bin = option('--bin');
const version = option('--version');
const uciName = option('--uci-name');
const evalFile = option('--eval-file');
assert.ok(
  bin && version && uciName,
  'Required: --bin PATH --version TAG --uci-name NAME [--eval-file PATH] [--keep]',
);
const token = randomUUID();
const databaseUrl = 'postgres://mistboard:mistboard@localhost:5435/mistboard_provider_1025';
await ensureTestDatabase({ databaseUrl });
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  MISTBOARD_BANQI_ENABLED: 'true',
  MISTBOARD_BANQI_TEST_PROVIDER_ENABLED: 'true',
  MISTBOARD_BANQI_TEST_ALLOW_LOOPBACK: 'true',
  MISTBOARD_BANQI_PROVIDER_TOKEN: token,
  MISTBOARD_BANQI_TEST_PROVIDER_VERSION: version,
  MISTBOARD_BANQI_TEST_PROVIDER_NAME: 'Private Banqi worker',
  MISTBOARD_BANQI_TEST_PROVIDER_NODES: option('--nodes') ?? '2048',
  MISTBOARD_BANQI_TEST_PROVIDER_BUDGET_MS: '3000',
  MISTBOARD_WS_MESSAGE_LIMIT: '1000',
});
// The rehearsal never invokes email delivery, background content or public jobs.
for (const name of [
  'RESEND_API_KEY',
  'MISTBOARD_AUTH_EMAIL_FROM',
  'MISTBOARD_BOT_VS_BOT_ENABLED',
  'MISTBOARD_STUDY_CURATOR_ENABLED',
  'MISTBOARD_XIANGQI_BROADCAST_POLL_ENABLED',
])
  delete process.env[name];
const args = [
  '--import',
  'tsx',
  'scripts/banqi-provider.mjs',
  'bridge',
  '--bin',
  resolve(bin),
  '--port',
  '0',
  '--version',
  version,
  '--uci-name',
  uciName,
];
if (evalFile) args.push('--eval-file', resolve(evalFile));
const worker = spawn(process.execPath, args, {
  cwd: resolve(import.meta.dirname, '..'),
  env: { PATH: '/usr/bin:/bin', NODE_ENV: 'development', MISTBOARD_BANQI_PROVIDER_TOKEN: token },
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
let server;
let socket;
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  socket?.terminate();
  await server?.close();
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM');
    const deadline = setTimeout(() => worker.kill('SIGKILL'), 10000);
    deadline.unref();
    try {
      await once(worker, 'exit');
    } finally {
      clearTimeout(deadline);
    }
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop().then(() => process.exit(130));
  });
try {
  const ready = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup failed or timed out')), 10000);
    worker.once('message', (data) => {
      clearTimeout(timer);
      done(data);
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Worker refused startup'));
    });
    worker.once('error', () => {
      clearTimeout(timer);
      reject(new Error('Worker spawn failed'));
    });
  });
  process.env.MISTBOARD_BANQI_TEST_PROVIDER_URL = `http://127.0.0.1:${ready.port}/turn`;
  const { startServer } = await import('../apps/server/src/index.ts');
  const persistence = await import('../apps/server/src/persistence.ts');
  const { getPool } = await import('../apps/server/src/persistence-db.ts');
  const { banqiRooms, getOrLoadBanqiRoom } = await import(
    '../apps/server/src/banqi-registration.ts'
  );
  const { clearBanqiRuntimeTimers } = await import('../apps/server/src/server-ws-banqi.ts');
  const { banqiTenant } = await import('../apps/server/src/banqi-tenant.ts');
  const { replayTenantEvents } = await import('../apps/server/src/variant-tenant/runtime.ts');
  const { countedHumanGame, internalHumanGame, shortHumanGame, preLaunchHumanGame } = await import(
    '../apps/server/src/persistence-counted-games.ts'
  );
  server = await startServer({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${server.port}`;
  const now = new Date();
  const email = 'provider-rehearsal@example.test';
  const user =
    (await persistence.findUserByEmail(email)) ??
    (await persistence.createUser({
      id: `user_${randomUUID()}`,
      email,
      emailVerifiedAt: now,
      handle: 'provider-rehearsal',
      displayName: 'provider-rehearsal',
      accountRole: 'admin',
      now,
    }));
  const session = randomUUID(),
    sessionToken = randomUUID();
  await persistence.createAccountSession({
    id: session,
    userId: user.id,
    tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600000),
  });
  const cookie = `mistboard_session=${encodeURIComponent(`${session}.${sessionToken}`)}`;
  const create = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      gameSpecId: 'banqi',
      mode: 'pve',
      engineId: 'private-banqi-worker',
      internalEngineTest: true,
      preferredColor: 'red',
      timeControl: { initialMs: 300000, incrementMs: 5000 },
    }),
  });
  assert.equal(create.status, 201, `Create refused (${create.status})`);
  const { roomId } = await create.json();
  let seatToken;
  let latest;
  let revision = 0;
  let reconnects = 0;
  let hydrated = false;
  let highestQuiet = 0;
  let humanMoves = 0;
  async function connect() {
    socket = new WebSocket(
      `${base.replace('http:', 'ws:')}/?room=${roomId}&gameSpecId=banqi`,
      seatToken ? [`mistboard-seat.${seatToken}`] : undefined,
      { origin: base, headers: { cookie } },
    );
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('WS hello timeout')), 5000);
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'error') {
          clearTimeout(timer);
          reject(new Error(`WS rejected: ${msg.error ?? 'error'}`));
        }
        if (msg.type === 'hello' || msg.type === 'snapshot' || msg.type === 'event-appended') {
          const previous = latest;
          latest =
            msg.type === 'event-appended'
              ? { ...msg, events: [...(previous?.events ?? []), ...(msg.event ? [msg.event] : [])] }
              : msg;
          revision++;
        }
        if (msg.type === 'hello') {
          seatToken = msg.seatToken ?? seatToken;
          clearTimeout(timer);
          done();
        }
      });
      socket.once('error', () => {
        clearTimeout(timer);
        reject(new Error('WS connection failed'));
      });
    });
  }
  function publicQuiet(snapshot) {
    // Reconstruct irreversible boundaries only from already received public boards.
    const board = snapshot.state.board;
    const faceDown = Object.values(board).filter((p) => p.faceDown).length;
    const material = Object.keys(board).length;
    if (publicQuiet.ply !== snapshot.state.ply) {
      publicQuiet.count =
        faceDown === publicQuiet.faceDown && material === publicQuiet.material
          ? (publicQuiet.count ?? 0) + 1
          : 0;
      publicQuiet.faceDown = faceDown;
      publicQuiet.material = material;
      publicQuiet.ply = snapshot.state.ply;
    }
    return publicQuiet.count ?? 0;
  }
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));
  await connect();
  // The driver reads only the seated public WS view. It cannot consult the deal,
  // canonical room state, history's future flips, or the engine's chosen move.
  const started = Date.now();
  let sentAtRevision = -1;
  while (latest.state.status.type === 'playing') {
    assert.ok(Date.now() - started < 240000, 'Game exceeded four-minute rehearsal limit');
    const view = latest.state;
    if (view.status.turn === latest.seat && sentAtRevision !== revision) {
      const legal = view.legalMoves;
      assert.ok(legal.length, 'Human seat has no public legal move');
      if (!hydrated && humanMoves >= 16 && publicQuiet(latest) > 0) {
        const before = latest.events.filter((e) => e.type === 'move-played').length;
        socket.close();
        await once(socket, 'close');
        const room = banqiRooms.get(roomId);
        await room.pendingWrites;
        clearBanqiRuntimeTimers(room);
        banqiRooms.delete(roomId);
        const loaded = await getOrLoadBanqiRoom(roomId);
        assert.ok(loaded, 'Durable hydration failed');
        assert.equal(loaded.projection.state.ply, before);
        hydrated = true;
        reconnects++;
        await connect();
        assert.equal(latest.events.filter((e) => e.type === 'move-played').length, before);
        continue;
      }
      const captures = legal.filter(
        (m) => m.from !== m.to && view.board[m.to] && !view.board[m.to].faceDown,
      );
      const choices = captures.length ? captures : legal;
      const move = choices[(humanMoves * 17 + 3) % choices.length];
      sentAtRevision = revision;
      humanMoves++;
      socket.send(JSON.stringify({ type: 'move', from: move.from, to: move.to }));
    }
    const quiet = publicQuiet(latest);
    highestQuiet = Math.max(highestQuiet, quiet);
    await delay(10);
  }
  const room = banqiRooms.get(roomId);
  await room.pendingWrites;
  const events = await persistence.loadRoomEvents(roomId);
  const replay = replayTenantEvents(banqiTenant, events);
  assert.equal(replay.state.status.type, 'finished');
  assert.ok(
    !['resignation', 'abandonment', 'timeout'].includes(replay.state.status.reason),
    'A forced terminal result is not a full-game proof',
  );
  assert.ok(replay.state.ply >= 32, 'Game too short for the full-game rehearsal');
  assert.ok(hydrated, 'Quiet-history hydration was not exercised');
  const { rows } = await getPool().query(
    `SELECT visibility,corpus_id,ply_count,result,termination,(${countedHumanGame('g')}) AS counted,(${internalHumanGame('g')}) AS internal,(${shortHumanGame('g')}) AS short,(${preLaunchHumanGame('g')}) AS prelaunch FROM games g WHERE room_id=$1`,
    [roomId],
  );
  assert.equal(rows[0].visibility, 'private');
  assert.equal(rows[0].counted, false);
  assert.equal(rows[0].internal, true);
  assert.equal(rows[0].short, false);
  assert.equal(rows[0].prelaunch, false);
  const identity = await getPool().query(
    'SELECT subject_id,engine_version,visibility FROM game_participants WHERE game_id=$1 AND subject_type=$2',
    [roomId, 'engine-version'],
  );
  assert.equal(identity.rows[0].engine_version, version);
  assert.equal(identity.rows[0].subject_id, 'private-banqi-worker');
  assert.equal((await fetch(`${base}/api/banqi/games/${roomId}`)).status, 404);
  assert.notEqual((await fetch(`${base}/api/games/${roomId}/export.json`)).status, 200);
  console.log(
    JSON.stringify({
      roomId,
      engineVersion: version,
      uciName,
      workerPid: worker.pid,
      webPid: process.pid,
      separateProcess: true,
      plies: replay.state.ply,
      terminal: replay.state.status,
      highestQuiet,
      reconnects,
      persistedHydration: hydrated,
      private: true,
      counted: false,
      base,
      reviewEmail: email,
    }),
  );
  if (process.argv.includes('--keep')) {
    console.log('Local review pair retained; SIGINT/SIGTERM stops only this pair.');
    await new Promise(() => {});
  }
} finally {
  await stop();
}
