import { currentLocale, type Locale } from './i18n/locale.js';
import { viewerCountry } from './viewer-geo.js';
import {
  DEFAULT_XIANGQI_BOARD_COLOR,
  JUNGLE_XIANGQI_BOARD_COLOR,
  normalizeXiangqiBoardColor,
  type XiangqiBoardColor,
} from './xiangqi-board-color.js';
import {
  DEFAULT_XIANGQI_PIECE_SET,
  XIANGQI_PIECE_SETS,
  type XiangqiPieceSet,
} from './xiangqi-piece-sets.js';
import {
  DEFAULT_XIANGQI_RIVER_TEXT,
  normalizeXiangqiRiverText,
  XIANGQI_RIVER_TEXTS,
  type XiangqiRiverText,
} from './xiangqi-river-text.js';

// The board theme is now only "standard or Jungle". 'international' is the
// standard board, whatever its colour (the stored id and the
// data-xiangqi-board-theme value are kept so nothing that reads them breaks).
// 'traditional' was a third theme until 2026-10-08: a darker board that also
// printed 楚河 漢界. It is now the 'traditional' board colour plus the classic
// river text, and a stored 'traditional' is migrated to exactly that
// (migrateLegacyBoardThemes below).
// 'jungle' is the children's board (2026-09-25): a lawn of two greens, cream rugs
// for palaces, a painted river. Since 2026-10-08 it is a board colour, the Jungle
// swatch, offered on the square grid only, so the theme is derived (Jungle colour
// on the square grid) rather than stored; a stored 'jungle' theme is migrated to
// that colour (migrateLegacyBoardThemes below).
export type XiangqiBoardTheme = 'international' | 'jungle';
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
  { id: 'international', label: 'Lined' },
  { id: 'jungle', label: 'Jungle' },
];
const xiangqiBoardLayouts: ReadonlyArray<{ id: XiangqiBoardLayout; label: string }> = [
  { id: 'intersection', label: 'Classic intersections' },
  { id: 'cell', label: 'Square grid' },
];

/** The theme the board renders: Jungle when the Jungle colour is picked and the
 *  layout is the square grid, else the standard board. Derived, never stored. */
export function readStoredXiangqiBoardTheme(): XiangqiBoardTheme {
  return readStoredXiangqiBoardColor() === JUNGLE_XIANGQI_BOARD_COLOR &&
    readStoredXiangqiBoardLayout() === 'cell'
    ? 'jungle'
    : defaultXiangqiBoardTheme;
}

