/**
 * Mistboard TV live-featured election (watch-live).
 *
 * Scans the in-memory live room maps (the legacy chess map + every registered
 * variant tenant's map) for in-progress games whose spec visibility permits a
 * live board (liveObservePolicy === 'open'), and elects a featured game per
 * channel plus a cross-channel 'top' channel. Lazy per-request: at Mistboard's
 * liquidity there is no timer/actor — GET /api/watch/live runs the scan.
 *
 * Fail-closed invariants (tested in watch-live.test.ts):
 * - Fog ('dark') and hidden-identity rooms NEVER become candidates; the only
 *   policy consulted is liveObservePolicy, which is exhaustive over
 *   VisibilityRulesId.
 * - The live payload is only built for rooms that re-pass canServeLiveBoard,
 *   and only channels with a registered payload builder (a per-tenant function
 *   over public state) ever feature, so nothing hand-rolled leaves the server.
 *
 * Election: PvP outranks PvE (a live human game takes the hero over an engine
 * game); at equal composition, standard xiangqi outranks other variants on the
 * cross-variant 'top' channel; within a tier, the most recently active room.
 * Hysteresis: the currently featured room keeps the board while it is still
 * live and its tier is unbeaten, so recency alone never yanks a game
 * mid-broadcast. EvE never appears here — engine-vs-engine games run headless
 * in the worker and reach TV only as completed games.
 */

