import assert from 'node:assert/strict';
import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { basename, dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Color, GameEvent, Move, PlayerView } from '@mistboard/game';
import WebSocket from 'ws';

// End-to-end wire-format regression suite. All paired broadcasts arrive as
// `event-appended` frames per the snapshot→delta migration (Phase 3,
// 2026-05-22 — capability gate removed). Snapshot frames remain for the
// recovery channels: hello/first-connect, snapshot:request, and the
// game-end boundary (a clean final-frame resync — NOT a reveal; model A keeps
// the room fogged on finish). Any new fog-leak rule must land in the shared
// filterEventForClient helper in payloads.ts so both wire paths stay in
// lock-step.

type ServerMessage = {
  type: 'hello' | 'snapshot' | 'event-appended';
  clientId?: string;
  events?: GameEvent[]; // snapshot/hello only
  event?: GameEvent; // event-appended only
  seq?: number; // event-appended only
  mode?: 'pvp' | 'pve' | 'eve' | 'imported' | 'manual';
  seat: Color | 'spectator';
  seatToken?: string;
  state: PlayerView;
};

type TestClient = {
  messages: ServerMessage[];
  socket: WebSocket;
};
type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

let serverPort = 0;
let serverProcess: ServerProcess | undefined;
let roomCounter = 0;

before(async () => {
  const started = await startServer();
  serverPort = started.port;
  serverProcess = started.child;
});

after(async () => {
  if (serverProcess) await stopServer(serverProcess);
});

test('delta: live PvP third client is rejected before any frame', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-pvp');
  clients.push(await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`));
  clients.push(await connectForHello(port, `room=${room}&client=black-client-0001`));

  const rejected = await connectForClose(port, `room=${room}&client=third-client-0001`);

  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

test('delta: seated clients receive seat tokens only in hello payloads (no other frame carries one)', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-token');
  const white = await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`);
  clients.push(white);
  const hello = white.messages[0];
  assert.equal(hello?.type, 'hello');
  assert.equal(hello?.seat, 'white');
  assert.match(hello?.seatToken ?? '', /^[a-zA-Z0-9_-]{32,128}$/);

  // The next post-hello frame is a standalone-hydration snapshot triggered
  // by handleConnection broadcastSnapshot. Confirm it carries no token.
  const followup = await waitForMessage(
    white.messages,
    (message) => message.type === 'snapshot' || message.type === 'event-appended',
    'post-hello frame',
  );
  assert.equal('seatToken' in followup, false);
});

test('delta: valid seat token reclaims a seat and displaces the older socket', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-reclaim');
  const white = await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`);
  const token = white.messages[0]?.seatToken;
  assert.ok(token);
  clients.push(white);

  const black = await connectForHello(port, `room=${room}&client=black-client-0001`);
  clients.push(black);
  await waitForMessage(
    white.messages,
    (message) =>
      message.state.status.type === 'playing' &&
      message.state.status.turn === 'white' &&
      message.state.legalMoves.length > 0,
    'initial white turn',
  );

  const oldWhiteClosed = waitForSocketClose(white.socket);
  const replacement = await connectForHello(port, `room=${room}&client=white-replacement-0001`, {
    seatToken: token,
  });
  clients.push(replacement);

  const closed = await oldWhiteClosed;
  assert.equal(closed.code, 4000);
  assert.equal(closed.reason, 'duplicate session');
  assert.equal(replacement.messages[0]?.seat, 'white');
  assert.equal(replacement.messages[0]?.clientId, 'white-replacement-0001');
  assert.equal(replacement.messages[0]?.seatToken, undefined);

  const move = firstLegalMove(replacement.messages[0]);
  replacement.socket.send(JSON.stringify({ type: 'move', ...move }));
  // Black is delta-capable, so the move-played broadcast arrives as
  // event-appended (not snapshot). State must still transition.
  await waitForMessage(
    black.messages,
    (message) => message.state.status.type === 'playing' && message.state.status.turn === 'black',
    'replacement move accepted (delta-path)',
  );
});

test('delta: copied client id without a seat token cannot reclaim a private PvP seat', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-token-required');
  clients.push(await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`));
  clients.push(await connectForHello(port, `room=${room}&client=black-client-0001`));

  const rejected = await connectForClose(port, `room=${room}&client=white-client-0001`);

  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

