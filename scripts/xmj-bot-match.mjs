#!/usr/bin/env node
// No server, database, engine binary or network required.
import { parseArgs } from 'node:util';
import { register } from 'tsx/esm/api';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    pairs: { type: 'string', default: '10' },
    'danger-weight': { type: 'string', default: '4' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log('node scripts/xmj-bot-match.mjs [--seed 1] [--pairs 10] [--danger-weight 4]');
  console.log(
    'Each pair plays two six-hand matches on identical walls with policies swapping seats.',
  );
  process.exit(0);
}
const tsImport = register({ namespace: 'xmj-bot-match' }).import;
const { xmjRunBotPairs, xmjSummarizeBotPairs } = await tsImport(
  '../packages/game/src/xiangqi-mahjong-bot-match.ts',
  import.meta.url,
);
const { xmjDefensiveAction } = await tsImport(
  '../packages/game/src/xiangqi-mahjong-defensive-bot.ts',
  import.meta.url,
);
const seed = Number(values.seed);
const pairs = Number(values.pairs);
const dangerWeight = Number(values['danger-weight']);
if (!Number.isFinite(dangerWeight) || dangerWeight < 0)
  throw new RangeError('Invalid danger weight');
const results = xmjRunBotPairs(
  seed,
  pairs,
  (view, seat) => xmjDefensiveAction(view, seat, dangerWeight),
  undefined,
  (pair) => console.log(JSON.stringify({ type: 'seed-pair', ...pair })),
);
console.log(
  JSON.stringify({
    type: 'summary',
    firstSeed: seed,
    dangerWeight,
    ...xmjSummarizeBotPairs(results),
  }),
);
