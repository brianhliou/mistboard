#!/usr/bin/env node
// Push a production release only through the safe CI -> deploy -> smoke order.

import { spawn, spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ciOutcome, classifyJobs } from './lib/ci-run-verdict.mjs';
import { describeDrainToken } from './lib/drain-token.mjs';
import {
  DEFAULT_TEST_DATABASE_URL,
  isDatabaseReachable,
  needsPersistenceGate,
  persistenceGateWarning,
} from './persistence-gate.mjs';
import { primaryWorktreeRoot } from './worktree-role.mjs';

const DEFAULT_BASE_URL = 'https://mistboard.com';
const DEFAULT_CI_WORKFLOW = 'ci.yml';
const DEFAULT_REMOTE = 'origin';
const DEFAULT_SMOKE = 'full';
const DEFAULT_TARGET_BRANCH = 'main';
// 35 min, matching wait-prod-revision: Railway builder-queue latency alone
// reached ~15.5 min on 2026-07-16 (#239), so 15 min false-failed a healthy
// release while the deploy was still queued.
const DEFAULT_TIMEOUT_MS = 2_100_000;
const GITHUB_POLL_MS = 10_000;
// Prefixes whose changes never need the engine/DXQ smoke tier. Declared
// with the other top constants: resolveSmokeTier runs mid-release-flow, so a
// declaration after the top-level call site sits in the temporal dead zone
// (function hoisting masks it until the first web-safe release).
const WEB_SAFE_PREFIXES = ['apps/web/', 'docs/', 'scripts/', '.github/'];
// Carve-outs from the scripts/ web-safe prefix: build.mjs and start.mjs are
// Railway watch paths (railway.web.json) that shape the SERVER build/boot, so
// a diff touching them must keep the full engine tier. Same TDZ note as above.
const SERVER_SHAPING_SCRIPTS = new Set(['scripts/build.mjs', 'scripts/start.mjs']);
const CI_TRIGGER_PATTERNS = [
  '.github/workflows/ci.yml',
  'apps/**',
  'packages/**',
  'scripts/**',
  'package.json',
  'package-lock.json',
  'tsconfig*.json',
  'docker-compose.yml',
  'railway*.json',
  'railpack.json',
];
const VALID_SMOKE_TIERS = new Set(['full', 'web', 'lite', 'none']);

// Every child is spawned with an explicit cwd. Before the push that is the
// checkout the release runs from; after it, the control worktree (see
// enterPostPushWorkdir). A child spawned without a cwd inherits ours, and if
// that directory is gone the spawn itself dies with "process.cwd failed".
const releaseRoot = process.cwd();
let workdir = releaseRoot;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const startedAt = performance.now();
const release = {
  ciRequired: false,
  ciReason: null,
  // Identifies this release run to production's drain endpoint, so the cleanup
  // on our failure path cancels OUR drain and not a concurrent release's.
  drainOwner: `release-${hostname()}-${process.pid}-${Date.now().toString(36)}`,
  drainCommitted: false,
  drainRequired: false,
  deployRequired: false,
  headRevision: null,
  planReason: null,
  productionRevision: null,
  pushCompleted: false,
  targetRevision: null,
};

