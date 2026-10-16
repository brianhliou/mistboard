/**
 * Xiangqi mahjong (象棋麻將), the 32-tile Taiwan form, for exactly two players.
 *
 * The rules are the "Spec for a 2-player implementation" in the life-os
 * research note `research/xiangqi-mahjong-rules-2026-10.md`; item numbers in
 * the comments below (spec 5, spec 11, ...) refer to it.
 *
 * Deliberately standalone. Hong Kong mahjong (`@mistboard/mahjong`) shares the
 * vocabulary (draw, discard, claim) and nothing else that matters: 34 tile
 * kinds against 14, four seats against two, 14-tile hands against 5, a faan
 * table against a 台 count. Nothing here imports it, so either can be deleted
 * without touching the other.
 *
 * Pure: every function returns a new value and nothing reads a clock or a
 * random source. The deal comes in as a wall, already shuffled by the caller.
 */

export type XmjColor = 'r' | 'b';
/** General, Advisor, Elephant, Chariot (Rook), Horse, Cannon, Soldier (Pawn). */
export type XmjPiece = 'K' | 'A' | 'E' | 'R' | 'H' | 'C' | 'P';
/** A tile kind: colour then piece, e.g. 'rK' is 帥, 'bP' is 卒. */
export type XmjTile = `${XmjColor}${XmjPiece}`;
export type XmjSeatIndex = 0 | 1;

export const XMJ_PIECES: readonly XmjPiece[] = ['K', 'A', 'E', 'R', 'H', 'C', 'P'];
export const XMJ_TILE_KINDS: readonly XmjTile[] = [
  'rK',
  'rA',
  'rE',
  'rR',
  'rH',
  'rC',
  'rP',
  'bK',
  'bA',
  'bE',
  'bR',
  'bH',
  'bC',
  'bP',
];

/** Copies of each kind in one xiangqi set (spec 1). */
export const XMJ_COPIES: Readonly<Record<XmjPiece, number>> = {
  K: 1,
  A: 2,
  E: 2,
  R: 2,
  H: 2,
  C: 2,
  P: 5,
};

/** Characters as printed on the pieces (spec 14). */
export const XMJ_GLYPHS: Readonly<Record<XmjTile, string>> = {
  rK: '帥',
  rA: '仕',
  rE: '相',
  rR: '俥',
  rH: '傌',
  rC: '炮',
  rP: '兵',
  bK: '將',
  bA: '士',
  bE: '象',
  bR: '車',
  bH: '馬',
  bC: '包',
  bP: '卒',
};

export const XMJ_PIECE_NAMES: Readonly<Record<XmjPiece, string>> = {
  K: 'General',
  A: 'Advisor',
  E: 'Elephant',
  R: 'Chariot',
  H: 'Horse',
  C: 'Cannon',
  P: 'Soldier',
};

/** The two sequences per colour (spec 7). Any order, one colour. */
const SEQUENCE_PIECES: readonly (readonly XmjPiece[])[] = [
  ['K', 'A', 'E'],
  ['R', 'H', 'C'],
];

export const XMJ_HAND_SIZE = 5;
export const XMJ_DEALER_TILES = 5;
export const XMJ_OTHER_TILES = 4;

export function isXmjTile(value: unknown): value is XmjTile {
  return typeof value === 'string' && (XMJ_TILE_KINDS as readonly string[]).includes(value);
}

export function tileColor(tile: XmjTile): XmjColor {
  return tile[0] as XmjColor;
}
export function tilePiece(tile: XmjTile): XmjPiece {
  return tile[1] as XmjPiece;
}

/** The full 32-tile set, unshuffled, in kind order. */
export function xmjOrderedTiles(): XmjTile[] {
  const tiles: XmjTile[] = [];
  for (const kind of XMJ_TILE_KINDS) {
    for (let i = 0; i < XMJ_COPIES[tilePiece(kind)]; i += 1) tiles.push(kind);
  }
  return tiles;
}

/** Fisher-Yates over a caller-supplied [0,1) source, so the caller owns randomness. */
export function xmjShuffle(random: () => number, tiles: readonly XmjTile[] = xmjOrderedTiles()) {
  const out = [...tiles];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as XmjTile;
    out[i] = out[j] as XmjTile;
    out[j] = a;
  }
  return out;
}

// ---------------------------------------------------------------- shapes

