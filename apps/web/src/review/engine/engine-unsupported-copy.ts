// What the engine panel says when the threaded local engine cannot run here.
//
// The real constraint is cross-origin isolation, not a browser brand. The
// review routes ask for it with `COEP: credentialless`; WebKit does not
// implement credentialless, so a WebKit page never isolates, has no
// SharedArrayBuffer, and the threaded engines (Fairy-Stockfish, Pikafish,
// PikaJieQi) cannot start (#276). Every browser on iPhone and iPad is WebKit
// underneath, so Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) there are in
// exactly the same position as Safari, and naming "Safari" to someone using
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
    return 'Local engine is unavailable on iPhone and iPad for now, in every browser.';
  }
  if (isDesktopSafari(browser)) {
    return 'Local engine is unavailable in Safari for now. Chrome, Edge and Firefox can run it.';
  }
  return 'Local engine is unavailable in this browser.';
}
