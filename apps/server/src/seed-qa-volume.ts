// npm run db:seed:volume (also included in db:seed:qa). No production reads.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertLocalQaDatabase, QA_VOLUME, qaVolumeSpecIds } from './qa-volume.js';
import { seedQaVolume } from './qa-volume-store.js';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required. Use npm run db:seed:volume.');
  assertLocalQaDatabase(url);
  const profile = JSON.parse(
    await readFile(new URL('../../../config/product-profile.json', import.meta.url), 'utf8'),
  ) as { gameSpecIds: string[] };
  const specs = qaVolumeSpecIds(profile.gameSpecIds);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const reviews = await seedQaVolume(client, specs);
    console.log(
      `QA volume: ${specs.length * QA_VOLUME.gamesPerVariant} fictional legal-play games, ${QA_VOLUME.topics} topics, ${QA_VOLUME.studies} studies, ${QA_VOLUME.chatLines} chat lines.`,
    );
    console.log('Synthetic advantage charts (local fixture values, not engine evaluations):');
    for (const review of reviews) console.log(`  ${review}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  // Do not print pg errors/connection details: the URL may contain credentials.
  console.error(
    error instanceof Error && error.message.startsWith('QA volume seed')
      ? error.message
      : 'QA volume seed failed; check that local Postgres is running and db:migrate has completed.',
  );
  process.exitCode = 1;
});