export type XmjMeldKind = 'sequence' | 'triplet';
export interface XmjMeld {
  readonly kind: XmjMeldKind;
  readonly tiles: readonly XmjTile[];
  /** The claimed discard, when the meld was made by a claim. */
  readonly claimed?: XmjTile;
}

/** Tiles in kind order (red before black, K A E R H C P). */
export function xmjSortTiles(tiles: readonly XmjTile[]): XmjTile[] {
  return [...tiles].sort((a, b) => XMJ_TILE_KINDS.indexOf(a) - XMJ_TILE_KINDS.indexOf(b));
}

/** Three tiles that form a legal meld, or null. Spec 7. */
export function meldKindOf(tiles: readonly XmjTile[]): XmjMeldKind | null {
  if (tiles.length !== 3) return null;
  const [a, b, c] = tiles as [XmjTile, XmjTile, XmjTile];
  if (a === b && b === c) return tilePiece(a) === 'P' ? 'triplet' : null;
  const color = tileColor(a);
  if (tileColor(b) !== color || tileColor(c) !== color) return null;
  const pieces = new Set(tiles.map(tilePiece));
  if (pieces.size !== 3) return null;
  for (const seq of SEQUENCE_PIECES) {
    if (seq.every((piece) => pieces.has(piece))) return 'sequence';
  }
  return null;
}

/** Two identical tiles, or 帥 with 將 (spec 7 [CHOICE]: allowed). */
export function isXmjPair(a: XmjTile, b: XmjTile): boolean {
  if (a === b) return true;
  return tilePiece(a) === 'K' && tilePiece(b) === 'K';
}

export interface XmjWinShape {
  readonly meld: readonly XmjTile[];
  readonly pair: readonly [XmjTile, XmjTile];
}

/**
 * How five tiles (concealed plus any exposed meld) make a winning hand, or null.
 *
 * With a meld already exposed the concealed two must be the pair; otherwise any
 * 3+2 split of the five. Five same-colour soldiers is always also 兵兵兵+兵兵,
 * so it needs no shape of its own here; scoring recognises it.
 */
export function xmjWinShape(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
): XmjWinShape | null {
  const total = concealed.length + melds.length * 3;
  if (total !== XMJ_HAND_SIZE) return null;
  if (melds.length === 1) {
    const [a, b] = concealed as [XmjTile, XmjTile];
    const meld = melds[0] as XmjMeld;
    return isXmjPair(a, b) ? { meld: meld.tiles, pair: [a, b] } : null;
  }
  if (melds.length !== 0) return null;
  for (let i = 0; i < 5; i += 1) {
    for (let j = i + 1; j < 5; j += 1) {
      const a = concealed[i] as XmjTile;
      const b = concealed[j] as XmjTile;
      if (!isXmjPair(a, b)) continue;
      const rest = concealed.filter((_, k) => k !== i && k !== j);
      if (meldKindOf(rest)) return { meld: rest, pair: [a, b] };
    }
  }
  return null;
}

// ---------------------------------------------------------------- claims

export type XmjClaimKind = 'win' | 'pung' | 'chow';
export interface XmjClaim {
  readonly kind: XmjClaimKind;
  /** The hand tiles that join the discard (empty for a win). */
  readonly fromHand: readonly XmjTile[];
}

function removeTiles(hand: readonly XmjTile[], tiles: readonly XmjTile[]): XmjTile[] | null {
  const out = [...hand];
  for (const tile of tiles) {
    const at = out.indexOf(tile);
    if (at < 0) return null;
    out.splice(at, 1);
  }
  return out;
}

/**
 * Every claim a seat may make on the opponent's discard (spec 5, 12).
 *
 * Win first; then 碰 on two matching soldiers; then each distinct 吃. With two
 * players the discarder is always the claimant's 上家, so 吃 is always open.
 */
export function xmjLegalClaims(
  concealed: readonly XmjTile[],
  melds: readonly XmjMeld[],
  discard: XmjTile,
): XmjClaim[] {
  const claims: XmjClaim[] = [];
  if (xmjWinShape([...concealed, discard], melds)) claims.push({ kind: 'win', fromHand: [] });
  // A meld claim needs two tiles from hand and must leave a legal hand size.
  if (melds.length > 0 || concealed.length < 4) return claims;
  if (tilePiece(discard) === 'P' && concealed.filter((t) => t === discard).length >= 2) {
    claims.push({ kind: 'pung', fromHand: [discard, discard] });
  }
  const color = tileColor(discard);
  const piece = tilePiece(discard);
  for (const seq of SEQUENCE_PIECES) {
    if (!seq.includes(piece)) continue;
    const need = seq.filter((p) => p !== piece).map((p) => `${color}${p}` as XmjTile);
    if (need.every((tile) => concealed.includes(tile))) {
      claims.push({ kind: 'chow', fromHand: need });
    }
  }
  return claims;
}

