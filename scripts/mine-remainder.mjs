#!/usr/bin/env node
// Mine the remaining cleared ElephantChess corpus in one command.
//
//   node scripts/mine-remainder.mjs            # run / resume
//   node scripts/mine-remainder.mjs --status   # show state, change nothing
//   node scripts/mine-remainder.mjs --dry-run  # preflight + plan only
//   node scripts/mine-remainder.mjs --containers 32 --audit-containers 4
//
// Every phase is idempotent and recorded in a state file, so a disconnect,
// Ctrl-C, or laptop sleep costs at most the work in flight. Re-running picks up
// where it stopped. It never publishes: mining fills the durable queue, and
// promoting puzzles into the served corpus stays a separate authorized step.
//
// A batch that reached `review` is finished; running again archives its state
// file beside itself and starts the next batch, which excludes every game any
// earlier run mined (the manifest is built with --exclude-mined against the
// database, not against a local list).
//
// Scan and audit want different concurrency (measured 2026-08-23): scan scaled
// 3.8x from 4 to 32 containers, while audit at depth 22 has no node cap and the
// thinner CPU share at 32 pushed 2 of 902 searches past the 240 s engine
// timeout (0 of 392 at 4). --containers sets scan; --audit-containers sets audit
// and defaults to 4 whenever --containers is given.
//
// Secrets are never read into this process. Database work is handed to
// `railway run`, which injects the connection string into a child process, and
// Modal workers read their own stored secret.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(homedir(), '.mistboard', 'mining');
const STATE_FILE = join(STATE_DIR, 'remainder-state.json');
const MODAL_SCRIPT = join(REPO_ROOT, 'scripts', 'modal', 'elephantchess_pilot.py');
const MODAL_BIN = existsSync(join(homedir(), '.local/bin/modal'))
  ? join(homedir(), '.local/bin/modal')
  : 'modal';
const SOURCE_SLUG = 'elephantchess-pvp';
const TASK_CAP = 1_000;
const SHARD_SIZE = 25;
const DEFAULT_BATCH_GAMES = 1_000;
const PILOT_YIELD = 0.356;
const CORE_HOURS_PER_1K_GAMES = 5;
const RAILWAY_LINK_HINT =
  'railway link -p edd519d3-638e-40da-81b4-a8a70eb7eb94 -e production -s web';

const { values } = parseArgs({
  options: {
    status: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    containers: { type: 'string' },
    'audit-containers': { type: 'string' },
    batch: { type: 'string' },
    all: { type: 'boolean', default: false },
    seed: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const log = (message) => console.log(message);
const step = (message) => console.log(`\n\x1b[1m${message}\x1b[0m`);

function fail(message) {
  console.error(`\n\x1b[31m${message}\x1b[0m`);
  process.exit(1);
}

if (values.help) {
  log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 16)
      .join('\n'),
  );
  process.exit(0);
}

function loadState() {
  if (!existsSync(STATE_FILE)) return { phase: 'preflight' };
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function lastJsonLine(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Modal and npm interleave human-readable progress lines; keep scanning up.
    }
  }
  return null;
}

// Hands database work to `railway run`, which injects the service environment
// into the child process. The connection string is referenced by name inside
// the child shell and never enters this process or the terminal.
function railwayShell(innerCommand) {
  return capture('railway', ['run', '-s', 'Postgres', '--', 'sh', '-c', innerCommand]);
}

// The snippet goes to a FILE, never through `node -e` inside `sh -c`. Passing
// JavaScript as a shell argument hands the shell its backticks to command-
// substitute and mangles its newlines. The file also lives under node_modules
// so a bare `require('pg')` resolves against the repo's own dependencies.
function queryProduction(snippet) {
  const queryFile = join(REPO_ROOT, 'node_modules', '.mistboard-mining-query.cjs');
  writeFileSync(queryFile, snippet, 'utf8');
  let result;
  try {
    result = railwayShell(`DATABASE_URL="$DATABASE_PUBLIC_URL" node "${queryFile}"`);
  } finally {
    rmSync(queryFile, { force: true });
  }
  if (result.status !== 0) {
    fail(
      `Could not reach production Postgres through Railway.\n${result.stderr || result.stdout}\n\n` +
        `If that said "No linked project", run this once in this directory:\n  ${RAILWAY_LINK_HINT}`,
    );
  }
  const parsed = lastJsonLine(result.stdout);
  if (!parsed) fail(`Unexpected database output:\n${result.stdout}`);
  return parsed;
}

