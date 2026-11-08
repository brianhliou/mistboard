#!/usr/bin/env node
// Read-only data for #969. No engines run and no analysis is generated.
// npm run prod:db -- node scripts/fog-sendoff-stats.mjs [--out <new-file>]
// Requires Node's native TypeScript support and the prepared workspace packages.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  countedAccountSeat,
  countedHumanGame,
  countedPlayerSeat,
  seatWonGame,
} from '../apps/server/src/persistence-counted-games.ts';

export const VARIANTS = ['dark-chess', 'dark-xiangqi'];

// Exact mirror of loadMistyLosses' bot predicate, pinned to its source by the
// test. That module imports the server's .js graph and cannot be loaded by this
// source-only node CLI. Deliberately NOT every bot or every engine-version seat.
export const FOG_MISTY_BOT_SEAT = `((b.subject_type = 'bot' AND b.subject_id IN ('misty', 'misty-dark-chess'))
         OR (b.subject_type = 'engine-version' AND b.subject_id LIKE 'python-v2%'))`;

const COUNTED = `WITH counted AS MATERIALIZED (
  SELECT g.room_id, g.ended_at, g.mode, g.result, g.ply_count
  FROM games g WHERE g.variant = $1 AND ${countedHumanGame('g')}
)`;

const BOT_GAMES = `${COUNTED}, bot_games AS MATERIALIZED (
  SELECT g.*, h.color AS human_color, h.subject_type AS human_type,
    h.subject_id AS human_id, b.engine_version,
    ${seatWonGame('h', 'g')} AS human_won,
    ${seatWonGame('b', 'g')} AS bot_won
  FROM counted g
  JOIN game_participants b ON b.game_id = g.room_id
  JOIN game_participants h ON h.game_id = g.room_id AND h.color <> b.color
  WHERE g.mode = 'pve' AND h.subject_type IN ('user', 'guest')
    AND ${FOG_MISTY_BOT_SEAT}
)`;

const COUNTS = `count(*) AS total,
  count(*) FILTER (WHERE mode = 'pve') AS pve,
  count(*) FILTER (WHERE mode = 'pvp') AS pvp`;

function count(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid count');
  return n;
}

function iso(value) {
  return value == null ? null : new Date(value).toISOString();
}

function gameCounts(row) {
  return { total: count(row.total), pve: count(row.pve), pvp: count(row.pvp) };
}

function outcomes(row) {
  const wins = count(row.wins);
  const draws = count(row.draws);
  const losses = count(row.losses);
  const total = count(row.total);
  return { total, wins, draws, losses, unclassified: total - wins - draws - losses };
}

/** Stable, explicit output allowlist: never serialize participant rows wholesale. */
export function shapeVariantReport(variant, rows) {
  const overall = rows.outcomes.find((r) => r.overall);
  return {
    variant,
    firstGameAt: iso(rows.summary.first_game_at),
    lastGameAt: iso(rows.summary.last_game_at),
    countedHumanGames: gameCounts(rows.summary),
    gamesPerMonth: rows.months.map((r) => ({ month: r.month, ...gameCounts(r) })),
    distinctPlayers: count(rows.players.players),
    distinctAccounts: count(rows.players.accounts),
    botResults: {
      ...outcomes(overall),
      byEngineVersion: rows.outcomes
        .filter((r) => !r.overall)
        .map((r) => ({ engineVersion: r.engine_version, ...outcomes(r) })),
    },
    accountsWhoBeatBot: rows.winners.map((r) => ({
      handle: r.handle,
      displayName: r.display_name,
      wins: count(r.wins),
      firstWinAt: iso(r.first_win_at),
    })),
    mostActiveAccounts: rows.active.map((r) => ({ handle: r.handle, games: count(r.games) })),
    bestGameCandidates: rankCandidates(variant, rows.wins),
  };
}

/** Stored misty-analysis blob: white-POV cp; budget.mistakes includes fog errors.
 * Missing/partial evals are never treated as a clean game. Only a complete
 * cursor series (0..ply_count) can support a comeback ranking. Mate/null scores
 * break a cp segment rather than becoming invented +/- mate centipawns. */