// ---------------------------------------------------------------- scoring

export type XmjTaiKey =
  | 'win'
  | 'self-draw'
  | 'dealer'
  | 'one-colour'
  | 'generals-pair'
  | 'five-soldiers'
  | 'last-tile'
  | 'heavenly'
  | 'earthly';

export interface XmjTaiLine {
  readonly key: XmjTaiKey;
  readonly label: string;
  readonly tai: number;
}

export interface XmjScore {
  readonly lines: readonly XmjTaiLine[];
  readonly total: number;
  /**
   * The set and pair this score was counted from. Where a hand splits more
   * than one way, this is the split the lines above were read off, so a table
   * that groups the winning hand shows the hand that was scored.
   */
  readonly shape: XmjWinShape;
}

export const XMJ_TAI_LABELS: Readonly<Record<XmjTaiKey, string>> = {
  win: '胡牌 Win',
  'self-draw': '自摸 Self-draw',
  dealer: '莊家 Dealer',
  'one-colour': '清一色 One colour',
  'generals-pair': '將帥聽令 Generals pair',
  'five-soldiers': '五兵合縱 / 五卒連橫 Five soldiers',
  'last-tile': '海底撈月 Last tile',
  heavenly: '天胡 Heavenly hand',
  earthly: '地胡 Earthly hand',
};

export interface XmjWinContext {
  readonly concealed: readonly XmjTile[];
  readonly melds: readonly XmjMeld[];
  readonly selfDrawn: boolean;
  readonly winnerIsDealer: boolean;
  /** The dealer's opening five, before any discard. */
  readonly heavenly: boolean;
  /** The non-dealer's first draw, with nothing claimed before it. */
  readonly earthly: boolean;
  /** Self-drawn off the last wall tile. */
  readonly lastTile: boolean;
}

function line(key: XmjTaiKey, tai: number): XmjTaiLine {
  return { key, label: XMJ_TAI_LABELS[key], tai };
}

/**
 * The 台 count for a winning hand (spec 11).
 *
 * 天胡 and 地胡 are flat 6 and replace everything else. Otherwise the lines
 * sum. Deliberate 2-player change from spec 11: no 連莊 doubling. The deal
 * alternates every hand (see `xmjNextDealer`), so the dealer never keeps it,
 * and a dealer win is the flat +1 莊家 line only. With the doubling, the
 * dealer's extra tile and first discard let one early win snowball.
 */
export function xmjScore(ctx: XmjWinContext): XmjScore {
  const shape = xmjWinShape(ctx.concealed, ctx.melds);
  if (!shape) throw new Error('xmjScore: not a winning hand');
  if (ctx.heavenly) return { lines: [line('heavenly', 6)], total: 6, shape };
  if (ctx.earthly) return { lines: [line('earthly', 6)], total: 6, shape };
  const all = [...ctx.concealed, ...ctx.melds.flatMap((m) => m.tiles)];
  const lines: XmjTaiLine[] = [line('win', 1)];
  if (ctx.selfDrawn) lines.push(line('self-draw', 2));
  if (ctx.winnerIsDealer) lines.push(line('dealer', 1));
  const colors = new Set(all.map(tileColor));
  if (colors.size === 1) lines.push(line('one-colour', 1));
  const [p, q] = shape.pair;
  if (p !== q) lines.push(line('generals-pair', 2));
  if (all.every((tile) => tile === all[0]) && tilePiece(all[0] as XmjTile) === 'P') {
    lines.push(line('five-soldiers', 5));
  }
  if (ctx.lastTile) lines.push(line('last-tile', 1));
  const total = lines.reduce((sum, l) => sum + l.tai, 0);
  return { lines, total, shape };
}

// ---------------------------------------------------------------- one hand

export type XmjPhase =
  /** The seat to move holds five and must discard (or declare 自摸). */
  | {
      readonly type: 'discard';
      /** May declare a self-drawn win now (just drew, or the dealer's opening five). */
      readonly mayWin: boolean;
      /** The tile just drawn, so the client can mark it. Null after a claim. */
      readonly drawn: XmjTile | null;
    }
  /** The opponent of the discarder may claim the discard or pass. */
  | { readonly type: 'claim'; readonly discard: XmjTile; readonly discarder: XmjSeatIndex }
  | {
      readonly type: 'won';
      readonly winner: XmjSeatIndex;
      readonly selfDrawn: boolean;
      readonly winningTile: XmjTile;
      readonly score: XmjScore;
    }
  | { readonly type: 'exhausted' };

