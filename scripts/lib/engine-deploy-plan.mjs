import { spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const ENGINE_REPO = 'brianhliou/mistboard-engine';
const SHA = /^[a-f0-9]{40}$/;

export function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0)
    throw new Error(`${command} metadata lookup failed; refusing an incomplete deployment check.`);
  return result.stdout.trim();
}

export function evaluateEngineCi(runs, sha) {
  if (!SHA.test(sha)) throw new Error('Engine CI requires the full commit SHA.');
  // Never let an older green run hide a newer red run or a pending rerun.
  const latest = runs
    .filter((run) => run.headSha === sha && run.headBranch === 'main' && run.event === 'push')
    .sort((a, b) => b.databaseId - a.databaseId)[0];
  return {
    passed: latest?.status === 'completed' && latest.conclusion === 'success',
    run: latest ?? null,
    description: latest
      ? `${latest.status}/${latest.conclusion || 'pending'}`
      : 'no main push CI run for this SHA',
  };
}

export function checkEngineCi(sha, run = commandOutput) {
  const runs = JSON.parse(
    run('gh', [
      'run',
      'list',
      '--repo',
      ENGINE_REPO,
      '--workflow',
      'ci.yml',
      '--commit',
      sha,
      '--branch',
      'main',
      '--event',
      'push',
      '--limit',
      '100',
      '--json',
      'databaseId,headSha,headBranch,event,status,conclusion,url',
    ]),
  );
  if (!Array.isArray(runs)) throw new Error('Invalid engine CI response.');
  return evaluateEngineCi(runs, sha);
}

export function journalPath(run = commandOutput) {
  return resolve(run('git', ['rev-parse', '--git-common-dir']), 'engine-worker-deployments.jsonl');
}

export function readBaseline(file, options = {}) {
  if (options.baselineEngine || options.baselineMistboard) {
    if (!SHA.test(options.baselineEngine ?? '') || !SHA.test(options.baselineMistboard ?? '')) {
      throw new Error(
        'Supply both --baseline-engine and --baseline-mistboard as verified full SHAs.',
      );
    }
    return {
      engineSha: options.baselineEngine,
      mistboardSha: options.baselineMistboard,
      source: 'explicit verified baseline',
    };
  }
  let rows;
  try {
    rows = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Cannot read deployment journal; supply a verified baseline before deploying.');
  }
  const last = rows.at(-1);
  if (!last) return null;
  // An interrupted or failed attempt makes the running revision uncertain.
  // Do not silently fall back to an older success.
  if (last.status !== 'healthy' || typeof last.deploymentId !== 'string') return null;
  if (!SHA.test(last.engineSha ?? '') || !SHA.test(last.mistboardSha ?? '')) {
    throw new Error('Invalid deployment journal SHAs.');
  }
  return {
    engineSha: last.engineSha,
    mistboardSha: last.mistboardSha,
    deploymentId: last.deploymentId,
    source: 'last healthy scripted deployment',
  };
}

export function baselineMatchesDeployment(baseline, deployments) {
  const latest = deployments[0];
  return latest?.id === baseline.deploymentId && latest.status === 'SUCCESS';
}

export function newDeploymentId(deployments, previousDeployments) {
  const previousIds = new Set(previousDeployments.map((deployment) => deployment.id));
  const candidates = deployments.filter((deployment) => !previousIds.has(deployment.id));
  if (candidates.length !== 1)
    throw new Error(
      'Cannot uniquely identify the new Railway deployment; verify the running revision.',
    );
  return candidates[0].id;
}

