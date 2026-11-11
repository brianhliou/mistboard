// Where the viewer is, for links that are dead ends in some countries.
//
// The server stamps page navigations with an mb_cc cookie carrying
// Cloudflare's country code (apps/server/src/viewer-country.ts). Reading a
// cookie is synchronous, so the nav can decide before it paints. Discord is
// blocked in mainland China, which was about a third of visitors in Aug
// 2026; showing those visitors a link that hangs is worse than no link.
//
// No cookie (local dev, a direct hit that skipped Cloudflare, an unknown
// country) means show everything: hiding is only ever a known-blocked case.

export const VIEWER_COUNTRY_COOKIE = 'mb_cc';

// Country, not language: YouTube remains reachable in HK/TW/SG/MY.
export const YOUTUBE_BLOCKED_IN: readonly string[] = ['CN'];

export function viewerCountry(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === VIEWER_COUNTRY_COOKIE && value && /^[A-Z]{2}$/.test(value)) return value;
  }
  return null;
}

/** True when the viewer's country is on the link's blocked list. */
export function isBlockedForViewer(blockedIn: readonly string[] | undefined): boolean {
  if (!blockedIn || blockedIn.length === 0) return false;
  const country = viewerCountry();
  return country !== null && blockedIn.includes(country);
}
