#!/usr/bin/env node
// Run a command against the production database through Railway's SSH tunnel.
//
//   npm run prod:db -- node scripts/account-flags.mjs @handle --disable-play
//   npm run prod:db -- npm run -s study:edit -- --plan plan.json
//
// Postgres has had no public TCP proxy since the 2026-10-21 secret rotation,
// so DATABASE_PUBLIC_URL no longer exists. This opens
// `railway connect Postgres --tunnel-only` on a free local port, runs the
// command with DATABASE_URL (and DATABASE_PUBLIC_URL, for scripts that still
// read it) pointing at the tunnel, and closes the tunnel when the command
// exits. The tunnel's own output names the credentials, so it is discarded;
// nothing here prints a credential.
//
// Railway commands run from the main checkout (the linked directory); the
// command itself runs in the directory you called from, so worktrees work.

import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const TUNNEL_TIMEOUT_MS = 30_000;

export function tunnelDatabaseUrl(env, port) {
  const missing = ['PGUSER', 'PGPASSWORD', 'PGDATABASE'].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`prod-db: the Postgres service variables lack ${missing.join(', ')}`);
  }
  const enc = encodeURIComponent;
  return `postgresql://${enc(env.PGUSER)}:${enc(env.PGPASSWORD)}@127.0.0.1:${port}/${enc(env.PGDATABASE)}`;
}

export function tunnelChildEnv(env, port) {
  const url = tunnelDatabaseUrl(env, port);
  return {
    ...env,
    DATABASE_URL: url,
    DATABASE_PUBLIC_URL: url,
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
  };
}

// argv after the script: `--inner <port> <cwd> -- <command…>` or `<command…>`.
export function parseArgs(argv) {
  if (argv[0] === '--inner') {
    const [, port, cwd, separator, ...command] = argv;
    if (separator !== '--' || !port || !cwd || command.length === 0) {
      throw new Error('prod-db: malformed --inner call');
    }
    return { inner: true, port: Number(port), cwd, command };
  }
  const command = argv[0] === '--' ? argv.slice(1) : argv;
  return { inner: false, command };
}

function railwayEnv() {
  // A shell snapshot can export a RAILWAY_API_TOKEN the CLI rejects
  // ("Unauthorized"); the CLI's own login is the one we want.
  const { RAILWAY_API_TOKEN: _dropped, ...env } = process.env;
  return env;
}

function mainCheckout() {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return path.dirname(common);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitForTunnel(port, tunnel) {
  const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (tunnel.exitCode !== null) {
      throw new Error(
        `prod-db: railway connect exited (${tunnel.exitCode}) before the tunnel opened; ` +
          'check `railway whoami` and that the main checkout is linked (`railway status`)',
      );
    }
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `prod-db: the tunnel did not open on port ${port} within ${TUNNEL_TIMEOUT_MS / 1000}s`,
  );
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

async function outer(command) {
  const root = mainCheckout();
  const port = await freePort();
  const tunnel = spawn('railway', ['connect', 'Postgres', '--tunnel-only', '-P', String(port)], {
    cwd: root,
    env: railwayEnv(),
    stdio: 'ignore',
  });
  const close = () => {
    if (tunnel.exitCode === null) tunnel.kill('SIGTERM');
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    await waitForTunnel(port, tunnel);
    return await run(
      'railway',
      [
        'run',
        '-s',
        'Postgres',
        '--',
        process.execPath,
        SELF,
        '--inner',
        String(port),
        process.cwd(),
        '--',
        ...command,
      ],
      { cwd: root, env: railwayEnv() },
    );
  } finally {
    close();
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command.length === 0) {
    console.error('usage: npm run prod:db -- <command> [args…]');
    return 2;
  }
  if (parsed.inner) {
    const [command, ...args] = parsed.command;
    return run(command, args, { cwd: parsed.cwd, env: tunnelChildEnv(process.env, parsed.port) });
  }
  return outer(parsed.command);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(1);
    },
  );
}
