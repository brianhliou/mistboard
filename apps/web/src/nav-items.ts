import type { I18nKey } from './i18n/catalog.js';
import { STREAMERS } from './streamers-data.js';

export const SHOW_ENGINE_LAB_LINKS = import.meta.env.VITE_SHOW_ENGINE_LAB_NAV === 'true';

export interface NavItem {
  label: string;
  labelKey: I18nKey;
  href: string;
  // Rendered hidden for signed-out visitors. The nav builds before auth
  // resolves, so site-shell picks the initial visibility from the persisted
  // signed-in hint and account-nav reconciles it once /api/auth/me settles.
  signedInOnly?: boolean;
  // An off-site destination: rendered as-is (no locale prefix), opens in a new
  // tab, never marked active. No nav item is external today.
  external?: boolean;
  // Countries (ISO 3166-1 alpha-2) where the destination is unreachable, so the
  // item is not rendered for viewers there (viewer-geo.ts reads the country the
  // server stamped). A link that hangs is worse than no link.
  blockedIn?: readonly string[];
}

// NO SURFACE LINKS THE DISCORD as of 2026-08-31 (nav, footer and forum home all
// dropped it, in that order). These two are kept, unreferenced, because the
// invite is a fact worth holding: it never expires and has unlimited uses, and
// a discord.com/channels/... URL would only work for members. Wire them back up
// when the room is ready to be promoted; delete them if it never is.
//
// Discord (discord.com and discord.gg) is blocked in mainland China, which was
// about a third of visitors in Aug 2026, so any surface that links the invite
// has to gate on this list.
export const DISCORD_BLOCKED_IN: readonly string[] = ['CN'];
export const DISCORD_INVITE_URL = 'https://discord.gg/Qp6AZ6qAYm';

// Every entry in the video catalogue is a YouTube video, and the card art is
// derived from img.youtube.com, so a mainland visitor gets neither the video nor
// the thumbnail: the shelf renders as broken images, not as a quiet dead end.
// CN was 23% of visitors over the 30 days to 2026-09-06, second only to the US.
//
// COUNTRY, NOT LANGUAGE. Taiwan, Hong Kong, Macau, Singapore and Malaysia all
// reach YouTube, and together they were ~59 visitors in that same window, so the
// Chinese-language shelf serves them perfectly well. Gating on the zh locale
// rather than on CN would break the catalogue for precisely the readers it was
// built for, which is the wrong inference this constant exists to prevent. #378.
export const YOUTUBE_BLOCKED_IN: readonly string[] = ['CN'];

// ORDER IS LOAD-BEARING: site-shell destructures this positionally
// (`const [play, puzzles, watch] = primaryNavItems()`), so inserting an entry
// silently displaces the ones after it out of the nav. Add standalone links as
// their own export (see correspondenceNavItem) instead of growing this array.
export function primaryNavItems(): NavItem[] {
  return [
    { label: 'Play', labelKey: 'nav.play', href: '/' },
    { label: 'Puzzles', labelKey: 'nav.puzzles', href: '/puzzles' },
    { label: 'Watch', labelKey: 'nav.watch', href: '/watch' },
  ];
}

// Top-nav Community dropdown (lichess-aligned order): Players (the leaderboard),
// Coaches (the verified-coach directory), Friends (your following list), Forum,
// Blog (the articles surface). Teams is deliberately deferred. Kept distinct
// from communityRailItems(): the dropdown is the wide social entry, the rail is
// the leaderboard/bots sub-nav.
//
// The Discord invite was here from 2026-08-27 and was pulled on 2026-08-28,
// then out of the homepage footer and the forum home on 2026-08-31: not
// defects, a decision to stop promoting the Discord while it is still empty.
// No surface links it now (see the constants above).
// Play dropdown. The title itself navigates to the lobby (lichess split-menu
// behavior, same as Watch and Community), and the panel repeats it explicitly:
// on touch / no-hover devices tapping the title opens the panel instead of
// navigating, so without the explicit item there would be no way to reach the
// lobby from this menu.
//
// Correspondence is here because the page has existed since correspondence
// shipped but was reachable ONLY from the notification bell (which shows only
// when a game already needs your move) and a footer link on the page itself, so
// a player with several games in flight had no menu path to them. Signed-in
// only, so it costs a visitor nothing.
export function playNavItems(): NavItem[] {
  return [
    { label: 'Lobby', labelKey: 'nav.lobby', href: '/' },
    {
      label: 'Correspondence',
      labelKey: 'nav.correspondence',
      href: '/correspondence',
      signedInOnly: true,
    },
  ];
}

export function communityNavItems(): NavItem[] {
  return [
    { label: 'Players', labelKey: 'nav.players', href: '/player' },
    { label: 'Friends', labelKey: 'nav.friends', href: '/following', signedInOnly: true },
    { label: 'Forum', labelKey: 'nav.forum', href: '/forum' },
    { label: 'Blog', labelKey: 'nav.blog', href: '/blog' },
  ];
}

