import {
  type Color,
  capturedRoleFor,
  clockRemainingMs,
  createClock,
  expireClock,
  freezeClock,
  type GameEvent,
  isGameEndReason,
  type Move,
  nextClockForMove,
  type PieceRole,
  replayGameEvents,
  type Square,
  unfreezeClock,
  variantForId,
} from '@mistboard/game';
import { sendEngineAlertNotification } from './engine-alert-email.js';
import { engineFailureAbort } from './engine-failure-abort.js';
import { engineVersionDisplayName, loadEngine } from './engine-registry.js';
import {
  firstPartyBotForEngine,
  firstPartyBotForId,
  type LiveSeatProfile,
  liveSeatProfileIdentity,
} from './first-party-bots.js';
import { ABORT_WINDOW_MS, FORFEIT_WINDOW_MS, JOIN_WINDOW_MS } from './lifecycle-windows.js';
import {
  chooseLiveEngineMove,
  type LiveEngineFallbackEvent,
  liveEngineComputeBudgetMs,
} from './live-engine.js';
import { engineCounters, logger } from './obs.js';
import { computeConnectedSeats, eventAppendedPayload, snapshotPayload } from './payloads.js';
import type { GameSummary } from './persistence.js';
import * as persistence from './persistence.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './persistence-game-lifecycle.js';
import { recordRoomLifecycleAuditSafe } from './room-lifecycle-audit.js';
import { isServerEngineClient, modeForProjection } from './server-policy.js';
import type { Client, Room, SeatTokenState } from './server-types.js';

// Re-exported for back-compat: these moved to lifecycle-windows.ts, but
// room-manager.test.ts and historical importers still resolve them from here.
export { ABORT_WINDOW_MS, FORFEIT_WINDOW_MS } from './lifecycle-windows.js';

export interface RoomManagerContext {
  send: (client: Client, payload: unknown) => void;
  recordPersistenceError: (roomId: string, seq: number, event: GameEvent, err: Error) => void;
  pveBuiltinEngineClientId: string;
  pveEngineMoveDelayMs: number;
  liveEngineTimeoutMs: number;
  liveClockInitialMs: number;
  liveClockIncrementMs: number;
  releaseLiveEngineReservation?: (reservationId: string, reason: string) => void;
}

export class PersistenceFailure extends Error {
  constructor() {
    super('persistence_failure');
    this.name = 'PersistenceFailure';
  }
}

// ── Pure helpers ───────────────────────────────────────────────────────────

export function roomIdToSeed(roomId: string): number {
  let hash = 0;
  for (const char of roomId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return hash;
}

export function canClientAct(room: Room, client: Client): boolean {
  if (client.solo) return true;
  if (client.displaced) return false;
  if (client.seat === 'spectator') return false;
  if (isServerEngineClient(client.id)) return room.projection.seats[client.seat] === client.id;
  const token = room.seatTokens[client.seat];
  return token !== undefined && token.tokenHash === client.seatTokenHash;
}

function isPromotionRole(value: string | undefined): value is Exclude<PieceRole, 'king' | 'pawn'> {
  return value === 'queen' || value === 'rook' || value === 'bishop' || value === 'knight';
}

function liveEngineMoveSeed(room: Room): bigint {
  const ply = room.events.filter((event) => event.type === 'move-played').length;
  return (BigInt(roomIdToSeed(room.id) >>> 0) << 16n) + BigInt(ply);
}

async function sleepEngineThinkTime(
  startedAt: number,
  thinkTimeMs: number | undefined,
): Promise<void> {
  if (thinkTimeMs === undefined) return;
  const remainingMs = Math.max(0, Math.round(thinkTimeMs) - (Date.now() - startedAt));
  if (remainingMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, remainingMs));
}

export function clearRandomEngineTimer(room: Room): void {
  if (!room.engineTimer) return;
  clearTimeout(room.engineTimer);
  room.engineTimer = null;
}

/**
 * Returns the seat the engine plays for a PvE room ('white' or 'black'),
 * or null if not a PvE room or the engine seat isn't set in the projection yet.
 * Reads from the projection (populated by the seat-assigned event), so it
 * correctly reflects engineColor='white' rooms.
 */
export function engineSeatFor(room: Room): Color | null {
  if (!room.pveEngineId) return null;
  if (room.projection.seats.white === room.pveEngineId) return 'white';
  if (room.projection.seats.black === room.pveEngineId) return 'black';
  return null;
}

function bothSeatsAssigned(room: Room): boolean {
  return Boolean(room.projection.seats.white && room.projection.seats.black);
}

// ── Seat token helpers ─────────────────────────────────────────────────────

function persistenceRecordForSeatToken(token: SeatTokenState): persistence.RoomSeatTokenRecord {
  return {
    seat: token.seat,
    clientId: token.clientId,
    deviceId: token.deviceId ?? null,
    tokenHash: token.tokenHash,
    userId: token.userId,
    userHandle: token.userHandle,
    userDisplayName: token.userDisplayName,
    issuedAt: token.issuedAt,
    lastSeenAt: token.lastSeenAt,
    revokedAt: token.revokedAt,
  };
}

function recordSeatTokenPersistenceError(roomId: string, seat: Color | null, err: Error): void {
  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'seat_token_persistence_failure',
      roomId,
      seat,
      error: err.message,
      at: Date.now(),
    }),
  );
}

export function seatTokenStatesFromPersistence(
  tokens: Partial<Record<Color, persistence.RoomSeatTokenRecord>>,
): Partial<Record<Color, SeatTokenState>> {
  const states: Partial<Record<Color, SeatTokenState>> = {};
  for (const token of Object.values(tokens)) {
    if (!token || token.revokedAt) continue;
    states[token.seat] = {
      clientId: token.clientId,
      deviceId: token.deviceId ?? null,
      seat: token.seat,
      tokenHash: token.tokenHash,
      userId: token.userId,
      userHandle: token.userHandle,
      userDisplayName: token.userDisplayName,
      issuedAt: token.issuedAt,
      lastSeenAt: token.lastSeenAt,
      revokedAt: token.revokedAt,
    };
  }
  return states;
}

