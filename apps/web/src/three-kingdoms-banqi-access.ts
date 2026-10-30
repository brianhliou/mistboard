// Three Kingdoms banqi (#628) entry on the web: the admin prod playtest (#684).
//
// The variant's code ships in every build, but the way in (the play-menu
// option, the ?play deep link, the bot, the room client) is offered only to a
// session the server would seat: the local build flag, or an admin account.
// Cosmetic like the other signed-in hints: the server's create route and
// WebSocket gate (apps/server/src/three-kingdoms-banqi-access.ts) are the gate,
// so a forged admin hint buys a menu item and still no room.
//
// Nothing public lists the variant either way: its rules page, rail entry,
// News, sitemap and article stay behind the build flag alone
// (variant-public-surfaces.ts), which production never sets.
import { threeKingdomsBanqiEnabled, threeKingdomsBanqiEngineEnabled } from './feature-flags.js';
import { isLikelyAdmin } from './signed-in-state.js';

export function threeKingdomsBanqiOffered(): boolean {
  return threeKingdomsBanqiEnabled() || isLikelyAdmin();
}

// The bot rides the same door. On prod the server has the fetched engine
// binary (railpack), so an admin is offered it; locally the build says so.
export function threeKingdomsBanqiEngineOffered(): boolean {
  return threeKingdomsBanqiEngineEnabled() || isLikelyAdmin();
}
