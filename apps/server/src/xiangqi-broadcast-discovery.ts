// Discovery sources: a broadcast source that is a query rather than a list.
//
// A manifest names the boards to poll, so relaying a multi-board live event
// means regenerating and republishing that manifest every round. A discovery
// source instead works out which boards are live at poll time and builds the
// manifest in memory, so one source URL runs a whole tournament untouched.
//
// The discovery URL itself is never fetched, so it bypasses the host allowlist
// by construction. That is safe because every URL a provider returns is fed
// through the normal manifest path, where resolveLeafSource re-runs
// validateXiangqiBroadcastSourceUrl per entry and records source_disallowed for
// anything off the allowlist. The fail-closed property lives at the leaves.

import type { XiangqiBroadcastSourceFetch } from './xiangqi-broadcast-fetch.js';

export const XIANGQI_BROADCAST_DISCOVERY_SCHEME = 'mistboard-discover:';

export type DiscoveredBoard = {
  /** Absolute URL of the board, re-gated by the source policy downstream. */
  url: string;
  event?: string;
  red?: string;
  black?: string;
  /**
   * Round the board belongs to, when the source states it (dpxq's tour game
   * list labels every row 第NN轮). Boards discovered by viewer count carry no
   * round, so this stays optional.
   */
  roundNumber?: number;
  plies?: number;
};

export type DiscoveryProviderInput = {
  config: URLSearchParams;
  fetchImpl: XiangqiBroadcastSourceFetch;
  timeoutMs: number;
};

export type DiscoveryProvider = {
  readonly name: string;
  /**
   * True when every board this provider yields carries `roundNumber`. Such a
   * source is filed by its stated rounds and never by the schedule's clock;
   * see buildStatedRoundManifestSources.
   */
  readonly statesRounds?: boolean;
  discover(
    input: DiscoveryProviderInput,
  ): Promise<{ ok: true; boards: DiscoveredBoard[] } | { ok: false; message: string }>;
};

export type DiscoverySource = {
  provider: DiscoveryProvider;
  config: URLSearchParams;
  /** Pinned tour identity. Required: see parseXiangqiBroadcastDiscoverySource. */
  tourSlug: string;
  tourName?: string;
  minViewers: number;
  maxBoards: number;
  /** Substring match against a board's event tag; unset keeps every board. */
  event?: string;
};

export type DiscoverySourceParse =
  | { ok: true; source: DiscoverySource }
  | { ok: false; message: string };

const providers = new Map<string, DiscoveryProvider>();

export function registerXiangqiBroadcastDiscoveryProvider(provider: DiscoveryProvider): void {
  providers.set(provider.name, provider);
}

export function isXiangqiBroadcastDiscoveryUrl(sourceUrl: string): boolean {
  return sourceUrl.trimStart().toLowerCase().startsWith(XIANGQI_BROADCAST_DISCOVERY_SCHEME);
}

