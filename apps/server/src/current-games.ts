/**
 * Current games (/games): every game in progress right now, across the legacy
 * chess map and every registered variant tenant, live AND correspondence.
 *
 * This is the "list everything" sibling of watch-live.ts, which elects ONE
 * featured game per channel for the TV hero. The two share the room walk and
 * the visibility policy but differ on purpose:
 *
 * - No freshness window and no "has a board renderer" gate. A dormant
 *   correspondence game is still a game in progress; a variant without a live
 *   board renderer is still listed, as a card with no board.
 * - Correspondence rooms are hydrated from the durable room_deadlines index
 *   first, so a days-per-move game with nobody connected (and therefore no
 *   in-memory room) is still on the page.
 * - "In play" is the deploy gate's own classification (isGameInPlay): paused
 *   rooms and rooms idle past the abandonment window are not listed. One
 *   definition of "is this game real" (see deploy-gate.ts).
 *
 * Hidden-information boundary (tested in current-games.test.ts):
 * - `observe` is liveObservePolicy(spec.visibility, specId), exhaustive and
 *   fail-closed. Only 'open' games ever carry a board payload, and only through
 *   the same per-tenant live payload builders TV uses (nothing hand-rolled).
 * - Every other field is knowledge both seated players already have: who is
 *   playing, the move count, the clocks, the time control, the deadline.
 *   Nothing about the position leaves the server for a masked or sealed game.
 */

