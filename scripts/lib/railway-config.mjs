// Where each Railway service's deploy settings live (#980).
//
// `.railway/railway.ts` (Infrastructure as Code) reads the plain JSON files in
// RAILWAY_SERVICE_CONFIGS, and so does every script here, so nothing needs a
// TypeScript loader. Each file has the Config as Code shape the scripts already
// read: `build.watchPatterns`, `deploy.*`.
//
// LEGACY_RAILWAY_CONFIGS are the Config as Code files Railway still reads until
// the cutover. They stay in the repo with identical values until then
// (railway-config-sync.test.mjs fails when the two disagree), and can be
// deleted after it; every reader below keeps working without them.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const RAILWAY_SERVICE_CONFIGS = Object.freeze({
  web: '.railway/web.json',
  'engine-worker': '.railway/engine-worker.json',
});

export const LEGACY_RAILWAY_CONFIGS = Object.freeze({
  web: 'railway.web.json',
  'engine-worker': 'railway.engine-worker.json',
});

// Root railway.json is read by no service (each sets a custom config path); it
// carries watch patterns only and goes away with the other legacy files.
export const LEGACY_ROOT_RAILWAY_CONFIG = 'railway.json';

export function readRailwayServiceConfig(repoRoot, service) {
  const file = RAILWAY_SERVICE_CONFIGS[service];
  if (!file) throw new Error(`Unknown Railway service: ${service}`);
  return JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8'));
}

/**
 * Every Railway config file in the tree that carries watch patterns: the IaC
 * data files always, and each legacy file while it still exists. Checks that
 * every service watches some path iterate this, so a legacy file cannot drift
 * while Railway still reads it.
 */
export function railwayWatchConfigFiles(repoRoot) {
  const legacy = [...Object.values(LEGACY_RAILWAY_CONFIGS), LEGACY_ROOT_RAILWAY_CONFIG].filter(
    (file) => existsSync(resolve(repoRoot, file)),
  );
  return [...Object.values(RAILWAY_SERVICE_CONFIGS), ...legacy];
}

/**
 * A service's config as committed at `revision`, read through `show`
 * (`git show <revision>:<path>`). A revision from before the IaC files existed
 * falls back to the legacy file, so a baseline older than #980 still compares.
 */
export function readRailwayServiceConfigAt(revision, service, show) {
  const file = RAILWAY_SERVICE_CONFIGS[service];
  const legacy = LEGACY_RAILWAY_CONFIGS[service];
  if (!file || !legacy) throw new Error(`Unknown Railway service: ${service}`);
  let text;
  try {
    text = show(`${revision}:${file}`);
  } catch {
    text = show(`${revision}:${legacy}`);
  }
  return JSON.parse(text);
}
