/**
 * How two people were paired into a room (#1229). The server stamps it on the
 * room when the room is made (durable in the room-created event), sends it to
 * every client in the snapshot, and the web copies it onto game_started,
 * game_first_move and game_finished, so both players report the same value.
 *
 * A room fact with no identity in it: never an id, a seek or ticket id, or who
 * the opponent is. Bot rooms carry none (bot games are out of scope).
 */
export const ROOM_PAIRINGS = [
  // Matched by the live lobby (Find opponent, a lobby seek taken).
  'lobby',
  // A live friend room made from POST /api/rooms and joined by its link.
  'friend-link',
  // An account-to-account live challenge, accepted.
  'live-challenge',
  // A rematch of a finished game (live or correspondence).
  'rematch',
  // A correspondence seek taken from the public board.
  'correspondence-board',
  // A public correspondence seek taken by the homepage quick-pair.
  'correspondence-quick-pair',
  // A private correspondence seek taken through its link.
  'correspondence-link',
  // A correspondence challenge aimed at one account, accepted.
  'correspondence-challenge',
  // Play the host: a game against the correspondence host account.
  'correspondence-host',
  // A correspondence friend room made from POST /api/rooms (#1059).
  'correspondence-friend-link',
] as const;

export type RoomPairing = (typeof ROOM_PAIRINGS)[number];

/** The analytics value: a known pairing, or `unknown` when none arrived. */
export const UNKNOWN_ROOM_PAIRING = 'unknown' as const;
export type AnalyticsRoomPairing = RoomPairing | typeof UNKNOWN_ROOM_PAIRING;

const ROOM_PAIRING_SET: ReadonlySet<string> = new Set(ROOM_PAIRINGS);

export function isRoomPairing(value: unknown): value is RoomPairing {
  return typeof value === 'string' && ROOM_PAIRING_SET.has(value);
}

/**
 * Fail closed: anything that is not a known pairing, missing or misspelled,
 * reports `unknown`. Never maps an unknown value onto a known one.
 */
export function analyticsRoomPairing(value: unknown): AnalyticsRoomPairing {
  return isRoomPairing(value) ? value : UNKNOWN_ROOM_PAIRING;
}
