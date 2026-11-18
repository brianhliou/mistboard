#!/usr/bin/env node
// Loopback-only load harness. --benchmark runs the reproducible PvP protocol.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { type BenchmarkOptions, runBenchmark } from './benchmark.js';
import { runScenario, validateTarget } from './runner.js';
import { scenarios } from './scenarios.js';
import { formatSummary, summarize } from './stats.js';

export function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (['--benchmark', '--quiet', '--json', '--help', '-h'].includes(arg)) flags.add(arg);
    else if (
      [
        '--mode',
        '--concurrency',
        '--duration',
        '--warmup',
        '--think',
        '--repetitions',
        '--server',
        '--seed',
        '--out',
        '--engine',
        '--persistence',
        '--placement',
      ].includes(arg)
    ) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      if (values.has(arg)) throw new Error(`duplicate argument ${arg}`);
      values.set(arg, value);
    } else throw new Error(`unknown argument ${arg}`);
  }
  const benchmark = flags.has('--benchmark');
  const integer = (key: string, fallback: number, minimum = 1) => {
    const raw = values.get(key);
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(n) || n < minimum) throw new Error(`invalid ${key}`);
    return n;
  };
  const duration = (key: string, fallback: number) => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const match = /^(\d+)(ms|s|m)?$/.exec(raw);
    if (!match) throw new Error(`invalid ${key}`);
    const ms = Number(match[1]) * (match[2] === 'ms' ? 1 : match[2] === 'm' ? 60_000 : 1000);
    if (!Number.isSafeInteger(ms) || (key === '--duration' && ms <= 0))
      throw new Error(`invalid ${key}`);
    return ms;
  };
  const concurrencies = (values.get('--concurrency') ?? (benchmark ? '1,50' : ''))
    .split(',')
    .map(Number);
  if (
    concurrencies.some((n) => !Number.isSafeInteger(n) || n < 1) ||
    new Set(concurrencies).size !== concurrencies.length ||
    (!benchmark && concurrencies.length !== 1)
  )
    throw new Error('invalid --concurrency');
  const scenario = scenarios[values.get('--mode') ?? (benchmark ? 'pvp-blitz' : '')];
  if (!scenario) throw new Error('unknown or missing --mode');
  if (benchmark && (scenario.mode !== 'pvp' || values.has('--engine')))
    throw new Error('benchmark requires PvP without engines');
  const persistence = values.get('--persistence') ?? 'unknown';
  const placement = values.get('--placement') ?? 'unknown';
  if (!['memory', 'disposable-postgres', 'unknown'].includes(persistence))
    throw new Error('invalid --persistence');
  if (!['same-host-separate-process', 'unknown'].includes(placement))
    throw new Error('invalid --placement');
  const durationMs = duration('--duration', benchmark ? 60_000 : 0);
  const warmupMs = duration('--warmup', benchmark ? 10_000 : 0);
  if (!benchmark && warmupMs && !durationMs) throw new Error('--warmup requires --duration');
  return {
    benchmark,
    quiet: flags.has('--quiet'),
    json: flags.has('--json') || benchmark,
    outFile: values.get('--out'),
    engine: values.get('--engine'),
    options: {
      serverUrl: validateTarget(values.get('--server') ?? 'ws://127.0.0.1:3001'),
      scenario,
      concurrencies,
      repetitions: integer('--repetitions', benchmark ? 3 : 1),
      durationMs,
      warmupMs,
      thinkMs: duration('--think', 0),
      seed: integer('--seed', 42, 0),
      persistence: persistence as BenchmarkOptions['persistence'],
      placement: placement as BenchmarkOptions['placement'],
    },
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Mistboard LOCAL load harness
  --benchmark              PvP protocol: concurrency 1,50, seed 42, 3 repetitions
  --mode <scenario>        ${Object.keys(scenarios).join(', ')}
  --concurrency <N[,N]>     Comma-separated values only with --benchmark
  --warmup <10s>            Warmup before measurement
  --duration <60s>          Measurement window; omit outside benchmark for one game
  --think <0ms>             Mean pause before each move (0.5x-1.5x jitter); not in the sample
  --repetitions <3>         Retain all runs
  --server <ws://127.0.0.1:3001>  Numeric loopback only, no redirects/tunnels to prod
  --persistence <memory|disposable-postgres>  Operator-declared isolated server mode
  --placement <same-host-separate-process>  Operator-declared server placement
  --seed <42> --out <file.json> --json --quiet
  --engine <id>            Legacy PvE only
Benchmark output is JSON. Unknown persistence/placement or failures suppress claims.
Exit 0: eligible benchmark/successful legacy run; 1: failed/ineligible run; 2: invalid arguments.
`);
    return 0;
  }
  const args = parseArgs(argv);
  if (args.benchmark) {
    const record = await runBenchmark(args.options);
    // The file keeps every raw attempt, so it is written compact; stdout stays readable.
    if (args.outFile) writeFileSync(args.outFile, `${JSON.stringify(record)}\n`);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return record.eligible ? 0 : 1;
  }
  const startedAt = performance.now();
  const games = await runScenario({
    ...args.options,
    scenario: args.engine
      ? { ...args.options.scenario, engineId: args.engine }
      : args.options.scenario,
    concurrency: args.options.concurrencies[0]!,
    durationMs: args.options.durationMs || undefined,
    onGameComplete: (game) => {
      if (!args.quiet && !args.json)
        console.log(
          `  game ${game.gameIdx} attempts=${game.moveAttempts.length} failures=${game.failures.length}`,
        );
    },
  });
  const failed =
    games.some((game) => game.failures.length) || !games.some((game) => game.moveAttempts.length);
  const record = { games, failed };
  const wallMs = performance.now() - startedAt;
  if (args.outFile)
    writeFileSync(
      args.outFile,
      args.json
        ? `${JSON.stringify(record, null, 2)}\n`
        : `${games.map((game) => JSON.stringify(game)).join('\n')}\n`,
    );
  if (args.json) process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  else {
    const outcomes = new Map<string, number>();
    for (const game of games) {
      const tag = game.failures.length
        ? 'ERR'
        : game.finishedNaturally
          ? 'FIN'
          : (game.note ?? 'OK');
      outcomes.set(tag, (outcomes.get(tag) ?? 0) + 1);
    }
    console.log('[loadtest] summary');
    console.log(
      `  wall=${wallMs}ms  games=${games.length}  total_moves=${games.reduce((n, game) => n + game.moveLatencies.length, 0)}`,
    );
    console.log(`  outcomes: ${[...outcomes].map(([tag, count]) => `${tag}=${count}`).join('  ')}`);
    const acknowledgments = games.flatMap((game) =>
      game.moveAttempts
        .filter((a) => a.phase === 'measurement' && a.outcome === 'acknowledged')
        .map((a) => a.latencyMs!),
    );
    console.log(
      formatSummary(
        'move-rtt (includes reply)',
        summarize(games.flatMap((game) => game.moveLatencies)),
      ),
    );
    console.log(
      formatSummary(
        'move-ack (both seats)',
        failed || acknowledgments.length < 100 ? null : summarize(acknowledgments),
      ),
    );
    console.log(formatSummary('game-duration', summarize(games.map((game) => game.durationMs))));
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // Error messages can originate in transport libraries: don't print secrets.
      console.error(
        '[loadtest] invalid arguments or fatal local harness error; no claim generated',
      );
      process.exitCode = 2;
    });
}