const CORPUS_SNIPPET = `
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const q = async (sql) => (await pool.query(sql)).rows;
  const batch = await q(\`
    SELECT b.id, count(g.id)::int AS games
      FROM historical_xiangqi_import_batches b
      JOIN historical_xiangqi_sources s ON s.id = b.source_id
      JOIN historical_xiangqi_games g ON g.import_batch_id = b.id
     WHERE s.slug = '${SOURCE_SLUG}' AND s.license_status = 'cleared' AND b.status = 'completed'
     GROUP BY b.id ORDER BY games DESC LIMIT 1\`);
  const eligible = await q(\`
    SELECT count(*)::int AS n FROM historical_xiangqi_games g
      JOIN historical_xiangqi_sources s ON s.id = g.source_id
      JOIN historical_xiangqi_import_batches b ON b.id = g.import_batch_id
     WHERE s.slug = '${SOURCE_SLUG}' AND s.license_status = 'cleared'
       AND b.status = 'completed' AND g.source_game_id IS NOT NULL
       AND cardinality(g.quality_flags) = 0\`);
  const mined = await q(\`
    SELECT count(DISTINCT mg.historical_game_id)::int AS n
      FROM xiangqi_puzzle_mining_games mg
      JOIN xiangqi_puzzle_mining_runs mr ON mr.id = mg.run_id
     WHERE mr.status NOT IN ('failed','canceled')\`);
  console.log(JSON.stringify({
    importBatchId: batch[0] ? batch[0].id : null,
    eligible: eligible[0].n,
    mined: mined[0].n,
    remaining: eligible[0].n - mined[0].n,
  }));
  await pool.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

const progressSnippet = (runId) => `
const pg = require('pg');
(async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const q = async (sql, params) => (await pool.query(sql, params)).rows;
  const byStatus = (rows) => Object.fromEntries(rows.map((row) => [row.status, row.n]));
  const runRow = await q('SELECT status FROM xiangqi_puzzle_mining_runs WHERE id = $1', ['${runId}']);
  const shards = await q(
    'SELECT status, count(*)::int AS n FROM xiangqi_puzzle_mining_shards WHERE run_id = $1 GROUP BY status',
    ['${runId}']);
  const candidates = await q(
    'SELECT status, count(*)::int AS n FROM xiangqi_puzzle_mining_candidates WHERE run_id = $1 GROUP BY status',
    ['${runId}']);
  // Games actually finished, summed from durable per-shard checkpoints. This is
  // what the canary checks: a stuck worker holds a lease and moves this by zero.
  const scanned = await q(
    'SELECT coalesce(sum(next_selection_index - selection_start), 0)::int AS done FROM xiangqi_puzzle_mining_shards WHERE run_id = $1',
    ['${runId}']);
  console.log(JSON.stringify({
    runStatus: runRow[0] ? runRow[0].status : null,
    gamesScanned: scanned[0] ? scanned[0].done : 0,
    shards: byStatus(shards),
    candidates: byStatus(candidates),
  }));
  await pool.end();
})().catch((error) => { console.error(error.message); process.exit(1); });
`;

function preflight() {
  step('Preflight');
  const profile = capture(MODAL_BIN, ['profile', 'current']);
  if (profile.status !== 0) {
    fail('Modal is not authenticated. Run `modal setup`, then start this again.');
  }
  log(`  modal account        ${profile.stdout.trim()}`);

  const secrets = capture(MODAL_BIN, ['secret', 'list']);
  if (!secrets.stdout.includes('mistboard-mining-p')) {
    fail(
      'The Modal secret `mistboard-mining-production-db` is missing.\n' +
        'It must hold one key, DATABASE_URL, pointing at the PUBLIC Railway Postgres URL.',
    );
  }
  log('  modal db secret      present');

  const releaseDir =
    process.env.MISTBOARD_MODAL_PIKAFISH_DIR ??
    join(REPO_ROOT, '..', 'tools', 'pikafish-official-2026-01-02');
  for (const [label, path] of [
    ['pikafish linux build', join(releaseDir, 'Linux', 'pikafish-sse41-popcnt')],
    ['pikafish network', join(releaseDir, 'pikafish.nnue')],
  ]) {
    if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
    log(`  ${label.padEnd(21)}present`);
  }
}

function readCorpus() {
  step('Corpus coverage');
  const corpus = queryProduction(CORPUS_SNIPPET);
  if (!corpus.importBatchId) {
    fail('No completed, license-cleared ElephantChess import batch found.');
  }
  log(`  import batch         ${corpus.importBatchId}`);
  log(`  cleared + eligible   ${corpus.eligible.toLocaleString()} games`);
  log(`  already mined        ${corpus.mined.toLocaleString()} games`);
  log(`  remaining to mine    ${corpus.remaining.toLocaleString()} games`);
  if (corpus.remaining <= 0) {
    log('\nNothing left to mine. The cleared corpus is fully consumed.');
    process.exit(0);
  }
  const thisBatch = values.all ? corpus.remaining : Math.min(batchSize, corpus.remaining);
  const shards = Math.ceil(thisBatch / SHARD_SIZE);
  const coreHours = ((thisBatch / 1000) * CORE_HOURS_PER_1K_GAMES).toFixed(1);
  const expected = Math.round(thisBatch * PILOT_YIELD);
  log(
    `  THIS BATCH           ${thisBatch.toLocaleString()} games, ${shards} shards, ~${coreHours} core-hours`,
  );
  log(`  expected yield       ~${expected.toLocaleString()} puzzles at the pilot's 35.6%`);
  if (!values.all) {
    const batches = Math.ceil(corpus.remaining / batchSize);
    log(`  batches to finish    ${batches} (re-run this command per batch)`);
  }
  return corpus;
}

