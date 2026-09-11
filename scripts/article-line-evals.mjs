#!/usr/bin/env node
/**
 * Score every engine sideline in every article, and write a chess-style
 * assessment symbol next to each one.
 *
 * Why this exists as a script rather than a pipeline stage: the annotations
 * carry `line` (what the engine wanted instead) but no eval for it. The eval
 * they do carry describes the played move, which is the move the line exists to
 * replace. So the symbol has to be measured.
 *
 * WHERE it is measured is the whole correctness question, and the first version
 * of this got it wrong. It replayed the line and searched the position at the
 * END of it. A principal variation's tail is the least reliable part of a
 * search: those moves come out of the transposition table and are never
 * re-verified the way the root is, so the last move of a stored line is often
 * not a move the engine would actually play. Searching after it scores a
 * position the line never reaches. Measured over the 183 lines these articles
 * ship, 18 ended on a non-engine move that swung 150cp or more against the side
 * that played it, and three flipped the verdict outright: one line offered to
 * Black as an improvement was labelled `+−`, Red winning, because its final
 * stored move hung a piece.
 *
 * A line is the engine's best play from the position it starts in, so the value
 * of the line IS the score of that position. That is a root score, which the
 * engine reports exactly, and it cannot disagree with the judgment sitting
 * beside it: a line offered because a move lost ground must come out at least as
 * good for the mover as the move they played. So this searches the ROOT.
 *
 * Reads the article's own specs, so it cannot drift from what the page renders.
 * Writes JSON keyed by "<boardIndex>:<ply>"; a separate step bakes it in, which
 * keeps the measuring and the editing separable and re-runnable.
 *
 *   node scripts/article-line-evals.mjs [--nodes N] [--write]
 *
 * --write bakes the symbols into the article sources as `lineEval`. Without it
 * the run only measures, which is what you want when checking a threshold
 * change. Re-running is safe: a `lineEval` already present is replaced.
 *
 * The default budget matches the article's stated methodology (Pikafish at a
 * million nodes a position), so the symbols and the annotations are the same
 * engine at the same strength.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { parseStandardXiangqiFen, standardXiangqiEngineFen } from '../packages/game/dist/index.js';
import { resolve as stubCss } from './lib/stub-css-hooks.mjs';

const HOME = process.env.HOME ?? '';
const BIN =
  process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH ??
  resolve(HOME, 'projects/tools/pikafish-official-2026-01-02/MacOS/pikafish-apple-silicon');
const NET =
  process.env.MISTBOARD_PIKAFISH_XIANGQI_NET ??
  resolve(HOME, 'projects/tools/pikafish-official-2026-01-02/pikafish.nnue');

// Article modules import stylesheets, and some read `window` at module scope to
// pick up a stored board theme. Neither exists under node. Both are stubbed
// rather than tolerated: a module this script cannot read is an article that
// could ship without assessments, which is the case it exists to catch.
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

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const NODES = Number(flag('nodes', '1000000'));
const OUT = flag('out', 'scripts/data/article-line-evals.json');
const ARTICLE_SOURCES = 'apps/web/src/articles/content';

/**
 * Pikafish speaks the SAME coordinates we store: files a-i, ranks 0-9 with 0 as
 * Red's back rank. Verified by playing "h2e2 h9g7 b0c2" into it and reading the
 * FEN back; the rank+1 form other engines use leaves the start position
 * untouched, because every move is illegal and UCI silently drops the command.
 * That failure is invisible from the outside: you get a full run of evaluations
 * that are all the opening position, clustered around +25, and they look like
 * data. So this validates rather than converts.
 */
function toEngineMove(token) {
  if (!/^[a-i]\d[a-i]\d$/.test(token)) throw new Error(`not an ICCS move: ${token}`);
  return token;
}

/** The article's start FEN as the engine wants it, with whose move it is. */
function engineFen(startFen) {
  const parsed = parseStandardXiangqiFen(startFen);
  if (!parsed.ok) throw new Error(`start FEN does not parse: ${startFen}`);
  return {
    fen: standardXiangqiEngineFen(parsed.state),
    redToMove: parsed.state.status.type === 'playing' ? parsed.state.status.turn === 'red' : true,
  };
}

