// All runtime adapters are local: database reads never initialize the puzzle
// store (which would sync seeds); the engine subprocesses never call an API.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PIKAFISH_XIANGQI_NNUE_NET,
  PIKAFISH_XIANGQI_NNUE_SHA256,
  PIKAFISH_XIANGQI_REF,
  pikafishXiangqiDevSourceDir,
} from '../../apps/server/src/xiangqi-pikafish-paths.ts';
import { assertLocalDatabase, REPO_ROOT } from '../player-kit.mjs';
import { findCriticalMoments } from './player-kit-moments.mjs';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const keyFor = (board) => createHash('sha256').update(board.boardId).digest('hex').slice(0, 20);

export function runLocalScript(script, args, { env = {}, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    let failed = false;
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    };
    const timer = setTimeout(() => {
      failed = true;
      stop();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 2_000_000) {
        failed = true;
        stop();
      }
    });
    child.stderr.on('data', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      reject(new Error('local script failed to start'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) reject(new Error('local script failed or exceeded its budget'));
      else resolve(output);
    });
  });
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// The server's build (#989): upstream at the pikafish.ref pin plus
// pikafish-cc0-net.patch, reading the Fairy-Stockfish CC0 net, in the local
// patched checkout the server resolver also looks in.
export async function pinnedEngine() {
  const pin = (await readFile(join(REPO_ROOT, 'pikafish.ref'), 'utf8')).split('\n')[0].trim();
  if (!pin.startsWith(PIKAFISH_XIANGQI_REF))
    throw new Error('server Pikafish pin differs from pikafish.ref');
  const source = pikafishXiangqiDevSourceDir(homedir());
  const binary = await realpath(join(source, 'src/pikafish'));
  const net = await realpath(join(source, 'src', PIKAFISH_XIANGQI_NNUE_NET));
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const revision = (await run('git', ['-C', source, 'rev-parse', 'HEAD'])).stdout.trim();
  if (revision !== pin) throw new Error('local Pikafish revision differs from pin');
  await access(binary);
  const identity = (await run(binary, ['uci'], { timeout: 10_000, maxBuffer: 128_000 })).stdout;
  if (
    !identity
      .split('\n')
      .some((line) => line.startsWith('id name Pikafish ') && line.includes(pin.slice(0, 8)))
  )
    throw new Error('local Pikafish binary differs from pin');
  const netSha256 = await fileHash(net);
  if (netSha256 !== PIKAFISH_XIANGQI_NNUE_SHA256)
    throw new Error('local Pikafish net is not the CC0 net');
  return { pin, binary, net, binarySha256: await fileHash(binary), netSha256 };
}

async function loadPlayer(slug, dbUrl) {
  assertLocalDatabase(dbUrl);
  const db = await import('../../apps/server/src/persistence-db.ts');
  const players = await import('../../apps/server/src/persistence-xiangqi-players.ts');
  const { getXiangqiBroadcastBoard } = await import(
    '../../apps/server/src/persistence-xiangqi-broadcasts.ts'
  );
  const { xiangqiBroadcastTourLevel } = await import(
    '../../apps/server/src/xiangqi-broadcast-levels.ts'
  );
  const { romanizeXiangqiPlayerName } = await import(
    '../../apps/server/src/xiangqi-broadcast-translate.ts'
  );
  db.init(dbUrl, { maxPoolConnections: 1, statementTimeoutMs: 30_000 });
  try {
    // Defense against accidental future writes in this discovery path.
    await db.getPool().query('SET default_transaction_read_only = on');
    const player = (await players.listXiangqiPlayers()).find((p) => p.slug === slug) ?? null;
    const names = {};
    if (!player) return { player, names, boards: [] };
    // A name with no Chinese is already English (players relayed from Western events).
    const translated = (side) =>
      side?.nameEn ||
      (side?.name && !/\p{Script=Han}/u.test(side.name) ? side.name.trim() : null) ||
      (side?.name ? romanizeXiangqiPlayerName(side.name, side.federation) : null);
    const playerName = translated(player);
    if (playerName) names[player.name] = playerName;
    const linked = await players.listXiangqiPlayerBoards(player, () => null);
    const boards = [];
    for (const summary of linked) {
      const board = await getXiangqiBroadcastBoard(summary.boardId);
      if (board)
        for (const side of [board.red, board.black]) {
          const name = translated(side);
          if (name) names[side.name] = name;
        }
      boards.push({
        ...summary,
        level: xiangqiBroadcastTourLevel(summary.tourSlug),
        red: board?.red,
        black: board?.black,
        moves: board?.moves ?? [],
      });
    }
    return { player, names, boards };
  } finally {
    await db.close();
  }
}