const batchSize = (() => {
  if (values.batch === undefined) return DEFAULT_BATCH_GAMES;
  const parsed = Number(values.batch);
  if (!Number.isSafeInteger(parsed) || parsed < 25) {
    fail('--batch must be an integer of at least 25');
  }
  return parsed;
})();

function generateManifest(corpus, existingSeed) {
  step('Generating the remainder manifest');
  mkdirSync(STATE_DIR, { recursive: true });
  const seed =
    existingSeed ??
    values.seed ??
    `elephantchess-remainder-${new Date().toISOString().slice(0, 10)}-${corpus.mined}`;
  const out = join(STATE_DIR, `${seed}.json`);
  // Batch, not the whole remainder. Every batch is a checkpoint: a bad one
  // costs a batch instead of the corpus. Targets keep the pilot's 80/10/10
  // shape. --all opts into the entire remainder.
  //
  // Size against what is actually LEFT, not the requested batch: the builder
  // demands exactly as many eligible games as the targets add up to, so a fixed
  // 2,500 would fail outright on a final batch of 969 rather than mining it.
  const effectiveBatch = Math.min(batchSize, corpus.remaining);
  const batchFlags = values.all
    ? '--fill-remaining'
    : `--representative ${Math.round(effectiveBatch * 0.8)} ` +
      `--coverage ${Math.round(effectiveBatch * 0.1)} ` +
      `--correspondence ${effectiveBatch - Math.round(effectiveBatch * 0.8) - Math.round(effectiveBatch * 0.1)}`;
  const result = railwayShell(
    `DATABASE_URL="$DATABASE_PUBLIC_URL" npm run --silent pilot:elephantchess-manifest ` +
      `--workspace @mistboard/server -- --import-batch-id "${corpus.importBatchId}" ` +
      `--seed "${seed}" --exclude-mined ${batchFlags} --out "${out}"`,
  );
  if (result.status !== 0) {
    fail(`Manifest generation failed:\n${result.stderr || result.stdout}`);
  }
  const summary = lastJsonLine(result.stdout);
  if (!summary?.coverage) fail(`Manifest generation produced no summary:\n${result.stdout}`);

  const fileSha256 = createHash('sha256').update(readFileSync(out, 'utf8')).digest('hex');
  log(`  manifest             ${out}`);
  log(`  games selected       ${summary.coverage.selected.toLocaleString()}`);
  log(`  excluded as mined    ${summary.coverage.excludedFromThisManifest.toLocaleString()}`);
  log(`  content sha256       ${summary.manifestSha256}`);
  return {
    seed,
    manifestPath: out,
    manifestFileSha256: fileSha256,
    manifestContentSha256: summary.manifestSha256,
    selected: summary.coverage.selected,
    profileVersion: `${seed}-modal-linux-sse41`,
  };
}

