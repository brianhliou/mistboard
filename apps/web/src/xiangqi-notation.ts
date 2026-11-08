// Web-side resolution of the xiangqi move-notation display preference to a
// concrete @mistboard/game formatter style. The stored preference is
// script-neutral ('chinese'); the locale picks the glyph set at resolve time
// so a zh-Hant reader sees 馬8進7 and everyone else 马8进7. With nothing
// stored the default is the piece set's guess: Chinese wherever pieces start as
// hanzi, algebraic else.

import type { XiangqiNotationStyle } from '@mistboard/game';
import type { EmbedNotation } from './embed/embed-route.js';
import { currentLocale, isArticleLocale } from './i18n/locale.js';
import {
  inferredChineseScript,
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
  return notationOverride ?? readStoredXiangqiNotation();
}

// A Chinese interface writes moves in its own script; an English one in the
// script its reader was guessed to read.
function chineseScript(): 'zh-Hans' | 'zh-Hant' {
  const locale = currentLocale();
  return isArticleLocale(locale) ? locale : inferredChineseScript();
}

export function currentXiangqiNotationStyle(): XiangqiNotationStyle {
  switch (currentXiangqiNotationPreference()) {
    case 'chinese':
      return chineseScript() === 'zh-Hant' ? 'chinese-traditional' : 'chinese-simplified';
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
