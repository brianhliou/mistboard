#!/usr/bin/env node
/**
 * Sign in from the terminal and write the session cookie the ops scripts read.
 *
 *   npm run auth:cookie -- --email you@example.com
 *
 * Exists to delete a step that was pure friction: every script that writes to a
 * study (study-name-i18n.mjs, world-title-study.mjs, study-tag-i18n.mjs,
 * seed-xiangqi-endgame-practice.ts) authenticates as the study's owner by reading
 * ~/.mistboard-cookie, and the only documented way to fill that file was to open
 * devtools, find the cookie, and paste it. That is a browser errand to renew a
 * credential the site is perfectly willing to issue over its own API.
 *
 * The flow is the site's own email login, unchanged: POST the address, read the
 * six-digit code out of your email, POST it back. The session it mints lasts
 * THIRTY DAYS (accountSessionTtlMs), so this is a monthly chore at worst, not a
 * per-run one.
 *
 * The cookie value is never printed. It goes from the response straight into the
 * file at mode 0600, and what reaches the terminal is the account and the expiry.
 *
 * Requires a TTY for the code prompt, which is deliberate and load-bearing: an
 * agent's shell has no TTY, so this stays a human step by construction. The same
 * reasoning as the Keychain rule for Railway secrets -- a human types the secret
 * once, and everything downstream of it is automatable.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const argOf = (flag, fallback = '') => {
  const at = args.indexOf(`--${flag}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const BASE = argOf('base', 'https://mistboard.com');
const EMAIL = argOf('email');
// Not defaulted to anyone's address: this file is committed, and an email
// address baked into a public repo is a permanent piece of spam bait.
const OUT = argOf('out', join(homedir(), '.mistboard-cookie'));

async function main() {
  if (!EMAIL) throw new Error('need --email <address>');
  if (!process.stdin.isTTY) {
    throw new Error(
      'this needs a terminal: it prompts for the code from your email. Run it yourself rather than through a tool.',
    );
  }

  const started = await fetch(`${BASE}/api/auth/email/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL }),
  });
  if (started.status === 429) {
    throw new Error('rate limited: a code was requested recently, wait and retry');
  }
  if (!started.ok) {
    throw new Error(`auth start failed: ${started.status} ${(await started.text()).slice(0, 160)}`);
  }
  const { loginId, expiresAt } = await started.json();
  if (!loginId) throw new Error('auth start returned no loginId');

  const codeExpiry = expiresAt ? new Date(expiresAt) : null;
  console.log(
    `code sent to ${EMAIL}${codeExpiry ? `, valid until ${codeExpiry.toLocaleTimeString()}` : ''}`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question('code: ')).trim();
  rl.close();
  if (!code) throw new Error('no code entered');

  const confirmed = await fetch(`${BASE}/api/auth/email/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, code }),
  });
  if (!confirmed.ok) {
    // The code is wrong, expired, or already used. Say which without echoing it.
    throw new Error(
      `auth confirm failed: ${confirmed.status} ${(await confirmed.text()).slice(0, 160)}`,
    );
  }

  const setCookie = confirmed.headers.get('set-cookie');
  if (!setCookie) throw new Error('confirm succeeded but returned no session cookie');
  // Just the name=value pair: the attributes (Path, HttpOnly, Domain) are for a
  // browser, and a script sends this as a request header.
  const cookie = setCookie.split(';')[0];

  writeFileSync(OUT, `${cookie}\n`, { mode: 0o600 });

  const who = await confirmed.json().catch(() => ({}));
  const handle = who?.user?.handle ?? who?.handle ?? '(unknown)';
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  console.log(`wrote ${OUT} (mode 600) as ${handle}`);
  console.log(`the session lasts about 30 days, so until ${expires.toDateString()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
