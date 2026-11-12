#!/usr/bin/env node
/**
 * Trim the unsound tail off every engine sideline in the articles.
 *
 *   node scripts/trim-sideline-tails.mjs            # measure, report, write nothing
 *   node scripts/trim-sideline-tails.mjs --write    # edit the article sources
 *
 * A stored `line` is a principal variation, and a PV's tail is the least
 * verified part of a search: those moves come out of the transposition table and
 * are never re-checked the way the root is. So a line routinely ends on a move
 * the engine would never play. That was invisible while the line's verdict was
 * ALSO measured at the tail (the two errors cancelled into a confident wrong
 * answer); with the verdict now taken at the root, the bad tail is all that is
 * left, and it is the part the reader actually steps through.
 *
 * The rule: drop the final move when it BOTH costs the side playing it more than
 * THRESHOLD centipawns AND is not the move the engine plays in that position.
 * Repeat, because the move before it is often no better. Stop at a move that
 * holds, or at MIN_LEN so a line is never trimmed away to nothing.
 *
 * Both halves are needed. Cost alone eats forced moves: in a lost position every
 * legal move loses more ground as the mate approaches, so a cost-only rule
 * trimmed one line from 15 moves to 8 while every move in it was the best
 * available. Requiring the move to also differ from the engine's choice is what
 * makes the rule mean "a move the engine would not play".
 *
 * This does not re-derive the line. Re-running the whole analysis would change
 * every board on both pages; trimming removes only the moves that were never
 * trustworthy and leaves the rest of the published line as it is.
 *
 * Verdicts are unaffected: they are measured at the line's ROOT, which trimming
 * does not move. No re-measure is needed after this.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
} from '../apps/server/src/xiangqi-pikafish-paths.ts';
import { resolve as stubCss } from './lib/stub-css-hooks.mjs';

registerHooks({ resolve: stubCss });
globalThis.window ??= {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
  location: { pathname: '/', search: '', origin: 'https://mistboard.com' },
};
globalThis.localStorage ??= globalThis.window.localStorage;
globalThis.document ??= {
  documentElement: { classList: { add() {}, remove() {}, contains: () => false }, style: {} },
  createElement: () => ({
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    append() {},
  }),
  addEventListener() {},
};

// The server's engine: the patched pikafish.ref build on the CC0 net (#989).
const BIN = pikafishXiangqiPath();
const NET = pikafishXiangqiNetPath(BIN);

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
/** Detecting a blunder is coarse work; it does not need the verdict's budget. */
const NODES = Number(flag('nodes', '500000'));
/** A sound move in a best-play line does not cost its own side this much. */
const THRESHOLD = Number(flag('threshold', '100'));
/** Never trim a line away to a stub; a short line is still worth showing. */
const MIN_LEN = Number(flag('min-len', '4'));
const MAX_TRIM = Number(flag('max-trim', '8'));

const SOURCES = [
  ['xiangqi-champions', 'apps/web/src/articles/content/xiangqi-champions.ts'],
  ['xiangqi-world-championship', 'apps/web/src/articles/content/xiangqi-world-championship.ts'],
];

const mods = {
  'xiangqi-champions': (await import('../apps/web/src/articles/content/xiangqi-champions.js'))
    .xiangqiChampionsArticle,
  'xiangqi-world-championship': (
    await import('../apps/web/src/articles/content/xiangqi-world-championship.js')
  ).xiangqiWorldChampionshipArticle,
};

const toEngine = (t) => `${t[0]}${Number(t[1])}${t[2]}${Number(t[3])}`;