export function readStoredXiangqiBoardLayout(): XiangqiBoardLayout {
  try {
    // QA/share hook: a URL can pin either layout without changing the browser's
    // saved preference. Useful for visual review links and reproducible reports.
    const previewLayout = new URLSearchParams(window.location.search).get('xqLayout');
    if (xiangqiBoardLayouts.some((layout) => layout.id === previewLayout)) {
      return previewLayout as XiangqiBoardLayout;
    }
    // A stored Jungle theme also sets the layout; migrate before reading it.
    migrateLegacyBoardThemes();
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

// ── Board colour, river text and start markers (2026-10-08) ─────────────────
// Three independent choices in the gear's Board panel. The colour is a preset id
// (xiangqi-board-color.ts owns the presets and their ink); the river text is
// off, the classic 楚河 漢界, or the Mistboard wordmark (xiangqi-river-text.ts);
// the start markers are the printed brackets at the cannons' and soldiers'
// starting points. Each stores only an explicit pick: an empty key means
// "follow the default", so a later change of default reaches everyone who never
// chose. All keys share the mistboard.xiangqi prefix, so theme.ts's
// cross-document listener carries them to other tabs and embedded boards.

const xiangqiBoardColorStorageKey = 'mistboard.xiangqiBoardColor';
const xiangqiRiverTextStorageKey = 'mistboard.xiangqiRiverText';
const xiangqiStartMarkersStorageKey = 'mistboard.xiangqiStartMarkers';
const defaultXiangqiStartMarkers = true;

// The Traditional board theme became a colour plus a river text. A browser that
// stored it keeps exactly what it saw: the 'traditional' colour and the classic
// inscription, unless it already holds its own pick for either. The theme key
// goes back to the standard board ('international'), keeping its storage
// version, so the layout and every other pick stay as they were. Idempotent;
// each reader runs it first, so the order the readers run in does not matter.
// A stored 'international' needs nothing: it is the default colour with no
// river text, which is what an empty colour and river-text key already mean.
//
// The Jungle board theme became the Jungle colour (2026-10-08). A browser that
// stored it saw Jungle whatever its colour key held (the colour row was hidden
// under Jungle), so the colour is overwritten with 'jungle'; and Jungle was only
// ever chosen together with the square grid, so the layout is set to it too.
// Older theme ids (tournament, blue, ...) normalize to the standard board, as
// they did before. Every stored theme ends as 'international' at the current
// version, so this runs its writes once per browser.
function migrateLegacyBoardThemes(): void {
  const stored = window.localStorage.getItem(xiangqiBoardStorageKey);
  const version = window.localStorage.getItem(xiangqiBoardStorageVersionKey);
  if (stored === 'traditional') {
    if (window.localStorage.getItem(xiangqiBoardColorStorageKey) === null) {
      window.localStorage.setItem(xiangqiBoardColorStorageKey, 'traditional');
    }
    if (window.localStorage.getItem(xiangqiRiverTextStorageKey) === null) {
      window.localStorage.setItem(xiangqiRiverTextStorageKey, 'classic');
    }
  } else if (stored === 'jungle') {
    window.localStorage.setItem(xiangqiBoardColorStorageKey, JUNGLE_XIANGQI_BOARD_COLOR);
    writeStoredXiangqiBoardLayout('cell');
  }
  if (stored === null && version === null) return;
  if (stored !== defaultXiangqiBoardTheme || version !== xiangqiBoardStorageVersion) {
    window.localStorage.setItem(xiangqiBoardStorageKey, defaultXiangqiBoardTheme);
    window.localStorage.setItem(xiangqiBoardStorageVersionKey, xiangqiBoardStorageVersion);
  }
}

export function readStoredXiangqiBoardColor(): XiangqiBoardColor {
  try {
    // QA/share hook, like xqLayout: preview a colour without saving it.
    const preview = new URLSearchParams(window.location.search).get('xqBoardColor');
    if (preview !== null) return normalizeXiangqiBoardColor(preview);
    migrateLegacyBoardThemes();
    return normalizeXiangqiBoardColor(window.localStorage.getItem(xiangqiBoardColorStorageKey));
  } catch {
    return DEFAULT_XIANGQI_BOARD_COLOR;
  }
}

export function writeStoredXiangqiBoardColor(color: XiangqiBoardColor): void {
  try {
    window.localStorage.setItem(xiangqiBoardColorStorageKey, color);
  } catch {
    // The root attributes still update for the current page.
  }
}

export function readStoredXiangqiRiverText(): XiangqiRiverText {
  try {
    // QA/share hook: `?xqRiver=brand` previews a caption without saving it.
    const preview = new URLSearchParams(window.location.search).get('xqRiver');
    if (XIANGQI_RIVER_TEXTS.includes(preview as XiangqiRiverText)) {
      return preview as XiangqiRiverText;
    }
    migrateLegacyBoardThemes();
    return normalizeXiangqiRiverText(window.localStorage.getItem(xiangqiRiverTextStorageKey));
  } catch {
    return DEFAULT_XIANGQI_RIVER_TEXT;
  }
}

export function writeStoredXiangqiRiverText(text: XiangqiRiverText): void {
  try {
    window.localStorage.setItem(xiangqiRiverTextStorageKey, text);
  } catch {
    // The root attribute still updates for the current page.
  }
}

// The Mistboard river caption has two settings while Brian compares them
// (2026-10-08): 'a', the default, and 'b', reached only by the ?xqRiverStyle=b
// flag. The flag is remembered, so the alternate follows him across pages;
// ?xqRiverStyle=a goes back. app-base.css reads data-xiangqi-river-style.
const xiangqiRiverStyleStorageKey = 'mistboard.xiangqiRiverStyle';
export type XiangqiRiverStyle = 'a' | 'b';

export function readStoredXiangqiRiverStyle(): XiangqiRiverStyle {
  try {
    const flag = new URLSearchParams(window.location.search).get('xqRiverStyle');
    if (flag === 'a' || flag === 'b') {
      window.localStorage.setItem(xiangqiRiverStyleStorageKey, flag);
      return flag;
    }
    return window.localStorage.getItem(xiangqiRiverStyleStorageKey) === 'b' ? 'b' : 'a';
  } catch {
    return 'a';
  }
}

export function readStoredXiangqiStartMarkers(): boolean {
  try {
    const stored = window.localStorage.getItem(xiangqiStartMarkersStorageKey);
    if (stored === 'on') return true;
    if (stored === 'off') return false;
    return defaultXiangqiStartMarkers;
  } catch {
    return defaultXiangqiStartMarkers;
  }
}

export function writeStoredXiangqiStartMarkers(on: boolean): void {
  try {
    window.localStorage.setItem(xiangqiStartMarkersStorageKey, on ? 'on' : 'off');
  } catch {
    // The root attribute still updates for the current page.
  }
}

/** The URL preview hooks (?xqLayout=, ?xqBoardColor=, ?xqRiver=) win over the
 *  stored pick, so a pick made on a preview link has to end the preview, or the
 *  gear would keep showing the previewed option as selected while the board
 *  shows the pick (Brian's 2026-10-08 review: the river-text selection "stuck"
 *  on a ?xqRiver= link). Drops the parameter from the address in place. */
export function endXiangqiAppearancePreview(param: 'xqLayout' | 'xqBoardColor' | 'xqRiver'): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(param)) return;
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // No history API: the pick still applies to this page.
  }
}

