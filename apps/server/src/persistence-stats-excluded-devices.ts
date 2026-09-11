import { getPool } from './persistence-db.js';

// A browser a stats-excluded account has connected from (migration 137).
// Called on every live connect that carries both a device id and an excluded
// account; the insert is idempotent and the first account to claim a device
// keeps it. Failures are logged by the caller and never block a seat: the
// count being slightly wrong is better than a game not starting.
export async function rememberStatsExcludedDevice(
  deviceId: string,
  accountId: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO stats_excluded_devices (device_id, account_id)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, accountId],
  );
}
