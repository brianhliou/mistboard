/**
 * Jieqi VariantTenant — full-board xiangqi with hidden piece identities on the
 * Layer-3 tenant contract (variant-tenant/tenant.ts).
 *
 * Jieqi is NOT a fog tenant: every occupied square is public, so moves pass
 * through to both seats unchanged. What is hidden is identity, and that lives in
 * two places this tenant guards:
 *   - the per-game DEAL is a server secret. rules.createSetup mints it with a
 *     crypto RNG; the runtime persists it in the room-created event; this
 *     tenant's clientEventFor STRIPS it before any client sees the event.
 *   - the board's face-down pieces and the capturer-only captured pool are
 *     redacted by getJieqiPlayerView, which viewForClient delegates to.
 *
 * Not wired into register-tenants.ts yet (no HTTP create / lobby / gameSpec):
 * registration is the launch capstone. This module + the contract `setup` hook
 * are the foundation.
 */

import { randomInt } from 'node:crypto';
import {
  type AbortReason,
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiDeal,
  getJieqiPlayerView,
  getJieqiPublicView,
  isJieqiLegalMove,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiPlayerView,
  type JieqiSquare,
  jieqiCheckMark,
  jieqiPerpetualCheckLoser,
  jieqiTruthBoard,
  jieqiTruthCaptures,
  oppositeJieqiColor,
} from '@mistboard/game';
import { jieqiEnabled } from './feature-flags.js';
import {
  isJieqiEngineClientId,
  jieqiEngineDisplayName,
  jieqiEngineVersion,
} from './jieqi-engine.js';
import type * as persistence from './persistence.js';
import { isProductionLikeRuntime, type RuntimeEnv } from './server-policy.js';
import {
  applyTenantEvent,
  replayTenantEvents,
  tenantPveEngineId,
} from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantProjection,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

// Live-room registration (HTTP create / lobby / ws plumbing) is deferred to the
// launch capstone; the spec id is first-class (@mistboard/game GAME_SPECS).
export const JIEQI_ROOM_ID_PREFIX = 'jq_';

export type JieqiTenant = VariantTenant<
  'jieqi',
  JieqiColor,
  JieqiMove,
  JieqiGameState,
  JieqiPlayerView,
  typeof JIEQI_SPEC_ID
>;

const SQUARE = /^[a-i](?:10|[1-9])$/;

export function isJieqiSquare(value: unknown): value is JieqiMove['from'] {
  return typeof value === 'string' && SQUARE.test(value);
}

function isJieqiColor(value: unknown): value is JieqiColor {
  return value === 'red' || value === 'black';
}

function isJieqiMove(value: unknown): value is JieqiMove {
  if (typeof value !== 'object' || value === null) return false;
  const move = value as Record<string, unknown>;
  return isJieqiSquare(move.from) && isJieqiSquare(move.to);
}

// A crypto-backed float in [0, 1): the deal is a hidden-information secret, so it
// must not come from Math.random.
const RNG_RANGE = 2 ** 31;
function cryptoRng(): number {
  return randomInt(0, RNG_RANGE) / RNG_RANGE;
}

// Dev/test only: MISTBOARD_DEV_JIEQI_DEAL_SEED=<uint32> deals every new room
// from one seeded shuffle, so scripts/jieqi-state-gallery.mjs can replay a
// scripted game into the same positions run after run. Only the randomness
// changes: the deal is still a server secret in room-created, stripped from
// every client event, and each seat still sees only its PlayerView. Fail
// closed: a production-like runtime ignores the variable and deals from crypto.
export function jieqiDealRng(
  env: RuntimeEnv & { MISTBOARD_DEV_JIEQI_DEAL_SEED?: string } = process.env,
): () => number {
  const raw = env.MISTBOARD_DEV_JIEQI_DEAL_SEED?.trim();
  if (!raw || isProductionLikeRuntime(env)) return cryptoRng;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) > 0xffffffff) return cryptoRng;
  let a = Number(raw) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reconstruct a deal from the persisted room-created setup. createInitialJieqiState