async function prepareGame(board, { directory, engine, budgets, dbUrl }) {
  const key = keyFor(board);
  const work = join(directory, 'work', key);
  await mkdir(work, { recursive: true });
  const game = {
    key,
    title: `${board.boardId}: ${board.result}`,
    // English for the study's own tags; the Chinese name serves its zh locales.
    event: board.tourNameEn || board.tourName,
    eventZh: board.tourName,
    date: board.playedOn ?? '',
    result: board.result,
    red: board.red.name,
    black: board.black.name,
    sourceUrl: board.sourceUrl,
    moves: board.moves,
    plies: board.moves.length,
  };
  const input = join(work, 'game.json');
  const annotated = join(work, 'annotated.json');
  await save(input, game);
  const env = {
    DATABASE_URL: dbUrl,
    MISTBOARD_PIKAFISH_XIANGQI_PATH: engine.binary,
    MISTBOARD_PIKAFISH_XIANGQI_NET: engine.net,
  };
  await runLocalScript(
    'scripts/annotate-game.mjs',
    [input, '--nodes', String(budgets.annotationNodes), '--json', annotated],
    { env },
  );
  const games = join(work, 'miner-input.json');
  await save(games, {
    games: [
      {
        id: `kit_${key}`,
        moves: board.moves,
        meta: {
          event: board.tourName,
          playedOn: board.playedOn,
          result: board.result,
          redName: board.red.name,
          blackName: board.black.name,
          sourceSlug: /(?:^|\.)dpxq\.com$/i.test(
            new URL(board.sourceUrl ?? 'http://localhost').hostname,
          )
            ? 'dpxq'
            : null,
          sourceUrl: board.sourceUrl,
          sourceGameId: board.boardId,
        },
      },
    ],
  });
  const mined = join(work, 'mined.json');
  await rm(mined, { force: true });
  const stdout = await runLocalScript(
    'scripts/variant-lab/xiangqi-puzzle-miner.ts',
    [
      '--source',
      'json',
      '--games',
      games,
      '--limit',
      '1',
      '--ply-min',
      '0',
      '--concurrency',
      '1',
      '--scan-nodes',
      String(budgets.scanNodes),
      '--verify-nodes',
      String(budgets.verifyNodes),
      '--verify-depth',
      String(budgets.verifyDepth),
      '--per-game',
      '3',
      '--binary',
      engine.binary,
      '--net',
      engine.net,
      '--jsonl',
      join(work, 'mining.jsonl'),
      '--emit-seed',
      '--seed-path',
      mined,
    ],
    { env },
  );
  const metrics = JSON.parse(stdout.trim().split('\n').at(-1));
  await save(join(work, 'metrics.json'), metrics);
  if (metrics.games.failed || metrics.games.illegalReplayTruncated || metrics.games.scanned !== 1)
    throw new Error('miner could not replay the full record');
  return { annotation: await json(annotated), puzzles: (await json(mined)).puzzles };
}

