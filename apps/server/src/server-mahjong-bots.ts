/**
 * The three bot seats at a mahjong table.
 *
 * Unlike every other PvE tenant here, these do not talk to the engine service.
 * The bots are pure functions in the mahjong kernel, so a move costs a few
 * microseconds and needs no process, no reservation and no warm session. What
 * this module owns is only WHEN they act.
 *
 * They act on a timer rather than immediately, for two reasons that pull the
 * same way: three bots answering a discard inside the same tick would resolve a
 * claim window before a human had read the tile, and a table where the other
 * three seats move instantly reads as a machine rather than as a game.
 */

import {
  applyMahjongMove,
  claimsFor,
  efficiencyBot,
  type MahjongMove,
  type MahjongSeat,
  type MahjongTenantState,
  mahjongSeatMayAct,
  pendingClaimants,
  seatIndex,
  viewFor,
} from '@mistboard/mahjong';
import { mahjongTenant } from './mahjong-tenant.js';
import { logger } from './obs.js';
import type { TenantLifecycleContext } from './variant-tenant/lifecycle.js';
import type { TenantRuntimeRoom } from './variant-tenant/tenant.js';

/** The clientId a bot seat holds. Also what marks the seat as non-human. */
export const MAHJONG_BOT_CLIENT_ID = 'mahjong-bot-efficiency';
export const MAHJONG_BOT_ID = 'mahjong-efficiency';

export function isMahjongBotClientId(clientId: string | undefined): boolean {
  return clientId === MAHJONG_BOT_CLIENT_ID;
}

/**
 * How long a bot "thinks".
 *
 * Short enough not to stall a hand, long enough that a human sees the discard
 * land before the table reacts to it. Well inside the claim window, so a bot
 * never causes a window to time out.
 */
const BOT_THINK_MS = 700;

const bot = efficiencyBot();

type MahjongRoom = TenantRuntimeRoom<
  'mahjong',
  MahjongSeat,
  MahjongMove,
  MahjongTenantState,
  typeof mahjongTenant.gameSpecId
>;

/** Seats held by a bot, in turn order. */
function botSeats(room: MahjongRoom): MahjongSeat[] {
  return mahjongTenant.colors.filter(
    (seat) => room.projection.seats[seat] === MAHJONG_BOT_CLIENT_ID,
  );
}

/** The move this bot seat wants to make, or null if it has nothing to do. */
export function mahjongBotMove(state: MahjongTenantState, seat: MahjongSeat): MahjongMove | null {
  if (!mahjongSeatMayAct(state, seat)) return null;
  const index = seatIndex(seat);
  const view = viewFor(state.game, index);
  const at = Date.now();

  if (state.game.phase.type === 'claim-window') {
    // Only answer if the window is actually waiting on this seat; the discarder
    // is allowed to act here (to time the window out) and must not do so on the
    // bot's behalf.
    if (!pendingClaimants(state).includes(seat)) return null;
    const claim = bot.chooseClaim(view, claimsFor(state, index));
    return claim === null
      ? { by: seat, at, action: 'pass' }
      : { by: seat, at, action: 'claim', kind: claim.kind, fromHand: claim.fromHand };
  }
  if (state.game.phase.type === 'draw') return { by: seat, at, action: 'draw' };
  if (state.game.phase.type === 'discard') {
    return { by: seat, at, action: 'discard', tile: bot.chooseDiscard(view) };
  }
  return null;
}

/**
 * Schedule the next bot action, if any seat has one.
 *
 * One timer at a time for the whole room, re-armed after every event. A bot
 * that has just moved will be asked again on the way back through, which is how
 * three bots take their turns in sequence without three timers racing.
 */
export function scheduleMahjongBotMove(
  ctx: TenantLifecycleContext<MahjongSeat, MahjongMove, MahjongTenantState, string, MahjongRoom>,
  room: MahjongRoom,
): void {
  if (room.engineTimer) clearTimeout(room.engineTimer);
  room.engineTimer = null;
  if (room.projection.state.status.type !== 'playing') return;

  const ready = botSeats(room).find((seat) => mahjongBotMove(room.projection.state, seat) !== null);
  if (!ready) return;

  room.engineTimer = setTimeout(() => {
    // Re-derive rather than trusting the move chosen at scheduling time: a human
    // may have claimed the discard in the meantime, which changes both whose
    // move it is and what the options are.
    const move = mahjongBotMove(room.projection.state, ready);
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
        // Loud. This used to swallow the error on the theory that the event
        // writer had already recorded it, which is not true of a synchronous
        // throw on the way in: the first four-seat bug here showed up as a
        // table that simply stopped, with nothing in the log to say why.
        logger.error({
          kind: 'mahjong_bot_move_failure',
          room_id: room.id,
          seat: ready,
          error: (err as Error).message,
          at: Date.now(),
        });
      });
  }, BOT_THINK_MS);
  room.engineTimer.unref();
}

/** Exported for tests: apply a bot's move directly, with no timer. */
export function playMahjongBotMove(
  state: MahjongTenantState,
  seat: MahjongSeat,
): MahjongTenantState {
  const move = mahjongBotMove(state, seat);
  return move === null ? state : applyMahjongMove(state, move);
}
