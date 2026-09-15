// Play streak: consecutive calendar days with at least one counted game
// (persistence-counted-games.ts decides what counts). Days are the PLAYER'S
// calendar, so the caller buckets timestamps in the browser's time zone before
// they get here; a US evening game must not land on "tomorrow".
//
// A streak is alive through the whole of the next day: playing yesterday and
// not yet today still reads as the current run (chess.com's rule). Two days
// without a game, and it is 0 while the best stays.

export type PlayStreak = {
  current: number;
  best: number;
  // Player-calendar date (YYYY-MM-DD) of the last counted game, null if none.
  lastPlayedDay: string | null;
  // Player-calendar date the streak was computed for.
  today: string;
};

const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

// Any string the browser could produce from Intl.resolvedOptions().timeZone;
// anything else (or an unknown zone) resolves to UTC. The name is also handed
// to Postgres's AT TIME ZONE, whose tz database is the same IANA set.
export function resolveTimeZone(candidate: string | null | undefined): string {
  if (!candidate || !TIME_ZONE_PATTERN.test(candidate)) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

// YYYY-MM-DD of `now` on the wall clock of `timeZone` (en-CA formats as ISO).
export function calendarDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// `days` are distinct YYYY-MM-DD strings in any order.
export function computePlayStreak(days: readonly string[], today: string): PlayStreak {
  const ordinals = [...new Set(days.map(dayOrdinal))].sort((a, b) => a - b);
  if (ordinals.length === 0) return { current: 0, best: 0, lastPlayedDay: null, today };

  let best = 1;
  let run = 1;
  for (let i = 1; i < ordinals.length; i += 1) {
    run = ordinals[i] === ordinals[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const last = ordinals[ordinals.length - 1];
  const todayOrdinal = dayOrdinal(today);
  // `run` is the length of the run that ends on the last played day; it is the
  // current streak only if that day is today or yesterday.
  const current = last === todayOrdinal || last === todayOrdinal - 1 ? run : 0;
  return { current, best, lastPlayedDay: ordinalDay(last), today };
}

function dayOrdinal(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function ordinalDay(ordinal: number): string {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10);
}
