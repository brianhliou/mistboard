#!/usr/bin/env node
// Deploy the engine-worker service — the manual, gotcha-prone half of a prod
// deploy. release:prod covers the WEB (CI gate → push → auto-deploy → smoke);
// the engine-worker does NOT auto-deploy on push and was always hand-driven.
//
// What this codifies (the gotchas hit on 2026-06-03, plus 0 on 2026-09-05):
//   0. Project-link gate — `railway up` targets whatever project the CURRENT
//      DIRECTORY is linked to, and an unlinked directory does not fail: it
//      creates a new project named after the folder. Deploying from a task
//      worktree therefore ships to a stray project while prod sits untouched,
//      and the only tell is one line of output. We refuse unless the link
//      resolves to the prod project id. NOTE this is the one place the "run
//      releases from your task worktree" rule does NOT apply — that rule is for
//      release:prod, which pushes a git ref; `railway up` uploads a DIRECTORY
//      and needs the link that only a linked checkout has.
//   1. Cachebust gate — the engine-worker re-clones the private engine repo
//      ONLY when railpack.json's `echo cachebust-...-<sha>` line changes. If the
//      engine changed but the cachebust still points at the old SHA, the deploy
//      ships the OLD engine silently. We compare the cachebust SHA against the
//      engine repo's origin/main HEAD and refuse (or --bump) on mismatch.
//   2. `railway up --service engine-worker` — the actual deploy (no auto-deploy).
//      Uploads the LOCAL working tree. Uncommitted files are refused; CI is
//      guarded below by exact-SHA engine CI and a clean-tree check.
//   3. Boot-health verify — R1-prevent makes the worker self-test (one real
//      move) before `ready` and REFUSE to come up if it can't serve. We poll
//      the deploy logs for `engine_warmup_ok` + `selftest ok` and FAIL on
//      `boot_warmup_failed` / timeout, so a refused boot isn't mistaken for OK.
//
// Usage:
//   node scripts/deploy-engine-worker.mjs              # check-only (default)
//   node scripts/deploy-engine-worker.mjs --deploy     # deploy + verify boot
//   node scripts/deploy-engine-worker.mjs --bump       # rewrite cachebust → engine HEAD (then commit + push)
//
// Exit codes: 0 ok · 1 config/usage · 2 cachebust mismatch · 3 deploy failed
//   · 4 boot-health failed/timeout · 5 engine CI not green

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  appendDeployment,
  baselineMatchesDeployment,
  checkEngineCi,
  commandOutput,
  compareEngine,
  compareWorker,
  journalPath,
  lockDeployment,
  newDeploymentId,
  printDeploymentPlan,
  readBaseline,
} from './lib/engine-deploy-plan.mjs';

const SERVICE = 'engine-worker';
// The prod Railway project. `railway up` resolves its target from the CLI's
// link for the CURRENT DIRECTORY, and an unlinked directory does not fail — it
// CREATES a new project named after the folder and deploys into it. Run this
// from a fresh git worktree and you get a stray project plus a prod service
// that never received the deploy you think you shipped. That happened twice
// within six minutes on 2026-09-05, from two different worktrees, and the only
// symptom was a "✓ Project mistboard-fdx-v12" line scrolling past in the output.
const PROJECT_ID = 'edd519d3-638e-40da-81b4-a8a70eb7eb94';
const ENGINE_REMOTE = 'git@github.com:brianhliou/mistboard-engine.git';
const ENGINE_REF = process.env.MISTBOARD_ENGINE_REF ?? 'main';
const ENGINE_REF_FILE = 'engine.ref';
const RAILPACK = 'railpack.json';
const HEALTH_TIMEOUT_MS = Number.parseInt(process.env.DEPLOY_HEALTH_TIMEOUT_MS ?? '900000', 10);
const HEALTH_POLL_MS = 20_000;

