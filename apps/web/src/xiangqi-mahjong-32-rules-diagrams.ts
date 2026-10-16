// Diagrams for /rules/xiangqi-mahjong-32. Every hand here is data that
// xiangqi-mahjong-32-rules-diagrams.test.ts runs through the rules kernel
// (xmjWinShape / xmjScore in packages/game), so a picture on the page cannot
// claim a win, a non-win or a score the game itself would not give.

import type { XmjMeld, XmjTile, XmjWinContext } from '@mistboard/game';
import { activeXiangqiPieceSet } from './articles/diagrams.js';
import { xmjTileRowSvg as tileRow, type XmjTileGroup } from './xiangqi-mahjong-tile-svg.js';

// Every row draws in the article's active piece set, so the page repaints when
// the reader changes pieces (the raw-svg blocks pass these as thunks).
const xmjTileRowSvg = (groups: readonly XmjTileGroup[], title: string): string =>
  tileRow(groups, title, activeXiangqiPieceSet);

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

export const XMJ32_RED_TILES: readonly XmjTile[] = ['rK', 'rA', 'rE', 'rR', 'rH', 'rC', 'rP'];
export const XMJ32_BLACK_TILES: readonly XmjTile[] = ['bK', 'bA', 'bE', 'bR', 'bH', 'bC', 'bP'];

export const XMJ32_RED_KINDS = (): string =>
  xmjTileRowSvg([{ tiles: XMJ32_RED_TILES }], 'The seven red tiles');
export const XMJ32_BLACK_KINDS = (): string =>
  xmjTileRowSvg([{ tiles: XMJ32_BLACK_TILES }], 'The seven black tiles');

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
  {
    id: 'claimed',
    title: 'A claimed set: the Cannon taken from a discard, then a pair drawn',
    groups: [{ tiles: ['rR', 'rH', 'rC'], label: 'claimed set', claimed: 'rC' }, pair('bE', 'bE')],
    context: SELF_DRAWN,
    expectedLines: ['win', 'self-draw'],
    expectedTotal: 3,
  },
];

export function xmj32WinSvg(id: string): () => string {
  const example = XMJ32_WINS.find((w) => w.id === id);
  if (!example) throw new Error(`xmj32WinSvg: no example ${id}`);
  return () => xmjTileRowSvg(example.groups, example.title);
}

// --- A claim, step by step ----------------------------------------------------

/**
 * The claim walk-through: you hold four tiles, the other player discards the
 * red Cannon, you claim it into Chariot, Horse, Cannon and throw the Soldier,
 * then draw the second black Elephant for the pair. The last step is the
 * 'claimed' win above; the test checks the claim is legal from this hand.
 */
export const XMJ32_CLAIM_HAND: readonly XmjTile[] = ['rR', 'rH', 'bE', 'bP'];
export const XMJ32_CLAIM_DISCARD: XmjTile = 'rC';
export const XMJ32_CLAIM_THROWN: XmjTile = 'bP';

export const XMJ32_CLAIM_BEFORE_SVG = (): string =>
  xmjTileRowSvg(
    [
      { tiles: XMJ32_CLAIM_HAND, label: 'your hand' },
      { tiles: [XMJ32_CLAIM_DISCARD], label: 'discard' },
    ],
    'Your four tiles, and the red Cannon the other player discards',
  );

export const XMJ32_CLAIM_AFTER_SVG = (): string =>
  xmjTileRowSvg(
    [
      { tiles: ['rR', 'rH', XMJ32_CLAIM_DISCARD], label: 'face up', claimed: XMJ32_CLAIM_DISCARD },
      { tiles: ['bE'], label: 'kept' },
      { tiles: [XMJ32_CLAIM_THROWN], label: 'thrown' },
    ],
    'The claimed set face up, the Elephant kept, the Soldier discarded',
  );

// --- Not a win ---------------------------------------------------------------

export const XMJ32_NOT_WINS: readonly XmjHandExample[] = [
  {
    id: 'mixed-colour',
    title: 'Not a win: the General, Advisor and Elephant are not all one colour',
    groups: [{ tiles: ['rK', 'bA', 'rE'] }, { tiles: ['rP', 'rP'] }],
  },
  {
    id: 'mixed-group',
    title: 'Not a win: General, Advisor and Horse come from different sets',
    groups: [{ tiles: ['bK', 'bA', 'bH'] }, { tiles: ['rC', 'rC'] }],
  },
  {
    id: 'mixed-soldiers',
    title: 'Not a win: two red Soldiers and a black one are not three of a kind',
    groups: [{ tiles: ['rP', 'rP', 'bP'] }, { tiles: ['bE', 'bE'] }],
  },
  {
    id: 'mixed-pair',
    title: 'Not a win: a red and a black Advisor are not a pair',
    groups: [{ tiles: ['rR', 'rH', 'rC'] }, { tiles: ['rA', 'bA'] }],
  },
];

export function xmj32NotWinSvg(id: string): () => string {
  const example = XMJ32_NOT_WINS.find((w) => w.id === id);
  if (!example) throw new Error(`xmj32NotWinSvg: no example ${id}`);
  return () => xmjTileRowSvg(example.groups, example.title);
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
