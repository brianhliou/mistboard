#!/usr/bin/env node
// Local only. No database connection is made for --dry-run.
// node scripts/seed-ffq-engine-games.mjs [--file games.jsonl] [--limit 6] [--dry-run]
// Reads sibling spec.json for node budgets; without it assumes the default
// 50k/2k scaling run. Review requires MISTBOARD_FFQ_BANQI_ENABLED=true and admin.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import pg from 'pg';
import { tsImport } from 'tsx/esm/api';

const {
  applyFFQBanqiMove,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  ffqBanqiSeatToMove,
  getFFQBanqiResult,
  isFFQBanqiLegalMove,
} = await tsImport('../packages/game/src/variants-ffq-banqi.ts', import.meta.url);
const { ffqBanqiStateToFen } = await tsImport(
  '../packages/game/src/ffq-banqi-fen.ts',
  import.meta.url,
);

export const DEFAULT_FILE =
  '/Users/brianliou/projects/mistboard-engine-wt-ffq/lab/runs/ffq-scaling-20261104/games.jsonl';
const DEFAULT_SETTINGS = { high: 50000, low: 2000 };

export function parseEngineMove(text) {
  if (typeof text !== 'string' || !/^[a-d][0-7][a-d][0-7]$/.test(text)) {
    throw new Error(`invalid FFQ move ${JSON.stringify(text)}; expected a0..d7 twice`);
  }
  // Same orientation as scripts/ffq/kernel.ts and Rust's uci_to_move:
  // index = rank * 4 + file; from === to means flip (d0d0 => 3,3).
  const square = (offset) => Number(text[offset + 1]) * 4 + text.charCodeAt(offset) - 97;
  return { from: square(0), to: square(2) };
}

export function replayEngineGame(trace, settings = DEFAULT_SETTINGS) {
  const context = `game ${trace?.game ?? '?'}`;
  if (
    !Number.isSafeInteger(trace?.game) ||
    trace.game < 0 ||
    !Number.isInteger(trace.dealSeed) ||
    trace.dealSeed < 0 ||
    trace.dealSeed > 0xffffffff ||
    !['red', 'black'].includes(trace.highColor) ||
    !Array.isArray(trace.plies) ||
    trace.plies.length === 0
  ) {
    throw new Error(`${context}: invalid trace metadata or empty plies`);
  }
  const moves = trace.plies.map((ply, index) => {
    try {
      return parseEngineMove(ply?.move);
    } catch (error) {
      throw new Error(`${context}, ply ${index + 1}: ${error.message}`);
    }
  });
  // Content identity excludes machine timings and filesystem location. Copying
  // a trace or increasing --limit cannot duplicate already imported games.
  const digest = createHash('sha256')
    .update(JSON.stringify([trace.game, trace.dealSeed, trace.highColor, settings, moves]))
    .digest('hex')
    .slice(0, 24);
  const roomId = `ffq_engine_${digest}`;
  const setup = { deal: createFFQBanqiDeal(trace.dealSeed) };
  let state = createFFQBanqiStateFromSetup(roomId, setup);
  for (let index = 0; index < moves.length; index += 1) {
    const where = `${context}, ply ${index + 1}`;
    const fen = ffqBanqiStateToFen(state);
    if (fen !== trace.plies[index].fen) {
      throw new Error(
        `${where}: public FEN mismatch\nexpected: ${trace.plies[index].fen}\nactual:   ${fen}`,
      );
    }
    if (!isFFQBanqiLegalMove(state, moves[index])) {
      throw new Error(`${where}: illegal move ${trace.plies[index].move}`);
    }
    state = applyFFQBanqiMove(state, moves[index]);
  }
  if (ffqBanqiStateToFen(state) !== trace.finalFen) {
    throw new Error(`${context}: final public FEN mismatch`);
  }
  const result = getFFQBanqiResult(state);
  if (result.type !== 'finished' || !isDeepStrictEqual(result, trace.result)) {
    throw new Error(
      `${context}: result mismatch; expected ${JSON.stringify(trace.result)}, got ${JSON.stringify(result)}`,
    );
  }
  return { roomId, setup, moves, state, trace, settings };
}

