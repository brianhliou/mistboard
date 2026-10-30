/**
 * The bot seat at a xiangqi mahjong table.
 *
 * The bot is a pure function in @mistboard/game (xiangqi-mahjong-bot.ts) that
 * reads only its own player view, so it cannot see the opponent's tiles or the
 * walls. This module owns only WHEN it acts: on a short timer, so a human sees
 * a discard land before the table answers it.
 */

import type { XIANGQI_MAHJONG_SPEC_ID } from '@mistboard/game';
import {
  applyXmjMove,
  XMJ_SEATS,
  type XmjMove,
  type XmjRoomState,
  type XmjSeat,
  xmjAnswerAt,
  xmjBotAction,
  xmjClaimAnswerEarliestAt,
  xmjIsLegalMove,
  xmjSeatMayAct,
  xmjViewFor,
} from '@mistboard/game';
import { logger } from './obs.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';

/** The clientId the bot seat holds. Also what marks the seat as non-human. */
export const XMJ_BOT_CLIENT_ID = 'misty-xiangqi-mahjong';
/**
 * The public bot fronting the seat: the room's pveBotId when the create names
 * none. A bot id, never the engine id: the finished seat is stored under it,
 * and /bot/misty counts only its own id (migration 178 moved the rows stored
 * under the engine id before 2026-10-28).
 */
export const XMJ_BOT_ID = 'misty';
/** The id before the misty-<variant> rename; games stored under it still replay. */
const XMJ_LEGACY_BOT_CLIENT_ID = 'xiangqi-mahjong-bot';

export function isXmjBotClientId(clientId: string | undefined): boolean {
  return clientId === XMJ_BOT_CLIENT_ID || clientId === XMJ_LEGACY_BOT_CLIENT_ID;
}

/** Well inside the claim window, so the bot never lets one time out. */
const BOT_THINK_MS = 700;
/** The runtime fires a pending action this long after its deadline (lifecycle.ts). */
const RUNTIME_SETTLE_LAG_MS = 25;

/**
 * How long the bot waits before acting. As the claimant it answers when the
 * claim pause ends, at the moment the runtime would pass for a seat with
 * nothing to claim, so a bot's claim, its pass and its empty hand all settle
 * the window at the same time.
 */
export function xmjBotDelayMs(state: XmjRoomState, now: number): number {
  const earliest = xmjClaimAnswerEarliestAt(state);
  if (earliest === null) return BOT_THINK_MS;
  return Math.max(0, earliest - now) + RUNTIME_SETTLE_LAG_MS;
}

type XmjRuntimeRoomForBots = TenantRuntimeRoom<
  'xiangqi-mahjong',
  XmjSeat,
  XmjMove,
  XmjRoomState,
  typeof XIANGQI_MAHJONG_SPEC_ID
>;

function botSeats(room: XmjRuntimeRoomForBots): XmjSeat[] {
  return XMJ_SEATS.filter((seat) => room.projection.seats[seat] === XMJ_BOT_CLIENT_ID);
}

/** The move this bot seat wants to make, or null if it has nothing to do. */
export function xmjBotMove(
  state: XmjRoomState,
  seat: XmjSeat,
  now: number = Date.now(),
): XmjMove | null {
  if (state.status.type !== 'playing') return null;
  if (!xmjSeatMayAct(state, seat)) return null;
  const action = xmjBotAction(xmjViewFor(state, seat), seat);
  if (action === null) return null;
  // An answer to a discard is dated to the end of the pause, as the runtime's
  // pass is, so the move log carries no timing the empty-handed pass lacks.
  const move = { ...action, by: seat, at: xmjAnswerAt(state, now) } as XmjMove;
  return xmjIsLegalMove(state, move) ? move : null;
}

/**
 * Schedule the bot's next action, if it has one. One timer per room, re-armed
 * after every event.
 */
export function scheduleXmjBotMove(
  ctx: TenantLifecycleContext<XmjSeat, XmjMove, XmjRoomState, string, XmjRuntimeRoomForBots>,
  room: XmjRuntimeRoomForBots,
): void {
  if (room.engineTimer) clearTimeout(room.engineTimer);
  room.engineTimer = null;
  if (room.projection.state.status.type !== 'playing') return;

  const ready = botSeats(room).find((seat) => xmjBotMove(room.projection.state, seat) !== null);
  if (!ready) return;

  room.engineTimer = setTimeout(
    () => {
      const move = xmjBotMove(room.projection.state, ready);
      if (move === null) return;
      void ctx
        .appendEvent(room, {
          type: 'move-played',
          at: Date.now(),
          roomId: room.id,
          color: ready,
          move,
        })
        .then((seq) => {
          const event = room.events[seq];
          if (event) ctx.broadcastEventAppended(room, event, seq);
        })
        .catch((err) => {
          logger.error({
            kind: 'xiangqi_mahjong_bot_move_failure',
            room_id: room.id,
            seat: ready,
            error: (err as Error).message,
            at: Date.now(),
          });
        });
    },
    xmjBotDelayMs(room.projection.state, Date.now()),
  );
  room.engineTimer.unref();
}

/** Exported for tests: apply the bot's move directly, with no timer. */
export function playXmjBotMove(state: XmjRoomState, seat: XmjSeat): XmjRoomState {
  const move = xmjBotMove(state, seat);
  return move === null ? state : applyXmjMove(state, move);
}