// fully validates it (throws on a corrupt multiset); this only shape-checks the
// container so a missing setup falls back to the standard arrangement.
function asJieqiDeal(setup: unknown): JieqiDeal | undefined {
  if (setup === null || typeof setup !== 'object') return undefined;
  const candidate = setup as { red?: unknown; black?: unknown; undetermined?: unknown };
  if (!Array.isArray(candidate.red) || !Array.isArray(candidate.black)) return undefined;
  const deal: JieqiDeal = {
    red: candidate.red as JieqiPieceRole[],
    black: candidate.black as JieqiPieceRole[],
  };
  // Imported games only: home squares the source never dealt (validated by
  // createInitialJieqiState, which marks those pieces unknown).
  const undetermined = candidate.undetermined as { red?: unknown; black?: unknown } | undefined;
  if (undetermined && Array.isArray(undetermined.red) && Array.isArray(undetermined.black)) {
    deal.undetermined = {
      red: undetermined.red as JieqiSquare[],
      black: undetermined.black as JieqiSquare[],
    };
  }
  return deal;
}

// The room-created setup: the deal, plus `repetition: true` on every room
// created since the threefold rule shipped (2026-10). A room created before it
// (or an imported lab game, whose referee adjudicated repetition itself) has no
// marker and replays under the rules it was played under, so a position that
// recurred three times mid-game does not cut an old game short. A missing setup
// (tests, the standard deal) gets the current rule.
export type JieqiSetup = JieqiDeal & { repetition?: true };

export function enforcesRepetition(setup: unknown): boolean {
  if (setup === undefined || setup === null) return true;
  return typeof setup === 'object' && (setup as { repetition?: unknown }).repetition === true;
}

