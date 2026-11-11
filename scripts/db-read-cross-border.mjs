#!/usr/bin/env node
// Read-only weekly games across borders (#902). SELECT only: the db-read-
// prefix is a contract. Import the public human-game filter through tsx;
// country is NOT games.region (that column describes deployment).
//
//   npm run prod:db -- npx tsx scripts/db-read-cross-border.mjs --list-games --weeks 8
//   npm run prod:db -- npx tsx scripts/db-read-cross-border.mjs --posthog-rows rows.json --weeks 8
//
// Weeks are Monday 00:00 UTC, by ended_at, including the partial current week.
// Both commands default to 8 weeks. Run them together against the same window.
// A session runs this query with its own PostHog tool (project 413256); this
// script has no PostHog read key or network client. Replace <game ids> with
// the parenthesized --list-games output. Do NOT restrict event timestamps to
// the finish window: a correspondence game may have started weeks earlier.
//
//   SELECT gameId, groupArray(tuple(person_id, country)) AS people
//   FROM (
//     SELECT properties.gameId AS gameId, person_id,
//            argMax(properties.$geoip_country_name, timestamp) AS country
//     FROM events
//     WHERE event IN ('game_started', 'game_finished')
//       AND properties.gameId IN <game ids>
//       AND person_id IS NOT NULL
//       AND properties.$geoip_country_name IS NOT NULL
//       AND properties.$geoip_country_name != ''
//     GROUP BY gameId, person_id
//   )
//   GROUP BY gameId
//   ORDER BY gameId
//   LIMIT 100000
//
// One row per game, with the latest nonempty country for each distinct person.
// argMax/groupArray: https://posthog.com/docs/sql/aggregations
// Save either [{"gameId":"room","people":[["person-a","Taiwan"],
// ["person-b","Vietnam"]]}] or the tool's {"columns":[...],"results":[...]}.
// If the query reaches LIMIT, increase it before saving: truncation undercounts.
// Exactly two distinct people with countries means both sides seen; more than
// two is ambiguous and excluded. Never infer two people from two countries.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const WEEK_MS = 7 * 86_400_000;

function monday(date) {
  const result = new Date(date);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid game date or read time');
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}

function windowFor(weeks, now) {
  if (!Number.isSafeInteger(weeks) || weeks < 1)
    throw new Error('--weeks must be a positive integer');
  const to = new Date(now);
  const from = new Date(monday(to).getTime() - (weeks - 1) * WEEK_MS);
  if (!Number.isFinite(from.getTime())) throw new Error('--weeks is out of range');
  return { from, to };
}

export function parsePosthogRows(value) {
  if (Array.isArray(value)) return value;
  if (value?.hasMore === true) throw new Error('PostHog results are truncated; export all rows');
  if (Array.isArray(value?.columns) && Array.isArray(value?.results)) {
    const gameIndex = value.columns.indexOf('gameId');
    const peopleIndex = value.columns.indexOf('people');
    if (gameIndex >= 0 && peopleIndex >= 0) {
      return value.results.map((row) => ({ gameId: row[gameIndex], people: row[peopleIndex] }));
    }
  }
  throw new Error('Expected PostHog rows with gameId and people; see the header query');
}

// games are already selected with countedPublicGame + pvp. This pure function
// joins only those room ids, never inflating the denominator with analytics.
export function weeklyCrossBorder(games, posthogRows, { weeks = 8, now }) {
  const { from, to } = windowFor(weeks, now);
  const countriesByGame = new Map();
  for (const row of posthogRows) {
    if (typeof row?.gameId !== 'string' || !Array.isArray(row.people)) {
      throw new Error('Each PostHog row needs gameId and a people array');
    }
    if (countriesByGame.has(row.gameId)) throw new Error('Duplicate PostHog gameId');
    const people = new Map();
    for (const pair of row.people) {
      if (!Array.isArray(pair) || pair.length !== 2)
        throw new Error('Expected [person_id, country]');
      const [person, country] = pair;
      if (
        typeof person === 'string' &&
        person.trim() &&
        typeof country === 'string' &&
        country.trim()
      ) {
        people.set(person, country.trim());
      }
    }
    countriesByGame.set(row.gameId, people);
  }

  const counts = Array.from({ length: weeks }, (_, i) => ({
    weekStart: new Date(from.getTime() + i * WEEK_MS).toISOString().slice(0, 10),
    gamesBetweenPeople: 0,
    gamesWithBothSidesSeen: 0,
    gamesAcrossBorders: 0,
  }));
  const seenGames = new Set();
  for (const { gameId, endedAt } of games) {
    if (seenGames.has(gameId)) throw new Error('Duplicate database gameId');
    seenGames.add(gameId);
    const ended = new Date(endedAt);
    const weekStart = monday(ended);
    if (ended < from || ended >= to) continue;
    const count = counts[(weekStart.getTime() - from.getTime()) / WEEK_MS];
    count.gamesBetweenPeople += 1;
    const people = countriesByGame.get(gameId);
    if (people?.size !== 2) continue;
    count.gamesWithBothSidesSeen += 1;
    if (new Set(people.values()).size === 2) count.gamesAcrossBorders += 1;
  }
  return counts;
}

async function loadGames({ from, to }) {
  // Lazy imports keep the pure counter usable by the plain node script runner.
  const [{ default: pg }, { countedPublicGame }] = await Promise.all([
    import('pg'),
    import('../apps/server/src/persistence-counted-games.ts'),
  ]);
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL required; run through npm run prod:db');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(
    new URL(process.env.DATABASE_URL).hostname,
  );
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: local ? false : { rejectUnauthorized: false },
    options: '-c default_transaction_read_only=on -c statement_timeout=60000',
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT g.room_id AS "gameId", g.ended_at AS "endedAt"
       FROM games g
       WHERE ${countedPublicGame('g')} AND g.mode = 'pvp'
         AND g.ended_at >= $1 AND g.ended_at < $2
       ORDER BY g.ended_at, g.room_id`,
      [from.toISOString(), to.toISOString()],
    );
    return rows;
  } finally {
    await client.end();
  }
}

export async function main(
  argv,
  { now = new Date(), readGames = loadGames, log = console.log } = {},
) {
  const { values } = parseArgs({
    args: argv,
    options: {
      weeks: { type: 'string', default: '8' },
      'list-games': { type: 'boolean', default: false },
      'posthog-rows': { type: 'string' },
    },
  });
  if (values['list-games'] === Boolean(values['posthog-rows'])) {
    throw new Error('Choose exactly one: --list-games or --posthog-rows <file.json>');
  }
  const weeks = Number(values.weeks);
  const window = windowFor(weeks, now);
  const posthogRows = values['posthog-rows']
    ? parsePosthogRows(JSON.parse(readFileSync(values['posthog-rows'], 'utf8')))
    : [];
  const games = await readGames(window);
  if (values['list-games']) {
    const ids = games.map(
      ({ gameId }) => `'${gameId.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`,
    );
    log(`(${ids.length ? ids.join(',') : 'NULL'})`);
    return;
  }
  log('Monday week (UTC)\tGames between people\tGames with both sides seen\tGames across borders');
  for (const week of weeklyCrossBorder(games, posthogRows, { weeks, now })) {
    log(
      [
        week.weekStart,
        week.gamesBetweenPeople,
        week.gamesWithBothSidesSeen,
        week.gamesAcrossBorders,
      ].join('\t'),
    );
  }
  log('A VPN or one person on two devices can distort this figure.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