export interface XmjHandState {
  readonly dealer: XmjSeatIndex;
  readonly wall: readonly XmjTile[];
  readonly hands: readonly [readonly XmjTile[], readonly XmjTile[]];
  readonly melds: readonly [readonly XmjMeld[], readonly XmjMeld[]];
  readonly discards: readonly [readonly XmjTile[], readonly XmjTile[]];
  /**
   * Beside each discard: whether it was the tile just drawn, thrown straight
   * back. At a real table everyone sees which slot a tile leaves, so this is
   * public; the tile's place in a concealed hand is not.
   */
  readonly drawnDiscards: readonly [readonly boolean[], readonly boolean[]];
  readonly turn: XmjSeatIndex;
  readonly phase: XmjPhase;
  /** Wall draws each seat has made this hand (地胡 is the non-dealer's first). */
  readonly draws: readonly [number, number];
  /** Any claim made this hand (a claim before it spoils 地胡). */
  readonly claimed: boolean;
}

export function xmjOtherSeat(seat: XmjSeatIndex): XmjSeatIndex {
  return seat === 0 ? 1 : 0;
}

/** Deal from the front of the wall: dealer five, the other four (spec 3). */
export function xmjDeal(wall: readonly XmjTile[], dealer: XmjSeatIndex): XmjHandState {
  if (wall.length !== 32) throw new Error(`xmjDeal: wall has ${wall.length} tiles, expected 32`);
  const dealerHand = xmjSortTiles(wall.slice(0, XMJ_DEALER_TILES));
  const otherHand = xmjSortTiles(wall.slice(XMJ_DEALER_TILES, XMJ_DEALER_TILES + XMJ_OTHER_TILES));
  const hands: [XmjTile[], XmjTile[]] =
    dealer === 0 ? [dealerHand, otherHand] : [otherHand, dealerHand];
  return {
    dealer,
    wall: wall.slice(XMJ_DEALER_TILES + XMJ_OTHER_TILES),
    hands,
    melds: [[], []],
    discards: [[], []],
    drawnDiscards: [[], []],
    turn: dealer,
    // Dealer discards first, without drawing; 天胡 is declared from here.
    phase: { type: 'discard', mayWin: true, drawn: null },
    draws: [0, 0],
    claimed: false,
  };
}

function setSeat<T>(pair: readonly [T, T], seat: XmjSeatIndex, value: T): [T, T] {
  return seat === 0 ? [value, pair[1]] : [pair[0], value];
}

/** Draw for `seat` off the wall, or end the hand as 流局 when it is empty (spec 10). */
function drawFor(state: XmjHandState, seat: XmjSeatIndex): XmjHandState {
  const [tile, ...wall] = state.wall;
  if (tile === undefined) return { ...state, turn: seat, phase: { type: 'exhausted' } };
  return {
    ...state,
    wall,
    turn: seat,
    hands: setSeat(state.hands, seat, xmjSortTiles([...(state.hands[seat] ?? []), tile])),
    draws: setSeat(state.draws, seat, (state.draws[seat] ?? 0) + 1),
    phase: { type: 'discard', mayWin: true, drawn: tile },
  };
}

export function xmjCanDiscard(state: XmjHandState, tile: XmjTile): boolean {
  return state.phase.type === 'discard' && state.hands[state.turn].includes(tile);
}

/**
 * Discard a tile. Always opens the claim window, whether or not the opponent
 * holds a claim: a window that opened only when a claim existed would tell the
 * discarder the opponent's hand fits the tile. The room settles a window with
 * no claim in it as a pass (see `xmjPendingAction`).
 *
 * A discard of the drawn tile's face counts as the drawn tile itself unless
 * `handCopy` says the player threw an identical tile from the hand instead.
 * Either way the hand left behind is the same; only the table sees which slot
 * the tile left.
 */