export function parseAndReplay(text, limit = 6, settings = DEFAULT_SETTINGS) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('--limit must be a positive integer');
  const games = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let trace;
    try {
      trace = JSON.parse(line);
    } catch {
      throw new Error(`line ${index + 1}: invalid JSON`);
    }
    if (seen.has(trace.game)) throw new Error(`line ${index + 1}: duplicate game ${trace.game}`);
    seen.add(trace.game);
    games.push(replayEngineGame(trace, settings));
    if (games.length === limit) break;
  }
  if (!games.length) throw new Error('no games in input');
  return games;
}

export function assertLocalDatabase(databaseUrl) {
  const message =
    'Refusing write: DATABASE_URL must be a postgres URL pointing at localhost or 127.0.0.1';
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(message);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(message);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(message);
  // pg allows query-string host overrides. Check its effective host as well;
  // constructing a Client parses the URL but does not connect to anything.
  const client = new pg.Client({ connectionString: databaseUrl });
  if (!['localhost', '127.0.0.1'].includes(client.connectionParameters.host)) {
    throw new Error(message);
  }
}

const engineName = (nodes) => `ffq-engine-${nodes % 1000 === 0 ? `${nodes / 1000}k` : nodes}`;

export async function buildFinishedGame(game, accounts, startedAt) {
  const { ffqBanqiTenant } = await tsImport(
    '../apps/server/src/ffq-banqi-tenant.ts',
    import.meta.url,
  );
  const { createTenantRuntimeRoomFromEvents } = await tsImport(
    '../apps/server/src/variant-tenant/runtime.ts',
    import.meta.url,
  );
  const { buildTenantGameSummary } = await tsImport(
    '../apps/server/src/variant-tenant/events.ts',
    import.meta.url,
  );
  const { roomId, setup, moves, trace } = game;
  const events = [{ type: 'room-created', roomId, at: startedAt, gameSpecId: 'ffq-banqi', setup }];
  for (const seat of ['red', 'black']) {
    events.push({
      type: 'seat-assigned',
      roomId,
      at: startedAt,
      clientId: accounts[seat].id,
      seat,
    });
  }
  for (const [index, move] of moves.entries()) {
    events.push({
      type: 'move-played',
      roomId,
      at: startedAt + (index + 1) * 1000,
      color: ffqBanqiSeatToMove({ ply: index }),
      move,
    });
  }
  const hydrated = createTenantRuntimeRoomFromEvents(ffqBanqiTenant, events);
  if (!hydrated.ok) throw new Error(`game ${trace.game}: tenant replay failed (${hydrated.error})`);
  const { room } = hydrated;
  assert.deepEqual(
    room.projection.state,
    game.state,
    `game ${trace.game}: tenant/kernel replay mismatch`,
  );
  for (const seat of ['red', 'black']) {
    const account = accounts[seat];
    // Finished review attribution comes from game_participants, just as for
    // account-held live seats. These are not login or reclaim credentials.
    room.seatTokens[seat] = {
      userId: account.id,
      userHandle: account.handle,
      userDisplayName: account.displayName,
    };
  }
  return { events, summary: buildTenantGameSummary(ffqBanqiTenant, room) };
}