export function analysisMetrics(row) {
  const blob = row.analysis;
  const plies = blob?.plies;
  if (!Array.isArray(plies) || plies.length !== count(row.ply_count) + 1) return null;
  const sorted = [...plies].sort((a, b) => a.ply - b.ply);
  if (sorted.some((p, i) => p.ply !== i)) return null;
  if (!sorted.some((p) => Number.isFinite(p.cp) && p.mate == null)) return null;
  const mistakes = blob.seats?.[row.human_color]?.budget?.mistakes;
  const sign = row.human_color === 'white' ? 1 : -1;
  let trough = null;
  let swing = 0;
  for (const p of sorted) {
    if (!Number.isFinite(p.cp) || p.mate != null) {
      trough = null;
      continue;
    }
    const cp = p.cp * sign;
    trough = trough === null ? cp : Math.min(trough, cp);
    // Recovery from a prior disadvantage; a lead growing is not a comeback.
    if (trough < 0) swing = Math.max(swing, cp - trough);
  }
  return {
    mistakes: Number.isSafeInteger(mistakes) && mistakes >= 0 ? mistakes : null,
    comebackCp: swing,
    engineId: row.analysis_engine_id,
    depth: row.analysis_depth,
  };
}

/** Round-robin the three Fog Chess categories so long games cannot crowd out
 * clean wins/comebacks. Xiangqi reserves a slot for the earliest win, then takes
 * the longest wins. All dates refer to game completion; ties use room id. */
export function rankCandidates(variant, rows) {
  if (!VARIANTS.includes(variant)) throw new Error('unsupported variant');
  const tie = (a, b) =>
    iso(a.ended_at).localeCompare(iso(b.ended_at)) || a.room_id.localeCompare(b.room_id);
  const longest = [...rows].sort((a, b) => b.ply_count - a.ply_count || tie(a, b));
  const queues = [];
  if (variant === 'dark-xiangqi') {
    queues.push({
      rows: [...rows].sort(tie).slice(0, 1),
      reason: () => 'First counted human win against the fog bot',
    });
  } else {
    const analyzed = rows.map((r) => ({ ...r, metrics: analysisMetrics(r) }));
    queues.push({
      rows: analyzed
        .filter((r) => r.metrics?.mistakes != null)
        .sort(
          (a, b) =>
            a.metrics.mistakes - b.metrics.mistakes || b.ply_count - a.ply_count || tie(a, b),
        ),
      reason: (r) => `Fewest stored human mistakes: ${r.metrics.mistakes}`,
    });
    queues.push({
      rows: analyzed
        .filter((r) => r.metrics?.comebackCp > 0)
        .sort((a, b) => b.metrics.comebackCp - a.metrics.comebackCp || tie(a, b)),
      reason: (r) =>
        `Comeback: ${r.metrics.comebackCp} cp recovery from a prior disadvantage (human POV)`,
    });
  }
  queues.push({ rows: longest, reason: (r) => `Long human win: ${r.ply_count} plies` });
  const selected = new Map();
  // Consume one NEW room from each category per round, recording overlapping
  // reasons as encountered. At the cap, still collect reasons for chosen rooms.
  while (queues.some((q) => q.rows.length > 0)) {
    for (const queue of queues) {
      while (queue.rows.length > 0) {
        const row = queue.rows.shift();
        const existing = selected.get(row.room_id);
        if (existing) {
          existing.reasons.push(queue.reason(row));
          continue;
        }
        if (selected.size === 12) continue;
        const metrics = row.metrics ?? analysisMetrics(row);
        selected.set(row.room_id, {
          roomId: row.room_id,
          endedAt: iso(row.ended_at),
          plyCount: count(row.ply_count),
          reasons: [queue.reason(row)],
          ...(metrics ? { analysis: metrics } : {}),
        });
        break;
      }
    }
  }
  return [...selected.values()];
}

