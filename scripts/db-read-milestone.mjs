#!/usr/bin/env node
// Read-only: the committed record behind a games-played milestone post. SELECTs
// only (the `db-read-` prefix is the contract in .claude/settings.local.json);
// the one thing written is the local --out file. Run it through tsx so the
// filter comes from persistence-counted-games.ts instead of a second spelling:
//
//   npm run prod:db -- npx tsx scripts/db-read-milestone.mjs \
//     --countries <n> --both-sides <n> --across-borders <n> \
//     --out apps/web/src/articles/content/ten-thousand-games-record.json
//
// Those three are required and come from PostHog (project 413256), which this
// script cannot read, so a refresh cannot carry an old number forward unseen.
// --countries:
//
//   SELECT count(DISTINCT properties.$geoip_country_name) FROM events
//   WHERE event = 'game_started' AND timestamp >= '2026-06-01'
//     AND properties.is_internal IS NULL AND properties.$geoip_country_name IS NOT NULL
//
// --both-sides is the games between people where two people were seen, and
// --across-borders is those with two countries. --list-people-games prints the
// room ids and stops; put them in the IN list here:
//
//   SELECT seats, countries, count() FROM (
//     SELECT properties.gameId AS g, uniq(person_id) AS seats,
//            uniq(properties.$geoip_country_name) AS countries
//     FROM events WHERE event IN ('game_started', 'game_finished')
//       AND timestamp >= '2026-06-01' AND properties.gameId IN (<ids>)
//     GROUP BY g) GROUP BY seats, countries
//
// /api/stats/public is the public figure and the database adds what that
// endpoint cannot say: how many people the games came from. The two reads are
// held to each other, and a disagreement writes nothing, so a record cannot
// come from a filter that has drifted away from /stats.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  countedPlayerSeat,
  countedPublicGame,
} from '../apps/server/src/persistence-counted-games.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    countries: { type: 'string' },
    'both-sides': { type: 'string' },
    'across-borders': { type: 'string' },
    'list-people-games': { type: 'boolean', default: false },
    api: { type: 'string', default: 'https://mistboard.com/api/stats/public' },
    tolerance: { type: 'string', default: '25' },
  },
});

const countriesAndRegions = Number(values.countries);
const gamesSeenFromBothSides = Number(values['both-sides']);
const gamesAcrossBorders = Number(values['across-borders']);
if (
  !values['list-people-games'] &&
  (!Number.isInteger(countriesAndRegions) ||
    countriesAndRegions < 1 ||
    !values['both-sides'] ||
    !values['across-borders'] ||
    !Number.isInteger(gamesSeenFromBothSides) ||
    !Number.isInteger(gamesAcrossBorders))
) {
  console.error(
    '--countries, --both-sides and --across-borders are required: run the PostHog queries in the header',
  );
  process.exit(2);
}

const stats = await (await fetch(values.api)).json();

// The first day the running total reached a mark, from the public daily series.
function firstDayAtLeast(daily, mark) {
  return daily.find((d) => d.cumulativeGames >= mark)?.date ?? null;
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});
await client.connect();
await client.query('SET default_transaction_read_only = on');
await client.query("SET statement_timeout = '60s'");

if (values['list-people-games']) {
  const { rows } = await client.query(
    `SELECT g.room_id FROM games g WHERE ${countedPublicGame('g')} AND g.mode = 'pvp'`,
  );
  console.log(rows.map((r) => `'${r.room_id}'`).join(','));
  await client.end();
  process.exit(0);
}

const { rows: seats } = await client.query(`
  SELECT g.room_id, p.subject_type || ':' || p.subject_id AS player, g.ended_at
  FROM games g
  JOIN game_participants p ON p.game_id = g.room_id
  WHERE ${countedPublicGame('g')} AND ${countedPlayerSeat('p')}`);
const {
  rows: [{ count: dbTotal }],
} = await client.query(
  `SELECT count(*)::int AS count FROM games g WHERE ${countedPublicGame('g')}`,
);
// A win against a bot: the game has a winner, and it is not the bot's colour.
const {
  rows: [{ count: gamesWonAgainstBots }],
} = await client.query(`
  SELECT count(DISTINCT g.room_id)::int AS count
  FROM games g
  JOIN game_participants b ON b.game_id = g.room_id AND b.subject_type NOT IN ('user', 'guest')
  WHERE ${countedPublicGame('g')} AND g.mode = 'pve'
    AND g.result LIKE '%-wins' AND g.result NOT LIKE b.color || '-%'`);
