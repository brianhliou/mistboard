#!/usr/bin/env node
// Keeps the in-app Jungle art and the blog in agreement. CANONICAL = the in-app set
// (apps/web/src/jungle-art.ts recipe + public/.../dobutsu pieces). The blog is downstream.
//
// The piece look of 2026-10-14: a cream rounded square under the animal art and one
// dark ring (a rounded square too) on both sides, the outer edge on the cell edge
// (120 at a cell of 120; 98% until 2026-10-15), no shadow; Flip Jungle's face-down
// tile is a jade rounded square of the same reach. This asserts:
//   (1) both blog widgets (brianhliou.com assets/js/jungle-replay.js and
//       flip-jungle-replay.js) name the same reach, face and ring ratios, corner
//       ratio, ring colour and face fill as jungle-art.ts, draw the token as a
//       rounded square, and carry no per-side ring colour, circle token or piece
//       shadow; Flip Jungle's BACK matches JUNGLE_ART.faceDown;
//   (2) the blog's pieces still mirror the canonical public pieces (else: run
//       publish:jungle-art).
// Skips cleanly when the blog repo isn't a sibling (e.g. headless CI).
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

const WIDGETS = [
  { file: 'assets/js/jungle-replay.js', face: 'jr-piece-disc', ring: 'jr-piece-ring', back: false },
  { file: 'assets/js/flip-jungle-replay.js', face: 'fjr-disc', ring: 'fjr-ring', back: true },
];
const BLOG_PIECES = resolve(BLOG_DIR, 'assets/jungle-dobutsu-pieces');
const ART_TS = resolve(REPO_ROOT, 'apps/web/src/jungle-art.ts');
// CANONICAL: the in-app set. The blog is a downstream copy (kept in sync via
// `npm run publish:jungle-art`).
const PUBLIC_PIECES = resolve(REPO_ROOT, 'apps/web/public/piece-sets/jungle/dobutsu');
const PUBLIC_BOARD = resolve(PUBLIC_PIECES, 'board');

if (!existsSync(resolve(BLOG_DIR, WIDGETS[0].file))) {
  console.log(`check:jungle-art — SKIP (blog repo not found at ${BLOG_DIR}).`);
  console.log('  Set MISTBOARD_BLOG_DIR or clone brianhliou.com as a sibling to run it.');
  process.exit(0);
}

const art = readFileSync(ART_TS, 'utf8');
const problems = [];

const read = (src, re, label) => {
  const m = src.match(re);
  if (!m) problems.push(`could not read ${label}`);
  return m ? m[1] : null;
};
// A ratio written as a number or a fraction ("0.45", "14 / 46").
const RATIO = '([0-9.]+(?:\\s*/\\s*[0-9.]+)?)';
const ratio = (src, re, label) => {
  const v = read(src, re, label);
  if (v == null) return null;
  const [a, b] = v.split('/').map((x) => Number(x.trim()));
  return b === undefined ? a : a / b;
};
const HEX = '(#[0-9a-fA-F]{3,6})';
const hex = (src, re, label) => read(src, re, label)?.toLowerCase() ?? null;

const eq = (a, b, label) => {
  if (a !== b)
    problems.push(`${label}: blog ${JSON.stringify(a)} ≠ jungle-art ${JSON.stringify(b)}`);
};
const close = (a, b, label, tol = 1e-6) => {
  if (a == null || b == null || Math.abs(a - b) > tol)
    problems.push(`${label}: blog ${a} vs jungle-art ${b} (Δ>${tol})`);
};
const parseFit = (block) =>
  block
    ? Object.fromEntries(
        [...block.matchAll(/(\w+):\s*([0-9.]+)/g)].map(([, k, v]) => [k, Number(v)]),
      )
    : {};

// --- Mistboard values (jungle-art.ts) ---
const canon = {
  reach: ratio(art, new RegExp(`JUNGLE_TOKEN_REACH\\s*=\\s*${RATIO}`), 'JUNGLE_TOKEN_REACH'),
  face: ratio(art, new RegExp(`discRadiusRatio:\\s*${RATIO}`), 'jungle-art discRadiusRatio'),
  ring: ratio(art, new RegExp(`ringRadiusRatio:\\s*${RATIO}`), 'jungle-art ringRadiusRatio'),
  ringStroke: ratio(art, new RegExp(`ringStrokeRatio:\\s*${RATIO}`), 'jungle-art ringStrokeRatio'),
  corner: ratio(art, new RegExp(`cornerPerHalf:\\s*${RATIO}`), 'jungle-art cornerPerHalf'),
  ringInk: hex(art, new RegExp(`animalRing:\\s*'${HEX}'`), 'jungle-art animalRing'),
  faceFill: hex(art, new RegExp(`discFill:\\s*'${HEX}'`), 'jungle-art discFill'),
  fit: parseFit(read(art, /fit:\s*(\{[^}]*\})/, 'jungle-art fit')),
};
const faceDownBlock = read(art, /faceDown:\s*(\{[^}]*\})/, 'jungle-art faceDown') ?? '';
const faceDown = {
  fill: hex(faceDownBlock, new RegExp(`fill:\\s*'${HEX}'`), 'faceDown.fill'),
  stroke: hex(faceDownBlock, new RegExp(`stroke:\\s*'${HEX}'`), 'faceDown.stroke'),
  reach: ratio(faceDownBlock, new RegExp(`reach:\\s*${RATIO}`), 'faceDown.reach'),
  strokeRatio: ratio(faceDownBlock, new RegExp(`strokeRatio:\\s*${RATIO}`), 'faceDown.strokeRatio'),
};
if (!/rx="\$\{r\(half \* JUNGLE_ART\.cornerPerHalf\)\}"/.test(art))
  problems.push('jungle-art.ts token is no longer a rounded square on cornerPerHalf');

