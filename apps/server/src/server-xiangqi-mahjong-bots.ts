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
  xmjBotAction,
  xmjIsLegalMove,
  xmjSeatMayAct,
  xmjViewFor,
} from '@mistboard/game';
import { logger } from './obs.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';

/** The clientId the bot seat holds. Also what marks the seat as non-human. */
export const XMJ_BOT_CLIENT_ID = 'xiangqi-mahjong-bot';
export const XMJ_BOT_ID = 'xiangqi-mahjong-bot';

export function isXmjBotClientId(clientId: string | undefined): boolean {
  return clientId === XMJ_BOT_CLIENT_ID;
}

/** Well inside the claim window, so the bot never lets one time out. */
const BOT_THINK_MS = 700;

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
export function xmjBotMove(state: XmjRoomState, seat: XmjSeat): XmjMove | null {
  if (state.status.type !== 'playing') return null;
  if (!xmjSeatMayAct(state, seat)) return null;
  const action = xmjBotAction(xmjViewFor(state, seat), seat);
  if (action === null) return null;
  const move = { ...action, by: seat, at: Date.now() } as XmjMove;
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

  room.engineTimer = setTimeout(() => {
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
  }, BOT_THINK_MS);
  room.engineTimer.unref();
}

/** Exported for tests: apply the bot's move directly, with no timer. */
export function playXmjBotMove(state: XmjRoomState, seat: XmjSeat): XmjRoomState {
  const move = xmjBotMove(state, seat);
  return move === null ? state : applyXmjMove(state, move);
}