function positiveInteger(raw: string | null, fallback: number, max: number): number | null {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

/**
 * `mistboard-discover://<provider>?tourSlug=...&event=...&minViewers=3&maxBoards=32`
 *
 * Unknown providers are rejected rather than falling back to treating the
 * string as an http URL, matching the fail-closed variant-dispatch rule: an
 * unrecognised member throws instead of being mapped onto a neighbour.
 */
export function parseXiangqiBroadcastDiscoverySource(
  sourceUrl: string,
  maxBoardsCeiling: number,
): DiscoverySourceParse {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { ok: false, message: 'discovery source is not a URL' };
  }
  if (parsed.protocol.toLowerCase() !== XIANGQI_BROADCAST_DISCOVERY_SCHEME) {
    return { ok: false, message: 'not a discovery source' };
  }

  // A custom-scheme URL puts the authority in `host`, but an empty authority
  // (mistboard-discover:/dpxq-live) leaves it on the path, so accept both
  // rather than silently reading an empty provider name.
  const providerName = (parsed.host || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (providerName.length === 0) {
    return { ok: false, message: 'discovery source names no provider' };
  }
  const provider = providers.get(providerName);
  if (!provider) {
    return {
      ok: false,
      message: `unknown discovery provider "${providerName}" (known: ${[...providers.keys()].sort().join(', ') || 'none'})`,
    };
  }

  const config = parsed.searchParams;
  const tourSlug = config.get('tourSlug')?.trim();
  if (!tourSlug) {
    // Without a pinned slug the adapter would fall back to deriving the tour
    // from the source's own tags, which is the derivation discovery exists to
    // replace, and a wrong slug scatters one event across several tours.
    return { ok: false, message: 'discovery source requires a tourSlug' };
  }

  const minViewers = positiveInteger(config.get('minViewers'), 1, 10_000);
  if (minViewers === null) {
    return { ok: false, message: 'discovery source minViewers must be a positive integer' };
  }
  const maxBoards = positiveInteger(config.get('maxBoards'), maxBoardsCeiling, maxBoardsCeiling);
  if (maxBoards === null) {
    return {
      ok: false,
      message: `discovery source maxBoards must be an integer between 1 and ${maxBoardsCeiling}`,
    };
  }

  const tourName = config.get('tourName')?.trim();
  const event = config.get('event')?.trim();
  return {
    ok: true,
    source: {
      provider,
      config,
      tourSlug,
      minViewers,
      maxBoards,
      ...(tourName ? { tourName } : {}),
      ...(event ? { event } : {}),
    },
  };
}

/** Test seam: drop every registered provider. */
export function resetXiangqiBroadcastDiscoveryProviders(): void {
  providers.clear();
}

export type ScheduledRound = { id: string; name?: string; startsAt: Date };

export type RoundResolution =
  | { ok: true; roundId: string; roundName?: string }
  | { ok: false; message: string };

/**
 * Between rounds there is simply nothing to import, which is the normal state
 * for most of a multi-day event. Callers use this to stay quiet rather than
 * recording a fault on every tick.
 */
export const NO_ACTIVE_ROUND_MESSAGE = 'no scheduled round is active';

/** Default span after a round's start during which its boards are still live. */
export const XIANGQI_BROADCAST_ROUND_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * Pick the round a poll belongs to from the seeded schedule.
 *
 * Pinning a round in the source config would move the per-round human step
 * rather than remove it, so the schedule decides. Rounds are seeded once with
 * their dates (scripts/seed-broadcast-rounds.mjs) and the whole event then runs
 * without an operator.
 *
 * Outside any round's window this fails rather than guessing. Falling back to
 * the most recent round would quietly file round 8's games under round 7 during
 * the gap between them, which is worse than importing nothing.
 */
export function resolveScheduledRound(
  rounds: readonly ScheduledRound[],
  now: Date,
  windowMs: number = XIANGQI_BROADCAST_ROUND_WINDOW_MS,
): RoundResolution {
  const nowMs = now.getTime();
  let best: ScheduledRound | undefined;
  for (const round of rounds) {
    const startedAt = round.startsAt.getTime();
    if (startedAt > nowMs) continue;
    if (nowMs - startedAt > windowMs) continue;
    if (!best || startedAt > best.startsAt.getTime()) best = round;
  }
  if (!best) {
    return { ok: false, message: NO_ACTIVE_ROUND_MESSAGE };
  }
  return { ok: true, roundId: best.id, ...(best.name ? { roundName: best.name } : {}) };
}

export type DiscoveryManifestSource = {
  url: string;
  tourSlug: string;
  tourName?: string;
  roundId: string;
  roundName?: string;
  boardNumber: number;
};

export type DiscoveryManifestBuild =
  | { ok: true; sources: DiscoveryManifestSource[]; droppedForCap: number }
  | { ok: false; message: string };

/**
 * Turn discovered boards into manifest entries.
 *
 * Every entry pins the tour, the round and the board number rather than letting
 * the converter derive them. dpxq's tag hygiene varies by whoever created the
 * record (sampled boards carried event="2020", round="2020-10" and an empty
 * table), and it serves one game per page, so a derived round would collapse a
 * whole league onto one round and a derived board number would make every board
 * "Board 1".
 */
/**
 * Round number out of a seeded round id.
 *
 * scripts/seed-broadcast-rounds.mjs emits `<tourSlug>-r<NN>`, which is what
 * makes a source-stated round (第07轮) comparable to the scheduled one.
 */
export function roundNumberFromRoundId(roundId: string): number | undefined {
  const match = roundId.match(/-r0*(\d+)$/i);
  const parsed = Number(match?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function buildDiscoveryManifestSources(input: {
  source: DiscoverySource;
  boards: readonly DiscoveredBoard[];
  round: { roundId: string; roundName?: string };
}): DiscoveryManifestBuild {
  const byEvent = input.source.event
    ? input.boards.filter((board) => (board.event ?? '').includes(input.source.event as string))
    : [...input.boards];

  // A source that states its own round is authoritative about which games
  // belong to the active one, so honour it rather than importing a whole
  // tournament's game list into whichever round happens to be open. Failing
  // closed here matches resolveScheduledRound: filing round 8 under round 7 is
  // worse than importing nothing.
  const stated = byEvent.filter((board) => board.roundNumber !== undefined);
  let matching = byEvent;
  if (stated.length > 0) {
    const active = roundNumberFromRoundId(input.round.roundId);
    if (active === undefined) {
      return {
        ok: false,
        message: `boards state their round but the scheduled round id "${input.round.roundId}" carries no round number`,
      };
    }
    matching = byEvent.filter((board) => board.roundNumber === active);
    if (matching.length === 0) {
      return { ok: false, message: `no discovered boards belong to round ${active}` };
    }
  }

  if (matching.length === 0) {
    return {
      ok: false,
      message: input.source.event
        ? `no live boards matched event "${input.source.event}"`
        : 'no live boards discovered',
    };
  }

  const kept = matching.slice(0, input.source.maxBoards);
  return {
    ok: true,
    // A silent cap reads as full coverage, so the count travels with the result
    // and the caller logs it.
    droppedForCap: matching.length - kept.length,
    sources: kept.map((board, index) => ({
      url: board.url,
      tourSlug: input.source.tourSlug,
      roundId: input.round.roundId,
      boardNumber: index + 1,
      ...(input.source.tourName ? { tourName: input.source.tourName } : {}),
      ...(input.round.roundName ? { roundName: input.round.roundName } : {}),
    })),
  };
}

export type SeededRound = { id: string; name?: string };

export type StatedRoundManifestBuild =
  | {
      ok: true;
      sources: DiscoveryManifestSource[];
      droppedForCap: number;
      /** Boards already stored complete; nothing on the source can change them. */
      skippedComplete: number;
      /** Boards whose stated round has no seeded round to land in. */
      droppedUnscheduled: number;
    }
  | { ok: false; message: string; quiet?: true };

/** The poller keys its quiet path off this exact message, like NO_ACTIVE_ROUND_MESSAGE. */
export const NOTHING_NEW_MESSAGE = 'every listed board is already imported';

/**
 * Manifest for a source whose boards each state their own round.
 *
 * The time-gated path above exists for sources that cannot say which round a
 * board belongs to, so the seeded schedule has to. A source that states the
 * round (dpxq's tour game list labels every row 第NN轮) does not need the
 * clock, and gating it on one is exactly wrong for how such lists are filled:
 * dpxq uploads records 赛后 on no fixed delay, and the 2026 Shanghai Cup had
 * one game listed by the last day of the event. A twelve-hour window after
 * each round's start was closed long before any record arrived, so a tour
 * polled all week imported nothing.
 *
 * So: file every board under the seeded round with its number, skip the ones
 * already stored complete (a finished record cannot change, and re-fetching
 * every game of a league on every poll is the load the cap exists to bound),
 * keep re-fetching the ones stored live, and drop boards for rounds the
 * schedule never seeded rather than guess. Board numbers are the row's rank
 * among its round's rows in the source's own order.
 */
export function buildStatedRoundManifestSources(input: {
  source: DiscoverySource;
  boards: readonly DiscoveredBoard[];
  rounds: readonly SeededRound[];
  completeUrls: ReadonlySet<string>;
}): StatedRoundManifestBuild {
  const byEvent = input.source.event
    ? input.boards.filter((board) => (board.event ?? '').includes(input.source.event as string))
    : [...input.boards];
  if (byEvent.length === 0) {
    return {
      ok: false,
      message: input.source.event
        ? `no listed boards matched event "${input.source.event}"`
        : 'no boards listed',
    };
  }

  const roundsByNumber = new Map<number, SeededRound>();
  for (const round of input.rounds) {
    const number = roundNumberFromRoundId(round.id);
    if (number !== undefined && !roundsByNumber.has(number)) roundsByNumber.set(number, round);
  }

  const rankInRound = new Map<number, number>();
  const candidates: DiscoveryManifestSource[] = [];
  let skippedComplete = 0;
  let droppedUnscheduled = 0;
  for (const board of byEvent) {
    if (board.roundNumber === undefined) {
      return { ok: false, message: `listed board ${board.url} states no round` };
    }
    const rank = (rankInRound.get(board.roundNumber) ?? 0) + 1;
    rankInRound.set(board.roundNumber, rank);
    const round = roundsByNumber.get(board.roundNumber);
    if (!round) {
      droppedUnscheduled += 1;
      continue;
    }
    if (input.completeUrls.has(board.url)) {
      skippedComplete += 1;
      continue;
    }
    candidates.push({
      url: board.url,
      tourSlug: input.source.tourSlug,
      roundId: round.id,
      boardNumber: rank,
      ...(input.source.tourName ? { tourName: input.source.tourName } : {}),
      ...(round.name ? { roundName: round.name } : {}),
    });
  }

  if (candidates.length === 0) {
    if (skippedComplete > 0) {
      return { ok: false, message: NOTHING_NEW_MESSAGE, quiet: true };
    }
    return {
      ok: false,
      message: `${droppedUnscheduled} listed board(s) state rounds the schedule has not seeded`,
    };
  }

  const kept = candidates.slice(0, input.source.maxBoards);
  return {
    ok: true,
    sources: kept,
    droppedForCap: candidates.length - kept.length,
    skippedComplete,
    droppedUnscheduled,
  };
}