export async function persistSeatToken(
  _ctx: RoomManagerContext,
  room: Room,
  token: SeatTokenState,
): Promise<void> {
  if (!persistence.isInitialized()) return;
  try {
    await persistence.upsertRoomSeatToken(room.id, persistenceRecordForSeatToken(token));
  } catch (err) {
    recordSeatTokenPersistenceError(room.id, token.seat, err as Error);
    throw new PersistenceFailure();
  }
}

export async function touchSeatToken(
  _ctx: RoomManagerContext,
  room: Room,
  token: SeatTokenState,
): Promise<void> {
  if (!persistence.isInitialized()) return;
  try {
    await persistence.touchRoomSeatToken(room.id, token.seat, token.tokenHash, token.lastSeenAt);
  } catch (err) {
    recordSeatTokenPersistenceError(room.id, token.seat, err as Error);
    throw new PersistenceFailure();
  }
}

export async function replaceSeatTokens(
  _ctx: RoomManagerContext,
  room: Room,
  seatTokens: Partial<Record<Color, SeatTokenState>>,
): Promise<void> {
  if (!persistence.isInitialized()) return;
  try {
    const tokens: Partial<Record<Color, persistence.RoomSeatTokenRecord>> = {};
    for (const token of Object.values(seatTokens)) {
      if (token) tokens[token.seat] = persistenceRecordForSeatToken(token);
    }
    await persistence.replaceRoomSeatTokens(room.id, tokens);
  } catch (err) {
    recordSeatTokenPersistenceError(room.id, null, err as Error);
    throw new PersistenceFailure();
  }
}

export function reconciledSeatTokens(room: Room): Partial<Record<Color, SeatTokenState>> {
  const tokenByClientId = new Map<string, SeatTokenState>();
  for (const token of Object.values(room.seatTokens)) {
    if (token) tokenByClientId.set(token.clientId, token);
  }

  const nextTokens: Partial<Record<Color, SeatTokenState>> = {};
  for (const seat of ['white', 'black'] as const) {
    const clientId = room.projection.seats[seat];
    if (!clientId) continue;
    const token = tokenByClientId.get(clientId);
    if (!token) continue;
    nextTokens[seat] = { ...token, seat };
  }
  return nextTokens;
}

export async function reconcileClientSeats(ctx: RoomManagerContext, room: Room): Promise<void> {
  const nextTokens = reconciledSeatTokens(room);
  await replaceSeatTokens(ctx, room, nextTokens);
  room.seatTokens = nextTokens;
  for (const client of room.clients) {
    if (room.projection.seats.white === client.id) client.seat = 'white';
    if (room.projection.seats.black === client.id) client.seat = 'black';
  }
}

// ── Game summary ───────────────────────────────────────────────────────────

function inMemoryParticipant(
  color: Color,
  clientId: string | null,
  displayName: string | null,
  mode: persistence.GameMode,
  visibility: persistence.GameVisibility,
  pveBuiltinEngineClientId: string,
  botId: string | null,
): persistence.GameParticipant {
  if (clientId && isServerEngineClient(clientId)) {
    const engineVersionId = clientId === 'random-engine' ? pveBuiltinEngineClientId : clientId;
    if (botId) {
      const bot = firstPartyBotForId(botId);
      return {
        color,
        displayName: displayName ?? bot?.displayName ?? engineVersionDisplayName(engineVersionId),
        subjectType: 'bot',
        // Canonicalize: a room created against a pre-consolidation bot id
        // still attributes its game to the merged identity.
        subjectId: bot?.id ?? botId,
        visibility,
      };
    }
    const bot = firstPartyBotForEngine(engineVersionId);
    if (bot) {
      return {
        color,
        displayName: displayName ?? bot.displayName,
        subjectType: 'bot',
        subjectId: bot.id,
        visibility,
      };
    }
    return {
      color,
      displayName: displayName ?? engineVersionDisplayName(engineVersionId),
      subjectType: 'engine-version',
      subjectId: engineVersionId,
      visibility,
    };
  }
  if (mode === 'imported' || mode === 'manual') {
    return {
      color,
      displayName: displayName ?? (color === 'white' ? 'White' : 'Black'),
      subjectType: mode,
      subjectId: null,
      visibility,
    };
  }
  return {
    color,
    displayName: displayName ?? 'Guest',
    subjectType: 'guest',
    subjectId: null,
    visibility,
  };
}

function participantForSeatToken(
  color: Color,
  clientId: string | null,
  token: SeatTokenState | undefined,
  mode: persistence.GameMode,
  pveBuiltinEngineClientId: string,
  botId: string | null,
): persistence.GameParticipant {
  if (token?.userId) {
    return {
      color,
      displayName: token.userDisplayName ?? token.userHandle ?? 'Player',
      subjectType: 'user',
      subjectId: token.userId,
      visibility: 'public',
    };
  }
  const participant = inMemoryParticipant(
    color,
    clientId,
    null,
    mode,
    'public',
    pveBuiltinEngineClientId,
    botId,
  );
  // A guest seat carries the browser's device id (migration 137) so the
  // aggregate player counts can tell one visitor's games from another's.
  if (participant.subjectType === 'guest' && token?.deviceId) {
    return { ...participant, subjectId: token.deviceId };
  }
  return participant;
}

export function buildGameSummary(ctx: RoomManagerContext, room: Room): GameSummary {
  const status = room.projection.state.status;
  if (status.type !== 'finished') {
    throw new Error('buildGameSummary called on non-terminal state');
  }
  const result: GameSummary['result'] =
    status.winner === 'white' ? 'white-wins' : status.winner === 'black' ? 'black-wins' : 'draw';

  if (!isGameEndReason(status.reason)) {
    throw new Error(`unknown finished-game reason: ${String(status.reason)}`);
  }
  const termination: GameSummary['termination'] = status.reason;

  const moveEvents = room.events.filter((e) => e.type === 'move-played');
  const firstAt = room.events[0]?.at ?? Date.now();
  const lastAt = room.events[room.events.length - 1]?.at ?? Date.now();

  const participants = [
    participantForSeatToken(
      'white',
      room.projection.seats.white ?? null,
      room.seatTokens.white,
      room.mode,
      ctx.pveBuiltinEngineClientId,
      room.pveBotId,
    ),
    participantForSeatToken(
      'black',
      room.projection.seats.black ?? null,
      room.seatTokens.black,
      room.mode,
      ctx.pveBuiltinEngineClientId,
      room.pveBotId,
    ),
  ];
  // Rated play is human-vs-human between two signed-in accounts. A guest seat or
  // an engine seat forces casual — rating integrity requires durable identity
  // (you can't rate, or hold accountable, an anonymous token). This is the
  // authoritative gate: regardless of what room.rated was requested as, a game
  // only counts as rated if both seats resolved to real users.
  const rated = room.rated && participants.every((p) => p.subjectType === 'user');

  return {
    variant: room.projection.variant,
    mode: room.mode,
    result,
    termination,
    plyCount: moveEvents.length,
    startedAt: new Date(firstAt),
    endedAt: new Date(lastAt),
    whiteClient: room.projection.seats.white ?? null,
    blackClient: room.projection.seats.black ?? null,
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated,
    region: room.region ?? room.projection.region ?? 'global',
    initialMs: room.timeControl?.initialMs ?? null,
    incrementMs: room.timeControl?.incrementMs ?? null,
    participants,
    // An engine cannot abandon: record the failure, not a win for the human.
    // This is the live fog-chess path (dark-chess rides the legacy shell).
    abortedAs: engineFailureAbort({
      engineSeat: engineSeatFor(room),
      winner: status.winner,
      reason: status.reason,
    }),
  };
}

