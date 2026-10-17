/**
 * Xiangqi mahjong (象棋麻將) VariantTenant: the 32-tile, two-player Taiwan game.
 *
 * Modelled on mahjong-tenant.ts, but it imports nothing from the HK package:
 * the rules, room state, views and bot all live in @mistboard/game
 * (xiangqi-mahjong*.ts). Three things to know:
 *
 *   - Two seats, east and west, so the ordinary two-player result values and
 *     forfeit rule apply. A match is `XMJ_MATCH_HANDS` hands (six, the deal
 *     alternating); the room finishes when the match does, on points.
 *   - The setup is server-secret: pre-shuffled walls, one per hand, so the
 *     whole match replays from the event log. It is persisted in room-created
 *     and stripped from the wire by `clientEventFor`.
 *   - Two deadlines are moves rather than timers: the claim window settles
 *     itself (played by the claimant, as a pass), and the pause between hands
 *     deals the next one (played by the next dealer). `pendingAction` names both.
 *     The window opens after EVERY discard: a claimant with nothing to claim
 *     passes when the short pause ends, one with a claim keeps the full window,
 *     and the discarder sees the same phase and deadlines either way.
 *   - Correspondence (days per move) has neither deadline. The claimant's turn
 *     opens with the claim decision on every discard (claim, or pass and then
 *     draw and discard, all on one move deadline), and the next hand deals at
 *     once, played by the next dealer. Unrated, and offered only to accounts
 *     the allowlist admits (CORRESPONDENCE_ALLOWLISTED_SPEC_IDS).
 *
 * GATED TWICE, like HK mahjong: the flag is off by default, and the spec is on
 * the per-account allowlist (139). It exists for a playtest.
 */

import { randomInt } from 'node:crypto';
import {
  type AbortReason,
  applyXmjMove,
  createXmjRoomState,
  createXmjSetup,
  isXmjMove,
  isXmjRoomSetup,
  isXmjSeat,
  XIANGQI_MAHJONG_SPEC_ID,
  XMJ_BETWEEN_HANDS_MS,
  XMJ_CLAIM_PAUSE_MS,
  XMJ_SEATS,
  type XmjAbortReason,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  xmjAnswerAt,
  xmjClockOwner,
  xmjIsLegalMove,
  xmjMoveFromMessage,
  xmjPendingAction,
  xmjSeatMayAct,
  xmjViewFor,
} from '@mistboard/game';
import { xiangqiMahjongEnabled } from './feature-flags.js';
import type * as persistence from './persistence.js';
import { isXmjBotClientId } from './server-xiangqi-mahjong-bots.js';
import {
  tenantForfeitDeadlineForClient,
  tenantPerPlyViews,
  tenantPveEngineId,
} from './variant-tenant/runtime.js';
import type {
  TenantClientEvent,
  TenantRoomEvent,
  TenantSeat,
  TenantSnapshotClient,
  VariantTenant,
} from './variant-tenant/tenant.js';

// The room module spells out its own abort reasons; these lines stop the two
// lists drifting. A reason added on either side fails to compile here.
type AbortReasonsAgree = XmjAbortReason extends AbortReason ? true : never;
type AbortReasonsAgreeBothWays = AbortReason extends XmjAbortReason ? true : never;
const abortReasonsAgree: [AbortReasonsAgree, AbortReasonsAgreeBothWays] = [true, true];
void abortReasonsAgree;

export const XIANGQI_MAHJONG_ROOM_ID_PREFIX = 'xmj_';

export type XmjEvent = TenantRoomEvent<XmjSeat, XmjMove, typeof XIANGQI_MAHJONG_SPEC_ID>;
export type XmjClientEvent = TenantClientEvent<XmjSeat, XmjMove, typeof XIANGQI_MAHJONG_SPEC_ID>;

export type XmjTenantType = VariantTenant<
  'xiangqi-mahjong',
  XmjSeat,
  XmjMove,
  XmjRoomState,
  XmjPlayerView,
  typeof XIANGQI_MAHJONG_SPEC_ID
>;

export function xmjClientEventFor(
  event: XmjEvent,
  _seat: TenantSeat<XmjSeat>,
  ply: number,
): XmjClientEvent | null {
  if (event.type === 'room-created') {
    // The walls: every tile of every hand of the match, in order.
    if (event.setup === undefined) return event;
    const redacted = { ...event };
    delete redacted.setup;
    return redacted;
  }
  // A move names a tile only when that tile goes face up (a discard, a claim's
  // tiles from hand). A self-draw win names none; the hand is revealed by the
  // view once the hand is over. `handCopy` is stripped for every recipient: it
  // says the discarder still holds a twin of the thrown tile, and no client
  // needs it (it only feeds the server's drawnDiscards).
  if (event.type === 'move-played') {
    if (event.move.action === 'discard' && event.move.handCopy !== undefined) {
      const { handCopy: _concealed, ...move } = event.move;
      return { ...event, move, ply };
    }
    return { ...event, ply };
  }
  return event;
}

export function getXmjClientView(
  state: XmjRoomState,
  client: TenantSnapshotClient<XmjSeat>,
): XmjPlayerView {
  return xmjViewFor(state, client.seat === 'spectator' ? 'spectator' : client.seat);
}

// A TOTAL map, not a template literal: games_termination_check and the result
// CHECK are constraints, and a value outside them rolls back the game record.
const XMJ_RESULTS: Record<XmjSeat, persistence.GameResult> = {
  east: 'east-wins',
  west: 'west-wins',
};

