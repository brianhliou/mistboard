#!/usr/bin/env node
// Read and set a broadcast tour's `sourceUrl`. There is no UI for it: a tour is
// scaffolded by seed-broadcast-rounds.mjs and imported, and the field is only
// ever set if the fixture pack carried it.
//
//   node scripts/broadcast-source-url.mjs <tour-slug>              # show it, change nothing
//   node scripts/broadcast-source-url.mjs <tour-slug> --set <url>  # set the poll target
//   node scripts/broadcast-source-url.mjs <tour-slug> --clear      # unset it
//
// THIS IS A POLL TARGET, NOT A CREDIT, and confusing the two has already cost a
// prod write. `tour.sourceUrl` is what the poller re-anchors on every run, so it
// has to be something the poller can read: a dpxq page carrying move data, a
// manifest, or a discovery source. A dpxq TOUR INDEX page is none of those and
// is rejected as malformed on every poll; the 2026 Shanghai Cup was seeded with
// one (movelist_12524.html) and imported nothing for five days. For a dpxq tour
// the target is the discovery form, which reads that same index and files each
// game under the round its row states:
//
//   mistboard-discover://dpxq-tour?tour=12524&tourSlug=2026-shanghai-cup
//
// The visible credit is separate and automatic: broadcastRecordsCredit
// (apps/web/src/xiangqi-broadcast.ts) derives "Game records from <host>" from the
// per-board sourceUrls, and renders it on the round page. An archive-imported
// tour that never polls should leave this EMPTY and is credited regardless.
//
// Against production, hand the connection to Railway rather than putting it in
// your shell. The connection string is referenced by name inside the child and
// never enters this process or the terminal:
//
//   railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/broadcast-source-url.mjs \
//        2026-shanghai-cup --set "mistboard-discover://dpxq-tour?tour=12524&tourSlug=2026-shanghai-cup"'
//
// WHY BOTH COLUMNS. `tourFromRow` builds the tour by spreading `payload`, so the
// `source_url` column is not what the hero's "Source" link reads -- writing only
// the column produces a credit that is stored and never rendered. The column is
// still kept in step because upsertTour's EXCLUDED path reads it. Write both or
// the two disagree, which is the shape of bug that survives a deploy.
//
// dpxq is HTTP-ONLY: `https://www.dpxq.com/...` returns one byte. Tour index
// pages live at /hldcg/movelist_<id>.html -- NOT /hldcg/search/movelist_<id>.html,
// which 404s.

import { parseArgs } from 'node:util';
import pg from 'pg';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    set: { type: 'string' },
    clear: { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const slug = positionals[0];
if (!slug) {
  fail('Usage: node scripts/broadcast-source-url.mjs <tour-slug> [--set <url>|--clear]');
}
if (values.set && values.clear) {
  fail('Pass one of --set or --clear, not both.');
}
if (values.set && !/^(https?:\/\/|mistboard-discover:)/i.test(values.set)) {
  fail(`--set needs an absolute http(s) URL or a mistboard-discover: source, got: ${values.set}`);
}
if (values.set && /^https?:\/\/(www\.)?dpxq\.com\/hldcg\/movelist_(\d+)\.html/i.test(values.set)) {
  const tour = values.set.match(/movelist_(\d+)/)[1];
  fail(
    `${values.set} is a dpxq tour index, which the poller cannot read (it rejects it as
` +
      `malformed on every poll and imports nothing). Poll the tour through discovery instead:
` +
      `  --set "mistboard-discover://dpxq-tour?tour=${tour}&tourSlug=${slug}"`,
  );
}
if (!process.env.DATABASE_URL) {
  fail(
    'DATABASE_URL is not set. For production, run this through Railway:\n' +
      '  railway run -s Postgres -- sh -c \'DATABASE_URL="$DATABASE_PUBLIC_URL" ' +
      `node scripts/broadcast-source-url.mjs ${slug}'`,
  );
}

const target = values.clear ? null : (values.set ?? undefined);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const found = await client.query(
    `SELECT slug, name, source_url, payload->>'sourceUrl' AS payload_source_url
       FROM xiangqi_broadcast_tours WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  const row = found.rows[0];
  if (!row) {
    const all = await client.query(`SELECT slug FROM xiangqi_broadcast_tours ORDER BY slug`);
    fail(
      `No tour with slug ${slug}. Known slugs:\n` + all.rows.map((r) => `  ${r.slug}`).join('\n'),
    );
  }

  console.log(`${row.slug}  ${row.name}`);
  console.log(`  column  source_url   = ${row.source_url ?? '(none)'}`);
  console.log(`  payload .sourceUrl   = ${row.payload_source_url ?? '(none)'}`);
  if (row.source_url !== row.payload_source_url) {
    console.log('  MISMATCH: the rendered credit comes from the payload, not the column.');
  }

  if (target === undefined) {
    console.log('Read-only run. Pass --set <url> or --clear to change it.');
  } else if (row.source_url === target && row.payload_source_url === target) {
    console.log(`Already ${target ?? '(none)'} in both places. Nothing to do.`);
  } else {
    await client.query(
      `UPDATE xiangqi_broadcast_tours
          SET source_url = $2,
              payload = CASE
                WHEN $2::text IS NULL THEN payload - 'sourceUrl'
                ELSE payload || jsonb_build_object('sourceUrl', $2::text)
              END,
              updated_at = now()
        WHERE slug = $1`,
      [slug, target],
    );
    const after = await client.query(
      `SELECT source_url, payload->>'sourceUrl' AS payload_source_url
         FROM xiangqi_broadcast_tours WHERE slug = $1`,
      [slug],
    );
    const now = after.rows[0];
    console.log(
      `Set. column=${now.source_url ?? '(none)'} payload=${now.payload_source_url ?? '(none)'}`,
    );
  }
} finally {
  await client.end();
}
