import pg from 'pg';
import {
  createEngineGameTask,
  createExperimentJob,
  type EngineExperimentPurpose,
} from './engine-experiments.js';
import { latestBuiltinEngineIds, upsertBuiltinEngineVersions } from './engine-registry.js';
import { parseEngineTimeControl } from './engine-time-policy.js';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to enqueue engine games');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const latest = latestBuiltinEngineIds();
const gameCount = positiveInteger(args.games ?? process.env.ENGINE_GAMES, 3);
const maxPlies = positiveInteger(args.maxPlies ?? process.env.ENGINE_MAX_PLIES, 160);
const purpose = purposeFrom(args.purpose ?? process.env.ENGINE_PURPOSE, 'smoke');
const seed = args.seed ?? process.env.ENGINE_SEED ?? Date.now().toString();
const variant = variantFrom(args.variant ?? process.env.ENGINE_VARIANT ?? 'dark-chess');
const engineDefaults = defaultEnginesFor(variant, latest);
const whiteEngineId = args.white ?? process.env.ENGINE_WHITE_ENGINE ?? engineDefaults.white;
const blackEngineId = args.black ?? process.env.ENGINE_BLACK_ENGINE ?? engineDefaults.black;
const priority = integer(args.priority ?? process.env.ENGINE_PRIORITY, 0);
const providers = csv(args.providers ?? process.env.ENGINE_PROVIDERS ?? 'local,railway');
const timeControl = parseEngineTimeControl(
  args.timeControl ?? process.env.ENGINE_TIME_CONTROL ?? 'none',
);
const artifactPolicy =
  args.artifacts === 'none'
    ? {}
    : {
        move_choices: args.artifacts ?? process.env.ENGINE_ARTIFACTS ?? 'all',
        runtime_summary: 'all',
      };

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

try {
  await migrate(databaseUrl);
  await upsertBuiltinEngineVersions(pool, [whiteEngineId, blackEngineId]);
  const job = await createExperimentJob(pool, {
    purpose,
    targetGames: gameCount,
    config: {
      pairing: {
        kind: whiteEngineId === blackEngineId ? 'self-play' : 'engine-vs-engine',
        white_engine_id: whiteEngineId,
        black_engine_id: blackEngineId,
      },
      sample: { target_games: gameCount },
      time_control: timeControl,
      artifact_policy: artifactPolicy,
      review_policy: { enqueue_engine_lab: true, initial_review_status: 'unreviewed' },
    },
    createdBy: args.createdBy ?? process.env.ENGINE_CREATED_BY ?? 'engine-enqueue-cli',
  });

  const tasks = [];
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex++) {
    tasks.push(
      await createEngineGameTask(pool, {
        jobId: job.id,
        gameIndex,
        priority,
        whiteEngineId,
        blackEngineId,
        seed: nextSeed(seed, gameIndex),
        timeControl,
        openingPolicy: { kind: 'standard' },
        artifactPolicy,
        resourcePolicy: { providers, concurrency: 1 },
        config: {
          variant,
          max_plies: maxPlies,
          white_engine_id: whiteEngineId,
          black_engine_id: blackEngineId,
        },
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        level: 'info',
        kind: 'engine_games_enqueued',
        jobId: job.id,
        taskIds: tasks.map((task) => task.id),
        purpose,
        gameCount,
        seed,
        maxPlies,
        variant,
        whiteEngineId,
        blackEngineId,
        providers,
        timeControl,
        artifactPolicy,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}

async function migrate(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const applied = await runMigrations(client);
    if (applied.length > 0) {
      console.log(JSON.stringify({ level: 'info', kind: 'migrations_applied', applied }));
    }
  } finally {
    await client.end();
  }
}

type CliArgs = {
  artifacts?: string;
  black?: string;
  createdBy?: string;
  games?: string;
  maxPlies?: string;
  priority?: string;
  providers?: string;
  purpose?: string;
  seed?: string;
  timeControl?: string;
  variant?: string;
  white?: string;
};

function parseArgs(values: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 0; index < values.length; index++) {
    const arg = values[index]!;
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const value = inlineValue ?? values[++index];
    if (!value) throw new Error(`missing value for --${rawKey}`);
    switch (rawKey) {
      case 'artifacts':
      case 'black':
      case 'created-by':
      case 'games':
      case 'max-plies':
      case 'priority':
      case 'providers':
      case 'purpose':
      case 'seed':
      case 'time-control':
      case 'variant':
      case 'white':
        parsed[toCamel(rawKey)] = value;
        break;
      default:
        throw new Error(`unknown argument --${rawKey}`);
    }
  }
  return parsed;
}

function toCamel(key: string): keyof CliArgs {
  if (key === 'created-by') return 'createdBy';
  if (key === 'max-plies') return 'maxPlies';
  if (key === 'time-control') return 'timeControl';
  return key as keyof CliArgs;
}

type EngineTaskVariant = 'dark-chess' | 'xiangqi';

function variantFrom(value: string): EngineTaskVariant {
  if (value === 'dark-chess' || value === 'xiangqi') return value;
  throw new Error(`unsupported --variant ${JSON.stringify(value)} (expected dark-chess | xiangqi)`);
}

// Default engine ids per variant. dark-chess keeps the latest builtin
// pairing; xiangqi has no builtin "latest" so default to a cross-tier FSF pair
// (exercises the ladder and needs no Pikafish binary). Override with --white/--black.
function defaultEnginesFor(
  variant: EngineTaskVariant,
  latest: { white: string; black: string },
): { white: string; black: string } {
  if (variant === 'xiangqi') {
    return { white: 'fairy-stockfish-xiangqi-level-7', black: 'fairy-stockfish-xiangqi-level-8' };
  }
  return { white: latest.white, black: latest.black };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function purposeFrom(
  value: string | undefined,
  fallback: EngineExperimentPurpose,
): EngineExperimentPurpose {
  const allowed = new Set<EngineExperimentPurpose>([
    'mining',
    'bakeoff',
    'calibration',
    'smoke',
    'regression',
  ]);
  return allowed.has(value as EngineExperimentPurpose)
    ? (value as EngineExperimentPurpose)
    : fallback;
}

function nextSeed(baseSeed: string, offset: number): string {
  try {
    return (BigInt(baseSeed) + BigInt(offset)).toString();
  } catch {
    return `${baseSeed}-${offset}`;
  }
}
