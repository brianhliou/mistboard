#!/usr/bin/env node
// Write the advantage-chart analysis for every article game that is not in the
// broadcast archive, so its board draws the same chart an archive board does
// (apps/web/src/article-replay-analysis.ts reads the files).
//
//   npm run build --workspace @mistboard/server     # the analysis code runs from dist
//   MISTBOARD_PIKAFISH_XIANGQI_PATH=~/projects/tools/pikafish-6a59ee2f/src/pikafish \
//   MISTBOARD_PIKAFISH_XIANGQI_NET=~/projects/tools/pikafish-6a59ee2f/src/pikafish.nnue \
//     node scripts/article-chart-analysis.mjs [--dry-run] [--concurrency 4]
//
// One series per game, from the SAME function the site's postgame route and the
// archive sweep cache (analyzeXiangqiPostgame: Pikafish at the site's node
// budget, engineId pikafish-xiangqi-analysis@5), on the pikafish.ref pin. Before
// running the engine it looks for that exact series already on disk: an
// annotate-game.mjs --json run at the site budget carries it as `site`
// (docs-private/players/*/annot1m/<dpxq key>.json), matched to the article
// record through the harvested dpxq move lists. A file already written for the
// same record is kept. Only cp/mate/best per ply is stored: the chart reads no
// more, and the article page fetches the file.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps/web');
const OUT = join(WEB, 'src/articles/analysis');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const concurrencyArg = args.indexOf('--concurrency');
const concurrency = concurrencyArg === -1 ? 4 : Math.max(1, Number(args[concurrencyArg + 1]) || 1);

// docs-private is gitignored and lives in the primary checkout only, so a task
// worktree looks there too.
function docsPrivateDirs() {
  const dirs = [join(ROOT, 'docs-private')];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT })
      .toString()
      .trim();
    dirs.push(join(resolve(ROOT, common), '..', 'docs-private'));
  } catch {
    // not a git checkout: the local dir is all there is
  }
  return [...new Set(dirs.map((d) => resolve(d)))].filter((d) => existsSync(d));
}

// Some article modules draw their diagrams at import time and read display
// preferences off `window`: give them a DOM, as prerender-articles.mjs does.
const { Window } = await import('happy-dom');
const win = new Window({ url: 'https://mistboard.com' });
for (const [key, value] of [
  ['window', win],
  ['document', win.document],
  ['navigator', win.navigator],
  ['localStorage', win.localStorage],
]) {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    // a read-only Node global: leave it
  }
}

