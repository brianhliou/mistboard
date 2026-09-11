import { logger } from './obs.js';
import * as persistence from './persistence.js';

// A stats-excluded account connecting from this browser marks the browser's
// guest games as not site activity too (migration 137). Called from both live
// connection handlers (the chess stack and every variant tenant) once the
// device id and the account are known. Fire-and-forget: a failed insert must
// never cost a seat. Lives in its own module so the tenant runtime does not
// import the chess-stack connection module (a cycle esbuild turns into
// "__name is not a function" at load).
export function rememberExcludedDevice(
  deviceId: string | null,
  accountUser: { id: string; statsExcludedAt?: Date | null } | null,
): void {
  if (!deviceId || !accountUser?.statsExcludedAt || !persistence.isInitialized()) return;
  void persistence.rememberStatsExcludedDevice(deviceId, accountUser.id).catch((error) => {
    logger.warn(
      { kind: 'stats_excluded_device_write_failed', error: (error as Error).message },
      'stats-excluded device not recorded',
    );
  });
}
