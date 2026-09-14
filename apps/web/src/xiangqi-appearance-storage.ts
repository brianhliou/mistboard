import { currentLocale, type Locale } from './i18n/locale.js';
import { viewerCountry } from './viewer-geo.js';
import {
  DEFAULT_XIANGQI_PIECE_SET,
  XIANGQI_PIECE_SETS,
  type XiangqiPieceSet,
} from './xiangqi-piece-sets.js';

export type XiangqiBoardTheme = 'international' | 'traditional';
export type XiangqiBoardLayout = 'intersection' | 'cell';

const xiangqiBoardStorageKey = 'mistboard.xiangqiBoardTheme';
const xiangqiBoardStorageVersionKey = 'mistboard.xiangqiBoardThemeVersion';
const xiangqiBoardLayoutStorageKey = 'mistboard.xiangqiBoardLayout';
const xiangqiBoardLayoutStorageVersionKey = 'mistboard.xiangqiBoardLayoutVersion';
const xiangqiPieceSetStorageKey = 'mistboard.xiangqiPieceSet';
const xiangqiPieceSetStorageVersionKey = 'mistboard.xiangqiPieceSetVersion';
const defaultXiangqiBoardTheme: XiangqiBoardTheme = 'international';
const defaultXiangqiBoardLayout: XiangqiBoardLayout = 'intersection';
const xiangqiBoardStorageVersion = '4';
const xiangqiBoardLayoutStorageVersion = '1';
const xiangqiPieceSetStorageVersion = '4';
const defaultXiangqiPieceSet: XiangqiPieceSet = DEFAULT_XIANGQI_PIECE_SET;
// Countries where a player expects hanzi on the pieces even when the browser
// reports English. Physical sets sold in mainland China print the traditional
// forms (車 馬 將 帥) too, so every Chinese-reading region gets the same set;
// 'simplified' stays an opt-in. Vietnam plays with the same pieces (cờ tướng).
const HANZI_PIECE_COUNTRIES: ReadonlySet<string> = new Set([
  'CN',
  'TW',
  'HK',
  'MO',
  'SG',
  'MY',
  'VN',
]);
const xiangqiBoardThemes: ReadonlyArray<{ id: XiangqiBoardTheme; label: string }> = [
  { id: 'international', label: 'International' },
  { id: 'traditional', label: 'Traditional' },
];
const xiangqiBoardLayouts: ReadonlyArray<{ id: XiangqiBoardLayout; label: string }> = [
  { id: 'intersection', label: 'Classic intersections' },
  { id: 'cell', label: 'Square grid' },
];

export function readStoredXiangqiBoardTheme(): XiangqiBoardTheme {
  try {
    const stored = window.localStorage.getItem(xiangqiBoardStorageKey);
    const version = window.localStorage.getItem(xiangqiBoardStorageVersionKey);
    const normalized = normalizeXiangqiBoardTheme(stored);
    if (version !== xiangqiBoardStorageVersion || normalized !== stored) {
      window.localStorage.setItem(xiangqiBoardStorageVersionKey, xiangqiBoardStorageVersion);
      window.localStorage.setItem(xiangqiBoardStorageKey, normalized);
    }
    return normalized;
  } catch {
    return defaultXiangqiBoardTheme;
  }
}

export function writeStoredXiangqiBoardTheme(theme: XiangqiBoardTheme): void {
  try {
    window.localStorage.setItem(xiangqiBoardStorageKey, theme);
    window.localStorage.setItem(xiangqiBoardStorageVersionKey, xiangqiBoardStorageVersion);
  } catch {
    // The data attribute still updates for the current page.
  }
}

export function readStoredXiangqiBoardLayout(): XiangqiBoardLayout {
  try {
    // QA/share hook: a URL can pin either layout without changing the browser's
    // saved preference. Useful for visual review links and reproducible reports.
    const previewLayout = new URLSearchParams(window.location.search).get('xqLayout');
    if (xiangqiBoardLayouts.some((layout) => layout.id === previewLayout)) {
      return previewLayout as XiangqiBoardLayout;
    }
    const stored = window.localStorage.getItem(xiangqiBoardLayoutStorageKey);
    const version = window.localStorage.getItem(xiangqiBoardLayoutStorageVersionKey);
    const normalized = normalizeXiangqiBoardLayout(stored);
    if (version !== xiangqiBoardLayoutStorageVersion || normalized !== stored) {
      window.localStorage.setItem(
        xiangqiBoardLayoutStorageVersionKey,
        xiangqiBoardLayoutStorageVersion,
      );
      window.localStorage.setItem(xiangqiBoardLayoutStorageKey, normalized);
    }
    return normalized;
  } catch {
    return defaultXiangqiBoardLayout;
  }
}

export function writeStoredXiangqiBoardLayout(layout: XiangqiBoardLayout): void {
  try {
    window.localStorage.setItem(xiangqiBoardLayoutStorageKey, layout);
    window.localStorage.setItem(
      xiangqiBoardLayoutStorageVersionKey,
      xiangqiBoardLayoutStorageVersion,
    );
  } catch {
    // The current board keeps its existing layout when storage is unavailable.
  }
}

// The piece set a browser gets before anyone picks one. Locale first (the
// zh interface implies Chinese-reading pieces), then Cloudflare's country
// cookie as the tiebreak for an English browser in a Chinese-reading region:
// a lot of that traffic runs an en-US work laptop. Anything else keeps the
// international art.
export function inferredXiangqiPieceSet(
  locale: Locale = currentLocale(),
  country: string | null = viewerCountry(),
): XiangqiPieceSet {
  if (locale === 'zh-Hans' || locale === 'zh-Hant') return 'traditional';
  if (country && HANZI_PIECE_COUNTRIES.has(country)) return 'traditional';
  return defaultXiangqiPieceSet;
}

