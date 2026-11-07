#!/usr/bin/env node
// Read-only check that every broadcast round with games shows a date in its
// round menu. The menu reads each round's `startedAt` (its games' dates over
// the seeded guess, `xiangqiBroadcastRoundStart`), so a round with boards and
// no date anywhere is a blank menu line: the 2026 leagues from round 10 were,
// because results-only boards carried no date until the poller read the
// round page's 比赛时间. Exits 1 on an undated round; a seed whose day
// disagrees with the games is printed but does not fail (the games win).
//
//   node scripts/broadcast-round-dates.mjs [--base https://mistboard.com]
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** The day a timestamp states, in its own offset: `2026-10-28T13:00:00+08:00` → `2026-10-28`. */
function statedDay(value) {
  return /^\d{4}-\d{2}-\d{2}/.exec(value ?? '')?.[0];
}

/**
 * Findings for one tour's rounds as the public tour payload lists them.
 * `undated`: a round with boards and no date to show. `seed-day`: the seeded
 * start names another day than the games, so the seed script's guess was off.
 */
export function roundDateFindings(tourSlug, rounds) {
  const findings = [];
  for (const round of rounds ?? []) {
    if (!round.boardCount) continue;
    const shown = round.startedAt ?? round.startsAt;
    if (!shown) {
      findings.push({ kind: 'undated', tourSlug, roundId: round.id, boards: round.boardCount });
      continue;
    }
    const seededDay = statedDay(round.startsAt);
    const playedDay = statedDay(round.startedAt);
    if (seededDay && playedDay && seededDay !== playedDay) {
      findings.push({
        kind: 'seed-day',
        tourSlug,
        roundId: round.id,
        seeded: round.startsAt,
        played: round.startedAt,
      });
    }
  }
  return findings;
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function main() {
  const { values } = parseArgs({ options: { base: { type: 'string' } } });
  const base = (values.base ?? 'https://mistboard.com').replace(/\/$/, '');
  const index = await getJson(`${base}/api/xiangqi/broadcasts`);
  const slugs = [...new Set((index.tours ?? []).map((entry) => entry.tour?.slug).filter(Boolean))];
  if (slugs.length === 0) throw new Error('the broadcast index listed no tours');
  const findings = [];
  for (const slug of slugs) {
    const tour = await getJson(`${base}/api/xiangqi/broadcasts/${encodeURIComponent(slug)}`);
    findings.push(...roundDateFindings(slug, tour.rounds));
  }
  const undated = findings.filter((f) => f.kind === 'undated');
  const seedDay = findings.filter((f) => f.kind === 'seed-day');
  console.log(
    `${slugs.length} tours: ${undated.length} undated rounds, ${seedDay.length} seeds a day off`,
  );
  for (const f of undated) console.log(`undated  ${f.tourSlug} ${f.roundId} (${f.boards} boards)`);
  for (const f of seedDay)
    console.log(`seed-day ${f.tourSlug} ${f.roundId} seeded ${f.seeded}, played ${f.played}`);
  if (undated.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
