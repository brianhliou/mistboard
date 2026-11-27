// Gate for the AB-JChess WebAssembly build (build-ab-jchess-wasm.sh).
//
//   node ab-jchess-wasm-gate.cjs <dir with abjchess.js + abjchess.wasm> <abjchess-20261030.nnue>
//
// Loads the module the way the browser worker does (net written into the module
// filesystem, UCI lines through abj_command), then checks what the analysis
// board relies on: the ChaseRule option, a search from the start and from a
// mid-game public FEN (face-down points, a pool with a zero count and the
// captured face-down surplus), 4-character moves, and that a bad FEN is
// reported rather than searched. Exits non-zero on any failure.
const path = require('node:path');
const fs = require('node:fs');

const [dir, net] = process.argv.slice(2);
if (!dir || !net) {
  console.error('usage: node ab-jchess-wasm-gate.cjs <dist dir> <net>');
  process.exit(2);
}
const START =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1';
// A random game at ply 25 (seed 1 of the build check): Black to move.
const MIDGAME =
  'x1x1k4/4pR3/2n3r2/xnx1x3x/9/9/X1X1X4/4P1B2/1A7/1X1XKXXX1 b R1A1C1P4N2B0r1a1c1p3n0b2 0 13';
const MOVE = /^[a-i][0-9][a-i][0-9]$/;

(async () => {
  const lines = [];
  const waiters = [];
  const print = (text) => {
    const line = String(text);
    lines.push(line);
    for (const w of [...waiters]) {
      if (w.test(line)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  };
  const waitFor = (test, ms = 60000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting (${test})`)), ms);
      waiters.push({ test, resolve: (l) => (clearTimeout(timer), resolve(l)) });
    });
  const factory = require(path.resolve(dir, 'abjchess.js'));
  const mod = await factory({ print, printErr: (l) => console.error(`[stderr] ${l}`) });
  mod.FS.writeFile('/abjchess-20261030.nnue', fs.readFileSync(net));
  const send = mod.cwrap('abj_command', 'number', ['string']);
  const failures = [];
  const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) failures.push(what);
  };

  let done = waitFor((l) => l === 'uciok');
  send('uci');
  await done;
  check(
    lines.some((l) => l.startsWith('id name AB JChess')),
    'id name AB JChess',
  );
  check(
    lines.some((l) => /^option name ChaseRule type combo/.test(l)),
    'ChaseRule option',
  );
  send('setoption name ChaseRule value default');
  done = waitFor((l) => l === 'readyok');
  send('isready');
  await done;

  for (const [name, fen] of [
    ['start', START],
    ['midgame', MIDGAME],
  ]) {
    const from = lines.length;
    send(`position fen ${fen}`);
    done = waitFor((l) => l.startsWith('bestmove'));
    send('go depth 10');
    const best = (await done).split(/\s+/)[1] ?? '';
    const infos = lines.slice(from).filter((l) => l.startsWith('info depth'));
    check(MOVE.test(best), `${name}: bestmove ${best}`);
    check(
      infos.some((l) => / depth 10 /.test(l) && / pv [a-i][0-9][a-i][0-9]/.test(l)),
      `${name}: depth 10 line`,
    );
    check(!lines.slice(from).some((l) => l.startsWith('info string bad')), `${name}: FEN accepted`);
  }

  const from = lines.length;
  done = waitFor((l) => l.startsWith('info string bad fen'), 5000);
  send('position fen not-a-fen w - 0 1');
  await done.then(
    () => check(true, 'bad FEN reported'),
    () => check(false, 'bad FEN reported'),
  );
  check(
    lines.slice(from).every((l) => !l.startsWith('bestmove')),
    'bad FEN not searched',
  );

  console.log(failures.length ? `${failures.length} failure(s)` : 'gate passed');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
