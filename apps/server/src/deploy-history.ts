import type { RoomLifecycleAuditRecord } from './persistence.js';
import type { DrainSummaryPayload } from './server-drain.js';

// What each restart (and each drain that ended without one) cost players,
// assembled from room_lifecycle_audit rows the server already writes: the
// drain's own summary, the shutdown, the per-room pause on shutdown, and the
// resumes that followed on the new build. Read by /api/admin/deploys.

export const DEPLOY_HISTORY_KINDS = [
  'drain_summary',
  'shutdown_without_drain',
  'server_shutdown_requested',
  'pause_on_shutdown',
  'resume',
] as const;

export type DeployHistoryEntry = {
  at: string;
  kind: 'restart' | 'drain-cancelled' | 'drain-lapsed';
  // The build that went DOWN (the shutdown row is written by the old server).
  buildRevision: string | null;
  // Null for a restart with no summary row: no drain was open, or the shutdown
  // predates drain summaries (2026-09-25).
  drain: DrainSummaryPayload | null;
  // True when the server logged that it went down with no drain open.
  withoutDrain: boolean;
  activeGamesAtShutdown: number | null;
  pausedOnShutdown: number;
  // Rooms paused by that shutdown that resumed on the new build: players back
  // on both seats, or the grace timer resuming with a seat still empty.
  resumedPlayersBack: number;
  resumedAfterGrace: number;
};

// Rows written by one shutdown land within a few seconds of each other; a
// drain's 'shutdown' summary is written just before the shutdown row itself.
const SAME_SHUTDOWN_MS = 15_000;

function rowAt(row: RoomLifecycleAuditRecord): number {
  return row.atMs ?? row.occurredAt.getTime();
}

export function buildDeployHistory(
  rows: readonly RoomLifecycleAuditRecord[],
): DeployHistoryEntry[] {
  const sorted = [...rows].sort((a, b) => rowAt(a) - rowAt(b) || a.id - b.id);
  const shutdowns = sorted.filter((row) => row.kind === 'server_shutdown_requested');
  const entries: DeployHistoryEntry[] = [];

  shutdowns.forEach((shutdown, index) => {
    const at = rowAt(shutdown);
    const nextAt =
      index + 1 < shutdowns.length ? rowAt(shutdowns[index + 1]!) : Number.POSITIVE_INFINITY;
    const near = (row: RoomLifecycleAuditRecord): boolean =>
      Math.abs(rowAt(row) - at) <= SAME_SHUTDOWN_MS;
    const summary = sorted.find(
      (row) =>
        row.kind === 'drain_summary' &&
        (row.payload as Partial<DrainSummaryPayload>).outcome === 'shutdown' &&
        near(row),
    );
    const pausedRooms = new Set(
      sorted
        .filter((row) => row.kind === 'pause_on_shutdown' && near(row) && row.roomId)
        .map((row) => row.roomId as string),
    );
    let resumedPlayersBack = 0;
    let resumedAfterGrace = 0;
    for (const row of sorted) {
      if (row.kind !== 'resume' || !row.roomId || !pausedRooms.has(row.roomId)) continue;
      const rowTime = rowAt(row);
      if (rowTime <= at || rowTime >= nextAt) continue;
      if (row.payload.pauseReason !== 'shutdown') continue;
      if (row.payload.reason === 'both-present') resumedPlayersBack += 1;
      else if (row.payload.reason === 'grace-elapsed') resumedAfterGrace += 1;
    }
    const activeGames = shutdown.payload.activeGames;
    entries.push({
      at: new Date(at).toISOString(),
      kind: 'restart',
      buildRevision: shutdown.buildRevision,
      drain: summary ? (summary.payload as DrainSummaryPayload) : null,
      withoutDrain: sorted.some((row) => row.kind === 'shutdown_without_drain' && near(row)),
      activeGamesAtShutdown: typeof activeGames === 'number' ? activeGames : null,
      pausedOnShutdown: pausedRooms.size,
      resumedPlayersBack,
      resumedAfterGrace,
    });
  });

  for (const row of sorted) {
    if (row.kind !== 'drain_summary') continue;
    const payload = row.payload as Partial<DrainSummaryPayload>;
    if (payload.outcome !== 'cancelled' && payload.outcome !== 'lapsed') continue;
    entries.push({
      at: new Date(rowAt(row)).toISOString(),
      kind: payload.outcome === 'cancelled' ? 'drain-cancelled' : 'drain-lapsed',
      buildRevision: row.buildRevision,
      drain: row.payload as DrainSummaryPayload,
      withoutDrain: false,
      activeGamesAtShutdown: null,
      pausedOnShutdown: 0,
      resumedPlayersBack: 0,
      resumedAfterGrace: 0,
    });
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
