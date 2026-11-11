import './flair.css';

// Profile flair rendering. The key list here is the web mirror of the server
// allowlist in apps/server/src/flair.ts, which owns validation;
// flair-sync.test.ts fails the build if the two drift. Web defines its own copy
// rather than importing the server module so no server code reaches the client
// bundle (the same reason variant-registry-sync.test.ts exists).
//
// Every family reuses art the site already ships, so flair added no assets:
// variant-* points at the same PNGs as the variant markers, piece-* draws the
// board's own xiangqi piece in one of the board piece sets, jungle-* the Jungle
// animal token and chess-* the cburnett chess piece.
//
// Labels borrow names the site already translates: the variant's name, the
// piece set's name from board settings, and the editor's colour and role words.
// A Traditional piece is named by its own character, which is the piece's name
// in Chinese and needs no translation; English adds the role word alongside it.

import { PIECE_SVGS } from '@mistboard/board-render';
import {
  type Color as ChessColor,
  type PieceRole as ChessPieceRole,
  isPublicGameSpec,
  type JungleColor,
  type JunglePieceRole,
  type XiangqiColor,
  type XiangqiPieceRole,
} from '@mistboard/game';
import { readDisplayPreferences } from './display-preferences.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { framedTokenSvg, JUNGLE_ART } from './jungle-art.js';
import { FINAL_VARIANT_MARKERS } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import {
  renderXiangqiPieceGlyphed,
  XIANGQI_PIECE_SETS,
  type XiangqiPieceSet,
} from './xiangqi-piece-sets.js';
import { xiangqiCharacter } from './xiangqi-pieces.js';

// key -> the variant spec id whose marker art and localized name it borrows.
// The PNGs are one-colour MASKS, not pictures: the art is white-on-transparent
// and variant-markers.css paints it by masking `currentColor`. Rendering one in
// an <img> shows a blank white square on a light panel, which is exactly what
// the first cut of this file did.
// Each variant flair is `variant-<marker id>`, and its mask path is read from
// FINAL_VARIANT_MARKERS rather than a second copy of the file names, so a flair
// can only point at a marker that exists. Order is the picker's order and must
// match the server list (flair-sync.test.ts).
const VARIANT_FLAIR_IDS = [
  'xiangqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'atomic-xiangqi',
  'crazyhouse-xiangqi',
  'jieqi',
  'banqi',
  'jungle',
  'jungle-flip',
  'dark-xiangqi',
  'dark-chess',
  'gomoku',
] as const satisfies readonly VariantMiniId[];
const VARIANT_FLAIR: Record<string, { specId: string; path: string }> = Object.fromEntries(
  VARIANT_FLAIR_IDS.map((id) => [
    `variant-${id}`,
    { specId: id, path: FINAL_VARIANT_MARKERS[id].path },
  ]),
);

// Red and black take different characters for the same role, which is the
// point: picking 傌 over 馬 says which side you like playing.
//
// The icon is the board's own piece, rendered by renderXiangqiPieceGlyphed. The
// first cut drew a CSS circle around a text character instead, which failed
// twice: the glyph overflowed the hairline ring (兵 broke through the bottom),
// and the character came from whatever CJK serif the viewer's system happened
// to have. The piece renderer solves both, because it draws baked Noto Sans CJK
// outlines (XIANGQI_GLYPH_PATHS) or the set's own artwork inset in a proper
// disc, which is why every other surface already uses it.
//
// Each key names its set and never follows the viewer's piece-set preference:
// the wearer picked that exact picture, and a Traditional key's label quotes
// its character, so rendering a red-cannon flair as the International cannon
// would make the name wrong. Every set in board settings is offered (a trial
// set 2026-11-11). The Traditional keys were the only piece flair before then
// and are stored on accounts, so they keep their unprefixed `piece-<ink>-<role>`
// names; every other set is `piece-<set>-<ink>-<role>`.
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

type PieceFlair = { set: XiangqiPieceSet; ink: XiangqiColor; role: XiangqiPieceRole };

function xiangqiSetPrefix(set: XiangqiPieceSet): string {
  return set === 'traditional' ? 'piece' : `piece-${set}`;
}

// Board-settings order, which is also the picker's order.
const PIECE_FLAIR_SETS: readonly XiangqiPieceSet[] = XIANGQI_PIECE_SETS.map((entry) => entry.id);

