import { describe, expect, it } from 'vitest';
import { landingPlayDeepLinkAccepts } from './landing-play.js';
import { canOfferPostGameInvite, postGameInviteButton } from './postgame-invite.js';

// Both room stacks (live-room-actions.ts and variant-tenant/room-chrome.ts)
// render the post-game invite through this one module, so these pin the shared
// contract rather than either call site's own behavior.
describe('canOfferPostGameInvite', () => {
  it('offers the invite for the always-on landing surfaces', () => {
    for (const specId of ['dark-chess', 'xiangqi', 'jieqi', 'banqi']) {
      expect(canOfferPostGameInvite(specId)).toBe(true);
    }
  });

  it('agrees with the play deep link for every spec it can see', () => {
    // Load-bearing: maybeOpenPlayDeepLink falls through to the player's stored
    // preference for anything it does not accept, so a button offered where the
    // deep link is refused would open whatever game they last set up. Includes
    // Mini Xiangqi, whose link was retired 2026-09-04.
    for (const specId of [
      'dark-chess',
      'xiangqi',
      'jieqi',
      'banqi',
      'jungle',
      'jungle-flip',
      'fortress-xiangqi',
      'mini-xiangqi',
      'dark-xiangqi',
    ]) {
      expect(canOfferPostGameInvite(specId), specId).toBe(landingPlayDeepLinkAccepts(specId));
    }
  });

  it('does not offer a retired variant', () => {
    // Retired 2026-09-04: hidden from the picker AND no longer deep-linkable, so
    // the post-game row must stop offering it too.
    expect(canOfferPostGameInvite('mini-xiangqi')).toBe(false);
  });

  it('fails closed on an absent or unknown variant', () => {
    expect(canOfferPostGameInvite(undefined)).toBe(false);
    expect(canOfferPostGameInvite('')).toBe(false);
    expect(canOfferPostGameInvite('not-a-variant')).toBe(false);
  });
});

describe('postGameInviteButton', () => {
  it('links into the friend mode of the play dialog, carrying the variant', () => {
    const el = postGameInviteButton('xiangqi');
    expect(el?.tagName).toBe('A');
    const href = el?.getAttribute('href') ?? '';
    expect(href).toContain('play=friend');
    expect(href).toContain('variant=xiangqi');
    // The friend game starts on the coin flip, not the last remembered side.
    expect(href).toContain('side=random');
  });

  it('renders nothing rather than a link that would open another variant', () => {
    expect(postGameInviteButton('mini-xiangqi')).toBeNull();
    expect(postGameInviteButton('not-a-variant')).toBeNull();
    expect(postGameInviteButton(undefined)).toBeNull();
  });
});
