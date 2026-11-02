export type PuzzleHistoryEntry = {
  puzzleId: string;
  variant: string;
  solved: boolean;
  rated: boolean;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  createdAt: string;
};

type PuzzleHistoryPage = {
  attempts: PuzzleHistoryEntry[];
  nextOffset: number | null;
};

type RatedEntry = PuzzleHistoryEntry & { ratingBefore: number; ratingAfter: number };
// A day's rated attempts: ratingBefore from its first, ratingAfter and
// createdAt from its last.
type RatedDay = RatedEntry & { attempts: number };
const localDay = (createdAt: string) => new Date(createdAt).toDateString();
const HISTORY_PAGE_SIZE = 100;

// The owner's xiangqi puzzle history, fetched once and shared by the spotlight
// and the Activity tab's daily rows. A failed load is not cached, so selecting
// the puzzle row or retrying can fetch again and notify every subscriber.
export type ProfilePuzzleHistory = {
  load(): Promise<PuzzleHistoryEntry[]>;
  subscribe(listener: (attempts: PuzzleHistoryEntry[]) => void): void;
};

export function createProfilePuzzleHistory(
  fetchAll: () => Promise<PuzzleHistoryEntry[]> = fetchAllPuzzleHistory,
): ProfilePuzzleHistory {
  let pending: Promise<PuzzleHistoryEntry[]> | null = null;
  let latest: PuzzleHistoryEntry[] | null = null;
  const listeners = new Set<(attempts: PuzzleHistoryEntry[]) => void>();
  return {
    load() {
      pending ??= fetchAll().then(
        (attempts) => {
          latest = attempts;
          for (const listener of listeners) listener(attempts);
          return attempts;
        },
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
      return pending;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (latest) listener(latest);
    },
  };
}

// Called only for the viewer's own profile. The API selects the account from
// the session; there is deliberately no handle or account id in this request.
// Xiangqi is the public puzzle pool shown on profiles (Jungle is hidden there).
async function fetchAllPuzzleHistory(): Promise<PuzzleHistoryEntry[]> {
  // The API is oldest-first. Follow every page before showing the graph so an
  // existing player never gets a misleading, truncated early timeline.
  const attempts: PuzzleHistoryEntry[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const query = new URLSearchParams({
      variant: 'xiangqi',
      limit: String(HISTORY_PAGE_SIZE),
      offset: String(offset),
    });
    const response = await fetch(`/api/puzzles/history?${query}`);
    if (!response.ok) throw new Error(`puzzle history failed: ${response.status}`);
    const page: PuzzleHistoryPage = await response.json();
    if (
      !Array.isArray(page.attempts) ||
      (page.nextOffset !== null &&
        (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset))
    ) {
      throw new Error('invalid puzzle history page');
    }
    attempts.push(...page.attempts);
    offset = page.nextOffset;
  }
  return attempts;
}

export type ProfilePuzzleDay = {
  day: string;
  // Latest attempt that day, for ordering against the game rows.
  time: number;
  count: number;
  solved: number;
  failed: number;
};

// One row per calendar day (the same day labels the game rows use), newest
// first. Individual attempts are not listed on the profile.
export function profilePuzzleDays(
  attempts: PuzzleHistoryEntry[],
  dayLabel: (createdAt: string) => string,
): ProfilePuzzleDay[] {
  const days = new Map<string, ProfilePuzzleDay>();
  for (const entry of attempts) {
    const time = Date.parse(entry.createdAt);
    if (!Number.isFinite(time)) continue;
    const day = dayLabel(entry.createdAt);
    let summary = days.get(day);
    if (!summary) {
      summary = { day, time, count: 0, solved: 0, failed: 0 };
      days.set(day, summary);
    }
    summary.time = Math.max(summary.time, time);
    summary.count += 1;
    if (entry.solved) summary.solved += 1;
    else summary.failed += 1;
  }
  return [...days.values()].sort((a, b) => b.time - a.time);
}

export function hasSavedPuzzleRating(entry: PuzzleHistoryEntry): entry is RatedEntry {
  return (
    entry.ratingBefore !== null &&
    entry.ratingAfter !== null &&
    Number.isFinite(entry.ratingBefore) &&
    Number.isFinite(entry.ratingAfter)
  );
}

// Daily saved ratings for the shared spotlight. Segment boundaries preserve
// gaps where an older attempt has no snapshot or the saved ratings disagree.
export function profilePuzzleRatingPoints(
  attempts: PuzzleHistoryEntry[],
): (RatedDay & { startsSegment: boolean })[] {
  const segments: RatedEntry[][] = [];
  let segment: RatedEntry[] = [];
  const daySegments: RatedDay[][] = [];
  for (const entry of attempts) {
    if (!entry.rated) continue;
    if (!hasSavedPuzzleRating(entry)) {
      segment = [];
      continue;
    }
    // A missing snapshot or a discontinuity starts a new segment. Never infer
    // the rating of an old result from today's aggregate or the next result.
    if (segment.at(-1)?.ratingAfter !== entry.ratingBefore) segment = [];
    if (segment.length === 0) segments.push(segment);
    segment.push(entry);
  }
  // One point per day at the day's closing rating, as Lichess's rating graph
  // does: a session of attempts plotted one by one stacked into a vertical bar.
  for (const entries of segments) {
    const days: RatedDay[] = [];
    for (const entry of entries) {
      const day = days.at(-1);
      if (day && localDay(day.createdAt) === localDay(entry.createdAt)) {
        day.ratingAfter = entry.ratingAfter;
        day.createdAt = entry.createdAt;
        day.attempts += 1;
      } else {
        days.push({ ...entry, attempts: 1 });
      }
    }
    daySegments.push(days);
  }
  return daySegments.flatMap((days) =>
    days.map((day, index) => ({ ...day, startsSegment: index === 0 })),
  );
}
