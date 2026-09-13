import { readAccountPreferences } from './account-preferences.js';
import { currentLocale, type Locale } from './i18n/locale.js';

// Client-side twin of apps/server/src/forum-translation.ts detectScriptLanguage.
// Decides whether a Translate button is worth showing for a piece of forum
// text under the viewer's locale; the server applies the same rule before it
// spends anything, so a stale client cannot force a same-language call.
//
// A script heuristic, not language identification: Han text reads as Chinese
// to an English viewer, Latin text reads as foreign to a Chinese viewer.
// Simplified vs Traditional is not separable cheaply and converting between
// them is a different feature, so a Han post is "same language" for both zh
// locales.

export type ScriptLanguage = 'zh' | 'latin' | 'unknown';

const HAN_RE = /\p{Script=Han}/gu;
const LATIN_RE = /\p{Script=Latin}/gu;
// URLs and @handles are Latin in any language; not evidence about the prose.
const NOISE_RE = /https?:\/\/\S+|@\w+/g;

export function detectScriptLanguage(text: string): ScriptLanguage {
  const prose = text.replace(NOISE_RE, ' ');
  const han = prose.match(HAN_RE)?.length ?? 0;
  const latin = prose.match(LATIN_RE)?.length ?? 0;
  // Under three letters there is nothing to translate: bare move notation,
  // a number, an emoji reply.
  if (han + latin < 3) return 'unknown';
  return han / (han + latin) >= 0.3 ? 'zh' : 'latin';
}

export function translationNeeded(text: string, target: Locale): boolean {
  const script = detectScriptLanguage(text);
  if (script === 'unknown') return false;
  if (script === 'zh') return target === 'en';
  return target !== 'en';
}

// Whether forum reads should open in the viewer's locale when the server's
// translation cache already holds the text. An account preference, mirrored
// to localStorage by account-preferences.ts; a guest gets the default (on).
export function forumAutoTranslateEnabled(): boolean {
  return readAccountPreferences().forumAutoTranslate;
}

// `?locale=` for the forum read endpoints. The server overlays cached
// translations only when asked, so the parameter is sent only when the reader
// wants them; a reader who turned the preference off costs no cache lookup.
export function appendForumLocale(params: URLSearchParams): void {
  if (forumAutoTranslateEnabled()) params.set('locale', currentLocale());
}