// ── Room event infrastructure ──────────────────────────────────────────────

export function seatDisplayNamesForRoom(
  room: Room,
  ctx: RoomManagerContext,
): Partial<Record<Color, string>> {
  const names: Partial<Record<Color, string>> = {};
  for (const color of ['white', 'black'] as Color[]) {
    const clientId = room.projection.seats[color];
    if (!clientId) continue;
    if (isServerEngineClient(clientId)) {
      const engineId = clientId === 'random-engine' ? ctx.pveBuiltinEngineClientId : clientId;
      names[color] = engineSeatDisplayName(engineId);
    } else {
      const token = room.seatTokens[color as Color];
      const name = token?.userDisplayName ?? token?.userHandle ?? null;
      if (name) names[color] = name;
    }
  }
  return names;
}

// Linkable profile identity per seat, the companion to seatDisplayNamesForRoom:
// same seats, same resolution order, so the name a client renders and the page it
// links to can never come from different seats. Absent for a seat with no public
// page (a guest, or a raw engine version with no bot in front of it).
export function seatProfilesForRoom(
  room: Room,
  ctx: RoomManagerContext,
): Partial<Record<Color, LiveSeatProfile>> {
  const profiles: Partial<Record<Color, LiveSeatProfile>> = {};
  for (const color of ['white', 'black'] as Color[]) {
    const clientId = room.projection.seats[color];
    if (!clientId) continue;
    const engineId = isServerEngineClient(clientId)
      ? clientId === 'random-engine'
        ? ctx.pveBuiltinEngineClientId
        : clientId
      : null;
    const profile = liveSeatProfileIdentity(engineId, room.seatTokens[color]?.userHandle ?? null);
    if (profile.handle || profile.botId) profiles[color] = profile;
  }
  return profiles;
}

function engineSeatDisplayName(engineId: string): string {
  try {
    return loadEngine(engineId).engineName;
  } catch {
    return engineVersionDisplayName(engineId);
  }
}

export function broadcastSnapshot(ctx: RoomManagerContext, room: Room): void {
  const seatDisplayNames = seatDisplayNamesForRoom(room, ctx);
  const seatProfiles = seatProfilesForRoom(room, ctx);
  for (const client of room.clients) {
    ctx.send(client, snapshotPayload({ ...room, seatDisplayNames, seatProfiles }, client));
  }
}

// Broadcast a paired-with-appendEvent state change. Sends one event-
// appended frame per newly-appended event in [fromSeq, room.events.length)
// to every connected client. Callers record fromSeq before any appendEvent
// calls; the range catches multi-event flows without requiring helpers to
// thread seq through their signatures.
//
// Game-end transition (status flips to 'finished') falls back to a full
// snapshot for every recipient: a clean final-frame resync at the game
// boundary. Under model A the room stays fogged on finish (no reveal — the
// per-seat filter in payloads.ts applies at every status), so this snapshot
// is a robustness resync, not a reveal channel. The public reveal lives only
// at the /game/:id replay endpoint.
export function broadcastEventAppended(ctx: RoomManagerContext, room: Room, fromSeq: number): void {
  const seatDisplayNames = seatDisplayNamesForRoom(room, ctx);
  const enrichedRoom = { ...room, seatDisplayNames, seatProfiles: seatProfilesForRoom(room, ctx) };
  const statusType = room.projection.state.status.type;
  const isGameEnd = statusType === 'finished' || statusType === 'aborted';
  for (const client of room.clients) {
    if (isGameEnd) {
      ctx.send(client, snapshotPayload(enrichedRoom, client));
      continue;
    }
    for (let seq = fromSeq; seq < room.events.length; seq += 1) {
      const event = room.events[seq];
      if (!event) continue;
      ctx.send(client, eventAppendedPayload(enrichedRoom, client, event, seq));
    }
  }
}