async function buildStudy({ directory, player, names, annotations, selected = false }) {
  const work = join(directory, selected ? 'selected-study' : 'draft-study');
  // Input set must exactly match this run, including after a smaller rerun.
  await rm(work, { recursive: true, force: true });
  await mkdir(join(work, 'annotations'), { recursive: true });
  for (const { board, annotation } of annotations)
    await save(join(work, 'annotations', `${keyFor(board)}.json`), annotation);
  const namesPath = join(work, 'names.json');
  await save(namesPath, names);
  const path = join(work, 'plan.json');
  // The draft is what a partner opens, so it carries reader-facing copy.
  const english = names[player.name] || player.name;
  const events = [
    ...new Set(annotations.map(({ annotation }) => annotation.game?.event).filter(Boolean)),
  ];
  const from =
    events.length === 1
      ? `the ${events[0]}`
      : events.length === 2
        ? `the ${events[0]} and the ${events[1]}`
        : `${events.length} events`;
  await runLocalScript('scripts/player-study.mjs', [
    '--dir',
    join(work, 'annotations'),
    '--names',
    namesPath,
    '--player',
    player.name,
    '--name',
    `${english}: annotated games`,
    '--description',
    `${english}'s games from ${from}, with Pikafish analysis.`,
    '--plan',
    path,
  ]);
  return json(path);
}

async function findMoments({ annotations, names, engine, budgets }) {
  const { PikafishEngine } = await import('../variant-lab/xiangqi-pikafish-uci.ts');
  let session;
  try {
    return await findCriticalMoments({
      annotations,
      names,
      budgets,
      analyzeMoves: async (moves, limits, multipv) => {
        if (!session) {
          session = new PikafishEngine(engine.binary, engine.net);
          await session.init();
          await session.newGame();
        }
        return session.analyzeMoves(moves, limits, multipv);
      },
    });
  } finally {
    session?.kill();
  }
}

export async function publishLocal({ dbUrl, plan, puzzles }) {
  assertLocalDatabase(dbUrl);
  const { validateStandardXiangqiPuzzle } = await import('../../packages/game/src/index.ts');
  for (const puzzle of puzzles) {
    if (puzzle.variant !== 'xiangqi' || !validateStandardXiangqiPuzzle(puzzle).ok)
      throw new Error('invalid candidate puzzle');
  }
  const edit = await import('../../apps/server/src/study-edit-cli.ts');
  if (plan) {
    const checked = edit.checkCreate(plan.create);
    edit.checkPlan(checked.study, plan);
  }
  const db = await import('../../apps/server/src/persistence-db.ts');
  const { deleteStudy } = await import('../../apps/server/src/persistence-studies.ts');
  db.init(dbUrl, { maxPoolConnections: 2, statementTimeoutMs: 30_000 });
  let created;
  try {
    if (plan) {
      created = await edit.applyCreate(plan.create);
      await edit.applyPlan(created, plan);
    }
    await db.withTransaction(async (client) => {
      // A candidate must never overwrite an existing seed or someone else's
      // tagged puzzle merely because the miner generated the same id.
      const { rows } = await client.query('SELECT COALESCE(max(seq)+1,0)::int AS seq FROM puzzles');
      let seq = rows[0].seq;
      for (const puzzle of puzzles) {
        const inserted = await client.query(
          `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, mined_at)
          VALUES ($1,'xiangqi',$2,$3,$4,$5,$6,$7,'mined',now()) ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            puzzle.id,
            puzzle.title,
            seq++,
            puzzle.goal.type,
            puzzle.themes,
            puzzle.solution.length,
            JSON.stringify(puzzle),
          ],
        );
        if (!inserted.rowCount)
          throw new Error('puzzle id already exists; select a different candidate');
      }
    });
    return { studyId: created?.id ?? null, puzzleIds: puzzles.map((p) => p.id) };
  } catch (error) {
    if (created) await deleteStudy(created.id, created.ownerId);
    throw error;
  } finally {
    await db.close();
  }
}

export const localKitServices = {
  loadPlayer,
  engine: pinnedEngine,
  prepareGame,
  findMoments,
  buildStudy,
  publish: publishLocal,
};
