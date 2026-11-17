import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  createEngineBootCheckReader,
  isLocalBuild,
  localBaseUrl,
  runLocalSmokes,
} from './local-prod-smoke.mjs';
import { createSmokeDatabase, LOCAL_SMOKE_POSTGRES_URL } from './local-smoke-database.mjs';
import { startSmokeEngine } from './local-smoke-engine.mjs';
import { PRODUCT_SERVER_FLAGS } from './product-profile.mjs';

const DEFAULT_PORT = 3099;
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

const options = parseArgs(process.argv.slice(2));
const port = options.port ?? DEFAULT_PORT;
const baseUrl = localBaseUrl(options.baseUrl ?? `http://127.0.0.1:${port}`);
if (new URL(baseUrl).port !== String(port)) {
  throw new Error('--base must use --port; the managed gate always starts its own server');
}
const revision = options.revision ?? (await gitRevision()) ?? 'local';
const buildAt = new Date().toISOString();

let server = null;
let stoppingServer = false;
let database = null;
let engine = null;
const engineBootCheck = createEngineBootCheckReader();
const cancellation = new AbortController();
const onInterrupt = () => cancellation.abort(new Error('local smoke interrupted'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onInterrupt);

try {
  if (!options.skipBuild) {
    await run('npm', ['run', 'build'], {
      env: {
        ...Object.fromEntries(
          PRODUCT_SERVER_FLAGS.map((flag) => [flag.replace(/^MISTBOARD_/, 'VITE_'), 'true']),
        ),
        // A local smoke build verifies maps without publishing them.
        POSTHOG_CLI_API_KEY: 'mistboard-offline-sourcemap-build',
      },
    });
  }
  await run('npm', ['run', 'db:up'], { env: { DATABASE_URL: LOCAL_SMOKE_POSTGRES_URL } });
  database = await createSmokeDatabase();
  console.log(`local smoke database: ${database.name} (disposable)`);
  const databaseUrl = database.databaseUrl;
  await run('npm', ['run', 'migrate', '--workspace', '@mistboard/server'], {
    env: { DATABASE_URL: databaseUrl },
  });
  // Invoke the workspace seed directly: the root alias pins the shared dev DB.
  await run('npm', ['run', 'seed:variant-fixtures', '--workspace', '@mistboard/server'], {
    env: { DATABASE_URL: databaseUrl },
  });
  engine = await startSmokeEngine();

  // Own the actual server process so cleanup cannot leave an npm grandchild listening.
  server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      // The boot-check reader needs the structured info-level summary even
      // when the operator's shell suppresses informational logging.
      LOG_LEVEL: 'info',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      MISTBOARD_REQUIRE_DATABASE: 'true',
      MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE: 'false',
      MISTBOARD_REVISION: revision,
      MISTBOARD_BUILD_AT: buildAt,
      MISTBOARD_HOST: baseUrl,
      MISTBOARD_BIND_HOST: '127.0.0.1',
      MISTBOARD_EXTRA_PLAYABLE_ENGINES: 'builtin-random-legal',
      ...engine.env,
      ...Object.fromEntries(PRODUCT_SERVER_FLAGS.map((flag) => [flag, 'true'])),
    },
  });
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    engineBootCheck.write(chunk);
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
  const { checked, missing } = engineBootCheck.result();
  console.log(
    `local engine boot check: ${missing.length}/${checked} binaries missing${missing.length ? `: ${missing.map(({ binary }) => binary).join(', ')}` : ''}`,
  );
  await runLocalSmokes(baseUrl, {
    revision,
    missingEngines: [...missing, ...engine.missing],
    signal: cancellation.signal,
  });

  console.log(
    JSON.stringify({
      ok: true,
      baseUrl,
      revision,
      checks: [
        options.skipBuild ? 'existing-build' : 'build',
        'db:up',
        'db:migrate',
        'seed:variant-fixtures',
        'local-smokes',
      ],
    }),
  );
} finally {
  try {
    if (server && server.exitCode === null && server.signalCode === null) {
      stoppingServer = true;
      server.kill('SIGTERM');
      const timeout = setTimeout(() => server.kill('SIGKILL'), 5_000);
      await once(server, 'exit').catch(() => undefined);
      clearTimeout(timeout);
    }
  } finally {
    try {
      await engine?.dispose();
    } finally {
      try {
        await database?.dispose();
      } finally {
        for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onInterrupt);
      }
    }
  }
}

async function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const child = spawn(command, args, {
    stdio: 'inherit',
    signal: cancellation.signal,
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
    cancellation.signal.throwIfAborted();
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
        if (status.ok && isLocalBuild(state, revision, buildAt)) {
          if (engineBootCheck.result()) return;
          lastError = new Error('waiting for local server engine boot check summary');
        } else {
          lastError = new Error('local server revision/build timestamp does not match this run');
        }
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
    port: null,
    revision: null,
    skipBuild: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base') {
      result.baseUrl = requiredValue(args, ++index, '--base');
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
  --revision <sha>          Revision exposed through /api/server-status
  --skip-build              Reuse a build with the product's browser flags enabled

Runs local production smokes, including every ceval backend, on a freshly seeded
disposable database on localhost:5435, then stops its server and drops that DB.
Ignores inherited DATABASE_URL. Requires Postgres and browser assets. The engine boot check
skips only probes needing a missing native binary, naming its path env var.
Available-engine probes and unrelated checks still gate the release.
To print the probe plan: node scripts/local-prod-smoke.mjs --base <url> --plan.
`);
}
