#!/usr/bin/env node
import { listParkedBranches, parkBranch, unparkBranch } from './lib/agent-branches.mjs';

const [action, branch, reason, ...extra] = process.argv.slice(2);
try {
  if (action === 'park' && branch && reason !== undefined && extra.length === 0) {
    console.log(`${branch}: parked ${parkBranch(branch, reason)}`);
  } else if (action === 'unpark' && branch && reason === undefined) {
    unparkBranch(branch);
    console.log(`${branch}: unparked`);
  } else if (action === 'parked' && branch === undefined) {
    const entries = listParkedBranches();
    for (const { branch: name, parked } of entries) {
      console.log(`${name}\t${parked.date}\t${parked.reason}`);
    }
    if (entries.length === 0) console.log('No parked agent branches');
  } else {
    throw new Error(
      'usage: npm run branch:park -- <branch> "<reason>" | npm run branch:unpark -- <branch> | npm run branch:parked',
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
