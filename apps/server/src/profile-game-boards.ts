// Final-position thumbnails for the profile games list (#509), sent only when
// the client asks (`?boards=1` on the profile and games-pager routes).
//
// The list draws each board from this payload, so a page of twenty games costs
// one batched event load here instead of twenty event-log fetches and replays
// in the browser (what /games "Just finished" does per tile). Finished games
// never change, so each room's answer is kept per process.
//
// The position is the share card's (og-game-tenant.ts): the tenant card's
// PUBLIC FEN of the finished game, projected by resolvePositionOg. The thumbnail
// then keeps less than the card: each piece is only a point and an ink, never a
// role, so a jieqi piece nobody turned over is "a red piece here" and a banqi or
// Flip Jungle tile still face-down has no ink at all. Fog games draw revealed,
// as a finished room is open to spectators (roomViewPolicy).

import { boardToPieces } from '@mistboard/board-render';
import {
  applyGameEvent,
  type GameEvent,
  initialGameProjection,
  JUNGLE_HEIGHT,
  JUNGLE_WIDTH,
} from '@mistboard/game';
import { resolvePositionOg } from './og-position.js';
import * as persistence from './persistence.js';
import { type VariantTenantCard, variantTenantForRoomId } from './variant-tenant/registry.js';

/** What a point holds, as the thumbnail may show it: a side's piece (red,
 *  black, white), a jieqi piece still face-down (its ink is public), a tile
 *  whose ink is hidden too (banqi, Flip Jungle), or the Duck Xiangqi duck. */
export type ProfileBoardMark =
  | 'red'
  | 'black'
  | 'white'
  | 'red-down'
  | 'black-down'
  | 'hidden'
  | 'duck';

/** [file from 0, rank from 1 at the bottom as drawn, mark]. */
export type ProfileBoardPiece = [number, number, ProfileBoardMark];

/** Mirrored by apps/web/src/profile-game-board.ts. `shape` picks the drawing:
 *  pieces on line crossings (the xiangqi family) or in cells. */
export type ProfileBoardThumb =
  | {
      shape: 'intersection';
      files: number;
      ranks: number;
      river: [number, number] | null;
      palaces: Array<[fileLo: number, rankLo: number, fileHi: number, rankHi: number]>;
      pieces: ProfileBoardPiece[];
    }
  | {
      shape: 'grid' | 'jungle' | 'chess';
      files: number;
      ranks: number;
      pieces: ProfileBoardPiece[];
    };

export type ProfileBoardDeps = {
  cardForRoomId: (roomId: string) => VariantTenantCard | null;
  loadRoomsEvents: (roomIds: readonly string[]) => Promise<ReadonlyMap<string, readonly unknown[]>>;
};

const liveDeps: ProfileBoardDeps = {
  cardForRoomId: (roomId) => variantTenantForRoomId(roomId)?.card ?? null,
  loadRoomsEvents: (roomIds) => persistence.loadRoomsEvents(roomIds),
};

// Chess-stack rooms (no tenant registration) that draw: Fog Chess under its
// current and legacy ids.
const CHESS_STACK_BOARD_VARIANTS: ReadonlySet<string> = new Set(['dark-chess', 'fog']);

const CACHE_ENTRIES = 2000;
const cache = new Map<string, ProfileBoardThumb | null>();

/** Forget cached boards (tests). */
export function resetProfileBoardCache(): void {
  cache.clear();
}