// Each first-party bot in each variant, by its stable id: a display name has
// changed over time, and `pikafish` is two bots, the top jieqi level and the
// xiangqi bot.
const { rows: bots } = await client.query(`
  SELECT b.subject_id AS bot, g.variant, count(*)::int AS games,
         count(*) FILTER (
           WHERE g.result LIKE '%-wins' AND g.result NOT LIKE b.color || '-%'
         )::int AS "peopleWon"
  FROM games g
  JOIN game_participants b ON b.game_id = g.room_id AND b.subject_type = 'bot'
  WHERE ${countedPublicGame('g')} AND g.mode = 'pve'
  GROUP BY 1, 2 ORDER BY 3 DESC`);
const { rows: endings } = await client.query(`
  SELECT g.termination AS ending, count(*)::int AS games,
         round(avg(g.ply_count))::int AS "averagePlies",
         count(*) FILTER (WHERE g.result = 'draw')::int AS draws
  FROM games g
  WHERE ${countedPublicGame('g')}
  GROUP BY 1 ORDER BY 2 DESC`);
await client.end();

const drift = Math.abs(dbTotal - stats.totalCompletedGames);
if (drift > Number(values.tolerance)) {
  console.error(
    `refusing to write: database ${dbTotal}, /api/stats/public ${stats.totalCompletedGames}`,
  );
  process.exit(2);
}

const gamesByPlayer = new Map();
for (const { room_id, player } of seats) {
  if (!gamesByPlayer.has(player)) gamesByPlayer.set(player, new Set());
  gamesByPlayer.get(player).add(room_id);
}
const ranked = [...gamesByPlayer.values()].sort((a, b) => b.size - a.size);
const regulars = ranked.filter((g) => g.size >= 100);

const weeks = stats.weeklyCompletedGames.map((w) => ({
  weekStart: w.weekStart,
  games: w.completedGames,
}));
const fullWeeks = weeks.slice(0, -1);
const peak = fullWeeks.reduce((best, w) => (w.games > best.games ? w : best));
const inPeak = new Map();
const peakFrom = Date.parse(`${peak.weekStart}T00:00:00Z`);
for (const { room_id, player, ended_at } of seats) {
  const t = new Date(ended_at).getTime();
  if (t < peakFrom || t >= peakFrom + 7 * 86_400_000) continue;
  if (!inPeak.has(player)) inPeak.set(player, new Set());
  inPeak.get(player).add(room_id);
}

const record = {
  capturedAt: stats.generatedAt,
  totalGames: stats.totalCompletedGames,
  gamesAgainstBots: stats.modeTotals.pve,
  gamesWonAgainstBots,
  gamesBetweenPeople: stats.modeTotals.pvp,
  countriesAndRegions,
  gamesSeenFromBothSides,
  gamesAcrossBorders,
  bots,
  endings,
  accounts: stats.accounts,
  players: ranked.length,
  playersWithOneGame: ranked.filter((g) => g.size === 1).length,
  playersWithTenGames: ranked.filter((g) => g.size >= 10).length,
  playersWithHundredGames: regulars.length,
  mostGamesByOnePlayer: ranked[0]?.size ?? 0,
  gamesWithThosePlayers: new Set(regulars.flatMap((games) => [...games])).size,
  peakWeek: {
    ...peak,
    gamesByItsBusiestPlayer: Math.max(0, ...[...inPeak.values()].map((g) => g.size)),
  },
  // The first 1,000 games, kept so the comparison stays with its source instead
  // of being re-typed into prose. Jieqi is what that post printed. People games
  // are the 2026-11-05 recount with the deleted variants left out; the /stats
  // shot in that post showed 7, three of them guest test games in a deleted
  // variant.
  atOneThousand: { jieqiGames: 608, gamesBetweenPeople: 4 },
  firstThousandOn: firstDayAtLeast(stats.dailyCompletedGames, 1_000),
  tenThousandOn: firstDayAtLeast(stats.dailyCompletedGames, 10_000),
  weeks,
  variants: stats.variantTotals.map((v) => ({ variant: v.variant, games: v.count })),
};

const text = `${JSON.stringify(record, null, 2)}\n`;
if (values.out) writeFileSync(values.out, text);
else process.stdout.write(text);
console.error(`database ${dbTotal}, public ${stats.totalCompletedGames}, ${ranked.length} players`);
