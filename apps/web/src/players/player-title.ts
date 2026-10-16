// A player's title tag (lichess-style, shown before the name). Its own module
// so a page that only needs the tag, like a broadcast's game list, does not
// load the player pages.
//
// Precedence, first match wins:
//   1. No tag for a player whose CXA grade a match-fixing ruling revoked
//      (titles.ts CXA_REVOKED: the 19 the rulings name, every life ban among
//      them). A ban that did not revoke the grade leaves the tag. The WXF
//      title of a revoked player is not shown either: the WXF list predates
//      the rulings, and a tag the CXA took away should not come back by
//      another route.
//   2. The title authored on the player's profile (profiles.ts).
//   3. The CXA grade: 特级大师 GM, 国家大师 NM (titles.ts), when an official
//      notice or the press sources it; aggregator-only grades show no tag.
//   4. The WXF title: International Grandmaster GM, International Master IM,
//      Federation Master FM (titles.ts).
//   5. The player's last entry on the closed 等级分 lists (cxa-ratings.ts).
// The CXA grade goes before the WXF title because for a player under the CXA
// it is the title Chinese broadcasts and the press use, it is current where the
// WXF list stopped in December 2022, and the two ladders do not line up: a
// Chinese national master can hold a WXF grandmaster title won for Macau or
// Hong Kong (曹岩磊), and reads as NM at home. A player outside the CXA has
// only the WXF title, so it decides.

import { CXA_RATINGS } from './cxa-ratings.js';
import { PLAYER_PROFILES, type PlayerTitle } from './profiles.js';
import { CXA_GRADES, CXA_REVOKED, WXF_TITLES, type WxfTitle } from './titles.js';

const WXF_TAG: Readonly<Record<WxfTitle, PlayerTitle>> = { IGM: 'GM', IM: 'IM', FM: 'FM' };

export function playerTitleFor(player: {
  /** The player page slug, when known; else guessed from the English name. */
  slug?: string | null;
  name: string;
  nameEn?: string | null;
}): PlayerTitle | null {
  if (CXA_REVOKED[player.name]) return null;
  const slug = player.slug ?? slugGuess(player.nameEn);
  const authored = slug ? PLAYER_PROFILES[slug]?.title : undefined;
  if (authored) return authored;
  // A grade only an aggregator lists (dpxq's directory, Wikipedia) stays in
  // the data but shows no tag: a title is a claim about a person, and it
  // needs an official notice or the press behind it.
  const grade = CXA_GRADES[player.name];
  if (grade && grade.confidence !== 'aggregator') return grade.grade;
  const wxf = WXF_TITLES[player.name];
  if (wxf) return WXF_TAG[wxf.title];
  const entries = CXA_RATINGS[player.name];
  const last = entries?.[entries.length - 1];
  return last?.title === '特' ? 'GM' : last?.title === '大' ? 'NM' : null;
}

/** Every name a title source knows, for a bake that must cover them all (the
 *  server's players-reference.json). */
export function titledNames(): string[] {
  return [
    ...new Set([
      ...Object.keys(CXA_GRADES),
      ...Object.keys(WXF_TITLES),
      ...Object.keys(CXA_RATINGS),
    ]),
  ];
}

function slugGuess(nameEn: string | null | undefined): string | null {
  const slug = nameEn
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}
