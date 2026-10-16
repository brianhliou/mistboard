// What the engine panel says when the threaded local engine cannot run here.
//
// The real constraint is cross-origin isolation, not a browser brand. The
// review routes ask for it with `COEP: require-corp` (#276; it was
// credentialless until 2026-10-14, which WebKit ignores, so no iPhone, iPad or
// Safari page ever isolated). WebKit isolates under require-corp from 15.2, so
// on Apple devices the page now fails to isolate only on an older OS or Safari,
// and the copy names that version. Every browser on iPhone and iPad is WebKit
// underneath, so Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) there depend
// on the OS version, not on the app, and naming "Safari" to someone using
// Chrome on an iPhone reads as a misdetected browser. So the copy names the
// platform on iOS/iPadOS, Safari only for desktop Safari, and nothing more
// specific than "this browser" anywhere else.

export interface BrowserIdentity {
  userAgent: string;
  /** iPadOS 13+ reports a desktop Mac user agent; touch points tell it apart. */
  maxTouchPoints: number;
}

/** iPhone, iPad or iPod, whichever browser app is on top of WebKit. */
export function isAppleMobile({ userAgent, maxTouchPoints }: BrowserIdentity): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Desktop Safari: WebKit's own browser, not a Chromium or Gecko one. */
function isDesktopSafari({ userAgent }: BrowserIdentity): boolean {
  return (
    /Safari\//.test(userAgent) &&
    /Version\//.test(userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(userAgent)
  );
}

export function engineUnsupportedCopy(browser: BrowserIdentity): string {
  if (isAppleMobile(browser)) {
    return 'Local engine needs iOS or iPadOS 15.2 or later.';
  }
  if (isDesktopSafari(browser)) {
    return 'Local engine needs Safari 15.2 or later.';
  }
  return 'Local engine is unavailable in this browser.';
}
