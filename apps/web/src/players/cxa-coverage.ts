// Per-name CXA lookups for the player pages (#458), alias-aware, so a lookup
// never misses a player whose CXA spelling differs from the archive's. Which
// CXA-listed players get a page is the server's call: it lists them from
// apps/server/src/cxa-listed-players.ts, baked from these modules by
// apps/server/src/scripts/bake-cxa-listed-players.ts. No DOM here.

import { CXA_POINTS, type CxaPointsEntry } from './cxa-points.js';
import { CXA_RATINGS, type CxaEntry } from './cxa-ratings.js';

/**
 * CXA spelling -> the archive's spelling, where the published list writes a
 * name with a variant or traditional character the broadcast source does not
 * (the points list is OCR'd from the CXA's own post and is never auto-renamed,
 * docs-private/players/cxa-points.py). Hand-kept: each pair was checked as
 * one player on the women's list and in the women's team championship.
 */
export const CXA_NAME_ALIASES: Readonly<Record<string, string>> = {
  粱妍婷: '梁妍婷',
  黃蕾蕾: '黄蕾蕾',
  吳荣萱: '吴荣萱',
  郞褀琪: '郎祺琪',
};

const CXA_SPELLING: ReadonlyMap<string, string> = new Map(
  Object.entries(CXA_NAME_ALIASES).map(([cxa, archive]) => [archive, cxa]),
);

/** The name as the CXA lists key it. */
function cxaKey(name: string): string {
  return CXA_SPELLING.get(name) ?? name;
}

/** The player's entries on the 2026 CXA points lists, oldest first. */
export function cxaPointsFor(name: string): readonly CxaPointsEntry[] {
  return CXA_POINTS[name] ?? CXA_POINTS[cxaKey(name)] ?? [];
}

/** The player's entries on the closed 等级分 lists (2019 to 2023), oldest first. */
export function cxaRatingsFor(name: string): readonly CxaEntry[] {
  return CXA_RATINGS[name] ?? CXA_RATINGS[cxaKey(name)] ?? [];
}

export type PlayerGroup = 'men' | 'women';

/** The list the CXA files the player on: the points list's group, else the
 *  等级分 lists, which are the men's lists (男子棋手等级分). */
export function cxaGroupFor(name: string): PlayerGroup | null {
  const points = cxaPointsFor(name);
  const last = points[points.length - 1];
  if (last) return last.group;
  return cxaRatingsFor(name).length > 0 ? 'men' : null;
}

/** Every CXA-listed player, in the archive's spelling, with their list's
 *  group; sorted by code point so a bake of it is stable. */
export function cxaListedPlayers(): { name: string; group: PlayerGroup }[] {
  const names = new Set<string>();
  for (const name of [...Object.keys(CXA_POINTS), ...Object.keys(CXA_RATINGS)]) {
    names.add(CXA_NAME_ALIASES[name] ?? name);
  }
  return [...names]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({ name, group: cxaGroupFor(name) ?? 'men' }));
}
