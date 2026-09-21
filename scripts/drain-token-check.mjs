#!/usr/bin/env node
// drain-token-check.mjs — is the drain token this laptop would send the one
// prod compares against?
//
// `drain:token-status` answers "can this shell READ a token". It cannot say
// whether that token is the right one, and on 2026-09-13 and 2026-09-20 a
// readable token got 401 from /admin/drain and blocked a release until the
// pool went idle. Readability had been checked; equality never had, because
// checking it means holding both values, and neither may be printed.
//
// This compares fingerprints instead (12 hex digits of SHA-256 plus byte
// length): every local source in the order a release consults them, against
// the value in the prod web container, read over `railway ssh`. No value is
// ever printed, and the verdict names which copy to fix.
//
// Usage (from a directory linked to the prod project; run it in your own
// terminal, the agent classifier refuses `railway ssh`):
//   npm run drain:token-check
//   node scripts/drain-token-check.mjs [--json]
//
// Exit codes:
//   0   match
//   1   anything else (the verdict says what to do)

import { spawnSync } from 'node:child_process';
import {
  compareDrainTokenFingerprints,
  DRAIN_TOKEN_KEYCHAIN_FALLBACK,
  DRAIN_TOKEN_KEYCHAIN_SERVICE,
  listDrainTokenFingerprints,
  PROD_FINGERPRINT_COMMAND,
  parseProdFingerprint,
} from './lib/drain-token.mjs';

// The prod web service, by id: `railway ssh -p` wants the id, not the name.
const PROJECT_ID = 'edd519d3-638e-40da-81b4-a8a70eb7eb94';
const ENVIRONMENT_ID = '022f9331-37de-4e33-a2d6-ee90929f7ba1';
const WEB_SERVICE_ID = 'c758300b-aa05-4f93-998c-3ca874562009';

const asJson = process.argv.includes('--json');

const entries = listDrainTokenFingerprints();
const prodRun = spawnSync(
  'railway',
  [
    'ssh',
    '-p',
    PROJECT_ID,
    '-e',
    ENVIRONMENT_ID,
    '-s',
    WEB_SERVICE_ID,
    '--',
    'sh',
    '-c',
    PROD_FINGERPRINT_COMMAND,
  ],
  { env: railwayEnv(), encoding: 'utf8', timeout: 90_000 },
);
const prod = prodRun.status === 0 ? parseProdFingerprint(prodRun.stdout) : null;
const result = compareDrainTokenFingerprints(entries, prod);

if (asJson) {
  // Fingerprints only; no field can hold a value.
  console.log(JSON.stringify({ ...result, entries, prod }));
  process.exit(result.verdict === 'match' ? 0 : 1);
}

console.log('local sources, in the order a release tries them:');
for (const entry of entries) {
  const fp = entry.fingerprint ? `${entry.fingerprint.sha} len ${entry.fingerprint.length}` : '-';
  console.log(`  ${entry.item.padEnd(34)} ${entry.status.padEnd(12)} ${fp}`);
}
console.log(
  `prod web MISTBOARD_DRAIN_TOKEN:${' '.repeat(6)}${
    prod === null ? 'unreadable' : prod.unset ? 'UNSET' : `${prod.sha} len ${prod.length}`
  }`,
);
console.log('');

const store = `security add-generic-password -a "$USER" -s ${DRAIN_TOKEN_KEYCHAIN_SERVICE} -U -w`;
switch (result.verdict) {
  case 'match':
    console.log(`OK: a release sends "${result.active.item}", and prod holds the same value.`);
    break;
  case 'shadowed':
    console.log(
      `SHADOWED: prod's value is on this machine as "${result.matches[0].item}", but a release ` +
        `sends "${result.active.item}" first, which differs. Fix the earlier source: delete or ` +
        `update it so the matching copy wins.\n  security delete-generic-password -s ${result.active.item}`,
    );
    break;
  case 'mismatch':
    console.log(
      `MISMATCH: no local copy equals prod's. Either the laptop is stale (copy the value from ` +
        `the Railway dashboard, web service, and store it: ${store}) or prod is stale (push the ` +
        `laptop's copy: node scripts/railway-secret.mjs --service web --var MISTBOARD_DRAIN_TOKEN, ` +
        `which reads Keychain item "${DRAIN_TOKEN_KEYCHAIN_FALLBACK}"; Railway restarts web on the change).`,
    );
    break;
  case 'local-none':
    console.log(
      `NO LOCAL TOKEN: nothing readable here (see \`npm run drain:token-status\`). Store it: ${store}`,
    );
    break;
  case 'prod-unset':
    console.log(
      'PROD UNSET: the web service has no MISTBOARD_DRAIN_TOKEN, so every drain is 401 whatever ' +
        'the laptop holds. Push one: node scripts/railway-secret.mjs --service web --var ' +
        'MISTBOARD_DRAIN_TOKEN (Railway restarts web on the change).',
    );
    break;
  default:
    console.log(
      'PROD UNREADABLE: `railway ssh` did not answer in the expected shape. Run ' +
        '`command railway login` once in your terminal, then retry. stderr from railway:',
    );
    console.log(indent(prodRun.stderr || prodRun.error?.message || '(none)'));
}

process.exit(result.verdict === 'match' ? 0 : 1);

function railwayEnv() {
  // The Claude Code shell snapshot injects a stale RAILWAY_API_TOKEN through a
  // shell function; spawning the binary directly skips the function, and
  // dropping the variable keeps a copied env from shadowing the login.
  const env = { ...process.env };
  delete env.RAILWAY_API_TOKEN;
  return env;
}

function indent(text) {
  return String(text)
    .trim()
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}
