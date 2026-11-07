// Rows for GET /api/relations/online-following (the header Friends menu): the
// viewer's follow set intersected with the in-memory presence map.
//
// Pure so the visibility and payload-shape rules are unit-tested without a
// database. The rules:
// - Private profiles never appear, even to their followers (the same gate as
//   /api/players/online).
// - A row carries exactly handle, displayName, title, rating, playing and
//   roomUrl. roomUrl is set only for a friend seated in a playing room, and is
//   the room's page path: a spectator who opens it gets the room's public view
//   (roomViewPolicy), so nothing about the position is added here.

import type { BestRatingEntry } from './persistence.js';
import type { PlayerTitle } from './persistence-titles.js';
import type { PresenceEntry } from './presence.js';

export type OnlineFollowingRow = {
  handle: string;
  displayName: string;
  title: PlayerTitle | null;
  rating: BestRatingEntry | null;
  playing: boolean;
  roomUrl: string | null;
};

export function onlineFollowingEntries(
  presence: readonly PresenceEntry[],
  following: ReadonlySet<string>,
): PresenceEntry[] {
  return presence
    .filter((entry) => following.has(entry.userId) && entry.profileVisibility !== 'private')
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

export function onlineFollowingRows(
  listed: readonly PresenceEntry[],
  stats: {
    playingUserIds: ReadonlySet<string>;
    playingRoomByUserId: ReadonlyMap<string, string>;
  },
  ratings: ReadonlyMap<string, BestRatingEntry>,
): OnlineFollowingRow[] {
  return listed.map((entry) => {
    const playing = stats.playingUserIds.has(entry.userId);
    const roomId = playing ? stats.playingRoomByUserId.get(entry.userId) : undefined;
    return {
      handle: entry.handle,
      displayName: entry.displayName,
      title: entry.title,
      rating: ratings.get(entry.userId) ?? null,
      playing,
      roomUrl: roomId ? `/room/${encodeURIComponent(roomId)}` : null,
    };
  });
}
