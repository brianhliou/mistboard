#!/usr/bin/env node
// Reuse production probes against an already-running, production-shaped local pair.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function localBaseUrl(value) {
  if (!value) throw new Error('local smokes require an explicit --base <loopback URL>');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('local smokes require a loopback origin (localhost, 127.0.0.1 or [::1])');
  }
  return url.origin;
}

export function localSmokePlan(base, { revision } = {}) {
  const baseUrl = localBaseUrl(base);
  const probes = [
    ['prod-lite-smoke.mjs'],
    ['prod-correspondence-smoke.mjs'],
    ['prod-smoke.mjs', ...(revision ? ['--expect-revision', revision] : [])],
    ['prod-engine-smoke.mjs', '--engine', 'builtin-random-legal'],
    // The seven main variant probes, with their real engine-seat assertions.
    // Missing local engines must fail here rather than first failing after a push.
    ['prod-dxq-smoke.mjs'],
    ['prod-duck-smoke.mjs'],
    ['prod-xiangqi-smoke.mjs'],
    ['prod-jieqi-smoke.mjs'],
    ['prod-banqi-smoke.mjs'],
    ['prod-jungle-smoke.mjs'],
    ['prod-jungle-flip-smoke.mjs'],
    // Override an inherited backend filter: a gate always searches every backend.
    ['prod-ceval-smoke.mjs', '--backend', 'all'],
  ];
  return probes.map(([script, ...args]) => ({
    script,
    command: [process.execPath, `scripts/${script}`, '--base', baseUrl, ...args],
  }));
}

export async function runLocalSmokes(base, { revision, run = runCommand, log = console.log } = {}) {
  const plan = localSmokePlan(base, { revision });
  const failures = [];
  // Sequential: ceval and engine probes share the host with other worktrees.
  // Still run every probe after a failure so one missing engine cannot hide ceval.
  for (const { script, command } of plan) {
    log(`$ ${command.join(' ')}`);
    try {
      await run(command);
    } catch (error) {
      failures.push(script);
      log(`local smoke FAILED: ${script}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${plan.length} local smokes failed: ${failures.join(', ')}`,
    );
  }
  log(`local production smokes: ok (${plan.length} probes)`);
}

export function isLocalBuild(status, revision, builtAt) {
  return status?.build?.revision === revision && status?.build?.builtAt === builtAt;
}

async function runCommand([command, ...args]) {
  const child = spawn(command, args, { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (signal || code !== 0) throw new Error(`exited with ${signal ?? code}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === '--plan') options.plan = true;
      else if (flag === '--base' || flag === '--expect-revision') {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
        options[flag === '--base' ? 'base' : 'revision'] = value;
      } else throw new Error(`unknown argument: ${flag}`);
    }
    if (options.plan) console.log(JSON.stringify(localSmokePlan(options.base, options), null, 2));
    else await runLocalSmokes(options.base, options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
