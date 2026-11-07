#!/usr/bin/env node
// No server, database, engine binary or network required.
import { parseArgs } from 'node:util';
import { register } from 'tsx/esm/api';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    pairs: { type: 'string', default: '10' },
    'danger-weight': { type: 'string', default: '4' },
    challenger: { type: 'string', default: 'defensive' },
    opponent: { type: 'string', default: 'baseline' },
    samples: { type: 'string', default: '64' },
    'search-seed': { type: 'string', default: String(0x6762026) },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log('node scripts/xmj-bot-match.mjs [--seed 1] [--pairs 10] [--danger-weight 4]');
  console.log(
    '  [--challenger defensive|sampled] [--opponent baseline|defensive] [--samples 64] [--search-seed 108404774]',
  );
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
const { xmjBotAction: baseline } = await tsImport(
  '../packages/game/src/xiangqi-mahjong-bot-baseline.ts',
  import.meta.url,
);
const { xmjSampledAction } = await tsImport(
  '../packages/game/src/xiangqi-mahjong-sampled-bot.ts',
  import.meta.url,
);
const seed = Number(values.seed);
const pairs = Number(values.pairs);
const dangerWeight = Number(values['danger-weight']);
const samples = Number(values.samples);
const searchSeed = Number(values['search-seed']);
if (!Number.isFinite(dangerWeight) || dangerWeight < 0)
  throw new RangeError('Invalid danger weight');
if (!['defensive', 'sampled'].includes(values.challenger))
  throw new RangeError('Invalid challenger');
if (!['baseline', 'defensive'].includes(values.opponent)) throw new RangeError('Invalid opponent');
if (!Number.isInteger(samples) || samples < 1) throw new RangeError('Invalid sample count');
if (!Number.isInteger(searchSeed) || searchSeed < 0 || searchSeed > 0xffffffff)
  throw new RangeError('Invalid search seed');
const sampled = values.challenger === 'sampled';
const minimumScore = sampled && values.opponent === 'baseline' ? 0.6 : 0.55;
const minimumMatches = sampled ? 4000 : 0;
const results = xmjRunBotPairs(
  seed,
  pairs,
  sampled
    ? (view, seat) => xmjSampledAction(view, seat, { samples, seed: searchSeed })
    : (view, seat) => xmjDefensiveAction(view, seat, dangerWeight),
  values.opponent === 'baseline' ? baseline : xmjDefensiveAction,
  (pair) => console.log(JSON.stringify({ type: 'seed-pair', ...pair })),
);
console.log(
  JSON.stringify({
    type: 'summary',
    firstSeed: seed,
    challenger: values.challenger,
    opponent: values.opponent,
    dangerWeight,
    samples,
    searchSeed,
    minimumScore,
    minimumMatches,
    ...xmjSummarizeBotPairs(results, { minimumScore, minimumMatches }),
  }),
);