try {
  if (!options.plan) ensureCleanWorktree();
  release.headRevision = git(['rev-parse', '--verify', options.head]);
  release.targetRevision = readRemoteTargetRevision();

  if (options.plan) {
    runPlanModeAndExit();
  }

  console.log(`# production release`);
  console.log(`head: ${release.headRevision}`);
  console.log(`target: ${options.remote}/${options.targetBranch}`);
  console.log(`target_head: ${release.targetRevision ?? 'unknown'}`);
  console.log(`push: ${options.push ? 'yes' : 'no'}`);
  console.log(`smoke: ${options.smoke}`);

  const plan = runPlan({ headRevision: release.headRevision });
  release.deployRequired = plan.deployRequired;
  release.planReason = plan.reason;
  release.productionRevision = plan.productionRevision;

  const ciPlan = planHostedCi({
    baseRevision: release.targetRevision,
    headRevision: release.headRevision,
  });
  release.ciRequired = ciPlan.ciRequired;
  release.ciReason = ciPlan.reason;
  printHostedCiPlan(ciPlan);

  // Drain only when production is actually serving live games. An empty pool
  // needs no drain, so a routine deploy stays token-free and can run
  // unattended; a deploy that would interrupt live games still requires the
  // token and drains first. When the active-game count can't be read, fail
  // safe and require the drain.
  if (options.push && release.deployRequired) {
    const liveGames = await fetchActiveGameCount();
    if (liveGames === null) {
      release.drainRequired = true;
      console.log('production drain: required (could not read active game count; failing safe)');
    } else if (liveGames > 0) {
      release.drainRequired = true;
      console.log(`production drain: required (${liveGames} active game(s) in progress)`);
    } else {
      console.log('production drain: not required (0 active games)');
    }
    // Precondition only. safe-deploy resolves the token itself from the same
    // two sources, so the value never crosses this process's argv or output;
    // checking here just keeps a release from running ci:quick and then dying
    // at the drain step.
    if (release.drainRequired) {
      // describeDrainToken separates "never stored" from "stored but this
      // process cannot read it" — remedies that share nothing. The old message
      // named only the first, which on 2026-09-09 sent a session to the
      // Railway dashboard for an answer the lookup already had.
      const token = describeDrainToken();
      if (!token.ok) {
        throw new Error(
          `A drain token is required for this deploy (${
            liveGames === null ? 'active game count unreadable' : `${liveGames} active game(s)`
          }), and it is not usable here (${token.status}). ${token.detail}`,
        );
      }
    }
  }

  if (options.localCi) {
    runTimed('local ci:quick', ['npm', 'run', 'ci:quick']);
    // ci:quick does NOT include test:persistent, and the push below goes out
    // with --no-verify, which skips the pre-push hook that WOULD have run it.
    // So without this a persistence change reaches hosted CI unproven: that is
    // exactly how 2026-08-27 put three red persistent tests on main and froze
    // the next deploy behind them.
    await runReleasePersistenceGate(ciPlan.changedFiles);
  } else {
    console.log('skip: local ci:quick (--skip-local-ci)');
  }

  if (options.push) {
    if (release.drainRequired) {
      runTimed('production drain', [
        'node',
        'scripts/safe-deploy.mjs',
        '--yes',
        '--commit',
        ...safeDeployBaseArgs(),
      ]);
      release.drainCommitted = true;
    } else if (release.deployRequired) {
      console.log('skip: production drain (0 active games)');
    } else {
      console.log(`skip: production drain (${release.planReason})`);
    }
    runTimed('git push release head', pushCommand(release.headRevision));
    release.pushCompleted = true;
    enterPostPushWorkdir();
  } else {
    console.log('skip: git push (pass --push to publish the current commit)');
  }

  if (release.ciRequired && options.ciWait) {
    await waitForGithubCi({ headRevision: release.headRevision });
  } else if (!release.ciRequired) {
    console.log(`skip: hosted CI wait (${release.ciReason})`);
  } else {
    console.log('skip: hosted CI wait (--skip-ci-wait)');
  }

  if (release.deployRequired) {
    runTimed('production revision wait', prodWaitCommand(release.headRevision));
  } else {
    console.log(
      `skip: exact revision wait; production is not expected to serve ${release.headRevision.slice(
        0,
        12,
      )} (${release.planReason})`,
    );
  }

  await runSmoke({ deployRequired: release.deployRequired, headRevision: release.headRevision });

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log(`release: ok in ${formatDuration(elapsedMs)}`);
} catch (error) {
  cancelUnpublishedDrain();
  const elapsedMs = Math.round(performance.now() - startedAt);
  console.error(`release: failed after ${formatDuration(elapsedMs)}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    baseUrl: null,
    ciWait: true,
    ciWorkflow: DEFAULT_CI_WORKFLOW,
    head: 'HEAD',
    help: false,
    localCi: true,
    plan: false,
    planBase: null,
    planFiles: [],
    push: false,
    remote: DEFAULT_REMOTE,
    smoke: DEFAULT_SMOKE,
    smokeExplicit: false,
    targetBranch: DEFAULT_TARGET_BRANCH,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base') {
      parsed.baseUrl = requiredValue(args, ++index, arg);
    } else if (arg === '--ci-workflow') {
      parsed.ciWorkflow = requiredValue(args, ++index, arg);
    } else if (arg === '--head') {
      parsed.head = requiredValue(args, ++index, arg);
    } else if (arg === '--plan') {
      parsed.plan = true;
    } else if (arg === '--plan-base') {
      parsed.planBase = requiredValue(args, ++index, arg);
      parsed.plan = true;
    } else if (arg === '--plan-file') {
      parsed.planFiles.push(requiredValue(args, ++index, arg));
      parsed.plan = true;
    } else if (arg === '--push') {
      parsed.push = true;
    } else if (arg === '--remote') {
      parsed.remote = requiredValue(args, ++index, arg);
    } else if (arg === '--skip-ci-wait') {
      parsed.ciWait = false;
    } else if (arg === '--skip-local-ci') {
      parsed.localCi = false;
    } else if (arg === '--smoke') {
      parsed.smoke = requiredValue(args, ++index, arg);
      parsed.smokeExplicit = true;
      if (!VALID_SMOKE_TIERS.has(parsed.smoke)) {
        throw new Error(`--smoke must be one of: ${Array.from(VALID_SMOKE_TIERS).join(', ')}`);
      }
    } else if (arg === '--target-branch') {
      parsed.targetBranch = requiredValue(args, ++index, arg);
    } else if (arg === '--timeout-ms') {
      parsed.timeoutMs = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function ensureCleanWorktree() {
  const status = git(['status', '--porcelain']);
  if (status.trim() === '') return;
  throw new Error(
    ['release requires a clean worktree; commit or stash first.', 'Dirty paths:', status].join(
      '\n',
    ),
  );
}

function runPlan({ headRevision }) {
  const args = ['scripts/prod-smoke-plan.mjs', '--base-from-prod', '--head', headRevision];
  if (options.baseUrl) args.push('--base-url', options.baseUrl);
  const output = runCapture('production deploy plan', ['node', ...args]);
  const plan = parsePlan(output);

  console.log(output.trim());
  console.log('');
  return plan;
}

function parsePlan(output) {
  const fields = new Map();
  for (const line of output.split('\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    fields.set(key, value);
  }

  const deployRequiredLine = output.match(/prod-smoke-plan: deploy_required=(true|false)/);
  if (!deployRequiredLine) {
    throw new Error('prod-smoke-plan output did not include deploy_required');
  }

  return {
    deployRequired: deployRequiredLine[1] === 'true',
    headRevision: fields.get('head_revision') ?? null,
    productionRevision: fields.get('production_revision') ?? null,
    reason: fields.get('reason') ?? 'unknown',
  };
}

function planHostedCi({ baseRevision, headRevision }) {
  if (!baseRevision) {
    return {
      changedFiles: [],
      ciRequired: true,
      matched: [],
      reason: 'target_revision_unknown_conservative',
      unmatched: [],
    };
  }

  if (revisionMatches(baseRevision, headRevision)) {
    return {
      changedFiles: [],
      ciRequired: false,
      matched: [],
      reason: 'target_already_at_head',
      unmatched: [],
    };
  }

  let changedFiles = [];
  try {
    changedFiles = readChangedFiles({ base: baseRevision, head: headRevision });
  } catch (error) {
    return {
      changedFiles: [],
      ciRequired: true,
      matched: [],
      reason: `changed_files_unknown_conservative: ${
        error instanceof Error ? error.message : String(error)
      }`,
      unmatched: [],
    };
  }

  return classifyCiFiles(changedFiles);
}

function classifyCiFiles(changedFiles) {
  const matched = [];
  const unmatched = [];
  for (const file of changedFiles) {
    const pattern = CI_TRIGGER_PATTERNS.find((candidate) => matchesPathPattern(file, candidate));
    if (pattern) matched.push({ file, pattern });
    else unmatched.push(file);
  }

  return {
    changedFiles,
    ciRequired: matched.length > 0,
    matched,
    reason: matched.length > 0 ? 'matched_ci_workflow_path' : 'no_ci_workflow_path_match',
    unmatched,
  };
}

// --plan: dry-run the release planning (deploy plan, hosted CI plan, resolved
// smoke tier) without ci:quick, push, waits, or smokes. --plan-base <rev>
// swaps the tier/CI diff base to an arbitrary revision, and --plan-file <path>
// (repeatable) injects a synthetic changed-file list, so the tier classifier
// can be validated by EXECUTING its real code path against any diff shape.
function runPlanModeAndExit() {
  console.log('# release plan (dry run)');
  console.log(`head: ${release.headRevision}`);
  console.log(`target: ${options.remote}/${options.targetBranch}`);
  console.log(`target_head: ${release.targetRevision ?? 'unknown'}`);

  const changedOverride = planChangedFiles();
  if (changedOverride === null) {
    const plan = runPlan({ headRevision: release.headRevision });
    release.deployRequired = plan.deployRequired;
    release.planReason = plan.reason;
    release.productionRevision = plan.productionRevision;
  } else {
    const source = options.planFiles.length > 0 ? 'plan-file list' : `${options.planBase}..head`;
    console.log(`plan_diff: ${source} (${changedOverride.length} file(s))`);
  }

  const ciPlan = changedOverride
    ? classifyCiFiles(changedOverride)
    : planHostedCi({ baseRevision: release.targetRevision, headRevision: release.headRevision });
  printHostedCiPlan(ciPlan);

  const tier = resolveSmokeTier(release.headRevision, changedOverride);
  console.log(`smoke_tier: ${tier}`);
  process.exit(0);
}

// The changed-file list a --plan run should classify, or null to use the real
// production-revision diff (which needs the network round trip to prod).
function planChangedFiles() {
  if (options.planFiles.length > 0) return options.planFiles.map(normalizePath);
  if (options.planBase) {
    const base = git(['rev-parse', '--verify', options.planBase]);
    return git(['diff', '--name-only', `${base}..${release.headRevision}`])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return null;
}

function printHostedCiPlan({ changedFiles, ciRequired, matched, reason, unmatched }) {
  console.log('# hosted CI plan');
  console.log(`hosted_ci_required=${ciRequired ? 'true' : 'false'}`);
  console.log(`reason: ${reason}`);
  console.log(`changed_count: ${changedFiles.length}`);
  console.log(`matched_count: ${matched.length}`);
  printList(
    'matched',
    matched.map((entry) => `${entry.file} -> ${entry.pattern}`),
  );
  printList('unmatched', unmatched);
  console.log('');
}

async function waitForGithubCi({ headRevision }) {
  const deadline = Date.now() + options.timeoutMs;
  let run = null;
  let attempt = 0;

  console.log(`# hosted CI wait`);
  while (Date.now() <= deadline) {
    attempt += 1;
    const runs = listGithubRuns(headRevision);
    run = runs.find((candidate) => candidate.headSha === headRevision) ?? null;
    // Checked every poll, not once: another session can win the push race at any
    // point in the several minutes this wait runs for, and the moment it does,
    // ci.yml's cancel-in-progress kills the run we are watching.
    const superseded = supersededBy(headRevision);
    const verdict = run?.status === 'completed' ? jobVerdict(run) : null;
    const decision = ciOutcome({ run, verdict, headRevision, superseded });
    if (decision.outcome === 'pass') {
      console.log(decision.message);
      return;
    }
    if (decision.outcome === 'fail') throw new Error(decision.message);
    console.log(`attempt ${attempt}: ${decision.message}`);

    if (Date.now() + GITHUB_POLL_MS > deadline) break;
    await sleep(GITHUB_POLL_MS);
  }

  throw new Error(
    `timed out waiting for ${options.ciWorkflow} on ${headRevision}; last run=${
      run ? `${run.status}/${run.conclusion ?? 'none'} ${run.url ?? ''}` : 'not found'
    }`,
  );
}

// Read a run's per-job conclusions. The decision made from them, including when
// a cancelled job may be forgiven, lives in lib/ci-run-verdict.mjs.
function jobVerdict(run) {
  const runId = run.databaseId;
  if (!runId) return { blocking: [], forgiven: [], succeeded: 0 };
  let jobs;
  try {
    const output = runCapture(
      'gh run view',
      ['gh', 'run', 'view', String(runId), '--json', 'jobs'],
      { quiet: true },
    );
    jobs = JSON.parse(output).jobs;
    if (!Array.isArray(jobs)) throw new Error('not an array');
  } catch (error) {
    // Fall back to trusting the badge: a lookup failure must not turn a red run
    // green. Zero `succeeded` fails the guard above, so the release still stops.
    console.log(`warn: could not read job conclusions (${error.message})`);
    return { blocking: [], forgiven: [], succeeded: 0 };
  }
  return classifyJobs(jobs);
}

// The branch tip, when it is no longer the revision being released. Null means
// this release still owns main.
//
// Polled on every CI-wait tick, so it fails soft: a transient ls-remote failure
// must not kill a release that is otherwise fine. Reading null just restores the
// behaviour this check was added to improve on, and says so out loud.
function supersededBy(headRevision) {
  let remote;
  try {
    remote = readRemoteTargetRevision();
  } catch (error) {
    console.log(
      `warn: could not read ${options.remote} ${options.targetBranch} (${error.message})`,
    );
    return null;
  }
  if (!remote || revisionMatches(remote, headRevision)) return null;
  return remote;
}

function listGithubRuns(headRevision) {
  const args = [
    'run',
    'list',
    '--workflow',
    options.ciWorkflow,
    '--branch',
    options.targetBranch,
    '--commit',
    headRevision,
    '--event',
    'push',
    '--json',
    'databaseId,status,conclusion,headSha,url',
    '--limit',
    '10',
  ];
  const output = runCapture('gh run list', ['gh', ...args], { quiet: true });
  try {
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    return parsed;
  } catch (error) {
    throw new Error(`could not parse gh run list JSON: ${error.message}`);
  }
}

async function runReleasePersistenceGate(changedFiles) {
  if (!needsPersistenceGate(changedFiles)) return;
  if (process.env.MISTBOARD_SKIP_PREPUSH_DB === '1') {
    console.log('release: persistence gate skipped via MISTBOARD_SKIP_PREPUSH_DB=1');
    return;
  }
  const databaseUrl = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (await isDatabaseReachable(databaseUrl)) {
    runTimed('test:persistent', ['npm', 'run', 'test:persistent']);
    return;
  }
  console.warn(persistenceGateWarning('release'));
}

function readChangedFiles({ base, head }) {
  const output = git(['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}..${head}`]);
  if (!output) return [];
  return unique(output.split('\n').map(normalizePath));
}

function prodWaitCommand(headRevision) {
  const command = [
    'npm',
    'run',
    'prod:wait-revision',
    '--',
    '--expect-revision',
    headRevision,
    '--timeout-ms',
    String(options.timeoutMs),
  ];
  if (options.baseUrl) command.push('--base', options.baseUrl);
  return command;
}

function pushCommand(headRevision) {
  const command = ['env', 'MISTBOARD_RELEASE_PUSH=1', 'git', 'push'];
  if (options.localCi) command.push('--no-verify');
  command.push(options.remote, `${headRevision}:refs/heads/${options.targetBranch}`);
  return command;
}

async function runSmoke({ deployRequired, headRevision }) {
  const smoke = resolveSmokeTier(headRevision);
  if (smoke === 'none') {
    console.log('skip: prod smoke (--smoke none)');
    return;
  }

  // Tiers nest (full > web > lite): every tier opens with the lite checks and
  // the correspondence gate checks. They are a couple seconds of read-only
  // GETs, fail fastest, and this keeps their coverage (watch shell, zh-hans
  // page, correspondence gating) on every release, not only explicit --smoke
  // lite runs.
  runTimed('prod lite smoke', npmCommand('prod:smoke:lite', baseArgs()));
  runTimed('prod correspondence smoke', [
    'node',
    'scripts/prod-correspondence-smoke.mjs',
    ...baseArgs(),
  ]);
  if (smoke === 'lite') return;

  const revisionArgs = deployRequired ? ['--expect-revision', headRevision] : [];
  runTimed('prod web smoke', npmCommand('prod:smoke', [...baseArgs(), ...revisionArgs]));
  // Headless check that the in-browser analysis engines actually load + return
  // a search (FSF on /analysis/xiangqi, MistyBanqi on a finished banqi review
  // page) — the class of failure the fetch-based smokes cannot see (they
  // verify serving/isolation, not a real run).
  runTimed('prod ceval smoke', npmCommand('prod:smoke:ceval', baseArgs()));
  // The /practice catalogue is DATA, and its failure mode is silent: a chapter
  // that loses its practice flag stops being an exercise while the card's count
  // stays truthful, so nothing on the page looks wrong. Cheap (a handful of
  // public GETs) and it runs after the deploy like every other smoke, so a
  // finding is an alarm rather than a gate on shipping code.
  // Invoked by absolute path from the RELEASE checkout, not as an npm script
  // from `workdir`. Post-push steps run from the control worktree (see
  // enterPostPushWorkdir), which is whatever commit that tree happens to sit
  // on -- so a release that ADDS a script cannot run it by name in its own
  // smoke phase. This one did exactly that on 2026-09-06 and died on
  // `Missing script: "prod:smoke:practice"` after a green deploy. The audit
  // only makes HTTP calls, so the working directory is irrelevant to it and
  // the path is the whole fix.
  runTimed('prod practice catalogue', [
    'node',
    path.join(releaseRoot, 'scripts/check-practice-catalog.mjs'),
    ...baseArgs(),
  ]);
  if (smoke !== 'full') return;

  // The engine-family smokes are independent (separate rooms, separate engines)
  // and dominated by engine-turn latency, so run them concurrently: wall clock
  // is the slowest one, not the sum.
  //
  // One row per variant that offers PvE in production. That list used to be
  // four, and the five it was missing included jieqi — whose live engine broke
  // on 2026-09-02 and resigned six real games before anyone knew, because
  // nothing here ever asked it for a move. scripts/pve-smoke-coverage.test.ts
  // fails the build if a PvE variant is added without landing in this list.
  await runParallelSmokes([
    {
      label: 'prod engine smoke',
      tag: 'engines',
      command: npmCommand('prod:smoke:engines', baseArgs()),
    },
    {
      label: 'prod Fortress smoke',
      tag: 'fortress',
      command: npmCommand('prod:smoke:fortress', baseArgs()),
    },
    {
      label: 'prod Duck smoke',
      tag: 'duck',
      command: npmCommand('prod:smoke:duck', baseArgs()),
    },
    { label: 'prod DXQ smoke', tag: 'dxq', command: npmCommand('prod:smoke:dxq', baseArgs()) },
    {
      label: 'prod Jieqi smoke',
      tag: 'jieqi',
      command: npmCommand('prod:smoke:jieqi', baseArgs()),
    },
    {
      label: 'prod Xiangqi smoke',
      tag: 'xiangqi',
      command: npmCommand('prod:smoke:xiangqi', baseArgs()),
    },
    {
      label: 'prod Banqi smoke',
      tag: 'banqi',
      command: npmCommand('prod:smoke:banqi', baseArgs()),
    },
    {
      label: 'prod Jungle smoke',
      tag: 'jungle',
      command: npmCommand('prod:smoke:jungle', baseArgs()),
    },
    {
      label: 'prod Flip Jungle smoke',
      tag: 'jungle-flip',
      command: npmCommand('prod:smoke:jungle-flip', baseArgs()),
    },
  ]);
}

// Run smokes concurrently with captured output. Each smoke's full output is
// printed as one prefixed block when all have settled (deterministic order, no
// interleaving), and every failure's output is repeated in the thrown report.
async function runParallelSmokes(smokes) {
  console.log(`\n# engine-family smokes (${smokes.length} in parallel)`);
  for (const smoke of smokes) console.log(`$ ${quoteCommand(smoke.command)}`);
  const results = await Promise.all(smokes.map(runSmokeProcess));

  for (const result of results) {
    const verdict = result.ok
      ? 'ok'
      : `FAILED (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`})`;
    console.log(`\n== ${result.label}: ${verdict} in ${formatDuration(result.elapsedMs)}`);
    process.stdout.write(prefixLines(result.output, result.tag));
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    const report = failed
      .map((result) => `--- ${result.label} output ---\n${result.output.trimEnd()}`)
      .join('\n');
    throw new Error(
      `${failed.length}/${results.length} engine-family smokes failed: ${failed
        .map((result) => result.label)
        .join(', ')}\n${report}`,
    );
  }
}

function runSmokeProcess({ label, tag, command }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command[0], command.slice(1), {
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const settle = (ok, status, signal) =>
      resolve({
        label,
        tag,
        ok,
        status,
        signal,
        output,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    child.on('error', (error) => {
      output += `\nspawn error: ${error.message}`;
      settle(false, null, null);
    });
    child.on('close', (status, signal) => settle(status === 0 && !signal, status, signal));
  });
}

function prefixLines(output, tag) {
  const trimmed = output.replace(/\n+$/, '');
  if (trimmed === '') return `  [${tag}] (no output)\n`;
  return `${trimmed
    .split('\n')
    .map((line) => `  [${tag}] ${line}`)
    .join('\n')}\n`;
}

// Diff-aware default: the engine/DXQ smokes exist for server-behavior
// changes. When the whole prod diff stays inside web-safe prefixes (web app,
// docs, release tooling), the default 'full' tier drops to 'web'. An explicit
// --smoke always wins, and any doubt (no prod revision to diff against, files
// outside the safe set) keeps 'full'. --plan passes changedOverride so the
// classifier can be exercised against arbitrary diff shapes.
function resolveSmokeTier(headRevision, changedOverride = null) {
  if (options.smokeExplicit || options.smoke !== 'full') return options.smoke;
  let changed = changedOverride;
  if (changed === null) {
    const base = release.productionRevision;
    if (!base) return 'full';
    try {
      changed = git(['diff', '--name-only', `${base}..${headRevision}`])
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return 'full';
    }
  }
  if (changed.length === 0) return 'full';
  const unsafe = changed.filter((file) => !isWebSafePath(file));
  if (unsafe.length > 0) {
    printList('smoke: full tier kept by non-web-safe paths', unsafe);
    return 'full';
  }
  console.log(
    'smoke: full -> web (prod diff stays in web-safe paths; pass --smoke full to override)',
  );
  return 'web';
}

function isWebSafePath(file) {
  // Carve-out first: scripts/build.mjs + start.mjs live under the web-safe
  // scripts/ prefix but shape the SERVER build/boot (Railway watch paths).
  if (SERVER_SHAPING_SCRIPTS.has(file)) return false;
  return file.endsWith('.md') || WEB_SAFE_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function baseArgs() {
  return options.baseUrl ? ['--base', options.baseUrl] : [];
}

function safeDeployBaseArgs() {
  return [
    ...(options.baseUrl ? ['--base-url', options.baseUrl] : []),
    '--owner',
    release.drainOwner,
  ];
}

// Read production's live-game count so the release can decide whether a drain
// is actually needed. Returns null (fail-safe -> drain) on any read failure.
async function fetchActiveGameCount() {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let body;
    try {
      const response = await fetch(`${base}/api/server-status`, { signal: controller.signal });
      if (!response.ok) return null;
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
    return typeof body?.activeGames === 'number' ? body.activeGames : null;
  } catch {
    return null;
  }
}

function npmCommand(script, args = []) {
  if (args.length === 0) return ['npm', 'run', script];
  return ['npm', 'run', script, '--', ...args];
}

function runTimed(label, command) {
  run(['node', 'scripts/time-command.mjs', '--label', label, '--', ...command]);
}

// Once the push lands the branch reads as merged, and a merged task worktree
// is fair game for a sweep: on 2026-09-03 one was removed between the
// revision wait and the smokes, and the smoke spawn died on a cwd that no
// longer existed, with the release already on production. Nothing after the
// push needs THIS checkout (the CI wait reads the remote, the revision wait
// and the smokes read production), only the repo's scripts and the network,
// so the rest of the release runs from the control worktree, which holds the
// shared .git directory and cannot be swept.
function enterPostPushWorkdir() {
  let primary;
  try {
    primary = primaryWorktreeRoot(releaseRoot);
  } catch (error) {
    console.log(`warn: could not resolve the control worktree (${error.message}); staying put`);
    return;
  }
  if (path.resolve(primary) === path.resolve(releaseRoot)) return;
  workdir = primary;
  console.log(
    `post-push steps run from ${primary}: this task worktree reads as merged now and may be swept`,
  );
}

function run(command) {
  console.log(`\n$ ${quoteCommand(command)}`);
  const result = spawnSync(command[0], command.slice(1), { cwd: workdir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command[0]} exited with signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`${command[0]} exited with ${result.status}`);
}

function cancelUnpublishedDrain() {
  if (!release.drainCommitted || release.pushCompleted) return;
  console.error('release stopped before push completed; cancelling production drain');
  const command = ['node', 'scripts/safe-deploy.mjs', '--cancel', '--yes', ...safeDeployBaseArgs()];
  const result = spawnSync(command[0], command.slice(1), { cwd: workdir, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('warning: automatic drain cancellation failed; cancel /admin/drain manually');
  }
}

function runCapture(label, command, { quiet = false } = {}) {
  if (!quiet) console.log(`\n$ ${quoteCommand(command)}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: workdir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} exited with signal ${result.signal}`);
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${label} failed with exit ${result.status}${detail ? `\n${detail}` : ''}`);
  }
  if (result.stderr && !quiet) process.stderr.write(result.stderr);
  return result.stdout;
}

