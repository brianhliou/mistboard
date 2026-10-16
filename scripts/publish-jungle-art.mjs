#!/usr/bin/env node
// Publish the canonical Jungle art to the blog. The CANONICAL set is the in-app one
// (apps/web/public/piece-sets/jungle/dobutsu) — that's where art is dropped and locked.
// The blog (brianhliou.com) is a DOWNSTREAM copy: this pushes the app's pieces up
// so the public Dou Shou Qi / Flip Jungle posts show the same art. Run it after updating
// art in public.
//
//   npm run publish:jungle-art
//   MISTBOARD_BLOG_DIR overrides the blog repo location (default ../brianhliou.com).
//
// Pieces are copied 1:1 (already web-sized). Board terrain is NOT published — the blog
// keeps its own high-res board masters; add board tiles here if they become canonical
// in public.

import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(REPO_ROOT, 'apps/web/public/piece-sets/jungle/dobutsu');
const BLOG_DIR = process.env.MISTBOARD_BLOG_DIR
  ? resolve(process.env.MISTBOARD_BLOG_DIR)
  : resolve(REPO_ROOT, '..', 'brianhliou.com');
const BLOG_PIECES = resolve(BLOG_DIR, 'assets/jungle-dobutsu-pieces');

if (!existsSync(BLOG_PIECES)) {
  console.error(`publish:jungle-art — blog pieces dir not found: ${BLOG_PIECES}`);
  console.error('  Set MISTBOARD_BLOG_DIR or clone brianhliou.com as a sibling.');
  process.exit(1);
}

const allPieces = readdirSync(PUBLIC).filter((f) => /^(red|black)-\w+\.png$/.test(f));
const args = process.argv.slice(2);
const pushAll = args.includes('--all');
const named = args
  .filter((a) => !a.startsWith('--'))
  .map((a) => (a.endsWith('.png') ? a : `${a}.png`));

let toPush;
if (pushAll) {
  // The whole set. NB: this overwrites the blog's (possibly higher-res) masters with the
  // app's web-sized pieces — only do it when you want the blog to fully mirror the app.
  toPush = allPieces;
} else if (named.length) {
  const unknown = named.filter((f) => !allPieces.includes(f));
  if (unknown.length) {
    console.error(`publish:jungle-art — unknown piece(s): ${unknown.join(', ')}`);
    process.exit(1);
  }
  toPush = named;
} else {
  console.log('publish:jungle-art — name the pieces you changed, e.g.:');
  console.log('  npm run publish:jungle-art -- red-cat black-cat red-rat black-rat');
  console.log(
    '  npm run publish:jungle-art -- --all   (mirror the WHOLE set; overwrites blog masters)',
  );
  console.log(`\navailable: ${allPieces.map((f) => f.replace('.png', '')).join(', ')}`);
  process.exit(0);
}

for (const file of toPush) copyFileSync(resolve(PUBLIC, file), resolve(BLOG_PIECES, file));
console.log(
  `publish:jungle-art — pushed ${toPush.length} piece(s) → ${BLOG_PIECES.replace(`${BLOG_DIR}/`, '')}`,
);
if (pushAll)
  console.log(
    '  ⚠ pushed the whole set — the blog pieces are now web-sized copies of the app set.',
  );
console.log('  (rebuild + deploy the blog to publish; board terrain not touched)');