export function main(args = process.argv.slice(2)) {
  const opts = parseArgs(args);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const cachebust = readCachebust();
  const engineSha = engineHeadSha();
  const engineRef = readEngineDeployRef();
  const cachebustMatch = cachebust.sha !== null && engineSha.startsWith(cachebust.sha);
  const engineRefMatch = engineSha.startsWith(engineRef);

  console.log('# deploy-engine-worker');
  console.log(`engine ${ENGINE_REF} HEAD: ${engineSha}`);
  console.log(`railpack cachebust:        ${cachebust.raw}`);
  console.log(`engine.ref:                ${engineRef}`);
  console.log(`cachebust matches engine: ${cachebustMatch ? 'yes' : 'NO'}`);
  console.log(`engine.ref matches engine: ${engineRefMatch ? 'yes' : 'NO'}`);

  if (opts.bump) {
    if (cachebustMatch && engineRefMatch) console.log('bump: skipped (both pins already match)');
    else {
      if (!cachebustMatch) bumpCachebust(engineSha);
      if (!engineRefMatch) bumpEngineRef(engineSha);
      console.log(
        `bump: ${RAILPACK}/${ENGINE_REF_FILE} -> ${engineSha} (commit + push before deploying)`,
      );
    }
    return 0;
  }
  if (!cachebustMatch || !engineRefMatch) {
    console.error('Refusing: engine.ref and the cachebust must pin the current engine SHA.');
    console.error('Run --bump, then commit and push the pins before deploying.');
    return 2;
  }

  let ci;
  try {
    ci = checkEngineCi(engineSha);
  } catch (error) {
    if (!opts.overrideReason) throw error;
    ci = { passed: false, run: null, description: 'CI lookup unavailable' };
  }
  if (!ci.passed && !opts.overrideReason) {
    console.error(`Refusing engine deployment: CI ${ci.description}. ${ci.run?.url ?? ''}`);
    console.error('An urgent fix may use --override-engine-ci "<reason>"; the override is logged.');
    return 5;
  }

  const mistboardSha = commandOutput('git', ['rev-parse', 'HEAD']);
  const file = journalPath();
  const record = {
    engineSha,
    mistboardSha,
    ci,
    overrideReason: opts.overrideReason || null,
    worktree: process.cwd(),
  };
  let unlock;
  let attemptStarted = false;
  try {
    if (opts.deploy) {
      assertLinkedToProdProject();
      assertCleanCandidate(mistboardSha);
      unlock = lockDeployment(file, record);
    }
    let baseline = readBaseline(file, opts);
    if (baseline?.deploymentId && !baselineMatchesDeployment(baseline, railwayDeployments())) {
      console.log('The latest Railway deployment differs from the journal or is not healthy.');
      baseline = null;
    }
    const engineChanges = baseline ? compareEngine(baseline.engineSha, engineSha) : null;
    const workerChanges = baseline ? compareWorker(baseline.mistboardSha, mistboardSha) : null;
    printDeploymentPlan({ ...record, baseline, engineChanges, workerChanges });
    if (!opts.deploy) {
      console.log('\ncheck-only. Re-run with --deploy to ship + verify boot health.');
      return 0;
    }
    if (!baseline)
      throw new Error('Deployment needs a verified baseline; the running changes are unknown.');
    assertCleanCandidate(mistboardSha);
    const previousDeployments = railwayDeployments();
    const startedAt = new Date().toISOString();
    appendDeployment(file, { ...record, baseline, status: 'started', startedAt });
    attemptStarted = true;
    console.log(`\n$ command railway up --service ${SERVICE} --detach`);
    const up = railway(['up', '--service', SERVICE, '--detach'], { inherit: true });
    if (up.status !== 0) {
      appendDeployment(file, { ...record, status: 'upload-failed', startedAt });
      attemptStarted = false;
      console.error('deploy: railway up failed; verify the running revision before retrying.');
      return 3;
    }
    console.log('\n# boot-health (waiting for self-test + warmup)');
    const deploymentId = newDeploymentId(railwayDeployments(), previousDeployments);
    const healthy = pollBootHealth(startedAt, deploymentId);
    appendDeployment(file, {
      ...record,
      deploymentId,
      status: healthy ? 'healthy' : 'boot-failed',
      startedAt,
    });
    attemptStarted = false;
    if (!healthy) {
      console.error('boot-health: FAILED or timed out. Verify the running pins before retrying.');
      return 4;
    }
    console.log(`boot-health: OK. Both deployment SHAs recorded in ${file}.`);
    return 0;
  } catch (error) {
    if (attemptStarted) appendDeployment(file, { ...record, status: 'unknown' });
    throw error;
  } finally {
    unlock?.();
  }
}