export async function appendEvent(
  ctx: RoomManagerContext,
  room: Room,
  event: GameEvent,
): Promise<void> {
  // Serialize per-room writes. Chaining onto pendingWrites guarantees
  // sequence assignment is atomic with the persistence write.
  const myWrite = room.pendingWrites.then(async () => {
    const seq = room.events.length;
    if (persistence.isInitialized()) {
      try {
        await persistence.appendEvent(room.id, seq, event);
      } catch (err) {
        ctx.recordPersistenceError(room.id, seq, event, err as Error);
        throw new PersistenceFailure();
      }
    }
    room.events.push(event);
    room.projection = replayGameEvents(room.events);
    room.mode = modeForProjection(room.projection);
    if (room.engineReservationId && room.projection.state.status.type !== 'playing') {
      const reason = room.projection.state.status.type;
      ctx.releaseLiveEngineReservation?.(room.engineReservationId, reason);
      room.engineReservationId = null;
    }
    scheduleClockTimeout(ctx, room);
    scheduleAbortTimeout(ctx, room);
    scheduleForfeitTimeout(ctx, room);
    {
      const engineSeat = engineSeatFor(room);
      if (
        room.projection.state.status.type !== 'playing' ||
        engineSeat === null ||
        room.projection.state.status.turn !== engineSeat
      ) {
        clearRandomEngineTimer(room);
      }
    }

    if (
      persistence.isInitialized() &&
      room.projection.state.status.type === 'finished' &&
      !room.gameEndRecorded
    ) {
      room.gameEndRecorded = true;
      try {
        await persistence.recordGameEnd(room.id, buildGameSummary(ctx, room));
      } catch (err) {
        // Events are durable; the games-row aggregate can be backfilled.
        // Log loudly so it's visible.
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'game_end_record_failure',
            roomId: room.id,
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
      }
    }

    // Pre-move abort: flip the games row to status='aborted' (no result). The
    // precise reason lives in aborted_reason; termination reuses 'abandoned'
    // (the canonical no-result terminal already in the DB constraint). Aborted
    // games are excluded from every history/recent query (all filter
    // status='completed'), so this never surfaces in profiles or feeds.
    if (
      persistence.isInitialized() &&
      room.projection.state.status.type === 'aborted' &&
      !room.gameEndRecorded
    ) {
      room.gameEndRecorded = true;
      const reason = room.projection.state.status.reason;
      try {
        await persistence.abortRunningGame(room.id, {
          termination: 'abandoned',
          abortedReason: reason,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'game_abort_record_failure',
            roomId: room.id,
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
      }
    }
  });
  // Don't break the chain if this write rejects — caller surfaces the error.
  room.pendingWrites = myWrite.catch(() => {});
  await myWrite;
}

export function scheduleClockTimeout(ctx: RoomManagerContext, room: Room): void {
  if (room.clockTimer) clearTimeout(room.clockTimer);
  room.clockTimer = null;

  const { clock, status } = room.projection.state;
  if (!clock || status.type !== 'playing' || !clock.activeColor) return;

  const activeColor = clock.activeColor;
  const delay = clockRemainingMs(clock, activeColor, Date.now());
  room.clockTimer = setTimeout(() => {
    if (room.projection.state.status.type !== 'playing') return;
    if (room.projection.paused) return;
    if (room.projection.state.status.turn !== activeColor) return;
    const fromSeq = room.events.length;
    void expireActiveClock(ctx, room, activeColor, Date.now())
      .then(() => broadcastEventAppended(ctx, room, fromSeq))
      .catch((err) => {
        if (!(err instanceof PersistenceFailure)) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'clock_expire_failure',
              roomId: room.id,
              error: (err as Error).message,
              at: Date.now(),
            }),
          );
        }
      });
  }, delay + 25);
  room.clockTimer.unref();
}

export async function expireActiveClock(
  ctx: RoomManagerContext,
  room: Room,
  color: Color,
  at: number,
): Promise<void> {
  const clock = expireClock(room.projection.state.clock, at, color);
  if (!clock) return;
  await appendEvent(ctx, room, {
    type: 'clock-expired',
    at,
    roomId: room.id,
    color,
    clock,
  });
}

// Which pre-move abort window (if any) is live for this room. Returns null once
// both players have completed their first move (moveNumber >= 2), or when not
// playing. The clock is frozen throughout this phase, so this timer is the only
// thing that resolves a game where a player never moves.
//
// 'unjoined' = a seat is still open, so nobody owes a move yet. It carries its
// own, much longer window (JOIN_WINDOW_MS): waiting for a friend to click an
// invite link is normal. Without it a Fog Chess invite link nobody joined was
// claimed by NOTHING — the room has no clock until startLiveClockIfReady fires
// (which needs both seats), so the untimed-room guard below skipped it, the
// clock timer had no armed clock, and the forfeit timer needs moveNumber >= 2.
// It sat in `playing` until the process restarted. See
// variant-tenant/reaper-coverage.test.ts for the same gap on the tenant stack.
function abortPhaseFor(room: Room): 'white-1' | 'black-1' | 'unjoined' | null {
  const state = room.projection.state;
  if (state.status.type !== 'playing') return null;
  if (state.moveNumber >= 2) return null;
  if (!room.projection.seats.white || !room.projection.seats.black) return 'unjoined';
  return state.lastMove === undefined ? 'white-1' : 'black-1';
}

// Is anyone actually sitting in this room right now? Tells "waiting for an
// opponent" apart from "abandoned", which are identical in the projection.
function someSeatConnected(room: Room): boolean {
  const connected = computeConnectedSeats(room.clients);
  return connected.white || connected.black;
}

export function clearAbortTimer(room: Room): void {
  if (room.abortTimer) clearTimeout(room.abortTimer);
  room.abortTimer = null;
}

export function scheduleAbortTimeout(ctx: RoomManagerContext, room: Room): void {
  clearAbortTimer(room);
  const phase = abortPhaseFor(room);
  // No window once both first moves are in, or while paused. An untimed room
  // gets no PRE-MOVE window either (no clock → no pre-move timing pressure),
  // but 'unjoined' is exempt from that: those rooms have no clock yet by
  // construction, and skipping them is what leaked them.
  const untimedAndOwesAMove = phase !== 'unjoined' && !room.projection.state.clock;
  // Somebody is sitting in the room with the page open, waiting for an
  // opponent. Never abort under them, however long they wait — the leak being
  // closed is the room nobody is in.
  const stillWaitingWithSomeonePresent = phase === 'unjoined' && someSeatConnected(room);
  if (
    phase === null ||
    room.projection.paused ||
    untimedAndOwesAMove ||
    stillWaitingWithSomeonePresent
  ) {
    room.abortDeadline = null;
    room.abortPhase = null;
    return;
  }
  // Only (re)start the deadline when the phase changes. Re-broadcasts and
  // reconnects re-run this, but must not extend a window already counting down;
  // white completing move 1 flips the phase and starts black a fresh window,
  // and a seat filling flips 'unjoined' so the long join window collapses to
  // the short pregame one instead of continuing to run.
  if (room.abortPhase !== phase || room.abortDeadline === null) {
    room.abortPhase = phase;
    room.abortDeadline = Date.now() + (phase === 'unjoined' ? JOIN_WINDOW_MS : ABORT_WINDOW_MS);
  }
  const delay = Math.max(0, room.abortDeadline - Date.now());
  room.abortTimer = setTimeout(() => {
    const currentPhase = abortPhaseFor(room);
    if (currentPhase === null) return;
    if (room.projection.paused) return;
    // Re-check presence at fire time, not just at schedule time: a player can
    // reclaim a seat via seat token without appending an event, so the
    // scheduler does not always re-run on reconnect.
    if (currentPhase === 'unjoined' && someSeatConnected(room)) return;
    const fromSeq = room.events.length;
    void appendEvent(ctx, room, {
      type: 'game-aborted',
      at: Date.now(),
      roomId: room.id,
      reason: 'pregame-timeout',
    })
      .then(() => broadcastEventAppended(ctx, room, fromSeq))
      .catch((err) => {
        if (!(err instanceof PersistenceFailure)) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'abort_window_failure',
              roomId: room.id,
              error: (err as Error).message,
              at: Date.now(),
            }),
          );
        }
      });
  }, delay + 25);
  room.abortTimer.unref();
}

