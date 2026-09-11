import './flair.css';
// Profile flair rendering. The key list here is the web mirror of the server
// allowlist in apps/server/src/flair.ts, which owns validation;
// flair-sync.test.ts fails the build if the two drift. Web defines its own copy
// rather than importing the server module so no server code reaches the client
// bundle (the same reason variant-registry-sync.test.ts exists).
//
// Both families reuse art the site already ships, so flair added no assets:
// variant-* points at the same PNGs as the variant markers, and piece-* renders
// the xiangqi character as text in an inked disc.
//
// Labels deliberately avoid new i18n keys. A variant flair borrows the variant's
// existing localized name, and a piece flair is named by its own character,
// which is the piece's name in Chinese and needs no translation; English adds
// the role word alongside it.

import type { XiangqiColor, XiangqiPieceRole } from '@mistboard/game';
import { readDisplayPreferences } from './display-preferences.js';
import { variantDisplayLabel } from './game-display.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';
import { xiangqiCharacter } from './xiangqi-pieces.js';

// key -> the variant spec id whose marker art and localized name it borrows.
// The PNGs are one-colour MASKS, not pictures: the art is white-on-transparent
// and variant-markers.css paints it by masking `currentColor`. Rendering one in
// an <img> shows a blank white square on a light panel, which is exactly what
// the first cut of this file did.
const VARIANT_FLAIR: Record<string, { specId: string; path: string }> = {
  'variant-xiangqi': { specId: 'xiangqi', path: '/variant-markers/final/elephant-chess.png' },
  'variant-fortress-xiangqi': {
    specId: 'fortress-xiangqi',
    path: '/variant-markers/final/fortress.png',
  },
  'variant-duck-xiangqi': {
    specId: 'duck-xiangqi',
    path: '/variant-markers/final/duck-elephant-chess.png',
  },
  'variant-jieqi': { specId: 'jieqi', path: '/variant-markers/final/flip-elephant-chess.png' },
  'variant-banqi': { specId: 'banqi', path: '/variant-markers/final/half-flip-chess.png' },
  'variant-jungle': { specId: 'jungle', path: '/variant-markers/final/jungle-chess.png' },
  'variant-jungle-flip': { specId: 'jungle-flip', path: '/variant-markers/final/flip-jungle.png' },
  'variant-dark-xiangqi': {
    specId: 'dark-xiangqi',
    path: '/variant-markers/final/fog-elephant-chess.png',
  },
  'variant-dark-chess': { specId: 'dark-chess', path: '/variant-markers/final/fog-chess.png' },
  'variant-dark-shogi': { specId: 'dark-shogi', path: '/variant-markers/final/fog-shogi.png' },
};

// Red and black take different characters for the same role, which is the
// point: picking 傌 over 馬 says which side you like playing.
//
// The icon is the board's own piece, rendered by renderXiangqiPieceGlyphed with
// the traditional set. The first cut drew a CSS circle around a text character
// instead, which failed twice: the glyph overflowed the hairline ring (兵 broke
// through the bottom), and the character came from whatever CJK serif the
// viewer's system happened to have. The piece renderer solves both, because it
// draws baked Noto Sans CJK outlines (XIANGQI_GLYPH_PATHS) inset in a proper
// double-ring disc, which is why every other surface already uses it.
//
// Pinned to 'traditional' rather than following the viewer's piece-set
// preference: the flair key names a character and its label quotes that
// character, so rendering a red-cannon flair as the international cannon icon
// would make the name wrong.
const PIECE_ROLES: readonly XiangqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
];
const PIECE_INKS: readonly XiangqiColor[] = ['red', 'black'];

const ROLE_WORDS: Record<XiangqiPieceRole, string> = {
  general: 'General',
  advisor: 'Advisor',
  elephant: 'Elephant',
  horse: 'Horse',
  chariot: 'Chariot',
  cannon: 'Cannon',
  soldier: 'Soldier',
};