function positionCommand(fen, moves) {
  const base = fen ? `position fen ${fen.fen}` : 'position startpos';
  return moves.length ? `${base} moves ${moves.join(' ')}` : base;
}

/**
 * Assessment symbols, in the notation the reader already knows from chess
 * literature. Thresholds are the conventional ones; a xiangqi pawn is worth
 * about what a chess pawn is to these engines, so the scale carries over.
 */
function symbolFor({ cp, mate }) {
  if (mate != null && mate !== 0) return mate > 0 ? '+−' : '−+';
  if (cp == null) return null;
  const a = Math.abs(cp);
  if (a < 30) return '=';
  const sign = cp > 0;
  if (a < 90) return sign ? '⩲' : '⩱';
  if (a < 250) return sign ? '±' : '∓';
  return sign ? '+−' : '−+';
}

function openEngine() {
  if (!existsSync(BIN)) throw new Error(`pikafish not found at ${BIN}`);
  const proc = spawn(BIN, { stdio: ['pipe', 'pipe', 'ignore'] });
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
  const until = (match, onLine) =>
    new Promise((res) => waiters.push({ match, resolve: res, onLine }));
  return { proc, send, until };
}

/**
 * Every article that has at least one engine sideline, with its own boards.
 *
 * The content modules are imported one at a time rather than through
 * articles-data, which reaches a module that imports a stylesheet and cannot be
 * loaded outside the bundler. A module that will not load is REPORTED, never
 * skipped quietly: silently missing an article is how one ships without
 * assessments, which is the thing this script exists to prevent.
 */
async function annotatedArticles() {
  const files = readdirSync(ARTICLE_SOURCES).filter((f) => f.endsWith('.ts'));
  const articles = [];
  const unreadable = [];
  for (const file of files) {
    try {
      const mod = await import(`../${ARTICLE_SOURCES}/${file}`);
      for (const value of Object.values(mod)) {
        if (value && typeof value === 'object' && 'slug' in value && 'sections' in value) {
          articles.push(value);
        }
      }
    } catch (err) {
      unreadable.push(`${file}: ${String(err).split('\n')[0]}`);
    }
  }
  if (unreadable.length) {
    console.warn(`could not load ${unreadable.length} article module(s):`);
    for (const u of unreadable) console.warn(`  ${u}`);
  }
  const found = [];
  for (const article of articles) {
    // Intro boards first, then sections, the order the page renders them in.
    // A post can open on its worked position before any heading.
    const boards = [
      ...(article.intro ?? []),
      ...(article.sections ?? []).flatMap((s) => s.blocks ?? []),
    ].filter((b) => b?.kind === 'xq-replay');
    const lines = boards.reduce(
      (n, b) => n + Object.values(b.spec.annotations?.byPly ?? {}).filter((a) => a.line).length,
      0,
    );
    if (lines > 0) found.push({ slug: article.slug, boards, lines });
  }
  return found;
}

/**
 * Bake symbols into one article source.
 *
 * The specs are top-level consts whose order in the FILE is not the order the
 * sections reference them in, so a symbol cannot be placed by counting `line:`
 * occurrences. Each const carries its own `iccs`, and the loaded article gives
 * iccs -> board index, which is the only stable bridge between the two.
 */