import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { liveSeatProfileIdentity } from './first-party-bots.js';
import type { HttpApiContext } from './routes/lib.js';
import { canServeLiveBoard, isServerEngineClient } from './server-policy.js';
import type { Room } from './server-types.js';
import {
  registeredVariantTenants,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import { listWatchChannels, type WatchChannel } from './watch-channels.js';

export const LIVE_TV_TOP_CHANNEL_ID = 'top';

// Per-channel live payload builders, registered as a module side effect by the
// owning games-route module (routes/xiangqi-games.ts etc.), mirroring the
// tenant-registration pattern. A builder produces the tenant's postgame-SHAPED
// payload for an IN-PROGRESS room (same per-ply views/timeline the finished
// replay serves, built from the events so far), which is what the web watch
// renderers replay. Doubles as the rendering-capability gate: a channel with no
// builder never produces live candidates (a tenant whose bespoke watch
// renderer has no live path yet), so the client is never handed a live game it
// cannot draw.
export type LiveWatchPayloadBuilder = (roomId: string) => Promise<Record<string, unknown> | null>;

const liveWatchPayloadBuilders = new Map<string, LiveWatchPayloadBuilder>();

export function registerLiveWatchPayloadBuilder(
  channelId: string,
  builder: LiveWatchPayloadBuilder,
): void {
  liveWatchPayloadBuilders.set(channelId, builder);
}

export function hasLiveWatchPayloadBuilder(channelId: string): boolean {
  return liveWatchPayloadBuilders.has(channelId);
}

// The featured room's live payload. Re-checks the visibility policy before the
// builder runs (fail-closed: a room whose spec is not 'open' serves nothing, no
// matter how it was elected). Null when the builder is missing or the room has
// moved on (e.g. just finished) — the route then withholds the featured moment
// for this poll rather than serving a stale board.
export async function liveWatchPayloadForFeatured(
  featured: LiveTvCandidate,
): Promise<Record<string, unknown> | null> {
  if (!canServeLiveBoard(featured.gameSpecId)) return null;
  const builder = liveWatchPayloadBuilders.get(featured.channelId);
  if (!builder) return null;
  return builder(featured.roomId);
}

// A live game with no event in this window is dormant (an idle correspondence
// game, an abandoned room the sweeps have not reaped yet) and does not belong
// on the hero board.
export const LIVE_TV_FRESH_WINDOW_MS = 10 * 60 * 1000;

// A game earns the hero board only once BOTH sides have moved. A candidate's
// `ply` is the state's moveNumber, which every variant starts at 1 and advances
// after the second mover's ply, so 2 is the first position both players have
// touched. Below that the board is untouched or one move old, and a room
// abandoned at that point strands the homepage on an all-face-down board
// (2026-08-27: the hero sat on a one-flip banqi room after both guests left).
export const LIVE_TV_MIN_MOVE_NUMBER = 2;

export type LiveTvComposition = 'pvp' | 'pve';

export type LiveTvPlayer = {
  color: string;
  name: string | null;
  isEngine: boolean;
  // Profile identity for the seat, so TV can link a live name the same way the
  // finished-game surfaces do. At most one is ever set: `handle` addresses
  // /@/<handle> for a signed-in human, `botId` addresses /bot/<id> for a
  // first-party bot. Both absent for a guest, and for a raw engine-version seat
  // with no bot identity in front of it — neither has a public page.
  handle?: string | null;
  botId?: string | null;
};

export type LiveTvCandidate = {
  roomId: string;
  gameSpecId: string;
  channelId: string;
  composition: LiveTvComposition;
  players: LiveTvPlayer[];
  ply: number;
  rated: boolean;
  startedAt: number | null;
  lastActivityAt: number;
  timeControl: unknown;
  clock: unknown;
};

type EngineSeatPredicate = (clientId: string | undefined) => boolean;

export function collectLiveTvCandidates(ctx: HttpApiContext, now = Date.now()): LiveTvCandidate[] {
  const channels = listWatchChannels();
  const enabledChannelIds = new Set(channels.map((channel) => channel.id));
  const candidates: LiveTvCandidate[] = [];

  // Legacy chess map. Every chess-stack spec is fog today, so this walk yields
  // nothing — kept generic so an open chess-stack spec would light up through
  // the same policy gate instead of a second code path.
  for (const room of ctx.rooms.values()) {
    const candidate = candidateFromChessRoom(room, channels, now);
    if (candidate) candidates.push(candidate);
  }

  for (const registration of registeredVariantTenants()) {
    const watch = registration.watch;
    if (!watch || !registration.enabled()) continue;
    if (!enabledChannelIds.has(watch.channelId)) continue;
    if (!canServeLiveBoard(registration.gameSpecId)) continue;
    if (!hasLiveWatchPayloadBuilder(watch.channelId)) continue;
    const isEngine = registration.isEngineClientId ?? isServerEngineClient;
    for (const room of registration.rooms.values()) {
      const candidate = candidateFromTenantRoom(registration, room, isEngine, now);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function candidateFromChessRoom(
  room: Room,
  channels: readonly WatchChannel[],
  now: number,
): LiveTvCandidate | null {
  if (room.projection.state.status.type !== 'playing') return null;
  if (!canServeLiveBoard(room.gameSpecId)) return null;
  const channel = channels.find((entry) => entry.gameSpecIds.includes(room.gameSpecId));
  if (!channel || !hasLiveWatchPayloadBuilder(channel.id)) return null;
  const seats = room.projection.seats;
  const players: LiveTvPlayer[] = [];
  for (const color of ['white', 'black'] as const) {
    const clientId = seats[color];
    if (!clientId) return null;
    const isEngine = isServerEngineClient(clientId);
    const token = room.seatTokens[color];
    players.push({
      color,
      isEngine,
      name: token?.userDisplayName ?? token?.userHandle ?? (isEngine ? clientId : null),
      ...liveSeatProfileIdentity(isEngine ? clientId : null, token?.userHandle ?? null),
    });
  }
  return finishCandidate({
    channelId: channel.id,
    clock: null,
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

function candidateFromTenantRoom(
  registration: VariantTenantRegistration,
  room: TenantManagedRoom,
  isEngine: EngineSeatPredicate,
  now: number,
): LiveTvCandidate | null {
  const projection = room.projection;
  if (projection?.state.status.type !== 'playing') return null;
  const seats = projection.seats ?? {};
  const players: LiveTvPlayer[] = [];
  for (const [color, clientId] of Object.entries(seats)) {
    if (!clientId) continue;
    const engineSeat = isEngine(clientId);
    const token = room.seatTokens?.[color];
    const engineName = engineSeat ? (registration.engineDisplayName?.(clientId) ?? clientId) : null;
    players.push({
      color,
      isEngine: engineSeat,
      name: token?.userDisplayName ?? token?.userHandle ?? engineName,
      ...liveSeatProfileIdentity(engineSeat ? clientId : null, token?.userHandle ?? null),
    });
  }
  if (players.length < 2) return null;
  return finishCandidate({
    channelId: registration.watch!.channelId,
    clock: projection.clock ?? null,
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

function finishCandidate(args: {
  channelId: string;
  clock: unknown;
  events: readonly { type: string; at?: number }[];
  gameSpecId: string;
  now: number;
  players: LiveTvPlayer[];
  ply: number;
  rated: boolean;
  roomId: string;
  timeControl: unknown;
}): LiveTvCandidate | null {
  // Headless EvE never creates rooms; a both-engine live room would be a new
  // code path this module has not vetted, so refuse rather than mislabel.
  if (args.players.every((player) => player.isEngine)) return null;
  if (args.ply < LIVE_TV_MIN_MOVE_NUMBER) return null;
  const lastActivityAt = latestEventAt(args.events);
  if (lastActivityAt === null || args.now - lastActivityAt > LIVE_TV_FRESH_WINDOW_MS) return null;
  return {
    channelId: args.channelId,
    clock: args.clock,
    composition: args.players.some((player) => player.isEngine) ? 'pve' : 'pvp',
    gameSpecId: args.gameSpecId,
    lastActivityAt,
    players: args.players,
    ply: args.ply,
    rated: args.rated,
    roomId: args.roomId,
    startedAt: firstEventAt(args.events),
    timeControl: args.timeControl,
  };
}

function latestEventAt(events: readonly { at?: number }[]): number | null {
  const last = events[events.length - 1];
  return typeof last?.at === 'number' ? last.at : null;
}

function firstEventAt(events: readonly { at?: number }[]): number | null {
  const first = events[0];
  return typeof first?.at === 'number' ? first.at : null;
}

// Featured-room memory per channel, for hysteresis across polls. Room ids are
// unguessable and the map only ever grows by one entry per channel, so this is
// safe module-level state; entries clear when their channel has no candidates.
const featuredRoomByChannel = new Map<string, string>();

export function resetLiveTvFeaturedForTest(): void {
  featuredRoomByChannel.clear();
}

// Ranking score for the featured board. Two signals, in priority order:
//
//   1. Composition: a human game always outranks an engine game (worth 2, so
//      the flagship bonus below can never lift a PvE game over a PvP one).
//   2. Flagship variant: at equal composition, standard xiangqi wins (worth 1).
//
// The flagship bonus exists because the cross-variant 'top' channel is the
// default landing channel, and its only other signal is recency. A visitor
// arriving from xiangqi content would otherwise land on whichever variant
// happened to move most recently, which in practice is a bot game on a mini
// variant. On a variant-filtered channel every candidate shares a gameSpecId,
// so the bonus cancels out and this is exactly the old pvp-over-pve rule.
function tier(candidate: LiveTvCandidate): number {
  const composition = candidate.composition === 'pvp' ? 2 : 0;
  const flagship = candidate.gameSpecId === XIANGQI_SPEC_ID ? 1 : 0;
  return composition + flagship;
}

export function electLiveTvFeatured(
  channelId: string,
  candidates: LiveTvCandidate[],
): LiveTvCandidate | null {
  const pool =
    channelId === LIVE_TV_TOP_CHANNEL_ID
      ? candidates
      : candidates.filter((candidate) => candidate.channelId === channelId);
  if (pool.length === 0) {
    featuredRoomByChannel.delete(channelId);
    return null;
  }
  const best = pool.reduce((left, right) =>
    tier(right) > tier(left) ||
    (tier(right) === tier(left) && right.lastActivityAt > left.lastActivityAt)
      ? right
      : left,
  );
  const currentRoomId = featuredRoomByChannel.get(channelId);
  const current = currentRoomId
    ? pool.find((candidate) => candidate.roomId === currentRoomId)
    : undefined;
  // Keep the currently featured game while it is still a live candidate and a
  // strictly better tier has not appeared — recency alone never switches the
  // board mid-game.
  const chosen = current && tier(current) >= tier(best) ? current : best;
  featuredRoomByChannel.set(channelId, chosen.roomId);
  return chosen;
}

// Valid ?channel= values for /api/watch/live: 'top' plus every enabled channel.
export function isLiveTvChannelId(channelId: string): boolean {
  if (channelId === LIVE_TV_TOP_CHANNEL_ID) return true;
  return listWatchChannels().some((channel) => channel.id === channelId);
}
