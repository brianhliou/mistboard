// Diagrams for /rules/xiangqi-mahjong-32. Every hand here is data that
// xiangqi-mahjong-32-rules-diagrams.test.ts runs through the rules kernel
// (xmjWinShape / xmjScore in packages/game), so a picture on the page cannot
// claim a win, a non-win or a score the game itself would not give.

import {
  type XmjHandState,
  type XmjMeld,
  type XmjTile,
  type XmjWinContext,
  xmjDeal,
  xmjShuffle,
} from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import {
  escapeText,
  xmjTileRowSvg as tileRow,
  XMJ_CLAIM_EDGE,
  XMJ_TILE_GAP,
  XMJ_TILE_H,
  XMJ_TILE_W,
  type XmjRowBadge,
  type XmjTileGroup,
  xmjTileBackSvg,
  xmjTileFigureSvg,
  xmjTileKindGridSvg,
  xmjTileSvg,
} from './xiangqi-mahjong-tile-svg.js';

// Every row draws in the article's active piece set, so the page repaints when
// the reader changes pieces (the raw-svg blocks pass these as thunks).
const xmjTileRowSvg = (
  groups: readonly XmjTileGroup[],
  title: string,
  badge?: XmjRowBadge,
): string => tileRow(groups, title, activeXiangqiPieceSet, badge);

export interface XmjHandExample {
  readonly id: string;
  readonly groups: readonly XmjTileGroup[];
  /** Alt text and the figure caption's subject. */
  readonly title: string;
}

export interface XmjWinExample extends XmjHandExample {
  /** How the hand was won, for the 台 it is asserted to score. */
  readonly context: Omit<XmjWinContext, 'concealed' | 'melds'>;
  /** The 台 lines the kernel must give, in its order. */
  readonly expectedLines: readonly string[];
  readonly expectedTotal: number;
}

const ON_DISCARD = {
  selfDrawn: false,
  winnerIsDealer: false,
  heavenly: false,
  earthly: false,
  lastTile: false,
} as const;

const SELF_DRAWN = { ...ON_DISCARD, selfDrawn: true } as const;

const set = (...tiles: XmjTile[]): XmjTileGroup => ({ tiles, label: 'set' });
const pair = (a: XmjTile, b: XmjTile): XmjTileGroup => ({ tiles: [a, b], label: 'pair' });

/** The concealed tiles and exposed melds a diagram stands for. */
export function xmjExampleHand(example: XmjHandExample): {
  concealed: XmjTile[];
  melds: XmjMeld[];
} {
  const concealed: XmjTile[] = [];
  const melds: XmjMeld[] = [];
  for (const group of example.groups) {
    if (group.claimed) {
      const kind = group.tiles.every((t) => t === group.tiles[0]) ? 'triplet' : 'sequence';
      melds.push({ kind, tiles: [...group.tiles], claimed: group.claimed });
    } else {
      concealed.push(...group.tiles);
    }
  }
  return { concealed, melds };
}

// --- The tiles ----------------------------------------------------------------

/**
 * One side of a xiangqi set as tiles, in rows the reader can take in at phone
 * width: the General's group, the Chariot's group, the Soldiers. Each piece
 * appears as often as the set holds it (XMJ_COPIES; the test checks).
 */
const sideLines = (c: 'r' | 'b'): XmjTile[][] =>
  [
    [`${c}K`, `${c}A`, `${c}A`, `${c}E`, `${c}E`],
    [`${c}R`, `${c}R`, `${c}H`, `${c}H`, `${c}C`, `${c}C`],
    [`${c}P`, `${c}P`, `${c}P`, `${c}P`, `${c}P`],
  ] as XmjTile[][];

export const XMJ32_RED_SIDE: readonly (readonly XmjTile[])[] = sideLines('r');
export const XMJ32_BLACK_SIDE: readonly (readonly XmjTile[])[] = sideLines('b');

/**
 * All 32 tiles in one figure: red's three rows above black's, each row split
 * by kind with the kind's name once under it.
 */
