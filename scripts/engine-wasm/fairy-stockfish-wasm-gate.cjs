// Perft gate for the patched Fairy-Stockfish WASM, run under node 16 next to
// the built artifacts (see build-fairy-stockfish-wasm.sh; node 18+ fetches a
// file path and aborts in the 2.0.26 glue). Loads the engine the way the
// browser does, the variant definitions written into its MEMFS, then perft(1)s
// each position against the kernel's own count: the three atomic gates railpack
// asserts on the native binary, and the xiangqi opening to show the shared
// variant still loads. A binary that plays a different game does not crash.
const fs = require('node:fs');
const Stockfish = require('./stockfish.js');

const CASES = [
  ['atomicxiangqi', 'startpos', 44],
  ['atomicxiangqi', 'fen 3ak4/3r5/9/9/9/9/9/3C5/9/4K4 w - - 0 1', 3],
  ['atomicxiangqi', 'fen 3ak4/9/9/9/9/9/9/3R5/9/4K4 w - - 0 1', 4],
  ['fortressxiangqi', 'startpos', null],
  ['xiangqi', 'startpos', 44],
];

async function main() {
  const lines = [];
  const sf = await Stockfish();
  sf.addMessageListener((line) => lines.push(line));
  sf.FS.writeFile('variants.ini', fs.readFileSync('public/variants.ini', 'utf8'));
  const send = (cmd) => sf.postMessage(cmd);
  const waitFor = (pred) =>
    new Promise((resolve) => {
      const tick = () => {
        const hit = lines.find(pred);
        if (hit) return resolve(hit);
        setTimeout(tick, 20);
      };
      tick();
    });
  send('uci');
  await waitFor((l) => l === 'uciok');
  console.log(lines.find((l) => l.startsWith('id name')));
  send('setoption name VariantPath value variants.ini');
  send('isready');
  await waitFor((l) => l === 'readyok');
  let failed = 0;
  for (const [variant, pos, want] of CASES) {
    lines.length = 0;
    send(`setoption name UCI_Variant value ${variant}`);
    send('ucinewgame');
    send(`position ${pos}`);
    send('isready');
    await waitFor((l) => l === 'readyok');
    lines.length = 0;
    send('go perft 1');
    const hit = await waitFor((l) => l.startsWith('Nodes searched'));
    const got = Number(hit.split(':')[1]);
    const ok = want === null || got === want;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${variant} ${pos} -> ${got}${want === null ? '' : ` (want ${want})`}`,
    );
  }
  send('quit');
  process.exit(failed ? 1 : 0);
}
main();