import { clockPolicyKindFor, maybeGameSpecForId, timeClassForPace } from '@mistboard/game';
import { isGameInPlay } from './deploy-gate.js';
import { liveSeatProfileIdentity } from './first-party-bots.js';
import { logger } from './obs.js';
import * as persistence from './persistence.js';
import type { HttpApiContext } from './routes/lib.js';
import { canServeLiveBoard, isServerEngineClient, liveObservePolicy } from './server-policy.js';
import type { Room } from './server-types.js';
import {
  registeredVariantTenants,
  type TenantManagedRoom,
  type VariantTenantRegistration,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';
import { listWatchChannels } from './watch-channels.js';
import { hasLiveWatchPayloadBuilder, liveWatchPayloadForFeatured } from './watch-live.js';

export type CurrentGameObserve = 'open' | 'masked' | 'sealed';

export type CurrentGameTimeClass = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';

export type CurrentGamePlayer = {
  color: string;
  name: string | null;
  // Profile handle when the seat is a signed-in account; null for guests and
  // engines. Lets the card link the name without exposing a user id.
  handle: string | null;
  // The /bot/:id slug when the seat is a first-party bot; null otherwise —
  // including a raw engine version, which has no public page. Paired with
  // `handle` as the seat's linkable identity; at most one is ever set.
  botId: string | null;
  isEngine: boolean;
};

export type CurrentGameClock = {
  activeColor: string | null;
  remainingMs: Record<string, number>;
  // Server time the snapshot was taken; the client drains the active side from
  // here so a stale poll never shows a clock that stopped.
  asOf: number;
  running: boolean;
};

export type CurrentGame = {
  roomId: string;
  gameSpecId: string;
  // The Mistboard TV channel this game belongs to, or null when its variant has
  // no watch channel. Drives the rail filter.
  channelId: string | null;
  composition: 'pvp' | 'pve';
  observe: CurrentGameObserve;
  players: CurrentGamePlayer[];
  ply: number;
  rated: boolean;
  startedAt: number | null;
  lastActivityAt: number | null;
  timeControl: { initialMs: number; incrementMs: number; daysPerMove?: number } | null;
  timeClass: CurrentGameTimeClass | null;
  clock: CurrentGameClock | null;
  // Correspondence only: the seat on the move and its forfeit deadline.
  deadline: { seat: string; dueAt: string } | null;
  url: string;
};

type EngineSeatPredicate = (clientId: string | undefined) => boolean;

type DeadlineByRoom = ReadonlyMap<string, { seat: string; dueAt: Date }>;

// Load every active correspondence room into its tenant's live map so the walk
// below sees it. Returns the deadline index keyed by room id. Persistence-less
// runtimes (dev:memory) have no correspondence and skip this entirely; a query
// failure logs and degrades to the in-memory set rather than failing the page.
export async function hydrateCorrespondenceRooms(ctx: HttpApiContext): Promise<DeadlineByRoom> {
  const byRoom = new Map<string, { seat: string; dueAt: Date }>();
  if (!persistence.isInitialized()) return byRoom;
  let rows: persistence.ActiveRoomDeadline[];
  try {
    rows = await persistence.listActiveRoomDeadlines();
  } catch (err) {
    logger.warn(
      { kind: 'current_games_deadlines_failure', error: (err as Error).message },
      'current games: room_deadlines read failed; listing in-memory rooms only',
    );
    return byRoom;
  }
  const liveIds = new Set<string>(ctx.rooms.keys());
  for (const registration of registeredVariantTenants()) {
    for (const id of registration.rooms.keys()) liveIds.add(id);
  }
  await Promise.all(
    rows.map(async (row) => {
      byRoom.set(row.roomId, { seat: row.seat, dueAt: row.dueAt });
      if (liveIds.has(row.roomId)) return;
      const registration = variantTenantForRoomId(row.roomId);
      if (!registration?.enabled()) return;
      try {
        await registration.getOrLoadRoom(row.roomId);
      } catch (err) {
        logger.warn(
          {
            kind: 'current_games_hydrate_failure',
            room_id: row.roomId,
            error: (err as Error).message,
          },
          'current games: correspondence room failed to hydrate',
        );
      }
    }),
  );
  return byRoom;
}

export function collectCurrentGames(
  ctx: HttpApiContext,
  now = Date.now(),
  deadlines: DeadlineByRoom = new Map(),
): CurrentGame[] {
  const channels = listWatchChannels();
  const channelForSpec = (gameSpecId: string): string | null =>
    channels.find((channel) => channel.gameSpecIds.includes(gameSpecId as never))?.id ?? null;
  const games: CurrentGame[] = [];

  for (const room of ctx.rooms.values()) {
    const game = gameFromChessRoom(room, channelForSpec(room.gameSpecId), now, deadlines);
    if (game) games.push(game);
  }
  for (const registration of registeredVariantTenants()) {
    if (!registration.enabled()) continue;
    const channelId = registration.watch?.channelId ?? channelForSpec(registration.gameSpecId);
    const isEngine = registration.isEngineClientId ?? isServerEngineClient;
    for (const room of registration.rooms.values()) {
      const game = gameFromTenantRoom(registration, room, channelId, isEngine, now, deadlines);
      if (game) games.push(game);
    }
  }
  return sortCurrentGames(games);
}

function gameFromChessRoom(
  room: Room,
  channelId: string | null,
  now: number,
  deadlines: DeadlineByRoom,
): CurrentGame | null {
  if (room.projection.state.status.type !== 'playing') return null;
  if (!isGameInPlay(room, now)) return null;
  const seats = room.projection.seats;
  const players: CurrentGamePlayer[] = [];
  for (const color of ['white', 'black'] as const) {
    const clientId = seats[color];
    if (!clientId) return null;
    const isEngine = isServerEngineClient(clientId);
    const token = room.seatTokens[color];
    players.push({
      color,
      handle: null,
      botId: null,
      isEngine,
      name: token?.userDisplayName ?? token?.userHandle ?? (isEngine ? clientId : null),
      ...liveSeatProfileIdentity(isEngine ? clientId : null, token?.userHandle ?? null),
    });
  }
  return finishGame({
    channelId,
    clock: room.projection.state.clock ?? null,
    deadlines,
    events: room.events as readonly { type: string; at?: number }[],
    gameSpecId: room.gameSpecId,
    now,
    players,
    ply: (room.projection.state as { moveNumber?: number }).moveNumber ?? 0,
    rated: room.rated,
    roomId: room.id,
    timeControl: room.timeControl ?? null,
  });
}

function gameFromTenantRoom(
  registration: VariantTenantRegistration,
  room: TenantManagedRoom,
  channelId: string | null,
  isEngine: EngineSeatPredicate,
  now: number,
  deadlines: DeadlineByRoom,
): CurrentGame | null {
  const projection = room.projection;
  if (projection?.state.status.type !== 'playing') return null;
  if (!isGameInPlay(room as Parameters<typeof isGameInPlay>[0], now)) return null;
  const seats = projection.seats ?? {};
  const players: CurrentGamePlayer[] = [];
  for (const [color, clientId] of Object.entries(seats)) {
    if (!clientId) continue;
    const engineSeat = isEngine(clientId);
    const token = room.seatTokens?.[color];
    const engineName = engineSeat ? (registration.engineDisplayName?.(clientId) ?? clientId) : null;
    players.push({
      color,
      handle: null,
      botId: null,
      isEngine: engineSeat,
      name: token?.userDisplayName ?? token?.userHandle ?? engineName,
      ...liveSeatProfileIdentity(engineSeat ? clientId : null, token?.userHandle ?? null),
    });
  }
  if (players.length < 2) return null;
  return finishGame({
    channelId,
    clock: projection.clock ?? null,
    deadlines,
    events: room.events ?? [],
    gameSpecId: registration.gameSpecId,
    now,
    players,
    ply: projection.state.moveNumber ?? 0,
    rated: projection.rated ?? false,
    roomId: room.id,
    timeControl: projection.timeControl ?? null,
  });
}

function finishGame(args: {
  channelId: string | null;
  clock: unknown;
  deadlines: DeadlineByRoom;
  events: readonly { type: string; at?: number }[];
  gameSpecId: string;
  now: number;
  players: CurrentGamePlayer[];
  ply: number;
  rated: boolean;
  roomId: string;
  timeControl: { initialMs?: number; incrementMs?: number; daysPerMove?: number } | null;
}): CurrentGame | null {
  // Headless EvE never creates rooms; a both-engine live room is a code path
  // nothing here has vetted, so refuse rather than mislabel (as watch-live does).
  if (args.players.every((player) => player.isEngine)) return null;
  // Unknown spec ids are refused (fail-closed), never mapped to a default.
  const spec = maybeGameSpecForId(args.gameSpecId);
  if (!spec) return null;
  const observe = liveObservePolicy(spec.visibility, spec.id);
  const timeControl = normalizeTimeControl(args.timeControl);
  const deadline = args.deadlines.get(args.roomId) ?? null;
  return {
    channelId: args.channelId,
    clock: snapshotClock(args.clock, args.now),
    composition: args.players.some((player) => player.isEngine) ? 'pve' : 'pvp',
    deadline: deadline ? { dueAt: deadline.dueAt.toISOString(), seat: deadline.seat } : null,
    gameSpecId: args.gameSpecId,
    lastActivityAt: latestEventAt(args.events),
    observe,
    players: args.players,
    ply: args.ply,
    rated: args.rated,
    roomId: args.roomId,
    startedAt: firstEventAt(args.events),
    timeClass: timeClassFor(timeControl),
    timeControl,
    url: `/room/${encodeURIComponent(args.roomId)}`,
  };
}

function normalizeTimeControl(
  tc: { initialMs?: number; incrementMs?: number; daysPerMove?: number } | null,
): CurrentGame['timeControl'] {
  if (!tc || typeof tc.initialMs !== 'number') return null;
  return {
    initialMs: tc.initialMs,
    incrementMs: typeof tc.incrementMs === 'number' ? tc.incrementMs : 0,
    ...(typeof tc.daysPerMove === 'number' ? { daysPerMove: tc.daysPerMove } : {}),
  };
}

// Correspondence is decided by the same predicate the clock policy uses
// (presence of daysPerMove), never by the ms values: a 1-day allowance is
// 86,400,000 ms, which timeClassForPace would call classical.
export function timeClassFor(tc: CurrentGame['timeControl']): CurrentGameTimeClass | null {
  if (!tc) return null;
  if (clockPolicyKindFor(tc) === 'days-per-move') return 'correspondence';
  return timeClassForPace(tc.initialMs, tc.incrementMs);
}

// Both the chess ClockState and the tenant TenantClockState share this shape.
function snapshotClock(clock: unknown, now: number): CurrentGameClock | null {
  if (!clock || typeof clock !== 'object') return null;
  const record = clock as {
    activeColor?: unknown;
    remainingMs?: unknown;
    runningSince?: unknown;
  };
  if (!record.remainingMs || typeof record.remainingMs !== 'object') return null;
  const remainingMs: Record<string, number> = {};
  for (const [color, ms] of Object.entries(record.remainingMs as Record<string, unknown>)) {
    if (typeof ms === 'number' && Number.isFinite(ms)) remainingMs[color] = ms;
  }
  const activeColor = typeof record.activeColor === 'string' ? record.activeColor : null;
  const runningSince = typeof record.runningSince === 'number' ? record.runningSince : null;
  // Drain the running side to "now" so the snapshot is current at asOf, the
  // way the room's own clock tick would present it.
  if (activeColor && runningSince !== null && remainingMs[activeColor] !== undefined) {
    remainingMs[activeColor] = Math.max(0, remainingMs[activeColor] - (now - runningSince));
  }
  return {
    activeColor,
    asOf: now,
    remainingMs,
    running: activeColor !== null && runningSince !== null,
  };
}

function latestEventAt(events: readonly { at?: number }[]): number | null {
  let newest: number | null = null;
  for (const event of events) {
    if (typeof event.at === 'number' && (newest === null || event.at > newest)) newest = event.at;
  }
  return newest;
}

function firstEventAt(events: readonly { at?: number }[]): number | null {
  const first = events[0];
  return typeof first?.at === 'number' ? first.at : null;
}

// Live (clock-driven) games lead, human games before engine games, most
// recently active first. Correspondence games follow, soonest deadline first:
// on a page that is mostly correspondence, the game about to be decided is the
// one worth a look.
export function sortCurrentGames(games: CurrentGame[]): CurrentGame[] {
  const tier = (game: CurrentGame): number =>
    (game.timeClass === 'correspondence' ? 0 : 10) + (game.composition === 'pvp' ? 1 : 0);
  return [...games].sort((a, b) => {
    const byTier = tier(b) - tier(a);
    if (byTier !== 0) return byTier;
    if (a.timeClass === 'correspondence' && b.timeClass === 'correspondence') {
      const dueA = a.deadline ? Date.parse(a.deadline.dueAt) : Number.POSITIVE_INFINITY;
      const dueB = b.deadline ? Date.parse(b.deadline.dueAt) : Number.POSITIVE_INFINITY;
      if (dueA !== dueB) return dueA - dueB;
    }
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  });
}

// The live board payload for one listed game, or null. Fail-closed twice over:
// the game must be 'open' AND its spec must pass canServeLiveBoard, and only a
// registered per-tenant builder ever produces the payload (the same builders
// Mistboard TV uses). Masked and sealed games get nothing here by construction.
export async function currentGameBoardPayload(
  game: CurrentGame,
): Promise<Record<string, unknown> | null> {
  if (game.observe !== 'open') return null;
  if (!canServeLiveBoard(game.gameSpecId)) return null;
  if (!game.channelId || !hasLiveWatchPayloadBuilder(game.channelId)) return null;
  return liveWatchPayloadForFeatured({
    channelId: game.channelId,
    clock: game.clock,
    composition: game.composition,
    gameSpecId: game.gameSpecId,
    lastActivityAt: game.lastActivityAt ?? 0,
    players: game.players.map((player) => ({
      color: player.color,
      isEngine: player.isEngine,
      name: player.name,
    })),
    ply: game.ply,
    rated: game.rated,
    roomId: game.roomId,
    startedAt: game.startedAt,
    timeControl: game.timeControl,
  });
}
