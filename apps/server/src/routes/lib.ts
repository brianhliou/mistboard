// Shared utilities for the HTTP route modules under apps/server/src/routes/.
// Lives one level below http-api.ts (the dispatcher) so route modules don't
// have to know about each other or about the dispatcher. http-api.ts
// re-exports the public surface (HttpApiContext, parseVariantId, etc.) so
// index.ts and other consumers continue to import from './http-api.js'.

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  findTimeControl,
  isRatedTimeControl,
  type RoomTimeControl,
  type TimeControlId,
  type VariantId,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import type { DeployGateCensus } from './../deploy-gate.js';
import * as persistence from './../persistence.js';
import { isAdminDebugToken, isProductionLikeRuntime } from './../server-policy.js';
import type { LobbyTicket, Room } from './../server-types.js';

// ── Constants ──────────────────────────────────────────────────────────────
export const minRoomClockInitialMs = 10_000;
export const maxRoomClockInitialMs = 180 * 60 * 1000;
export const maxRoomClockIncrementMs = 60_000;

// Playable time-control allowlist. A lobby's allowlist must accept everything
// its variant's picker offers, or a menu-listed control 400s at join time — so
// this is the union of every tenant's timePresetIds, and narrowing happens in
// the picker (registry.ts timePresetIds), not here.
//
// 10+5 is offered only by the deliberate variants (jieqi, xiangqi) but sits in
// the shared set for that reason: it is not the lobby's job to re-derive which
// tenant offers what. It is casual-only via the spec's `rated` flag, which
// isRatedTimeControl enforces separately.
//
// (An earlier comment here claimed dark chess was scoped to bullet + blitz with
// 5+5 dropped. That has not been true since dark-chess PvE was pinned to 5+5;
// the set has held all three ids throughout.)
const ALLOWED_FULL_TIME_CONTROL_IDS: ReadonlySet<TimeControlId> = new Set([
  '1m1',
  '3m2',
  '5m5',
  '10m5',
]);

// ── Context ────────────────────────────────────────────────────────────────
export interface HttpApiContext {
  rooms: Map<string, Room>;
  lobbyTickets: Map<string, LobbyTicket>;
  lobbyQueue: LobbyTicket[];
  databaseRequired: boolean;
  pveBuiltinEngineClientId: string;
  annotationsFile: string;
  liveClockInitialMs: number;
  liveClockIncrementMs: number;
  createRoom(
    mode: 'pvp' | 'pve',
    variant: VariantId,
    engineId: string,
    timeControl?: RoomTimeControl,
    rated?: boolean,
    options?: {
      randomSeating?: boolean;
      engineColor?: 'white' | 'black';
      engineReservationId?: string;
      botId?: string;
      creatorPreference?: 'white' | 'black';
      region?: string;
    },
  ): Promise<Room>;
  reserveLiveEngineSeat(engineId: string, color: 'white' | 'black'): Promise<string | null>;
  releaseLiveEngineReservation(reservationId: string, reason: string): void;
  abandonRoom(
    roomId: string,
    seatToken: string,
  ): Promise<
    { ok: true } | { ok: false; error: 'not_found' | 'unauthorized' | 'already_terminal' }
  >;
  inMemoryGameSummary(roomId: string): persistence.RecentEveGameRecord | null;
  isDraining(): boolean;
  drainDeadlineMs(): number | null;
  restartPhase?(): 'pending' | 'restarting' | null;
  activeGameCount(): number;
  // Optional: test contexts build this slice by hand and only the status route
  // reads it.
  deployGateCensus?(): DeployGateCensus;
  persistenceHealth?(): { count1m: number; lastAt: number | null };
}

// ── HTTP utilities ─────────────────────────────────────────────────────────
export function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string | string[]> = {},
): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

// ── Finished-game (postgame/review) serialization ──────────────────────────
// Every per-variant finished-game endpoint (GET /api/<variant>/games/:id)
// returns the same `game` envelope. This is the single source for that shape so
// the 15 variant routes don't drift. `players` exposes seat identity sourced
// from the persisted game participants (display name, rating, subject kind).