// The outline at a 120 cell: the token box times (2 × ring half + ring stroke).
// Both sides round the box to quarter units, so the edge lands within a quarter
// unit of 120.
const outlineAt120 = (r) =>
  r.reach == null || r.ring == null || r.ringStroke == null
    ? null
    : (Math.round(((120 * r.reach) / (2 * r.ring + r.ringStroke)) * 4) / 4) *
      (2 * r.ring + r.ringStroke);
close(outlineAt120(canon), 120, 'jungle-art outline at a 120 cell vs 120', 0.25);

// --- Blog widgets ---
for (const w of WIDGETS) {
  const path = resolve(BLOG_DIR, w.file);
  if (!existsSync(path)) {
    problems.push(`${w.file}: missing`);
    continue;
  }
  const src = readFileSync(path, 'utf8');
  const at = (label) => `${w.file} ${label}`;
  const blog = {
    reach: ratio(src, new RegExp(`\\bTOKEN_REACH\\s*=\\s*${RATIO}`), at('TOKEN_REACH')),
    face: ratio(src, new RegExp(`\\bFACE_RATIO\\s*=\\s*${RATIO}`), at('FACE_RATIO')),
    ring: ratio(src, new RegExp(`\\bRING_RATIO\\s*=\\s*${RATIO}`), at('RING_RATIO')),
    ringStroke: ratio(
      src,
      new RegExp(`\\bRING_STROKE_RATIO\\s*=\\s*${RATIO}`),
      at('RING_STROKE_RATIO'),
    ),
    corner: ratio(src, new RegExp(`\\bCORNER_PER_HALF\\s*=\\s*${RATIO}`), at('CORNER_PER_HALF')),
    ringInk: hex(src, new RegExp(`\\bRING_INK\\s*=\\s*"${HEX}"`), at('RING_INK')),
    faceFill: hex(src, new RegExp(`\\.${w.face}\\{fill:${HEX}`), at(`.${w.face} fill`)),
  };
  close(blog.reach, canon.reach, at('token reach'));
  close(blog.face, canon.face, at('face half ratio'));
  close(blog.ring, canon.ring, at('ring half ratio'));
  close(blog.ringStroke, canon.ringStroke, at('ring stroke ratio'));
  close(blog.corner, canon.corner, at('corner per half'));
  eq(blog.ringInk, canon.ringInk, at('ring colour'));
  eq(blog.faceFill, canon.faceFill, at('face fill'));
  close(outlineAt120(blog), 120, at('outline at a 120 cell vs 120'), 0.25);

  // Shape and the single ring: a rounded square on the corner ratio, never a
  // circle, no per-side ring colour, no shadow on the piece.
  if (!/rx="'\s*\+\s*half\s*\*\s*CORNER_PER_HALF/.test(src))
    problems.push(at('token is not a rounded square (no rx = half * CORNER_PER_HALF)'));
  if (new RegExp(`<circle class="(${w.face}|${w.ring})"`).test(src))
    problems.push(at('still draws the token face or ring as a circle'));
  if (new RegExp(`\\.(red|black) \\.${w.ring}\\{stroke`).test(src))
    problems.push(at('still colours the ring per side (one dark ring on both sides)'));
  if (/\.(jr|fjr)-piece\{[^}]*filter:/.test(src))
    problems.push(at('piece still has a drop shadow'));
  if (/\bINK\s*=\s*\{\s*red:/.test(src))
    problems.push(at('still keeps a per-side INK table for the token'));

  if (w.back) {
    const backBlock = read(src, /\bBACK\s*=\s*(\{[^}]*\})/, at('BACK')) ?? '';
    eq(
      hex(backBlock, new RegExp(`fill:\\s*"${HEX}"`), at('BACK.fill')),
      faceDown.fill,
      at('face-down fill'),
    );
    eq(
      hex(backBlock, new RegExp(`stroke:\\s*"${HEX}"`), at('BACK.stroke')),
      faceDown.stroke,
      at('face-down stroke'),
    );
    close(
      ratio(backBlock, new RegExp(`strokeRatio:\\s*${RATIO}`), at('BACK.strokeRatio')),
      faceDown.strokeRatio,
      at('face-down stroke ratio'),
    );
    // The back spans the same reach as a face-up token: half = (cell × reach − width) / 2.
    close(blog.reach, faceDown.reach, at('face-down reach'));
    if (!/half\s*=\s*\(CELL\s*\*\s*TOKEN_REACH\s*-\s*w\)\s*\/\s*2/.test(src))
      problems.push(at('face-down tile is not sized (cell × reach − stroke) / 2'));
  } else {
    const blogFit = parseFit(read(src, /DOBUTSU_FIT\s*=\s*(\{[^}]*\})/, at('DOBUTSU_FIT')));
    for (const role of new Set([...Object.keys(blogFit), ...Object.keys(canon.fit)])) {
      eq(blogFit[role], canon.fit[role], at(`fit.${role}`));
    }
  }
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
console.log(
  `check:jungle-art — OK (${WIDGETS.length} blog widgets match the recipe; blog pieces mirror the app).`,
);