export function appendDeployment(file, record) {
  const fd = openSync(file, 'a', 0o600);
  try {
    appendFileSync(fd, `${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function lockDeployment(file, record) {
  const lock = `${file}.lock`;
  let fd;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error(
      `An engine deployment lock exists at ${lock}. Resolve its owner before another deployment.`,
    );
  }
  try {
    appendFileSync(fd, JSON.stringify({ pid: process.pid, ...record }));
  } catch (error) {
    closeSync(fd);
    unlinkSync(lock);
    throw error;
  }
  return () => {
    closeSync(fd);
    unlinkSync(lock);
  };
}

export function engineFileKind(filename) {
  if (/^(labs?|benchmarks?|experiments?|research|notebooks)\//.test(filename)) return 'lab';
  // Unknown paths stay visible as runtime/build, never assumed harmless.
  return 'runtime/build';
}

export function compareEngine(base, head, run = commandOutput) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('Engine diff requires full SHAs.');
  if (base === head) return { commits: [], files: [] };
  const pages = run('gh', [
    'api',
    `repos/${ENGINE_REPO}/compare/${base}...${head}?per_page=100`,
    '--paginate',
    '--jq',
    '[{status, total_commits, base: .base_commit.sha, mergeBase: .merge_base_commit.sha, commits: [.commits[] | {sha, subject: (.commit.message | split("\\n")[0])}], files: [.files[]? | {filename, previous_filename, status}]}] | tojson',
  ])
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line));
  if (!Array.isArray(pages) || !pages.length) throw new Error('Missing engine comparison.');
  const commits = [
    ...new Map(
      pages.flatMap((page) => page.commits).map((commit) => [commit.sha, commit]),
    ).values(),
  ];
  const files = [
    ...new Map(pages.flatMap((page) => page.files).map((file) => [file.filename, file])).values(),
  ];
  // GitHub limits compare files to 300; never label a truncated diff complete.
  if (
    pages.some(
      (page) =>
        !['ahead', 'identical'].includes(page.status) ||
        page.base !== base ||
        page.mergeBase !== base,
    ) ||
    files.length >= 300 ||
    commits.length !== pages[0].total_commits ||
    commits.at(-1)?.sha !== head
  ) {
    throw new Error(
      'Engine comparison is divergent, truncated or incomplete; verify the baseline.',
    );
  }
  return {
    commits,
    files: files.map((file) => ({
      ...file,
      kind:
        file.previous_filename && engineFileKind(file.previous_filename) !== 'lab'
          ? 'runtime/build'
          : engineFileKind(file.filename),
    })),
  };
}

export function compareWorker(base, head, run = commandOutput) {
  if (!SHA.test(base) || !SHA.test(head)) throw new Error('Worker diff requires full SHAs.');
  // A missing/shallow/divergent baseline must not produce an empty change list.
  run('git', ['merge-base', '--is-ancestor', base, head]);
  const before = JSON.parse(run('git', ['show', `${base}:railway.engine-worker.json`])).build
    .watchPatterns;
  const after = JSON.parse(run('git', ['show', `${head}:railway.engine-worker.json`])).build
    .watchPatterns;
  if (![before, after].every((patterns) => Array.isArray(patterns) && patterns.length > 0))
    throw new Error('Missing worker build watch patterns.');
  const patterns = [...new Set([...before, ...after])].filter(
    (pattern) => !pattern.startsWith('!') || (before.includes(pattern) && after.includes(pattern)),
  );
  const paths = patterns.map((pattern) =>
    pattern.startsWith('!')
      ? `:(exclude,glob)${pattern.slice(1).replace(/^\//, '')}`
      : `:(glob)${pattern.replace(/^\//, '')}`,
  );
  // Keep the requested release-asset recipe visible even if watch rules change.
  paths.push(
    'scripts/fetch-release-asset.sh',
    'scripts/deploy-engine-worker.mjs',
    'scripts/lib/engine-deploy-plan.mjs',
  );
  const log = run('git', [
    'log',
    '--full-history',
    '--format=%H%x09%s',
    `${base}..${head}`,
    '--',
    ...paths,
  ]);
  return log
    ? log.split('\n').map((line) => {
        const [sha, ...subject] = line.split('\t');
        return { sha, subject: subject.join('\t') };
      })
    : [];
}

export function printDeploymentPlan(
  { engineSha, mistboardSha, ci, baseline, engineChanges, workerChanges, overrideReason },
  log = console.log,
) {
  log(`\nEngine CI: ${ci.description}${ci.run?.url ? ` (${ci.run.url})` : ''}`);
  if (overrideReason) log(`URGENT ENGINE CI OVERRIDE: ${overrideReason}`);
  log(`Candidate: engine ${engineSha}; mistboard ${mistboardSha}`);
  if (!baseline) {
    log('Running baseline UNKNOWN. Cannot determine the changes included.');
    log(
      'Before --deploy, supply --baseline-engine <verified-full-sha> --baseline-mistboard <verified-full-sha>.',
    );
    return;
  }
  log(
    `Baseline (${baseline.source}): engine ${baseline.engineSha}; mistboard ${baseline.mistboardSha}`,
  );
  log(`Engine commits included: ${engineChanges.commits.length}`);
  for (const commit of engineChanges.commits) log(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
  const onlyLab =
    engineChanges.files.length > 0 && engineChanges.files.every((file) => file.kind === 'lab');
  log(`Engine file changes: ${engineChanges.files.length}${onlyLab ? ' (lab only)' : ''}`);
  for (const file of engineChanges.files) log(`  [${file.kind}] ${file.status} ${file.filename}`);
  log(`Mistboard worker/build commits included: ${workerChanges.length}`);
  for (const commit of workerChanges) log(`  ${commit.sha.slice(0, 12)} ${commit.subject}`);
}