/** The ?boardgrain=1 preview flag: offers the faint wood-grain preset. */
export function xiangqiBoardGrainFlag(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('boardgrain') === '1';
  } catch {
    return false;
  }
}

// ── Move-notation display preference ────────────────────────────────────────
// How xiangqi move lists render moves, on every surface (live room, review,
// analysis, study, puzzles, TV). Display-only: nothing stored or transmitted
// changes with it. 'chinese' resolves its script from the locale at format
// time (zh-hant → traditional glyphs, else simplified).
//
// The default follows the interface locale and is NOT written to storage: a
// Chinese reader expects 炮二平五, everyone else gets chess-style algebraic
// (Che3, Cxe7), the one form a chess player reads without a manual. WXF is
// the tournament standard and what the export PGN carries, so it stays on
// offer. Coordinates (h3-e3) and ICCS (h2e2) exist as formatter styles for
// exports, fog xiangqi and embed links, but are not offered in the gear
// (2026-09-13): coordinates are algebraic minus the piece, and ICCS is engine
// plumbing nobody wants in a move list. A stored choice of either reads as
// unset.

export type XiangqiNotationPreference = 'algebraic' | 'chinese' | 'wxf';

const xiangqiNotationStorageKey = 'mistboard.xiangqiNotation';
const xiangqiNotationStorageVersionKey = 'mistboard.xiangqiNotationVersion';
// Version 1 wrote the 'coordinate' default into storage on first read, so a
// stored 'coordinate' is what the site chose, not the reader. Under version 2
// only an offered style counts as a choice; anything else reads as unset.
const xiangqiNotationStorageVersion = '2';

export const xiangqiNotationOptions: ReadonlyArray<{
  id: XiangqiNotationPreference;
  label: string;
  preview: string;
}> = [
  { id: 'algebraic', label: 'Algebraic', preview: 'Cxe7' },
  { id: 'chinese', label: 'Chinese', preview: '炮二平五' },
  { id: 'wxf', label: 'WXF', preview: 'C2.5' },
];

/** The notation a reader with no stored choice sees, by interface locale. */
export function defaultXiangqiNotationForLocale(locale: string): XiangqiNotationPreference {
  return locale.toLowerCase().startsWith('zh') ? 'chinese' : 'algebraic';
}

/**
 * The stored choice, or the locale default when the reader has never picked
 * one. `locale` is a parameter rather than an import so this module stays
 * free of the i18n chunk; callers pass the current interface locale.
 */
export function readStoredXiangqiNotation(locale = 'en'): XiangqiNotationPreference {
  const fallback = defaultXiangqiNotationForLocale(locale);
  try {
    const stored = window.localStorage.getItem(xiangqiNotationStorageKey);
    const version = window.localStorage.getItem(xiangqiNotationStorageVersionKey);
    if (version !== xiangqiNotationStorageVersion) {
      // The one migration: clear whatever an older version stored unless it
      // is a style still on offer (see the version note above).
      window.localStorage.setItem(xiangqiNotationStorageVersionKey, xiangqiNotationStorageVersion);
      if (!isXiangqiNotationPreference(stored))
        window.localStorage.removeItem(xiangqiNotationStorageKey);
    }
    return isXiangqiNotationPreference(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function isXiangqiNotationPreference(
  value: string | null,
): value is XiangqiNotationPreference {
  return xiangqiNotationOptions.some((option) => option.id === value);
}

export function writeStoredXiangqiNotation(notation: XiangqiNotationPreference): void {
  try {
    window.localStorage.setItem(xiangqiNotationStorageKey, notation);
    window.localStorage.setItem(xiangqiNotationStorageVersionKey, xiangqiNotationStorageVersion);
  } catch {
    // The current page still re-renders with the new mode.
  }
}

export function normalizeXiangqiNotation(
  value: string | null,
  locale = 'en',
): XiangqiNotationPreference {
  return isXiangqiNotationPreference(value) ? value : defaultXiangqiNotationForLocale(locale);
}