export function clearForfeitTimer(room: Room): void {
  if (room.forfeitTimer) clearTimeout(room.forfeitTimer);
  room.forfeitTimer = null;
}

// The seat that should be forfeiting right now, or null if no forfeit applies.
// A forfeit runs only when exactly one side is absent (the other is present to
// be awarded the win). The engine seat counts as always-present (it lives
// server-side and never holds a WS client), so a PvE human disconnect forfeits
// to the engine, and the engine itself never forfeits. Both-absent → null (no
// one to award), both-present → null (nobody left).
function forfeitingSeat(room: Room): Color | null {
  const { status, moveNumber } = room.projection.state;
  if (status.type !== 'playing' || moveNumber < 2 || room.projection.paused) return null;
  const engineSeat = engineSeatFor(room);
  const connected = computeConnectedSeats(room.clients);
  const present = (seat: Color): boolean => seat === engineSeat || connected[seat];
  const whitePresent = present('white');
  const blackPresent = present('black');
  if (whitePresent && !blackPresent) return 'black';
  if (!whitePresent && blackPresent) return 'white';
  return null;
}

// Re-derive the leaver-forfeit countdown from current seat presence + game
// state. Called on every connect, disconnect, and state change. Idempotent: the
// 30s deadline only (re)starts when the forfeiting seat changes, so a transient
// reconnect-then-redrop doesn't grant a fresh window. The clock keeps running
// independently during a disconnect, so flagging still works in parallel.
export function scheduleForfeitTimeout(ctx: RoomManagerContext, room: Room): void {
  clearForfeitTimer(room);
  const seat = forfeitingSeat(room);
  if (seat === null) {
    room.forfeitSeat = null;
    room.forfeitDeadline = null;
    return;
  }
  if (room.forfeitSeat !== seat || room.forfeitDeadline === null) {
    room.forfeitSeat = seat;
    room.forfeitDeadline = Date.now() + FORFEIT_WINDOW_MS;
  }
  const delay = Math.max(0, room.forfeitDeadline - Date.now());
  room.forfeitTimer = setTimeout(() => {
    if (forfeitingSeat(room) !== seat) return;
    const fromSeq = room.events.length;
    void appendEvent(ctx, room, {
      type: 'seat-forfeited',
      at: Date.now(),
      roomId: room.id,
      color: seat,
    })
      .then(() => broadcastEventAppended(ctx, room, fromSeq))
      .catch((err) => {
        if (!(err instanceof PersistenceFailure)) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'forfeit_window_failure',
              roomId: room.id,
              error: (err as Error).message,
              at: Date.now(),
            }),
          );
        }
      });
  }, delay + 25);
  room.forfeitTimer.unref();
}

// On hydrating a room post-restart, detect the case where a SIGKILL (or a
// crash before pauseRoomOnShutdown wrote its event) left an in-flight game
// stranded. Returns a possibly-extended events array — if the input ended
// mid-game with a stale last-event, a synthetic 'pause' is appended at
// lastEvent.at + 1 so the clock is frozen at the pre-crash moment (no
// outage-time charged to either player). Otherwise returns the input.
//
// The threshold guards against false positives: a player thinking deeply for
// 30 seconds shouldn't trigger recovery, but a 5-minute gap (longer than any
// realistic bullet/blitz move) almost certainly means the server died.
//
// Pure function — does not touch persistence. Callers persist the returned
// extra event before replaying state.
export function applyOrphanRecoveryIfNeeded(
  events: GameEvent[],
  now: number,
  orphanThresholdMs: number,
): GameEvent[] {
  if (events.length === 0) return events;
  const projection = replayGameEvents(events);
  if (projection.state.status.type !== 'playing') return events;
  if (projection.paused) return events;
  const lastEvent = events[events.length - 1]!;
  if (now - lastEvent.at < orphanThresholdMs) return events;
  // Synth a pause at lastEvent.at + 1. Clock freeze sees only 1ms elapsed
  // since the previous move, which is a rounding-error cost — far better than
  // attributing the entire outage to the active player.
  const pauseAt = lastEvent.at + 1;
  const frozenClock = freezeClock(projection.state.clock, pauseAt);
  const syntheticPause: GameEvent = {
    type: 'pause',
    at: pauseAt,
    roomId: lastEvent.roomId,
    reason: 'shutdown',
    ...(frozenClock ? { clock: frozenClock } : {}),
  };
  return [...events, syntheticPause];
}

// Pause a running room before server shutdown. No-op if not playing or
// already paused. The pause snapshot freezes the active clock so wall-clock
// time during the outage doesn't count against either player.
export async function pauseRoomOnShutdown(
  ctx: RoomManagerContext,
  room: Room,
  at: number,
): Promise<void> {
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.paused) return;
  const eventSeq = room.events.length;
  const turn = room.projection.state.status.turn;
  const moveNumber = room.projection.state.moveNumber;
  const frozenClock = freezeClock(room.projection.state.clock, at);
  await appendEvent(ctx, room, {
    type: 'pause',
    at,
    roomId: room.id,
    reason: 'shutdown',
    ...(frozenClock ? { clock: frozenClock } : {}),
  });
  await recordRoomLifecycleAuditSafe({
    roomId: room.id,
    kind: 'pause_on_shutdown',
    atMs: at,
    eventSeq,
    payload: {
      mode: room.mode,
      turn,
      moveNumber,
      clockFrozen: frozenClock !== undefined,
    },
  });
}

