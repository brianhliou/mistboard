import {
  type Color,
  type GameEvent,
  type GameProjection,
  type GameSpecId,
  maybeGameSpecForId,
  type PlayerView,
  type Square,
  variantForId,
} from '@mistboard/game';
import { engineVersionDisplayName } from './engine-registry.js';
import type { LiveSeatProfile } from './first-party-bots.js';
import { type GameAccessMode, modeForProjection, roomViewPolicy } from './server-policy.js';

export type Seat = Color | 'spectator';

export type SnapshotClient = {
  devViews: boolean;
  id: string;
  seat: Seat;
  solo: boolean;
};

export type SnapshotRoom = {
  id: string;
  clients: { size: number } & Iterable<{ seat: Seat; displaced: boolean }>;
  events: GameEvent[];
  mode?: GameAccessMode;
  gameSpecId?: GameSpecId;
  projection: GameProjection;
  pveEngineId?: string | null;
  rated?: boolean;
  region?: string;
  rematch?: { offers: Partial<Record<Color, unknown>>; finalizedRoomId?: string };
  seatDisplayNames?: Partial<Record<Color, string>>;
  // Linkable profile identity per seat, parallel to seatDisplayNames (built by
  // seatProfilesForRoom). Public identity only -- a handle or a bot slug, each
  // already implied by the display name sitting beside it -- so this discloses
  // nothing per-seat that a spectator could not already read off the room, and
  // it is deliberately NOT filtered per client the way the board view is.
  seatProfiles?: Partial<Record<Color, LiveSeatProfile>>;
  // Absolute ms deadline for the current pre-move abort window, or null when no
  // window is live. Sent to clients to render the abort countdown; survives
  // reconnect since it's an absolute timestamp.
  abortDeadline?: number | null;
  // Absolute ms deadline for the post-move-1 leaver forfeit countdown, or null.
  // Drives the "opponent left — you win in Ns" banner; absolute so it survives
  // reconnect.
  forfeitDeadline?: number | null;
};

export function computeConnectedSeats(clients: Iterable<{ seat: Seat; displaced: boolean }>): {
  white: boolean;
  black: boolean;
} {
  const connected = { white: false, black: false };
  for (const c of clients) {
    if (c.displaced) continue;
    if (c.seat === 'white') connected.white = true;
    else if (c.seat === 'black') connected.black = true;
  }
  return connected;
}

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const ranks = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const allSquares = ranks.flatMap((rank) => files.map((file) => `${file}${rank}` as Square));

export function snapshotPayload(room: SnapshotRoom, client: SnapshotClient) {
  const normalized = normalizeRoom(room);
  return {
    type: 'snapshot',
    ...basePayloadFields(normalized, client),
    events: eventsForClient(normalized, client),
  };
}

// Sibling wire message reserved for server-pushed clock updates that have
// no corresponding event-log entry (e.g. periodic resync during a long
// think). NOT emitted today — the client extrapolates clocks from
// state.clock + serverAt across events. Reserved here per the locked
// design decision: clock ticks are a sibling clock-tick message, NOT part of
// event-appended, so the
// next emitter has a clean wire path and event-appended doesn't grow an
// optional non-event branch.
export function clockTickPayload(room: SnapshotRoom, client: SnapshotClient) {
  return {
    type: 'clock-tick' as const,
    roomId: room.id,
    serverAt: Date.now(),
    seat: client.seat,
    clock: room.projection.state.clock ?? null,
  };
}

// Incremental delta frame. Shape mirrors snapshotPayload minus the events
// array (the bandwidth-quadratic field) and plus `seq` + `event`. Both
// payload builders project from the same per-recipient filter helpers, so
// the snapshot recovery path and the delta steady-state path stay in lock-
// step on what each recipient is allowed to see.
//
// Recipient with the event entirely filtered out (e.g. opponent move-played
// in a live fog game) still gets the frame so their PlayerView can absorb
// visibility changes the hidden move caused — only the `event` field is
// omitted.
export function eventAppendedPayload(
  room: SnapshotRoom,
  client: SnapshotClient,
  event: GameEvent,
  seq: number,
) {
  const normalized = normalizeRoom(room);
  const filteredEvent = filterEventForClient(normalized, client, event);
  return {
    type: 'event-appended' as const,
    ...basePayloadFields(normalized, client),
    seq,
    ...(filteredEvent ? { event: filteredEvent } : {}),
  };
}

function normalizeRoom(room: SnapshotRoom): SnapshotRoom {
  const mode = room.mode ?? modeForProjection(room.projection);
  return room.mode === mode ? room : { ...room, mode };
}

