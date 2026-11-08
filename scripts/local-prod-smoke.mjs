#!/usr/bin/env node
// Reuse production probes against an already-running, production-shaped local pair.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Match the binary, not the variant: missing AB-JChess must not hide a
// PikaJieQi failure. Fog/DXQ use the separate worker, and ceval uses browser
// WASM, so none of those probes depend on the web server's native binaries.
const NATIVE_ENGINE_DEPENDENCIES = {
  'prod-duck-smoke.mjs': ['fairy-stockfish-duck-xiangqi', 'MISTBOARD_FSF_DUCK_XIANGQI_PATH'],
  'prod-xiangqi-smoke.mjs': ['fairy-stockfish', 'MISTBOARD_FSF_PATH'],
  'prod-jieqi-smoke.mjs': ['pikafish-jieqi', 'MISTBOARD_PIKAFISH_PATH'],
  'prod-banqi-smoke.mjs': ['banqi-engine', 'MISTBOARD_BANQI_ENGINE_PATH'],
  'prod-jungle-smoke.mjs': ['jungle-engine', 'MISTBOARD_JUNGLE_ENGINE_PATH'],
  'prod-jungle-flip-smoke.mjs': ['jungle-flip-engine', 'MISTBOARD_JUNGLE_FLIP_ENGINE_PATH'],
};

// Consume only the owned server's JSON boot records. Wait for its summary:
// health can go green before main.ts finishes checking the engines. Incomplete
// or inconsistent reports must never authorize skipping any probe.
export function createEngineBootCheckReader() {
  let pending = '';
  let summary = null;
  const missing = [];
  return {
    write(chunk) {
      if (summary) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record?.kind === 'engine_binary_missing') {
          missing.push({ variant: record.variant, binary: record.binary });
        } else if (record?.kind === 'engine_boot_check') {
          summary = record;
          pending = '';
          break;
        }
      }
    },
    result() {
      if (!summary) return null;
      if (
        !Number.isInteger(summary.checked) ||
        summary.checked < 0 ||
        !Number.isInteger(summary.present) ||
        summary.present < 0 ||
        summary.missing !== missing.length ||
        summary.checked !== summary.present + missing.length ||
        missing.some(
          ({ variant, binary }) => typeof variant !== 'string' || typeof binary !== 'string',
        )
      ) {
        throw new Error('local server engine boot check is incomplete or inconsistent');
      }
      return { checked: summary.checked, missing };
    },
  };
}

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

export function localSmokePlan(base, { revision, missingEngines = [] } = {}) {
  const baseUrl = localBaseUrl(base);
  const probes = [
    ['prod-lite-smoke.mjs'],
    ['prod-correspondence-smoke.mjs'],
    ['prod-smoke.mjs', ...(revision ? ['--expect-revision', revision] : [])],
    ['prod-engine-smoke.mjs', '--engine', 'builtin-random-legal'],
    // The seven main variant probes, with their real engine-seat assertions.
    // Only skip a probe when the boot check reports its own binary missing.
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
  return probes.map(([script, ...args]) => {
    const dependency = NATIVE_ENGINE_DEPENDENCIES[script];
    const skip = dependency && missingEngines.some(({ binary }) => binary === dependency[0]);
    return {
      script,
      command: [process.execPath, `scripts/${script}`, '--base', baseUrl, ...args],
      ...(skip ? { missingBinary: dependency[0], supplyEnv: dependency[1] } : {}),
    };
  });
}

export async function runLocalSmokes(
  base,
  { revision, missingEngines = [], run = runCommand, log = console.log } = {},
) {
  const plan = localSmokePlan(base, { revision, missingEngines });
  const failures = [];
  let skipped = 0;
  // Sequential: ceval and engine probes share the host with other worktrees.
  // Still run every available probe after a failure so no failure hides ceval.
  for (const { script, command, missingBinary, supplyEnv } of plan) {
    if (missingBinary) {
      skipped++;
      log(`local smoke SKIPPED: ${script}: missing ${missingBinary} (set ${supplyEnv})`);
      continue;
    }
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
      `${failures.length}/${plan.length - skipped} local smokes failed: ${failures.join(', ')}`,
    );
  }
  log(
    `local production smokes: ok (${plan.length - skipped} probes${skipped ? `, ${skipped} skipped` : ''})`,
  );
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