const PIECE_FLAIR: Record<string, PieceFlair> = Object.fromEntries(
  PIECE_FLAIR_SETS.flatMap((set) =>
    PIECE_INKS.flatMap((ink) =>
      PIECE_ROLES.map(
        (role) => [`${xiangqiSetPrefix(set)}-${ink}-${role}`, { set, ink, role }] as const,
      ),
    ),
  ),
);

// Jungle: the animals skin, the one a player can see on a board. The
// characters skin is only a ?junglePieces= preview with no setting, and draws
// its glyph in the viewer's system serif, so it is not offered.
const JUNGLE_ROLES: readonly JunglePieceRole[] = [
  'rat',
  'cat',
  'dog',
  'wolf',
  'leopard',
  'tiger',
  'lion',
  'elephant',
];
const JUNGLE_INKS: readonly JungleColor[] = ['red', 'black'];
const JUNGLE_FLAIR: Record<string, { ink: JungleColor; role: JunglePieceRole }> =
  Object.fromEntries(
    JUNGLE_INKS.flatMap((ink) =>
      JUNGLE_ROLES.map((role) => [`jungle-${ink}-${role}`, { ink, role }] as const),
    ),
  );

// Chess: cburnett, the one chess set the site ships (theme.ts pieceSets).
const CHESS_ROLES: readonly ChessPieceRole[] = [
  'king',
  'queen',
  'rook',
  'bishop',
  'knight',
  'pawn',
];
const CHESS_INKS: readonly ChessColor[] = ['white', 'black'];
const CHESS_FLAIR: Record<string, { ink: ChessColor; role: ChessPieceRole }> = Object.fromEntries(
  CHESS_INKS.flatMap((ink) =>
    CHESS_ROLES.map((role) => [`chess-${ink}-${role}`, { ink, role }] as const),
  ),
);

// Declaration order is picker order: variants, each xiangqi set (red then
// black), Jungle, then chess. Derived from the maps so the two can never
// disagree inside web.
export const FLAIR_KEYS: readonly string[] = [
  ...Object.keys(VARIANT_FLAIR),
  ...Object.keys(PIECE_FLAIR),
  ...Object.keys(JUNGLE_FLAIR),
  ...Object.keys(CHESS_FLAIR),
];

export type FlairKey = string;

const FLAIR_KEY_SET: ReadonlySet<string> = new Set(FLAIR_KEYS);

export function isFlairKey(value: unknown): value is FlairKey {
  return typeof value === 'string' && FLAIR_KEY_SET.has(value);
}

// Existing wearers keep valid, renderable flair. The picker offers variant
// flair only once its spec is public, and removes it again on retirement.
export function flairOfferedInPicker(key: FlairKey): boolean {
  const variant = VARIANT_FLAIR[key];
  return !variant || isPublicGameSpec(variant.specId);
}

// perRow is one side's pieces, so a set lays out as a red row over a black row
// (white over black for chess); unset lets the grid fill the width.
export type FlairPickerGroup = {
  id: string;
  label: string;
  keys: readonly FlairKey[];
  perRow?: number;
};

// The picker's sections, covering FLAIR_KEYS in order, each named with a label
// the site already translates. The picker still applies flairOfferedInPicker,
// because it keeps a wearer's current flair even when it is no longer offered.
export function flairPickerGroups(locale: Locale = currentLocale()): FlairPickerGroup[] {
  return [
    {
      id: 'variants',
      label: t('bots.variants', undefined, locale),
      keys: Object.keys(VARIANT_FLAIR),
    },
    ...XIANGQI_PIECE_SETS.map((entry) => ({
      id: `xiangqi-${entry.id}`,
      label: t(
        'account.flairGroupXiangqiSet',
        { set: t(entry.labelKey, undefined, locale) },
        locale,
      ),
      keys: Object.keys(PIECE_FLAIR).filter((key) => PIECE_FLAIR[key]?.set === entry.id),
      perRow: PIECE_ROLES.length,
    })),
    {
      id: 'jungle',
      label: t('variant.jungle.name', undefined, locale),
      keys: Object.keys(JUNGLE_FLAIR),
      perRow: JUNGLE_ROLES.length,
    },
    {
      id: 'chess',
      label: t('variant.chess.name', undefined, locale),
      keys: Object.keys(CHESS_FLAIR),
      perRow: CHESS_ROLES.length,
    },
  ];
}

