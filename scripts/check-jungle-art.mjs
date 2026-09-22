#!/usr/bin/env node
// Keeps the in-app Jungle art and the blog in agreement. CANONICAL = the in-app set
// (apps/web/src/jungle-art.ts recipe + public/.../dobutsu pieces). The blog is downstream.
//
// This asserts (1) the blog widget's composition values (brianhliou.com,
// assets/js/jungle-replay.js) still match the canonical recipe in jungle-art.ts, and
// (2) the blog's pieces still mirror the canonical public pieces (else: run
// publish:jungle-art). Skips cleanly when the blog repo isn't a sibling (e.g. headless CI).
//
// Usage: node scripts/check-jungle-art.mjs   (or: npm run check:jungle-art)
//   MISTBOARD_BLOG_DIR overrides the blog repo location (default ../brianhliou.com).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = process.env.MISTBOARD_BLOG_DIR
  ? resolve(process.env.MISTBOARD_BLOG_DIR)
  : resolve(REPO_ROOT, '..', 'brianhliou.com');

const REPLAY_JS = resolve(BLOG_DIR, 'assets/js/jungle-replay.js');
const BLOG_PIECES = resolve(BLOG_DIR, 'assets/jungle-dobutsu-pieces');
const ART_TS = resolve(REPO_ROOT, 'apps/web/src/jungle-art.ts');
// CANONICAL: the in-app set. The blog is a downstream copy (kept in sync via
// `npm run publish:jungle-art`).
const PUBLIC_PIECES = resolve(REPO_ROOT, 'apps/web/public/piece-sets/jungle/dobutsu');
const PUBLIC_BOARD = resolve(PUBLIC_PIECES, 'board');

if (!existsSync(REPLAY_JS)) {
  console.log(`check:jungle-art — SKIP (blog repo not found at ${BLOG_DIR}).`);
  console.log('  Set MISTBOARD_BLOG_DIR or clone brianhliou.com as a sibling to run it.');
  process.exit(0);
}

const replay = readFileSync(REPLAY_JS, 'utf8');
const art = readFileSync(ART_TS, 'utf8');
const problems = [];

const num = (src, re, label) => {
  const m = src.match(re);
  if (!m) {
    problems.push(`could not read ${label}`);
    return null;
  }
  return Number(m[1]);
};
const str = (src, re, label) => {
  const m = src.match(re);
  if (!m) {
    problems.push(`could not read ${label}`);
    return null;
  }
  return m[1];
};

// --- Blog values (jungle-replay.js) ---
const blogCell = num(replay, /\bCELL\s*=\s*(\d+)/, 'blog CELL');
const blogDisc = num(
  replay,
  /jr-piece-disc"[\s\S]*?r="'\s*\+\s*size\s*\*\s*([0-9.]+)/,
  'blog disc ratio',
);
const blogRing = num(
  replay,
  /jr-piece-ring"[\s\S]*?r="'\s*\+\s*size\s*\*\s*([0-9.]+)/,
  'blog ring ratio',
);
const blogRingStrokePx = num(
  replay,
  /\.jr-piece-ring\{[^}]*stroke-width:\s*([0-9.]+)/,
  'blog ring stroke px',
);
const blogDiscFill = str(replay, /\.jr-piece-disc\{fill:(#[0-9a-fA-F]{3,6})/, 'blog disc fill');
const blogInkRed = str(replay, /INK\s*=\s*\{\s*red:\s*"(#[0-9a-fA-F]{3,6})"/, 'blog red ink');
const blogInkBlack = str(replay, /black:\s*"(#[0-9a-fA-F]{3,6})"\s*\}/, 'blog black ink');
const blogFitBlock = str(replay, /DOBUTSU_FIT\s*=\s*(\{[^}]*\})/, 'blog DOBUTSU_FIT');

// --- Mistboard values (jungle-art.ts) ---
const artDisc = num(art, /discRadiusRatio:\s*([0-9.]+)/, 'jungle-art discRadiusRatio');
const artRing = num(art, /ringRadiusRatio:\s*([0-9.]+)/, 'jungle-art ringRadiusRatio');
const artRingStroke = num(art, /ringStrokeRatio:\s*([0-9.]+)/, 'jungle-art ringStrokeRatio');
const artDiscFill = str(art, /discFill:\s*'(#[0-9a-fA-F]{3,6})'/, 'jungle-art discFill');
const artInkRed = str(art, /red:\s*'(#[0-9a-fA-F]{3,6})'/, 'jungle-art red ink');
const artInkBlack = str(art, /black:\s*'(#[0-9a-fA-F]{3,6})'/, 'jungle-art black ink');
const artFitBlock = str(art, /fit:\s*(\{[^}]*\})/, 'jungle-art fit');

const parseFit = (block) =>
  block
    ? Object.fromEntries(
        [...block.matchAll(/(\w+):\s*([0-9.]+)/g)].map(([, k, v]) => [k, Number(v)]),
      )
    : {};

const eq = (a, b, label) => {
  if (a !== b)
    problems.push(`${label}: blog ${JSON.stringify(a)} ≠ jungle-art ${JSON.stringify(b)}`);
};
const close = (a, b, label, tol = 0.005) => {
  if (a == null || b == null || Math.abs(a - b) > tol)
    problems.push(`${label}: blog ${a} vs jungle-art ${b} (Δ>${tol})`);
};

eq(blogDisc, artDisc, 'disc radius ratio');
eq(blogRing, artRing, 'ring radius ratio');
close(blogRingStrokePx / blogCell, artRingStroke, 'ring stroke ratio');
eq(blogDiscFill, artDiscFill, 'disc fill');
eq(blogInkRed, artInkRed, 'red ink');
eq(blogInkBlack, artInkBlack, 'black ink');

const blogFit = parseFit(blogFitBlock);
const artFit = parseFit(artFitBlock);
for (const role of new Set([...Object.keys(blogFit), ...Object.keys(artFit)])) {
  eq(blogFit[role], artFit[role], `fit.${role}`);
}

// --- Canonical-set completeness: the in-app (public) set has every board tile. ---
const canonicalPieces = readdirSync(PUBLIC_PIECES).filter((f) => /^(red|black)-\w+\.png$/.test(f));
for (const tile of ['grass', 'water', 'den', 'trap', 'flip-board']) {
  if (!existsSync(resolve(PUBLIC_BOARD, `${tile}.png`)))
    problems.push(`public board tile missing: ${tile}.png`);
}

// --- Downstream mirror: the blog has a copy of every canonical piece. (Presence only —
// the blog may keep higher-res masters, so we can't byte-compare across resolutions;
// `publish:jungle-art` is what keeps the art itself in sync.) ---
if (existsSync(BLOG_PIECES)) {
  for (const file of canonicalPieces) {
    if (!existsSync(resolve(BLOG_PIECES, file)))
      problems.push(`blog missing piece ${file} — run publish:jungle-art`);
  }
}

if (problems.length) {
  console.error('check:jungle-art — DRIFT:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nReconcile apps/web/src/jungle-art.ts with the blog recipe, and/or run publish:jungle-art.',
  );
  process.exit(1);
}
console.log('check:jungle-art — OK (recipe matches the blog widget; blog pieces mirror the app).');