export async function forfeitEngineOnFailure(
  ctx: RoomManagerContext,
  room: Room,
  at: number,
  reason?: string,
): Promise<void> {
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.paused) return;
  const engineSeat = engineSeatFor(room);
  if (engineSeat === null) return;
  if (room.projection.state.status.turn !== engineSeat) return;
  const frozenClock = freezeClock(room.projection.state.clock, at);
  await appendEvent(ctx, room, {
    type: 'seat-forfeited',
    at,
    roomId: room.id,
    color: engineSeat,
    ...(frozenClock ? { clock: frozenClock } : {}),
  });
  // An engine losing its seat is a page, not a stat: the 12c8ff99 forfeit was
  // reconstructible only via a replay rig because nothing here said WHY. The
  // cause stays out of the seat-forfeited event (schema untouched); it lives
  // in this log line + alert, joined to the event by room_id/at.
  logger.error(
    {
      kind: 'engine_seat_forfeited',
      room_id: room.id,
      color: engineSeat,
      engine_id: room.pveEngineId ?? null,
      reason: reason ?? null,
      at,
    },
    'engine seat forfeited',
  );
  void sendEngineAlertNotification({
    severity: 'critical',
    alert_kind: 'engine_seat_forfeited',
    variant: room.projection.variant,
    room_id: room.id,
    color: engineSeat,
    engine_id: room.pveEngineId ?? undefined,
    reason: reason ?? undefined,
  }).catch(() => {});
}

// Append a resume event for a paused room. Clears the pauseGraceTimer if set.
// Caller broadcasts the resulting snapshot.
export async function resumeRoom(
  ctx: RoomManagerContext,
  room: Room,
  at: number,
  reason: 'both-present' | 'grace-elapsed' | 'admin',
): Promise<void> {
  if (!room.projection.paused) return;
  if (room.projection.state.status.type !== 'playing') return;
  const eventSeq = room.events.length;
  const pausedAtMs = room.projection.pausedAt;
  const pauseReason = room.projection.pauseReason;
  const turn = room.projection.state.status.turn;
  const newClock = unfreezeClock(room.projection.state.clock, at, turn);
  await appendEvent(ctx, room, {
    type: 'resume',
    at,
    roomId: room.id,
    reason,
    ...(newClock ? { clock: newClock } : {}),
  });
  await recordRoomLifecycleAuditSafe({
    roomId: room.id,
    kind: 'resume',
    atMs: at,
    eventSeq,
    payload: {
      mode: room.mode,
      reason,
      pauseReason,
      pausedAtMs,
      pausedDurationMs: pausedAtMs === null ? null : at - pausedAtMs,
      turn,
      clockResumed: newClock !== undefined,
    },
  });
  if (room.pauseGraceTimer) {
    clearTimeout(room.pauseGraceTimer);
    room.pauseGraceTimer = null;
  }
}

// Fire resume if the room is paused AND every seat is "present." Returns true
// if resume was appended.
//
// Presence rules:
// - Engine seats (isServerEngineClient) are always present while the server is
//   up. Engines are server-controlled — there's no reconnect to wait for.
// - Human seats are present only when a non-displaced client occupies that
//   seat with a matching seat-token hash. The token is the auth boundary; an
//   attacker without the token cannot force-resume by connecting.
//
// Implications by mode:
// - PvP: needs both human seats to have valid tokens — same as before.
// - PvE: resumes the moment the human reconnects (engine is auto-present).
// - EvE: resumes on the first connection of any kind (both engines auto-present).
export async function resumeRoomIfReady(
  ctx: RoomManagerContext,
  room: Room,
  at: number,
): Promise<boolean> {
  if (!room.projection.paused) return false;
  if (room.projection.state.status.type !== 'playing') return false;
  if (room.projection.pauseReason === 'engine-error') return false;
  if (!room.projection.seats.white || !room.projection.seats.black) return false;

  const seatPresent = (color: Color): boolean => {
    if (isServerEngineClient(room.projection.seats[color])) return true;
    for (const client of room.clients) {
      if (client.displaced) continue;
      if (client.seat !== color) continue;
      const expected = room.seatTokens[color]?.tokenHash;
      if (!expected || !client.seatTokenHash || client.seatTokenHash !== expected) continue;
      return true;
    }
    return false;
  };

  if (!seatPresent('white') || !seatPresent('black')) return false;
  await resumeRoom(ctx, room, at, 'both-present');
  return true;
}

// ── Game flow ──────────────────────────────────────────────────────────────

export async function startLiveClockIfReady(ctx: RoomManagerContext, room: Room): Promise<void> {
  if (room.projection.variant !== 'dark-chess') return;
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.state.clock) return;
  if (!room.projection.seats.white || !room.projection.seats.black) return;

  const now = Date.now();
  const timeControl = room.projection.timeControl;
  // The clock starts frozen and arms only once both players complete their
  // first move (see armClockOnFirstMoves in the reducer). In engineColor='white'
  // PvE, this is also the first point where the human black seat exists, so the
  // engine opening move is scheduled after the player can receive the room
  // snapshot instead of racing the page navigation.
  const initialClock = timeControl
    ? createClock(now, timeControl.initialMs, timeControl.incrementMs)
    : createClock(now, ctx.liveClockInitialMs, ctx.liveClockIncrementMs);
  await appendEvent(ctx, room, {
    type: 'clock-started',
    at: now,
    roomId: room.id,
    clock: initialClock,
  });
  // If the game starts with the engine to move (PvE with engineColor='white'),
  // there's otherwise no trigger to kick off the engine's first move — the
  // normal trigger fires after a human plays (line 699 of this file).
  scheduleRandomEngineMove(ctx, room);
}

type ClientMoveMessage = {
  type: 'move';
  from: string;
  to: string;
  promotion?: string;
};

