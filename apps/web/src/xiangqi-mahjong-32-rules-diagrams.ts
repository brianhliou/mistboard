// Diagrams for /rules/xiangqi-mahjong-32. Every hand here is data that
// xiangqi-mahjong-32-rules-diagrams.test.ts runs through the rules kernel
// (xmjWinShape / xmjScore in packages/game), so a picture on the page cannot
// claim a win, a non-win or a score the game itself would not give.

import {
  tileColor,
  tilePiece,
  XMJ_PIECE_NAMES,
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
  XMJ_GROUP_GAP,
  XMJ_TILE_DEPTH,
  XMJ_TILE_GAP,
  XMJ_TILE_H,
  XMJ_TILE_W,
  type XmjRowBadge,
  type XmjTileGroup,
  xmjTileBackSvg,
  xmjTileBox,
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
    expectedLines: ['win', 'red-general'],
    expectedTotal: 2,
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
    id: 'mixed-soldiers',
    title: 'Mixed Soldiers: three red Soldiers with a pair of black ones',
    groups: [set('rP', 'rP', 'rP'), pair('bP', 'bP')],
    context: ON_DISCARD,
    expectedLines: ['win', 'mixed-soldiers'],
    expectedTotal: 3,
  },
  {
    id: 'three-horses',
    title: 'Three of a piece: a black Horse in the set and a pair of red Horses',
    groups: [set('bR', 'bH', 'bC'), pair('rH', 'rH')],
    context: ON_DISCARD,
    expectedLines: ['win', 'three-horses'],
    expectedTotal: 3,
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
 * The claim the page animates: the other player draws from the wall and
 * discards the red Cannon; you hold four tiles, claim it into Chariot, Horse,
 * Cannon (face up, apart from your hand, the claimed Cannon lying sideways)
 * and discard the Soldier without drawing. The test checks the kernel allows
 * this claim and that the set is a sequence.
 */
export const XMJ32_CLAIM_HAND: readonly XmjTile[] = ['rR', 'rH', 'bE', 'bP'];
export const XMJ32_CLAIM_DISCARD: XmjTile = 'rC';
export const XMJ32_CLAIM_SET: readonly XmjTile[] = ['rR', 'rH', XMJ32_CLAIM_DISCARD];
export const XMJ32_CLAIM_KEPT: XmjTile = 'bE';
export const XMJ32_CLAIM_THROWN: XmjTile = 'bP';
/** What the other player had already discarded before the Cannon. */
export const XMJ32_CLAIM_EARLIER_DISCARD: XmjTile = 'bA';
/** The other player's hand, face down, before their draw and after their discard. */
export const XMJ32_CLAIM_THEIR_TILES = 4;

const CLAIM_AFTER_GROUPS: readonly XmjTileGroup[] = [
  { tiles: XMJ32_CLAIM_SET, label: 'claimed, face up', claimed: XMJ32_CLAIM_DISCARD },
  { tiles: [XMJ32_CLAIM_KEPT], label: 'kept' },
  { tiles: [XMJ32_CLAIM_THROWN], label: 'discarded' },
];

/**
 * When each step starts and ends, in seconds. Their draw, a pause, their
 * discard (the tile turning face up halfway down), their hand closing up, a
 * pause, then your claim: the Cannon to your set while your Elephant and
 * Soldier make room, the drop into the set, its bracket, and the Soldier to
 * your discards. The frame then holds to the end.
 */
export const XMJ32_CLAIM_STEPS = {
  draw: 0.7,
  drawn: 1.4,
  discard: 2,
  flip: 2.4,
  flipped: 2.5,
  discarded: 2.9,
  close: 3.1,
  closed: 3.6,
  claim: 4.3,
  claimTurned: 4.45,
  slid: 5,
  dropped: 5.6,
  mark: 5.8,
  marked: 6.3,
  throwUp: 6.8,
  thrownUp: 7.25,
  thrown: 7.7,
} as const;
export const XMJ32_CLAIM_SECONDS = 9;

const CLAIM_PITCH = XMJ_TILE_W + XMJ_TILE_GAP;
const CLAIM_X0 = 4;
const CLAIM_SIDEWAYS = xmjTileBox(true);
/** How far the wall's lower layer shows below its upper one. */
const CLAIM_WALL_STEP = 10;

/**
 * Every place a tile rests in the claim figure: the one source of its x and y.
 * `col` is the upright grid every row shares (their hand, the discards, and
 * your hand before the claim). After the claim your hand row is the set (its
 * third tile lying sideways on the row's bottom edge), a group gap, then your
 * own tiles on the same pitch: `kept` for the Elephant, `parked` for the
 * Soldier while the set is shown. The wall is two stacks two high at the right
 * of their discards, its last stack on the `parked` column; the tile they draw
 * comes off its top and waits in their hand row on that column before the
 * hand closes up.
 */
export const XMJ32_CLAIM_SLOTS = (() => {
  const col = [0, 1, 2, 3].map((i) => CLAIM_X0 + i * CLAIM_PITCH);
  const set = col.slice(0, 3);
  const setEnd = (set[2] ?? 0) + CLAIM_SIDEWAYS.w;
  const kept = setEnd + XMJ_GROUP_GAP;
  const parked = kept + CLAIM_PITCH;
  const rows = { theirHand: 20, theirs: 112, yours: 215, hand: 318 } as const;
  return {
    rows,
    col,
    set,
    setEnd,
    kept,
    parked,
    /** The wall's two stacks, two tiles' widths at the figure's right edge. */
    wall: [parked - XMJ_TILE_W - 2, parked],
    /** The top of the wall's lower layer, peeking out under the upper one. */
    wallUnder: rows.theirs + CLAIM_WALL_STEP,
    /** How far a sideways tile sits below its row's top: on the upright tiles' bottom edge. */
    sidewaysDrop: XMJ_TILE_H - CLAIM_SIDEWAYS.h,
    /** The top of the claimed Cannon, lying sideways in your hand row. */
    sidewaysY: rows.hand + XMJ_TILE_H - CLAIM_SIDEWAYS.h,
  } as const;
})();

/** Where a tile is at one moment: its box's top-left, and turned upright. */
export interface XmjClaimPose {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  /** A sideways tile turned a quarter back to upright (as it lay in the discards). */
  readonly turned?: boolean;
}

/** One tile's part in the claim: drawn where its last pose puts it. */
export interface XmjClaimTrack {
  /** Its class, `xmj-claim-<id>`. */
  readonly id: string;
  /** The physical tile; two tracks of one body are its two looks crossfading. */
  readonly body: string;
  /** Its face, or `back` for a tile face down. */
  readonly tile: XmjTile | 'back';
  readonly sideways?: boolean;
  /** The piece name under it; off for the Cannon in flight (the mark adds it). */
  readonly name?: boolean;
  /** A tile of the wall: the wall's two layers overlap, as a stack does. */
  readonly stack?: boolean;
  readonly poses: readonly XmjClaimPose[];
  /** When it shows; shown throughout when omitted. */
  readonly fades?: readonly { readonly at: number; readonly shown: boolean }[];
}

/**
 * The claim's timeline (XMJ32_CLAIM_STEPS). They draw the top tile of the
 * wall's right stack straight up into their hand row, where it waits apart.
 * They discard the tile second from the left: it drops straight down into
 * their discards beside the Advisor and turns face up as the Cannon halfway
 * down; then their hand closes up, back to four. Your claim follows as before:
 * the Cannon slides along their discards' row to the set's third slot, turning
 * to lie sideways, while the Elephant and the Soldier step right in your hand;
 * it drops straight down into the set; the set's bracket comes up; then the
 * Soldier goes up to your discards' row and along it to the first slot. Every
 * pose is a slot (XMJ32_CLAIM_SLOTS), and the test checks no two tiles overlap
 * at any moment, outside the wall's own layers.
 */
export const XMJ32_CLAIM_TRACKS: readonly XmjClaimTrack[] = (() => {
  const S = XMJ32_CLAIM_SLOTS;
  const T = XMJ32_CLAIM_STEPS;
  const { theirHand, theirs, yours, hand } = S.rows;
  const [c0 = 0, c1 = 0, c2 = 0, c3 = 0] = S.col;
  const [w0 = 0, w1 = 0] = S.wall;
  const discardPoses = [
    { at: T.discard, x: c1, y: theirHand },
    { at: T.discarded, x: c1, y: theirs },
  ];
  return [
    {
      id: 'earlier',
      body: 'earlier',
      tile: XMJ32_CLAIM_EARLIER_DISCARD,
      poses: [{ at: 0, x: c0, y: theirs }],
    },
    // The wall: the lower layer first, so the upper one lies over it.
    {
      id: 'wall-0',
      body: 'wall-0',
      tile: 'back',
      stack: true,
      poses: [{ at: 0, x: w0, y: S.wallUnder }],
    },
    {
      id: 'wall-1',
      body: 'wall-1',
      tile: 'back',
      stack: true,
      poses: [{ at: 0, x: w1, y: S.wallUnder }],
    },
    {
      id: 'wall-2',
      body: 'wall-2',
      tile: 'back',
      stack: true,
      poses: [{ at: 0, x: w0, y: theirs }],
    },
    // Their hand, face down.
    { id: 'their-0', body: 'their-0', tile: 'back', poses: [{ at: 0, x: c0, y: theirHand }] },
    {
      id: 'their-2',
      body: 'their-2',
      tile: 'back',
      poses: [
        { at: T.close, x: c2, y: theirHand },
        { at: T.closed, x: c1, y: theirHand },
      ],
    },
    {
      id: 'their-3',
      body: 'their-3',
      tile: 'back',
      poses: [
        { at: T.close, x: c3, y: theirHand },
        { at: T.closed, x: c2, y: theirHand },
      ],
    },
    {
      id: 'drawn',
      body: 'drawn',
      tile: 'back',
      stack: true,
      poses: [
        { at: T.draw, x: w1, y: theirs },
        { at: T.drawn, x: w1, y: theirHand },
        { at: T.close, x: w1, y: theirHand },
        { at: T.closed, x: c3, y: theirHand },
      ],
    },
    // Their discard: the back, then the Cannon it turns into halfway down.
    {
      id: 'their-back',
      body: 'cannon',
      tile: 'back',
      poses: discardPoses,
      fades: [
        { at: 0, shown: true },
        { at: T.flip, shown: true },
        { at: T.flipped, shown: false },
      ],
    },
    {
      id: 'their-cannon',
      body: 'cannon',
      tile: XMJ32_CLAIM_DISCARD,
      poses: discardPoses,
      fades: [
        { at: 0, shown: false },
        { at: T.flip, shown: false },
        { at: T.flipped, shown: true },
        { at: T.claim, shown: true },
        { at: T.claimTurned, shown: false },
      ],
    },
    { id: 'chariot', body: 'chariot', tile: 'rR', poses: [{ at: 0, x: c0, y: hand }] },
    { id: 'horse', body: 'horse', tile: 'rH', poses: [{ at: 0, x: c1, y: hand }] },
    {
      id: 'kept',
      body: 'elephant',
      tile: XMJ32_CLAIM_KEPT,
      poses: [
        { at: T.claim, x: c2, y: hand },
        { at: T.slid, x: S.kept, y: hand },
      ],
    },
    {
      id: 'thrown',
      body: 'soldier',
      tile: XMJ32_CLAIM_THROWN,
      poses: [
        { at: T.claim, x: c3, y: hand },
        { at: T.slid, x: S.parked, y: hand },
        { at: T.throwUp, x: S.parked, y: hand },
        { at: T.thrownUp, x: S.parked, y: yours },
        { at: T.thrown, x: c0, y: yours },
      ],
    },
    {
      id: 'cannon',
      body: 'cannon',
      tile: XMJ32_CLAIM_DISCARD,
      sideways: true,
      name: false,
      // Turned upright, it fills the slot it lay in among their discards.
      poses: [
        { at: T.claim, x: c1, y: theirs, turned: true },
        { at: T.slid, x: S.set[2] ?? 0, y: theirs + S.sidewaysDrop },
        { at: T.dropped, x: S.set[2] ?? 0, y: S.sidewaysY },
      ],
      fades: [
        { at: T.claim, shown: false },
        { at: T.claimTurned, shown: true },
      ],
    },
  ];
})();

/** A track's box (upright, or as it lies), before any turn. */
const trackBox = (track: XmjClaimTrack) => xmjTileBox(track.sideways === true);

/**
 * Every tile's box at `time` seconds, with whether it shows. Between poses a
 * tile moves on a straight line and turns evenly; every moving tile in one
 * step shares its start and end, so the CSS easing moves them in step and
 * this linear model keeps their relative places. A box includes the tile's
 * depth below it.
 */
export function xmj32ClaimBoxes(time: number): {
  id: string;
  body: string;
  back: boolean;
  stack: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  shown: boolean;
}[] {
  return XMJ32_CLAIM_TRACKS.map((track) => {
    const { w, h } = trackBox(track);
    const poses = track.poses;
    // The poses either side of `time`; before the first or after the last, it holds.
    const a = [...poses].reverse().find((p) => p.at <= time) ?? (poses[0] as XmjClaimPose);
    const b = poses.find((p) => p.at >= time) ?? (poses.at(-1) as XmjClaimPose);
    const f = b.at > a.at ? (time - a.at) / (b.at - a.at) : 0;
    const centre = (p: XmjClaimPose) => {
      const [pw, ph] = p.turned ? [h, w] : [w, h];
      return { x: p.x + pw / 2, y: p.y + ph / 2 };
    };
    const [ca, cb] = [centre(a), centre(b)];
    const angle = ((a.turned ? 1 - f : 0) + (b.turned ? f : 0)) * (Math.PI / 2);
    const bw = w * Math.abs(Math.cos(angle)) + h * Math.abs(Math.sin(angle));
    const bh = w * Math.abs(Math.sin(angle)) + h * Math.abs(Math.cos(angle));
    const cx = ca.x + (cb.x - ca.x) * f;
    const cy = ca.y + (cb.y - ca.y) * f;
    // Shown while its opacity is above 0: fading in counts from the start.
    const fades = track.fades ?? [];
    let shown = fades[0]?.shown ?? true;
    fades.forEach((fade, i) => {
      if (fade.at > time) return;
      const next = fades[i + 1];
      shown = fade.shown || (next?.shown === true && time > fade.at);
    });
    return {
      id: track.id,
      body: track.body,
      back: track.tile === 'back',
      stack: track.stack === true,
      x: cx - bw / 2,
      y: cy - bh / 2,
      w: bw,
      h: bh + XMJ_TILE_DEPTH,
      shown,
    };
  });
}

const claimPct = (at: number) => `${+((at / XMJ32_CLAIM_SECONDS) * 100).toFixed(3)}%`;

/** A track's keyframes: transform from its end pose, then opacity. */
function claimTrackCss(track: XmjClaimTrack): string {
  const css: string[] = [];
  const { w, h } = trackBox(track);
  const end = track.poses.at(-1) as XmjClaimPose;
  const anim = (name: string) => `${name} ${XMJ32_CLAIM_SECONDS}s ease-in-out both`;
  // A keyframe list holds its first value from 0% and its last to 100%.
  const frames = <T>(list: readonly (T & { at: number })[], value: (item: T) => string) =>
    list
      .map((item, i) => {
        const stops = [
          i === 0 && item.at > 0 ? '0%' : '',
          claimPct(item.at),
          i === list.length - 1 && item.at < XMJ32_CLAIM_SECONDS ? '100%' : '',
        ].filter(Boolean);
        return `${stops.join(',')}{${value(item)}}`;
      })
      .join('');
  if (track.poses.length > 1) {
    const ex = end.x + w / 2;
    const ey = end.y + h / 2;
    const value = (p: XmjClaimPose) => {
      const [pw, ph] = p.turned ? [h, w] : [w, h];
      const dx = +(p.x + pw / 2 - ex).toFixed(2);
      const dy = +(p.y + ph / 2 - ey).toFixed(2);
      return `transform:translate(${dx}px,${dy}px) rotate(${p.turned ? 90 : 0}deg)`;
    };
    css.push(
      `@keyframes xmj-claim-${track.id}{${frames(track.poses, value)}}`,
      `.xmj-claim-${track.id}{transform-origin:${ex}px ${ey}px;animation:${anim(`xmj-claim-${track.id}`)}}`,
    );
  }
  if (track.fades) {
    css.push(
      `@keyframes xmj-claim-${track.id}-fade{${frames(track.fades, (f) => `opacity:${f.shown ? 1 : 0}`)}}`,
      `.xmj-claim-${track.id}-fade{animation:${anim(`xmj-claim-${track.id}-fade`)}}`,
    );
  }
  return css.join('');
}

const claimLabel = (x: number, y: number, text: string) =>
  `<text x="${x}" y="${y}" font-size="11.5" font-weight="600" fill="currentColor" fill-opacity="0.7">${escapeText(text)}</text>`;

/**
 * The claim as one animated figure (an animated-svg block), built from
 * XMJ32_CLAIM_TRACKS. Every tile is drawn where it ends and keyframes (fill
 * mode both) start it where it begins, so the SVG's still state is the end
 * frame: their four tiles face down, the set apart on the left of your hand
 * with the Cannon lying sideways, the Elephant kept, the Soldier in your
 * discards.
 */
export const XMJ32_CLAIM_ANIMATION_SVG = (): string => {
  const P = activeXiangqiPieceSet;
  const S = XMJ32_CLAIM_SLOTS;
  const T = XMJ32_CLAIM_STEPS;
  const hand = S.rows.hand;
  const tracks = XMJ32_CLAIM_TRACKS.map((track) => {
    const end = track.poses.at(-1) as XmjClaimPose;
    let svg =
      track.tile === 'back'
        ? xmjTileBackSvg(end.x, end.y)
        : xmjTileSvg(track.tile, end.x, end.y, P, {
            sideways: track.sideways === true,
            name: track.name !== false,
          });
    if (track.poses.length > 1) svg = `<g class="xmj-claim-${track.id}">${svg}</g>`;
    if (track.fades) {
      // Its still state is its last fade, as the end frame shows it.
      const hidden = track.fades.at(-1)?.shown === false ? ' opacity="0"' : '';
      svg = `<g class="xmj-claim-${track.id}-fade"${hidden}>${svg}</g>`;
    }
    return svg;
  });
  const markFade: XmjClaimTrack = {
    id: 'mark',
    body: 'mark',
    tile: XMJ32_CLAIM_DISCARD,
    poses: [{ at: 0, x: 0, y: 0 }],
    fades: [
      { at: T.mark, shown: false },
      { at: T.marked, shown: true },
    ],
  };
  const style = [...XMJ32_CLAIM_TRACKS, markFade].map(claimTrackCss).join('');
  const nameY = hand + XMJ_TILE_H + XMJ_TILE_DEPTH + 15;
  const by = hand + XMJ_TILE_H + XMJ_TILE_DEPTH + 23;
  const set0 = S.set[0] ?? 0;
  const set2 = S.set[2] ?? 0;
  const width = S.parked + XMJ_TILE_W + 4;
  const parts = [
    `<style>${style}</style>`,
    claimLabel(CLAIM_X0, S.rows.theirHand - 7, 'Their hand'),
    claimLabel(CLAIM_X0, S.rows.theirs - 7, 'Their discards'),
    claimLabel(S.wall[0] ?? 0, S.rows.theirs - 7, 'Wall'),
    claimLabel(CLAIM_X0, S.rows.yours - 7, 'Your discards'),
    claimLabel(CLAIM_X0, hand - 7, 'Your hand'),
    `<g class="xmj-claim-mark-fade">`,
    `<text x="${set2 + CLAIM_SIDEWAYS.w / 2}" y="${nameY}" text-anchor="middle" font-size="10.5" fill="currentColor" data-i18n-key="${tileColor(XMJ32_CLAIM_DISCARD) === 'r' ? 'red' : 'black'} ${XMJ_PIECE_NAMES[tilePiece(XMJ32_CLAIM_DISCARD)]}">${escapeText(XMJ_PIECE_NAMES[tilePiece(XMJ32_CLAIM_DISCARD)])}</text>`,
    `<path d="M${set0 + 2} ${by - 4}V${by}H${S.setEnd - 2}V${by - 4}" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1"/>`,
    `<text x="${(set0 + S.setEnd) / 2}" y="${by + 14}" text-anchor="middle" font-size="11" font-style="italic" fill="currentColor" fill-opacity="0.75">claimed, face up</text></g>`,
    ...tracks,
  ];
  return xmjTileFigureSvg(
    width,
    by + 22,
    'A claim: the other player draws from the wall and discards the red Cannon, you take it into Chariot, Horse, Cannon, lay the set face up apart from your hand with the Cannon sideways, and discard the black Soldier',
    parts.join(''),
  );
};

/**
 * The claim's opening for readers who asked for less motion: their four tiles
 * face down, the Advisor they discarded earlier, and your four tiles.
 */
const XMJ32_CLAIM_BEFORE_SVG = (): string => {
  const P = activeXiangqiPieceSet;
  const col = XMJ32_CLAIM_SLOTS.col;
  const rows = { theirHand: 20, theirs: 103, hand: 206 } as const;
  const parts = [
    claimLabel(CLAIM_X0, rows.theirHand - 7, 'Their hand'),
    claimLabel(CLAIM_X0, rows.theirs - 7, 'Their discards'),
    claimLabel(CLAIM_X0, rows.hand - 7, 'Your hand'),
  ];
  for (let i = 0; i < XMJ32_CLAIM_THEIR_TILES; i += 1) {
    parts.push(xmjTileBackSvg(col[i] ?? 0, rows.theirHand));
  }
  parts.push(xmjTileSvg(XMJ32_CLAIM_EARLIER_DISCARD, col[0] ?? 0, rows.theirs, P));
  XMJ32_CLAIM_HAND.forEach((tile, i) => {
    parts.push(xmjTileSvg(tile, col[i] ?? 0, rows.hand, P));
  });
  const width = (col[3] ?? 0) + XMJ_TILE_W + CLAIM_X0;
  return xmjTileFigureSvg(
    width,
    rows.hand + XMJ_TILE_H + XMJ_TILE_DEPTH + 21,
    'Before: the other player’s four tiles face down, the black Advisor they discarded earlier, and your four tiles',
    parts.join(''),
  );
};

/** The claim for readers who asked for less motion: before, then after. */
export const XMJ32_CLAIM_STATIC_SVG = (): string =>
  XMJ32_CLAIM_BEFORE_SVG() +
  xmjTileRowSvg(
    CLAIM_AFTER_GROUPS,
    'After: the claimed set face up with the Cannon sideways, the Elephant kept, the Soldier discarded',
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
 * Cannon in red, and the two Generals as the pair. Win 1, Generals pair 2,
 * self-draw 2.
 */
export const XMJ32_WORKED: XmjWinExample = {
  id: 'worked',
  title: 'The dealer draws the black General to win',
  groups: [set('rR', 'rH', 'rC'), pair('rK', 'bK')],
  context: { ...SELF_DRAWN, winnerIsDealer: true },
  expectedLines: ['win', 'generals-pair', 'self-draw'],
  expectedTotal: 5,
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
    how: 'Ben’s discard, one General',
    win: {
      id: 'match-1',
      title: 'General, Advisor, Elephant with two black Horses',
      groups: [set('rK', 'rA', 'rE'), pair('bH', 'bH')],
      context: ON_DISCARD_AS_DEALER,
      expectedLines: ['win', 'red-general'],
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
    how: 'Ana’s discard, one colour',
    win: {
      id: 'match-4',
      title: 'Red Chariot, Horse, Cannon with two red Soldiers',
      groups: [set('rR', 'rH', 'rC'), pair('rP', 'rP')],
      context: ON_DISCARD_AS_DEALER,
      expectedLines: ['win', 'one-colour'],
      expectedTotal: 2,
    },
  },
  {
    dealer: 'Ana',
    winner: 'Ana',
    how: 'Self-draw on the last tile',
    win: {
      id: 'match-5',
      title: 'Three black Soldiers with two red Advisors',
      groups: [set('bP', 'bP', 'bP'), pair('rA', 'rA')],
      context: { ...SELF_DRAWN, winnerIsDealer: true, lastTile: true },
      expectedLines: ['win', 'self-draw', 'last-tile'],
      expectedTotal: 4,
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
