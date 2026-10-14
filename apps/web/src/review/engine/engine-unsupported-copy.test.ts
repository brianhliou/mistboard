import { describe, expect, it } from 'vitest';
import { engineUnsupportedCopy, isAppleMobile } from './engine-unsupported-copy.js';

const UA = {
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.76 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/139.0.3405.86 Mobile/15E148 Safari/605.1.15',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ asks for desktop sites with a Mac user agent by default.
  ipadDesktopMode:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
};

describe('engineUnsupportedCopy', () => {
  it('never names Safari to Chrome, Firefox or Edge on an iPhone', () => {
    // The reported bug: Chrome on iPhone was told "Safari cannot run it yet".
    // Every iOS browser is WebKit, so the OS version is the constraint.
    for (const userAgent of [UA.iphoneChrome, UA.iphoneFirefox, UA.iphoneEdge, UA.iphoneSafari]) {
      const copy = engineUnsupportedCopy({ userAgent, maxTouchPoints: 5 });
      expect(copy).toBe('Local engine needs iOS or iPadOS 15.2 or later.');
      expect(copy).not.toContain('Safari');
    }
  });

  it('treats an iPad asking for the desktop site as an iPad, not desktop Safari', () => {
    expect(isAppleMobile({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toBe(true);
    expect(engineUnsupportedCopy({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 })).toContain(
      'iPadOS',
    );
  });

  it('names Safari only for desktop Safari, with the version that isolates', () => {
    const copy = engineUnsupportedCopy({ userAgent: UA.macSafari, maxTouchPoints: 0 });
    expect(copy).toBe('Local engine needs Safari 15.2 or later.');
  });

  it('stays generic for any other browser that cannot isolate', () => {
    for (const userAgent of [UA.macChrome, UA.androidChrome]) {
      const copy = engineUnsupportedCopy({ userAgent, maxTouchPoints: 0 });
      expect(copy).toBe('Local engine is unavailable in this browser.');
    }
  });

  it('never promises a reload and uses no em dash', () => {
    for (const userAgent of Object.values(UA)) {
      for (const maxTouchPoints of [0, 5]) {
        const copy = engineUnsupportedCopy({ userAgent, maxTouchPoints });
        expect(copy.toLowerCase()).not.toContain('reload');
        expect(copy).not.toContain('—');
      }
    }
  });
});
