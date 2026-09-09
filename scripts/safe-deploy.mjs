#!/usr/bin/env node
// Drain → poll until active games hit zero → optionally announce restart now.
//
// The production release command invokes this helper immediately before its
// push triggers Railway auto-deploy. A direct invocation only drains; it does
// not deploy.
//
// Usage:
//   node scripts/safe-deploy.mjs [options]
//
// The drain token comes from MISTBOARD_DRAIN_TOKEN, or from the macOS keychain
// when that is unset (see scripts/lib/drain-token.mjs). Keychain storage is
// what lets a release drain unattended without the token passing through a
// shell, a log, or an agent transcript.
//
// Options:
//   --base-url <url>      target server (default: https://mistboard.com)
//   --window-ms <ms>      drain window length (default: 900_000 = 15min)
//   --poll-ms <ms>        poll interval (default: 30_000 = 30s)
//   --yes                 skip interactive confirmation
//   --commit              broadcast "Server restarting now" after reaching zero
//   --cancel              cancel an active drain
//   --owner <id>          claim the drain for this release run. A cancel that
//                         names an owner only cancels a drain with the same
//                         one, so a release cleaning up after its own failure
//                         cannot cancel a CONCURRENT release's drain and let it
//                         deploy into live games. Omit it and a cancel takes
//                         any drain, which is what a human at a terminal wants.
//
// Exit codes:
//   0   drain complete, ready to deploy
//   1   configuration error (missing token, bad arg)
//   2   server unreachable / probe failed
//   3   drain endpoint failed
//   4   window elapsed with games still active (drain is cancelled)
//   130 SIGINT — drain was cancelled

import {
  DRAIN_TOKEN_KEYCHAIN_FALLBACK,
  DRAIN_TOKEN_KEYCHAIN_SERVICE,
  describeDrainToken,
  resolveDrainToken,
} from './lib/drain-token.mjs';

const DEFAULT_BASE_URL = 'https://mistboard.com';
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 30 * 1000;

const options = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(
  options.baseUrl ?? process.env.MISTBOARD_BASE_URL ?? DEFAULT_BASE_URL,
);
const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
const token = resolveDrainToken();

if (!token) {
  // Say WHICH failure. "Never stored", "stored empty", and "macOS refused the
  // read" have nothing in common as remedies, and printing one generic line
  // for all three is what made this undiagnosable on 2026-09-09.
  const why = describeDrainToken();
  console.error(`error: drain token not usable (${why.status}).`);
  console.error(`  ${why.detail}`);
  console.error('  - Or for a single run: MISTBOARD_DRAIN_TOKEN=… node scripts/safe-deploy.mjs');
  console.error('  - Check this at any time: npm run drain:token-status');
  process.exit(1);
}

// Cancel drain on Ctrl-C so the server isn't left rejecting matchmaking.
let drainActive = false;
process.on('SIGINT', async () => {
  console.error('\nsignal received: cancelling drain and exiting');
  if (drainActive) {
    try {
      await cancelDrain();
    } catch (err) {
      console.error(`cancel failed: ${err.message}`);
    }
  }
  process.exit(130);
});

try {
  if (options.cancel) {
    await cancelDrain();
    console.log('drain cancelled');
  } else {
    await safeDeployFlow();
  }
} catch (err) {
  console.error(`safe-deploy failed: ${err.message}`);
  if (drainActive) {
    try {
      await cancelDrain();
      console.error('drain cancelled');
    } catch (e) {
      console.error(`drain still active. Cancel manually: ${e.message}`);
    }
  }
  process.exit(err.exitCode ?? 1);
}

