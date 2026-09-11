#!/usr/bin/env node
// Bundle the kernel for the prototype page, and optionally inline it into a
// single self-contained file (which is what gets published as an artifact).
//
//   node prototype/build.mjs            -> prototype/mahjong.bundle.js
//   node prototype/build.mjs --inline   -> also prototype/table.standalone.html
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'mahjong.bundle.js');

await build({
  entryPoints: [join(here, '..', 'src', 'index.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'MJ',
  minify: true,
  outfile: out,
});
console.log('wrote', out);

if (process.argv.includes('--inline')) {
  const [page, bundle] = await Promise.all([
    readFile(join(here, 'table.html'), 'utf8'),
    readFile(out, 'utf8'),
  ]);
  const inlined = page.replace(
    '<script src="./mahjong.bundle.js"></script>',
    `<script>${bundle}</script>`,
  );
  const dest = join(here, 'table.standalone.html');
  await writeFile(dest, inlined);
  console.log('wrote', dest);
}