async function loadVariant(client, variant) {
  const read = async (sql) => (await client.query(sql, [variant])).rows;
  const [summary] = await read(`${COUNTED}
    SELECT min(ended_at) AS first_game_at, max(ended_at) AS last_game_at, ${COUNTS} FROM counted`);
  const months = await read(`${COUNTED}
    SELECT to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, ${COUNTS}
    FROM counted GROUP BY 1 ORDER BY 1`);
  const [players] = await read(`${COUNTED}
    SELECT count(DISTINCT (p.subject_type, p.subject_id)) AS players,
      count(DISTINCT p.subject_id) FILTER (WHERE p.subject_type = 'user') AS accounts
    FROM counted g JOIN game_participants p ON p.game_id = g.room_id
    WHERE ${countedPlayerSeat('p')}`);
  const results = await read(`${BOT_GAMES}
    SELECT GROUPING(engine_version) = 1 AS overall, engine_version,
      count(*) AS total, count(*) FILTER (WHERE human_won) AS wins,
      count(*) FILTER (WHERE result = 'draw') AS draws,
      count(*) FILTER (WHERE bot_won) AS losses
    FROM bot_games GROUP BY GROUPING SETS ((), (engine_version))
    ORDER BY overall DESC, engine_version NULLS FIRST`);
  const winners = await read(`${BOT_GAMES}
    SELECT u.handle, u.display_name, count(DISTINCT g.room_id) AS wins, min(g.ended_at) AS first_win_at
    FROM bot_games g JOIN game_participants p
      ON p.game_id = g.room_id AND p.color = g.human_color
    JOIN users u ON u.id = p.subject_id
    WHERE g.human_won AND ${countedAccountSeat('p')}
    GROUP BY u.id, u.handle, u.display_name ORDER BY wins DESC, first_win_at, u.handle`);
  const active = await read(`${COUNTED}
    SELECT u.handle, count(DISTINCT g.room_id) AS games
    FROM counted g JOIN game_participants p ON p.game_id = g.room_id
    JOIN users u ON u.id = p.subject_id WHERE ${countedAccountSeat('p')}
    GROUP BY u.id, u.handle ORDER BY games DESC, u.handle LIMIT 10`);
  const wins = await read(`${BOT_GAMES}
    SELECT g.room_id, g.ended_at, g.ply_count, g.human_color,
      a.engine_id AS analysis_engine_id, a.depth AS analysis_depth, a.plies AS analysis
    FROM bot_games g LEFT JOIN LATERAL (
      SELECT engine_id, depth, plies FROM game_analysis
      WHERE $1 = 'dark-chess' AND room_id = g.room_id
        AND engine_id LIKE 'misty-analysis@%' AND engine_id NOT LIKE '%!progress'
      ORDER BY depth DESC, created_at DESC, engine_id DESC LIMIT 1
    ) a ON TRUE WHERE g.human_won ORDER BY g.ended_at, g.room_id`);
  return shapeVariantReport(variant, {
    summary,
    months,
    players,
    outcomes: results,
    winners,
    active,
    wins,
  });
}

/** One connection and one consistent read-only snapshot for every figure. */
export async function collectReport(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    const { rows } = await client.query('SELECT CURRENT_TIMESTAMP AS as_of');
    const variants = [];
    for (const variant of VARIANTS) variants.push(await loadVariant(client, variant));
    return {
      version: 1,
      asOf: iso(rows[0].as_of),
      definitions: {
        games: 'countedHumanGame; dates and calendar months use ended_at in UTC',
        players:
          'countedPlayerSeat; distinct (subject_type, subject_id); accounts and guest browsers may overlap in real life; legacy guests without ids are not distinct players',
        botResults:
          'Human POV; counted PvE vs fog Misty seats, including legacy python-v2 engine-version seats; anonymous legacy human seats still count',
        engineVersion:
          'Stored game_participants.engine_version; null means unrecorded, including legacy seats (no version inferred)',
        candidates:
          'Counted human wins vs fog bot only; no new analysis. Fog Chess uses deepest, then newest final misty-analysis cache; fewest mistakes uses human seat budget.mistakes (fog errors included), comeback uses complete white-POV cp track normalized to the human. Longest wins may lack analysis. Fog Xiangqi includes first win and longest wins.',
        months: 'Months with no counted games between first and last are omitted',
      },
      variants,
    };
  } finally {
    // ROLLBACK even on success: this tool never has anything to commit.
    await client.query('ROLLBACK');
  }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log(
      'Usage: npm run prod:db -- node scripts/fog-sendoff-stats.mjs [--out <new-file>]\nRead-only JSON report; defaults to stdout. --out refuses to overwrite a file.',
    );
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('database required');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
    // Defense in depth: even the first statement starts on a read-only session.
    options: '-c default_transaction_read_only=on',
  });
  let report;
  try {
    const client = await pool.connect();
    try {
      report = await collectReport(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, json, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Errors may contain connection strings or row data. Never print them.
    console.error(
      'Fog send-off report failed; check --help, DATABASE_URL access, prepared workspace packages, and that --out is a new writable file.',
    );
    process.exitCode = 1;
  });
}