export function xmjDiscard(state: XmjHandState, tile: XmjTile, handCopy = false): XmjHandState {
  if (!xmjCanDiscard(state, tile)) return state;
  const seat = state.turn;
  const hand = removeTiles(state.hands[seat], [tile]) as XmjTile[];
  // A hand copy needs a second tile of that face in the hand; otherwise the
  // flag is ignored, so a client cannot misreport where a tile came from.
  const copies = state.hands[seat].filter((t) => t === tile).length;
  const fromDraw =
    state.phase.type === 'discard' && state.phase.drawn === tile && !(handCopy && copies > 1);
  const next: XmjHandState = {
    ...state,
    hands: setSeat(state.hands, seat, hand),
    discards: setSeat(state.discards, seat, [...state.discards[seat], tile]),
    drawnDiscards: setSeat(state.drawnDiscards, seat, [...state.drawnDiscards[seat], fromDraw]),
    phase: { type: 'claim', discard: tile, discarder: seat },
  };
  return next;
}

/** Claims open to the non-discarder in the current window (empty outside one). */
export function xmjClaimsOpen(state: XmjHandState): XmjClaim[] {
  if (state.phase.type !== 'claim') return [];
  const claimant = xmjOtherSeat(state.phase.discarder);
  return xmjLegalClaims(state.hands[claimant], state.melds[claimant], state.phase.discard);
}

/** Decline the discard: the claimant draws (or the hand is a 流局). */
export function xmjPass(state: XmjHandState): XmjHandState {
  if (state.phase.type !== 'claim') return state;
  return drawFor(state, xmjOtherSeat(state.phase.discarder));
}

function sameTiles(a: readonly XmjTile[], b: readonly XmjTile[]): boolean {
  return xmjSortTiles(a).join() === xmjSortTiles(b).join();
}

/** Make a claim. Returns the state unchanged if the claim is not legal. */
export function xmjClaim(state: XmjHandState, claim: XmjClaim): XmjHandState {
  if (state.phase.type !== 'claim') return state;
  const legal = xmjClaimsOpen(state).find(
    (c) => c.kind === claim.kind && sameTiles(c.fromHand, claim.fromHand),
  );
  if (!legal) return state;
  const { discard, discarder } = state.phase;
  const seat = xmjOtherSeat(discarder);
  // The claimed tile leaves the discarder's pile: it lives in the meld now.
  const pile = state.discards[discarder].slice(0, -1);
  const discards = setSeat(state.discards, discarder, pile);
  const drawnDiscards = setSeat(
    state.drawnDiscards,
    discarder,
    state.drawnDiscards[discarder].slice(0, -1),
  );
  if (legal.kind === 'win') {
    const concealed = xmjSortTiles([...state.hands[seat], discard]);
    const score = xmjScore({
      concealed,
      melds: state.melds[seat],
      selfDrawn: false,
      winnerIsDealer: seat === state.dealer,
      heavenly: false,
      earthly: false,
      lastTile: false,
    });
    return {
      ...state,
      discards,
      drawnDiscards,
      hands: setSeat(state.hands, seat, concealed),
      turn: seat,
      phase: { type: 'won', winner: seat, selfDrawn: false, winningTile: discard, score },
    };
  }
  const hand = removeTiles(state.hands[seat], legal.fromHand) as XmjTile[];
  const meld: XmjMeld = {
    kind: legal.kind === 'pung' ? 'triplet' : 'sequence',
    tiles: xmjSortTiles([...legal.fromHand, discard]),
    claimed: discard,
  };
  return {
    ...state,
    discards,
    drawnDiscards,
    hands: setSeat(state.hands, seat, hand),
    melds: setSeat(state.melds, seat, [...state.melds[seat], meld]),
    turn: seat,
    claimed: true,
    // No draw after a claim, and no self-drawn win either: discard now.
    phase: { type: 'discard', mayWin: false, drawn: null },
  };
}

/** Whether the seat to move may declare 自摸 now. */
export function xmjCanSelfDraw(state: XmjHandState): boolean {
  if (state.phase.type !== 'discard' || !state.phase.mayWin) return false;
  return xmjWinShape(state.hands[state.turn], state.melds[state.turn]) !== null;
}