function assertCleanCandidate(sha) {
  if (commandOutput('git', ['status', '--porcelain', '--untracked-files=normal'])) {
    throw new Error('Deployment uploads this directory: commit or remove uncommitted files first.');
  }
  if (commandOutput('git', ['rev-parse', 'HEAD']) !== sha) {
    throw new Error('Mistboard HEAD changed during preflight; run the checks again.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`deploy: ${error.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------

function pollBootHealth(startIso, deploymentId) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  // Markers only count if newer than now — don't match a prior boot's logs.
  while (Date.now() < deadline) {
    sleep(HEALTH_POLL_MS);
    const logs = railwayLogsTail(startIso, deploymentId);
    const failed = logs.find(
      (l) => l.includes('boot_warmup_failed') || /engine_alert.*critical/.test(l),
    );
    if (failed) {
      console.error('  saw worker boot failure marker');
      return false;
    }
    const complete = logs.filter((l) => l > startIso && /engine_warmup_complete/.test(l));
    if (complete.length > 0) {
      const latest = railwayDeployments()[0];
      if (latest?.id !== deploymentId)
        throw new Error('Another worker deployment superseded this upload.');
      if (latest.status === 'SUCCESS') {
        console.log(
          `  ${complete.length} complete warmup marker(s) since ${startIso}; Railway SUCCESS`,
        );
        return true;
      }
    }
    console.log(`  …still booting (${Math.round((deadline - Date.now()) / 1000)}s left)`);
  }
  return false;
}

function railwayDeployments() {
  const result = railway(['deployment', 'list', '--service', SERVICE, '--json', '--limit', '10']);
  if (result.status !== 0) throw new Error('Cannot read Railway deployment metadata.');
  const deployments = JSON.parse(result.stdout);
  if (
    !Array.isArray(deployments) ||
    deployments.some((deployment) => typeof deployment.id !== 'string')
  ) {
    throw new Error('Invalid Railway deployment metadata.');
  }
  return deployments;
}

function railwayLogsTail(startIso, deploymentId) {
  // Exact deployment + bounded JSON logs: an older warmup cannot certify this upload.
  const result = railway([
    'logs',
    deploymentId,
    '--service',
    SERVICE,
    '--since',
    startIso,
    '--lines',
    '300',
    '--json',
  ]);
  if (result.status !== 0) throw new Error('Cannot read the new worker deployment logs.');
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line);
      return `${entry.timestamp} ${entry.message}`;
    });
}

/**
 * Refuse to deploy from a directory that is not linked to the prod project.
 *
 * This is the one gate `railway up` does not give you: an unlinked directory is
 * not an error to the CLI, it is an invitation to create a project. Fail closed
 * — a refused deploy costs a `railway link`, a wrong one costs a stray project
 * and the belief that prod was updated when it was not.
 *
 * Deliberately matches on the project ID rather than the name: a stray project
 * is named after the folder, and a folder can be named anything.
 */
function assertLinkedToProdProject() {
  const res = railway(['status', '--json']);
  const blob = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (blob.includes(PROJECT_ID)) return;

  console.error(`\ndeploy: this directory is not linked to the prod Railway project.`);
  if (res.status !== 0) {
    // Unauthorized/not-logged-in lands here too; say so, since the remedy differs.
    console.error(`  \`railway status\` exited ${res.status}. If it says Unauthorized, run:`);
    console.error(`    railway login`);
    console.error(`  (this script drops RAILWAY_API_TOKEN on purpose — see railwayEnv)`);
  } else {
    console.error(`  Linked project does not contain ${PROJECT_ID}.`);
  }
  console.error(`\n  Refusing rather than letting \`railway up\` CREATE a new project`);
  console.error(`  named after this directory. To link:`);
  console.error(
    `    railway link --project ${PROJECT_ID} --environment production --service ${SERVICE}`,
  );
  console.error(
    `\n  Override (only if you know the link is right): MISTBOARD_SKIP_PROJECT_CHECK=1`,
  );
  if (process.env.MISTBOARD_SKIP_PROJECT_CHECK === '1') {
    console.error('\n  MISTBOARD_SKIP_PROJECT_CHECK=1 set — continuing anyway.');
    return;
  }
  process.exit(1);
}