export const XMJ32_TILES_SVG = (): string =>
  xmjTileKindGridSvg(
    [...XMJ32_RED_SIDE, ...XMJ32_BLACK_SIDE],
    'All 32 tiles: the sixteen red tiles above the sixteen black tiles',
    activeXiangqiPieceSet,
    [XMJ32_RED_SIDE.length - 1],
  );

// --- The deal -----------------------------------------------------------------

/** A small seeded generator (mulberry32), so the page's deal never changes. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The deal the page draws: a real kernel shuffle and deal (xmjShuffle,
 * xmjDeal), seeded so it is the same on every visit. Seat 0 deals; the reader
 * is seat 1, with four tiles.
 */
export const XMJ32_DEAL_SEED = 12;
export const XMJ32_DEAL: XmjHandState = xmjDeal(xmjShuffle(seededRandom(XMJ32_DEAL_SEED)), 0);

/** The table from the reader's seat: the dealer's backs, the wall, your four. */
export const XMJ32_DEAL_SVG = (): string => {
  const W = 278;
  const centre = (n: number, w: number, gap: number) => (W - (n * w + (n - 1) * gap)) / 2;
  const label = (y: number, text: string, extra = '') =>
    `<text x="${W / 2}" y="${y}" text-anchor="middle" font-size="12" fill="currentColor"${extra}>${escapeText(text)}</text>`;
  const parts: string[] = [];
  const dealer = XMJ32_DEAL.hands[XMJ32_DEAL.dealer];
  const yours = XMJ32_DEAL.hands[XMJ32_DEAL.dealer === 0 ? 1 : 0];

  parts.push(label(14, `Dealer, ${dealer.length} tiles`, ' font-weight="600"'));
  const dx = centre(dealer.length, XMJ_TILE_W, XMJ_TILE_GAP);
  dealer.forEach((_, i) => {
    parts.push(xmjTileBackSvg(dx + i * (XMJ_TILE_W + XMJ_TILE_GAP), 22));
  });

  // The wall as two rows of small backs, every tile in it drawn once.
  const WALL_W = 20;
  const WALL_H = 26;
  const perRow = Math.ceil(XMJ32_DEAL.wall.length / 2);
  parts.push(label(110, 'Wall', ' font-weight="600"'));
  const wx = centre(perRow, WALL_W, 2);
  XMJ32_DEAL.wall.forEach((_, i) => {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : i - perRow;
    parts.push(xmjTileBackSvg(wx + col * (WALL_W + 2), 118 + row * (WALL_H + 5), WALL_W, WALL_H));
  });
  parts.push(
    label(196, `${XMJ32_DEAL.wall.length} left`, ' font-style="italic" fill-opacity="0.75"'),
  );

  parts.push(label(222, `You, ${yours.length} tiles`, ' font-weight="600"'));
  const yx = centre(yours.length, XMJ_TILE_W, XMJ_TILE_GAP);
  yours.forEach((tile, i) => {
    parts.push(xmjTileSvg(tile, yx + i * (XMJ_TILE_W + XMJ_TILE_GAP), 230, activeXiangqiPieceSet));
  });

  return xmjTileFigureSvg(
    W,
    316,
    'The deal: the dealer with five tiles face down, the 23-tile wall, and your four tiles face up',
    parts.join(''),
  );
};

// --- The four sets ----------------------------------------------------------

export const XMJ32_SEQUENCES: readonly XmjTileGroup[] = [
  { tiles: ['rK', 'rA', 'rE'], label: 'red' },
  { tiles: ['bK', 'bA', 'bE'], label: 'black' },
  { tiles: ['rR', 'rH', 'rC'], label: 'red' },
  { tiles: ['bR', 'bH', 'bC'], label: 'black' },
];
export const XMJ32_SEQUENCES_SVG = (): string =>
  xmjTileRowSvg(XMJ32_SEQUENCES.slice(0, 2), 'General, Advisor, Elephant in red and in black');
export const XMJ32_SEQUENCES_SVG_2 = (): string =>
  xmjTileRowSvg(XMJ32_SEQUENCES.slice(2), 'Chariot, Horse, Cannon in red and in black');