async function settingsForFile(file) {
  let spec;
  try {
    spec = JSON.parse(await readFile(resolve(dirname(file), 'spec.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return DEFAULT_SETTINGS;
    throw error;
  }
  if (
    spec.mode !== 'scaling' ||
    ![spec.high_nodes, spec.low_nodes].every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    throw new Error('spec.json must describe a scaling run with positive high_nodes and low_nodes');
  }
  return { high: spec.high_nodes, low: spec.low_nodes };
}

async function ensureAccount(pool, name) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, handle, display_name, stats_excluded_at)
     VALUES ($1, $2, $3, $3, now())
     ON CONFLICT ((lower(handle))) DO UPDATE
       SET stats_excluded_at = COALESCE(users.stats_excluded_at, now())
     RETURNING id, handle, display_name AS "displayName"`,
    [randomUUID(), `${name}@local.invalid`, name],
  );
  return rows[0];
}

export async function persistFinishedGame(game, accounts, store, now = Date.now()) {
  const existing = (await store.loadRoomEvents(game.roomId)) ?? [];
  const startedAt = existing[0]?.at ?? now - game.moves.length * 1000;
  const { events, summary } = await buildFinishedGame(game, accounts, startedAt);
  if (!isDeepStrictEqual(existing, events.slice(0, existing.length))) {
    throw new Error(`game ${game.trace.game}: existing event log differs; refusing to overwrite`);
  }
  const previous = await store.getGameSummary(game.roomId);
  if (previous) {
    if (
      existing.length !== events.length ||
      previous.variant !== 'ffq-banqi' ||
      previous.result !== summary.result
    ) {
      throw new Error(`game ${game.trace.game}: existing game summary differs`);
    }
    return false;
  }
  for (let seq = existing.length; seq < events.length; seq += 1) {
    await store.appendRoomEvent(game.roomId, seq, events[seq]);
  }
  await store.recordGameEnd(game.roomId, summary);
  return true;
}

async function writeGames(games, databaseUrl) {
  assertLocalDatabase(databaseUrl);
  const persistence = await tsImport('../apps/server/src/persistence.ts', import.meta.url);
  // tsImport gives each call its own module graph, so this persistence-db is a
  // separate instance from the one persistence.ts re-exports: initialize both.
  const db = await tsImport('../apps/server/src/persistence-db.ts', import.meta.url);
  const { getPool } = db;
  persistence.init(databaseUrl);
  if (!db.isInitialized()) db.init(databaseUrl);
  const closeAll = async () => {
    await persistence.close();
    if (db.isInitialized()) await db.close();
  };
  let lock;
  let written = 0;
  let skipped = 0;
  try {
    lock = await getPool().connect();
    // Serialize this importer, including account creation and partial-log
    // recovery. Use the normal live writers rather than duplicating their SQL.
    await lock.query("SELECT pg_advisory_lock(hashtext('seed-ffq-engine-games'))");
    const settings = games[0].settings;
    const high = await ensureAccount(getPool(), engineName(settings.high));
    const low = await ensureAccount(getPool(), engineName(settings.low));
    for (const game of games) {
      const accounts =
        game.trace.highColor === 'red' ? { red: high, black: low } : { red: low, black: high };
      if (!(await persistFinishedGame(game, accounts, persistence))) {
        skipped += 1;
        continue;
      }
      written += 1;
      console.log(
        `http://localhost:${process.env.MISTBOARD_DEV_PORT_BASE ?? 3000}/ffq-banqi/game/${game.roomId}`,
      );
    }
  } finally {
    if (lock) {
      try {
        await lock.query("SELECT pg_advisory_unlock(hashtext('seed-ffq-engine-games'))");
      } finally {
        lock.release();
        await closeAll();
      }
    } else {
      await closeAll();
    }
  }
  console.log(`Written ${written} games; skipped ${skipped} already imported games.`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: DEFAULT_FILE },
      limit: { type: 'string', default: '6' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values['dry-run']) assertLocalDatabase(process.env.DATABASE_URL);
  const file = resolve(values.file);
  const settings = await settingsForFile(file);
  const games = parseAndReplay(await readFile(file, 'utf8'), Number(values.limit), settings);
  for (const game of games) {
    console.log(
      `Verified game ${game.trace.game}: ${game.moves.length} plies, ${game.state.status.winner ?? 'draw'} / ${game.state.status.reason}`,
    );
  }
  console.log(
    `Verified ${games.length} games, ${games.reduce((sum, game) => sum + game.moves.length, 0)} plies (${engineName(settings.high)} vs ${engineName(settings.low)}).`,
  );
  if (values['dry-run']) {
    console.log('Dry run: no database connection or writes.');
    return;
  }
  await writeGames(games, process.env.DATABASE_URL);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
