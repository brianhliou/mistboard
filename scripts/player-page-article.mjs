#!/usr/bin/env node
// Build a player page's article source from its draft: step 7b of
// docs-private/players/README.md. The draft is the source of truth; the .ts is
// generated, so the prose is edited in one place and a regenerate never loses a
// sentence. Page 1 (yin-sheng) kept its prose inside a one-off python script
// and a "reading copy" draft beside it; the two drifted within a day.
//
//   node scripts/player-page-article.mjs docs-private/players/cao-yanlei/draft.md
//   node scripts/player-page-article.mjs <draft.md> --out apps/web/src/articles/content/<slug>.ts
//
// Without --out it prints to stdout. The player folder beside the draft holds
// `specs/<key>.json` (annotated-game-to-spec.mjs output, one per board) and an
// optional `positives.json` of reviewed positive glyphs. Line verdicts come from
// scripts/data/article-line-evals.json (article-line-evals.mjs), keyed by the
// board's position on the page, so they survive a regenerate.
//
// The draft dialect, one construct per paragraph (blank-line separated):
//
//   ---                              front matter, `key: value` per line:
//   slug: cao-yanlei                 slug, export, title, seoTitle, summary,
//   ---                              status, updatedAt, publishedAt, thumbnail,
//                                    thumbnailAlt, audience, readNext (comma list),
//                                    player (his name as the specs spell it: every
//                                    board opens from his side)
//   <!-- a note -->                  dropped
//   ## Heading                       starts a section; anything above the first
//                                    one is the intro
//   [figure src=/a.jpg alt="…"] Caption
//   [board key=m_139844 ply=24] Caption        const name defaults to G_<key>;
//                                    perspective=red|black overrides `player:`
//   [cta] Label -> /href (primary) | Label -> /href (secondary)
//   [cta single-row] …
//   [table highlight=2 wrap|compact] Caption, followed on the next lines by a pipe table,
//   | Player | Rating |             the first row is the header, a |---| rule
//   |---|---|                        line is skipped
//   | Yin Sheng | 2454 |
//   [FILL: what goes here]           a hole; refuses to build without --preview
//   Anything else is a paragraph; wrapped lines are joined with a space.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const draftPath = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const out = outIdx === -1 ? null : args[outIdx + 1];
// A draft still holding [FILL: …] marks refuses to build; --preview renders each
// one as a visible paragraph so the page can be read locally before it is done.
const PREVIEW = args.includes('--preview');
if (!draftPath) {
  console.error('usage: player-page-article.mjs <draft.md> [--out <article.ts>] [--preview]');
  process.exit(1);
}
const playerDir = dirname(draftPath);
const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..');

// Same sentences player-study.mjs bakes, so the page and the study read as one.
const POSITIVE_NOTE = {
  '!!': "Brilliant: a piece offered and not recovered, confirmed along the engine's own line.",
  '!': 'Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.',
};

const fail = (msg) => {
  console.error(`${basename(draftPath)}: ${msg}`);
  process.exit(1);
};

// ---- parse -----------------------------------------------------------------

const raw = readFileSync(draftPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) fail('no front matter');
const meta = {};
for (const line of fm[1].split('\n')) {
  const m = line.match(/^(\w+):\s*(.*)$/);
  if (m) meta[m[1]] = m[2].trim();
}
for (const k of ['slug', 'export', 'title', 'summary', 'audience']) {
  if (!meta[k]) fail(`front matter needs ${k}`);
}

