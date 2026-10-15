import type { IncomingMessage, ServerResponse } from 'node:http';
import { DAY_MS } from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { logger } from './../obs.js';
import * as persistence from './../persistence.js';
import type { ProfileGameRecord } from './../persistence-games.js';
import type { CorrespondenceGameSummary } from './../persistence-room-deadlines.js';
import { markUnavailableGames } from './../replayable-games.js';
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
  if (pathname === FINISHED_PATH) return handleFinished(request, response);
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
        // Linkable handle or null (closed/private account, no account): the
        // client links the name only from this, never from the display name.
        opponentHandle: game.opponentHandle ?? null,
        dueAt: game.dueAt.toISOString(),
        rated: game.rated === true,
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

// GET /api/correspondence/games/finished: the signed-in player's correspondence
// games that ended in the last FINISHED_WINDOW_DAYS, newest first, capped at
// FINISHED_LIMIT. A game leaves the active list the moment it ends
// (room_deadlines drops the row), so without this the page gave no sign that
// a game had ended or how (Brian, 2026-10-14). Rows are the profile Games
// list's own records: a finished room reveals everything, so a fog game here
// shows what its finished replay already shows, and nothing is redacted.
//
// isNew marks a game that ended after the player last opened the page (the
// users.correspondence_finished_seen_at watermark, 167), unless the player's
// own act ended it. The page advances the watermark after it renders.
const FINISHED_PATH = '/api/correspondence/games/finished';
export const FINISHED_WINDOW_DAYS = 14;
export const FINISHED_LIMIT = 10;

export type FinishedCorrespondenceGameJson = ProfileGameRecord & { isNew: boolean };

export type FinishedCorrespondenceGamesJson = {
  games: FinishedCorrespondenceGameJson[];
  windowDays: number;
  // The full history: the player's profile, whose Games tab lists every game.
  historyHref: string;
};

export type FinishedCorrespondenceDeps = {
  list: (userId: string, options: { since: Date; limit: number }) => Promise<ProfileGameRecord[]>;
  seenAt: (userId: string) => Promise<Date | null>;
  markUnavailable: (games: ProfileGameRecord[]) => Promise<ProfileGameRecord[]>;
};

const defaultFinishedDeps: FinishedCorrespondenceDeps = {
  list: (userId, options) => persistence.listRecentFinishedCorrespondenceGames(userId, options),
  seenAt: (userId) => persistence.notificationsSeenAt(userId, 'correspondence-finished'),
  markUnavailable: (games) => markUnavailableGames(games),
};

async function handleFinished(request: IncomingMessage, response: ServerResponse): Promise<true> {
  if (!requireMethod(request, response, 'GET')) return true;
  if (!requirePersistence(response)) return true;
  const user = await currentAccountUser(request);
  if (!user) {
    writeJson(response, 401, { error: 'not_signed_in' });
    return true;
  }
  writeJson(response, 200, await finishedCorrespondenceGamesForUser(user));
  return true;
}

export async function finishedCorrespondenceGamesForUser(
  user: { id: string; handle: string },
  deps: FinishedCorrespondenceDeps = defaultFinishedDeps,
  now: Date = new Date(),
): Promise<FinishedCorrespondenceGamesJson> {
  const since = new Date(now.getTime() - FINISHED_WINDOW_DAYS * DAY_MS);
  const [games, seenAt] = await Promise.all([
    deps.list(user.id, { since, limit: FINISHED_LIMIT }),
    deps.seenAt(user.id),
  ]);
  const marked = await deps.markUnavailable(games);
  return {
    games: marked.map((game) => ({ ...game, isNew: isNewFinishedGame(game, seenAt) })),
    windowDays: FINISHED_WINDOW_DAYS,
    historyHref: `/@/${encodeURIComponent(user.handle)}`,
  };
}

type FinishedGameFacts = Pick<
  ProfileGameRecord,
  'playerColor' | 'result' | 'termination' | 'endedAt'
>;

// Terminations decided by the winner's last move. When the player won one of
// these, or resigned, they were there when it ended: nothing to point out.
const WINNING_MOVE_TERMINATIONS = new Set([
  'checkmate',
  'king-captured',
  'general-captured',
  'no-legal-moves',
  'stalemate',
  'race',
  'den-entered',
  'pieces-captured',
]);

// Win from the player's seat, mirroring OWNER_WON_SQL in persistence-profiles.ts
// and profileResultTone on the web.
export function playerWonFinishedGame(
  game: Pick<FinishedGameFacts, 'playerColor' | 'result'>,
): boolean {
  if (game.playerColor === 'red') return game.result === 'red-wins';
  if (game.playerColor === 'black') return game.result === 'black-wins';
  return game.result === 'white-wins';
}

export function isNewFinishedGame(game: FinishedGameFacts, seenAt: Date | null): boolean {
  if (!seenAt || game.endedAt.getTime() <= seenAt.getTime()) return false;
  const won = playerWonFinishedGame(game);
  const lost = !won && game.result !== 'draw';
  if (game.termination === 'resignation' && lost) return false;
  if (WINNING_MOVE_TERMINATIONS.has(game.termination) && won) return false;
  return true;
}
