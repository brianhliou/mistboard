import pg from 'pg';
import { createEngineGameTask, createExperimentJob } from './engine-experiments.js';
import { loadEngine, upsertBuiltinEngineVersions } from './engine-registry.js';
import {
  createRoundRobinPairings,
  nextTournamentSeed,
  pairingOpeningPolicy,
  parseTournamentArgs,
  tournamentJobConfig,
} from './engine-tournament.js';
import { runMigrations } from './migrate.js';
import { eveAdapterFor } from './variant-eve-registry.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required to enqueue an engine tournament');
  process.exit(1);
}

const config = parseTournamentArgs(process.argv.slice(2));
const adapter = eveAdapterFor(config.variant);
if (adapter) {
  const foreign = config.engines.filter((engineId) => {
    const id = loadEngine(engineId).id;
    return id !== adapter.randomEngineId && adapter.tierFor(id) === null;
  });
  if (foreign.length > 0) {
    throw new Error(
      `${config.variant} tournaments require registered ${config.variant} engine profiles; got ${foreign.join(', ')}`,
    );
  }
}
const pairings = createRoundRobinPairings({
  engines: config.engines,
  gamesPerPair: config.gamesPerPair,
});
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

try {
  await migrate(databaseUrl);
  await upsertBuiltinEngineVersions(pool, config.engines);
  const job = await createExperimentJob(pool, {
    purpose: 'calibration',
    targetGames: pairings.length,
    config: tournamentJobConfig(config, pairings.length),
    createdBy: config.createdBy,
  });

  const tasks = [];
  for (const pairing of pairings) {
    tasks.push(
      await createEngineGameTask(pool, {
        jobId: job.id,
        gameIndex: pairing.gameIndex,
        priority: config.priority,
        whiteEngineId: pairing.whiteEngineId,
        blackEngineId: pairing.blackEngineId,
        seed: nextTournamentSeed(config.seed, pairing.gameIndex),
        timeControl: config.timeControl,
        openingPolicy: pairingOpeningPolicy(config.openingPolicy, config.seed, pairing),
        artifactPolicy: config.artifactPolicy,
        resourcePolicy: { providers: config.providers, concurrency: 1 },
        config: {
          variant: config.variant,
          max_plies: config.maxPlies,
          tournament_id: config.tournamentId,
          pair_id: pairing.pairId,
          pair_index: pairing.pairIndex,
          repeat_index: pairing.repeatIndex,
          white_engine_id: pairing.whiteEngineId,
          black_engine_id: pairing.blackEngineId,
        },
      }),
    );
  }

  console.log(
    JSON.stringify(
      {
        level: 'info',
        kind: 'engine_tournament_enqueued',
        jobId: job.id,
        tournamentId: config.tournamentId,
        taskIds: tasks.map((task) => task.id),
        engines: config.engines,
        gamesPerPair: config.gamesPerPair,
        gameCount: pairings.length,
        seed: config.seed,
        maxPlies: config.maxPlies,
        providers: config.providers,
        timeControl: config.timeControl,
        openingPolicy: config.openingPolicy,
        variant: config.variant,
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