function bake(slug, boards, evals) {
  const path = `${ARTICLE_SOURCES}/${slug.replace(/[^a-z0-9-]/g, '')}.ts`;
  if (!existsSync(path)) return { path, inserted: 0, skipped: 'no such source' };
  let src = readFileSync(path, 'utf8');
  const boardOf = new Map(boards.map((b, i) => [b.spec.iccs, i]));

  // Drop any previous run's symbols so re-running cannot stack them.
  // Both key styles: hand-authored specs are TS object literals with unquoted
  // keys, generated ones are JSON. A regex that knew only one silently skipped a
  // whole board, which the coverage test then reported as a missing assessment.
  src = src.replace(/\n\s*"?lineEval"?: "[^"]*",?/g, '');

  const blocks = [...src.matchAll(/^const (\w+): XiangqiReplaySpec = \{/gm)];
  const inserts = [];
  blocks.forEach((m, bi) => {
    const start = m.index + m[0].length;
    const end = bi + 1 < blocks.length ? blocks[bi + 1].index : src.length;
    const body = src.slice(start, end);
    const iccs = /"?iccs"?: "([^"]+)"/.exec(body);
    const board = iccs ? boardOf.get(iccs[1]) : undefined;
    if (board === undefined) return;
    let ply = null;
    for (const t of body.matchAll(/("(\d+)":\s*\{)|(\n(\s*)"?line"?: ")/g)) {
      if (t[2]) {
        ply = Number(t[2]);
        continue;
      }
      const hit = evals[`${slug}:${board}:${ply}`];
      if (!hit?.symbol) continue;
      const valueEnd = body.indexOf('"', t.index + t[0].length);
      const afterComma = body[valueEnd + 1] === ',' ? valueEnd + 2 : valueEnd + 1;
      inserts.push([start + afterComma, t[4], hit.symbol, body[valueEnd + 1] !== ',']);
    }
  });

  inserts.sort((a, b) => a[0] - b[0]);
  let out = '';
  let prev = 0;
  for (const [pos, indent, symbol, needsComma] of inserts) {
    // A JSON-formatted spec has no trailing comma after `line`, so one is added
    // before the new key rather than after it.
    out += `${src.slice(prev, pos)}${needsComma ? ',' : ''}\n${indent}"lineEval": "${symbol}"`;
    prev = pos;
  }
  writeFileSync(path, out + src.slice(prev));
  return { path, inserted: inserts.length };
}

async function main() {
  const write = args.includes('--write');
  const found = await annotatedArticles();
  const jobs = [];
  for (const { slug, boards } of found) {
    boards.forEach((block, boardIndex) => {
      const mainline = block.spec.iccs.trim().split(/\s+/);
      for (const [plyKey, a] of Object.entries(block.spec.annotations?.byPly ?? {})) {
        if (!a.line) continue;
        const ply = Number(plyKey);
        // The line replaces the played move, so it starts from the position
        // BEFORE that move. Scoring that position scores the line.
        const root = mainline.slice(0, ply - 1).map(toEngineMove);
        const leaf = [...mainline.slice(0, ply - 1), ...a.line.trim().split(/\s+/)].map(
          toEngineMove,
        );
        // A chapter set from a FEN starts there, not at the opening, and the
        // side to move comes from the FEN too: the parity below reads it.
        const fen = block.spec.startFen ? engineFen(block.spec.startFen) : null;
        jobs.push({
          key: `${slug}:${boardIndex}:${ply}`,
          moves: root,
          leaf,
          fen,
          fenRedToMove: fen ? fen.redToMove : true,
        });
      }
    });
  }
  const only = flag('only', '');
  const limit = Number(flag('limit', '0'));
  const selected = jobs.filter((j) => !only || j.key.includes(only)).slice(0, limit || jobs.length);
  // --leaf-check also searches the end of each line, which is what the broken
  // version used. It is a diagnostic, never the answer: the gap between the two
  // is the size of the bug, so a run that reports zero disagreements is a run
  // that could have used either.
  const leafCheck = args.includes('--leaf-check');
  console.log(
    `${found.map((f) => `${f.slug} (${f.lines})`).join(', ')} -> ${selected.length} of ${jobs.length} sidelines, ${NODES} nodes each${leafCheck ? ', with leaf cross-check' : ''}`,
  );

  const { proc, send, until } = openEngine();
  send('uci');
  await until((l) => l === 'uciok');
  if (existsSync(NET)) send(`setoption name EvalFile value ${NET}`);
  send('setoption name Threads value 4');
  send('isready');
  await until((l) => l === 'readyok');

  const out = {};
  const disagreed = [];
  let done = 0;
  for (const job of selected) {
    send('ucinewgame');
    send('isready');
    await until((l) => l === 'readyok');
    send(positionCommand(job.fen, job.moves));
    let cp = null;
    let mate = null;
    send(`go nodes ${NODES}`);
    await until(
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
    // Pikafish reports from the side to move; the articles speak Red POV.
    const redToMove = (job.moves.length % 2 === 0) === (job.fenRedToMove ?? true);
    const redCp = cp == null ? null : redToMove ? cp : -cp;
    // `mate 0` means the side to move is ALREADY mated, and it is the one mate
    // value that carries no sign of its own: negating zero loses which side lost.
    // Resolve it from whose turn it is instead, or the line that ends in
    // checkmate is the one line with no assessment on it.
    const redMate =
      mate == null ? null : mate === 0 ? (redToMove ? -1 : 1) : redToMove ? mate : -mate;
    const symbol = symbolFor({ cp: redCp, mate: redMate });
    out[job.key] = { cp: redCp, mate: redMate, symbol };

    if (leafCheck) {
      send('ucinewgame');
      send('isready');
      await until((l) => l === 'readyok');
      send(positionCommand(job.fen, job.leaf));
      let lcp = null;
      let lmate = null;
      send(`go nodes ${NODES}`);
      await until(
        (l) => l.startsWith('bestmove'),
        (l) => {
          const m = /score (cp|mate) (-?\d+)/.exec(l);
          if (!m) return;
          if (m[1] === 'cp') {
            lcp = Number(m[2]);
            lmate = null;
          } else {
            lmate = Number(m[2]);
            lcp = null;
          }
        },
      );
      const leafRed = (job.leaf.length % 2 === 0) === (job.fenRedToMove ?? true);
      const leafCp = lcp == null ? null : leafRed ? lcp : -lcp;
      const leafMate =
        lmate == null ? null : lmate === 0 ? (leafRed ? -1 : 1) : leafRed ? lmate : -lmate;
      const leafSymbol = symbolFor({ cp: leafCp, mate: leafMate });
      if (leafSymbol !== symbol) {
        disagreed.push({ key: job.key, root: symbol, leaf: leafSymbol, rootCp: redCp, leafCp });
      }
    }

    done += 1;
    if (done % 20 === 0 || done === selected.length) console.log(`  ${done}/${selected.length}`);
  }
  proc.kill();

  if (leafCheck) {
    console.log(`\nroot vs leaf: ${disagreed.length} of ${selected.length} disagree`);
    for (const d of disagreed.slice(0, 20)) {
      console.log(`  ${d.key}: root ${d.root} (${d.rootCp}cp)  leaf ${d.leaf} (${d.leafCp}cp)`);
    }
  }

  // A filtered run measures a SUBSET. It used to leave the file untouched, so
  // adding one article meant re-measuring every line in every other article,
  // and at four threads a re-measure moves a handful of symbols on lines nobody
  // changed. A partial run now merges its keys into the file and bakes only the
  // articles it measured; a full run still owns the file outright.
  const partial = selected.length !== jobs.length;
  const merged =
    partial && existsSync(OUT) ? { ...JSON.parse(readFileSync(OUT, 'utf8')), ...out } : out;
  writeFileSync(OUT, `${JSON.stringify(merged, null, 2)}\n`);
  const tally = {};
  for (const v of Object.values(merged)) tally[v.symbol] = (tally[v.symbol] ?? 0) + 1;
  console.log(partial ? `merged ${selected.length} into` : 'wrote', OUT, tally);

  if (write) {
    const measuredSlugs = new Set(selected.map((j) => j.key.split(':')[0]));
    for (const { slug, boards } of found) {
      if (partial && !measuredSlugs.has(slug)) continue;
      const r = bake(slug, boards, merged);
      console.log(`  baked ${r.inserted} into ${r.path}${r.skipped ? ` (${r.skipped})` : ''}`);
    }
  } else {
    console.log('measured only; pass --write to bake the symbols in');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
