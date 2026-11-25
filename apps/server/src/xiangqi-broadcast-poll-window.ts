// Whether a broadcast tour polls its source right now, and why.
//
// A tour's poll mode is `auto` unless an operator overrides it. `auto` polls
// inside the event's own window: from twelve hours before it starts (so the
// first round's pairings land before play) to seven days after its last day
// (dpxq uploads records 赛后 on no fixed delay, usually the evening after a
// round but sometimes days later; at the slow 30-minute tail interval a week
// costs a few hundred cheap fetches). Before 2026-09, polling was a checkbox nobody flipped: an upcoming
// event imported nothing unless someone remembered it, and a live one left off
// stopped silently. `on` always polls (an operator's override for a late
// upload or an undated tour); `off` never does.
//
// A tour seeded after its event (a backfill: the 2026 women's league qualifier
// was added ten days after its window closed) gets the same seven-day tail
// counted from when it was created, so it imports itself instead of waiting
// for an operator to press Poll.
//
// A tour that reaches the end of that tail still waiting on its game records
// keeps a slow late tail: the scheduler polls it once a day until sixty days
// after the event (or after its creation, for a backfill), so records posted
// after the window still land. "Waiting on its records" means fewer than half
// its boards hold a move: no boards at all (the 2026 women's league, dpxq
// tour 12776, ended with 0 entrants and 0 records) or boards with results and
// no moves (the 2026 World Xiangqi Open: 231 results, and the records came
// about a day and a half after the tail closed). Once half the boards hold
// records the late tail ends; anything after that is an operator's Poll. The
// sixty-day cap keeps a dead tour from polling forever. Decided 2026-11-25:
// a finished tour with a source and no records keeps getting checked about
// once a day. Only a caller that counted the boards passes `boards`; one that
// did not gets the plain window.
//
// Everything here is derived from the dates at read time, never written back,
// so when the dpxq index sweep moves an end date later (a league's next
// stage) an `auto` tour resumes with no operator step.

export const XIANGQI_BROADCAST_POLL_MODES = ['auto', 'on', 'off'] as const;
export type XiangqiBroadcastPollMode = (typeof XIANGQI_BROADCAST_POLL_MODES)[number];

/** How long before the event starts an `auto` tour begins polling. */
export const XIANGQI_BROADCAST_POLL_LEAD_MS = 12 * 60 * 60_000;
/** How long after the event's end an `auto` tour keeps polling. */
export const XIANGQI_BROADCAST_POLL_TAIL_MS = 7 * 24 * 60 * 60_000;
/** How long after the event's end (or a backfill's creation) an `auto` tour
 *  still waiting on its records keeps a daily poll: the late tail's hard cap. */
export const XIANGQI_BROADCAST_POLL_LATE_CAP_MS = 60 * 24 * 60 * 60_000;

/** A tour's boards, counted: all of them, and those holding at least one move. */
export type XiangqiBroadcastBoardCounts = { total: number; recorded: number };

/** Whether a tour is still waiting on its game records: fewer than half its
 *  boards hold a move, which includes a tour with no boards at all. */
export function xiangqiBroadcastAwaitsRecords(boards: XiangqiBroadcastBoardCounts): boolean {
  return boards.total === 0 || boards.recorded * 2 < boards.total;
}

export type XiangqiBroadcastPollReason =
  /** Mode `on`: polls whatever the dates say. */
  | 'on'
  /** Mode `off`: never polls. */
  | 'off'
  /** The tour has no source to poll, whatever its mode. */
  | 'no-source'
  /** Mode `auto` with neither a start nor an end date. */
  | 'auto-undated'
  /** Mode `auto`, before the window opens. */
  | 'auto-before'
  /** Mode `auto`, inside the window. */
  | 'auto-open'
  /** Mode `auto`, past the window with most records still missing: polled
   *  once a day until the late cap. */
  | 'auto-late'
  /** Mode `auto`, after the window closed. */
  | 'auto-closed';

export type XiangqiBroadcastPollState = {
  mode: XiangqiBroadcastPollMode;
  /** True when the scheduler polls this tour now. */
  polling: boolean;
  reason: XiangqiBroadcastPollReason;
  /** The `auto` window, ISO in the event's own offset; null when undated.
   *  For a tour known to be waiting on its records, `closesAt` is the late
   *  tail's end. */
  opensAt: string | null;
  closesAt: string | null;
  /** True once the event's end has passed: the scheduler polls slowly then,
   *  since only late record uploads are still to come. */
  afterEvent: boolean;
};

