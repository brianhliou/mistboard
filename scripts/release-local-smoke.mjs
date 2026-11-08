import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { isLocalBuild, localBaseUrl, runLocalSmokes } from './local-prod-smoke.mjs';
import { PRODUCT_SERVER_FLAGS } from './product-profile.mjs';

const DEFAULT_PORT = 3099;
const DEFAULT_DATABASE_URL = 'postgres://mistboard:mistboard@localhost:5435/mistboard';
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

const options = parseArgs(process.argv.slice(2));
const port = options.port ?? DEFAULT_PORT;
const baseUrl = localBaseUrl(options.baseUrl ?? `http://127.0.0.1:${port}`);
if (new URL(baseUrl).port !== String(port)) {
  throw new Error('--base must use --port; use smoke:local -- --base for an existing pair');
}
const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
const revision = options.revision ?? (await gitRevision()) ?? 'local';
const buildAt = new Date().toISOString();

let server = null;
let stoppingServer = false;

try {
  if (!options.skipBuild) await run('npm', ['run', 'build']);
  await run('npm', ['run', 'db:up']);
  await run('npm', ['run', 'migrate', '--workspace', '@mistboard/server'], {
    env: { DATABASE_URL: databaseUrl },
  });

  // Own the actual server process so cleanup cannot leave an npm grandchild listening.
  server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      MISTBOARD_REVISION: revision,
      MISTBOARD_BUILD_AT: buildAt,
      MISTBOARD_HOST: baseUrl,
      ...Object.fromEntries(PRODUCT_SERVER_FLAGS.map((flag) => [flag, 'true'])),
    },
  });

  server.on('exit', (code, signal) => {
    if (stoppingServer) return;
    if (code !== null && code !== 0) {
      console.error(`local server exited early with code ${code}`);
    } else if (signal) {
      console.error(`local server exited early from ${signal}`);
    }
  });

  await waitForHealth(baseUrl, 30_000);
  await runLocalSmokes(baseUrl, { revision });

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl,
      revision,
      checks: [
        options.skipBuild ? 'existing-build' : 'build',
        'db:up',
        'db:migrate',
        'local-smokes',
      ],
    }),
  );
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    stoppingServer = true;
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 5_000);
    await once(server, 'exit').catch(() => undefined);
    clearTimeout(timeout);
  }
}

async function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  const [code, signal] = await once(child, 'exit');
  if (signal) throw new Error(`${command} ${args.join(' ')} exited from ${signal}`);
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with code ${code}`);
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('local server exited before becoming healthy (is the port occupied?)');
    }
    try {
      const response = await fetch(new URL('/health', baseUrl), {
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 200 && body?.ok === true) {
        const status = await fetch(new URL('/api/server-status', baseUrl), {
          signal: AbortSignal.timeout(2_000),
        });
        const state = await status.json();
        // A listener from another session must never pass this gate for our build.
        if (status.ok && isLocalBuild(state, revision, buildAt)) return;
        lastError = new Error('local server revision/build timestamp does not match this run');
      } else {
        lastError = new Error(`/health returned ${response.status}`);
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`local server did not become healthy: ${lastError?.message ?? 'timed out'}`);
}

function gitRevision() {
  const child = spawn('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(code === 0 ? output.trim() : null);
    });
  });
}

function parseArgs(args) {
  const result = {
    baseUrl: null,
    databaseUrl: null,
    port: null,
    revision: null,
    skipBuild: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base') {
      result.baseUrl = requiredValue(args, ++index, '--base');
    } else if (arg === '--database-url') {
      result.databaseUrl = requiredValue(args, ++index, '--database-url');
    } else if (arg === '--port') {
      result.port = parsePositiveInteger(requiredValue(args, ++index, '--port'), '--port');
    } else if (arg === '--revision') {
      result.revision = requiredValue(args, ++index, '--revision');
    } else if (arg === '--skip-build') {
      result.skipBuild = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return result;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run release:local-smoke -- [options]

Options:
  --port <port>             Local server port, default ${DEFAULT_PORT}
  --base <url>              Base URL to smoke, default ${DEFAULT_BASE_URL}
  --database-url <url>      Postgres URL, default ${DEFAULT_DATABASE_URL}
  --revision <sha>          Revision exposed through /api/server-status
  --skip-build              Reuse the build just checked by the release gate

Runs all local production smokes, including every ceval backend, before stopping
its server. Requires Postgres, local variant engine binaries and browser assets.
For an already-running production-shaped pair, use npm run smoke:local -- --base <url>.
`);
}
