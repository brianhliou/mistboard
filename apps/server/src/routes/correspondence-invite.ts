import type { IncomingMessage, ServerResponse } from 'node:http';
import { correspondenceEnabled } from './../feature-flags.js';
import { logger } from './../obs.js';
import { registeredVariantTenants } from './../variant-tenant/registry.js';
import { seeksVisibleTo } from './correspondence-seeks.js';
import { type HttpApiContext, requireMethod, writeJson } from './lib.js';

// GET /api/correspondence/rooms/:roomId/invite: what a signed-out visitor who
// opens a correspondence room's invite link may read before signing in (#1058),
// so the room heads with "Alice invited you to Xiangqi, 3 days per move" rather
// than a refusal. The path sits under /api/correspondence/rooms/<id> so the FFQ
// banqi HTTP guard (ffq-banqi-http.ts) screens it like every room-addressed read.
//
// What it answers, and nothing more: the game, the pace and the creator's
// display name, which every client in the room, spectators included, already
// receives on the seat map. Never a board, a seat token, a handle, an email, a
// device id or an account id. The page draws the variant's own start-position
// thumbnail, so a fog or face-down variant shows exactly what its seek tile
// shows (start-position-board.ts).
//
// When it answers: a correspondence room (days per move) still in play and
// waiting for its second player (one seat held, by an account), a variant an
// anonymous reader may see (the seek board's door), and a tenant that admits the
// connection. Anything else is a plain 404, so the page keeps today's copy.

const INVITE_PATH = /^\/api\/correspondence\/rooms\/([^/]+)\/invite$/;

export type InvitePreview = {
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string;
};

/** The parts of a room the preview reads, from either room runtime. */
export type InviteRoomSummary = {
  gameSpecId: string;
  daysPerMove: number | undefined;
  statusType: string;
  seats: readonly {
    userId: string | null | undefined;
    userHandle: string | null | undefined;
    userDisplayName: string | null | undefined;
  }[];
};

/** Pure: the preview for this room, or null when it must stay a 404. */
export function invitePreviewFor(room: InviteRoomSummary): InvitePreview | null {
  const days = room.daysPerMove;
  if (typeof days !== 'number' || !(days > 0)) return null;
  // Finished and aborted rooms are not invitations.
  if (room.statusType !== 'playing') return null;
  const held = room.seats.filter((seat) => seat.userId);
  // An invite waits on exactly one more player, and no move is possible until
  // that seat is taken. Two seats held is a game in progress, and none held has
  // nobody to name.
  if (held.length !== 1) return null;
  const creator = held[0]!;
  const creatorName = creator.userDisplayName || creator.userHandle;
  if (!creatorName) return null;
  return { gameSpecId: room.gameSpecId, daysPerMove: days, creatorName };
}

export type InviteDeps = {
  loadRoom: (roomId: string) => Promise<InviteRoomSummary | null>;
  anonymousMaySee: (gameSpecId: string) => Promise<boolean>;
};

export async function invitePreviewResult(
  roomId: string,
  deps: InviteDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const notFound = { status: 404, body: { error: 'invite_not_found' } };
  const room = await deps.loadRoom(roomId);
  if (!room) return notFound;
  const preview = invitePreviewFor(room);
  if (!preview) return notFound;
  if (!(await deps.anonymousMaySee(preview.gameSpecId))) return notFound;
  // Spelled out so nothing else on the summary reaches the wire.
  return {
    status: 200,
    body: {
      gameSpecId: preview.gameSpecId,
      daysPerMove: preview.daysPerMove,
      creatorName: preview.creatorName,
    },
  };
}

function defaultInviteDeps(ctx: HttpApiContext): InviteDeps {
  return {
    loadRoom: async (roomId) => {
      const registration =
        registeredVariantTenants().find((entry) => roomId.startsWith(entry.roomIdPrefix)) ?? null;
      if (registration) {
        // The same door the room's socket uses: a gated tenant shows a stranger nothing.
        if (registration.admitsConnection) {
          if (!registration.admitsConnection(null)) return null;
        } else if (!registration.enabled()) {
          return null;
        }
        try {
          const room = registration.rooms.get(roomId) ?? (await registration.getOrLoadRoom(roomId));
          const projection = room?.projection;
          if (!room || !projection) return null;
          return {
            gameSpecId: registration.gameSpecId,
            daysPerMove: projection.timeControl?.daysPerMove,
            statusType: projection.state.status.type,
            seats: Object.values(room.seatTokens ?? {}).map((token) => ({
              userId: token?.userId,
              userHandle: token?.userHandle,
              userDisplayName: token?.userDisplayName,
            })),
          };
        } catch (err) {
          logger.warn({ err, roomId }, 'correspondence invite: room unavailable');
          return null;
        }
      }
      // Fog Chess runs on the chess runtime: its rooms live in ctx.rooms.
      const room = ctx.rooms.get(roomId);
      if (!room) return null;
      return {
        gameSpecId: room.gameSpecId,
        daysPerMove: room.projection.timeControl?.daysPerMove,
        statusType: room.projection.state.status.type,
        seats: Object.values(room.seatTokens).map((token) => ({
          userId: token?.revokedAt ? null : token?.userId,
          userHandle: token?.userHandle,
          userDisplayName: token?.userDisplayName,
        })),
      };
    },
    anonymousMaySee: async (gameSpecId) =>
      (await seeksVisibleTo([{ gameSpecId }], null)).length > 0,
  };
}

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const match = pathname.match(INVITE_PATH);
  if (!match) return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!correspondenceEnabled()) {
    writeJson(response, 404, { error: 'correspondence_disabled' });
    return true;
  }
  const result = await invitePreviewResult(decodeURIComponent(match[1]!), defaultInviteDeps(ctx));
  writeJson(response, result.status, result.body);
  return true;
}
