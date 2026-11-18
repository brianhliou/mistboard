import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const LOCAL_SMOKE_POSTGRES_URL = 'postgres://mistboard:mistboard@localhost:5435/postgres';

// Never inherit DATABASE_URL: this gate must not seed or clear a dev/prod DB.
export async function createSmokeDatabase({ Client = pg.Client } = {}) {
  const name = `mistboard_smoke_${randomUUID().replaceAll('-', '')}`;
  const databaseUrl = new URL(LOCAL_SMOKE_POSTGRES_URL);
  databaseUrl.pathname = `/${name}`;
  const client = new Client({ connectionString: LOCAL_SMOKE_POSTGRES_URL });
  await client.connect();
  let created = false;
  try {
    await client.query(`CREATE DATABASE "${name}"`);
    created = true;
  } finally {
    await client.end();
  }
  return {
    name,
    databaseUrl: databaseUrl.href,
    async dispose() {
      if (!created) return;
      const maintenance = new Client({ connectionString: LOCAL_SMOKE_POSTGRES_URL });
      await maintenance.connect();
      try {
        // Only our fresh, unique database can be dropped, including after a crash
        // in a probe. No shared dev/test database name can enter this query.
        await maintenance.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        created = false;
      } finally {
        await maintenance.end();
      }
    },
  };
}