test('delta: wrong seat token cannot reclaim a private PvP seat', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-wrong-token');
  clients.push(await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`));
  clients.push(await connectForHello(port, `room=${room}&client=black-client-0001`));

  const rejected = await connectForClose(port, `room=${room}&client=white-replacement-0001`, {
    seatToken: 'not-the-issued-seat-token',
  });

  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

test('delta: unknown client cannot take an abandoned active private PvP seat', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-active-abandoned');
  const white = await connectForHello(port, `room=${room}&client=white-client-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-client-0001`);
  clients.push(white, black);

  const whiteReady = await waitForMessage(
    white.messages,
    (message) =>
      message.state.status.type === 'playing' &&
      message.state.status.turn === 'white' &&
      message.state.legalMoves.length > 0,
    'initial white turn',
  );
  white.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(whiteReady) }));
  await waitForMessage(
    black.messages,
    (message) => message.state.status.type === 'playing' && message.state.status.turn === 'black',
    'black turn after first move',
  );

  const blackClosed = waitForSocketClose(black.socket);
  black.socket.close();
  await blackClosed;

  const rejected = await connectForClose(port, `room=${room}&client=unknown-client-001`);

  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

test('delta: live PvE third client is rejected before any frame', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-pve');
  const human = await connectForHello(
    port,
    `room=${room}&client=pve-human-0001&engine=random&reset=1`,
  );
  clients.push(human);
  assert.equal(human.messages[0]?.mode, 'pve');
  assert.equal(human.messages[0]?.seat, 'white');

  const rejected = await connectForClose(port, `room=${room}&client=pve-observer-01`);
  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

test('delta: live EvE third client is rejected before any frame', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-eve');
  const white = await connectForHello(port, `room=${room}&client=engine:white&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=engine:black`);
  clients.push(white, black);

  const rejected = await connectForClose(port, `room=${room}&client=eve-observer-01`);
  assert.equal(rejected.code, 1008);
  assert.equal(rejected.reason, 'private room');
  assert.deepEqual(rejected.messages, []);
});

// ── Delta-specific assertions ────────────────────────────────────────────

test('delta: white move yields event-appended to white (own move visible) and to black (event redacted)', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-move-fog');
  const white = await connectForHello(port, `room=${room}&client=white-fog-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-fog-0001`);
  clients.push(white, black);

  const whiteReady = await waitForMessage(
    white.messages,
    (message) =>
      message.state.status.type === 'playing' &&
      message.state.status.turn === 'white' &&
      message.state.legalMoves.length > 0,
    'initial white turn',
  );

  const baselineWhite = white.messages.length;
  const baselineBlack = black.messages.length;
  white.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(whiteReady) }));

  // White (mover) gets event-appended with the move-played event visible.
  const whiteAppended = await waitForMessageAfter(
    white,
    baselineWhite,
    (m) => m.type === 'event-appended' && m.event?.type === 'move-played',
    'white event-appended with move',
  );
  assert.equal(whiteAppended.event?.type, 'move-played');
  assert.equal((whiteAppended.event as Extract<GameEvent, { type: 'move-played' }>).color, 'white');
  assert.ok(typeof whiteAppended.seq === 'number');

  // Black (observer) gets event-appended for the same seq, but the event is
  // redacted out. State still updates so visibility can change. THIS is the
  // load-bearing fog-privacy assertion for the delta path.
  const blackAppended = await waitForMessageAfter(
    black,
    baselineBlack,
    (m) =>
      m.type === 'event-appended' &&
      m.state.status.type === 'playing' &&
      m.state.status.turn === 'black',
    'black event-appended after white move',
  );
  assert.equal(
    blackAppended.event,
    undefined,
    'opponent move-played must NOT leak into delta frame',
  );
  assert.equal(typeof blackAppended.seq, 'number');
});

test('delta: snapshot:request triggers a full snapshot reply on the same socket', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-snapshot-request');
  const white = await connectForHello(port, `room=${room}&client=white-req-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-req-0001`);
  clients.push(white, black);

  await waitForMessage(white.messages, (m) => m.state.status.type === 'playing', 'game starts');

  const baseline = white.messages.length;
  white.socket.send(JSON.stringify({ type: 'snapshot:request' }));
  const reply = await waitForMessageAfter(
    white,
    baseline,
    (m) => m.type === 'snapshot',
    'snapshot reply',
  );
  // Snapshot carries the full filtered event log for this recipient — the
  // recovery contract.
  assert.ok(Array.isArray(reply.events));
});

test('delta: mid-game snapshot:request stays fogged — recovered log never leaks the opponent (model A)', async (t) => {
  // The recovery channel ships the FULL per-recipient event log, so it is the
  // highest-blast-radius surface for a fog leak — yet the steady-state delta
  // test above and the finished-boundary test below leave the MID-GAME resync
  // path unguarded. After both sides have moved, a resync must still redact:
  // black's recovered log shows its own move but never white's hidden
  // move-played. A regression that shipped the raw log on resync would leak here.
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-resync-fog');
  const white = await connectForHello(port, `room=${room}&client=white-resync-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-resync-0001`);
  clients.push(white, black);

  // White moves (hidden from black), then black replies. Use baseline-relative
  // waits for every post-send condition: a plain waitForMessage on a repeated
  // turn condition can match a STALE earlier frame, letting snapshot:request
  // race ahead of black's own move commit (the flaky empty-log failure).
  const whiteReady = await waitForMessage(
    white.messages,
    (m) =>
      m.state.status.type === 'playing' &&
      m.state.status.turn === 'white' &&
      m.state.legalMoves.length > 0,
    'initial white turn',
  );
  let blackBaseline = black.messages.length;
  white.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(whiteReady) }));

  const blackReady = await waitForMessageAfter(
    black,
    blackBaseline,
    (m) =>
      m.state.status.type === 'playing' &&
      m.state.status.turn === 'black' &&
      m.state.legalMoves.length > 0,
    'black turn after white move',
  );
  blackBaseline = black.messages.length;
  black.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(blackReady) }));

  // Black's own move is committed once the turn flips back to white. Waiting for
  // that NEW frame guarantees ply-2 is in the log before we resync.
  await waitForMessageAfter(
    black,
    blackBaseline,
    (m) => m.state.status.type === 'playing' && m.state.status.turn === 'white',
    'white turn after black move',
  );

  // Force a full resync mid-game from black.
  blackBaseline = black.messages.length;
  black.socket.send(JSON.stringify({ type: 'snapshot:request' }));
  const resync = await waitForMessageAfter(
    black,
    blackBaseline,
    (m) => m.type === 'snapshot' && m.state.status.type === 'playing',
    'black mid-game resync snapshot',
  );

  assert.ok(Array.isArray(resync.events), 'resync snapshot carries the recovery log');
  const blackOwn = (resync.events ?? []).filter(
    (e) => e.type === 'move-played' && e.color === 'black',
  );
  assert.ok(blackOwn.length >= 1, 'black must see its own move-played in the resync log');
  const whiteLeak = (resync.events ?? []).find(
    (e) => e.type === 'move-played' && e.color === 'white',
  );
  assert.ok(
    !whiteLeak,
    "model A: white's hidden move-played must NOT leak into black's mid-game resync log",
  );
});

test('delta: the game-end snapshot reveals the whole game to both seats', async (t) => {
  // Resignation transitions status to 'finished'. The game-end broadcast is a
  // full snapshot to every recipient (a clean final-frame resync at the
  // boundary), and it now carries the revealed game: black sees white's
  // previously-hidden moves. Same content /game/:id already serves to any
  // signed-out stranger. The LIVE fog invariant is covered by
  // 'mid-game snapshot:request stays fogged', which must keep passing.
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-resign-reveal');
  const white = await connectForHello(port, `room=${room}&client=white-resign-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-resign-0001`);
  clients.push(white, black);

  const whiteReady = await waitForMessage(
    white.messages,
    (message) =>
      message.state.status.type === 'playing' &&
      message.state.status.turn === 'white' &&
      message.state.legalMoves.length > 0,
    'initial white turn',
  );
  white.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(whiteReady) }));
  const blackReady = await waitForMessage(
    black.messages,
    (message) =>
      message.state.status.type === 'playing' &&
      message.state.status.turn === 'black' &&
      message.state.legalMoves.length > 0,
    'black turn',
  );
  // Both players must complete their first move before resign is valid — until
  // then the game is in the abort window (resign would wrongly award a result).
  black.socket.send(JSON.stringify({ type: 'move', ...firstLegalMove(blackReady) }));
  await waitForMessage(
    white.messages,
    (message) => message.state.status.type === 'playing' && message.state.status.turn === 'white',
    'white turn after black reply',
  );

  const baselineBlack = black.messages.length;
  white.socket.send(JSON.stringify({ type: 'resign' }));

  const blackEnd = await waitForMessageAfter(
    black,
    baselineBlack,
    (m) => m.state.status.type === 'finished',
    'black sees finished status',
  );
  assert.equal(
    blackEnd.type,
    'snapshot',
    'game-end broadcast must be a full-frame snapshot at the boundary',
  );
  assert.ok(Array.isArray(blackEnd.events));
  // The room opens on finish, so white's move-played now appears in black's
  // final snapshot. This assertion is the inverse of what it used to be: if it
  // ever flips back, a shared finished-room link is showing a blank board again.
  const whiteMove = blackEnd.events?.find((e) => e.type === 'move-played' && e.color === 'white');
  assert.ok(whiteMove, "a finished room must deliver white's moves in black's final snapshot");
});

test('delta: user abort pre-move-1 ends both clients in the aborted state', async (t) => {
  const port = serverPort;
  const clients: TestClient[] = [];
  t.after(async () => closeClients(clients));

  const room = uniqueRoomId('ws-delta-user-abort');
  const white = await connectForHello(port, `room=${room}&client=white-abort-0001&reset=1`);
  const black = await connectForHello(port, `room=${room}&client=black-abort-0001`);
  clients.push(white, black);

  await waitForMessage(
    white.messages,
    (m) => m.state.status.type === 'playing' && m.state.status.turn === 'white',
    'initial white turn',
  );

  // Black is not the side to move during white's window — its abort is ignored.
  black.socket.send(JSON.stringify({ type: 'abort' }));
  // White (side to move) aborts before any move.
  white.socket.send(JSON.stringify({ type: 'abort' }));

  for (const c of [white, black]) {
    const ended = await waitForMessage(
      c.messages,
      (m) => m.state.status.type === 'aborted',
      'client sees aborted status',
    );
    assert.equal((ended.state.status as { type: 'aborted'; reason: string }).reason, 'user-abort');
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function startServer(): Promise<{ port: number; child: ServerProcess }> {
  const port = await openPort();
  const testDir = dirname(fileURLToPath(import.meta.url));
  const entry =
    basename(testDir) === 'src' ? join(testDir, '..', 'dist', 'main.js') : join(testDir, 'main.js');
  const child = spawn(process.execPath, [entry], {
    env: {
      MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE: 'true',
      NODE_ENV: 'test',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(child);
  return { port, child };
}

function uniqueRoomId(prefix: string): string {
  roomCounter += 1;
  return `${prefix}-${Date.now()}-${roomCounter}`;
}

function openPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate test port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function waitForServerReady(child: ServerProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(
      () => reject(new Error(`server startup timed out: ${output}`)),
      5_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('mistboard server listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited before ready with code ${code}: ${output}`));
    });
  });
}

