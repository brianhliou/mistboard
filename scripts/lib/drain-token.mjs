import { spawnSync } from 'node:child_process';

// Where the drain token lives when it isn't in the environment. A release that
// has to interrupt live games needs the token, and typing it into a shell (or
// pasting it into an agent session) puts a production secret somewhere it can
// be logged, scrolled back, or captured in a transcript. The macOS Keychain
// keeps it out of the tree, out of shell history, and out of any log: this
// module reads it at invocation time and hands it straight to the request.
//
// Same shape as the `railway()` wrapper injected by the Claude Code shell
// snapshot, which supplies RAILWAY_API_TOKEN at call time rather than
// exporting it into the shell.
//
// Store it once (the -w flag prompts, so the value never lands in history):
//   security add-generic-password -a "$USER" -s mistboard-drain-token -U -w
// Rotate it by re-running that same command; -U updates in place.
export const DRAIN_TOKEN_KEYCHAIN_SERVICE = 'mistboard-drain-token';

// The SECOND name this same secret can legitimately be stored under. Every
// Railway secret pushed by scripts/railway-secret.mjs lives at
// `mistboard/<VAR>`, so a drain token put there by that tool is correctly
// stored and was, until 2026-09-09, invisible here: this module searched one
// name, reported "no token", and that is indistinguishable from never having
// stored one. Accept both rather than ask anyone to keep two copies of one
// secret in sync.
export const DRAIN_TOKEN_KEYCHAIN_FALLBACK = 'mistboard/MISTBOARD_DRAIN_TOKEN';

const KEYCHAIN_ITEMS = [DRAIN_TOKEN_KEYCHAIN_SERVICE, DRAIN_TOKEN_KEYCHAIN_FALLBACK];

/**
 * The drain token, or null when no source has one.
 *
 * NEVER log, print, or echo the return value. Callers pass it to an
 * Authorization header or hand it to a child process through env, never argv
 * (argv is visible in `ps`).
 */
export function resolveDrainToken() {
  const fromEnv = process.env.MISTBOARD_DRAIN_TOKEN;
  if (fromEnv) return fromEnv;
  return searchKeychain().token;
}

/** Which source answered, for messages that must not name the value itself. */
export function drainTokenSource() {
  if (process.env.MISTBOARD_DRAIN_TOKEN) return 'env';
  return searchKeychain().token === null ? null : 'keychain';
}

/**
 * Why the lookup came back the way it did, WITHOUT the value.
 *
 * "Absent", "stored but empty", and "macOS refused the read" used to collapse
 * into one null, so all three printed "neither MISTBOARD_DRAIN_TOKEN nor the
 * keychain has one" and sent the reader to the Railway dashboard to work out
 * which. Two of the three are fixed locally in one command; only the first
 * needs the dashboard at all.
 *
 * @returns {{ok: boolean, source: string|null, item: string|null, status: string, detail: string}}
 */
export function describeDrainToken() {
  if (process.env.MISTBOARD_DRAIN_TOKEN) {
    return {
      ok: true,
      source: 'env',
      item: null,
      status: 'ok',
      detail: 'MISTBOARD_DRAIN_TOKEN is set in this environment.',
    };
  }
  const found = searchKeychain();
  if (found.token !== null) {
    return {
      ok: true,
      source: 'keychain',
      item: found.item,
      status: 'ok',
      detail: `Read from Keychain item "${found.item}".`,
    };
  }
  return { ok: false, source: null, item: null, ...summarize(found.attempts) };
}

// Try each known item name in order. The first that yields a non-empty value
// wins; otherwise keep what each one said so the caller can tell absence from
// refusal.
function searchKeychain() {
  const attempts = [];
  for (const item of KEYCHAIN_ITEMS) {
    const attempt = readKeychainItem(item);
    attempts.push(attempt);
    if (attempt.status === 'ok') return { token: attempt.token, item, attempts };
  }
  return { token: null, item: null, attempts };
}