// Community sub-navigation rail (lichess parity): Leaderboard + Online bots for
// now. Forum lives in the top-nav dropdown, not the rail.
export function communityRailItems(): NavItem[] {
  return [
    { label: 'Leaderboard', labelKey: 'nav.leaderboard', href: '/player' },
    { label: 'Rating stats', labelKey: 'nav.ratingStats', href: '/player/rating-stats' },
    { label: 'Online bots', labelKey: 'nav.onlineBots', href: '/bots' },
  ];
}

// Learn dropdown (lichess parity): rules are the durable starting point,
// followed by the interactive xiangqi course, then Studies and the verified-coach
// directory. The title itself links to /rules.
export function learnNavItems(): NavItem[] {
  return [
    { label: 'Rules', labelKey: 'nav.rules', href: '/rules' },
    { label: 'Xiangqi Basics', labelKey: 'nav.learnXiangqi', href: '/learn/xiangqi' },
    // Between the course and studies, which is where it sits pedagogically: the
    // course teaches the moves, practice drills positions, a study is reading.
    { label: 'Practice', labelKey: 'nav.practice', href: '/practice' },
    { label: 'Study', labelKey: 'nav.studies', href: '/study' },
    { label: 'Coaches', labelKey: 'nav.coaches', href: '/coach' },
  ];
}

// Public support link, rendered as the rightmost public nav item (left of the
// admin-only menu). Points at the existing /patron page. Labelled "Support",
// not "Donate": the page sells an optional patron subscription from a
// for-profit sole proprietorship, and donation wording reads as charitable
// fundraising to payment-processor review.
export function donateNavItem(): NavItem {
  return { label: 'Support', labelKey: 'nav.donate', href: '/patron' };
}

export function adminNavItems(): NavItem[] {
  return [
    { label: 'Database', labelKey: 'nav.database', href: '/database' },
    { label: 'Engines', labelKey: 'nav.engines', href: '/engines' },
    { label: 'Accounts', labelKey: 'nav.accounts', href: '/accounts' },
    { label: 'Titles', labelKey: 'nav.titles', href: '/titles' },
    { label: 'Readouts', labelKey: 'nav.readouts', href: '/readouts' },
    { label: 'Metrics', labelKey: 'nav.metrics', href: '/metrics' },
    { label: 'Broadcast ops', labelKey: 'nav.broadcastOps', href: '/broadcast/xiangqi/ops' },
  ];
}

// Watch dropdown (lichess parity): the title links to Mistboard TV (/watch), and
// the panel lists Mistboard TV explicitly alongside tournament Broadcasts. The
// explicit TV item matters on touch / no-hover devices, where tapping the title
// opens the panel instead of navigating — without it there'd be no way to reach
// /watch from this menu. Kept minimal until there are more watch surfaces
// (streamers, video) to list.
export function watchNavItems(): NavItem[] {
  return [
    // Tournament broadcasts lead the menu (lichess's order): the top events,
    // live and archived, are the headline thing to watch.
    { label: 'Broadcasts', labelKey: 'nav.broadcasts', href: '/broadcast/xiangqi' },
    { label: 'Mistboard TV', labelKey: 'nav.tv', href: '/watch' },
    // Every game in progress right now, live and correspondence (lichess's
    // "Current games"). Distinct from the finished-games database under Tools.
    { label: 'Current games', labelKey: 'nav.currentGames', href: '/games' },
    // Streamers appears only once the curated directory has someone in it.
    // Deriving the link from the data means an empty /streamer is never
    // reachable from the nav, and seeding the first entry needs no second edit.
    ...(STREAMERS.length > 0
      ? [{ label: 'Streamers', labelKey: 'nav.streamers' as const, href: '/streamer' }]
      : []),
    {
      label: 'Video library',
      labelKey: 'nav.videoLibrary',
      href: '/videos',
      // An on-site page, but every card on it links out to YouTube.
      blockedIn: YOUTUBE_BLOCKED_IN,
    },
  ];
}

export function utilityNavItems(): NavItem[] {
  const items: NavItem[] = [];
  if (SHOW_ENGINE_LAB_LINKS) items.push({ label: 'Lab', labelKey: 'nav.lab', href: '/lab' });
  return items;
}

// Tools dropdown (lichess parity): the analysis board is the anchor tool, the
// board editor sits beside it, and the games database closes the set the way
// lichess's advanced search does, with Import beside them.
//
// The games database moved here from Watch (2026-08-28) on live-vs-finished, not
// browse-vs-query: Mistboard TV and Current games are things happening now, and
// a finished-games list between them reads as a third live surface. It lives at
// /games/search (lichess: "Advanced search") since /games became the
// current-games page (2026-09-02). Note the page is NOT lichess's empty search
// form. Unfiltered it lists the 50 most recently finished games, so it browses
// as well as queries; that landing feed is the part worth keeping if this ever
// gets rebuilt for parity.
export function toolsNavItems(): NavItem[] {
  return [
    { label: 'Analysis board', labelKey: 'nav.analysis', href: '/analysis/xiangqi' },
    { label: 'Board editor', labelKey: 'nav.editor', href: '/editor/xiangqi' },
    { label: 'Import game', labelKey: 'nav.import', href: '/import' },
    { label: 'Advanced search', labelKey: 'nav.gamesSearch', href: '/games/search' },
    ...utilityNavItems(),
  ];
}
