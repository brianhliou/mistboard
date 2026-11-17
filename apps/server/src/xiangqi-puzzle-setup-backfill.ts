// Only the last recorded move leaves the local archive. Earlier moves are
// used for validation and never included in a plan, packet or database write.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  deriveXiangqiPuzzleSetupMove,
  readXiangqiPositionOnlyPuzzle,
  type XiangqiMove,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { close, getPool, init, withTransaction } from './persistence-db.js';

export type XiangqiSetupGame = { id: string; moves: XiangqiMove[] };

export function readXiangqiSetupGames(value: unknown): XiangqiSetupGame[] {
  const games = (value as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) throw new Error('Local input must contain games');
  const seen = new Set<string>();
  return games.map((game) => {
    if (!game || typeof game.id !== 'string' || seen.has(game.id) || !Array.isArray(game.moves))
      throw new Error('Local game needs a unique id and moves');
    seen.add(game.id);
    const moves = game.moves.map((move: unknown) => {
      const m = move as Partial<XiangqiMove> | null;
      if (
        !m ||
        typeof m.from !== 'string' ||
        typeof m.to !== 'string' ||
        !/^[a-i](?:[1-9]|10)$/.test(m.from) ||
        !/^[a-i](?:[1-9]|10)$/.test(m.to)
      )
        throw new Error('Invalid local game move');
      return { from: m.from, to: m.to } as XiangqiMove;
    });
    return { id: game.id, moves };
  });
}

/** Bind the id's game and ply to the exact board, using the same full-prefix
 * replay as hosted puzzles. Rebuild the credit-only shape before returning. */
export function withXiangqiPositionSetup(
  value: unknown,
  games: readonly XiangqiSetupGame[],
): XiangqiPuzzle {
  const puzzle = readXiangqiPositionOnlyPuzzle(value);
  const match = /^xq-mined-(dpxq-.+)-([1-9]\d*)$/.exec(puzzle.id);
  const game = match ? games.find((g) => g.id === match[1]) : undefined;
  const ply = match ? Number(match[2]) : 0;
  if (!game || !Number.isSafeInteger(ply) || !game.moves[ply - 1])
    throw new Error(`Missing local setup source for ${puzzle.id}`);
  const move = game.moves[ply - 1]!;
  const initial = { ...puzzle.initial, lastMove: { from: move.from, to: move.to } };
  const setupMove = deriveXiangqiPuzzleSetupMove(
    { initial, sourceGame: { gameId: game.id, ply } },
    game.moves,
  );
  if (!setupMove) throw new Error(`Local source disagrees with ${puzzle.id}`);
  if (puzzle.setupMove && JSON.stringify(puzzle.setupMove) !== JSON.stringify(setupMove))
    throw new Error(`Stored setup disagrees with ${puzzle.id}`);
  return readXiangqiPositionOnlyPuzzle({ ...puzzle, initial, setupMove });
}

export function planXiangqiPuzzleSetupBackfill(
  values: readonly unknown[],
  games: readonly XiangqiSetupGame[],
  expectedTotal: number,
) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 1 || values.length !== expectedTotal)
    throw new Error('Setup backfill count changed');
  const entries = values
    .map((value) => {
      const before = readXiangqiPositionOnlyPuzzle(value);
      return { before, after: withXiangqiPositionSetup(before, games) };
    })
    .sort((a, b) => a.after.id.localeCompare(b.after.id));
  if (new Set(entries.map((e) => e.after.id)).size !== entries.length)
    throw new Error('Setup backfill repeats a puzzle');
  // Hash the final states so the same reviewed command is also a safe no-op
  // after application. No earlier source move is part of this receipt.
  const sha256 = createHash('sha256')
    .update(JSON.stringify(entries.map((e) => e.after)))
    .digest('hex');
  return { total: entries.length, sha256, entries };
}

export async function applyXiangqiPuzzleSetupBackfill(input: {
  games: readonly XiangqiSetupGame[];
  expectedTotal: number;
  expectedSha256: string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256))
    throw new Error('Apply requires the exact dry-run hash');
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['mistboard:puzzle-seed-sync']);
    const result = await db.query<{ data: unknown }>(`${SETUP_ROWS} FOR UPDATE`);
    const plan = planXiangqiPuzzleSetupBackfill(
      result.rows.map((r) => r.data),
      input.games,
      input.expectedTotal,
    );
    if (plan.sha256 !== input.expectedSha256) throw new Error('Setup backfill hash changed');
    let updated = 0;
    for (const { before, after } of plan.entries) {
      if (before.setupMove) continue;
      const changed = await db.query(
        'UPDATE puzzles SET data=$2::json WHERE id=$1 AND position_only AND data::jsonb=$3::jsonb',
        [before.id, JSON.stringify(after), JSON.stringify(before)],
      );
      if (changed.rowCount !== 1) throw new Error('Setup backfill row changed');
      updated++;
    }
    return { total: plan.total, sha256: plan.sha256, updated };
  });
}

const SETUP_ROWS = `SELECT data FROM puzzles WHERE variant='xiangqi' AND position_only
  AND id LIKE 'xq-mined-dpxq-%' ORDER BY id`;

async function main() {
  const { values } = parseArgs({
    options: {
      games: { type: 'string' },
      'expect-total': { type: 'string' },
      'expect-sha256': { type: 'string' },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Dry run: --games LOCAL.json --expect-total 14\nApply: add --apply --expect-sha256 SHA\n',
    );
    return;
  }
  if (!values.games) throw new Error('--games is required');
  const games = readXiangqiSetupGames(JSON.parse(readFileSync(values.games, 'utf8')));
  const expectedTotal = Number(values['expect-total']);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  init(process.env.DATABASE_URL);
  try {
    if (values.apply) {
      const result = await applyXiangqiPuzzleSetupBackfill({
        games,
        expectedTotal,
        expectedSha256: values['expect-sha256'] ?? '',
      });
      process.stdout.write(`${JSON.stringify({ apply: true, ...result })}\n`);
    } else {
      const result = await getPool().query<{ data: unknown }>(SETUP_ROWS);
      const plan = planXiangqiPuzzleSetupBackfill(
        result.rows.map((r) => r.data),
        games,
        expectedTotal,
      );
      process.stdout.write(
        `${JSON.stringify({
          apply: false,
          total: plan.total,
          sha256: plan.sha256,
          updates: plan.entries
            .filter((e) => !e.before.setupMove)
            .map((e) => ({
              id: e.after.id,
              setupMove: e.after.setupMove,
            })),
        })}\n`,
      );
    }
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
