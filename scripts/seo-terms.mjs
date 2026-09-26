#!/usr/bin/env node
// Where Mistboard ranks on the terms we care about, from the latest Search
// Console pull (tools/scripts/gsc-pull.py writes docs-private/seo/gsc/ every
// Monday 08:30). Terms and the page each should rank with live in
// docs-private/seo/tracked-terms.tsv.
//
// A query matches a term when it contains it, so "duck xiangqi rules" counts
// toward "duck xiangqi". Position is impression-weighted over the pull's
// window (90 days by default, so it moves slowly). A term with no rows had no
// impressions at all: Google is not showing us for it.
//
// Each run records the pull's numbers in terms-history.tsv once per pull date
// and prints the change since the previous pull.
//
//   npm run seo:terms
//   npm run seo:terms -- --dir docs-private/seo/gsc --terms docs-private/seo/tracked-terms.tsv
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dir = arg('--dir', 'docs-private/seo/gsc');
const termsPath = arg('--terms', 'docs-private/seo/tracked-terms.tsv');
const historyPath = join(dir, 'terms-history.tsv');

function readTsv(path) {
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));
  return lines.map((l) => l.split('\t'));
}

const snapshot = JSON.parse(readFileSync(join(dir, 'gsc-snapshot.json'), 'utf8'));
const [header, ...rows] = readTsv(join(dir, 'gsc-query-page.tsv'));
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const queryPage = rows.map((r) => ({
  query: r[col.query].toLowerCase(),
  page: new URL(r[col.page]).pathname,
  clicks: Number(r[col.clicks]),
  impressions: Number(r[col.impressions]),
  position: Number(r[col.position]),
}));
const terms = readTsv(termsPath).map(([term, target, group]) => ({ term, target, group }));

const previous = new Map();
if (existsSync(historyPath)) {
  for (const [date, term, , , position] of readTsv(historyPath).slice(1)) {
    if (date !== snapshot.pulled_on) previous.set(term, Number(position) || null);
  }
}

const report = terms.map(({ term, target, group }) => {
  const hits = queryPage.filter((r) => r.query.includes(term.toLowerCase()));
  const impressions = hits.reduce((s, r) => s + r.impressions, 0);
  const clicks = hits.reduce((s, r) => s + r.clicks, 0);
  const position = impressions
    ? hits.reduce((s, r) => s + r.position * r.impressions, 0) / impressions
    : null;
  const byPage = new Map();
  for (const r of hits) byPage.set(r.page, (byPage.get(r.page) ?? 0) + r.impressions);
  const topPage = [...byPage.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { term, target, group, impressions, clicks, position, topPage };
});

const pad = (s, n) => String(s).padEnd(n);
console.log(`GSC ${snapshot.start} .. ${snapshot.end} (pulled ${snapshot.pulled_on})\n`);
console.log(
  `${pad('term', 28)}${pad('pos', 7)}${pad('Δ', 7)}${pad('impr', 6)}${pad('clk', 5)}ranking page`,
);
for (const r of report) {
  const before = previous.get(r.term);
  const delta =
    r.position !== null && before ? (before - r.position).toFixed(1).replace(/^(?!-)/, '+') : '';
  const page =
    r.topPage === null
      ? 'not shown'
      : r.topPage === r.target
        ? r.topPage
        : `${r.topPage}  (want ${r.target})`;
  console.log(
    `${pad(r.term, 28)}${pad(r.position === null ? '-' : r.position.toFixed(1), 7)}${pad(delta, 7)}${pad(r.impressions, 6)}${pad(r.clicks, 5)}${page}`,
  );
}

const recorded =
  existsSync(historyPath) &&
  readFileSync(historyPath, 'utf8').includes(`\n${snapshot.pulled_on}\t`);
if (!recorded) {
  if (!existsSync(historyPath))
    appendFileSync(historyPath, 'pulled_on\tterm\timpressions\tclicks\tposition\ttop_page\n');
  for (const r of report) {
    appendFileSync(
      historyPath,
      `${snapshot.pulled_on}\t${r.term}\t${r.impressions}\t${r.clicks}\t${r.position?.toFixed(1) ?? ''}\t${r.topPage ?? ''}\n`,
    );
  }
}
