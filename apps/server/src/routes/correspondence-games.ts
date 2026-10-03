import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import { logger } from './../obs.js';
import * as persistence from './../persistence.js';
import type { CorrespondenceGameSummary } from './../persistence-room-deadlines.js';
import { variantTenantForRoomId } from './../variant-tenant/registry.js';
import { requireMethod, requirePersistence, writeJson } from './lib.js';

// GET /api/correspondence/games — the signed-in player's in-flight
// correspondence games, your-move-first, plus the your-move count that drives
// the nav badge. Reads the room_deadlines index
// (listCorrespondenceGamesForUser); account-only, mirroring the create gate.
//
// Each game may carry `seatBoard`: the board THIS player's seat sees in the
// room, produced by the tenant's own snapshot redaction for that seat
// (registration.seatBoard -> tenantSeatStateView). It exists so the inbox can
// draw a Fog Chess player their own fog view. Safe by construction:
// - the list is the requester's own seats only (the query joins on their seat
//   token), so `mySeat` is a seat they hold and nobody else's view is built;
// - only tenants that opt in with seatBoard produce one, and they return null
//   for anything that is not one of their colors (fail-closed);
// - nothing here touches the public /api/games/current feed, where fog games
//   still carry no board.
export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/correspondence/games') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  writeJson(response, 200, await correspondenceGamesForUser(user.id));
  return true;
}

type SeatBoardKey = Pick<CorrespondenceGameSummary, 'roomId' | 'gameSpecId' | 'mySeat'>;

export type CorrespondenceGamesDeps = {
  list: (userId: string) => Promise<CorrespondenceGameSummary[]>;
  seatBoard: (game: SeatBoardKey) => Promise<unknown | null>;
};

const defaultDeps: CorrespondenceGamesDeps = {
  list: (userId) => persistence.listCorrespondenceGamesForUser(userId),
  seatBoard: (game) => correspondenceSeatBoard(game),
};

export async function correspondenceGamesForUser(
  userId: string,
  deps: CorrespondenceGamesDeps = defaultDeps,
): Promise<{ games: Record<string, unknown>[]; yourMoveCount: number }> {
  const games = await deps.list(userId);
  const boards = await Promise.all(games.map((game) => deps.seatBoard(game)));
  return {
    games: games.map((game, index) => {
      const board = boards[index];
      return {
        roomId: game.roomId,
        url: `/room/${encodeURIComponent(game.roomId)}`,
        gameSpecId: game.gameSpecId,
        mySeat: game.mySeat,
        isYourMove: game.isYourMove,
        opponentName: game.opponentName,
        dueAt: game.dueAt.toISOString(),
        ...(board !== null && board !== undefined ? { seatBoard: board } : {}),
      };
    }),
    yourMoveCount: games.reduce((count, game) => count + (game.isYourMove ? 1 : 0), 0),
  };
}

// The seat's own board, or null. The room must belong to a registered tenant
// that opts in (seatBoard), whose spec matches the indexed game; anything else,
// including an unknown room prefix, a spec mismatch, a room that will not
// hydrate or a hook that throws, is no board rather than an error.
export async function correspondenceSeatBoard(game: SeatBoardKey): Promise<unknown | null> {
  const registration = variantTenantForRoomId(game.roomId);
  if (!registration?.seatBoard) return null;
  if (registration.gameSpecId !== game.gameSpecId) return null;
  try {
    const room = await registration.getOrLoadRoom(game.roomId);
    if (!room) return null;
    return registration.seatBoard(room, game.mySeat) ?? null;
  } catch (err) {
    logger.warn(
      { err, roomId: game.roomId },
      'correspondence games: seat board unavailable, card falls back to the mist',
    );
    return null;
  }
}
