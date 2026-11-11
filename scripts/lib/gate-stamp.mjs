import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

// Snapshot the files being tested, including staged, unstaged and untracked
// changes. All index writes go to a private copy, never the caller's index.
export function captureGateStamp({ root = process.cwd() } = {}) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'mistboard-gate-index-'));
  try {
    const index = path.join(temporary, 'index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    const git = (args, gitEnv = process.env) => {
      const result = spawnSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8' });
      if (result.error || result.status !== 0) throw new Error('could not snapshot working tree');
      return result.stdout.trim();
    };
    const original = process.env.GIT_INDEX_FILE ?? git(['rev-parse', '--git-path', 'index']);
    const originalPath = path.resolve(root, original);
    if (existsSync(originalPath)) copyFileSync(originalPath, index);
    git(['add', '-A', '--', '.'], env);
    // release:prod commits its --changelog line before the gate, so a key that
    // covered CHANGELOG.md would never match the pre-ship run. That commit
    // runs the changelog grammar test itself, which is the only gate it needs.
    git(['rm', '--cached', '-q', '--ignore-unmatch', '--', 'CHANGELOG.md'], env);
    const tree = git(['write-tree'], env);
    if (!/^[a-f0-9]{40,64}$/.test(tree)) throw new Error('invalid tree hash');
    const lock = createHash('sha256')
      .update(readFileSync(path.join(root, 'package-lock.json')))
      .digest('hex');
    const directory =
      process.env.MISTBOARD_GATE_STAMP_DIR ??
      path.join(homedir(), '.local/share/mistboard/gate-stamps');
    return {
      path: path.resolve(directory, `${tree}-${lock}.json`),
      head: git(['rev-parse', 'HEAD']),
    };
  } catch (error) {
    console.warn(`gate stamp unavailable: ${error.message}`);
    return null;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function readGateStamp(snapshot) {
  if (!snapshot) return [];
  try {
    const stamp = JSON.parse(readFileSync(snapshot.path, 'utf8'));
    if (!Array.isArray(stamp.stages)) return [];
    return stamp.stages.filter((stage) => typeof stage.name === 'string' && stage.ok === true);
  } catch {
    // Missing, unreadable or incomplete evidence always falls back to running.
    return [];
  }
}

export function writeGateStamp(snapshot, profile, results, { root = process.cwd() } = {}) {
  if (!snapshot) return;
  let temporary;
  try {
    // A concurrent edit or a command that changes source invalidates the run.
    // Record the attempt, but never attach green results to a mixed tree.
    const unchanged = captureGateStamp({ root })?.path === snapshot.path;
    if (!unchanged) console.warn('gate tree changed during the run; results will not be reused');
    const stamp = {
      profile,
      stages: results.map((result) => ({
        name: result.command.join(' '),
        ok: unchanged && result.status === 'passed',
        ms: result.durationMs ?? 0,
      })),
      finishedAt: new Date().toISOString(),
      head: snapshot.head,
    };
    mkdirSync(path.dirname(snapshot.path), { recursive: true });
    temporary = `${snapshot.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(stamp, null, 2)}\n`);
    renameSync(temporary, snapshot.path);
  } catch (error) {
    console.warn(`could not write gate stamp: ${error.message}`);
  } finally {
    if (temporary) rmSync(temporary, { force: true });
  }
}