export const XMJ32_TRIPLETS: readonly XmjTileGroup[] = [
  { tiles: ['rP', 'rP', 'rP'], label: 'red' },
  { tiles: ['bP', 'bP', 'bP'], label: 'black' },
];
export const XMJ32_TRIPLETS_SVG = (): string =>
  xmjTileRowSvg(XMJ32_TRIPLETS, 'Three red Soldiers and three black Soldiers');

export const XMJ32_PAIRS: readonly XmjTileGroup[] = [
  { tiles: ['bH', 'bH'], label: 'identical' },
  { tiles: ['rP', 'rP'], label: 'identical' },
  { tiles: ['rK', 'bK'], label: 'the two Generals' },
];
export const XMJ32_PAIRS_SVG = (): string =>
  xmjTileRowSvg(XMJ32_PAIRS, 'Three pairs: two black Horses, two red Soldiers, the two Generals');

// --- Winning hands -------------------------------------------------------------

export const XMJ32_WINS: readonly XmjWinExample[] = [
  {
    id: 'palace',
    title: 'General, Advisor, Elephant with a pair of Horses',
    groups: [set('rK', 'rA', 'rE'), pair('bH', 'bH')],
    context: ON_DISCARD,
    expectedLines: ['win'],
    expectedTotal: 1,
  },
  {
    id: 'chariot',
    title: 'Chariot, Horse, Cannon with a pair of Soldiers',
    groups: [set('bR', 'bH', 'bC'), pair('rP', 'rP')],
    context: ON_DISCARD,
    expectedLines: ['win'],
    expectedTotal: 1,
  },
  {
    id: 'soldiers',
    title: 'Three Soldiers with a pair of Advisors',
    groups: [set('bP', 'bP', 'bP'), pair('rA', 'rA')],
    context: ON_DISCARD,
    expectedLines: ['win'],
    expectedTotal: 1,
  },
  {
    id: 'one-colour',
    title: 'One colour: every tile red',
    groups: [set('rR', 'rH', 'rC'), pair('rP', 'rP')],
    context: ON_DISCARD,
    expectedLines: ['win', 'one-colour'],
    expectedTotal: 2,
  },
  {
    id: 'generals',
    title: 'Generals pair: the red and the black General as the pair',
    groups: [set('rR', 'rH', 'rC'), pair('rK', 'bK')],
    context: ON_DISCARD,
    expectedLines: ['win', 'generals-pair'],
    expectedTotal: 3,
  },
  {
    id: 'five-soldiers',
    title: 'Five Soldiers: all five Soldiers of one colour',
    groups: [set('bP', 'bP', 'bP'), pair('bP', 'bP')],
    context: ON_DISCARD,
    expectedLines: ['win', 'one-colour', 'five-soldiers'],
    expectedTotal: 7,
  },
];

/** A winning row, marked with the green check. */
export function xmj32WinSvg(id: string): () => string {
  const example = XMJ32_WINS.find((w) => w.id === id);
  if (!example) throw new Error(`xmj32WinSvg: no example ${id}`);
  return () => xmjTileRowSvg(example.groups, `Winning hand: ${example.title}`, 'win');
}

// --- A claim, animated -------------------------------------------------------

/**
 * The claim the page animates: you hold four tiles, the other player discards
 * the red Cannon, you claim it into Chariot, Horse, Cannon (face up, the
 * claimed tile edged in blue) and discard the Soldier without drawing. The
 * test checks the kernel allows this claim and that the set is a sequence.
 */
export const XMJ32_CLAIM_HAND: readonly XmjTile[] = ['rR', 'rH', 'bE', 'bP'];
export const XMJ32_CLAIM_DISCARD: XmjTile = 'rC';
export const XMJ32_CLAIM_SET: readonly XmjTile[] = ['rR', 'rH', XMJ32_CLAIM_DISCARD];
export const XMJ32_CLAIM_KEPT: XmjTile = 'bE';
export const XMJ32_CLAIM_THROWN: XmjTile = 'bP';
/** What the other player had already discarded before the Cannon. */
export const XMJ32_CLAIM_EARLIER_DISCARD: XmjTile = 'bA';

