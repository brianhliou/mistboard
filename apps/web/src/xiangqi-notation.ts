// Web-side resolution of the xiangqi move-notation display preference to a
// concrete @mistboard/game formatter style. The stored preference is
// script-neutral ('chinese'); the locale picks the glyph set at resolve time
// so a zh-Hant reader sees 馬8進7 and everyone else 马8进7. With nothing
// stored the locale also picks the default: Chinese for zh, algebraic else.

import type { XiangqiNotationStyle } from '@mistboard/game';
import type { EmbedNotation } from './embed/embed-route.js';
import { currentLocale } from './i18n/locale.js';
import {
  readStoredXiangqiNotation,
  type XiangqiNotationPreference,
} from './xiangqi-appearance-storage.js';

/**
 * Set by an embed whose host page has asked for one notation, mirroring
 * pinSiteTheme: an in-memory override, never written to storage. The embed runs
 * on mistboard.com's origin, so writing would silently change the reader's own
 * setting for the whole site from inside a third party's page.
 */
let notationOverride: EmbedNotation | null = null;

/** Pin (or, with null, release) the in-memory notation override. An embed may
 *  still ask for coordinate or ICCS labels, which the gear no longer offers. */
export function pinXiangqiNotation(preference: EmbedNotation | null): void {
  notationOverride = preference;
}

/** Fired (on window) after the stored notation preference changes; review
 *  surfaces relabel their move trees on it. */
export const xiangqiNotationChangedEvent = 'mistboard:xiangqi-notation-changed';

/** The reader's notation preference, with the locale default applied. */
export function currentXiangqiNotationPreference(): EmbedNotation | XiangqiNotationPreference {
  return notationOverride ?? readStoredXiangqiNotation(currentLocale());
}

export function currentXiangqiNotationStyle(): XiangqiNotationStyle {
  switch (currentXiangqiNotationPreference()) {
    case 'chinese':
      return currentLocale() === 'zh-Hant' ? 'chinese-traditional' : 'chinese-simplified';
    case 'wxf':
      return 'wxf';
    case 'iccs':
      return 'iccs';
    case 'coordinate':
      return 'coordinate';
    default:
      return 'algebraic';
  }
}