const { createServer } = await import('vite');
const vite = await createServer({
  root: WEB,
  configFile: join(WEB, 'vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

let records;
let articleAnalysisKey;
try {
  const { articles } = await vite.ssrLoadModule('/src/articles-data.ts');
  ({ articleAnalysisKey } = await vite.ssrLoadModule('/src/article-replay-analysis.ts'));
  const { articleReplayRecords } = await vite.ssrLoadModule(
    '/src/article-replay-analysis-coverage.ts',
  );
  records = articleReplayRecords(articles).filter((r) => r.chart === 'static');
} finally {
  await vite.close();
}

// One job per distinct record (a game on two pages is one file).
const jobs = new Map();
for (const { slug, spec } of records) {
  const key = articleAnalysisKey(spec);
  const job = jobs.get(key) ?? { key, spec, pages: [] };
  job.pages.push(`${slug}: ${spec.red} vs ${spec.black}`);
  jobs.set(key, job);
}

const movesOf = (iccs) => iccs.trim().split(/\s+/).filter(Boolean);
// ICCS tokens (ranks 0-9) are Pikafish UCI; our squares count ranks 1-10.
const toSquares = (uci) => ({
  from: `${uci[0]}${Number(uci[1]) + 1}`,
  to: `${uci[2]}${Number(uci[3]) + 1}`,
});

// Cached site series, by move list: dpxq key -> moves, then the annotate run.
const docsDirs = docsPrivateDirs();
const dpxqByMoves = new Map();
for (const docs of docsDirs) {
  const dir = join(docs, 'games/dpxq');
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const game = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (!Array.isArray(game.moves)) continue;
      const uci = game.moves.map(
        (m) => `${m.from[0]}${Number(m.from.slice(1)) - 1}${m.to[0]}${Number(m.to.slice(1)) - 1}`,
      );
      dpxqByMoves.set(uci.join(' '), game.key ?? name.replace(/\.json$/, ''));
    } catch {
      // a malformed harvest file is not this script's problem
    }
  }
}
const annotFiles = [];
for (const docs of docsDirs) {
  const players = join(docs, 'players');
  if (!existsSync(players)) continue;
  for (const player of readdirSync(players)) {
    const dir = join(players, player, 'annot1m');
    if (existsSync(dir)) annotFiles.push(dir);
  }
}

// Each worker holds one Pikafish process, so the analysis pool needs as many
// slots; the pool reads this when its module loads.
process.env.MISTBOARD_PIKAFISH_ANALYSIS_MAX_PROCESSES ??= String(concurrency);
const { analyzeXiangqiPostgame } = await import(
  join(ROOT, 'apps/server/dist/routes/xiangqi-games.js')
);
const { XIANGQI_ANALYSIS_ENGINE_ID } = await import(
  join(ROOT, 'apps/server/dist/xiangqi-analysis.js')
);

function cachedSite(moves) {
  const dpxqKey = dpxqByMoves.get(moves.join(' '));
  if (!dpxqKey) return null;
  for (const dir of annotFiles) {
    const file = join(dir, `${dpxqKey}.json`);
    if (!existsSync(file)) continue;
    const annot = JSON.parse(readFileSync(file, 'utf8'));
    const site = annot.site;
    if (!site || site.engineId !== XIANGQI_ANALYSIS_ENGINE_ID) continue;
    if (site.plies.length !== moves.length + 1) continue;
    // The annotate rows carry each move in Pikafish UCI: the same game, move for move.
    if (!annot.rows?.every((row, i) => row.uci === moves[i])) continue;
    // The file path stays out of the shipped JSON: docs-private is private.
    return { site, source: `dpxq ${dpxqKey}, stored site-budget run` };
  }
  return { site: null, source: `dpxq ${dpxqKey}` };
}

function written(key, plies) {
  const file = join(OUT, `${key}.json`);
  if (!existsSync(file)) return false;
  try {
    const body = JSON.parse(readFileSync(file, 'utf8'));
    return body.engineId === XIANGQI_ANALYSIS_ENGINE_ID && body.plies?.length === plies + 1;
  } catch {
    return false;
  }
}

function write(key, site, source) {
  const body = {
    engineId: site.engineId,
    depth: site.depth,
    source,
    plies: [...site.plies]
      .sort((a, b) => a.ply - b.ply)
      .map((p) => ({ ply: p.ply, cp: p.cp ?? null, mate: p.mate ?? null, best: p.best ?? null })),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${key}.json`), `${JSON.stringify(body)}\n`);
}

const queue = [];
for (const job of jobs.values()) {
  const moves = movesOf(job.spec.iccs);
  if (written(job.key, moves.length)) {
    console.log(`keep    ${job.key}  ${job.pages[0]}`);
    continue;
  }
  const cached = cachedSite(moves);
  if (cached?.site) {
    console.log(`reuse   ${job.key}  ${job.pages[0]}  (${cached.source})`);
    if (!dryRun) write(job.key, cached.site, cached.source);
    continue;
  }
  console.log(`engine  ${job.key}  ${job.pages[0]}  (${moves.length} plies)`);
  queue.push({ ...job, moves, source: cached?.source ?? 'article record' });
}

if (dryRun || queue.length === 0) {
  console.log(`\n${queue.length} game(s) need an engine run${dryRun ? ' (dry run)' : ''}`);
  process.exit(0);
}

let next = 0;
let failed = 0;
async function worker() {
  while (next < queue.length) {
    const job = queue[next];
    next += 1;
    const started = Date.now();
    try {
      const timeline = job.moves.map((uci) => ({ type: 'move-played', move: toSquares(uci) }));
      const site = await analyzeXiangqiPostgame({ timeline });
      if (site.plies.length !== job.moves.length + 1) {
        throw new Error(`${site.plies.length} positions for ${job.moves.length} moves`);
      }
      write(job.key, site, `${job.source}, local run`);
      console.log(
        `done    ${job.key}  ${((Date.now() - started) / 1000).toFixed(0)}s  ${job.pages[0]}`,
      );
    } catch (error) {
      failed += 1;
      console.error(`FAILED  ${job.key}  ${job.pages[0]}: ${error?.message ?? error}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
console.log(`\n${queue.length - failed}/${queue.length} engine run(s) written to ${OUT}`);
process.exit(failed ? 1 : 0);
