#!/usr/bin/env node
// Full local suites queue across worktrees. Releases take release.lock first,
// then gate.lock only for local gate stages; nested npm scripts inherit ownership.

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPidAlive, releaseLock, tryAcquireLock } from './release-lock.mjs';

export const DEFAULT_GATE_LOCK_TIMEOUT_MS = 45 * 60_000;
export const DEFAULT_GATE_LOCK_POLL_MS = 10_000;

export function defaultGateLockPath() {
  return path.join(homedir(), '.local', 'share', 'mistboard', 'gate.lock');
}

function describeHolder(holder) {
  if (!holder) return 'an unreadable lock file';
  return `pid ${holder.pid} in ${holder.worktree} running ${holder.command} since ${holder.startedAt}`;
}

function currentBranch(worktree) {
  try {
    return (
      execFileSync('git', ['branch', '--show-current'], {
        cwd: worktree,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || '(detached)'
    );
  } catch {
    return '(unknown)';
  }
}

export async function acquireGateLock({
  env = process.env,
  file = defaultGateLockPath(),
  command = process.argv.slice(1).join(' '),
  worktree = process.cwd(),
  branch,
  timeoutMs = Number(env.MISTBOARD_GATE_LOCK_TIMEOUT_MS ?? DEFAULT_GATE_LOCK_TIMEOUT_MS),
  pollMs = DEFAULT_GATE_LOCK_POLL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isAlive = isPidAlive,
  log = console.log,
} = {}) {
  // Presence, including CI='', skips hosted runners. Do this before any lock IO.
  if (env.CI !== undefined || env.MISTBOARD_GATE_LOCK_HELD === '1') {
    return { skipped: true, release() {} };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('gate lock: timeout must be non-negative and poll interval must be positive');
  }
  const info = {
    pid: process.pid,
    worktree,
    branch: branch ?? currentBranch(worktree),
    command,
    startedAt: new Date(now()).toISOString(),
    token: randomUUID(),
  };
  const deadline = now() + timeoutMs;
  let announced;
  for (;;) {
    const attempt = tryAcquireLock(file, info, { isAlive, now });
    if (attempt.acquired) {
      const previous = env.MISTBOARD_GATE_LOCK_HELD;
      env.MISTBOARD_GATE_LOCK_HELD = '1';
      let released = false;
      const handle = {
        file,
        info,
        waited: announced !== undefined,
        release() {
          if (released) return;
          released = true;
          try {
            return releaseLock(file, info);
          } finally {
            if (previous === undefined) delete env.MISTBOARD_GATE_LOCK_HELD;
            else env.MISTBOARD_GATE_LOCK_HELD = previous;
          }
        },
      };
      if (attempt.takenOver) {
        log(
          `gate lock: took over a stale lock from ${describeHolder(attempt.takenOver)} (that process is gone)`,
        );
      }
      if (handle.waited) log('gate lock: acquired after waiting');
      return handle;
    }
    const holder = describeHolder(attempt.holder);
    if (holder !== announced) {
      log(`gate lock held by ${holder}; waiting (polling every ${pollMs / 1000}s)`);
      announced = holder;
    }
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(`gate lock: timed out after ${timeoutMs}ms waiting for ${holder} (${file})`);
    }
    await sleep(Math.min(pollMs, remaining));
  }
}

export async function withGateLock(command, run, options = {}) {
  const handle = await acquireGateLock({ ...options, command });
  const release = () => {
    try {
      handle.release();
    } catch {}
  };
  const signals = [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ];
  let stopping = false;
  const handlers = signals.map(([signal, code]) => {
    const handler = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await options.onSignal?.(signal);
      } finally {
        release();
        process.exit(code);
      }
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  process.once('exit', release);
  try {
    return await run();
  } finally {
    process.removeListener('exit', release);
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    handle.release();
  }
}

export async function runLockedCommand(command, options = {}) {
  if (command.length === 0) throw new Error('gate lock: expected a command after --');
  let child;
  let completed;
  const forwardSignal = async (signal) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try {
      // npm and shell stages have descendants; stop the entire owned group.
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await completed;
  };
  return withGateLock(
    command.join(' '),
    () => {
      child = spawn(command[0], command.slice(1), {
        stdio: 'inherit',
        detached: process.platform !== 'win32',
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
      completed = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1));
        });
      });
      return completed;
    },
    { ...options, onSignal: forwardSignal },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === '--') args.shift();
    process.exitCode = await runLockedCommand(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
