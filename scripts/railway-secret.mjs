#!/usr/bin/env node
// Set Railway variables, including secret ones, without a value ever entering
// an agent transcript.
//
// WHY THIS EXISTS
//
// CLAUDE.md forbids reading, printing, or logging secrets, and `railway
// variables` prints values — so the blanket rule is "never run it". The
// consequence was that an agent could not set a credential at all, and every
// key rotation, every new integration, and every launch flip waited on a human
// clicking through the Railway dashboard.
//
// The rule was never "secrets must not pass through a machine". It was "secrets
// must not land in the transcript", because a transcript cannot be un-written
// and the only remedy is rotation. So the fix is to keep the value inside a
// single process for its whole life:
//
//     macOS Keychain  ->  this process's memory  ->  railway CLI argv
//
// Nothing on that path writes to stdout. The CLI's own output is captured (not
// inherited), scrubbed of every value, and reduced to a status line.
//
// THE DIVISION OF LABOUR THAT MAKES THIS SAFE
//
// Storing a secret is the human's job and cannot be delegated: hidden input
// needs a TTY, which an agent's Bash tool does not have. Setting it afterwards
// is the agent's job and needs no TTY. So the human types each secret once, in
// their own terminal, and every later push of that value is automatable.
//
//   One-time store (human, own terminal):
//
//     read -rs SECRET && \
//       security add-generic-password -U -a "$USER" \
//         -s "mistboard/STRIPE_SECRET_KEY" -w "$SECRET"; unset SECRET
//
//   Then, agent-runnable:
//
//     npm run railway:secret -- --service web --var STRIPE_SECRET_KEY
//
// WHY EVERYTHING BATCHES INTO ONE CALL
//
// Railway restarts the service on a variable change, and a restart drops live
// game connections. Setting six variables as six calls is six restarts. Every
// --var and --set in one invocation is collapsed into a single
// `railway variables --set A=.. --set B=..`, so it costs one.
//
// KNOWN LIMITATION, STATED RATHER THAN PAPERED OVER
//
// Values are passed to the Railway CLI as argv elements, so they are briefly
// visible in `ps` to another process running as the same user on this machine.
// The Railway CLI has no stdin path for variable values, so this is not
// avoidable without a different transport. On a single-user laptop that is an
// acceptable trade against a human in the loop for every credential; on a
// shared host it would not be. Do not port this to CI.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  compareDrainTokenFingerprints,
  DRAIN_TOKEN_KEYCHAIN_SERVICE,
  fingerprintDrainToken,
  listDrainTokenFingerprints,
} from './lib/drain-token.mjs';

/** The prod Railway project. Matches deploy-engine-worker.mjs. */
const PROJECT_ID = 'edd519d3-638e-40da-81b4-a8a70eb7eb94';

const USAGE = `
Usage:
  node scripts/railway-secret.mjs --service <svc> [--var NAME]... [--set NAME=VALUE]...

At least one --var or --set is required. All of them are applied in a single
Railway call, so the service restarts once no matter how many you pass.
After a drain token write, compare the active release token with the value
just pushed; exit nonzero if a stale local source would still win.

Options:
  --service <svc>     Railway service to set variables on (required)
  --var <NAME>        Secret: value read from Keychain item mistboard/<NAME>
                      Repeatable.
  --set <NAME=VALUE>  Non-secret: value given inline (price ids, dev flags).
                      Repeatable.
  --account <acct>    Keychain account (default: $USER)
  --dry-run           Resolve every value and check the project link; write
                      nothing
  --fingerprint       Print a short one-way hash of each value

To store a secret in the Keychain first (do this in your OWN terminal — it
needs a TTY so the input stays hidden):

  read -rs SECRET && \\
    security add-generic-password -U -a "$USER" \\
      -s "mistboard/<NAME>" -w "$SECRET"; unset SECRET
`;

function fail(message) {
  // Never interpolate a value into this path. Callers pass literals only.
  console.error(`railway-secret: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { vars: [], sets: [], dryRun: false, fingerprint: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === '--service') opts.service = next();
    else if (arg === '--var') opts.vars.push(next());
    else if (arg === '--set') {
      const pair = next();
      const eq = pair.indexOf('=');
      if (eq <= 0) fail('--set expects NAME=VALUE');
      opts.sets.push({ name: pair.slice(0, eq), value: pair.slice(eq + 1) });
    } else if (arg === '--account') opts.account = next();
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--fingerprint') opts.fingerprint = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE.trim());
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  if (!opts.service) fail('--service is required');
  if (opts.vars.length === 0 && opts.sets.length === 0) {
    fail('at least one --var or --set is required');
  }
  opts.account ??= process.env.USER ?? '';

  const names = [...opts.vars, ...opts.sets.map((s) => s.name)];
  const dupe = names.find((n, i) => names.indexOf(n) !== i);
  if (dupe) fail(`${dupe} given twice; the last one would silently win`);
  return opts;
}

/**
 * Replace every occurrence of every secret in `text` with a mask.
 *
 * This is the last line of defence, not the first: the design already avoids
 * printing values. But CLI tools echo their input in error messages more often
 * than you would like ("invalid value: sk_live_..."), and that echo is exactly
 * the leak this whole script exists to prevent. Scrub unconditionally.
 *
 * Longest-first so a value that contains another value cannot leave a fragment.
 */
function scrub(text, secrets) {
  if (!text) return '';
  let out = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) out = out.split(secret).join('«redacted»');
  }
  return out;
}

/** A short one-way hash: enough to tell two values apart, useless for recovery. */
function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * Environment for the Railway CLI.
 *
 * A stale RAILWAY_API_TOKEN shadows the working browser login and every command
 * returns "Unauthorized". Drop it so the CLI falls back to the logged-in
 * session. Mirrors railwayEnv() in deploy-engine-worker.mjs — see the Railway
 * CLI auth note in CLAUDE.md for the full mechanism.
 */
function railwayEnv() {
  const env = { ...process.env };
  delete env.RAILWAY_API_TOKEN;
  return env;
}

/** Read a secret out of the login Keychain. The caller may not print it. */
function readKeychain(name, account) {
  const item = `mistboard/${name}`;
  const res = spawnSync('security', ['find-generic-password', '-a', account, '-s', item, '-w'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (res.error) fail(`could not run \`security\`: ${res.error.code ?? res.error.message}`);
  if (res.status !== 0) {
    console.error(`railway-secret: no Keychain item "${item}" for account "${account}".`);
    console.error('\nStore it first, in your own terminal (needs a TTY to hide input):\n');
    console.error('  read -rs SECRET && \\');
    console.error(`    security add-generic-password -U -a "${account}" \\`);
    console.error(`      -s "${item}" -w "$SECRET"; unset SECRET`);
    process.exit(1);
  }
  // `security -w` appends a trailing newline; a secret never legitimately ends
  // in one, and a stray newline in an API key produces a baffling 401 later.
  const value = res.stdout.replace(/\n$/, '');
  if (!value) fail(`Keychain item "${item}" is empty`);
  return value;
}