async function safeDeployFlow() {
  console.log(
    `safe-deploy: target=${baseUrl.href} window=${humanMs(windowMs)} poll=${humanMs(pollMs)}`,
  );

  // 1. Health probe.
  const health = await fetchJson(new URL('/health', baseUrl), {});
  if (health.status !== 200) {
    throw withExit(2, `/health returned ${health.status}`);
  }

  // 2. Baseline active count.
  const before = await fetchJson(new URL('/api/server-status', baseUrl), {});
  if (before.status !== 200) throw withExit(2, `/api/server-status returned ${before.status}`);
  console.log(`active games before drain: ${before.body.activeGames}`);

  if (before.body.restartAt && before.body.restartAt > Date.now()) {
    console.log(
      `drain already active (restartAt=${new Date(before.body.restartAt).toISOString()}). Reusing existing window.`,
    );
  } else {
    if (!options.yes) {
      console.log('\nAbout to begin drain. New games will be blocked while active games finish.');
      console.log('Press Enter to continue, Ctrl-C to abort.');
      await readEnter();
    }
    await startDrain();
  }
  drainActive = true;

  // 3. Poll until zero or window elapsed.
  const deadline = Date.now() + windowMs;
  let remainingActive = before.body.activeGames;
  while (remainingActive > 0 && Date.now() < deadline) {
    await sleep(pollMs);
    const tick = await fetchJson(new URL('/api/server-status', baseUrl), {});
    if (tick.status !== 200) {
      console.error(`poll: status ${tick.status}. Retrying next tick.`);
      continue;
    }
    remainingActive = tick.body.activeGames;
    const remainingMs = Math.max(0, deadline - Date.now());
    console.log(`active=${remainingActive} window-remaining=${humanMs(remainingMs)}`);
  }

  // 4. Decide outcome.
  if (remainingActive === 0) {
    if (options.commit) await commitRestart();
    console.log(
      JSON.stringify({ ok: true, activeGames: 0, restartCommitted: options.commit === true }),
    );
    console.log(
      options.commit
        ? '\nDrain complete. Restart announced; trigger deployment now.'
        : '\nDrain complete. Ready for the production release command.',
    );
    return;
  } else {
    throw withExit(
      4,
      `window elapsed with ${remainingActive} active game${remainingActive === 1 ? '' : 's'}; deployment blocked`,
    );
  }
}

async function startDrain() {
  const res = await fetchJson(new URL('/admin/drain', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ windowMs, ...(options.owner ? { owner: options.owner } : {}) }),
  });
  if (res.status !== 200) {
    throw withExit(3, `/admin/drain returned ${res.status}: ${JSON.stringify(res.body)}`);
  }
  console.log(
    `drain started. restartAt=${new Date(res.body.restartAt ?? Date.now() + windowMs).toISOString()}`,
  );
}

async function commitRestart() {
  const res = await fetchJson(new URL('/admin/drain', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ phase: 'restarting' }),
  });
  if (res.status !== 200) {
    throw withExit(
      3,
      `/admin/drain restart commit returned ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }
  if (res.body?.phase === 'restarting') {
    console.log('restart-now notification broadcast');
  } else {
    console.log(
      'restart-now notification unavailable on the current server; bootstrap release continuing',
    );
  }
}

async function cancelDrain() {
  const res = await fetchJson(new URL('/admin/drain/cancel', baseUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(options.owner ? { owner: options.owner } : {}),
  });
  if (res.status === 409 && res.body?.error === 'drain_owned_by_another') {
    // Someone else's release is mid-drain. Leaving it alone is the whole point:
    // it is waiting for active games to finish before its own deploy.
    console.error(
      `drain belongs to ${res.body.owner ?? 'another release'}; leaving it active. ` +
        'Cancel it by hand only if you know that release is dead.',
    );
    drainActive = false;
    return;
  }
  if (res.status !== 200) {
    throw new Error(`/admin/drain/cancel returned ${res.status}: ${JSON.stringify(res.body)}`);
  }
  drainActive = false;
}

function withExit(code, message) {
  const err = new Error(message);
  err.exitCode = code;
  return err;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

function humanMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function normalizeBaseUrl(value) {
  const url = new URL(value.endsWith('/') ? value : `${value}/`);
  return url;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base-url') out.baseUrl = argv[++i];
    else if (arg === '--window-ms') out.windowMs = Number(argv[++i]);
    else if (arg === '--poll-ms') out.pollMs = Number(argv[++i]);
    else if (arg === '--yes') out.yes = true;
    else if (arg === '--commit') out.commit = true;
    else if (arg === '--cancel') out.cancel = true;
    else if (arg === '--owner') out.owner = argv[++i];
    else if (arg === '--force') {
      console.error('error: --force was removed. Use --yes only to skip confirmation.');
      process.exit(1);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: safe-deploy.mjs [--base-url URL] [--window-ms MS] [--poll-ms MS] [--yes] [--commit] [--cancel] [--owner ID]',
      );
      console.log(
        `Drain token: MISTBOARD_DRAIN_TOKEN, else keychain item "${DRAIN_TOKEN_KEYCHAIN_SERVICE}" ` +
          `or "${DRAIN_TOKEN_KEYCHAIN_FALLBACK}".`,
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${arg}`);
      process.exit(1);
    }
  }
  return out;
}