export type PostgamePlayer = {
  color: string;
  name: string;
  rating: number | null;
  kind: 'account' | 'guest' | 'engine';
  // Linkable profile identity for the seat. At most one is ever set: `handle`
  // addresses /@/<handle>, `botId` addresses /bot/<id>. `kind` cannot stand in
  // for either — it deliberately collapses users and bots into 'account', and a
  // user's participant subject_id is an internal user id the profile route
  // cannot address. Both null whenever the seat must not be linked: guests,
  // imported/manual corpus seats, raw engine versions with no bot in front of
  // them, name-redacted private seats, and closed or private-profile accounts.
  handle: string | null;
  botId: string | null;
};

export type PostgameGameSummary = {
  roomId: string;
  variant: string;
  mode: persistence.GameMode;
  result: string;
  termination: string;
  plyCount: number;
  startedAt: string;
  endedAt: string;
  rated: boolean;
  visibility: persistence.GameVisibility;
  initialMs: number | null;
  incrementMs: number | null;
  players: PostgamePlayer[];
};

// Coarse subject-kind for the client: humans (accounts + bots, which have
// profiles) vs. unregistered players (guests, and imported/manual corpus seats
// with no profile to link to) vs. raw engine-version subjects.
function postgameParticipantKind(
  subjectType: persistence.GameParticipantSubjectType,
): PostgamePlayer['kind'] {
  if (subjectType === 'engine-version') return 'engine';
  if (subjectType === 'user' || subjectType === 'bot') return 'account';
  return 'guest';
}

// Map persisted participants to public player rows. A participant marked
// `private` (the default for casual PvP seats) is name-redacted to 'Anonymous';
// public/corpus seats surface their display name. Rating is whatever the
// participant load already joined (elo before/after for rated games), else null.
// Corpus imports (famous games) carry their historical names on the game record
// (white_name/black_name — already public via the watch feed); those override a
// guest seat's placeholder so the review card shows the real players.
export function postgamePlayers(
  participants: readonly persistence.GameParticipant[],
  corpusNames?: { whiteName: string | null; blackName: string | null },
): PostgamePlayer[] {
  return participants.map((participant) => {
    const kind = postgameParticipantKind(participant.subjectType);
    const secondSide = participant.color === 'black';
    const corpusName =
      kind === 'guest'
        ? ((secondSide ? corpusNames?.blackName : corpusNames?.whiteName) ?? null)
        : null;
    // A redacted seat shows 'Anonymous', so it must not carry a link that names
    // the account behind it. Gating both ids on the same condition as the name
    // keeps the two from ever disagreeing.
    const redacted = participant.visibility === 'private';
    return {
      color: participant.color,
      name: corpusName ?? (redacted ? 'Anonymous' : participant.displayName),
      rating: participant.ratingAfter ?? participant.ratingBefore ?? null,
      kind,
      handle: !redacted && participant.subjectType === 'user' ? (participant.handle ?? null) : null,
      botId: !redacted && participant.subjectType === 'bot' ? participant.subjectId : null,
    };
  });
}

// Build the shared finished-game `game` envelope (including `players`) from a
// persisted game record. In-memory games with no recorded participants yield an
// empty `players` array rather than crashing.
export function postgameGameSummary(game: persistence.RecentEveGameRecord): PostgameGameSummary {
  return {
    roomId: game.roomId,
    variant: game.variant,
    mode: game.mode,
    result: game.result,
    termination: game.termination,
    plyCount: game.plyCount,
    startedAt: game.startedAt.toISOString(),
    endedAt: game.endedAt.toISOString(),
    rated: game.rated,
    visibility: game.visibility,
    initialMs: game.initialMs,
    incrementMs: game.incrementMs,
    players: postgamePlayers(game.participants ?? [], {
      whiteName: game.whiteName,
      blackName: game.blackName,
    }),
  };
}

// Guard helpers: collapse the ~25-site `if (method !== 'X') { writeJson(...) }`
// + `if (!persistence.isInitialized()) { writeJson(...) }` boilerplate.
// Returns false when the guard fails (caller `return`s); true to continue.
export function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  ...allowed: string[]
): boolean {
  const method = request.method ?? 'GET';
  if (allowed.includes(method)) return true;
  writeJson(response, 405, { error: 'method_not_allowed' });
  return false;
}

