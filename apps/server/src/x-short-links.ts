// Short links for the site's X posts: mistboard.com/x/<slug> answers a 302 to a
// page on the site with the post's UTM tags added. 302, not 301, so a slug can
// be repointed after the post is out. An unknown slug lands on the homepage
// tagged x-unknown rather than a 404: someone clicked it, so it still counts.
//
// The posts are classical xiangqi problems. Each one opens the analysis board
// on that single position with the book's solution line, never the study it
// comes from: a reader gets the one problem, not the whole collection.
//
// Adding a link: one entry below (fen + moves in Fairy-Stockfish UCI, ranks
// 1-10, as the study API's `uci` fields spell them, plus the campaign). The
// test replays every line from its FEN with the rules kernel.

/** A position for /analysis/xiangqi: the board opens on `fen` with `moves` loaded. */
export interface XShortLinkPosition {
  fen: string;
  /** The solution line, space-separated UCI moves from `fen`. */
  moves: string;
}

export interface XShortLink {
  target: XShortLinkPosition;
  /** utm_campaign, slug + month (see CLAUDE.md "Tag every link you post"). */
  campaign: string;
}

export const X_SHORT_LINKS: Readonly<Record<string, XShortLink>> = {
  // Elegant Pastime Manual, problem 1 (study 0Qi14WbN, chapter UQjmw2Xb).
  '1': {
    target: {
      fen: '2baka3/3P3N1/bN7/7nc/9/4C1P2/P5n1P/B3R3B/4Apr2/2RAK3c r - - 0 1',
      moves: 'e5a5 g4e3 d9d10 e10d10 c1c10 a8c10 a5a10 c10e8 b8c10 d10d9 h9f10',
    },
    campaign: 'x-elegant-001-2026-10',
  },
  // Problem 2 (chapter 7WU2O9Fy).
  '2': {
    target: {
      fen: 'C3kab2/4a4/n3c1n2/p2Np1p2/1R4P2/1R7/P3P4/4B4/2Cp1p3/c1rAK1N2 r - - 0 1',
      moves:
        'b6b10 e9d10 b10b9 d10e9 c2c10 a8b10 c10c2 e9d10 b9e9 f10e9 d7c9 e10f10 b5f5 e8f8 ' +
        'f5f8 e9f8 c2f2 f8e9 g1f3 e9f8 f3h4 f8e9 h4f5 e9f8 f5e7 f8e9 e7g8 f10f9 g8e7 f9f10 ' +
        'e7f5 e9f8 f5g7 f8e9 g7h9 f10f9 h9f8 f9f8 g6f6',
    },
    campaign: 'x-elegant-002-2026-10',
  },
  // Problem 3 (chapter huGqmfeR).
  '3': {
    target: {
      fen: '1rbckaP2/3PaP1r1/1P2b4/1R7/Nn7/CRBp1n3/4C4/9/4p1p2/1c3K3 r - - 0 1',
      moves:
        'g10f10 d10f10 d9e9 e10d10 e9e10 d10d9 b7d7 b6d7 a6c7 d9d8 b8c8 d8d9 b5b9 b10b9 c8b8 d9d8 a5a8',
    },
    campaign: 'x-elegant-003-2026-10',
  },
};

const UNKNOWN_CAMPAIGN = 'x-unknown';

// The YouTube Shorts address, mistboard.com/yt: shown at the end of every
// Short and used as the channel's profile link (a Short's description and
// comments cannot hold a clickable link). A Short has just shown its problem
// solved, so this opens the next problem's position with no solution loaded.
// Repoint YT_NEXT_SLUG when a new Short goes up.
const YT_NEXT_SLUG = '2';
const YT_CAMPAIGN = 'yt-shorts-2026-10';

function targetPath(target: XShortLinkPosition): string {
  // ply=0 opens the board on the problem, with the solution there to step
  // through; without it the analysis board opens on the line's last move.
  const params = new URLSearchParams({ fen: target.fen, moves: target.moves, ply: '0' });
  return `/analysis/xiangqi?${params.toString()}`;
}

function withUtm(path: string, campaign: string): string {
  const utm = new URLSearchParams({
    utm_source: 'x',
    utm_medium: 'social',
    utm_campaign: campaign,
  });
  return `${path}${path.includes('?') ? '&' : '?'}${utm.toString()}`;
}

/** The redirect target for /x/<slug>, or null when the path is not a short link. */
export function xShortLinkRedirect(pathname: string): string | null {
  if (/^\/yt\/?$/.test(pathname)) {
    const fen = X_SHORT_LINKS[YT_NEXT_SLUG]!.target.fen;
    const utm = new URLSearchParams({
      fen,
      utm_source: 'youtube',
      utm_medium: 'video',
      utm_campaign: YT_CAMPAIGN,
    });
    return `/analysis/xiangqi?${utm.toString()}`;
  }
  const match = /^\/x\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    return withUtm('/', UNKNOWN_CAMPAIGN);
  }
  const link = Object.hasOwn(X_SHORT_LINKS, slug) ? X_SHORT_LINKS[slug] : undefined;
  if (!link) return withUtm('/', UNKNOWN_CAMPAIGN);
  return withUtm(targetPath(link.target), link.campaign);
}
