// First paint of the phone bar's pieces button (site-shell.ts
// buildNavQuickControls). The button previews the reader's own xiangqi set, but
// a prerendered page bakes the set the build resolved for that page's locale,
// and marks the slot with it (data-piece-set). Until main.ts runs, a reader whose
// set differs saw the baked icon and then a visible swap to their own.
//
// The inline script in index.html's <head>, beside the theme script, computes
// the set this reader will get: the same id readStoredXiangqiPieceSet() returns
// at boot (the ?xqPieces= preview, a valid stored pick after the version and
// retired-id handling, legacy ids mapped, else the first-locale / browser
// language / mb_cc country inference), without writing storage. It sets
// data-piece-set-pending="<id>" on <html> and adds one rule that hides a slot
// whose baked set is a different one, so a reader whose set matches the bake
// (most visitors) sees the baked icon from first paint. The hide uses
// visibility, so the bar keeps its layout, and syncNavQuickPieces() in main.ts
// redraws every button, drops the mark and removes the rule.
//
// If computing the id throws, the mark is set empty and site-shell.css hides
// every slot until main.ts runs (a blank slot is better than a wrong icon). If
// the app never starts (its module fails to load or throws before the sync), a
// script or window error drops the mark so the baked icon shows rather than a
// blank slot for good. Without JavaScript the mark is never set.
//
// The script is built from the reader's own constants; index.html holds a hand
// copy, and piece-set-first-paint.test.ts fails if the two drift apart (compared
// with whitespace collapsed) and runs this exact text against the real reader
// over generated environments, requiring the same id.
import {
  DEFAULT_LOCALE,
  DEFAULT_SCRIPT_BY_LANGUAGE,
  FIRST_LOCALE_STORAGE_KEY,
  LOCALE_META,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  ZH_HANS_REGIONS,
  ZH_HANS_SCRIPTS,
  ZH_HANT_REGIONS,
  ZH_HANT_SCRIPTS,
} from './i18n/locale.js';
import { VIEWER_COUNTRY_COOKIE } from './viewer-geo.js';
import {
  HANZI_INFERRED_XIANGQI_PIECE_SET,
  HANZI_PIECE_COUNTRIES,
  LEGACY_XIANGQI_PIECE_SET_IDS,
  XIANGQI_PIECE_SET_STORAGE_KEY,
  XIANGQI_PIECE_SET_STORAGE_VERSION,
  XIANGQI_PIECE_SET_STORAGE_VERSION_KEY,
} from './xiangqi-appearance-storage.js';
import {
  DEFAULT_XIANGQI_PIECE_SET,
  RETIRED_XIANGQI_PIECE_SETS,
  XIANGQI_PIECE_SETS,
} from './xiangqi-piece-sets.js';

export const PIECE_SET_PENDING_ATTRIBUTE = 'data-piece-set-pending';
/** The id of the <style> element the script adds; syncNavQuickPieces removes it. */
export const PIECE_SET_FIRST_PAINT_STYLE_ID = 'piece-set-first-paint';