// Identity is hidden, position is not: moves are public to both seats and to a
// spectator (a move event is a {from,to} the board already shows; the identity
// it reveals reaches each viewer through their own view, not the event). The
// only redaction on the wire is stripping the server-secret deal from
// room-created.
export function jieqiClientEventFor(
  event: TenantRoomEvent<JieqiColor, JieqiMove, typeof JIEQI_SPEC_ID>,
  _seat: TenantSeat<JieqiColor>,
  ply: number,
): TenantClientEvent<JieqiColor, JieqiMove, typeof JIEQI_SPEC_ID> | null {
  if (event.type === 'room-created') {
    if (event.setup === undefined) return event;
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  if (event.type === 'move-played') return { ...event, ply };
  return event;
}

export function getJieqiClientView(
  state: JieqiGameState,
  client: TenantSnapshotClient<JieqiColor>,
): JieqiPlayerView {
  // Spectator policy (docs-private/spectator-visibility-matrix.md, the jieqi
  // "public view" row): the shared masked board, captures by owner with a role
  // only where the piece was face-up when taken. Jieqi is ASYMMETRIC (the
  // capturer alone learns a dark capture), so this is neither seat's view; it is
  // what the victim knows about every capture, which both seats already hold.
  if (client.seat === 'spectator') return getJieqiPublicView(state);
  const perspective = client.seat === 'black' ? 'black' : 'red';
  return getJieqiPlayerView(state, perspective);
}

// The unredacted board, served to every client once the game is FINISHED
// (docs-private/spectator-visibility-matrix.md). The runtime owns the WHEN via
// roomViewPolicy; this only says what truth looks like on the wire.
//
// Two things open up that no seat could see during play: face-down pieces carry
// their real role, and every captured piece carries its role rather than null
// for the ones the viewer did not capture. Both are already public once a game
// ends (the postgame truth history reveals the whole board, and f2ad3e9
// reconstructed a full deal from exactly that), so this is the room catching up
// with the review page rather than a new disclosure.
export function getJieqiTruthView(state: JieqiGameState): JieqiPlayerView {
  const base = getJieqiPlayerView(state, 'red');
  // An imported game's never-determined pieces stay unknown even here.
  return {
    ...base,
    board: jieqiTruthBoard(state),
    captured: jieqiTruthCaptures(state),
    legalMoves: [],
  };
}

// The live move list's + / # per ply. The client cannot derive them: a move
// event carries no reveal, and a revealed piece checks by its true role. Check
// itself is public (it reads only the board both seats and a spectator see),
// so every client gets the same list. Extended incrementally per room, since
// it rides every frame.
type JieqiMarkCache = {
  count: number;
  projection: TenantProjection<JieqiColor, JieqiGameState, typeof JIEQI_SPEC_ID>;
  marks: Array<'' | '+' | '#'>;
};
const jieqiMarkCache = new WeakMap<object, JieqiMarkCache>();

export function jieqiLiveCheckMarks(room: {
  events: readonly TenantRoomEvent<JieqiColor, JieqiMove, typeof JIEQI_SPEC_ID>[];
}): Array<'' | '+' | '#'> {
  const created = room.events?.[0];
  if (created?.type !== 'room-created') return [];
  let cache = jieqiMarkCache.get(room);
  if (!cache || cache.count > room.events.length) {
    cache = { count: 1, projection: replayTenantEvents(jieqiTenant, [created]), marks: [] };
    jieqiMarkCache.set(room, cache);
  }
  for (let i = cache.count; i < room.events.length; i += 1) {
    const event = room.events[i]!;
    cache.projection = applyTenantEvent(jieqiTenant, cache.projection, event);
    if (event.type === 'move-played') cache.marks.push(jieqiCheckMark(cache.projection.state));
  }
  cache.count = room.events.length;
  return cache.marks;
}

export const jieqiTenant: JieqiTenant = {
  kind: 'jieqi',
  gameSpecId: JIEQI_SPEC_ID,
  roomIdPrefix: JIEQI_ROOM_ID_PREFIX,
  colors: ['red', 'black'],
  enabled: jieqiEnabled,
  oppositeColor: oppositeJieqiColor,
  rules: {
    createInitialState: (roomId, setup) =>
      createInitialJieqiState(roomId, asJieqiDeal(setup), {
        repetition: enforcesRepetition(setup),
      }),
    createSetup: (): JieqiSetup => ({ ...createJieqiDeal(jieqiDealRng()), repetition: true }),
    // Apply the move, then the xiangqi chasing rule: a threefold repetition one
    // side reached by checking on every one of its moves is a LOSS for that
    // side, not a draw (jieqi wins and losses follow xiangqi). The history the
    // verdict needs rides on the state, so event replay reruns it identically.
    applyMove: (state, move) => {
      const next = applyJieqiMove(state, move);
      if (next.status.type === 'finished' && next.status.reason === 'repetition') {
        const loser = jieqiPerpetualCheckLoser(next);
        if (loser) {
          return {
            ...next,
            status: { type: 'finished', winner: oppositeJieqiColor(loser), reason: 'chasing' },
          };
        }
      }
      return next;
    },
    isLegalMove: isJieqiLegalMove,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    // Imported lab games only (engine-match-import.ts): the lab referee draws a
    // threefold repetition, which this kernel deliberately does not adjudicate.
    adjudicate: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    abort: (state, reason: AbortReason) => ({
      ...state,
      status: { type: 'aborted', reason },
    }),
    isColor: isJieqiColor,
    isMove: isJieqiMove,
    moveFromMessage: (message) => {
      if (!isJieqiSquare(message.from) || !isJieqiSquare(message.to)) return null;
      return { from: message.from, to: message.to };
    },
  },
  visibility: {
    clientEventFor: jieqiClientEventFor,
    viewForClient: (state, client) => getJieqiClientView(state, client),
    truthView: (state) => getJieqiTruthView(state),
  },
  engine: {
    terminalContext: 'repetition-window',
    isEngineClientId: isJieqiEngineClientId,
    displayName: jieqiEngineDisplayName,
    engineVersion: jieqiEngineVersion,
    reservationReleaseTag: 'jieqi',
  },
  // Emit the room mode + engine id so the client knows a finished PvE game was
  // PvE and "Play again" re-creates a PvE game vs the same engine (not a PvP
  // invite). Mirrors DMX; Jieqi's core snapshot carries no extras.
  wire: {
    snapshotExtras: (room) => {
      const pveEngineId = tenantPveEngineId(jieqiTenant, room);
      const marks = jieqiLiveCheckMarks(room);
      return {
        ...(pveEngineId === null ? { roomMode: 'pvp' } : { roomMode: 'pve', pveEngineId }),
        // Only when a move gave check, so a check-free room's wire is unchanged.
        ...(marks.some((mark) => mark !== '') ? { checkMarks: marks } : {}),
      };
    },
  },
  persistence: {
    resultForWinner: (winner: JieqiColor | null): persistence.GameResult => {
      if (winner === 'red') return 'red-wins';
      if (winner === 'black') return 'black-wins';
      return 'draw';
    },
    // The kernel spells the no-capture draw clock 'no-capture-clock'; the canonical
    // GameTermination value (the only no-progress reason the games_termination_check
    // CHECK accepts) is 'progress-clock'. Translate it — a blind cast launders the
    // invalid string past TS and only fails at the DB write, silently dropping the game.
    termination: (reason: string): persistence.GameTermination =>
      reason === 'no-capture-clock' ? 'progress-clock' : (reason as persistence.GameTermination),
    logKindPrefix: 'jieqi',
    logLabel: 'Jieqi',
  },
};
