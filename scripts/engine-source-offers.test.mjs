// Every engine the web build serves to browsers keeps its licence and its
// source directions in the same directory as the binary (GPL-3.0 section 6d:
// source offered from the same place, or clear directions next to the object
// code). Blind spots, on purpose: this does not rebuild anything, so it cannot
// tell whether a shipped .wasm was really built from the source it names, and
// it does not check that an upstream link still resolves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const engines = join(root, 'apps/web/public/engine');

const GPL = /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/;
const MIT = /^MIT License/;

/** One row per served engine directory. `source` strings must appear in `notice`. */
const OFFERS = {
  'fairy-stockfish': {
    license: 'COPYING.txt',
    text: GPL,
    notice: 'README.md',
    source: [
      'https://github.com/fairy-stockfish/fairy-stockfish.wasm/tree/db432abaf83a1e7c265ff9c8554f83977d3441f5',
      '(fairy-stockfish-atomic-xiangqi.patch)',
      '(build-fairy-stockfish-wasm.sh)',
      '(COPYING.txt)',
    ],
    served: ['fairy-stockfish-atomic-xiangqi.patch', 'build-fairy-stockfish-wasm.sh'],
  },
  pikafish: {
    license: 'COPYING.txt',
    text: GPL,
    notice: 'README.md',
    source: ['6a59ee2f7b105bff64d9efc2692591107787e2b1', 'source.patch', 'pikafish-cc0-net.patch'],
    served: ['source.patch', 'pikafish-cc0-net.patch', 'build.sh', 'NNUE-License.md', 'net.json'],
  },
  'pikafish-jieqi': {
    license: 'COPYING.txt',
    text: GPL,
    notice: 'README.md',
    source: ['https://github.com/brianhliou/pikafish-jieqi-wasm'],
    served: ['jieqi-net-LICENSE'],
  },
  rapfi: {
    license: 'GPL-3.0.txt',
    text: GPL,
    notice: 'THIRD_PARTY.md',
    source: ['/rapfi/archive/1387d11312.tar.gz', 'https://github.com/brianhliou/rapfi-wasm'],
    served: ['BUILD.txt', 'NETWORKS-CC0.txt', 'net.json'],
  },
  'misty-banqi': {
    license: 'LICENSE.txt',
    text: MIT,
    notice: 'README.md',
    source: ['https://github.com/brianhliou/misty-banqi'],
    served: [],
  },
  'misty-jungle': {
    license: 'LICENSE.txt',
    text: MIT,
    notice: 'README.md',
    source: ['https://github.com/brianhliou/misty-jungle'],
    served: [],
  },
  'misty-jungle-flip': {
    license: 'LICENSE.txt',
    text: MIT,
    notice: 'README.md',
    source: ['https://github.com/brianhliou/misty-flip-jungle'],
    served: [],
  },
};

/** The problems with one engine directory's offer; empty when it is complete. */
function offerProblems(dir, offer) {
  const problems = [];
  const read = (file) =>
    existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : null;
  const license = read(offer.license);
  if (license === null) problems.push(`missing ${offer.license}`);
  else if (!offer.text.test(license)) problems.push(`${offer.license} is not the expected licence`);
  const notice = read(offer.notice);
  if (notice === null) problems.push(`missing ${offer.notice}`);
  for (const needle of offer.source) {
    if (notice !== null && !notice.includes(needle)) {
      problems.push(`${offer.notice} does not name ${needle}`);
    }
  }
  for (const file of offer.served) {
    if (read(file) === null) problems.push(`missing ${file}`);
  }
  return problems;
}

test('every served engine directory has an offer row', () => {
  const dirs = readdirSync(engines, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(dirs, Object.keys(OFFERS).sort());
});

for (const [name, offer] of Object.entries(OFFERS)) {
  test(`${name} ships its licence and source directions beside the binary`, () => {
    assert.deepEqual(offerProblems(join(engines, name), offer), []);
  });
}

test('the check catches a directory with a wrong licence, no patch and a bare upstream link', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'engine-source-offer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'COPYING.txt'), 'MIT License\n');
  await writeFile(
    join(dir, 'README.md'),
    'The corresponding source is https://github.com/fairy-stockfish/Fairy-Stockfish\n',
  );
  assert.deepEqual(offerProblems(dir, OFFERS['fairy-stockfish']), [
    'COPYING.txt is not the expected licence',
    `README.md does not name ${OFFERS['fairy-stockfish'].source[0]}`,
    'README.md does not name (fairy-stockfish-atomic-xiangqi.patch)',
    'README.md does not name (build-fairy-stockfish-wasm.sh)',
    'README.md does not name (COPYING.txt)',
    'missing fairy-stockfish-atomic-xiangqi.patch',
    'missing build-fairy-stockfish-wasm.sh',
  ]);
  assert.deepEqual(offerProblems(join(dir, 'absent'), OFFERS['misty-banqi']), [
    'missing LICENSE.txt',
    'missing README.md',
  ]);
});

test('the served Fairy-Stockfish patch and recipe are the ones the build uses', () => {
  const served = join(engines, 'fairy-stockfish');
  assert.equal(
    readFileSync(join(served, 'fairy-stockfish-atomic-xiangqi.patch'), 'utf8'),
    readFileSync(join(root, 'fairy-stockfish-atomic-xiangqi.patch'), 'utf8'),
  );
  const recipe = readFileSync(
    join(root, 'scripts/engine-wasm/build-fairy-stockfish-wasm.sh'),
    'utf8',
  );
  assert.equal(readFileSync(join(served, 'build-fairy-stockfish-wasm.sh'), 'utf8'), recipe);
  assert.match(recipe, /COMMIT=\$\{1:-db432abaf83a1e7c265ff9c8554f83977d3441f5\}/);
});

test('no network file is committed under the served engine directory', () => {
  // Nets are fetched at build time from a pinned public source (net.json), so a
  // tracked weights file is either a leftover or one whose licence nobody pinned.
  const tracked = execFileSync('git', ['ls-files', 'apps/web/public/engine'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /\.(nnue|bin|lz4|data|onnx)$/.test(file));
  assert.deepEqual(tracked, []);
});
