// The variant lab.
//
//   npm run lab -- <command> --variant <id> [--rules k=v,k=v] [options]
//
// Commands, in the order a new variant runs them:
//
//   assert-variant   the engine speaks this variant (identity + start-position move set)
//   perft-gate       engine ruleset == kernel ruleset (perft, discriminating positions, differential)
//   randomplay       random vs random: are the RULES symmetric?           (kernel only)
//   match            engine vs random: is the engine above noise?
//   ladder           10x nodes vs 1x, paired openings: does search understand the game?
//   bestplay         engine vs engine from the start, no randomness: the first-mover figure
//   report           the results table, from artifacts, with stale rows marked
//
// Every artifact carries the rules hash, the engine's binary hash and ini
// hash, the seed, and the lab version. Flip a rule with --rules and the
// report shows which rows no longer apply and what the flip costs.

import { parseArgs } from 'node:util';
import { assertVariant } from './commands/assert-variant.js';
import { bestplay } from './commands/bestplay.js';
import { ladder } from './commands/ladder.js';
import { match } from './commands/match.js';
import { perftGate } from './commands/perft-gate.js';
import { randomplay } from './commands/randomplay.js';
import { report } from './commands/report.js';
import { buildContext } from './context.js';
import { LAB_VARIANTS } from './variants/index.js';

const USAGE = `usage: lab <command> --variant <id> [--rules k=v[,k=v]] [--seed N] [--out DIR]
                [--threads N] [--hash MB] [--timeout MS] [--ply-cap N] [command options]

commands: assert-variant | perft-gate | randomplay | match | ladder | bestplay | report | variants

  perft-gate   --depth 2 --positions 200 --games 50
  randomplay   --games 3000 [--keep-games]
  match        --games 20 --nodes 100000
  ladder       --pairs 10 --hi 100000 --lo 10000 [--opening-plies 1]
  bestplay     --nodes 1000000[,2000000,...]
  report       [--write FILE.md]

variants: ${LAB_VARIANTS.map((v) => v.id).join(', ')}`;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${value}"`);
  return n;
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      variant: { type: 'string' },
      rules: { type: 'string', multiple: true },
      seed: { type: 'string' },
      out: { type: 'string' },
      threads: { type: 'string' },
      hash: { type: 'string' },
      timeout: { type: 'string' },
      'ply-cap': { type: 'string' },
      depth: { type: 'string' },
      positions: { type: 'string' },
      games: { type: 'string' },
      'keep-games': { type: 'boolean' },
      nodes: { type: 'string' },
      pairs: { type: 'string' },
      hi: { type: 'string' },
      lo: { type: 'string' },
      'opening-plies': { type: 'string' },
      write: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  if (command === 'variants') {
    for (const v of LAB_VARIANTS) {
      const rules = Object.entries(v.ruleSchema)
        .map(([k, s]) => `${k}=${s.default} [${s.options.join('|')}] (${s.blast})`)
        .join(', ');
      console.log(
        `${v.id.padEnd(16)} ${v.title}${rules ? `\n${''.padEnd(17)}rules: ${rules}` : ''}`,
      );
    }
    return 0;
  }
  if (!values.variant) {
    console.error('--variant is required');
    console.log(USAGE);
    return 2;
  }
  const ctx = buildContext({
    variant: values.variant,
    rules: values.rules,
    out: values.out,
    seed: values.seed === undefined ? undefined : num(values.seed, 1),
    threads: values.threads === undefined ? undefined : num(values.threads, 1),
    hashMb: values.hash === undefined ? undefined : num(values.hash, 64),
    timeoutMs: values.timeout === undefined ? undefined : num(values.timeout, 60_000),
    plyCap: values['ply-cap'] === undefined ? undefined : num(values['ply-cap'], 400),
  });

  switch (command) {
    case 'assert-variant':
      return (await assertVariant(ctx)).ok ? 0 : 1;
    case 'perft-gate':
      return (
        await perftGate(ctx, {
          depth: num(values.depth, 2),
          positions: num(values.positions, 200),
          games: num(values.games, 50),
        })
      ).ok
        ? 0
        : 1;
    case 'randomplay':
      await randomplay(ctx, {
        games: num(values.games, 3000),
        keepGames: values['keep-games'] ?? false,
      });
      return 0;
    case 'match':
      await match(ctx, { games: num(values.games, 20), nodes: num(values.nodes, 100_000) });
      return 0;
    case 'ladder':
      await ladder(ctx, {
        pairs: num(values.pairs, 10),
        hi: num(values.hi, 100_000),
        lo: num(values.lo, 10_000),
        openingPlies: num(values['opening-plies'], 1),
      });
      return 0;
    case 'bestplay':
      await bestplay(ctx, {
        nodes: (values.nodes ?? '1000000').split(',').map((n) => num(n.trim(), 1_000_000)),
      });
      return 0;
    case 'report':
      report(ctx, { write: values.write });
      return 0;
    default:
      console.error(`unknown command "${command}"`);
      console.log(USAGE);
      return 2;
  }
}

if (process.argv[1] && /[\\/]cli\.(ts|js)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