// "<set> <colour> <role>": "Lacquer red chariot" in English, 亮漆 红车 in
// Chinese, where the colour and role words join without a space.
function setColourRoleLabel(set: string, colour: string, role: string, locale: Locale): string {
  if (locale === 'en') return `${set} ${colour.toLowerCase()} ${role.toLowerCase()}`;
  return `${set} ${colour}${role}`;
}

function inkWord(ink: 'red' | 'black' | 'white', locale: Locale): string {
  if (ink === 'red') return t('editor.colorRed', undefined, locale);
  if (ink === 'white') return t('editor.colorWhite', undefined, locale);
  return t('editor.colorBlack', undefined, locale);
}

export function flairLabel(key: FlairKey, locale: Locale = currentLocale()): string {
  const variant = VARIANT_FLAIR[key];
  if (variant) return variantDisplayLabel(variant.specId);
  const piece = PIECE_FLAIR[key];
  if (piece) {
    if (piece.set === 'traditional') {
      const character = xiangqiCharacter(piece.ink, piece.role);
      // The character names the piece on its own in Chinese; English readers get
      // the role word too, with the ink so 傌 and 馬 stay distinguishable.
      if (locale !== 'en') return character;
      const ink = piece.ink === 'red' ? 'Red' : 'Black';
      return `${ink} ${ROLE_WORDS[piece.role]} ${character}`;
    }
    const setEntry = XIANGQI_PIECE_SETS.find((entry) => entry.id === piece.set);
    return setColourRoleLabel(
      setEntry ? t(setEntry.labelKey, undefined, locale) : piece.set,
      inkWord(piece.ink, locale),
      t(`editor.role.${piece.role}`, undefined, locale),
      locale,
    );
  }
  const jungle = JUNGLE_FLAIR[key];
  if (jungle) {
    // Jungle's dark side is called Blue everywhere a player sees it.
    const colour =
      jungle.ink === 'red'
        ? t('editor.colorRed', undefined, locale)
        : t('setup.blue', undefined, locale).replace(/方$/, '');
    return setColourRoleLabel(
      t('variant.jungle.name', undefined, locale),
      colour,
      t(`editor.role.${jungle.role}`, undefined, locale),
      locale,
    );
  }
  const chess = CHESS_FLAIR[key];
  if (chess) {
    return setColourRoleLabel(
      t('variant.chess.name', undefined, locale),
      inkWord(chess.ink, locale),
      t(`editor.role.${chess.role}`, undefined, locale),
      locale,
    );
  }
  return key;
}

// The Jungle token's outer ring spans 2 * ringRadiusRatio + ringStrokeRatio of
// its size. This size puts the ring's outer edge at 92 of the 100-unit box, the
// same margin as the xiangqi discs: a ring that touches the box edge loses part
// of its right and bottom stroke to pixel rounding at flair sizes.
const JUNGLE_FLAIR_OUTER = 92;
const JUNGLE_FLAIR_TOKEN_SIZE =
  JUNGLE_FLAIR_OUTER / (2 * JUNGLE_ART.ringRadiusRatio + JUNGLE_ART.ringStrokeRatio);

function jungleFlairSvg(ink: JungleColor, role: JunglePieceRole): string {
  const token = framedTokenSvg({ cx: 50, cy: 50, size: JUNGLE_FLAIR_TOKEN_SIZE, ink, role });
  return `<svg class="flair-piece-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${token}</svg>`;
}

function chessFlairSvg(ink: ChessColor, role: ChessPieceRole): string {
  const raw = PIECE_SVGS[`${ink}:${role}`];
  if (!raw) return '';
  return raw.replace(
    /^<svg[^>]*>/,
    '<svg class="flair-piece-svg" viewBox="0 0 45 45" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">',
  );
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
  const jungle = JUNGLE_FLAIR[key];
  const chess = CHESS_FLAIR[key];
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
    wrap.innerHTML = renderXiangqiPieceGlyphed({ color: piece.ink, role: piece.role }, piece.set, {
      ariaLabel: label,
      className: 'flair-piece-svg',
    });
  } else if (jungle) {
    wrap.innerHTML = jungleFlairSvg(jungle.ink, jungle.role);
  } else if (chess) {
    wrap.innerHTML = chessFlairSvg(chess.ink, chess.role);
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