function buildPieceSetFirstPaintScript(): string {
  const json = JSON.stringify;
  const localePaths = SUPPORTED_LOCALES.filter((locale) => LOCALE_META[locale].pathPrefix).map(
    (locale) => [LOCALE_META[locale].pathPrefix, locale],
  );
  return `(() => {
  const root = document.documentElement;
  let id = "";
  try {
    const SETS = ${json(XIANGQI_PIECE_SETS.map((set) => set.id))};
    const RETIRED = ${json([...RETIRED_XIANGQI_PIECE_SETS])};
    const LEGACY = ${json(Object.fromEntries(LEGACY_XIANGQI_PIECE_SET_IDS))};
    const HANZI_COUNTRIES = ${json([...HANZI_PIECE_COUNTRIES])};
    const LOCALES = ${json(SUPPORTED_LOCALES)};
    const LOCALE_PATHS = ${json(localePaths)};
    const SCRIPT_BY_LANGUAGE = ${json(DEFAULT_SCRIPT_BY_LANGUAGE)};
    const HANT_SCRIPTS = ${json([...ZH_HANT_SCRIPTS])};
    const HANS_SCRIPTS = ${json([...ZH_HANS_SCRIPTS])};
    const HANT_REGIONS = ${json([...ZH_HANT_REGIONS])};
    const HANS_REGIONS = ${json([...ZH_HANS_REGIONS])};
    const localeFromTag = (language) => {
      if (!language) return null;
      const subtags = language.toLowerCase().split("-");
      const primary = subtags[0];
      if (primary === "en") return "en";
      const fallback = primary ? SCRIPT_BY_LANGUAGE[primary] : undefined;
      if (!fallback) return null;
      if (subtags.some((subtag) => HANT_SCRIPTS.includes(subtag))) return "zh-Hant";
      if (subtags.some((subtag) => HANS_SCRIPTS.includes(subtag))) return "zh-Hans";
      if (subtags.some((subtag) => HANT_REGIONS.includes(subtag))) return "zh-Hant";
      if (subtags.some((subtag) => HANS_REGIONS.includes(subtag))) return "zh-Hans";
      return fallback;
    };
    const currentLocale = () => {
      const languages = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
      const path = window.location.pathname.toLowerCase();
      for (const [prefix, locale] of LOCALE_PATHS) {
        if (path === prefix || path.startsWith(prefix + "/")) return locale;
      }
      try {
        const stored = window.localStorage.getItem(${json(LOCALE_STORAGE_KEY)});
        if (LOCALES.includes(stored)) return stored;
      } catch {
        /* Unreadable storage holds no chosen locale. */
      }
      for (const tag of languages) {
        const locale = localeFromTag(tag);
        if (locale) return locale;
      }
      return ${json(DEFAULT_LOCALE)};
    };
    const firstLocale = () => {
      try {
        const stored = window.localStorage.getItem(${json(FIRST_LOCALE_STORAGE_KEY)});
        if (LOCALES.includes(stored)) return stored;
      } catch {
        /* The app reads the current locale then; it writes it, this does not. */
      }
      return currentLocale();
    };
    const inferred = () => {
      const locale = firstLocale();
      let country = null;
      for (const part of document.cookie.split(";")) {
        const [name, value] = part.trim().split("=");
        if (name === ${json(VIEWER_COUNTRY_COOKIE)} && value && /^[A-Z]{2}$/.test(value)) {
          country = value;
          break;
        }
      }
      const listed = navigator.languages ?? [];
      const languages = listed.length > 0 ? listed : navigator.language ? [navigator.language] : [];
      const hanzi = ${json(HANZI_INFERRED_XIANGQI_PIECE_SET)};
      if (locale === "zh-Hans" || locale === "zh-Hant") return hanzi;
      for (const tag of languages) {
        const listedLocale = localeFromTag(tag);
        if (listedLocale === "zh-Hans" || listedLocale === "zh-Hant") return hanzi;
      }
      if (country && HANZI_COUNTRIES.includes(country)) return hanzi;
      return ${json(DEFAULT_XIANGQI_PIECE_SET)};
    };
    const read = () => {
      const preview = new URLSearchParams(window.location.search).get("xqPieces");
      if (SETS.includes(preview)) return preview;
      const storage = window.localStorage;
      const version = storage.getItem(${json(XIANGQI_PIECE_SET_STORAGE_VERSION_KEY)});
      let raw = storage.getItem(${json(XIANGQI_PIECE_SET_STORAGE_KEY)});
      if (version !== ${json(XIANGQI_PIECE_SET_STORAGE_VERSION)} && raw === ${json(DEFAULT_XIANGQI_PIECE_SET)}) raw = null;
      if (raw !== null && RETIRED.includes(raw)) return inferred();
      if (raw !== null && Object.prototype.hasOwnProperty.call(LEGACY, raw)) return LEGACY[raw];
      return SETS.includes(raw) ? raw : inferred();
    };
    let set;
    try {
      set = read();
    } catch {
      set = inferred();
    }
    if (SETS.includes(set)) {
      const style = document.createElement("style");
      style.id = ${json(PIECE_SET_FIRST_PAINT_STYLE_ID)};
      style.textContent =
        'html[${PIECE_SET_PENDING_ATTRIBUTE}="' + set + '"] .site-nav-quick-piece:not([data-piece-set="' + set + '"]) { visibility: hidden; }';
      document.head.append(style);
      id = set;
    }
  } catch {
    id = "";
  }
  root.setAttribute(${json(PIECE_SET_PENDING_ATTRIBUTE)}, id);
  window.addEventListener(
    "error",
    (event) => {
      if (event.target === window || event.target instanceof HTMLScriptElement) {
        root.removeAttribute(${json(PIECE_SET_PENDING_ATTRIBUTE)});
      }
    },
    true,
  );
})();`;
}

export const PIECE_SET_FIRST_PAINT_SCRIPT = /* @__PURE__ */ buildPieceSetFirstPaintScript();
