#!/usr/bin/env node
// The official plugin passes its key through env, never argv. Capture CLI
// output too, so a server/authentication error cannot echo it into build logs.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const cli = require.resolve('@posthog/cli/run-posthog-cli.js');
export function runSourceMapCli(
  args,
  { env: inputEnv = process.env, spawn = spawnSync, log = console.log, error = console.error } = {},
) {
  const env = { ...inputEnv };
  const offline = env.POSTHOG_CLI_API_KEY === 'mistboard-offline-sourcemap-build';
  delete env.POSTHOG_CLI_DOTENV_FILE;
  env.POSTHOG_CLI_DRY_RUN = offline ? 'true' : 'false';
  env.RUST_LOG = 'posthog_cli=error';
  const result = spawn(process.execPath, [cli, ...args], {
    env,
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (result.status !== 0) {
    // Only controlled status fields are printable; never stderr or env values.
    const http = /\b(?:401|403|429|500|502|503)\b/.exec(result.stderr ?? '')?.[0];
    error(`PostHog source-map upload failed${http ? ` (HTTP ${http})` : ''}.`);
    return result.status || 1;
  }
  log(
    offline
      ? 'PostHog source maps: offline build verified; no artifacts uploaded.'
      : 'PostHog source maps: private upload complete.',
  );
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = runSourceMapCli(process.argv.slice(2));
}