function attrs(s) {
  const o = {};
  for (const m of s.matchAll(/([\w-]+)(?:=("([^"]*)"|\S+))?/g)) {
    o[m[1]] = m[3] ?? m[2] ?? true;
  }
  return o;
}

const chunks = raw
  .slice(fm[0].length)
  .split(/\n\s*\n/)
  .map((c) => c.trim())
  .filter(Boolean);

const intro = [];
const sections = [];
let target = intro;
const boards = []; // { key, constName } in page order
for (const chunk of chunks) {
  const lines = chunk.split('\n');
  const head = lines[0];
  if (head.startsWith('## ')) {
    const section = { heading: head.slice(3).trim(), blocks: [] };
    sections.push(section);
    target = section.blocks;
    if (lines.length > 1) fail(`put a blank line after "## ${section.heading}"`);
    continue;
  }
  const directive = head.match(/^\[(\w+)([^\]]*)\]\s*(.*)$/);
  if (!directive) {
    target.push({ kind: 'paragraph', text: lines.map((l) => l.trim()).join(' ') });
    continue;
  }
  const [, name, attrText, rest] = directive;
  if (name === 'FILL') {
    if (!PREVIEW) fail(`unfilled ${head.slice(0, 60)}… (pass --preview to render it anyway)`);
    target.push({ kind: 'paragraph', text: lines.join(' ') });
    continue;
  }
  const a = attrs(attrText);
  const caption = [rest, ...lines.slice(1).filter((l) => !l.startsWith('|'))]
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  if (name === 'figure') {
    if (!a.src || !a.alt) fail(`[figure] needs src and alt: ${head}`);
    target.push({ kind: 'image-figure', src: a.src, alt: a.alt, ...(caption ? { caption } : {}) });
  } else if (name === 'board') {
    if (!a.key) fail(`[board] needs key: ${head}`);
    const constName = a.const ?? `G_${a.key.toUpperCase()}`;
    boards.push({ key: a.key, constName });
    target.push({
      kind: 'xq-replay',
      constName,
      key: a.key,
      ...(a.perspective ? { perspective: a.perspective } : {}),
      ...(a.ply != null ? { startPly: Number(a.ply) } : {}),
      ...(caption ? { caption } : {}),
    });
  } else if (name === 'cta') {
    const buttons = rest.split('|').map((b) => {
      const m = b.trim().match(/^(.*?)\s*->\s*(\S+)(?:\s*\((primary|secondary)\))?$/);
      if (!m) fail(`[cta] button "${b.trim()}" is not "Label -> /href (primary|secondary)"`);
      return { label: m[1], href: m[2], emphasis: m[3] ?? 'secondary' };
    });
    target.push({ kind: 'cta', buttons, ...(a['single-row'] ? { layout: 'single-row' } : {}) });
  } else if (name === 'table') {
    const rows = lines
      .filter((l) => l.startsWith('|') && !/^\|[\s|:-]+\|$/.test(l))
      .map((l) =>
        l
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim()),
      );
    if (rows.length < 2) fail(`[table] needs a header row and at least one row: ${head}`);
    target.push({
      kind: 'table',
      headers: rows[0],
      rows: rows.slice(1),
      ...(a.highlight != null ? { highlightRows: String(a.highlight).split(',').map(Number) } : {}),
      ...(a.wrap ? { wrap: true } : {}),
      ...(a.compact ? { compact: true } : {}),
      ...(caption ? { caption } : {}),
    });
  } else {
    fail(`unknown directive [${name}]`);
  }
}
if (sections.length === 0) fail('no ## sections');

// ---- specs -------------------------------------------------------------------

const positivesPath = join(playerDir, 'positives.json');
const positives = existsSync(positivesPath) ? JSON.parse(readFileSync(positivesPath, 'utf8')) : {};
const lineEvalsPath = join(repoRoot, 'scripts/data/article-line-evals.json');
const lineEvals = existsSync(lineEvalsPath) ? JSON.parse(readFileSync(lineEvalsPath, 'utf8')) : {};

