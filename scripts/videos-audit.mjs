// Audits the curated video library in apps/web/src/videos-data.ts against
// YouTube itself, and backfills what the catalogue is missing.
//
// The library is hand-maintained: every entry was verified once, by hand, on
// the date in its `addedAt`. Nothing re-checks it, so two kinds of rot are
// invisible from inside the repo. A video that is deleted, privatised, or
// region-locked still renders as a card that goes nowhere. And an entry with no
// `durationMinutes` silently breaks the length sorts, which push unknowns to
// the end of the list.
//
// Metadata comes from the watch page, not the Data API: the player response
// embedded in the HTML carries lengthSeconds, viewCount, author, title, and
// playability, so the audit needs no API key and no quota. oembed is not enough
// (no duration, no views, and it 401s on private videos rather than saying so).
//
//   node scripts/videos-audit.mjs                 report only
//   node scripts/videos-audit.mjs --write         also backfill durationMinutes
//   node scripts/videos-audit.mjs --json out.json full metadata, for ranking work
//   node scripts/videos-audit.mjs --missing       only entries lacking a duration
//   node scripts/videos-audit.mjs --id VIDEOID    audit one entry
//
// Exit code is 1 when any entry is unplayable or drifted, so this can gate.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  endOfString,
  fetchYoutubePage,
  isThrottle,
  mapWithConcurrency,
  matchingBracket,
  parseEmbeddedObject,
} from './lib/youtube.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../apps/web/src/videos-data.ts');

// Two at a time. A wider sweep trips YouTube's bot check partway through, and a
// half-verified audit is worth less than a slow whole one.
const CONCURRENCY = 2;
/** Parse the entry literals out of the data module.
 *
 *  Deliberately a source-level parse rather than an import: the audit has to
 *  write back into this exact file, so it needs each entry's byte range, and an
 *  imported value cannot tell it where the entry was written. The file is a
 *  hand-maintained literal with one flat object per entry, so the shape this
 *  relies on is the shape a human already has to keep. */
export function parseEntries(source, arrayNames = ['YOUTUBE_VIDEOS', 'MISTBOARD_CHANNEL_VIDEOS']) {
  const entries = [];
  for (const name of arrayNames) {
    const declaration = source.indexOf(`const ${name}`);
    if (declaration === -1) throw new Error(`videos-data.ts has no ${name} array`);
    // Anchor past the `=`: the type annotation carries its own `[]`, so the
    // first bracket after the declaration belongs to `readonly YoutubeVideo[]`,
    // not to the array literal. Matching that one closes instantly and reports
    // an empty catalogue.
    const assign = source.indexOf('=', declaration);
    const arrayStart = source.indexOf('[', assign);
    const arrayEnd = matchingBracket(source, arrayStart);
    let cursor = arrayStart + 1;
    while (cursor < arrayEnd) {
      const objectStart = source.indexOf('{', cursor);
      if (objectStart === -1 || objectStart > arrayEnd) break;
      const objectEnd = matchingBracket(source, objectStart);
      const body = source.slice(objectStart, objectEnd + 1);
      entries.push({
        array: name,
        start: objectStart,
        end: objectEnd + 1,
        body,
        source: field(body, 'source'),
        id: field(body, 'id'),
        bvid: field(body, 'bvid'),
        slug: field(body, 'slug'),
        title: field(body, 'title'),
        author: field(body, 'author'),
        addedAt: field(body, 'addedAt'),
        durationMinutes: numberField(body, 'durationMinutes'),
      });
      cursor = objectEnd + 1;
    }
  }
  return entries;
}

/** Read a string-valued field out of an entry literal, whatever quotes it uses.
 *
 *  Biome rewrites a single-quoted string containing an apostrophe into a
 *  double-quoted one, so three of the catalogue's titles ("... Men's Individual
 *  Final") are double-quoted and a single-quote-only regex reads them as absent.
 *  An absent title then looks like drift against YouTube, which is how this was
 *  found: the audit reported three titles as changed when only the parser was
 *  wrong. Anything reading hand-written source has to accept both quote styles.
 */