const CLAIM_BEFORE_GROUPS: readonly XmjTileGroup[] = [
  { tiles: XMJ32_CLAIM_HAND, label: 'your hand' },
  { tiles: [XMJ32_CLAIM_DISCARD], label: 'their discard' },
];
const CLAIM_AFTER_GROUPS: readonly XmjTileGroup[] = [
  { tiles: XMJ32_CLAIM_SET, label: 'claimed, face up', claimed: XMJ32_CLAIM_DISCARD },
  { tiles: [XMJ32_CLAIM_KEPT], label: 'kept' },
  { tiles: [XMJ32_CLAIM_THROWN], label: 'discarded' },
];

const CLAIM_SECONDS = 5;

/**
 * The claim as one animated figure (an animated-svg block). Every tile is
 * drawn where it ends; keyframes (fill-mode both) start each one where it
 * begins, so the SVG's still state is the end frame. Timeline of the 5 s:
 * the Cannon lands in their discards (0 to 0.5 s), moves into your hand
 * beside the Horse as the Elephant steps right (1.3 to 2.2 s), the set is
 * marked face up with the blue edge on the Cannon (2.4 to 2.9 s), then the
 * Soldier goes to your discards (3.3 to 4.2 s) and the frame holds.
 */
export const XMJ32_CLAIM_ANIMATION_SVG = (): string => {
  const P = activeXiangqiPieceSet;
  const pitch = XMJ_TILE_W + XMJ_TILE_GAP;
  const x0 = 4;
  const theirY = 20;
  const discardY = 123;
  const handY = 226;
  const keptX = x0 + 3 * pitch + 22 - XMJ_TILE_GAP;
  const label = (y: number, text: string) =>
    `<text x="${x0}" y="${y}" font-size="11.5" font-weight="600" fill="currentColor" fill-opacity="0.7">${escapeText(text)}</text>`;
  const cannonX = x0 + 2 * pitch;
  const cannonFrom = { x: x0 + pitch - cannonX, y: theirY - handY };
  const elephantFrom = x0 + 2 * pitch - keptX;
  const soldierFrom = { x: x0 + 3 * pitch - x0, y: handY - discardY };
  const setEnd = x0 + 3 * pitch - XMJ_TILE_GAP;
  const by = handY + XMJ_TILE_H + 5 + 23;
  const t = (n: number) => `${(n / CLAIM_SECONDS) * 100}%`;
  const style = [
    `@keyframes xmj-claim-cannon{0%{transform:translate(${cannonFrom.x}px,${cannonFrom.y}px);opacity:0}${t(0.5)},${t(1.3)}{transform:translate(${cannonFrom.x}px,${cannonFrom.y}px);opacity:1}${t(2.2)},100%{transform:none;opacity:1}}`,
    `@keyframes xmj-claim-shift{0%,${t(1.3)}{transform:translateX(${elephantFrom}px)}${t(2.2)},100%{transform:none}}`,
    `@keyframes xmj-claim-show{0%,${t(2.4)}{opacity:0}${t(2.9)},100%{opacity:1}}`,
    `@keyframes xmj-claim-throw{0%,${t(3.3)}{transform:translate(${soldierFrom.x}px,${soldierFrom.y}px)}${t(4.2)},100%{transform:none}}`,
    `.xmj-claim-cannon{animation:xmj-claim-cannon ${CLAIM_SECONDS}s ease-in-out both}`,
    `.xmj-claim-kept{animation:xmj-claim-shift ${CLAIM_SECONDS}s ease-in-out both}`,
    `.xmj-claim-mark{animation:xmj-claim-show ${CLAIM_SECONDS}s ease-in-out both}`,
    `.xmj-claim-thrown{animation:xmj-claim-throw ${CLAIM_SECONDS}s ease-in-out both}`,
  ].join('');
  const parts = [
    `<style>${style}</style>`,
    label(13, 'Their discards'),
    xmjTileSvg(XMJ32_CLAIM_EARLIER_DISCARD, x0, theirY, P),
    label(116, 'Your discards'),
    label(219, 'Your hand'),
    xmjTileSvg('rR', x0, handY, P),
    xmjTileSvg('rH', x0 + pitch, handY, P),
    `<g class="xmj-claim-kept">${xmjTileSvg(XMJ32_CLAIM_KEPT, keptX, handY, P)}</g>`,
    `<g class="xmj-claim-mark">`,
    `<path d="M${x0 + 2} ${by - 4}V${by}H${setEnd - 2}V${by - 4}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>`,
    `<text x="${(x0 + setEnd) / 2}" y="${by + 14}" text-anchor="middle" font-size="11" font-style="italic" fill="currentColor" fill-opacity="0.75">claimed, face up</text></g>`,
    `<g class="xmj-claim-cannon">${xmjTileSvg(XMJ32_CLAIM_DISCARD, cannonX, handY, P)}<rect class="xmj-claim-mark" x="${cannonX}" y="${handY}" width="${XMJ_TILE_W}" height="${XMJ_TILE_H}" rx="6" fill="none" stroke="${XMJ_CLAIM_EDGE}" stroke-width="2.5"/></g>`,
    `<g class="xmj-claim-thrown">${xmjTileSvg(XMJ32_CLAIM_THROWN, x0, discardY, P)}</g>`,
  ];
  return xmjTileFigureSvg(
    keptX + XMJ_TILE_W + 4,
    by + 22,
    'A claim: the other player discards the red Cannon, you take it into Chariot, Horse, Cannon, lay the set face up and discard the black Soldier',
    parts.join(''),
  );
};