function basePayloadFields(room: SnapshotRoom, client: SnapshotClient) {
  const mode = room.mode ?? modeForProjection(room.projection);
  return {
    roomId: room.id,
    gameSpecId: room.gameSpecId ?? room.projection.gameSpecId,
    region: room.region ?? room.projection.region ?? 'global',
    mode,
    pveEngineId: mode === 'pve' ? (room.pveEngineId ?? null) : null,
    pveEngineName: pveEngineName(room, mode),
    serverAt: Date.now(),
    clients: room.clients.size,
    seat: client.seat,
    solo: client.solo,
    seats: room.projection.seats,
    offer: offerForClient(room.projection, client),
    offers: offersForClient(room.projection, client),
    selections: selectionsForClient(room.projection, client),
    devViews: devViewsForClient(room, client),
    resolvedStartId: resolvedStartIdForClient(room.projection, client),
    resolvedStartIds: resolvedStartIdsForClient(room.projection, client),
    state: getClientView(room, client),
    rated: room.rated ?? false,
    paused: room.projection.paused,
    pauseReason: room.projection.pauseReason,
    abortDeadline: room.abortDeadline ?? null,
    forfeitDeadline: room.forfeitDeadline ?? null,
    connectedSeats: computeConnectedSeats(room.clients),
    seatDisplayNames: room.seatDisplayNames ?? {},
    seatProfiles: room.seatProfiles ?? {},
    rematch: room.rematch
      ? {
          offers: {
            white: room.rematch.offers.white !== undefined,
            black: room.rematch.offers.black !== undefined,
          },
          finalizedRoomId: room.rematch.finalizedRoomId ?? null,
        }
      : { offers: { white: false, black: false }, finalizedRoomId: null },
  };
}

function pveEngineName(room: SnapshotRoom, mode: GameAccessMode): string | null {
  if (mode !== 'pve' || !room.pveEngineId) return null;
  return engineVersionDisplayName(room.pveEngineId);
}

export function eventsForClient(room: SnapshotRoom, client: SnapshotClient): GameEvent[] {
  const out: GameEvent[] = [];
  for (const event of room.events) {
    const filtered = filterEventForClient(room, client, event);
    if (filtered) out.push(filtered);
  }
  return out;
}

// Per-recipient filter for a single event. Returns the (possibly redacted)
// event the recipient is allowed to see, or null if the event is fully
// hidden from them. This is the single source of truth shared between the
// snapshot path (via eventsForClient) and the delta path (via
// eventAppendedPayload). Any change to fog-filter or hidden-draft semantics
// must land here, not in either caller.
export function filterEventForClient(
  room: SnapshotRoom,
  client: SnapshotClient,
  event: GameEvent,
): GameEvent | null {
  if (!isEventVisibleByMode(room, client, event)) return null;
  if (!shouldRedactHiddenDraft(room.projection, client)) return event;
  const redacted = redactHiddenDraftEvent(event, room.projection, client);
  return redacted[0] ?? null;
}

function isEventVisibleByMode(
  room: SnapshotRoom,
  client: SnapshotClient,
  event: GameEvent,
): boolean {
  // A FINISHED game reveals its whole event log to everyone, players and
  // spectators alike. That is the same content /game/:id already serves to any
  // signed-out stranger, so nothing new escapes here; what changes is that a
  // shared room link now shows the game instead of a blank board.
  //
  // While the game is LIVE this is the fog stream: a seated player sees only
  // their own move-played events, which uniformly handles PvP (each player sees
  // own moves) and PvE (the human seat filters out engine moves automatically,
  // since the engine never connects as a WS client). Spectators are refused at
  // the connection layer for live fog (canObserveLiveRoom); the spectator
  // branch here is defense-in-depth for a SnapshotClient that reaches this
  // function anyway.
  if (room.projection.variant === 'dark-chess') {
    if (roomRevealsTruth(room, client)) return true;
    if (client.seat === 'spectator') return event.type !== 'move-played';
    return event.type !== 'move-played' || event.color === client.seat;
  }
  return true;
}

// The matrix decision for this room and client. `finished` is read from
// canonical projection state, never from anything client-supplied: that read is
// the one line separating a completed-game reveal from a live fog leak.
function roomRevealsTruth(room: SnapshotRoom, client: SnapshotClient): boolean {
  const spec = maybeGameSpecForId(room.projection.variant);
  if (!spec) return false;
  return (
    roomViewPolicy(
      spec.visibility,
      room.projection.state.status.type === 'finished',
      client.seat === 'spectator' ? 'spectator' : 'player',
    ) === 'truth'
  );
}

function offerForClient(projection: GameProjection, client: SnapshotClient) {
  if (!shouldRedactHiddenDraft(projection, client)) return projection.offer;
  if (client.seat === 'spectator') return [];
  return offerForColor(projection, client.seat);
}

function offersForClient(
  projection: GameProjection,
  client: SnapshotClient,
): Partial<Record<Color, GameProjection['offer']>> {
  if (!shouldRedactHiddenDraft(projection, client)) return projection.offers;
  if (client.seat === 'spectator') return {};
  return { [client.seat]: offerForColor(projection, client.seat) };
}