// An explicit pick is stored; no stored value means "follow the inference",
// the same NULL semantics as the account locale column. The storage version
// exists so a rollout can re-default browsers: v3 (the international rollout)
// wrote 'international' into every browser whether or not anyone chose it, so
// v4 clears exactly that value and keeps any other pick, which is the only
// stored value that must have come from the settings panel.
export function readStoredXiangqiPieceSet(): XiangqiPieceSet {
  try {
    // QA/share hook: preview a piece set without changing the browser's saved
    // preference. This mirrors the xqLayout hook used for board-layout review.
    const previewPieceSet = new URLSearchParams(window.location.search).get('xqPieces');
    if (XIANGQI_PIECE_SETS.some((set) => set.id === previewPieceSet)) {
      return previewPieceSet as XiangqiPieceSet;
    }
    const version = window.localStorage.getItem(xiangqiPieceSetStorageVersionKey);
    if (version !== xiangqiPieceSetStorageVersion) {
      window.localStorage.setItem(xiangqiPieceSetStorageVersionKey, xiangqiPieceSetStorageVersion);
      if (window.localStorage.getItem(xiangqiPieceSetStorageKey) === defaultXiangqiPieceSet) {
        window.localStorage.removeItem(xiangqiPieceSetStorageKey);
      }
    }
    const stored = storedXiangqiPieceSet(window.localStorage.getItem(xiangqiPieceSetStorageKey));
    return stored ?? inferredXiangqiPieceSet();
  } catch {
    return inferredXiangqiPieceSet();
  }
}

export function writeStoredXiangqiPieceSet(pieceSet: XiangqiPieceSet): void {
  try {
    window.localStorage.setItem(xiangqiPieceSetStorageKey, pieceSet);
    window.localStorage.setItem(xiangqiPieceSetStorageVersionKey, xiangqiPieceSetStorageVersion);
  } catch {
    // The data attribute still updates for the current page.
  }
}

export function normalizeXiangqiBoardTheme(value: string | null): XiangqiBoardTheme {
  return xiangqiBoardThemes.some((theme) => theme.id === value)
    ? (value as XiangqiBoardTheme)
    : defaultXiangqiBoardTheme;
}

export function normalizeXiangqiBoardLayout(value: string | null): XiangqiBoardLayout {
  return xiangqiBoardLayouts.some((layout) => layout.id === value)
    ? (value as XiangqiBoardLayout)
    : defaultXiangqiBoardLayout;
}

// A stored value that names a set (after the legacy animal ids), or null when
// nothing usable is stored.
function storedXiangqiPieceSet(value: string | null): XiangqiPieceSet | null {
  if (value === 'animal' || value === 'animal-seal' || value === 'animal-origami') {
    return 'animal-dobutsu';
  }
  return XIANGQI_PIECE_SETS.some((set) => set.id === value) ? (value as XiangqiPieceSet) : null;
}

export function normalizeXiangqiPieceSet(value: string | null): XiangqiPieceSet {
  return storedXiangqiPieceSet(value) ?? defaultXiangqiPieceSet;
}

// ── Move-notation display preference ────────────────────────────────────────
// How xiangqi review/analysis move lists render moves. Display-only: nothing
// stored or transmitted changes with it. 'chinese' resolves its script from
// the locale at format time (zh-hant → traditional glyphs, else simplified).

export type XiangqiNotationPreference = 'coordinate' | 'chinese' | 'wxf' | 'iccs';

const xiangqiNotationStorageKey = 'mistboard.xiangqiNotation';
const xiangqiNotationStorageVersionKey = 'mistboard.xiangqiNotationVersion';
const xiangqiNotationStorageVersion = '1';
const defaultXiangqiNotation: XiangqiNotationPreference = 'coordinate';

export const xiangqiNotationOptions: ReadonlyArray<{
  id: XiangqiNotationPreference;
  label: string;
  preview: string;
}> = [
  { id: 'coordinate', label: 'Coordinates', preview: 'h3-e3' },
  { id: 'chinese', label: 'Chinese', preview: '炮二平五' },
  { id: 'wxf', label: 'WXF', preview: 'C2.5' },
  { id: 'iccs', label: 'ICCS', preview: 'h2e2' },
];

export function readStoredXiangqiNotation(): XiangqiNotationPreference {
  try {
    const stored = window.localStorage.getItem(xiangqiNotationStorageKey);
    const version = window.localStorage.getItem(xiangqiNotationStorageVersionKey);
    const normalized = normalizeXiangqiNotation(stored);
    if (version !== xiangqiNotationStorageVersion || normalized !== stored) {
      window.localStorage.setItem(xiangqiNotationStorageVersionKey, xiangqiNotationStorageVersion);
      window.localStorage.setItem(xiangqiNotationStorageKey, normalized);
    }
    return normalized;
  } catch {
    return defaultXiangqiNotation;
  }
}

export function writeStoredXiangqiNotation(notation: XiangqiNotationPreference): void {
  try {
    window.localStorage.setItem(xiangqiNotationStorageKey, notation);
    window.localStorage.setItem(xiangqiNotationStorageVersionKey, xiangqiNotationStorageVersion);
  } catch {
    // The current page still re-renders with the new mode.
  }
}

export function normalizeXiangqiNotation(value: string | null): XiangqiNotationPreference {
  return xiangqiNotationOptions.some((option) => option.id === value)
    ? (value as XiangqiNotationPreference)
    : defaultXiangqiNotation;
}
