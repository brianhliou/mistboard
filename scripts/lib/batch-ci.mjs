import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { retryHostedCi, waitForExactCi } from './ci-flake-retry.mjs';

function capture(root, command, args, { trim = true } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return trim ? result.stdout.trim() : result.stdout;
}

export function readBatchRun({ root, revision, workflow = 'ci.yml' }) {
  const runs = JSON.parse(
    capture(root, 'gh', [
      'run',
      'list',
      '--workflow',
      workflow,
      '--branch',
      `release/${revision}`,
      '--commit',
      revision,
      '--event',
      'push',
      '--json',
      'databaseId,status,conclusion,headSha,url,attempt',
      '--limit',
      '10',
    ]),
  );
  if (!Array.isArray(runs)) throw new Error('could not parse gh run list JSON: not an array');
  // The newest matching run wins, even when an older attempt was green.
  return runs.find((run) => run.headSha === revision) ?? null;
}

// Limit the changelog exception to a direct, single-parent commit. Comparing
// complete trees (with renames disabled) also catches deletions and mode changes.
export function findReusableBatchCi({
  root,
  headRevision,
  findRun,
  listRuns = () => [],
  acceptRun = (run) => run.status === 'completed' && run.conclusion === 'success',
}) {
  const parents = capture(root, 'git', ['rev-list', '--parents', '-n', '1', headRevision]).split(
    ' ',
  );
  const candidates = [headRevision];
  if (parents.length === 2) {
    const changed = capture(
      root,
      'git',
      ['diff', '--name-only', '--no-renames', '-z', parents[1], headRevision, '--'],
      { trim: false },
    )
      .split('\0')
      .filter(Boolean);
    if (changed.every((file) => file === 'CHANGELOG.md')) candidates.push(parents[1]);
  }
  const inspected = new Set();
  for (const revision of candidates) {
    const run = findRun(revision, `release/${revision}`);
    if (run?.headSha === revision) inspected.add(revision);
    if (run?.headSha === revision && acceptRun(run)) {
      return run;
    }
  }
  // A new commit SHA (for example, an empty merge) does not invalidate the
  // tested tree. Only locally available commits can supply tree evidence.
  const trees = candidates.map((revision) =>
    capture(root, 'git', ['rev-parse', `${revision}^{tree}`]),
  );
  const seen = new Set(inspected);
  for (const run of listRuns()) {
    if (seen.has(run.headSha)) continue;
    seen.add(run.headSha);
    if (!acceptRun(run)) continue;
    try {
      const tree = capture(root, 'git', ['rev-parse', '--verify', `${run.headSha}^{tree}`]);
      if (trees.includes(tree)) return run;
    } catch {
      // Missing commit objects cannot authorize promotion.
    }
  }
  return null;
}

export function printFailedBatchJobs({ root, run, log = console.log }) {
  try {
    const { jobs } = JSON.parse(
      capture(root, 'gh', ['run', 'view', String(run.databaseId), '--json', 'jobs']),
    );
    if (!Array.isArray(jobs)) throw new Error('jobs is not an array');
    for (const job of jobs) {
      if (job.conclusion && !['success', 'skipped', 'neutral'].includes(job.conclusion)) {
        log(`failed job: ${job.name} (${job.conclusion})${job.url ? ` ${job.url}` : ''}`);
      }
    }
  } catch (error) {
    log(`warn: could not read failed jobs (${error.message})`);
  }
}

export async function runBatchCi({
  root,
  timeoutMs = 2_100_000,
  pollMs = 10_000,
  log = console.log,
  readRun = readBatchRun,
  failedJobs = printFailedBatchJobs,
  now = Date.now,
  wait = sleep,
}) {
  if (capture(root, 'git', ['status', '--porcelain'])) {
    throw new Error('batch:ci requires a clean worktree; commit the assembled batch first');
  }
  const revision = capture(root, 'git', ['rev-parse', '--verify', 'HEAD^{commit}']);
  const branch = `release/${revision}`;
  log(`batch: ${revision} (${root})`);
  log(`git push origin ${revision}:refs/heads/${branch}`);
  capture(root, 'git', ['push', 'origin', `${revision}:refs/heads/${branch}`]);
  try {
    const run = await waitForExactCi({
      readRun: () => {
        const found = readRun({ root, revision });
        return found?.headSha === revision ? found : null;
      },
      retry: (candidate) => retryHostedCi({ root, run: candidate, log }),
      timeoutMs,
      pollMs,
      log,
      now,
      wait,
    });
    log(`hosted CI passed: ${run.url ?? revision}`);
    return run;
  } catch (error) {
    const run = readRun({ root, revision });
    if (run?.headSha === revision && run.status === 'completed' && run.conclusion !== 'success')
      failedJobs({ root, run, log });
    throw error;
  }
}
