import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

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
      'databaseId,status,conclusion,headSha,url',
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
export function findReusableBatchCi({ root, headRevision, findRun }) {
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
  for (const revision of candidates) {
    const run = findRun(revision, `release/${revision}`);
    if (run?.headSha === revision && run.status === 'completed' && run.conclusion === 'success') {
      return run;
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
  const deadline = now() + timeoutMs;
  while (now() <= deadline) {
    const run = readRun({ root, revision });
    if (run?.headSha === revision && run.status === 'completed') {
      if (run.conclusion !== 'success') {
        failedJobs({ root, run, log });
        throw new Error(
          `hosted CI failed with conclusion ${run.conclusion ?? 'unknown'}: ${run.url ?? revision}`,
        );
      }
      log(`hosted CI passed: ${run.url ?? revision}`);
      return run;
    }
    log(`hosted CI: ${run?.status ?? 'waiting for the run to appear'} on ${branch}`);
    if (now() + pollMs > deadline) break;
    await wait(pollMs);
  }
  throw new Error(`timed out waiting for ci.yml on ${revision}`);
}
