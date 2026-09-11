#!/usr/bin/env node
// drain-token-status.mjs — can this shell read the drain token, and if not, why?
//
// The drain token is only ever exercised by a release that finds live games,
// so a broken lookup stays invisible until the one moment it blocks a deploy.
// This asks the same question release-prod.mjs asks, at any time, and never
// touches the value: it prints a source and a status, never the token.
//
// Usage:
//   npm run drain:token-status
//   node scripts/drain-token-status.mjs [--json]
//
// Exit codes:
//   0   a token is readable (source printed)
//   1   no token, or macOS refused the read (the reason names the remedy)

import { describeDrainToken } from './lib/drain-token.mjs';

const asJson = process.argv.includes('--json');
const result = describeDrainToken();

if (asJson) {
  // Shape mirrors describeDrainToken exactly; it has no field that can hold
  // the value, which is why this is safe to pipe anywhere.
  console.log(JSON.stringify(result));
} else if (result.ok) {
  console.log(
    `drain token: readable (source: ${result.source}${result.item ? `, item "${result.item}"` : ''})`,
  );
  console.log('A release that hits live games will be able to drain.');
} else {
  console.error(`drain token: NOT readable (${result.status})`);
  console.error(result.detail);
}

process.exit(result.ok ? 0 : 1);