/** The claim for readers who asked for less motion: before, then after. */
export const XMJ32_CLAIM_STATIC_SVG = (): string =>
  xmjTileRowSvg(CLAIM_BEFORE_GROUPS, 'Before: your four tiles, and the red Cannon they discard') +
  xmjTileRowSvg(
    CLAIM_AFTER_GROUPS,
    'After: the claimed set face up, the Elephant kept, the Soldier discarded',
  );

// --- Not a win ---------------------------------------------------------------

export const XMJ32_NOT_WINS: readonly XmjHandExample[] = [
  {
    id: 'mixed-colour',
    title: 'Not a winning hand: the General, Advisor and Elephant are not all one colour',
    groups: [{ tiles: ['rK', 'bA', 'rE'] }, { tiles: ['rP', 'rP'] }],
  },
  {
    id: 'mixed-group',
    title: 'Not a winning hand: General, Advisor and Horse come from different sets',
    groups: [{ tiles: ['bK', 'bA', 'bH'] }, { tiles: ['rC', 'rC'] }],
  },
  {
    id: 'mixed-soldiers',
    title: 'Not a winning hand: two red Soldiers and a black one are not three of a kind',
    groups: [{ tiles: ['rP', 'rP', 'bP'] }, { tiles: ['bE', 'bE'] }],
  },
  {
    id: 'mixed-pair',
    title: 'Not a winning hand: a red and a black Advisor are not a pair',
    groups: [{ tiles: ['rR', 'rH', 'rC'] }, { tiles: ['rA', 'bA'] }],
  },
];

/** A non-winning row, marked with the red cross. */
export function xmj32NotWinSvg(id: string): () => string {
  const example = XMJ32_NOT_WINS.find((w) => w.id === id);
  if (!example) throw new Error(`xmj32NotWinSvg: no example ${id}`);
  return () => xmjTileRowSvg(example.groups, example.title, 'not-win');
}

// --- The worked example ------------------------------------------------------

/**
 * The dealer draws the black General and wins on its own draw: Chariot, Horse,
 * Cannon in red, and the two Generals as the pair. Win 1, self-draw 2, dealer
 * 1, Generals pair 2.
 */
export const XMJ32_WORKED: XmjWinExample = {
  id: 'worked',
  title: 'The dealer draws the black General to win',
  groups: [set('rR', 'rH', 'rC'), pair('rK', 'bK')],
  context: { ...SELF_DRAWN, winnerIsDealer: true },
  expectedLines: ['win', 'self-draw', 'dealer', 'generals-pair'],
  expectedTotal: 6,
};

