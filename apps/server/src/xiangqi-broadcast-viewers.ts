// Runtime census of open broadcast SSE streams. The board/round event streams
// are per-connection interval pollers with no subscriber registry, so until
// this existed nothing on the server could say how many people were watching a
// broadcast. Counters only: nothing is persisted, and a restart zeroes them.
//
// Keyed by stream (`board:<id>` / `round:<tour>/<round>`) so a future readout
// can say which board drew the crowd; the totals feed `/api/server-status` and
// the readout's production section.

export type BroadcastViewerStats = {
  /** Open streams right now, every key summed. */
  current: number;
  /** Highest `current` seen so far this UTC day. Resets when the day turns. */
  peakToday: number;
  /** Highest `current` seen since the process started. */
  peakSinceBoot: number;
};

export type BroadcastViewerRegistry = {
  /** Register one open stream; the returned release is idempotent, so a
   *  request and a response both emitting `close` decrement once. */
  open(streamKey: string): () => void;
  stats(): BroadcastViewerStats;
  /** Live count per stream key, for diagnostics. */
  streams(): ReadonlyMap<string, number>;
};

function utcDayOf(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function createBroadcastViewerRegistry(
  now: () => number = () => Date.now(),
): BroadcastViewerRegistry {
  const perStream = new Map<string, number>();
  let current = 0;
  let peakSinceBoot = 0;
  let peakToday = 0;
  let peakDay = utcDayOf(now());

  // The day's peak is only meaningful for the day it was measured on: when the
  // date turns, the new day starts from whoever is still connected.
  function rollDay(): void {
    const day = utcDayOf(now());
    if (day === peakDay) return;
    peakDay = day;
    peakToday = current;
  }

  return {
    open(streamKey) {
      rollDay();
      perStream.set(streamKey, (perStream.get(streamKey) ?? 0) + 1);
      current += 1;
      if (current > peakToday) peakToday = current;
      if (current > peakSinceBoot) peakSinceBoot = current;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        current -= 1;
        const left = (perStream.get(streamKey) ?? 1) - 1;
        if (left <= 0) perStream.delete(streamKey);
        else perStream.set(streamKey, left);
      };
    },
    stats() {
      rollDay();
      return { current, peakToday, peakSinceBoot };
    },
    streams() {
      return perStream;
    },
  };
}

/** The process-wide registry the SSE routes report into. */
export const broadcastViewers: BroadcastViewerRegistry = createBroadcastViewerRegistry();