export function requirePersistence(response: ServerResponse): boolean {
  if (persistence.isInitialized()) return true;
  writeJson(response, 503, { error: 'persistence_disabled' });
  return false;
}

/** Default cap for small JSON bodies (settings, auth, lobby actions). */
export const DEFAULT_JSON_BODY_LIMIT = 16_384;

/**
 * Cap for routes that carry an authored move tree. A study chapter is a whole
 * annotated variation tree, so it is legitimately far larger than a settings
 * payload: a 40-variation classical game runs past 25 KB of UTF-8, and Chinese
 * comment text costs 3 bytes per character. 256 KiB leaves ~10x headroom over
 * the largest real chapter while still bounding what one row can grow to.
 */
export const TREE_JSON_BODY_LIMIT = 262_144;

/** Thrown past the cap so callers can answer 413 instead of a generic 500. */
export class RequestBodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super('request_body_too_large');
    this.name = 'RequestBodyTooLargeError';
  }
}

export async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number = DEFAULT_JSON_BODY_LIMIT,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  const parsed = JSON.parse(raw) as unknown;
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

// ── Parse helpers (also used by WebSocket handler in index.ts) ─────────────
// Every chess-stack room is Fog Chess; the gate has already refused the
// deleted Draft960 spellings, so the collapse here is total.
export function parseVariantId(_value: string | null): VariantId {
  return 'dark-chess';
}

export function isAllowedTimeControl(tc: RoomTimeControl): boolean {
  const spec = findTimeControl(tc.initialMs, tc.incrementMs);
  return spec !== null && ALLOWED_FULL_TIME_CONTROL_IDS.has(spec.id);
}

// The full three-control allowlist shared by Fog Chess and live tenant variants.
export function isAllowedFullTimeControl(tc: RoomTimeControl): boolean {
  const spec = findTimeControl(tc.initialMs, tc.incrementMs);
  return spec !== null && ALLOWED_FULL_TIME_CONTROL_IDS.has(spec.id);
}

// Rated eligibility derives from the time-control spec's own `rated` flag
// (@mistboard/game), the same source the web time picker reads. Still ANDed
// with the variant's playable allowlist by every caller: a variant that does
// not offer a pace casually has it rejected there, not here. (Dark chess does
// offer all three; an older narrower allowlist is what this used to describe.)
export function isAllowedRatedTimeControl(tc: RoomTimeControl): boolean {
  return isRatedTimeControl(tc);
}

export function parseRoomTimeControl(value: unknown): RoomTimeControl | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const initialMs = parseIntegerValue(raw.initialMs ?? raw.initial_ms);
  const incrementMs = parseIntegerValue(raw.incrementMs ?? raw.increment_ms);
  if (initialMs === null || incrementMs === null) return null;
  if (initialMs < minRoomClockInitialMs || initialMs > maxRoomClockInitialMs) return null;
  if (incrementMs < 0 || incrementMs > maxRoomClockIncrementMs) return null;
  return { initialMs, incrementMs };
}

function parseIntegerValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

export function isHttpAdminAuthorized(request: IncomingMessage): boolean {
  if (!isProductionLikeRuntime()) return true;
  const authorization = Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
  return isAdminDebugToken(token);
}

// Session-cookie admin gate (vs. isHttpAdminAuthorized's Bearer-token gate).
// Used by browser-driven admin surfaces that authenticate via the account
// session rather than a script-supplied token. Open in local dev so the tool is
// usable without an admin account.
export async function isHttpAdminSession(request: IncomingMessage): Promise<boolean> {
  if (!isProductionLikeRuntime()) return true;
  const user = await currentAccountUser(request);
  return user?.accountRole === 'admin';
}

// Guard wrapper over isHttpAdminSession: writes the 403 admin_required envelope
// and returns false when the requester isn't a session-admin (caller `return`s).
// Single source for the browser-admin gate so the admin rule can't drift across
// route modules.
export async function requireAdminSession(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (await isHttpAdminSession(request)) return true;
  writeJson(response, 403, { error: 'admin_required' });
  return false;
}