function pinManifest(manifest) {
  step('Pinning the manifest into the Modal launcher');
  let source = readFileSync(MODAL_SCRIPT, 'utf8');
  const pins = [
    ['MANIFEST_FILE_SHA256', manifest.manifestFileSha256],
    ['MANIFEST_CONTENT_SHA256', manifest.manifestContentSha256],
    ['PROFILE_VERSION', manifest.profileVersion],
  ];
  for (const [name, value] of pins) {
    const pattern = new RegExp(`^${name} = "[^"]*"$`, 'm');
    if (!pattern.test(source)) fail(`Could not find ${name} in ${MODAL_SCRIPT}`);
    source = source.replace(pattern, `${name} = "${value}"`);
    log(`  ${name.padEnd(25)}${value}`);
  }
  const positive = (flag) => {
    if (values[flag] === undefined) return undefined;
    const n = Number(values[flag]);
    if (!Number.isSafeInteger(n) || n < 1) fail(`--${flag} must be a positive integer`);
    return n;
  };
  const scanContainers = positive('containers');
  const auditContainers =
    positive('audit-containers') ?? (scanContainers === undefined ? undefined : 4);
  for (const [fn, containers] of [
    ['scan_shard', scanContainers],
    ['audit_candidate', auditContainers],
  ]) {
    if (containers === undefined) continue;
    source = pinContainers(source, fn, containers);
    log(`  max_containers ${fn.padEnd(16)}${containers}`);
  }
  writeFileSync(MODAL_SCRIPT, source, 'utf8');
  log('  review it with: git diff scripts/modal/elephantchess_pilot.py');
}

// Rewrites the max_containers of ONE @app.function: the decorator block that
// ends at `def <fn>(`, with no other decorator in between. A global replace here
// set scan and audit together, which is how audit ran at 32 on 2026-08-23.
function pinContainers(source, fn, containers) {
  const pattern = new RegExp(
    `(max_containers=)\\d+((?:(?!@app\\.function)[\\s\\S])*?\\ndef ${fn}\\()`,
  );
  if (!pattern.test(source)) fail(`Could not find max_containers for ${fn} in ${MODAL_SCRIPT}`);
  return source.replace(pattern, `$1${containers}$2`);
}

function modalRun(entrypoint, extra, manifestPath) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(MODAL_BIN, ['run', `${MODAL_SCRIPT}::${entrypoint}`, ...extra], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, MISTBOARD_MODAL_MANIFEST_PATH: manifestPath },
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.on('error', rejectRun);
    child.on('close', (code) =>
      code === 0
        ? resolveRun(out)
        : rejectRun(new Error(`modal ${entrypoint} exited with ${code}`)),
    );
  });
}

