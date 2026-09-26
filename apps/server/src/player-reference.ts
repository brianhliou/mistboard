// The CXA reference data behind the player pages' server-side meta (#458).
// The lists and title tags are authored in the web app (apps/web/src/players/),
// which the server cannot import; the web prerender writes each player's latest
// entry to dist/players-reference.json and this module reads it. dist is fixed
// for the life of a deploy, but the file is re-read after a minute like
// article-schedule.json, so a test or a local rebuild is picked up without a
// restart. A missing or malformed file reads as empty: the pages keep their
// archive facts and lose only the official-list line.

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

export type PlayerPointsEntry = {
  points: number;
  rank: number;
  group: 'men' | 'women';
  /** Size of the list the rank is out of, when known. */
  of: number | null;
  listDate: string | null;
};

export type PlayerRatingEntry = {
  rating: number;
  rank: number | null;
  of: number | null;
  listLabel: string;
};

export type PlayerTitleTag = 'GM' | 'NM';

export type PlayerReference = {
  points: Readonly<Record<string, PlayerPointsEntry>>;
  ratings: Readonly<Record<string, PlayerRatingEntry>>;
  titlesByName: Readonly<Record<string, PlayerTitleTag>>;
  titlesBySlug: Readonly<Record<string, PlayerTitleTag>>;
  /** The match-fixing rulings' sentence per named player, by archive name. */
  sanctions: Readonly<Record<string, string>>;
};

export const EMPTY_PLAYER_REFERENCE: PlayerReference = {
  points: {},
  ratings: {},
  titlesByName: {},
  titlesBySlug: {},
  sanctions: {},
};

const CACHE_MS = 60_000;
const cache = new Map<string, { readAt: number; reference: PlayerReference }>();

function record<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

export function parsePlayerReference(json: string): PlayerReference {
  const raw = record<unknown>(JSON.parse(json));
  return {
    points: record<PlayerPointsEntry>(raw.points),
    ratings: record<PlayerRatingEntry>(raw.ratings),
    titlesByName: record<PlayerTitleTag>(raw.titlesByName),
    titlesBySlug: record<PlayerTitleTag>(raw.titlesBySlug),
    sanctions: record<string>(raw.sanctions),
  };
}

export async function readPlayerReference(
  staticDir: string,
  now: number = Date.now(),
): Promise<PlayerReference> {
  const hit = cache.get(staticDir);
  if (hit && now - hit.readAt < CACHE_MS) return hit.reference;
  const reference = await fs
    .readFile(resolve(staticDir, 'players-reference.json'), 'utf-8')
    .then(parsePlayerReference)
    .catch(() => EMPTY_PLAYER_REFERENCE);
  cache.set(staticDir, { readAt: now, reference });
  return reference;
}

/** The title tag the web page shows (players/player-title.ts): authored on the
 *  profile first, else the player's last official list. */
export function referenceTitle(
  reference: PlayerReference,
  player: { slug: string; name: string },
): PlayerTitleTag | null {
  return reference.titlesBySlug[player.slug] ?? reference.titlesByName[player.name] ?? null;
}

export const TITLE_WORDS: Readonly<Record<PlayerTitleTag, string>> = {
  GM: 'Grandmaster',
  NM: 'National master',
};