function openEngine() {
  const proc = spawn(BIN, { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const waiters = [];
  proc.stdout.on('data', (d) => {
    buf += d.toString();
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      for (const w of [...waiters]) w(line);
      i = buf.indexOf('\n');
    }
  });
  const send = (s) => proc.stdin.write(`${s}\n`);
  const until = (done, each) =>
    new Promise((res) => {
      const w = (l) => {
        each?.(l);
        if (done(l)) {
          waiters.splice(waiters.indexOf(w), 1);
          res(l);
        }
      };
      waiters.push(w);
    });
  return { proc, send, until };
}

async function main() {
  const jobs = [];
  for (const [slug, path] of SOURCES) {
    const boards = (mods[slug].sections ?? [])
      .flatMap((s) => s.blocks ?? [])
      .filter((b) => b?.kind === 'xq-replay')
      .map((b) => b.spec);
    boards.forEach((spec, bi) => {
      const main = spec.iccs.trim().split(/\s+/);
      for (const [plyKey, a] of Object.entries(spec.annotations?.byPly ?? {})) {
        if (!a.line) continue;
        jobs.push({
          key: `${slug}:${bi}:${plyKey}`,
          slug,
          path,
          root: main.slice(0, Number(plyKey) - 1).map(toEngine),
          line: a.line.trim().split(/\s+/),
          original: a.line,
        });
      }
    });
  }
  console.log(
    `${jobs.length} sidelines, ${NODES} nodes, trimming a final move that costs its own side more than ${THRESHOLD}cp`,
  );

  const { proc, send, until } = openEngine();
  send('uci');
  await until((l) => l === 'uciok');
  send(`setoption name EvalFile value ${NET}`);
  send('setoption name Threads value 4');
  send('isready');
  await until((l) => l === 'readyok');

  async function score(moves) {
    send('ucinewgame');
    send('isready');
    await until((l) => l === 'readyok');
    send(`position startpos moves ${moves.join(' ')}`);
    let cp = null;
    let mate = null;
    send(`go nodes ${NODES}`);
    const bestLine = await until(
      (l) => l.startsWith('bestmove'),
      (l) => {
        const m = /score (cp|mate) (-?\d+)/.exec(l);
        if (!m) return;
        if (m[1] === 'cp') {
          cp = Number(m[2]);
          mate = null;
        } else {
          mate = Number(m[2]);
          cp = null;
        }
      },
    );
    const best = bestLine.split(/\s+/)[1] ?? '';
    const redToMove = moves.length % 2 === 0;
    if (mate != null) {
      const m = mate === 0 ? (redToMove ? -1 : 1) : redToMove ? mate : -mate;
      return { cp: m > 0 ? 30000 : -30000, best };
    }
    return { cp: cp == null ? 0 : redToMove ? cp : -cp, best };
  }

  const trimmed = [];
  let done = 0;
  for (const job of jobs) {
    let line = [...job.line];
    // The score after the current last move; reused as we walk back, so each
    // extra step costs one search rather than two.
    let after = (await score([...job.root, ...line])).cp;
    let cut = 0;
    while (line.length > MIN_LEN && cut < MAX_TRIM) {
      const before = await score([...job.root, ...line.slice(0, -1)]);
      // Red POV throughout, so "bad for the mover" flips with whose move it was.
      const moverIsRed = (job.root.length + line.length - 1) % 2 === 0;
      const selfHarm = moverIsRed ? before.cp - after : after - before.cp;
      const wasEnginesChoice = before.best === line[line.length - 1];
      if (selfHarm <= THRESHOLD || wasEnginesChoice) break;
      line = line.slice(0, -1);
      after = before.cp;
      cut += 1;
    }
    if (cut)
      trimmed.push({
        key: job.key,
        cut,
        from: job.line.length,
        to: line.length,
        path: job.path,
        original: job.original,
        next: line.join(' '),
      });
    done += 1;
    if (done % 25 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length}`);
  }
  proc.kill();

  console.log(`\n${trimmed.length} of ${jobs.length} lines have an unsound tail`);
  for (const t of trimmed)
    console.log(`  ${t.key.padEnd(34)} ${t.from} -> ${t.to} moves (dropped ${t.cut})`);

  if (!args.includes('--write')) {
    console.log('\nmeasured only; pass --write to edit the article sources');
    return;
  }
  const byPath = new Map();
  for (const t of trimmed) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t]);
  for (const [path, list] of byPath) {
    let src = readFileSync(path, 'utf8');
    for (const t of list) {
      // Both spellings occur: the champions file uses a bare key, the world file
      // a quoted one. Anchor on the value, which is unique across both files.
      const needle = `"${t.original}"`;
      if (src.split(needle).length - 1 !== 1) {
        throw new Error(`${t.key}: line value is not unique in ${path}`);
      }
      src = src.replace(needle, `"${t.next}"`);
    }
    writeFileSync(path, src);
    console.log(`  rewrote ${list.length} line(s) in ${path}`);
  }
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
