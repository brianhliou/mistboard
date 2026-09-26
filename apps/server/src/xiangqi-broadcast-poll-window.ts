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
// Everything here is derived from the dates at read time, never written back,
// so when the dpxq index sweep moves an end date later (a league's next
// stage) an `auto` tour resumes with no operator step.

export const XIANGQI_BROADCAST_POLL_MODES = ['auto', 'on', 'off'] as const;
export type XiangqiBroadcastPollMode = (typeof XIANGQI_BROADCAST_POLL_MODES)[number];

/** How long before the event starts an `auto` tour begins polling. */
export const XIANGQI_BROADCAST_POLL_LEAD_MS = 12 * 60 * 60_000;
/** How long after the event's end an `auto` tour keeps polling. */
export const XIANGQI_BROADCAST_POLL_TAIL_MS = 7 * 24 * 60 * 60_000;

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
  /** Mode `auto`, after the window closed. */
  | 'auto-closed';

export type XiangqiBroadcastPollState = {
  mode: XiangqiBroadcastPollMode;
  /** True when the scheduler polls this tour now. */
  polling: boolean;
  reason: XiangqiBroadcastPollReason;
  /** The `auto` window, ISO in the event's own offset; null when undated. */
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
  now: number;
}): XiangqiBroadcastPollState {
  const start = parsedMs(input.startsAt);
  const end = parsedMs(input.endsAt);
  // One missing date reads as a one-day event on the other.
  const windowStart = start ?? end;
  const windowEnd = end ?? start;
  const opensAt =
    windowStart === null
      ? null
      : isoInOffsetOf(
          windowStart - XIANGQI_BROADCAST_POLL_LEAD_MS,
          (start !== null ? input.startsAt : input.endsAt) ?? '',
        );
  const closesAt =
    windowEnd === null
      ? null
      : isoInOffsetOf(
          windowEnd + XIANGQI_BROADCAST_POLL_TAIL_MS,
          (end !== null ? input.endsAt : input.startsAt) ?? '',
        );
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
  if (input.now > windowEnd + XIANGQI_BROADCAST_POLL_TAIL_MS) {
    return { ...base, polling: false, reason: 'auto-closed' };
  }
  return { ...base, polling: true, reason: 'auto-open' };
}