function remember(roomId: string, board: ProfileBoardThumb | null): void {
  cache.delete(roomId);
  cache.set(roomId, board);
  if (cache.size > CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Every row, in order, with `finalBoard` set: the thumbnail, or null for a game
 *  with no drawable position (a variant without a card, a log that will not
 *  replay or did not load). */
export async function attachProfileBoards<T extends { roomId: string; variant: string }>(
  rows: readonly T[],
  deps: ProfileBoardDeps = liveDeps,
): Promise<Array<T & { finalBoard: ProfileBoardThumb | null }>> {
  const wanted = rows.filter(
    (row) =>
      !cache.has(row.roomId) &&
      (deps.cardForRoomId(row.roomId) !== null || CHESS_STACK_BOARD_VARIANTS.has(row.variant)),
  );
  if (wanted.length > 0) {
    let eventsByRoom: ReadonlyMap<string, readonly unknown[]> | null = null;
    try {
      eventsByRoom = await deps.loadRoomsEvents(wanted.map((row) => row.roomId));
    } catch {
      // A failed load says nothing about the games: draw none, cache nothing,
      // and the next request tries again.
    }
    if (eventsByRoom) {
      for (const row of wanted) {
        const events = eventsByRoom.get(row.roomId);
        remember(row.roomId, events ? finalBoardOf(row.roomId, events, deps) : null);
      }
    }
  }
  return rows.map((row) => ({ ...row, finalBoard: cache.get(row.roomId) ?? null }));
}

function finalBoardOf(
  roomId: string,
  events: readonly unknown[],
  deps: ProfileBoardDeps,
): ProfileBoardThumb | null {
  try {
    const card = deps.cardForRoomId(roomId);
    if (!card) return chessFinalBoard(roomId, events);
    const plies = events.filter(
      (event) => (event as { type?: unknown } | null)?.type === 'move-played',
    ).length;
    // A thumbnail promises the final position; an earlier ply is not a substitute.
    // fenAtPly yields only for a log that ends finished.
    const fen = card.fenAtPly(events, roomId, plies);
    const resolved = fen ? resolvePositionOg(card.variant, fen) : null;
    return resolved ? thumbOf(resolved.board) : null;
  } catch {
    // A log the current rules refuse (replay-guard.ts): no board.
    return null;
  }
}

// The fog chess card's replay (og-image.ts reconstructFinalPieces), on a log the
// caller already loaded. The profile lists completed games only.
function chessFinalBoard(roomId: string, events: readonly unknown[]): ProfileBoardThumb | null {
  const log = events as GameEvent[];
  if (log.length === 0) return null;
  let projection = initialGameProjection(log[0]?.roomId ?? roomId);
  let plies = 0;
  for (const event of log) {
    projection = applyGameEvent(projection, event);
    if (event.type === 'move-played') plies += 1;
  }
  if (plies === 0) return null;
  return {
    shape: 'chess',
    files: 8,
    ranks: 8,
    pieces: boardToPieces(projection.state.board).map((piece) => [
      piece.file,
      piece.rank + 1,
      piece.color,
    ]),
  };
}

type OgBoard = NonNullable<ReturnType<typeof resolvePositionOg>>['board'];

/** The card's board with every role dropped. */
export function thumbOf(board: OgBoard): ProfileBoardThumb {
  switch (board.kind) {
    case 'intersection':
      return {
        shape: 'intersection',
        files: board.files,
        ranks: board.ranks,
        river: board.riverBetweenRanks ?? null,
        palaces: board.palaces.map((p) => [p.fileLo, p.rankLo, p.fileHi, p.rankHi]),
        pieces: [
          ...board.pieces.map((p): ProfileBoardPiece => [p.file, p.rank, p.color]),
          ...board.extras.map((extra): ProfileBoardPiece => {
            if (extra.kind === 'duck') return [extra.file, extra.rank, 'duck'];
            if (extra.kind === 'face-down') return [extra.file, extra.rank, `${extra.ink}-down`];
            return [extra.file, extra.rank, extra.ink];
          }),
        ],
      };
    case 'grid':
      return {
        shape: 'grid',
        files: board.files,
        ranks: board.ranks,
        pieces: board.tiles.map((tile) => [
          tile.file,
          tile.rank,
          tile.hidden ? 'hidden' : tile.ink,
        ]),
      };
    case 'jungle':
      return {
        shape: 'jungle',
        files: JUNGLE_WIDTH,
        ranks: JUNGLE_HEIGHT,
        pieces: board.pieces.map((p) => [p.file, p.rank, p.ink]),
      };
    case 'chess':
      return {
        shape: 'chess',
        files: 8,
        ranks: 8,
        pieces: board.pieces.map((p) => [p.file, p.rank + 1, p.color]),
      };
    default: {
      const unreachable: never = board;
      throw new Error(`profile board: unhandled ${String(unreachable)}`);
    }
  }
}
