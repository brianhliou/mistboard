#!/usr/bin/env node
// Human-run, interactive macOS setup. Agents/CI may inspect --help and run the
// mocked tests; only the human operator invokes credential storage.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROVIDER_TOKEN_KEYCHAIN_SERVICE = 'mistboard/MISTBOARD_BANQI_PROVIDER_TOKEN';

export function storeNewProviderToken({
  interactive = process.stdin.isTTY === true && process.stdout.isTTY === true,
  platform = process.platform,
  account = process.env.USER,
  generate = () => randomBytes(32).toString('base64url'),
  run = spawnSync,
} = {}) {
  if (!interactive || platform !== 'darwin') {
    throw new Error('Run this command yourself in an interactive macOS terminal.');
  }
  if (typeof account !== 'string' || !/^[a-zA-Z0-9_.-]{1,64}$/.test(account)) {
    throw new Error('A valid macOS account name is required.');
  }
  const token = generate();
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) {
    throw new Error('Credential generation failed.');
  }
  // No -U: an existing credential is preserved. Capture every diagnostic because
  // a failed command can include arguments; never print those diagnostics.
  let result;
  try {
    result = run(
      '/usr/bin/security',
      ['add-generic-password', '-a', account, '-s', PROVIDER_TOKEN_KEYCHAIN_SERVICE, '-w', token],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    throw new Error('Keychain storage failed; command diagnostics were withheld.');
  }
  if (result.error || result.status !== 0) {
    throw new Error(
      'Could not add the Keychain item. Any existing credential was left unchanged; command diagnostics were withheld.',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(
      'Run in your own macOS terminal: node scripts/banqi-provider-store-token.mjs\nCreates a random 256-bit credential in Keychain for the private Banqi provider.\nIt preserves existing items and displays no credential value. No Railway changes are made.',
    );
  } else if (args.length > 0) {
    console.error('Usage: node scripts/banqi-provider-store-token.mjs');
    process.exitCode = 1;
  } else {
    try {
      storeNewProviderToken();
      console.log(
        'Stored the private Banqi provider credential in Keychain. No Railway changes were made.',
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
