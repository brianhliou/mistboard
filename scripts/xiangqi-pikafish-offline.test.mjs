// Offline xiangqi Pikafish scripts run the build the server runs (#989): upstream
// at the pikafish.ref pin plus pikafish-cc0-net.patch, on the Fairy-Stockfish CC0
// net, found through the server's own resolver. No script may fall back to the
// January 2026 official release, the unpatched pin build, or the old net.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PIKAFISH_XIANGQI_NNUE_NET,
  PIKAFISH_XIANGQI_NNUE_SHA256,
  PIKAFISH_XIANGQI_REF,
} from '../apps/server/src/xiangqi-pikafish-paths.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

// The retired builds: the January official release, the unpatched pin build's
// directory, and the old upstream net's sha256 prefix. Spelled in parts so this
// file is not itself a hit for the issue's `git grep` of the same three names.
const OLD_RELEASE = ['official', '2026'].join('-');
const OLD_PIN_DIR = ['pikafish', '6a59ee2f'].join('-');
const OLD_NET = ['c402', '6370'].join('');
const RETIRED = new RegExp([OLD_RELEASE, OLD_PIN_DIR, OLD_NET].join('|'));

test('the retired-build pattern catches each old build reference', () => {
  for (const planted of [
    `resolve(HOME, 'projects/tools/pikafish-${OLD_RELEASE}-01-02/pikafish.nnue')`,
    `const PINNED = resolve(HOME, 'projects/tools/${OLD_PIN_DIR}/src')`,
    `ENGINE_NETWORK_SHA256 = "${OLD_NET}d7516d9b0f668447f9ca1931241538bdc689cde6fec6a991ac4d5f77"`,
  ]) {
    assert.match(planted, RETIRED, planted);
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text a script would hold.
  assert.doesNotMatch("join(homedir(), 'projects/tools', `pikafish-${pin}-cc0`)", RETIRED);
});

test('no tracked script, app or package names a retired Pikafish build', () => {
  let hits = '';
  try {
    hits = execFileSync(
      'git',
      ['grep', '-nE', RETIRED.source, '--', 'scripts', 'apps', 'packages'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if (error.status !== 1) throw error;
  }
  assert.equal(hits, '', `retired Pikafish builds still referenced:\n${hits}`);
});

test('offline scripts resolve the engine through the shared resolver', () => {
  for (const [script, specifier] of [
    ['scripts/article-line-evals.mjs', '../apps/server/src/xiangqi-pikafish-paths.ts'],
    ['scripts/article-variation-tree.mjs', '../apps/server/src/xiangqi-pikafish-paths.ts'],
    ['scripts/trim-sideline-tails.mjs', '../apps/server/src/xiangqi-pikafish-paths.ts'],
    ['scripts/probe-win-curve-wdl.mjs', '../apps/server/src/xiangqi-pikafish-paths.ts'],
    ['scripts/xq-positive-annotations.mjs', '../apps/server/src/xiangqi-pikafish-paths.ts'],
    [
      'scripts/xiangqi-compositions/soundness-sweep.mjs',
      '../../apps/server/src/xiangqi-pikafish-paths.ts',
    ],
    ['scripts/lib/player-kit-local.mjs', '../../apps/server/src/xiangqi-pikafish-paths.ts'],
  ]) {
    const source = read(script);
    assert.ok(source.includes(`'${specifier}'`), `${script} does not import the shared resolver`);
    assert.doesNotMatch(source, /projects\/tools\/pikafish-/, `${script} hardcodes a build path`);
  }
});

test('the resolver names the pinned source and the CC0 net the build fetches', () => {
  assert.equal(PIKAFISH_XIANGQI_REF, read('pikafish.ref').split('\n')[0].trim().slice(0, 8));
  const recipe = read('scripts/engine-assets.sh');
  assert.equal(PIKAFISH_XIANGQI_NNUE_NET, /\nPIKAFISH_NET=(\S+)\n/.exec(recipe)?.[1]);
  assert.equal(PIKAFISH_XIANGQI_NNUE_SHA256, /\nPIKAFISH_NET_SHA256=(\S+)\n/.exec(recipe)?.[1]);
});

test('the Modal mining image builds the patched engine and fetches the CC0 net', () => {
  const pilot = read('scripts/modal/elephantchess_pilot.py');
  for (const input of ['pikafish.ref', 'pikafish-cc0-net.patch', 'scripts/engine-assets.sh']) {
    assert.ok(pilot.includes(`"${input.split('/').pop()}"`), `pilot image ignores ${input}`);
  }
  assert.match(pilot, /git (-C \S+ )?apply \S*pikafish-cc0-net\.patch/);
  assert.match(pilot, /sha256sum -c/);
  assert.match(pilot, /bench 16 1 13 default depth/);
});

test('generated study and article copy names the CC0 net', () => {
  const engine = 'Pikafish (Fairy-Stockfish CC0 net)';
  assert.ok(read('scripts/study-chapter-to-article.mjs').includes(`${engine}, 1,000,000 nodes`));
  assert.ok(read('scripts/player-study.mjs').includes(`name: '${engine}'`));
});
