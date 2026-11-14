// Offline behavioral proof using the shipped FSF WASM core and the actual CC0
// weights. The production-native pin is separately gated by fetch-fsf-xiangqi-net.sh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  standardXiangqiFsfRules,
  XIANGQI_FSF_NNUE_NET,
  XIANGQI_FSF_SERVING_NET,
} from './xiangqi-fsf-engine.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// Isolate the Emscripten runtime: its quit command exits the host process, and
// its old CommonJS pthread glue needs to live outside the repo's ESM package.
const probe = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const Stockfish = require('./stockfish.js');
const config = JSON.parse(process.argv[2]);
const deadline = setTimeout(() => { console.error('FSF probe timed out'); process.exit(1); }, 20000);
(async () => {
  const lines = [];
  const sf = await Stockfish({
    wasmBinary: fs.readFileSync(path.join(__dirname, 'stockfish.wasm')),
    print: () => {},
  });
  sf.addMessageListener(line => lines.push(line));
  const waitFor = async predicate => {
    for (let i = 0; i < 1000; i++) {
      if (lines.some(predicate)) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('No FSF response: ' + lines.join('\n'));
  };
  sf.FS.writeFile('variants.ini', fs.readFileSync(config.iniPath));
  if (config.netPath) {
    const net = fs.readFileSync(config.netPath);
    sf.FS.writeFile(config.originalNet, net);
    sf.FS.writeFile(config.servingNet, net);
  }
  sf.postMessage('uci');
  await waitFor(line => line === 'uciok');
  sf.postMessage('setoption name VariantPath value variants.ini');
  const results = [];
  for (const variant of ['xiangqi', config.variant]) {
    for (const nnue of config.netPath ? [false, true] : [false]) {
      for (const clock of [0, 100, 118, 120]) {
        lines.length = 0;
        sf.postMessage('setoption name Use NNUE value ' + nnue);
        const filename = variant === 'xiangqi' ? config.originalNet : config.servingNet;
        sf.postMessage('setoption name EvalFile value ' + filename);
        sf.postMessage('setoption name UCI_Variant value ' + variant);
        sf.postMessage('ucinewgame');
        sf.postMessage('position fen 3k5/9/9/9/9/9/9/9/R8/4K4 w - - ' + clock + ' 1');
        sf.postMessage('isready');
        await waitFor(line => line === 'readyok');
        lines.length = 0;
        // A fixed quiet move avoids the chariot's mate in one and isolates the
        // draw clock from move ordering and mate overriding a draw claim.
        sf.postMessage('go depth 1 searchmoves a2a3');
        await waitFor(line => line.startsWith('bestmove'));
        const score = lines.find(line => line.includes(' score cp '));
        if (!score) throw new Error('Missing cp score: ' + lines.join('\n'));
        results.push({ variant, nnue, clock, cp: Number(score.match(/ score cp (-?\d+)/)[1]),
          evaluation: lines.find(line => line.includes('evaluation')) });
      }
    }
  }
  console.log(JSON.stringify(results));
  clearTimeout(deadline);
  sf.postMessage('quit');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
`;

test('standard xiangqi FSF keeps evaluating at 100 plies, draws at 120, and still loads NNUE', (t) => {
  // The CC0 net is gitignored and fetched at build time, so hosted CI has no
  // copy: there the draw rule is checked on the classical eval only, and the
  // image build's fetch-fsf-xiangqi-net.sh proves the NNUE load.
  const netPath = resolve(repoRoot, 'apps/web/public/engine/pikafish', XIANGQI_FSF_NNUE_NET);
  const hasNet = existsSync(netPath);
  if (!hasNet) t.diagnostic(`no ${XIANGQI_FSF_NNUE_NET} in this checkout: NNUE half skipped`);
  const dir = mkdtempSync(join(tmpdir(), 'fsf-standard-xiangqi-'));
  try {
    const assets = resolve(repoRoot, 'apps/web/public/engine/fairy-stockfish');
    for (const filename of ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js']) {
      copyFileSync(resolve(assets, filename), join(dir, filename));
    }
    const script = join(dir, 'probe.cjs');
    writeFileSync(script, probe);
    const rules = standardXiangqiFsfRules();
    const output = execFileSync(
      process.execPath,
      [
        script,
        JSON.stringify({
          ...rules,
          originalNet: XIANGQI_FSF_NNUE_NET,
          servingNet: XIANGQI_FSF_SERVING_NET,
          netPath: hasNet ? netPath : null,
        }),
      ],
      { encoding: 'utf8', timeout: 25_000 },
    );
    const results = JSON.parse(output.trim().split('\n').at(-1)!) as {
      variant: string;
      nnue: boolean;
      clock: number;
      cp: number;
      evaluation: string;
    }[];
    assert.equal(results.length, hasNet ? 16 : 8);
    for (const result of results) {
      assert.match(result.evaluation, result.nnue ? /NNUE evaluation using/ : /classical/);
      const drawn = result.clock >= (result.variant === 'xiangqi' ? 100 : 120);
      if (drawn) assert.equal(result.cp, 0, JSON.stringify(result));
      else assert.ok(result.cp > 0, JSON.stringify(result));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
