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

export type PublicPuzzleRatingPoint = {
  variant: string;
  createdAt: string;
  ratingBefore: number;
  ratingAfter: number;
  startsSegment: boolean;
};

// Both owner and visitor charts use the same public read. Failed reads can be
// retried; selecting a row again reuses this mount's successful read.
export function createPublicProfilePuzzleHistory(
  handle: string,
): () => Promise<PublicPuzzleRatingPoint[]> {
  let pending: Promise<PublicPuzzleRatingPoint[]> | null = null;
  return () => {
    pending ??= fetch(`/api/users/${encodeURIComponent(handle)}/puzzle-rating-history`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`puzzle rating history failed: ${response.status}`);
        const data: { points: PublicPuzzleRatingPoint[] } = await response.json();
        if (!Array.isArray(data.points)) throw new Error('invalid puzzle rating history');
        return data.points;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}
const localDay = (createdAt: string) => new Date(createdAt).toDateString();
const HISTORY_PAGE_SIZE = 100;

// The owner's private xiangqi attempts feed only the Activity tab's daily
// rows. A failed load is not cached, so a later load can notify subscribers.
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
// Xiangqi is the public puzzle pool shown on profiles (Jungle is hidden there),
// and the only pool whose history the owner's profile fetches.
export const PROFILE_PUZZLE_HISTORY_VARIANT = 'xiangqi';

async function fetchAllPuzzleHistory(): Promise<PuzzleHistoryEntry[]> {
  // The API is oldest-first. Follow every page before showing the graph so an
  // existing player never gets a misleading, truncated early timeline.
  const attempts: PuzzleHistoryEntry[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const query = new URLSearchParams({
      variant: PROFILE_PUZZLE_HISTORY_VARIANT,
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

// One closing rating per local calendar day, preserving every server-marked
// gap. These points contain no attempt identifiers or outcomes.
export function profilePuzzleRatingPoints(
  points: PublicPuzzleRatingPoint[],
): PublicPuzzleRatingPoint[] {
  const days: PublicPuzzleRatingPoint[] = [];
  for (const point of points) {
    const day = days.at(-1);
    if (
      day &&
      !point.startsSegment &&
      day.variant === point.variant &&
      localDay(day.createdAt) === localDay(point.createdAt)
    ) {
      day.ratingAfter = point.ratingAfter;
      day.createdAt = point.createdAt;
    } else {
      days.push({ ...point });
    }
  }
  return days;
}