async function main() {
  const state = loadState();

  if (values.status) {
    step('Saved state');
    log(JSON.stringify(state, null, 2));
    if (state.runId) {
      step('Live run progress');
      log(JSON.stringify(queryProduction(progressSnippet(state.runId)), null, 2));
    }
    return;
  }

  if (state.phase === 'review') {
    // The previous batch is finished and its state is only history now. Keep
    // it beside the live file so the run id and hashes stay findable, then
    // start the next batch clean; --exclude-mined keeps the batches disjoint.
    const archive = join(STATE_DIR, `remainder-state.${state.runId ?? 'unknown'}.json`);
    step(`Previous batch ${state.runId} finished at ${state.finishedAt}; starting the next one`);
    if (values['dry-run']) {
      log(`  would archive state  ${archive}`);
    } else {
      writeFileSync(archive, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      log(`  archived state       ${archive}`);
      for (const key of Object.keys(state)) delete state[key];
      state.phase = 'preflight';
      saveState(state);
    }
  }

  preflight();
  const corpus = readCorpus();

  if (values['dry-run']) {
    log('\nDry run: nothing was generated, pinned, or launched.');
    return;
  }

  if (!state.manifestPath || !existsSync(state.manifestPath)) {
    Object.assign(state, generateManifest(corpus, state.seed));
    state.phase = 'pinned';
    saveState(state);
    pinManifest(state);
  } else {
    step('Reusing the manifest from the previous attempt');
    log(`  ${state.manifestPath}`);
  }

  if (!state.runId) {
    step('Verifying pinned artifacts on Modal (no database writes)');
    await modalRun('verify', [], state.manifestPath);

    step('Creating the durable mining run');
    const created = lastJsonLine(await modalRun('initialize', [], state.manifestPath));
    if (!created?.runId) fail('Modal initialize did not report a runId.');
    state.runId = created.runId;
    state.shards = created.shards;
    state.startedAt = new Date().toISOString();
    state.phase = 'scanning';
    saveState(state);
    log(`\n  run id               ${state.runId}`);
    log(`  shards               ${state.shards}`);
  } else {
    step(`Resuming run ${state.runId}`);
  }

  let progress = queryProduction(progressSnippet(state.runId));

  // ONE shard first, then prove it moved the counter. On 2026-08-22 this script
  // went straight to 379 shards; eight workers then spun for twenty minutes
  // scanning zero games while filling the production disk. A fan-out that
  // never completes looks exactly like slow progress from the outside, and the
  // only cheap way to tell them apart is to demand evidence of one finished
  // unit before committing the fleet.
  if (!state.canaryPassed && (progress.shards.pending ?? 0) > 0) {
    step('Canary: one shard');
    const before = progress.gamesScanned ?? 0;
    await modalRun('scan', ['--run-id', state.runId, '--tasks', '1'], state.manifestPath);
    progress = queryProduction(progressSnippet(state.runId));
    const scanned = (progress.gamesScanned ?? 0) - before;
    if (scanned <= 0) {
      fail(
        'Canary scanned 0 games. NOT fanning out.\n' +
          `  run ${state.runId}\n` +
          `  shards     ${JSON.stringify(progress.shards)}\n` +
          `  candidates ${JSON.stringify(progress.candidates)}\n\n` +
          'A worker that claims a shard but finishes no game is stuck, not slow.\n' +
          'Investigate before re-running; do not raise --containers to compensate.',
      );
    }
    log(`  canary scanned ${scanned} game(s) — safe to fan out`);
    state.canaryPassed = true;
    saveState(state);
  }

  // Shard statuses are pending | running | completed | failed. Counting a
  // status that does not exist reads as zero, which is how an earlier version
  // of this loop treated "4 shards still running" as "scan finished" and moved
  // to audit while the run was still `scanning`. Audit claims require the run
  // to have advanced past scanning, so all 882 audit workers claimed nothing
  // and exited, and the batch sat still for fifteen minutes looking busy.
  //
  // A `running` shard whose lease has expired is an abandoned worker; a fresh
  // scan pass reclaims it. So unfinished means anything not completed.
  const unfinishedShards = (shards) =>
    (shards.pending ?? 0) + (shards.running ?? 0) + (shards.failed ?? 0);

  let waited = 0;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Games processed so far, the number a live worker moves and a dead lease does not.
  const progressDone = (p) => p.gamesScanned ?? p.done ?? 0;
  for (let pass = 0; ; pass += 1) {
    const remaining = unfinishedShards(progress.shards);
    if (remaining === 0) break;
    if (pass >= 6) {
      fail(
        `Scan is not converging: ${remaining} shard(s) unfinished after ${pass} passes.\n` +
          `  shards ${JSON.stringify(progress.shards)}\n` +
          'Re-running reclaims expired leases, so shards that survive this many\n' +
          'passes are failing for a reason that repeating will not fix.',
      );
    }
    step(
      pass === 0 ? `Scanning ${remaining} shard(s)` : `Reclaiming ${remaining} stalled shard(s)`,
    );
    if (pass === 0) {
      log('  The long phase. Safe to interrupt: leases expire and re-running resumes.\n');
    }
    await modalRun(
      'scan',
      ['--run-id', state.runId, '--tasks', String(Math.min(remaining, TASK_CAP))],
      state.manifestPath,
    );
    const before = progress;
    progress = queryProduction(progressSnippet(state.runId));
    // A reclaim pass whose workers all claimed nothing did not fail: the stalled
    // shards' leases (30 min) have not expired yet, so there was nothing to
    // claim. Re-passing immediately burns the six-pass allowance in two minutes
    // and calls a live lease "not converging" (2026-09-13). Wait the lease out
    // instead, and do not count the waiting pass.
    if (
      pass > 0 &&
      (progress.shards.running ?? 0) > 0 &&
      unfinishedShards(progress.shards) === unfinishedShards(before.shards) &&
      progressDone(progress) === progressDone(before)
    ) {
      const minutes = 5;
      log(
        `  nothing claimable yet; ${progress.shards.running} lease(s) still live, waiting ${minutes} min`,
      );
      await sleep(minutes * 60_000);
      pass -= 1;
      waited += minutes;
      if (waited > 45)
        fail('Waited 45 minutes on live leases with no progress; a worker is stuck holding one.');
      progress = queryProduction(progressSnippet(state.runId));
    }
  }
  log(`\n  shards               ${JSON.stringify(progress.shards)}`);
  log(`  candidates           ${JSON.stringify(progress.candidates)}`);

  state.phase = 'auditing';
  saveState(state);

  // The Modal map caps at 1,000 inputs, and a large batch produces more
  // verified candidates than that, so drain the queue in passes. Guard against
  // spinning: if a pass audits nothing, workers cannot claim and repeating is
  // pointless.
  for (;;) {
    progress = queryProduction(progressSnippet(state.runId));
    const verified = progress.candidates.verified ?? 0;
    if (verified === 0) break;
    step(`Auditing ${verified} verified candidate(s)  [run status: ${progress.runStatus}]`);
    await modalRun(
      'audit',
      ['--run-id', state.runId, '--tasks', String(Math.min(verified, TASK_CAP))],
      state.manifestPath,
    );
    const after = queryProduction(progressSnippet(state.runId));
    if ((after.candidates.verified ?? 0) >= verified) {
      fail(
        `An audit pass resolved nothing: still ${after.candidates.verified} verified.\n` +
          `  run status ${after.runStatus}\n` +
          `  candidates ${JSON.stringify(after.candidates)}\n\n` +
          'Audit workers claim only once the run has advanced past scanning.\n' +
          'Check for unfinished shards holding the run in `scanning`.',
      );
    }
  }

  progress = queryProduction(progressSnippet(state.runId));
  state.phase = 'review';
  state.finishedAt = new Date().toISOString();
  state.finalProgress = progress;
  saveState(state);

  const elapsedHours =
    (new Date(state.finishedAt) - new Date(state.startedAt ?? state.finishedAt)) / 3_600_000;
  const survivors = (progress.candidates.approved ?? 0) + (progress.candidates.review ?? 0);

  step('Mining complete');
  log(`  run id               ${state.runId}`);
  log(`  run status           ${progress.runStatus}`);
  log(`  games mined          ${state.selected?.toLocaleString() ?? 'n/a'}`);
  log(`  candidates           ${JSON.stringify(progress.candidates)}`);
  log(`  awaiting publication ${survivors.toLocaleString()}`);
  log(`  wall clock           ${elapsedHours.toFixed(2)} h`);
  log('\nNothing has been published. To review, then publish:');
  log(
    `  npm run pilot:elephantchess-review:export -- --run-id ${state.runId} --out packet.json --motif-html-out packet.html`,
  );
  log(`  npm run pilot:elephantchess-publish -- --run-id ${state.runId}`);
  log('\nRecord the wall clock above in docs-private/mining-track.md. The pilot never was.');
}

main().catch((error) => fail(error.stack ?? String(error)));