function selectionsForClient(
  projection: GameProjection,
  client: SnapshotClient,
): Partial<Record<Color, number>> {
  if (!shouldRedactHiddenDraft(projection, client)) return projection.selections;
  if (client.seat === 'spectator') return {};
  const selected = projection.selections[client.seat];
  return selected === undefined ? {} : { [client.seat]: selected };
}

function resolvedStartIdForClient(
  projection: GameProjection,
  client: SnapshotClient,
): number | null {
  if (!shouldRedactHiddenDraft(projection, client)) return projection.resolvedStartId;
  return null;
}

function resolvedStartIdsForClient(
  projection: GameProjection,
  client: SnapshotClient,
): Partial<Record<Color, number>> {
  if (!shouldRedactHiddenDraft(projection, client)) return projection.resolvedStartIds;
  if (client.seat === 'spectator') return {};
  const resolved = projection.resolvedStartIds[client.seat];
  return resolved === undefined ? {} : { [client.seat]: resolved };
}

function redactHiddenDraftEvent(
  event: GameEvent,
  projection: GameProjection,
  client: SnapshotClient,
): GameEvent[] {
  if (event.type === 'room-created') {
    const ownOffer = offerForClient(projection, client);
    return [
      {
        ...event,
        offer: ownOffer,
        offers: client.seat === 'spectator' ? {} : { [client.seat]: ownOffer },
      },
    ];
  }
  if (event.type === 'draft-start-selected') {
    return event.color === client.seat ? [event] : [];
  }
  if (event.type === 'draft-start-resolved') return [];
  return [event];
}

function shouldRedactHiddenDraft(projection: GameProjection, client: SnapshotClient): boolean {
  if (client.solo) return false;
  if (projection.variant !== 'dark-chess') return false;
  if (projection.state.status.type === 'finished') return false;
  return (
    projection.offer.length > 0 ||
    !!projection.offers.white?.length ||
    !!projection.offers.black?.length
  );
}

function offerForColor(projection: GameProjection, color: Color): GameProjection['offer'] {
  return projection.offers[color] ?? projection.offer;
}

function devViewsForClient(room: SnapshotRoom, client: SnapshotClient) {
  if (!client.devViews || room.projection.variant !== 'dark-chess') return null;

  const perspective = client.seat === 'black' ? 'black' : 'white';
  const opponent = perspective === 'white' ? 'black' : 'white';
  const variant = variantForId(room.projection.variant);
  const player =
    room.projection.state.status.type === 'finished'
      ? fullTruthView(room, perspective)
      : variant.getPlayerView(room.projection.state, perspective);
  const opponentView =
    room.projection.state.status.type === 'finished'
      ? fullTruthView(room, opponent)
      : variant.getPlayerView(room.projection.state, opponent);
  return {
    opponent,
    player,
    opponentView,
    truth: fullTruthView(room, perspective),
  };
}

export function getClientView(room: SnapshotRoom, client: SnapshotClient): PlayerView {
  const perspective = client.seat === 'black' ? 'black' : 'white';
  // A finished game opens fully, to players and spectators alike, so a room
  // link is worth sharing. /game/:id already serves this exact content to any
  // signed-out stranger; the room was simply refusing to.
  if (roomRevealsTruth(room, client)) return fullTruthView(room, perspective);

  // Live fog: a seated player gets their own projection and nobody else gets a
  // board. Live spectators are already refused at the connection layer
  // (canObserveLiveRoom); the empty view here is defense-in-depth for a
  // spectator SnapshotClient that reaches this function anyway.
  if (room.projection.variant === 'dark-chess' && client.seat === 'spectator') {
    return emptyFogView(room, perspective);
  }

  const variant = variantForId(room.projection.variant);
  const view = variant.getPlayerView(room.projection.state, perspective);
  if (!client.solo || room.projection.state.status.type !== 'playing') return view;
  return {
    ...view,
    legalMoves: variant.getLegalMoves(room.projection.state, room.projection.state.status.turn),
  };
}

function emptyFogView(room: SnapshotRoom, perspective: Color): PlayerView {
  return {
    id: room.projection.state.id,
    variant: room.projection.state.variant,
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: room.projection.state.status,
    perspective,
    moveNumber: room.projection.state.moveNumber,
    clock: room.projection.state.clock,
  };
}

export function fullTruthView(room: SnapshotRoom, perspective: Color): PlayerView {
  return {
    id: room.projection.state.id,
    variant: room.projection.state.variant,
    board: room.projection.state.board,
    visibleSquares: allSquares,
    legalMoves: [],
    status: room.projection.state.status,
    perspective,
    moveNumber: room.projection.state.moveNumber,
    lastMove: room.projection.state.lastMove,
    clock: room.projection.state.clock,
  };
}
