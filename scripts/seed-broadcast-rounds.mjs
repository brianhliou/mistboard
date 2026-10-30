#!/usr/bin/env node
// Generate a canonical xiangqi broadcast fixture pack containing a tour and its
// rounds, with no boards yet.
//
// Two things need the rounds to exist before any moves arrive:
//   - the calendar view, which lists tours and rounds by startsAt;
//   - the discovery adapter, which resolves each poll's round from
//     xiangqi_broadcast_rounds.starts_at instead of making an operator pin the
//     round by hand every round. See docs-private/broadcast-discovery-adapter-spec.md.
//
// Output is a fixture directory the existing importer already understands:
//   node scripts/seed-broadcast-rounds.mjs --tour-slug 2026-xiangqi-league \
//     --tour-name "2026 China Xiangqi League" --location Hangzhou \
//     --start 2026-10-08 --end 2026-10-18 --rounds 18 \
//     --round-times 14:30,19:30 --tz +08:00 --out /tmp/league-seed
//   npm run db:import:xiangqi-broadcast -- --dir /tmp/league-seed
//
// Every emitted record is checked with the same validators the importer runs,
// so a pack that would be rejected at ingestion fails here instead.
//
// A seeded startsAt is a guess made before the event: it orders the calendar
// and finds the poll's round, but once a round has games their own dates win
// on every page (xiangqiBroadcastRoundStart). Round days slip; the 2026 league
// seeded rounds 2-5 one and two days late. After an event, audit with
// `node scripts/broadcast-round-dates.mjs` (read-only; exits 1 on a round with
// games and no date to show).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  validateXiangqiBroadcastRound,
  validateXiangqiBroadcastTour,
} from '../packages/game/dist/xiangqi-broadcast.js';

const SCHEMA = 'mistboard.xiangqi.broadcast.v1';

function parseArgs(argv) {
  const args = {
    tourSlug: null,
    tourName: null,
    location: null,
    start: null,
    end: null,
    rounds: 0,
    roundTimes: ['14:30'],
    tz: '+08:00',
    roundLabel: 'Round',
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tour-slug') args.tourSlug = argv[++i];
    else if (arg === '--tour-name') args.tourName = argv[++i];
    else if (arg === '--location') args.location = argv[++i];
    else if (arg === '--start') args.start = argv[++i];
    else if (arg === '--end') args.end = argv[++i];
    else if (arg === '--rounds') args.rounds = Number(argv[++i]);
    else if (arg === '--round-times') args.roundTimes = argv[++i].split(',').map((t) => t.trim());
    else if (arg === '--tz') args.tz = argv[++i];
    else if (arg === '--round-label') args.roundLabel = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  console.log(`Usage: node scripts/seed-broadcast-rounds.mjs --tour-slug <slug> --tour-name <name> \\
         --start <YYYY-MM-DD> --end <YYYY-MM-DD> --rounds <n> --out <dir>

  --location      venue, e.g. Hangzhou
  --round-times   comma-separated local start times per day (default 14:30).
                  Rounds fill days in order, one per listed time.
  --tz            UTC offset the times are in (default +08:00, China).
  --round-label   round name prefix (default "Round")
  --out           directory to write tour.json, rounds.json, boards.json

Dates are only as good as the published regulations. Approximate starts are
fine: round resolution matches within a window, not to the minute.
`);
}

function eachDay(startIso, endIso) {
  const days = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error(`--start is not a date: ${startIso}`);
  if (Number.isNaN(end.getTime())) throw new Error(`--end is not a date: ${endIso}`);
  if (end < start) throw new Error('--end is before --start');
  for (let day = start; day <= end; day = new Date(day.getTime() + 86400000)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

function buildRounds(args) {
  const days = eachDay(args.start, args.end);
  const capacity = days.length * args.roundTimes.length;
  if (args.rounds > capacity) {
    throw new Error(
      `${args.rounds} rounds do not fit in ${days.length} day(s) at ${args.roundTimes.length} round(s) per day (capacity ${capacity}). Widen the dates or add a --round-times entry.`,
    );
  }

  const rounds = [];
  outer: for (const day of days) {
    for (const time of args.roundTimes) {
      if (rounds.length >= args.rounds) break outer;
      const number = rounds.length + 1;
      const padded = String(number).padStart(2, '0');
      rounds.push({
        schema: SCHEMA,
        id: `${args.tourSlug}-r${padded}`,
        tourSlug: args.tourSlug,
        name: `${args.roundLabel} ${number}`,
        startsAt: `${day}T${time}:00${args.tz}`,
      });
    }
  }
  return rounds;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const missing = ['tourSlug', 'tourName', 'start', 'end', 'out'].filter((key) => !args[key]);
  if (missing.length > 0 || args.rounds < 1) {
    usage();
    console.error(
      `missing or invalid: ${[...missing, ...(args.rounds < 1 ? ['rounds'] : [])].join(', ')}`,
    );
    process.exit(1);
  }

  const tour = {
    schema: SCHEMA,
    slug: args.tourSlug,
    name: args.tourName,
    startsAt: `${args.start}T00:00:00${args.tz}`,
    endsAt: `${args.end}T23:59:59${args.tz}`,
    ...(args.location ? { location: args.location } : {}),
  };
  const rounds = buildRounds(args);

  // Validate with the importer's own validators rather than a parallel copy.
  // A pack that would be refused at ingestion should fail here, where the fix
  // is cheap, instead of against a production database.
  const tourCheck = validateXiangqiBroadcastTour(tour);
  if (!tourCheck.ok) {
    console.error(`tour is invalid:\n  ${tourCheck.errors.join('\n  ')}`);
    process.exit(2);
  }
  for (const round of rounds) {
    const check = validateXiangqiBroadcastRound(round);
    if (!check.ok) {
      console.error(`round ${round.id} is invalid:\n  ${check.errors.join('\n  ')}`);
      process.exit(2);
    }
  }

  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'tour.json'), `${JSON.stringify(tour, null, 2)}\n`);
  await writeFile(join(args.out, 'rounds.json'), `${JSON.stringify(rounds, null, 2)}\n`);
  await writeFile(join(args.out, 'boards.json'), '[]\n');

  console.log(`wrote ${args.out}`);
  console.log(`  tour   ${tour.slug}  ${tour.name}`);
  console.log(
    `  rounds ${rounds.length}  ${rounds[0].startsAt} .. ${rounds[rounds.length - 1].startsAt}`,
  );
  console.log(`  boards 0 (filled by the poller once the event starts)`);
  console.log(`\nimport with:\n  npm run db:import:xiangqi-broadcast -- --dir ${args.out}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