export async function playMove(
  ctx: RoomManagerContext,
  room: Room,
  client: Client,
  move: ClientMoveMessage,
): Promise<void> {
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.paused) return;
  const now = Date.now();
  const moveColor = room.projection.state.status.turn;
  if (!canClientAct(room, client)) return;
  if (!client.solo && (client.seat === 'spectator' || moveColor !== client.seat)) return;
  // Defense-in-depth: no moves until BOTH seats are filled. A freshly created
  // room starts in `playing`, so without this a seated player could move before
  // the opponent (or engine) joined. PvE/EvE pass (the engine holds a real
  // seat); solo (controls both sides) bypasses, as it does the seat/turn check.
  if (!client.solo && !bothSeatsAssigned(room)) return;
  if (
    room.projection.state.clock &&
    clockRemainingMs(room.projection.state.clock, moveColor, now) <= 0
  ) {
    const fromSeq = room.events.length;
    await expireActiveClock(ctx, room, moveColor, now);
    broadcastEventAppended(ctx, room, fromSeq);
    return;
  }

  const requestedMove: Move = {
    from: move.from as Square,
    to: move.to as Square,
    promotion: isPromotionRole(move.promotion) ? move.promotion : undefined,
  };
  const nextState = variantForId(room.projection.variant).applyMove(
    room.projection.state,
    requestedMove,
  );
  if (nextState === room.projection.state) return;
  const nextClock = nextClockForMove(
    room.projection.state.clock,
    now,
    moveColor,
    room.projection.state.moveNumber,
    nextState.status,
  );
  const captured = capturedRoleFor(room.projection.state, nextState.lastMove ?? requestedMove);

  const fromSeq = room.events.length;
  await appendEvent(ctx, room, {
    type: 'move-played',
    at: now,
    roomId: room.id,
    clock: nextClock,
    color: moveColor,
    move: nextState.lastMove ?? requestedMove,
    ...(captured ? { capturedRole: captured } : {}),
  });
  broadcastEventAppended(ctx, room, fromSeq);
  scheduleRandomEngineMove(ctx, room);
}

type LiveEngineDecisionArtifactInput = {
  contextPly: number;
  durationMs: number;
  engineId: string;
  fallback: boolean;
  fallbackEvent: LiveEngineFallbackEvent | null;
  move: Move;
  requestedEngineId: string;
  scores: Array<{ move: Move; score: number; reason: string }>;
  thinkTimeMs: number;
  /**
   * What the SERVER allotted this move (`liveEngineComputeBudgetMs`), or null
   * for an engine that is handed no time budget at all. Null, never 0.
   */
  budgetMs: number | null;
  engineDiagnostics?: Record<string, unknown>;
};

/**
 * The `live-engine-decision` payload for one chess / dark-chess engine turn.
 *
 * Split out of the writer below so it can be asserted directly: the writer is
 * fire-and-forget behind `persistence.isInitialized()`, so a unit test cannot
 * see what it wrote, and this payload is the only durable record of an engine
 * decision on the most-played surface we have.
 *
 * `movetime_ms` names the allotted budget the same way the tenant and standard
 * xiangqi writers do, deliberately: it is the field every artifact reader keys
 * on, and a fourth spelling here would mean the fog path stayed unreadable to
 * them. Until 2026-09-06 this payload carried think time against NOTHING, so
 * `scripts/engine-budget-report.mjs` could only report the fog bots as
 * CEILING-UNKNOWN — think time with no ceiling cannot say whether the engine
 * finished its work or ran out of clock.
 */
export function buildLiveEngineDecisionArtifactPayload(
  input: LiveEngineDecisionArtifactInput,
): Record<string, unknown> {
  return {
    requested_engine_id: input.requestedEngineId,
    engine_id: input.engineId,
    fallback: input.fallback,
    move: input.move,
    movetime_ms: input.budgetMs,
    think_time_ms: input.thinkTimeMs,
    duration_ms: input.durationMs,
    scores: input.scores,
    ...(input.engineDiagnostics ? { engine_diagnostics: input.engineDiagnostics } : {}),
  };
}

async function recordLiveEngineDecisionArtifact(
  room: Room,
  input: LiveEngineDecisionArtifactInput,
): Promise<void> {
  if (!persistence.isInitialized()) return;
  try {
    await persistence.recordGameDebugArtifact({
      gameId: room.id,
      ply: input.contextPly,
      engineColor: engineSeatFor(room) ?? 'black',
      artifactType: LIVE_ENGINE_DECISION_ARTIFACT_TYPE,
      payload: buildLiveEngineDecisionArtifactPayload(input),
    });
    if (input.fallbackEvent) {
      await persistence.recordGameDebugArtifact({
        gameId: room.id,
        ply: input.contextPly,
        engineColor: engineSeatFor(room) ?? 'black',
        artifactType: 'live-engine-fallback',
        payload: {
          engine_id: input.fallbackEvent.engineId,
          fallback_engine_id: input.fallbackEvent.fallbackEngineId,
          reason: input.fallbackEvent.reason,
          timeout_ms: input.fallbackEvent.timeoutMs ?? null,
          duration_ms: input.fallbackEvent.durationMs,
          diagnostics: input.fallbackEvent.diagnostics ?? null,
        },
      });
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'live_engine_artifact_persistence_failed',
        roomId: room.id,
        ply: input.contextPly,
        error: (err as Error).message,
        at: Date.now(),
      }),
    );
  }
}

// The decision artifact above is success-only: a FAILED engine turn (pool
// timeout, worker ok:false) used to leave ZERO rows in game_debug_artifacts,
// so a forfeited game's entire forensic trail was ephemeral stdout — game
// 12c8ff99 needed an offline replay rig to reconstruct. Persist the failure
// next to the decisions it interrupts.
async function recordLiveEngineFailureArtifact(
  room: Room,
  input: { error: string; engineId: string | null; at: number },
): Promise<void> {
  if (!persistence.isInitialized()) return;
  try {
    const ply = room.events.filter((e) => e.type === 'move-played').length;
    await persistence.recordGameDebugArtifact({
      gameId: room.id,
      ply,
      engineColor: engineSeatFor(room) ?? 'black',
      artifactType: 'live-engine-failure',
      payload: {
        engine_id: input.engineId,
        error: input.error,
        at: input.at,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'live_engine_artifact_persistence_failed',
        roomId: room.id,
        artifactType: 'live-engine-failure',
        error: (err as Error).message,
        at: Date.now(),
      }),
    );
  }
}