const seen = new Set();
const specConsts = [];
const seatsByKey = new Map();
for (const [boardIndex, { key, constName }] of boards.entries()) {
  if (seen.has(constName)) fail(`${constName} is on the page twice`);
  seen.add(constName);
  const specPath = join(playerDir, 'specs', `${key}.json`);
  if (!existsSync(specPath)) {
    fail(
      `no spec for ${key}: run annotated-game-to-spec.mjs on its deep annotation --out ${specPath}`,
    );
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const byPly = spec.annotations?.byPly ?? {};
  for (const [ply, glyph] of Object.entries(positives[key] ?? {})) {
    if (ply === '_' || byPly[ply]) continue; // a judged negative keeps the ply
    if (!POSITIVE_NOTE[glyph]) fail(`positives.json ${key} ${ply}: unknown glyph ${glyph}`);
    byPly[ply] = { glyph, note: POSITIVE_NOTE[glyph] };
  }
  for (const [ply, ann] of Object.entries(byPly)) {
    const verdict = lineEvals[`${meta.slug}:${boardIndex}:${ply}`];
    if (ann.line && verdict?.symbol) ann.lineEval = verdict.symbol;
  }
  const ordered = Object.fromEntries(
    Object.entries(byPly).sort(([a], [b]) => Number(a) - Number(b)),
  );
  spec.annotations = { ...(spec.annotations ?? {}), byPly: ordered };
  specConsts.push(`const ${constName}: XiangqiReplaySpec = ${JSON.stringify(spec, null, 2)};`);
  seatsByKey.set(key, { red: spec.red, black: spec.black });
}

// Every board opens from the page's player's side (front matter `player:`, his
// name as the specs spell it), whichever colour he had: the reader follows one
// person through the page and should not have to turn the board round for the
// games he played with black. A board's own `perspective=` wins.
for (const block of [...intro, ...sections.flatMap((s) => s.blocks)]) {
  if (block.kind !== 'xq-replay' || block.perspective || !meta.player) continue;
  const seats = seatsByKey.get(block.key);
  if (seats?.black === meta.player) block.perspective = 'black';
  else if (seats?.red === meta.player) block.perspective = 'red';
  else
    fail(
      `${block.key}: neither seat is "${meta.player}" (red ${seats?.red}, black ${seats?.black})`,
    );
}

// ---- emit --------------------------------------------------------------------

const q = (s) => JSON.stringify(s);
const ind = (n) => ' '.repeat(n);
function emitBlock(b, n) {
  const i = ind(n);
  const j = ind(n + 2);
  if (b.kind === 'xq-replay') {
    const extra = [
      ...(b.startPly == null ? [] : [`startPly: ${b.startPly}`]),
      ...(b.perspective ? [`perspective: '${b.perspective}'`] : []),
    ];
    const spec = extra.length ? `{ ...${b.constName}, ${extra.join(', ')} }` : b.constName;
    return `${i}{\n${j}kind: 'xq-replay',\n${j}spec: ${spec},\n${b.caption ? `${j}caption: ${q(b.caption)},\n` : ''}${i}},\n`;
  }
  const body = Object.entries(b)
    .map(([k, v]) => `${j}${k}: ${k === 'kind' ? `'${v}'` : JSON.stringify(v)},\n`)
    .join('');
  return `${i}{\n${body}${i}},\n`;
}

const thumbnail = meta.thumbnail
  ? `  thumbnail: {\n    kind: 'image',\n    src: ${q(meta.thumbnail)},\n${meta.thumbnailAlt ? `    alt: ${q(meta.thumbnailAlt)},\n` : ''}  },\n`
  : '';
const readNext = meta.readNext
  ? `  readNext: ${q(meta.readNext.split(',').map((s) => s.trim()))},\n`
  : '';
const rel = (p) => p.replace(`${repoRoot}/`, '').replace(/^.*?(docs-private\/)/, '$1');

const ts = `import type { XiangqiReplaySpec } from '../../xiangqi-replay.js';
import type { Article } from '../types.js';

// GENERATED by scripts/player-page-article.mjs from ${rel(draftPath)}.
// Edit the draft and regenerate; an edit here is lost on the next run. Facts
// and their sources: facts.md beside the draft. Board specs: specs/<key>.json
// there (annotated-game-to-spec.mjs over deep annotate-game.mjs runs), with
// reviewed positives from positives.json and line verdicts from
// scripts/data/article-line-evals.json. Baked, not fetched: the page must not
// depend on a study still existing.

${specConsts.join('\n\n')}

export const ${meta.export}: Article = {
  slug: ${q(meta.slug)},
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: ${q(meta.title)},
${meta.seoTitle ? `  seoTitle: ${q(meta.seoTitle)},\n` : ''}  summary: ${q(meta.summary)},
  showSummaryOnPage: false,
  status: ${q(meta.status ?? 'draft')},
${meta.publishedAt ? `  publishedAt: ${q(meta.publishedAt)},\n` : ''}${meta.updatedAt ? `  updatedAt: ${q(meta.updatedAt)},\n` : ''}${thumbnail}  audience: ${q(meta.audience)},
${readNext}  intro: [
${intro.map((b) => emitBlock(b, 4)).join('')}  ],
  sections: [
${sections
  .map(
    (s) =>
      `    {\n      heading: ${q(s.heading)},\n      blocks: [\n${s.blocks.map((b) => emitBlock(b, 8)).join('')}      ],\n    },\n`,
  )
  .join('')}  ],
};
`;

if (out) {
  writeFileSync(out, ts);
  console.error(`${boards.length} boards, ${sections.length} sections -> ${out}`);
} else {
  process.stdout.write(ts);
}
