// Campaign tags for the links the site's own share and copy controls hand
// out (#1223). A visitor who arrives from a pasted game, challenge, review,
// broadcast or invite link then shows up in analytics as a share, not as a
// direct visit, with the control that made the link as its campaign.
//
// Only the three utm parameters are added: nothing about the sharer, their
// seat or the room goes into the URL. Every other parameter, the path and the
// hash stay as they were, so an invite link that carries an id keeps working.
// A link that already names a source (a campaign link someone opened, then
// shared on) keeps its tags. A link to another site is returned unchanged.

export const SHARE_CAMPAIGNS = {
  game: 'game',
  challenge: 'challenge',
  review: 'review',
  broadcast: 'broadcast',
  invite: 'invite',
} as const;

export type ShareCampaign = keyof typeof SHARE_CAMPAIGNS;

export const SHARE_UTM_SOURCE = 'share';
export const SHARE_UTM_MEDIUM = 'referral';

const SITE_HOSTS = new Set(['mistboard.com', 'www.mistboard.com']);

function isOwnSite(url: URL): boolean {
  return url.origin === window.location.origin || SITE_HOSTS.has(url.hostname);
}

export function tagShareUrl(url: string, campaign: ShareCampaign): string {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.origin);
  } catch {
    return url;
  }
  if (!isOwnSite(parsed)) return url;
  if (parsed.searchParams.has('utm_source')) return parsed.href;
  parsed.searchParams.set('utm_source', SHARE_UTM_SOURCE);
  parsed.searchParams.set('utm_medium', SHARE_UTM_MEDIUM);
  parsed.searchParams.set('utm_campaign', SHARE_CAMPAIGNS[campaign]);
  return parsed.href;
}