export function isXiangqiBroadcastPollMode(value: unknown): value is XiangqiBroadcastPollMode {
  return (
    typeof value === 'string' && (XIANGQI_BROADCAST_POLL_MODES as readonly string[]).includes(value)
  );
}

/** An unknown stored value reads as `auto`, the default. */
export function normalizeXiangqiBroadcastPollMode(value: unknown): XiangqiBroadcastPollMode {
  return isXiangqiBroadcastPollMode(value) ? value : 'auto';
}

const OFFSET = /([+-])(\d{2}):?(\d{2})$/;

/** `ms` as ISO in the offset `like` carries, so the window reads on the
 *  event's clock ("2026-10-01T12:00:00+08:00"); UTC when it carries none. */
function isoInOffsetOf(ms: number, like: string): string {
  const match = OFFSET.exec(like);
  if (!match || /Z$/i.test(like)) return new Date(ms).toISOString();
  const sign = match[1] === '-' ? -1 : 1;
  const minutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  const shifted = new Date(ms + minutes * 60_000).toISOString().slice(0, 19);
  return `${shifted}${match[1]}${match[2]}:${match[3]}`;
}

function parsedMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function xiangqiBroadcastPollState(input: {
  pollMode: XiangqiBroadcastPollMode;
  sourceUrl: string | null | undefined;
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  /** When the tour was seeded; a tour seeded after its event polls for the
   *  tail counted from here. */
  createdAt?: string | Date | null;
  /** The tour's boards and how many hold a record. A tour still waiting on
   *  its records (xiangqiBroadcastAwaitsRecords) earns the daily late tail
   *  past the window; unknown (omitted) gets the plain window. */
  boards?: XiangqiBroadcastBoardCounts | null;
  now: number;
}): XiangqiBroadcastPollState {
  const start = parsedMs(input.startsAt);
  const end = parsedMs(input.endsAt);
  const created =
    input.createdAt instanceof Date ? input.createdAt.getTime() : parsedMs(input.createdAt);
  // One missing date reads as a one-day event on the other.
  const windowStart = start ?? end;
  const windowEnd = end ?? start;
  // The tail runs from the event's end, or from the tour's creation when it
  // was seeded later than that.
  const tailFrom =
    windowEnd !== null && created !== null && created > windowEnd ? created : windowEnd;
  const opensAt =
    windowStart === null
      ? null
      : isoInOffsetOf(
          windowStart - XIANGQI_BROADCAST_POLL_LEAD_MS,
          (start !== null ? input.startsAt : input.endsAt) ?? '',
        );
  const tailEnd = tailFrom === null ? null : tailFrom + XIANGQI_BROADCAST_POLL_TAIL_MS;
  const lateTailEnd =
    tailFrom !== null && input.boards && xiangqiBroadcastAwaitsRecords(input.boards)
      ? tailFrom + XIANGQI_BROADCAST_POLL_LATE_CAP_MS
      : null;
  const closesAt =
    tailEnd === null
      ? null
      : isoInOffsetOf(lateTailEnd ?? tailEnd, (end !== null ? input.endsAt : input.startsAt) ?? '');
  const afterEvent = windowEnd !== null && input.now > windowEnd;
  const base = { mode: input.pollMode, opensAt, closesAt, afterEvent };

  if (!input.sourceUrl) return { ...base, polling: false, reason: 'no-source' };
  if (input.pollMode === 'on') return { ...base, polling: true, reason: 'on' };
  if (input.pollMode === 'off') return { ...base, polling: false, reason: 'off' };
  if (windowStart === null || windowEnd === null) {
    return { ...base, polling: false, reason: 'auto-undated' };
  }
  if (input.now < windowStart - XIANGQI_BROADCAST_POLL_LEAD_MS) {
    return { ...base, polling: false, reason: 'auto-before' };
  }
  if (input.now > (tailEnd ?? windowEnd + XIANGQI_BROADCAST_POLL_TAIL_MS)) {
    if (lateTailEnd !== null && input.now <= lateTailEnd) {
      return { ...base, polling: true, reason: 'auto-late' };
    }
    return { ...base, polling: false, reason: 'auto-closed' };
  }
  return { ...base, polling: true, reason: 'auto-open' };
}