function readKeychainItem(item) {
  const res = spawnSync('security', ['find-generic-password', '-w', '-s', item], {
    encoding: 'utf8',
  });

  // No `security` binary at all: not macOS, or a stripped image. Not something
  // the caller can fix by storing a credential.
  if (res.error) return { item, status: 'unavailable', code: null };

  if (res.status === 0) {
    // stdout is the value. It is trimmed and handed back to resolveDrainToken
    // here and nowhere else: it never becomes part of a status, a detail
    // string, or a log line.
    const token = (res.stdout ?? '').trim();
    if (!token) return { item, status: 'empty', code: 0 };
    return { item, status: 'ok', code: 0, token };
  }

  return { item, status: classify(res.stderr ?? ''), code: res.status };
}

// `security` reports failures as human text on stderr. Classify the cases that
// have DIFFERENT remedies; anything else stays 'unknown' and carries only an
// exit code. Deliberately no raw-stderr passthrough: that text has never
// contained the value, but a guarantee that it cannot is worth more than the
// extra detail.
function classify(stderr) {
  const text = String(stderr);
  if (/could not be found/i.test(text)) return 'absent';
  if (/User interaction is not allowed/i.test(text)) return 'denied';
  if (/user name or passphrase|authorization|denied|not authorized/i.test(text)) return 'denied';
  if (/cancell?ed/i.test(text)) return 'cancelled';
  if (/locked/i.test(text)) return 'locked';
  return 'unknown';
}

// One verdict from the per-item attempts, picking the most actionable. An item
// that exists but could not be read outranks one that is simply missing: the
// user has something concrete to fix, and "absent" would send them off to
// re-create a credential they already have.
function summarize(attempts) {
  const rank = ['denied', 'locked', 'cancelled', 'empty', 'unknown', 'unavailable', 'absent'];
  const worst = rank.find((status) => attempts.some((a) => a.status === status)) ?? 'absent';
  const hit = attempts.find((a) => a.status === worst) ?? attempts[0];
  const names = KEYCHAIN_ITEMS.map((n) => `"${n}"`).join(' or ');
  const addCommand = `security add-generic-password -a "$USER" -s ${DRAIN_TOKEN_KEYCHAIN_SERVICE} -U -w`;

  switch (worst) {
    case 'denied':
    case 'locked':
    case 'cancelled':
      return {
        status: worst,
        detail:
          `Keychain item "${hit.item}" EXISTS but macOS refused to read it (${worst}). The ` +
          'token is stored; this process just cannot get at it. Run the release from a ' +
          'terminal you own, or answer the access prompt with "Always Allow". Re-adding the ' +
          `item from your own terminal also clears a remembered Deny: ${addCommand}`,
      };
    case 'empty':
      return {
        status: 'empty',
        detail:
          `Keychain item "${hit.item}" exists but holds an empty value, which reads the same ` +
          `as no token at all. Re-add it: ${addCommand}`,
      };
    case 'unavailable':
      return {
        status: 'unavailable',
        detail:
          'No macOS `security` binary, so there is no Keychain to read. Pass the token for a ' +
          'single run instead: MISTBOARD_DRAIN_TOKEN=… npm run release:prod -- --push',
      };
    case 'unknown':
      return {
        status: 'unknown',
        detail:
          `Keychain lookup for ${names} failed with exit code ${hit.code}, which this script ` +
          'does not recognize. Run it by hand to see what macOS says (prints metadata, never ' +
          `the value): security find-generic-password -s ${DRAIN_TOKEN_KEYCHAIN_SERVICE}`,
      };
    default:
      return {
        status: 'absent',
        detail:
          `No Keychain item named ${names}, and MISTBOARD_DRAIN_TOKEN is unset. Copy the value ` +
          'from the Railway `web` service dashboard, then store it once (-w prompts, so it ' +
          `stays out of shell history): ${addCommand}`,
      };
  }
}