export const XMJ32_WORKED_SVG = (): string =>
  xmjTileRowSvg(XMJ32_WORKED.groups, XMJ32_WORKED.title);

// --- A six-hand match --------------------------------------------------------

export type XmjMatchPlayer = 'Ana' | 'Ben';

export interface XmjMatchHand {
  readonly dealer: XmjMatchPlayer;
  /** Null: the wall ran out and the hand is void. */
  readonly winner: XmjMatchPlayer | null;
  /** How it was won, as the table says it. */
  readonly how: string;
  /** The winning hand; the test scores it through xmjScore. Null when void. */
  readonly win: XmjWinExample | null;
}

const ON_DISCARD_AS_DEALER = { ...ON_DISCARD, winnerIsDealer: true } as const;

/**
 * A whole match for the page's table: the deal alternates, two hands are void,
 * and each win is a real hand whose points the kernel gives.
 */
export const XMJ32_MATCH: readonly XmjMatchHand[] = [
  {
    dealer: 'Ana',
    winner: 'Ana',
    how: 'Ben’s discard, as dealer',
    win: {
      id: 'match-1',
      title: 'General, Advisor, Elephant with two black Horses',
      groups: [set('rK', 'rA', 'rE'), pair('bH', 'bH')],
      context: ON_DISCARD_AS_DEALER,
      expectedLines: ['win', 'dealer'],
      expectedTotal: 2,
    },
  },
  { dealer: 'Ben', winner: null, how: 'Void: the wall ran out', win: null },
  {
    dealer: 'Ana',
    winner: 'Ben',
    how: 'Self-draw',
    win: {
      id: 'match-3',
      title: 'Black Chariot, Horse, Cannon with two red Soldiers',
      groups: [set('bR', 'bH', 'bC'), pair('rP', 'rP')],
      context: SELF_DRAWN,
      expectedLines: ['win', 'self-draw'],
      expectedTotal: 3,
    },
  },
  {
    dealer: 'Ben',
    winner: 'Ben',
    how: 'Ana’s discard, as dealer, one colour',
    win: {
      id: 'match-4',
      title: 'Red Chariot, Horse, Cannon with two red Soldiers',
      groups: [set('rR', 'rH', 'rC'), pair('rP', 'rP')],
      context: ON_DISCARD_AS_DEALER,
      expectedLines: ['win', 'dealer', 'one-colour'],
      expectedTotal: 3,
    },
  },
  {
    dealer: 'Ana',
    winner: 'Ana',
    how: 'Self-draw on the last tile, as dealer',
    win: {
      id: 'match-5',
      title: 'Three black Soldiers with two red Advisors',
      groups: [set('bP', 'bP', 'bP'), pair('rA', 'rA')],
      context: { ...SELF_DRAWN, winnerIsDealer: true, lastTile: true },
      expectedLines: ['win', 'self-draw', 'dealer', 'last-tile'],
      expectedTotal: 5,
    },
  },
  { dealer: 'Ben', winner: null, how: 'Void: the wall ran out', win: null },
];

/** The scoreboard's header: the hands across, then the total. */
export const XMJ32_MATCH_HEADERS: readonly string[] = [
  'Hand',
  ...XMJ32_MATCH.map((_, i) => String(i + 1)),
  'Total',
];

/**
 * The match as a mahjong scoreboard, one row per player: the points each won
 * on each hand (empty when the other player won it), "void" in both rows for a
 * hand nobody won, then the total.
 */
export function xmj32MatchRows(): string[][] {
  return (['Ana', 'Ben'] as const).map((player) => {
    let total = 0;
    const cells = XMJ32_MATCH.map((hand) => {
      if (!hand.winner) return 'void';
      if (hand.winner !== player) return '';
      const points = hand.win?.expectedTotal ?? 0;
      total += points;
      return String(points);
    });
    return [player, ...cells, String(total)];
  });
}
