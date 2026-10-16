#!/usr/bin/env node
// Award every achievement an account already qualifies for from its existing
// games, puzzle attempts and forum posts (persistence-achievements.ts; the
// definitions live in packages/game/src/achievements.ts). Leveling families
// (wins at 10 / 50 / 100 / 500) award every level the count has reached, each
// dated at the game that reached it, and print one line per level.
//
// Run it once when the ledger ships and again whenever a definition is added.
// It goes through the same facts and predicates as the live hooks, so it can
// only award what the live path would have. Idempotent: an award already in
// the ledger is left alone (INSERT ... ON CONFLICT DO NOTHING), its date
// included, and a second run reports nothing new.
//
//   npm run build --workspace @mistboard/server     # this reads dist/
//   DATABASE_URL=… node scripts/backfill-achievements.mjs            # dry run
//   DATABASE_URL=… node scripts/backfill-achievements.mjs --write    # writes
//
// The migration (166_user_achievements) must already be applied. Against
// production, hand the connection to Railway rather than your shell:
//
//   command railway run -s Postgres -- sh -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/backfill-achievements.mjs'

import { parseArgs } from 'node:util';
import { ACHIEVEMENT_AWARD_IDS } from '@mistboard/game';
import { evaluateAchievements } from '../apps/server/dist/persistence-achievements.js';
import { close, init } from '../apps/server/dist/persistence-db.js';

const { values } = parseArgs({
  options: {
    write: { type: 'boolean', default: false },
    user: { type: 'string', multiple: true },
  },
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

init(databaseUrl);
try {
  const result = await evaluateAchievements({
    userIds: values.user?.length ? values.user : null,
    dryRun: !values.write,
  });
  const added = new Map();
  for (const award of result.newAwards) {
    added.set(award.achievementId, (added.get(award.achievementId) ?? 0) + 1);
  }
  console.log(
    `${values.write ? 'wrote' : 'dry run (pass --write to apply)'}: ${result.checkedUsers} accounts with a qualifying fact`,
  );
  for (const id of ACHIEVEMENT_AWARD_IDS) {
    const qualified = result.qualified[id] ?? 0;
    const fresh = added.get(id) ?? 0;
    console.log(
      `  ${id.padEnd(20)} qualified ${String(qualified).padStart(6)}  ${values.write ? 'awarded' : 'would award'} ${String(fresh).padStart(6)}  held ${String(qualified - fresh).padStart(6)}`,
    );
  }
  console.log(`  total new: ${result.newAwards.length}`);
} finally {
  await close();
}
