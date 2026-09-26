// A player's title tag (lichess-style, shown before the name): authored on the
// profile first, else the player's last entry on the official CXA list
// (特级大师 is GM, 象棋大师 NM). Its own module so a page that only needs the
// tag, like a broadcast's game list, does not load the player pages.

import { CXA_RATINGS } from './cxa-ratings.js';
import { PLAYER_PROFILES, type PlayerTitle } from './profiles.js';
import { sanctionFor, titleMayShow } from './sanctions.js';

export function playerTitleFor(player: {
  /** The player page slug, when known; else guessed from the English name. */
  slug?: string | null;
  name: string;
  nameEn?: string | null;
}): PlayerTitle | null {
  // A grade the match-fixing rulings may have revoked is not shown (sanctions.ts).
  if (!titleMayShow(sanctionFor(player.name))) return null;
  const slug = player.slug ?? slugGuess(player.nameEn);
  const authored = slug ? PLAYER_PROFILES[slug]?.title : undefined;
  if (authored) return authored;
  const entries = CXA_RATINGS[player.name];
  const last = entries?.[entries.length - 1];
  return last?.title === '特' ? 'GM' : last?.title === '大' ? 'NM' : null;
}

function slugGuess(nameEn: string | null | undefined): string | null {
  const slug = nameEn
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}
