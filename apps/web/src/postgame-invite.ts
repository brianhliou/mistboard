// Post-game "challenge a friend" action, shared by BOTH room stacks (the
// chess/fog shell in live-room-actions.ts and the tenant shell in
// variant-tenant/room-chrome.ts) so the two can never drift apart.
//
// Why it exists: the room's post-game row offers a rematch (PvP) or another bot
// game (PvE), and nothing that produces a NEW human opponent. At current volume
// a live lobby is empty, so an opponent has to be carried in by a player.
//
// It deep-links to the homepage play dialog in "challenge a friend" mode rather
// than minting a challenge itself. The dialog already owns every decision this
// needs — live invite room vs correspondence cadence, side, time control — and
// it carries a mode switcher, so a player with no xiangqi-playing friends can
// swap to Find opponent without backing out. Minting a fixed 3-day
// correspondence seek here instead would pick all of that for them and land
// them on the share page with no way back.
//
// Fail-closed on the SAME predicate the deep link itself reads
// (deepLinkInitialVariant). That is load-bearing: maybeOpenPlayDeepLink falls
// through to `storedPreference ?? fallback` for anything it does not accept, so
// an ungated button would finish a jieqi game and open whatever dialog the
// player last used.
import { t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { landingPlayDeepLinkAccepts } from './landing-play.js';

export function canOfferPostGameInvite(variant: string | undefined): boolean {
  if (!variant) return false;
  return landingPlayDeepLinkAccepts(variant);
}

/** The post-game invite control, or null when this variant would not survive the
 *  deep link (unknown spec, or a tenant whose flag is off). */
export function postGameInviteButton(variant: string | undefined): HTMLElement | null {
  if (!variant || !canOfferPostGameInvite(variant)) return null;
  const link = document.createElement('a');
  link.className = 'room-invite-friend';
  // side=random: a friend challenge from the postgame row starts on the coin
  // flip, not on whatever side the player last picked in the friend dialog
  // (Brian finished a bot game as Red and the dialog opened on Black).
  link.href = localizedHref(`/?play=friend&variant=${encodeURIComponent(variant)}&side=random`);
  link.textContent = t('live.challengeFriend');
  return link;
}