function git(args) {
  return runCapture('git', ['git', ...args], { quiet: true }).trim();
}

function readRemoteTargetRevision() {
  const output = git(['ls-remote', options.remote, `refs/heads/${options.targetBranch}`]);
  const [revision] = output.split(/\s+/);
  return revision || null;
}

function matchesPathPattern(file, pattern) {
  const normalized = normalizePath(pattern);
  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -'/**'.length);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (!normalized.includes('*')) return file === normalized;
  return globToRegex(normalized).test(file);
}

function globToRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char !== '*') {
      source += escapeRegex(char);
      continue;
    }

    if (pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else {
      source += '[^/]*';
    }
  }
  return new RegExp(`^${source}$`);
}

function revisionMatches(left, right) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function printList(label, values) {
  if (values.length === 0) return;
  console.log(`${label}:`);
  for (const value of values.slice(0, 30)) console.log(`  ${value}`);
  if (values.length > 30) console.log(`  ... ${values.length - 30} more`);
}

function normalizePath(file) {
  return file
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteCommand(command) {
  return command.map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ');
}

function formatDuration(ms) {
  if (ms < 1_000) return `${ms}ms`;
  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  npm run release:prod -- --push
  npm run release:prod -- --push --smoke lite
  npm run release:prod -- --skip-local-ci --smoke web
  node scripts/release-prod.mjs --plan
  node scripts/release-prod.mjs --plan-base <rev> [--head <rev>]
  node scripts/release-prod.mjs --plan-file apps/web/src/main.ts --plan-file scripts/build.mjs

Order:
  local ci:quick -> drain to zero when games are live -> optional git push -> hosted GitHub CI when matched -> production revision wait when deploying -> smoke

Options:
  --push                   Push --head to origin/main. Drains production first
                           only when games are live (needs a drain token then:
                           MISTBOARD_DRAIN_TOKEN, else the keychain); an empty
                           pool deploys token-free. Without this, assume it is
                           already pushed.
  --head <ref>             Commit/ref to release, default HEAD.
  --plan                   Dry run: print the deploy plan, hosted CI plan, and
                           resolved smoke tier, then exit. No ci, push, or smoke.
  --plan-base <rev>        Plan mode with the tier/CI diff taken from <rev>..head
                           instead of the live production revision. Implies --plan.
  --plan-file <path>       Plan mode with an injected changed-file list (repeat
                           the flag per file). Implies --plan.
  --target-branch <name>   Production branch to push/wait, default ${DEFAULT_TARGET_BRANCH}.
  --remote <name>          Git remote for --push, default ${DEFAULT_REMOTE}.
  --smoke <tier>           Smoke tier: full, web, lite, none. Default ${DEFAULT_SMOKE}.
  --skip-local-ci          Do not run npm run ci:quick before push.
  --skip-ci-wait           Do not wait for hosted GitHub CI.
  --ci-workflow <file>     GitHub CI workflow to wait for, default ${DEFAULT_CI_WORKFLOW}.
  --base <url>             Production base URL, default ${DEFAULT_BASE_URL}.
  --timeout-ms <ms>        Timeout for hosted CI and revision wait, default ${DEFAULT_TIMEOUT_MS}.

Use --push instead of a standalone git push when you want this command to own
the release order. A deploying push requires a drain token only when production
is serving live games (it drains them first and stops if they do not finish
inside the drain window); with an empty pool the deploy runs token-free. The
token is read from MISTBOARD_DRAIN_TOKEN, or from the macOS keychain when that
is unset, so an unattended release never needs it typed into a shell.
For docs-only or other non-deploy commits, the planner skips
the exact-revision wait because production is not expected to serve that SHA,
but still waits for hosted CI when the diff matches the CI workflow paths. When
local ci:quick runs, --push uses git push --no-verify to avoid running the same
broad pre-push gate twice. With --skip-local-ci, the pre-push hook still runs
normally.`);
}