export function field(body, key) {
  const at = body.search(new RegExp(`\\b${key}:\\s*['"\`]`));
  if (at === -1) return null;
  const quoteAt = at + body.slice(at).search(/['"`]/);
  return decodeLiteral(body.slice(quoteAt, endOfString(body, quoteAt) + 1));
}

/** The value of a JS string literal, quotes and escapes removed. */
function decodeLiteral(literal) {
  return literal.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1');
}

function numberField(body, key) {
  const match = body.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

/** Pull the fields we care about out of a watch page.
 *
 *  `videoDetails` is parsed as JSON off a brace match rather than scraped with
 *  field regexes. The page embeds several JSON blobs and a bare
 *  /"viewCount":"(\d+)"/ happily matches a recommended video's; anchoring on
 *  the object and parsing it is both shorter and correct. */
export function extractMetadata(html) {
  const status = firstMatch(html, /"playabilityStatus":\s*\{"status":"([A-Z_]+)"/);
  const reason = firstMatch(html, /"playabilityStatus":\s*\{[^}]*?"reason":"((?:[^"\\]|\\.)*)"/);
  const details = parseEmbeddedObject(html, '"videoDetails":');
  const microformat = parseEmbeddedObject(html, '"playerMicroformatRenderer":');
  return {
    status,
    reason: reason ? decodeJson(reason) : null,
    lengthSeconds: details?.lengthSeconds ? Number(details.lengthSeconds) : null,
    viewCount: details?.viewCount ? Number(details.viewCount) : null,
    author: details?.author ?? null,
    title: details?.title ?? null,
    isPrivate: details?.isPrivate === true,
    isLive: details?.isLiveContent === true,
    publishDate: microformat?.publishDate?.slice(0, 10) ?? null,
  };
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

/** Decode a raw JSON string body (escapes intact) into its text. */
function decodeJson(raw) {
  if (raw === null) return null;
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

async function fetchMetadata(id) {
  let seen = null;
  const { html, error } = await fetchYoutubePage(
    `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    (page) => {
      seen = extractMetadata(page);
      // A consent wall leaves no player response at all; a bot check leaves one
      // that says the video needs a login. Neither is a dead video, so both
      // retry rather than being reported as a finding.
      if (!seen.status && !seen.lengthSeconds) return 'no player response in page';
      if (isThrottle(seen.status, seen.reason)) {
        return `throttled by YouTube (${seen.reason ?? seen.status})`;
      }
      return null;
    },
  );
  if (error) return { error };
  return seen ?? extractMetadata(html);
}

/** Round to the nearest minute, but never to zero: a 40-second short is "1", not
 *  "0", and a 0 would read as missing everywhere downstream. */
export function durationToMinutes(lengthSeconds) {
  return Math.max(1, Math.round(lengthSeconds / 60));
}

/** Insert `durationMinutes` into one entry literal, after `author`.
 *
 *  Returns the patched entry body. Placement follows the file's existing order
 *  (title, author, durationMinutes, tags) so a backfilled entry is
 *  indistinguishable from a hand-written one. */
export function withDuration(body, minutes) {
  if (/\bdurationMinutes:/.test(body)) return body;
  const authorAt = body.search(/\n\s*author:\s*['"`]/);
  if (authorAt === -1) throw new Error('entry has no author line to anchor on');
  const quoteAt = authorAt + body.slice(authorAt).search(/['"`]/);
  const lineEnd = body.indexOf('\n', endOfString(body, quoteAt));
  const insertAt = lineEnd === -1 ? body.length : lineEnd;
  const indent = body.slice(authorAt + 1).match(/^\s*/)[0];
  return `${body.slice(0, insertAt)}\n${indent}durationMinutes: ${minutes},${body.slice(insertAt)}`;
}

function formatViews(count) {
  if (count === null) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const jsonAt = argv.indexOf('--json');
  const jsonPath = jsonAt === -1 ? null : argv[jsonAt + 1];
  const idAt = argv.indexOf('--id');
  const onlyId = idAt === -1 ? null : argv[idAt + 1];
  // Backfilling is a loop: YouTube throttles a full sweep partway through, so
  // the run after the first only needs the entries still missing a duration.
  const onlyMissing = argv.includes('--missing');

  const source = readFileSync(DATA_PATH, 'utf8');
  const all = parseEntries(source);
  const youtube = all.filter((entry) => entry.source === 'youtube' && entry.id);
  let targets = youtube;
  if (onlyId) targets = targets.filter((entry) => entry.id === onlyId);
  if (onlyMissing) targets = targets.filter((entry) => entry.durationMinutes === null);
  if (targets.length === 0) {
    if (onlyMissing) {
      console.log('Every YouTube entry already has a duration.');
      return;
    }
    console.error(onlyId ? `no YouTube entry with id ${onlyId}` : 'no YouTube entries found');
    process.exit(1);
  }

  console.log(
    `Auditing ${targets.length} YouTube ${targets.length === 1 ? 'entry' : 'entries'} ` +
      `(${all.length - youtube.length} non-YouTube skipped)\n`,
  );

  const audited = await mapWithConcurrency(targets, CONCURRENCY, async (entry) => ({
    entry,
    meta: await fetchMetadata(entry.id),
  }));

  const unplayable = [];
  const drifted = [];
  const backfill = [];
  const unreachable = [];
  const rows = [];

  for (const { entry, meta } of audited) {
    if (meta.error) {
      unreachable.push({ entry, why: meta.error });
      continue;
    }
    if (meta.status !== 'OK') {
      unplayable.push({ entry, why: `${meta.status}${meta.reason ? `: ${meta.reason}` : ''}` });
    }
    if (meta.title && meta.title !== entry.title) {
      drifted.push({ entry, field: 'title', was: entry.title, now: meta.title });
    }
    if (meta.author && meta.author !== entry.author) {
      drifted.push({ entry, field: 'author', was: entry.author, now: meta.author });
    }
    if (meta.lengthSeconds) {
      const minutes = durationToMinutes(meta.lengthSeconds);
      // A minute of slack: the hand-entered values were mostly read off the
      // video's own title ("... in 18 minutes!") while this rounds 18:58 up to
      // 19. Both are honest, and flagging the pair as drift is noise that
      // trains you to ignore the section.
      if (entry.durationMinutes === null) backfill.push({ entry, minutes });
      else if (Math.abs(entry.durationMinutes - minutes) > 1) {
        drifted.push({
          entry,
          field: 'durationMinutes',
          was: String(entry.durationMinutes),
          now: String(minutes),
        });
      }
    }
    rows.push({
      id: entry.id,
      title: entry.title,
      author: entry.author,
      addedAt: entry.addedAt,
      status: meta.status,
      durationMinutes: meta.lengthSeconds ? durationToMinutes(meta.lengthSeconds) : null,
      viewCount: meta.viewCount,
      publishDate: meta.publishDate,
      isLive: meta.isLive,
    });
  }

  const section = (title, items, render) => {
    if (items.length === 0) return;
    console.log(`${title} (${items.length})`);
    for (const item of items) console.log(`  ${render(item)}`);
    console.log('');
  };

  section(
    'UNPLAYABLE — the card links to nothing',
    unplayable,
    ({ entry, why }) => `${entry.id}  ${why}\n    ${entry.title}`,
  );
  section(
    'UNREACHABLE — audit could not verify (not proof of rot)',
    unreachable,
    ({ entry, why }) => `${entry.id}  ${why}`,
  );
  section(
    'DRIFTED — the catalogue disagrees with YouTube',
    drifted,
    ({ entry, field: name, was, now }) => `${entry.id}  ${name}\n    was: ${was}\n    now: ${now}`,
  );
  section(
    write ? 'BACKFILLED durationMinutes' : 'MISSING durationMinutes (run with --write)',
    backfill,
    ({ entry, minutes }) => `${entry.id}  ${String(minutes).padStart(3)} min  ${entry.title}`,
  );

  const ranked = rows
    .filter((row) => row.viewCount !== null)
    .sort((a, b) => b.viewCount - a.viewCount);
  if (ranked.length > 0) {
    console.log(`VIEWS — catalogue by reach (${ranked.length} measured)`);
    for (const row of ranked.slice(0, 10)) {
      console.log(`  ${formatViews(row.viewCount).padStart(6)}  ${row.author} — ${row.title}`);
    }
    if (ranked.length > 13) {
      console.log('  ...');
      for (const row of ranked.slice(-3)) {
        console.log(`  ${formatViews(row.viewCount).padStart(6)}  ${row.author} — ${row.title}`);
      }
    }
    console.log('');
  }

  if (write && backfill.length > 0) {
    // Patch from the end so each earlier entry's recorded offsets stay valid.
    let patched = source;
    for (const { entry, minutes } of [...backfill].sort((a, b) => b.entry.start - a.entry.start)) {
      patched =
        patched.slice(0, entry.start) +
        withDuration(entry.body, minutes) +
        patched.slice(entry.end);
    }
    writeFileSync(DATA_PATH, patched);
    console.log(`Wrote ${backfill.length} durations to ${DATA_PATH}\n`);
  }

  if (jsonPath) {
    // Merge over any existing snapshot rather than replacing it. YouTube
    // throttles a long sweep partway through, and a run that verified 57 of 62
    // must not delete the five it could not reach this time: a consumer reading
    // the file cannot tell a missing row from a zero, and one that guesses will
    // rank an unmeasured video last. Re-running fills the gaps instead.
    const merged = new Map();
    try {
      for (const row of JSON.parse(readFileSync(jsonPath, 'utf8')).rows ?? []) {
        merged.set(row.id, row);
      }
    } catch {
      // No usable snapshot yet; this run is the first.
    }
    const carried = merged.size;
    for (const row of rows) merged.set(row.id, row);
    writeFileSync(
      jsonPath,
      `${JSON.stringify({ auditedAt: new Date().toISOString(), rows: [...merged.values()] }, null, 2)}\n`,
    );
    console.log(
      `Wrote metadata for ${merged.size} entries to ${jsonPath}` +
        `${carried > 0 ? ` (${rows.length} fresh, ${merged.size - rows.length} carried)` : ''}\n`,
    );
  }

  // Unreachable counts against a clean verdict too. An audit that verified
  // nothing is not an audit that found nothing wrong, and reporting it as OK is
  // the failure mode this whole script exists to remove.
  const clean = unplayable.length === 0 && drifted.length === 0 && unreachable.length === 0;
  console.log(
    clean
      ? `OK — ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} playable and in sync.`
      : `${rows.length} verified; ${unplayable.length} unplayable, ${drifted.length} drifted, ` +
          `${unreachable.length} unreachable.`,
  );
  if (!clean) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
