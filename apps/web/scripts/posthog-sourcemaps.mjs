import { execFileSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import posthog from '@posthog/rollup-plugin';

export const POSTHOG_PROJECT_ID = '413256';
export const POSTHOG_HOST = 'https://us.posthog.com';
// Recognised by the CLI wrapper: this non-secret value forces --dry-run.
export const OFFLINE_UPLOAD_KEY = 'mistboard-offline-sourcemap-build';

export async function removeSourceMaps(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await removeSourceMaps(path);
    else if (entry.name.endsWith('.map')) await rm(path);
  }
}

/** Build-only integration; never loads env files or bundles the upload key. */
export function posthogSourcemaps({
  command,
  env = process.env,
  cwd = process.cwd(),
  cliBinaryPath = fileURLToPath(
    new URL('../../../scripts/posthog-sourcemap-cli.mjs', import.meta.url),
  ),
} = {}) {
  if (command !== 'build') return [];
  const production =
    env.RAILWAY_ENVIRONMENT === 'production' || env.RAILWAY_ENVIRONMENT_NAME === 'production';
  const key = env.POSTHOG_CLI_API_KEY?.trim();
  if (production && (!key || key === OFFLINE_UPLOAD_KEY)) {
    throw new Error(
      'Production source-map upload requires POSTHOG_CLI_API_KEY on the Railway web service. Use a PostHog personal API key, not the public project key.',
    );
  }
  let version = env.RAILWAY_GIT_COMMIT_SHA;
  if (!version) {
    try {
      version = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      throw new Error('Source-map release requires a Git checkout or RAILWAY_GIT_COMMIT_SHA.');
    }
  }
  if (!/^[a-f0-9]{40}$/i.test(version)) {
    throw new Error('Source-map release must identify the exact 40-character Git revision.');
  }
  const plugin = posthog({
    projectId: POSTHOG_PROJECT_ID,
    host: POSTHOG_HOST,
    personalApiKey: key || OFFLINE_UPLOAD_KEY,
    cliBinaryPath,
    logLevel: 'error',
    sourcemaps: {
      enabled: true,
      releaseName: 'mistboard-web',
      releaseVersion: version,
      releaseMode: 'symbol-set',
      deleteAfterUpload: true,
    },
  });
  // Upstream retains maps on upload failure and only warns on deletion failure.
  // Here neither path may leave maps in deployable dist, including CSS maps.
  const upload = plugin.writeBundle.handler;
  plugin.writeBundle = {
    ...plugin.writeBundle,
    async handler(options, bundle) {
      const directory = resolve(cwd, options.dir);
      try {
        await upload.call(this, options, bundle);
      } finally {
        await removeSourceMaps(directory);
      }
    },
  };
  return [plugin];
}
