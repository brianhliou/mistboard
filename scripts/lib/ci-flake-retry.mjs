import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

const knownFlakes = JSON.parse(readFileSync(new URL('../ci-known-flakes.json', import.meta.url)));
const acceptable = new Set(['success', 'skipped', 'neutral']);

// Failed-step logs are input only: never print them, since CI output may
// contain private runtime details. Unknown formats and non-test errors refuse.
export function listedTestFailures(log, flakes = knownFlakes) {
  const clean = stripVTControlCharacters(log);
  const files = [];
  let failures = 0;
  const specFiles = [];
  for (const line of clean.split('\n')) {
    const spec = /\btest at (.+\.test\.[cm]?[jt]sx?):\d+/.exec(line);
    if (spec) specFiles.push(spec[1]);
    const vitest = /\bFAIL\s+(\S+\.test\.[cm]?[jt]sx?)(?:\s|$)/.exec(line);
    if (vitest) {
      failures++;
      files.push(vitest[1]);
    } else if (/\bnot ok \d+ - /.test(line)) {
      failures++;
    } else {
      const location = /\blocation: ['"]?([^'"\s]+\.test\.[cm]?[jt]sx?):\d+/.exec(line);
      if (location) files.push(location[1]);
    }
    if (
      /\berror TS\d+|\bFAIL\s+(?!\S+\.test\.[cm]?[jt]sx?(?:\s|$))|Unhandled (?:Error|Rejection)|\bError: Process completed/.test(
        line,
      )
    ) {
      return null;
    }
  }
  if (!failures && specFiles.length) {
    files.push(...specFiles);
    failures = specFiles.length;
  }
  if (!failures || files.length !== failures) return null;
  const matched = files.map((file) =>
    flakes.find((flake) => file === flake.file || file.endsWith(`/${flake.file}`)),
  );
  return matched.every(Boolean) ? [...new Set(matched.map((flake) => flake.file))] : null;
}

export async function retryKnownFlake({
  run,
  readJobs,
  readLog,
  rerun,
  record = () => {},
  log = console.log,
}) {
  // GitHub retains the attempt number across invocations. A second release
  // process must not grant the same failed run another automatic retry.
  if (run?.status !== 'completed' || run.conclusion !== 'failure' || run.attempt !== 1)
    return false;
  try {
    const jobs = readJobs(run);
    if (!Array.isArray(jobs) || jobs.some((job) => !job.conclusion)) return false;
    const failed = jobs.filter((job) => !acceptable.has(job.conclusion));
    if (!failed.length || failed.some((job) => job.conclusion !== 'failure')) return false;
    const files = new Set();
    // ci.yml's `node` job only aggregates required-job conclusions; rerunning
    // failed jobs must include it, but it supplies no additional test failure.
    const testJobs = failed.filter((job) => job.name !== 'node');
    if (!testJobs.length) return false;
    const aggregate = failed.find((job) => job.name === 'node');
    if (
      aggregate &&
      !aggregate.steps?.some(
        (step) => step.name === 'Check required jobs' && step.conclusion === 'failure',
      )
    )
      return false;
    if (
      aggregate?.steps?.some(
        (step) => !acceptable.has(step.conclusion) && step.name !== 'Check required jobs',
      )
    )
      return false;
    for (const job of testJobs) {
      const steps = job.steps?.filter((step) => !acceptable.has(step.conclusion));
      if (
        !steps?.length ||
        steps.some((step) => step.conclusion !== 'failure' || !/\btests\b/i.test(step.name))
      )
        return false;
      const listed = listedTestFailures(readLog(run, job));
      if (!listed) return false;
      for (const file of listed) files.add(file);
    }
    rerun(run);
    const entry = { runId: run.databaseId, attempt: 2, files: [...files], url: run.url };
    record(entry);
    log(
      `hosted CI: re-running failed jobs once for listed flakes (${entry.files.join(', ')}): ${run.url ?? run.databaseId}`,
    );
    return true;
  } catch {
    log('hosted CI: flake evidence unavailable; refusing automatic re-run');
    return false;
  }
}

export async function waitForExactCi({
  readRun,
  retry,
  timeoutMs,
  pollMs,
  wait,
  now = Date.now,
  log = console.log,
}) {
  const deadline = now() + timeoutMs;
  let retried = false;
  let previousAttempt = null;
  let run;
  while (now() <= deadline) {
    run = readRun();
    // GitHub can briefly return the old completed attempt after accepting a
    // rerun. Never mistake that stale badge for the result of attempt two.
    if (retried && run?.attempt <= previousAttempt) {
      log('hosted CI: waiting for the re-run attempt to appear');
    } else if (run?.status === 'completed') {
      if (run.conclusion === 'success') return run;
      if (!retried && (await retry(run))) {
        retried = true;
        previousAttempt = run.attempt;
        continue;
      }
      throw new Error(
        `hosted CI failed with conclusion ${run.conclusion ?? 'unknown'}: ${run.url ?? 'unknown run'}`,
      );
    } else {
      log(`hosted CI: ${run?.status ?? 'waiting for the run to appear'}`);
    }
    if (now() + pollMs > deadline) break;
    await wait(pollMs);
  }
  throw new Error(`timed out waiting for hosted CI; last run=${run?.url ?? 'not found'}`);
}

export async function retryHostedCi({ root, run, record, log }) {
  return retryKnownFlake({
    run,
    record,
    log,
    readJobs: (candidate) =>
      JSON.parse(gh(root, ['run', 'view', String(candidate.databaseId), '--json', 'jobs'])).jobs,
    readLog: (candidate, job) =>
      gh(root, [
        'run',
        'view',
        String(candidate.databaseId),
        '--job',
        String(job.databaseId),
        '--log-failed',
      ]),
    rerun: (candidate) => gh(root, ['run', 'rerun', String(candidate.databaseId), '--failed']),
  });
}

function gh(root, args) {
  const result = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('GitHub CI evidence unavailable');
  return result.stdout;
}