/** Declare a self-drawn win (自摸, 天胡, 地胡, 海底撈月). */
export function xmjSelfDraw(state: XmjHandState): XmjHandState {
  if (!xmjCanSelfDraw(state) || state.phase.type !== 'discard') return state;
  const seat = state.turn;
  const isDealer = seat === state.dealer;
  const noDiscardYet = state.discards[0].length === 0 && state.discards[1].length === 0;
  const heavenly = isDealer && state.draws[seat] === 0 && noDiscardYet;
  const earthly = !isDealer && state.draws[seat] === 1 && !state.claimed;
  const score = xmjScore({
    concealed: state.hands[seat],
    melds: state.melds[seat],
    selfDrawn: true,
    winnerIsDealer: isDealer,
    heavenly,
    earthly,
    lastTile: state.wall.length === 0 && state.phase.drawn !== null,
  });
  const winningTile = state.phase.drawn ?? (state.hands[seat][0] as XmjTile);
  return {
    ...state,
    phase: { type: 'won', winner: seat, selfDrawn: true, winningTile, score },
  };
}

export function xmjHandOver(state: XmjHandState): boolean {
  return state.phase.type === 'won' || state.phase.type === 'exhausted';
}

// ---------------------------------------------------------------- the match

/**
 * Hands in a match, 流局 included. Deliberate 2-player change from spec 3,
 * which suggested eight: four, so each seat deals twice. The one constant
 * every match-length check reads, so eight can return as an option.
 */
export const XMJ_MATCH_HANDS = 4;

export interface XmjHandResult {
  readonly dealer: XmjSeatIndex;
  readonly winner: XmjSeatIndex | null;
  readonly selfDrawn: boolean;
  readonly score: XmjScore | null;
}

export interface XmjMatchState {
  /** One shuffled wall per hand, fixed at room creation. Server-secret. */
  readonly walls: readonly (readonly XmjTile[])[];
  readonly handIndex: number;
  readonly scores: readonly [number, number];
  readonly hand: XmjHandState;
  readonly results: readonly XmjHandResult[];
  /** True between hands: the last hand is over and the next is not dealt. */
  readonly between: boolean;
  readonly over: boolean;
}

export function xmjNewMatch(
  walls: readonly (readonly XmjTile[])[],
  firstDealer: XmjSeatIndex,
): XmjMatchState {
  if (walls.length < 1) throw new Error('xmjNewMatch: no walls');
  return {
    walls,
    handIndex: 0,
    scores: [0, 0],
    hand: xmjDeal(walls[0] as XmjTile[], firstDealer),
    results: [],
    between: false,
    over: false,
  };
}

/**
 * Apply a hand-level transition and, if it ended the hand, book the result:
 * the winner takes the 台 total from the opponent (base 0, 1 point per 台).
 */
export function xmjAdvance(match: XmjMatchState, hand: XmjHandState): XmjMatchState {
  if (hand === match.hand) return match;
  if (!xmjHandOver(hand)) return { ...match, hand };
  const phase = hand.phase;
  let scores = match.scores;
  let result: XmjHandResult = { dealer: hand.dealer, winner: null, selfDrawn: false, score: null };
  if (phase.type === 'won') {
    const points = phase.score.total;
    scores = setSeat(scores, phase.winner, scores[phase.winner] + points);
    scores = setSeat(
      scores,
      xmjOtherSeat(phase.winner),
      scores[xmjOtherSeat(phase.winner)] - points,
    );
    result = {
      dealer: hand.dealer,
      winner: phase.winner,
      selfDrawn: phase.selfDrawn,
      score: phase.score,
    };
  }
  const results = [...match.results, result];
  const over = results.length >= Math.min(XMJ_MATCH_HANDS, match.walls.length);
  return { ...match, hand, scores, results, between: !over, over };
}

/**
 * Dealer for the next hand: the deal alternates every hand, whoever won and
 * after a 流局, so each seat deals the same number of times. Deliberate
 * 2-player change from spec 3 and 10, where the dealer kept the deal on a win
 * or a 流局: the dealer's fifth tile and first discard made a kept deal snowball.
 */
export function xmjNextDealer(result: XmjHandResult): XmjSeatIndex {
  return xmjOtherSeat(result.dealer);
}

/** Deal the next hand. Only between hands. */
export function xmjNextHand(match: XmjMatchState): XmjMatchState {
  if (!match.between || match.over) return match;
  const last = match.results[match.results.length - 1] as XmjHandResult;
  const handIndex = match.handIndex + 1;
  return {
    ...match,
    handIndex,
    hand: xmjDeal(match.walls[handIndex] as XmjTile[], xmjNextDealer(last)),
    between: false,
  };
}

/** Match winner by points; null on a tie or while the match runs. */
export function xmjMatchWinner(match: XmjMatchState): XmjSeatIndex | null {
  if (!match.over) return null;
  const [a, b] = match.scores;
  if (a === b) return null;
  return a > b ? 0 : 1;
}
