import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

// One production release at a time on this machine. On 2026-09-30 several
// sessions released mistboard in parallel and each push cancelled the hosted CI
// run of the one before it (ci.yml's cancel-in-progress). The lock makes them
// queue instead: a file created O_EXCL, holding who has it, released on exit.
//
// Machine-wide, not per checkout: the collision is on origin/main, and every
// worktree on this machine pushes to the same branch.

export const DEFAULT_LOCK_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_LOCK_POLL_MS = 10_000;
// A lock file that exists but does not parse is a holder between its O_EXCL
// create and its write. Past this age it is a crash in that window instead.
const UNREADABLE_GRACE_MS = 30_000;

export function defaultLockPath(env = process.env) {
  return (
    env.MISTBOARD_RELEASE_LOCK ||
    path.join(homedir(), '.local', 'share', 'mistboard', 'release.lock')
  );
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return error?.code === 'EPERM';
  }
}

export function readLock(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
  try {
    const holder = JSON.parse(raw);
    if (holder && typeof holder === 'object') return { exists: true, raw, holder };
  } catch {}
  return { exists: true, raw, holder: null };
}

/**
 * One attempt. Returns { acquired: true, takenOver } with the lock written, or
 * { acquired: false, holder } when a live process holds it. A lock whose pid is
 * dead is stale: it is removed and taken, and `takenOver` names the old holder.
 */
export function tryAcquireLock(file, info, { isAlive = isPidAlive, now = Date.now } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  let takenOver = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(file, 'wx', 0o644);
      try {
        writeSync(fd, `${JSON.stringify(info, null, 2)}\n`);
      } finally {
        closeSync(fd);
      }
      return { acquired: true, takenOver };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const current = readLock(file);
    if (!current.exists) continue;
    if (!isStale(current, file, { isAlive, now })) {
      return { acquired: false, holder: current.holder };
    }
    // Remove only the stale file we read: if another waiter took it over in
    // the meantime the content differs and the new holder is left alone. The
    // window between this re-read and the unlink is the residual race; it
    // needs two waiters to find the same dead holder within microseconds.
    const again = readLock(file);
    if (again.exists && again.raw === current.raw) {
      try {
        unlinkSync(file);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      takenOver = current.holder ?? { unreadable: true };
    }
  }
  const current = readLock(file);
  return { acquired: false, holder: current.holder };
}

function isStale(current, file, { isAlive, now }) {
  if (current.holder) return !isAlive(Number(current.holder.pid));
  // Unparsable: give a holder mid-write its grace period, then call it stale.
  try {
    const age = now() - statSync(file).mtimeMs;
    return age > UNREADABLE_GRACE_MS;
  } catch {
    return false;
  }
}

export function describeHolder(holder, now = Date.now()) {
  if (!holder) return 'an unreadable lock file';
  const since = Date.parse(holder.startedAt);
  const age = Number.isFinite(since) ? ` for ${formatMinutes(now - since)}` : '';
  return [
    `pid ${holder.pid}${age}`,
    holder.worktree ? `in ${holder.worktree}` : null,
    holder.branch ? `on ${holder.branch}` : null,
    holder.head ? `at ${String(holder.head).slice(0, 12)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatMinutes(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes < 1 ? 'under a minute' : `${minutes}m`;
}

export function lockInfo({ worktree, branch, head }) {
  return {
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
    worktree,
    branch,
    head,
    token: randomBytes(8).toString('hex'),
  };
}

/**
 * Take the lock, waiting while a live process holds it. Polls every `pollMs`
 * up to `timeoutMs`, then throws naming the holder. Resolves to a handle whose
 * release() removes the lock only while it is still ours.
 */
export async function acquireReleaseLock({
  file = defaultLockPath(),
  info,
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
  pollMs = DEFAULT_LOCK_POLL_MS,
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  isAlive = isPidAlive,
} = {}) {
  const deadline = now() + timeoutMs;
  let announced = null;
  let lastProgress = now();
  for (;;) {
    const attempt = tryAcquireLock(file, info, { isAlive, now });
    if (attempt.acquired) {
      if (attempt.takenOver) {
        log(
          `release lock: took over a stale lock from ${describeHolder(attempt.takenOver, now())} (that process is gone)`,
        );
      }
      if (announced) log(`release lock: acquired after waiting (${file})`);
      return {
        file,
        info,
        waited: announced !== null,
        release: () => releaseLock(file, info),
      };
    }
    const holderKey = attempt.holder?.token ?? attempt.holder?.pid ?? 'unreadable';
    if (holderKey !== announced) {
      log(
        `release lock: held by ${describeHolder(attempt.holder, now())}; waiting for it (polling every ${Math.round(
          pollMs / 1000,
        )}s, up to ${formatMinutes(Math.max(0, deadline - now()))})`,
      );
      announced = holderKey;
      lastProgress = now();
    } else if (now() - lastProgress >= 60_000) {
      log(`release lock: still waiting on ${describeHolder(attempt.holder, now())}`);
      lastProgress = now();
    }
    if (now() + pollMs > deadline) {
      throw new Error(
        `release lock: timed out after ${formatMinutes(timeoutMs)} waiting for ${describeHolder(
          attempt.holder,
          now(),
        )} (${file}). If that release is wedged, stop it; a dead holder's lock is taken over automatically.`,
      );
    }
    await sleep(pollMs);
  }
}

// Remove the lock only when it still holds our token: a lock taken over after
// we were presumed dead belongs to its new holder.
export function releaseLock(file, info) {
  const current = readLock(file);
  if (!current.exists || current.holder?.token !== info.token) return false;
  try {
    unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Release on every way out: normal exit, process.exit from a failure path, an
 * uncaught throw, SIGINT and SIGTERM. A signal handler replaces Node's default
 * (terminate), so it exits itself, with the conventional 128+signal code.
 */
export function releaseOnExit(handle, proc = process) {
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    try {
      handle.release();
    } catch {}
  };
  proc.on('exit', releaseOnce);
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    proc.on(signal, () => {
      releaseOnce();
      proc.exit(code);
    });
  }
  return releaseOnce;
}
