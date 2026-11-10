#!/usr/bin/env node
import path from 'node:path';
import { runBatchCi } from './lib/batch-ci.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(
    'Usage: npm run batch:ci -- <worktree>\nPush the clean batch HEAD to release/<sha> and wait for hosted ci.yml.',
  );
} else if (args.length !== 1 || args[0].startsWith('-')) {
  console.error('Usage: npm run batch:ci -- <worktree>');
  process.exitCode = 1;
} else {
  try {
    await runBatchCi({ root: path.resolve(args[0]) });
  } catch (error) {
    console.error(`batch:ci: ${error.message}`);
    process.exitCode = 1;
  }
}
