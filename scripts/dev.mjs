#!/usr/bin/env node

// Launch the dev server+web pair with parameterizable ports so multiple worktree
// sessions can run side by side against ONE shared Postgres.
//
// One knob: MISTBOARD_DEV_PORT_BASE (default 3000).
//   web    = base      (vite --port ${PORT} --strictPort)
//   server = base + 1  (server-config.ts reads PORT, defaults to 3001)
//   web proxy + derived dev WebSocket URL point at http://localhost:${base + 1}
//   via MISTBOARD_DEV_API_URL (vite.config.ts).
//
// strictPort stays on for BOTH: an occupied port is a loud failure, never a
// silent auto-increment (a hard repo rule — a stray listener otherwise serves a
// stale tree, see the Localhost Port Shadowing lesson).
//
//   node scripts/dev.mjs            # persistent (Postgres-backed) server
//   node scripts/dev.mjs --memory   # in-memory server (no Postgres)

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_SERVER_FLAGS } from './product-profile.mjs';
import { currentWorktreeRole } from './worktree-role.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const concurrentlyBin = resolve(repoRoot, 'node_modules', '.bin', 'concurrently');

const memory = process.argv.includes('--memory');
const serverScript = memory ? 'dev' : 'dev:persistent';

const childEnv = { ...process.env };
for (const flag of PRODUCT_SERVER_FLAGS) {
  if (childEnv[flag] === undefined) childEnv[flag] = 'true';
}

if (currentWorktreeRole(repoRoot) === 'control') {
  console.warn(
    'dev: shared control worktree detected. For concurrent write work, create an isolated task worktree with npm run worktree:new -- <slug> --prepare.',
  );
}

const base = parsePortBase(process.env.MISTBOARD_DEV_PORT_BASE);
const webPort = base;
const serverPort = base + 1;
const devApiUrl = `http://localhost:${serverPort}`;

const serverCommand = `env PORT=${serverPort} npm run ${serverScript} --workspace @mistboard/server`;
const webCommand = `env PORT=${webPort} MISTBOARD_DEV_API_URL=${devApiUrl} npm run dev --workspace @mistboard/web`;

console.log(
  `dev: web=${webPort} server=${serverPort} (${memory ? 'in-memory' : 'persistent'}); ` +
    `set MISTBOARD_DEV_PORT_BASE to run a second session on other ports.`,
);

const child = spawn(
  concurrentlyBin,
  [
    '--kill-others-on-fail',
    '--names',
    'server,web',
    '--prefix-colors',
    'blue,green',
    serverCommand,
    webCommand,
  ],
  { stdio: 'inherit', env: childEnv },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

function parsePortBase(raw) {
  if (raw === undefined || raw.trim() === '') return 3000;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1024 || value > 65_534) {
    console.error(
      `dev: MISTBOARD_DEV_PORT_BASE must be an integer in [1024, 65534] (got "${raw}"). ` +
        'web binds to it and server to base+1.',
    );
    process.exit(1);
  }
  return value;
}