export async function playRandomEngineMoveIfReady(
  ctx: RoomManagerContext,
  room: Room,
): Promise<void> {
  if (!room.randomEngine) return;
  const engine = loadEngine(room.pveEngineId ?? ctx.pveBuiltinEngineClientId);
  if (room.projection.variant !== 'dark-chess') return;
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.paused) return;
  if (!bothSeatsAssigned(room)) return;
  const engineSeat = engineSeatFor(room);
  if (engineSeat === null) return;
  if (room.projection.state.status.turn !== engineSeat) return;

  const now = Date.now();
  if (
    room.projection.state.clock &&
    clockRemainingMs(room.projection.state.clock, engineSeat, now) <= 0
  ) {
    await expireActiveClock(ctx, room, engineSeat, now);
    return;
  }

  const moves = variantForId(room.projection.variant).getLegalMoves(
    room.projection.state,
    engineSeat,
  );
  if (moves.length === 0) return;
  const clock = room.projection.state.clock;
  const context = {
    baseThinkTimeMs: ctx.pveEngineMoveDelayMs,
    clockRemainingMs: clock ? clockRemainingMs(clock, engineSeat, now) : undefined,
    events: room.events,
    incrementMs: clock?.incrementMs,
    engineReservationId: room.engineReservationId ?? undefined,
    state: room.projection.state,
    color: engineSeat,
    legalMoves: moves,
    roomId: room.id,
    seed: liveEngineMoveSeed(room),
    ply: room.events.filter((event) => event.type === 'move-played').length,
  } as const;
  // Read the allocation BEFORE the move so the artifact records the budget this
  // turn actually ran under: the allocator is a function of the clock, and the
  // clock has moved by the time the decision comes back. Pure arithmetic, no
  // I/O — it does not touch the engine or the timing of the move below.
  const engineBudgetMs = liveEngineComputeBudgetMs(engine, context, ctx.liveEngineTimeoutMs);
  const startedAt = Date.now();
  let fallbackEvent: LiveEngineFallbackEvent | null = null;
  const result = await chooseLiveEngineMove({
    context,
    engine,
    timeoutMs: ctx.liveEngineTimeoutMs,
    onFallback(event) {
      fallbackEvent = event;
      logger.error(
        {
          kind: 'live_engine_fallback',
          game_id: room.id,
          engine_id: event.engineId,
          fallback_engine_id: event.fallbackEngineId,
          ply: event.ply,
          reason: event.reason,
          timeout_ms: event.timeoutMs,
          duration_ms: event.durationMs,
          diagnostics: event.diagnostics,
        },
        'live engine fallback',
      );
    },
  });
  const computeMs = Date.now() - startedAt;
  const engineThinkTimeMs = result.decision.thinkTimeMs ?? computeMs;
  await sleepEngineThinkTime(startedAt, engineThinkTimeMs);
  const decisionAt = Date.now();
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.state.status.turn !== engineSeat) return;
  if (
    room.projection.state.clock &&
    clockRemainingMs(room.projection.state.clock, engineSeat, decisionAt) <= 0
  ) {
    await expireActiveClock(ctx, room, engineSeat, decisionAt);
    return;
  }
  engineCounters.recordMove(result.fallback);
  logger.info(
    {
      kind: 'live_engine_move',
      game_id: room.id,
      requested_engine_id: engine.id,
      engine_id: result.engineId,
      fallback: result.fallback,
      ply: context.ply,
      compute_ms: computeMs,
      total_ms: decisionAt - startedAt,
      think_time_ms: engineThinkTimeMs,
      move: result.decision.move,
    },
    'live engine move',
  );
  const move = result.decision.move;
  if (!move) return;
  const nextState = variantForId(room.projection.variant).applyMove(room.projection.state, move);
  if (nextState === room.projection.state) return;
  const nextClock = nextClockForMove(
    room.projection.state.clock,
    decisionAt,
    engineSeat,
    room.projection.state.moveNumber,
    nextState.status,
  );
  const captured = capturedRoleFor(room.projection.state, nextState.lastMove ?? move);
  await appendEvent(ctx, room, {
    type: 'move-played',
    at: decisionAt,
    roomId: room.id,
    clock: nextClock,
    color: engineSeat,
    move,
    thinkTimeMs: engineThinkTimeMs,
    ...(captured ? { capturedRole: captured } : {}),
  });
  await recordLiveEngineDecisionArtifact(room, {
    contextPly: context.ply,
    durationMs: Date.now() - startedAt,
    engineId: result.engineId,
    fallback: result.fallback,
    fallbackEvent,
    move,
    requestedEngineId: engine.id,
    scores: result.decision.scores,
    thinkTimeMs: engineThinkTimeMs,
    budgetMs: engineBudgetMs,
    ...(result.decision.diagnostics ? { engineDiagnostics: result.decision.diagnostics } : {}),
  });
}

export function scheduleRandomEngineMove(ctx: RoomManagerContext, room: Room): void {
  if (room.engineTimer) return;
  if (!room.randomEngine) return;
  if (room.projection.variant !== 'dark-chess') return;
  if (room.projection.state.status.type !== 'playing') return;
  if (room.projection.paused) return;
  if (!bothSeatsAssigned(room)) return;
  const engineSeat = engineSeatFor(room);
  if (engineSeat === null) return;
  if (room.projection.state.status.turn !== engineSeat) return;

  room.engineTimer = setTimeout(() => {
    room.engineTimer = null;
    const fromSeq = room.events.length;
    void playRandomEngineMoveIfReady(ctx, room)
      .then(() => broadcastEventAppended(ctx, room, fromSeq))
      .catch((err) => {
        if (!(err instanceof PersistenceFailure)) {
          const failedAt = Date.now();
          engineCounters.recordMoveFailure();
          logger.error(
            {
              kind: 'engine_move_failure',
              room_id: room.id,
              engine_id: room.pveEngineId ?? ctx.pveBuiltinEngineClientId,
              error: (err as Error).message,
              at: failedAt,
            },
            'engine move failure',
          );
          void recordLiveEngineFailureArtifact(room, {
            error: (err as Error).message,
            engineId: room.pveEngineId ?? ctx.pveBuiltinEngineClientId,
            at: failedAt,
          });
          const failureSeq = room.events.length;
          void forfeitEngineOnFailure(ctx, room, failedAt, (err as Error).message)
            .then(() => broadcastEventAppended(ctx, room, failureSeq))
            .catch((forfeitErr) => {
              if (forfeitErr instanceof PersistenceFailure) return;
              logger.error(
                {
                  kind: 'engine_failure_forfeit_failed',
                  room_id: room.id,
                  error: (forfeitErr as Error).message,
                  at: Date.now(),
                },
                'engine failure forfeit failed',
              );
            });
        }
      });
  }, 0);
  room.engineTimer.unref();
}
