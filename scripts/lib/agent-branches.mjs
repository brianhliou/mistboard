import { spawnSync } from 'node:child_process';
import { parkedBranches, parseBranchRefs } from './ship-window.mjs';

function git(root, args, missingStatus = null) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (missingStatus !== null && result.status === missingStatus) return null;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function branchRefs(root) {
  return parseBranchRefs(
    git(root, ['for-each-ref', '--format=%(refname:short)%09%(worktreepath)', 'refs/heads/agent/']),
  );
}

function readParkedMark(root, branch) {
  const value = git(root, ['config', '--local', '--get', `branch.${branch}.mistboardParked`], 1);
  const match = /^(\d{4}-\d{2}-\d{2}) (\S[^\r\n]*)$/.exec(value ?? '');
  return match ? { date: match[1], reason: match[2] } : null;
}

// Exclude commits reachable from EITHER the batch or main, including branches
// partly merged into each. A failed git read must stop the release, not hide work.
export function readUnshippedAgentBranches({
  root = process.cwd(),
  head = 'HEAD',
  base = 'origin/main',
} = {}) {
  const headRevision = git(root, ['rev-parse', '--verify', `${head}^{commit}`]);
  const baseRevision = git(root, ['rev-parse', '--verify', `${base}^{commit}`]);
  const entries = branchRefs(root)
    .filter(({ branch }) => !branch.startsWith('agent/ship-'))
    .map((ref) => ({
      ...ref,
      ahead: Number(
        git(root, ['rev-list', '--count', ref.branch, '--not', headRevision, baseRevision, '--']),
      ),
    }));
  return parkedBranches(entries).map((entry) => ({
    ...entry,
    parked: readParkedMark(root, entry.branch),
  }));
}

export function assertAgentBranchesAccountedFor({ log = console.log, ...options } = {}) {
  const entries = readUnshippedAgentBranches(options);
  const unmarked = entries.filter(({ parked }) => !parked);
  log('# unshipped agent branches');
  for (const entry of entries) {
    log(`  ${entry.branch} (+${entry.ahead}) ${entry.worktree ?? '(no worktree)'}`);
    if (entry.parked) log(`    parked: ${entry.parked.date} ${entry.parked.reason}`);
    else
      log(`    park: npm run branch:park -- '${entry.branch.replaceAll("'", "'\\''")}' "<reason>"`);
  }
  log(
    `agent_branches: ${unmarked.length > 0 ? 'refuse' : 'allow'} (${unmarked.length} unmarked, ${entries.length - unmarked.length} parked)`,
  );
  if (unmarked.length > 0) {
    throw new Error(
      `release refused: merge or park each unmarked branch: ${unmarked.map(({ branch }) => branch).join(', ')}`,
    );
  }
}

function requireLocalAgentBranch(root, branch) {
  if (!branch?.startsWith('agent/')) throw new Error('expected a local agent/* branch');
  git(root, ['check-ref-format', `refs/heads/${branch}`]);
  git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
}

export function parkBranch(branch, reason, { root = process.cwd(), now = new Date() } = {}) {
  requireLocalAgentBranch(root, branch);
  if (typeof reason !== 'string' || !reason.trim() || /[\r\n]/.test(reason)) {
    throw new Error('branch:park needs a non-empty, single-line reason');
  }
  const mark = `${now.toISOString().slice(0, 10)} ${reason.trim()}`;
  git(root, ['config', '--local', '--replace-all', `branch.${branch}.mistboardParked`, mark]);
  return mark;
}

export function unparkBranch(branch, { root = process.cwd() } = {}) {
  requireLocalAgentBranch(root, branch);
  git(root, ['config', '--local', '--unset-all', `branch.${branch}.mistboardParked`], 5);
}

export function listParkedBranches({ root = process.cwd() } = {}) {
  return branchRefs(root)
    .map(({ branch }) => ({ branch, parked: readParkedMark(root, branch) }))
    .filter(({ parked }) => parked);
}