function railway(args, { inherit = false } = {}) {
  const scoped =
    args[0] === 'status' ? args : [...args, '--project', PROJECT_ID, '--environment', 'production'];
  return spawnSync('railway', scoped, {
    env: railwayEnv(),
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    timeout: 300_000,
  });
}

function railwayEnv() {
  // A stale RAILWAY_API_TOKEN in the launch env shadows the valid browser
  // session ("Unauthorized") — drop it so the CLI uses the logged-in session.
  const env = { ...process.env };
  delete env.RAILWAY_API_TOKEN;
  env.RAILWAY_CALLER = 'skill:use-railway@1.2.2';
  env.RAILWAY_AGENT_SESSION ||= `engine-worker-deploy-${process.pid}`;
  return env;
}

function readCachebust() {
  const text = readFileSync(RAILPACK, 'utf8');
  const m = text.match(/echo (cachebust-[\w.-]+)/);
  if (!m) {
    console.error(`could not find an "echo cachebust-...-<sha>" line in ${RAILPACK}`);
    process.exit(1);
  }
  const sha = m[1].match(/-([0-9a-f]{7,40})$/)?.[1] ?? null;
  return { raw: m[1], sha };
}

function readEngineDeployRef() {
  const first = readFileSync(ENGINE_REF_FILE, 'utf8').split(/\r?\n/, 1)[0]?.trim();
  return first || ENGINE_REF;
}

function bumpCachebust(sha) {
  const text = readFileSync(RAILPACK, 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  const next = text.replace(
    /echo cachebust-[\w.-]+/,
    `echo cachebust-${date}-engine-${sha.slice(0, 7)}`,
  );
  writeFileSync(RAILPACK, next);
}

function bumpEngineRef(sha) {
  const text = readFileSync(ENGINE_REF_FILE, 'utf8');
  const lines = text.split(/\r?\n/);
  lines[0] = sha.slice(0, 7);
  writeFileSync(ENGINE_REF_FILE, lines.join('\n'));
}

function engineHeadSha() {
  const res = spawnSync('git', ['ls-remote', ENGINE_REMOTE, ENGINE_REF], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`could not read ${ENGINE_REMOTE} ${ENGINE_REF}: ${res.stderr?.trim()}`);
    process.exit(1);
  }
  const sha = (res.stdout ?? '').trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    console.error(`unexpected ls-remote output: ${res.stdout}`);
    process.exit(1);
  }
  return sha;
}

function sleep(ms) {
  // Synchronous wait so the poll loop stays simple + sequential (no busy-spin).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function parseArgs(args) {
  const o = { deploy: false, bump: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--deploy') o.deploy = true;
    else if (a === '--bump') o.bump = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (['--override-engine-ci', '--baseline-engine', '--baseline-mistboard'].includes(a)) {
      const value = args[++i];
      if (!value || value.startsWith('--') || /[\r\n]/.test(value) || !value.trim())
        throw new Error(`${a} requires a value.`);
      const key = {
        '--override-engine-ci': 'overrideReason',
        '--baseline-engine': 'baselineEngine',
        '--baseline-mistboard': 'baselineMistboard',
      }[a];
      if (o[key]) throw new Error(`Duplicate ${a}.`);
      o[key] = value.trim();
    } else throw new Error(`Unknown argument: ${a}`);
  }
  if (o.bump && (o.deploy || o.overrideReason || o.baselineEngine || o.baselineMistboard)) {
    throw new Error('--bump must run separately from deployment checks.');
  }
  return o;
}

function printHelp() {
  console.log(
    [
      'Deploy engine-worker: pins + exact-SHA CI + change summary + boot-health journal.',
      '',
      'Usage:',
      '  node scripts/deploy-engine-worker.mjs            check-only (default)',
      '  node scripts/deploy-engine-worker.mjs --deploy   deploy + verify boot health',
      '  node scripts/deploy-engine-worker.mjs --bump     rewrite both pins to engine HEAD',
      '  --baseline-engine <full-sha> --baseline-mistboard <full-sha>',
      '      Required for the first deploy, or after an interrupted/failed/manual deploy.',
      '  --override-engine-ci "<reason>"  urgent CI exception, recorded with the deployment',
      '  Journal: <shared-git-dir>/engine-worker-deployments.jsonl',
    ].join('\n'),
  );
}
