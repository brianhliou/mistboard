#!/usr/bin/env node
/**
 * The third oracle: search every replayed composition with Pikafish and record
 * whether the engine agrees with the record.
 *
 * Legality replay proves a record is a game; it cannot tell a transcription that
 * moved a soldier one file from the book. In 金鵬秘訣 and 橘中秘 卷三 the engine
 * caught legal-but-wrong positions that replay and capture-gloss both passed, so
 * a manual does not publish on replay alone (memory project_xiangqi_pd_library).
 *
 * Two searches per record, both at the ROOT of a position, never at the tail of
 * a stored line (memory feedback_last_info_line_is_not_the_answer):
 *   start  the composition's own diagram, side to move as the replay found it
 *   end    the position after the printed mainline, if the line did not mate
 * A movetime budget cuts a search mid-iteration, so the score kept is the last
 * COMPLETE one: any `lowerbound`/`upperbound` line is discarded, not merely
 * deprioritised.
 *
 * Output is `<slug>.soundness.jsonl`, one line per record, appended as each
 * finishes; a rerun skips ids already there. Scores are from the side to move
 * at that position, as UCI reports them, with `pov` saying who that is.
 *
 *   node soundness-sweep.mjs --dir ~/projects/xiangqi-corpus/dpxq-compositions [--only a,b]
 *        [--workers 8] [--movetime 4000] [--engine <bin>] [--nnue <file>]
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    only: { type: 'string', default: '' },
    workers: { type: 'string', default: '8' },
    movetime: { type: 'string', default: '4000' },
    engine: {
      type: 'string',
      default: join(homedir(), 'projects/tools/pikafish-official-2026-01-02/MacOS/pikafish-apple-silicon'),
    },
    nnue: { type: 'string', default: join(homedir(), 'projects/tools/pikafish-official-2026-01-02/pikafish.nnue') },
  },
});
if (!values.dir) {
  console.error('usage: soundness-sweep.mjs --dir <corpus dir> [--only slug,slug] [--workers N] [--movetime ms]');
  process.exit(2);
}
if (!existsSync(values.engine)) {
  console.error(`pikafish not found at ${values.engine}`);
  process.exit(2);
}
const WORKERS = Number(values.workers);
const MOVETIME = Number(values.movetime);

function openEngine() {
  const proc = spawn(values.engine, { stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '';
  const waiters = [];
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
      for (const w of [...waiters]) {
        if (w.match(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        } else {
          w.onLine?.(line);
        }
      }
    }
  });
  const send = (cmd) => proc.stdin.write(`${cmd}\n`);
  const until = (match, onLine) => new Promise((res) => waiters.push({ match, resolve: res, onLine }));
  const ready = async () => {
    send('isready');
    await until((l) => l === 'readyok');
  };
  return { proc, send, until, ready };
}

async function startEngine() {
  const e = openEngine();
  e.send('uci');
  await e.until((l) => l === 'uciok');
  if (existsSync(values.nnue)) e.send(`setoption name EvalFile value ${values.nnue}`);
  e.send('setoption name Threads value 1');
  e.send('setoption name Hash value 64');
  await e.ready();
  return e;
}

/** Search one position; the score kept is the last complete iteration's. */
async function search(e, fen, moves) {
  e.send('ucinewgame');
  await e.ready();
  e.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
  let score = null;
  let depth = null;
  let pv = null;
  e.send(`go movetime ${MOVETIME}`);
  const best = await e.until(
    (l) => l.startsWith('bestmove'),
    (l) => {
      if (!l.startsWith('info ') || /\b(lowerbound|upperbound)\b/.test(l)) return;
      const m = /\bdepth (\d+)\b.*\bscore (cp|mate) (-?\d+)\b/.exec(l);
      if (!m) return;
      depth = Number(m[1]);
      score = { [m[2]]: Number(m[3]) };
      const p = / pv (.+)$/.exec(l);
      pv = p ? p[1].split(' ').slice(0, 6) : null;
    },
  );
  return { score, depth, pv, bestmove: best.split(' ')[1] ?? null };
}

/** Which side the record's verdict says wins, or draw; null when it does not say. */
function claimed(verdict) {
  if (!verdict) return null;
  const v = verdict.slice(0, 24);
  if (/和/.test(v)) return 'draw';
  if (/黑[先胜勝]|黑方?胜|黑勝/.test(v)) return 'black';
  if (/红[先胜勝]|紅[先勝]|红方?胜|胜/.test(v)) return 'red';
  return null;
}

/** The engine's view of the root, in the same vocabulary as `claimed`. */
function engineView(score, pov) {
  if (!score) return null;
  if (score.mate !== undefined) return score.mate > 0 ? pov : pov === 'red' ? 'black' : 'red';
  const cp = score.cp;
  if (Math.abs(cp) < 120) return 'draw';
  return cp > 0 ? pov : pov === 'red' ? 'black' : 'red';
}

const only = new Set(values.only.split(',').filter(Boolean));
const books = readdirSync(values.dir)
  .filter((f) => f.endsWith('.verify.json'))
  .map((f) => f.replace(/\.verify\.json$/, ''))
  .filter((slug) => only.size === 0 || only.has(slug))
  .sort();

const jobs = [];
for (const slug of books) {
  const outPath = join(values.dir, `${slug}.soundness.jsonl`);
  const done = new Set();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        done.add(JSON.parse(line).id);
      } catch {
        // a line cut short by the death this file exists to survive
      }
    }
  }
  const verify = JSON.parse(readFileSync(join(values.dir, `${slug}.verify.json`), 'utf8'));
  for (const rec of verify.records) {
    if (rec.error || !rec.engineFen || done.has(rec.id)) continue;
    jobs.push({ slug, outPath, rec });
  }
  console.log(`${slug}: ${verify.records.length} records, ${done.size} already swept`);
}
console.log(`${jobs.length} records to sweep on ${WORKERS} workers at ${MOVETIME} ms per search`);

let next = 0;
let finished = 0;
const started = Date.now();
async function worker() {
  const e = await startEngine();
  for (;;) {
    const job = jobs[next++];
    if (!job) break;
    const { rec } = job;
    const root = await search(e, rec.engineFen, []);
    const mated = rec.end?.status?.type === 'finished' && rec.end.status.reason === 'checkmate';
    let end = null;
    if (!mated && rec.plies > 1) {
      // The replay already proved the line legal, so the engine starts exactly
      // where the book stops.
      end = await search(e, rec.engineFen, rec.engineUci ?? []);
    }
    const claim = claimed(rec.verdict);
    const view = engineView(root.score, rec.turn);
    const row = {
      id: rec.id,
      title: rec.title,
      vol: rec.vol,
      pov: rec.turn,
      plies: rec.plies,
      lineMates: mated,
      claim,
      root,
      end,
      engineView: view,
      agrees: claim && view ? claim === view : null,
    };
    appendFileSync(job.outPath, `${JSON.stringify(row)}\n`, 'utf8');
    finished += 1;
    if (finished % 25 === 0 || finished === jobs.length) {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      console.log(`  ${finished}/${jobs.length} after ${mins} min`);
    }
  }
  e.send('quit');
}

await Promise.all(Array.from({ length: Math.min(WORKERS, Math.max(jobs.length, 1)) }, worker));
console.log('sweep complete');