const XMJ_TERMINATION: Record<string, persistence.GameTermination> = {
  // The match ran its hands and one seat had more points (migration 169).
  points: 'points',
  // The match ran its hands level.
  tie: 'draw',
  timeout: 'timeout',
  resignation: 'resignation',
  abandonment: 'abandonment',
};

export const xiangqiMahjongTenant: XmjTenantType = {
  kind: 'xiangqi-mahjong',
  gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
  roomIdPrefix: XIANGQI_MAHJONG_ROOM_ID_PREFIX,
  colors: XMJ_SEATS,
  // Rematch rides the lobby factory, which this table now has, but the
  // conformance test (variant-tenant-rematch.test.ts) seats two guests and the
  // per-account grant refuses guests. Opted out until that test can seat
  // granted accounts; a PvP seat gets New opponent meanwhile. A finished match
  // reopens at its own room, whose Review button opens the review page
  // (routes/xiangqi-mahjong-games.ts, finished matches only).
  rematch: { optOut: 'allowlisted playtest: the rematch conformance test seats guests' },
  // A move here is an action, not a turn; the clock runs from the first one.
  armsClockOnFirstMove: true,
  // Each seat sees its deal before its first move: no free redeal.
  userAbort: false,
  ratedPregameTimeoutForfeits: true,
  // The seat that must discard is on the clock, and after a discard the
  // claimant, whose claim decision has no timer of its own. Nobody between hands.
  clockOwner: xmjClockOwner,
  enabled: xiangqiMahjongEnabled,
  oppositeColor: (seat) => (seat === 'east' ? 'west' : 'east'),
  rules: {
    // A days-per-move room plays the correspondence turn (xiangqi-mahjong-room.ts):
    // no claim window or pause, the next hand deals at once, east deals first.
    createSetup: (options) =>
      createXmjSetup(() => randomInt(2 ** 30) / 2 ** 30, {
        correspondence: options?.timeControl?.daysPerMove !== undefined,
      }),
    createInitialState: (roomId, setup) => {
      // No persisted walls is a programming error: dealing fresh ones would
      // hand a reconnecting player a different match from the one in progress.
      if (!isXmjRoomSetup(setup)) throw new Error('xiangqi mahjong room has no persisted walls');
      return createXmjRoomState(setup, roomId);
    },
    applyMove: applyXmjMove,
    isLegalMove: xmjIsLegalMove,
    seatMayAct: xmjSeatMayAct,
    pendingAction: xmjPendingAction,
    finish: (state, winner, reason) => ({
      ...state,
      status: { type: 'finished', winner, reason },
    }),
    finishNoWinner: (state, reason) => ({
      ...state,
      status: { type: 'finished', winner: null, reason },
    }),
    abort: (state, reason: AbortReason) => ({ ...state, status: { type: 'aborted', reason } }),
    isColor: isXmjSeat,
    isMove: isXmjMove,
    // by/at are placeholders; canonicalMove stamps them from the socket and the
    // server clock. 'timeout' is refused here: it is the runtime's move.
    moveFromMessage: xmjMoveFromMessage,
    canonicalMove: (state, move, seat) => {
      // A claim-window answer made at once is dated to the pause end, like the
      // runtime's pass for an empty hand (xmjAnswerAt), so `at` on the wire
      // says nothing about whether there was a choice.
      const stamped = { ...move, by: seat, at: xmjAnswerAt(state, Date.now()) } as XmjMove;
      if (!xmjSeatMayAct(state, seat)) return null;
      if (!xmjIsLegalMove(state, stamped)) return null;
      return stamped;
    },
  },
  // The bot is in-process, but the runtime's "engine seat" is what marks a seat
  // as present without a socket. Without it the bot seat reads as a
  // disconnected player and the forfeit timer ends the game on it.
  engine: {
    terminalContext: 'full-history',
    isEngineClientId: isXmjBotClientId,
    displayName: () => 'Misty',
    reservationReleaseTag: 'xiangqi-mahjong',
  },
  visibility: {
    clientEventFor: xmjClientEventFor,
    viewForClient: (state, client) => getXmjClientView(state, client),
    // The walls are a server secret, live or finished, so the client cannot
    // replay its log: the hello carries this viewer's own per-ply views (a
    // seat's own hand only, a spectator's public table), and a finished match
    // keeps them, so the move list can step back through every hand.
    liveHistory: (events, viewer) => tenantPerPlyViews(xiangqiMahjongTenant, events, viewer),
    liveHistoryWhenFinished: true,
  },
  wire: {
    snapshotExtras: (room, client) => {
      const pveEngineId = tenantPveEngineId(xiangqiMahjongTenant, room);
      return {
        roomMode: pveEngineId === null ? 'pvp' : 'pve',
        ...(pveEngineId === null ? {} : { pveEngineId }),
        rated: room.rated,
        forfeitDeadline: tenantForfeitDeadlineForClient(xiangqiMahjongTenant, room, client),
        claimPauseMs: XMJ_CLAIM_PAUSE_MS,
        betweenHandsMs: XMJ_BETWEEN_HANDS_MS,
      };
    },
  },
  persistence: {
    resultForWinner: (winner: XmjSeat | null): persistence.GameResult =>
      winner === null ? 'draw' : XMJ_RESULTS[winner],
    termination: (reason: string): persistence.GameTermination => {
      const mapped = XMJ_TERMINATION[reason];
      if (!mapped) throw new Error(`xiangqi-mahjong: unmapped termination reason "${reason}"`);
      return mapped;
    },
    logKindPrefix: 'xiangqi_mahjong',
    logLabel: 'Xiangqi mahjong',
  },
};