/**
 * Refuse to write from a directory that is not linked to prod.
 *
 * Without this, an unlinked directory is not an error to the CLI — and a
 * variable written to the wrong project is worse than a failed write, because
 * it looks like it worked. Matches on project ID, not name: a stray project is
 * named after the folder, and a folder can be named anything.
 */
function assertLinkedToProdProject() {
  const res = spawnSync('railway', ['status', '--json'], {
    encoding: 'utf8',
    env: railwayEnv(),
    timeout: 60_000,
  });
  if (`${res.stdout ?? ''}${res.stderr ?? ''}`.includes(PROJECT_ID)) return;

  console.error('railway-secret: this directory is not linked to the prod Railway project.');
  if (res.status !== 0) {
    console.error(`  \`railway status\` exited ${res.status}. If it says Unauthorized, run:`);
    console.error('    railway login');
    console.error('  (this script drops RAILWAY_API_TOKEN on purpose — see railwayEnv)');
  } else {
    console.error(`  Linked project does not contain ${PROJECT_ID}.`);
  }
  console.error('\n  Refusing rather than writing a variable to the wrong project.');
  process.exit(1);
}

function setVariables({ service, entries }) {
  const args = ['variables', '--service', service];
  for (const { name, value } of entries) args.push('--set', `${name}=${value}`);

  // spawnSync with an argv array and no shell: values are never parsed by a
  // shell, so they cannot land in shell history or be mangled by quoting.
  const res = spawnSync('railway', args, {
    encoding: 'utf8',
    env: railwayEnv(),
    timeout: 120_000,
  });
  if (res.error) fail(`could not run \`railway\`: ${res.error.code ?? res.error.message}`);

  // `railway variables` prints the full variable table on success — that table
  // contains every secret on the service. Capture it, never inherit it, and
  // discard it here. Only the exit status crosses this boundary.
  if (res.status !== 0) {
    const values = entries.map((e) => e.value);
    const stderr = scrub(res.stderr, values).trim();
    console.error(`railway-secret: railway exited ${res.status}`);
    if (stderr) console.error(stderr.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
}

function verifyDrainToken(entries) {
  const pushed = entries.find((entry) => entry.name === 'MISTBOARD_DRAIN_TOKEN');
  if (!pushed) return;

  // Compare against the value Railway just accepted. Checking the running
  // container now can race its restart and report the previous token instead.
  // The same lookup order as a release catches stale environment overrides,
  // unreadable canonical items, and legacy copies without printing a value.
  const result = compareDrainTokenFingerprints(listDrainTokenFingerprints(), {
    unset: false,
    ...fingerprintDrainToken(pushed.value),
  });
  if (result.verdict !== 'match') {
    fail(
      `drain token ${result.verdict.toUpperCase()}: Railway already set MISTBOARD_DRAIN_TOKEN, ` +
        `but the active release source "${result.active?.item ?? 'none'}" does not match the ` +
        `value pushed. Clear a stale MISTBOARD_DRAIN_TOKEN environment override or update ` +
        `Keychain item "${DRAIN_TOKEN_KEYCHAIN_SERVICE}". After the service restarts, run ` +
        '`npm run drain:token-check` to compare with the live container.',
    );
  }
  console.log(`ok: drain token from "${result.active.item}" matches the value just pushed.`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const entries = [
    ...opts.sets.map(({ name, value }) => ({ name, value, source: 'inline' })),
    ...opts.vars.map((name) => ({
      name,
      value: readKeychain(name, opts.account),
      source: 'keychain',
    })),
  ];
  for (const entry of entries) {
    // An empty value silently unsets on some CLIs and sets an empty string on
    // others. Neither is ever intended here — refuse both.
    if (!entry.value) fail(`refusing to set an empty value for ${entry.name}`);
  }

  for (const { name, value, source } of entries) {
    const fp = opts.fingerprint ? ` fingerprint ${fingerprint(value)}` : '';
    console.log(`  ${name} <- ${source}${fp}`);
  }

  assertLinkedToProdProject();

  if (opts.dryRun) {
    console.log(`ok: linked to prod; would set ${entries.length} variable(s) on "${opts.service}"`);
    return;
  }

  setVariables({ service: opts.service, entries });
  console.log(`ok: set ${entries.length} variable(s) on service "${opts.service}"`);
  verifyDrainToken(entries);
  console.log('     Railway restarts the service once for this change.');
  console.log('     Verify behaviourally — never by reading the values back.');
}

main();