function stopServer(child: ServerProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

function connectForHello(
  port: number,
  query: string,
  options: { seatToken?: string } = {},
): Promise<TestClient> {
  const protocols = options.seatToken ? [`mistboard-seat.${options.seatToken}`] : undefined;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    if (
      message.type === 'hello' ||
      message.type === 'snapshot' ||
      message.type === 'event-appended'
    ) {
      messages.push(message);
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`hello timed out for ${query}`)), 3_000);
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      reject(
        new Error(`socket closed before hello for ${query}: ${code} ${reason.toString('utf8')}`),
      );
    });
    const wait = () => {
      if (messages[0]) {
        clearTimeout(timeout);
        resolve({ messages, socket });
        return;
      }
      setTimeout(wait, 10);
    };
    wait();
  });
}

function connectForClose(
  port: number,
  query: string,
  options: { seatToken?: string } = {},
): Promise<{ code: number; messages: ServerMessage[]; reason: string }> {
  const protocols = options.seatToken ? [`mistboard-seat.${options.seatToken}`] : undefined;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?${query}`, protocols);
  const messages: ServerMessage[] = [];
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as ServerMessage;
    if (
      message.type === 'hello' ||
      message.type === 'snapshot' ||
      message.type === 'event-appended'
    ) {
      messages.push(message);
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`close timed out for ${query}`)), 3_000);
    socket.once('error', reject);
    socket.once('close', (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, messages, reason: reason.toString('utf8') });
    });
  });
}

function waitForSocketClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString('utf8') });
    });
  });
}

async function waitForMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    const found = [...messages].reverse().find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function waitForMessageAfter(
  client: TestClient,
  baselineCount: number,
  predicate: (message: ServerMessage) => boolean,
  label: string,
): Promise<ServerMessage> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3_000) {
    for (let i = client.messages.length - 1; i >= baselineCount; i -= 1) {
      const m = client.messages[i]!;
      if (predicate(m)) return m;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function firstLegalMove(message: ServerMessage | undefined): Move {
  const move = message?.state.legalMoves[0];
  assert.ok(move, 'expected at least one legal move');
  return move;
}

async function closeClients(clients: TestClient[]): Promise<void> {
  await Promise.all(
    clients.map(
      (client) =>
        new Promise<void>((resolve) => {
          if (client.socket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          client.socket.once('close', () => resolve());
          client.socket.close();
          setTimeout(resolve, 250);
        }),
    ),
  );
}