const PIECE_FLAIR: Record<string, { ink: XiangqiColor; role: XiangqiPieceRole }> =
  Object.fromEntries(
    PIECE_INKS.flatMap((ink) =>
      PIECE_ROLES.map((role) => [`piece-${ink}-${role}`, { ink, role }] as const),
    ),
  );

// Declaration order is picker order: variants first, then red pieces, then
// black. Derived from the maps so the two can never disagree inside web.
export const FLAIR_KEYS: readonly string[] = [
  ...Object.keys(VARIANT_FLAIR),
  ...Object.keys(PIECE_FLAIR),
];

export type FlairKey = string;

const FLAIR_KEY_SET: ReadonlySet<string> = new Set(FLAIR_KEYS);

export function isFlairKey(value: unknown): value is FlairKey {
  return typeof value === 'string' && FLAIR_KEY_SET.has(value);
}

export function flairLabel(key: FlairKey, locale: Locale = currentLocale()): string {
  const variant = VARIANT_FLAIR[key];
  if (variant) return variantDisplayLabel(variant.specId);
  const piece = PIECE_FLAIR[key];
  if (!piece) return key;
  const character = xiangqiCharacter(piece.ink, piece.role);
  // The character names the piece on its own in Chinese; English readers get
  // the role word too, with the ink so 傌 and 馬 stay distinguishable.
  if (locale !== 'en') return character;
  const ink = piece.ink === 'red' ? 'Red' : 'Black';
  return `${ink} ${ROLE_WORDS[piece.role]} ${character}`;
}

// One flair icon, sized by CSS. Decorative by default: the handle it sits
// beside already names the player, so a screen reader announcing "Red Cannon"
// after every username is noise. Pass labelled:true where the flair stands
// alone (the picker), and it gets its name back.
export function buildFlairIcon(
  key: FlairKey,
  opts: { labelled?: boolean; locale?: Locale } = {},
): HTMLElement {
  const label = flairLabel(key, opts.locale);
  const variant = VARIANT_FLAIR[key];
  const piece = PIECE_FLAIR[key];
  const wrap = document.createElement('span');
  wrap.className = `flair flair-${variant ? 'variant' : 'piece'}`;
  wrap.dataset.flair = key;

  if (variant) {
    const mask = document.createElement('span');
    mask.className = 'flair-mask';
    mask.style.setProperty('--flair-mask', `url('${variant.path}')`);
    wrap.append(mask);
  } else if (piece) {
    // No size option: that leaves the svg without width/height attributes so it
    // fills the em-sized wrapper, and one flair scales with whatever text it
    // sits beside instead of being pinned to a pixel size.
    wrap.innerHTML = renderXiangqiPieceGlyphed(
      { color: piece.ink, role: piece.role },
      'traditional',
      {
        ariaLabel: label,
        className: 'flair-piece-svg',
      },
    );
  }

  if (opts.labelled) {
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', label);
  } else {
    wrap.setAttribute('aria-hidden', 'true');
    wrap.title = label;
  }
  return wrap;
}

// Convenience for the many surfaces that hold a possibly-null flair off a
// payload and want an element or nothing.
//
// This is the DISPLAY path, so it honours the viewer's playerFlairs preference:
// someone who does not want other people's flair on their screen turns it off
// here. The picker calls buildFlairIcon directly and is deliberately not gated,
// because you must be able to see the flair you are choosing even with the
// display toggle off.
export function buildFlairIconIfSet(
  value: unknown,
  opts: { labelled?: boolean; locale?: Locale } = {},
): HTMLElement | null {
  if (!isFlairKey(value)) return null;
  if (!viewerShowsFlairs()) return null;
  return buildFlairIcon(value, opts);
}

function viewerShowsFlairs(): boolean {
  // Storage can throw (private mode, blocked site data). Flair is decoration,
  // so an unreadable preference shows it rather than failing the render.
  try {
    return readDisplayPreferences().playerFlairs;
  } catch {
    return true;
  }
}
