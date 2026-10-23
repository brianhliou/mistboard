// Dark Jungle / Flip Animal Chess (兽棋 翻翻棋) — the flip derivative of Dou Shou Qi,
// on a 4×4 board with hidden piece IDENTITIES (symmetric information), modeled on
// variants-banqi.ts and reusing the shared animal-rank kernel from variants-jungle.ts.
//
// The short version this kernel implements (the 1990s-Dalian folk rules):
//   - Board: 4 files a–d (0–3) × 4 ranks 1–4 = 16 squares. Square index =
//     file + (rank-1)*4 (a1=0 … d4=15).
//   - All 16 pieces (one of each of the 8 animals per colour) start FACE-DOWN. The
//     "deal" is the only hidden state, hidden from BOTH players equally.
//   - A turn is exactly one of: FLIP a face-down piece (move with from === to),
//     revealing it; or MOVE/CAPTURE with one of your revealed pieces. Every piece
//     moves one orthogonal step (no rivers/dens/traps/jumps — the bare grid).
//   - First flip binds colour: when the FIRST mover (the 'red' SEAT) flips a tile,
//     that tile's ink becomes the red seat's colour (so the opener reveals their OWN
//     piece). The 'black' seat gets the other ink. Same as banqi.
//   - Capture (the one rule that differs from banqi): higher rank captures lower
//     (attacker takes the square), with the RAT↔ELEPHANT wrap (rat takes elephant;
//     elephant can NEVER take rat). EQUAL rank = 同归于尽 (MUTUAL DESTRUCTION): both
//     pieces are removed and the attacker does NOT advance. No cannon.
//   - Win = eliminate the opponent (subsumed by the side-to-move having no legal
//     action). Draws: the 40-ply no-progress clock (resets on capture/trade OR flip)
//     and threefold position repetition.
//
// TWO AXES (mirrors banqi): JungleFlipColor = a piece's INK; JungleFlipSeat = a
// player seat ('red' = first mover, acts on even ply). The red SEAT may end up owning
// the black INK. Route by seat; resolve seat→ink via jungleFlipInkForSeat.
//
// SYMMETRIC INFORMATION: both players + spectators see the IDENTICAL masked board (a
// face-down tile carries no colour/identity to anyone). getJungleFlipPlayerView is a
// passthrough mask; the only redaction boundary is the engine request (strip the deal).

import type { AbortReason } from './types.js';
import {
  JUNGLE_RANK,
  JUNGLE_ROLE_LETTER,
  type JunglePieceRole,
  jungleRankBeats,
} from './variants-jungle.js';

export type JungleFlipColor = 'red' | 'black';

// A player seat; 'red' = the first mover (acts on even ply) and binds its ink on the
// opening flip. Shares values with JungleFlipColor but is the seat axis, not ink.
export type JungleFlipSeat = 'red' | 'black';
export const JUNGLE_FLIP_SEATS: readonly [JungleFlipSeat, JungleFlipSeat] = ['red', 'black'];

// Reuses the 8 Dou Shou Qi animals (rat … elephant) from the shared kernel.
export type JungleFlipPieceRole = JunglePieceRole;

export type JungleFlipFile = 'a' | 'b' | 'c' | 'd';
export type JungleFlipRank = '1' | '2' | '3' | '4';
export type JungleFlipSquare = `${JungleFlipFile}${JungleFlipRank}`;

// `role` is always the TRUE identity, even while face-down; `color` is the ink.
export type JungleFlipPiece = {
  color: JungleFlipColor;
  role: JungleFlipPieceRole;
  faceDown: boolean;
};

export type JungleFlipBoard = Partial<Record<JungleFlipSquare, JungleFlipPiece>>;

// A turn action. A board move/capture is { from, to } with from !== to; a FLIP is the
// self-move { from: X, to: X }.
export type JungleFlipMove = {
  from: JungleFlipSquare;
  to: JungleFlipSquare;
};

export type JungleFlipDealPiece = { color: JungleFlipColor; role: JungleFlipPieceRole };
export type JungleFlipDeal = JungleFlipDealPiece[];

export type JungleFlipGameEndReason =
  | 'stalemate' // the side to move has no legal action (subsumes elimination)
  | 'no-progress' // 40 plies with no capture/trade and no flip
  | 'repetition' // threefold position repetition
  | 'dead-position' // remaining material cannot force a win (insufficient material)
  | 'timeout'
  | 'resignation'
  | 'abandonment'
  // Both players agreed a draw (an accepted draw offer).
  | 'agreement';

export type JungleFlipGameStatus =
  | { type: 'playing'; turn: JungleFlipSeat }
  | { type: 'finished'; winner: JungleFlipSeat | null; reason: JungleFlipGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

// Captures only ever remove REVEALED pieces, so the ink is always public.
export type JungleFlipCapture = {
  owner: JungleFlipColor;
  role: JungleFlipPieceRole;
};

export type JungleFlipGameState = {
  id: string;
  board: JungleFlipBoard;
  status: JungleFlipGameStatus;
  ply: number;
  firstColor: JungleFlipColor | null;
  moveNumber: number;
  noProgressClock: number;
  repCounts: Record<string, number>;
  captures: JungleFlipCapture[];
  lastMove?: JungleFlipMove;
};

// ── Player view (symmetric mask) ──────────────────────────────────────────────

export type JungleFlipVisibleBoardEntry =
  | { color: JungleFlipColor; role: JungleFlipPieceRole; faceDown: false }
  | { faceDown: true };

export type JungleFlipPlayerBoard = Partial<Record<JungleFlipSquare, JungleFlipVisibleBoardEntry>>;

export type JungleFlipPlayerView = {
  id: string;
  perspective: JungleFlipSeat;
  board: JungleFlipPlayerBoard;
  legalMoves: JungleFlipMove[];
  captured: JungleFlipCapture[];
  status: JungleFlipGameStatus;
  ply: number;
  firstColor: JungleFlipColor | null;
  moveNumber: number;
  lastMove?: JungleFlipMove;
};

// ── Geometry (4×4) ────────────────────────────────────────────────────────────

export const JUNGLE_FLIP_WIDTH = 4;
export const JUNGLE_FLIP_HEIGHT = 4;
const FILE_CHARS = 'abcd';

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function jungleFlipInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < JUNGLE_FLIP_WIDTH && rank >= 1 && rank <= JUNGLE_FLIP_HEIGHT;
}

export function jungleFlipSquareOf(file: number, rank: number): JungleFlipSquare {
  return `${FILE_CHARS[file]}${rank}` as JungleFlipSquare;
}

export function jungleFlipCoordOf(square: JungleFlipSquare): { file: number; rank: number } {
  return { file: FILE_CHARS.indexOf(square[0]), rank: Number(square[1]) };
}

export function jungleFlipSquareFromIndex(index: number): JungleFlipSquare {
  return jungleFlipSquareOf(index % JUNGLE_FLIP_WIDTH, Math.floor(index / JUNGLE_FLIP_WIDTH) + 1);
}

/** All 16 squares in canonical index order (a1=0 … d4=15). */
export const ALL_JUNGLE_FLIP_SQUARES: JungleFlipSquare[] = Array.from(
  { length: JUNGLE_FLIP_WIDTH * JUNGLE_FLIP_HEIGHT },
  (_, i) => jungleFlipSquareFromIndex(i),
);

// ── Capture resolution (the 同归于尽 rule) ────────────────────────────────────

export type JungleFlipCaptureOutcome = 'capture' | 'trade' | 'blocked';

/**
 * Resolve an adjacency interaction for the attacker against an enemy target:
 *  - 'capture' = attacker outranks the target (or the rat↔elephant wrap) → attacker
 *    takes the square, target removed.
 *  - 'trade' = EQUAL rank → 同归于尽: BOTH removed, attacker does NOT advance.
 *  - 'blocked' = attacker is weaker (incl. elephant vs rat) → not a legal move.
 */
export function jungleFlipResolveCapture(
  attacker: JungleFlipPieceRole,
  target: JungleFlipPieceRole,
): JungleFlipCaptureOutcome {
  if (attacker === 'rat' && target === 'elephant') return 'capture';
  if (attacker === 'elephant' && target === 'rat') return 'blocked';
  if (JUNGLE_RANK[attacker] > JUNGLE_RANK[target]) return 'capture';
  if (JUNGLE_RANK[attacker] === JUNGLE_RANK[target]) return 'trade';
  return 'blocked';
}

// ── Deal ──────────────────────────────────────────────────────────────────────

const ALL_ROLES: readonly JungleFlipPieceRole[] = [
  'rat',
  'cat',
  'dog',
  'wolf',
  'leopard',
  'tiger',
  'lion',
  'elephant',
];

function fullPieceList(): JungleFlipDealPiece[] {
  const out: JungleFlipDealPiece[] = [];
  for (const color of ['red', 'black'] as JungleFlipColor[]) {
    for (const role of ALL_ROLES) out.push({ color, role });
  }
  return out;
}

function multisetKey(pieces: JungleFlipDealPiece[]): string {
  return pieces
    .map((p) => `${p.color}-${p.role}`)
    .sort()
    .join(',');
}

const STANDARD_MULTISET = multisetKey(fullPieceList());

/** A deterministic, UNSHUFFLED deal (valid multiset). Live games mint a crypto-shuffled
 * deal; this is the throwaway default for the runtime seed projection + tests. */
export const STANDARD_JUNGLE_FLIP_DEAL: JungleFlipDeal = fullPieceList();

export function assertValidJungleFlipDeal(deal: JungleFlipDeal): void {
  if (deal.length !== JUNGLE_FLIP_WIDTH * JUNGLE_FLIP_HEIGHT) {
    throw new Error(
      `invalid jungle-flip deal: expected ${JUNGLE_FLIP_WIDTH * JUNGLE_FLIP_HEIGHT} pieces, got ${deal.length}`,
    );
  }
  if (multisetKey(deal) !== STANDARD_MULTISET) {
    throw new Error('invalid jungle-flip deal: not a permutation of the standard 16-piece set');
  }
}

/** Build a valid random deal by shuffling the full 16-piece multiset (server supplies a
 * crypto-backed rng; tests a seeded one). Indexed by square index (entry i → square i). */
export function createJungleFlipDeal(rng: () => number): JungleFlipDeal {
  const pieces = fullPieceList();
  for (let i = pieces.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces;
}

export function oppositeJungleFlipColor(color: JungleFlipColor): JungleFlipColor {
  return color === 'red' ? 'black' : 'red';
}

export function oppositeJungleFlipSeat(seat: JungleFlipSeat): JungleFlipSeat {
  return seat === 'red' ? 'black' : 'red';
}

export function createInitialJungleFlipState(
  gameId: string,
  deal: JungleFlipDeal = STANDARD_JUNGLE_FLIP_DEAL,
): JungleFlipGameState {
  assertValidJungleFlipDeal(deal);
  const board: JungleFlipBoard = {};
  deal.forEach((p, i) => {
    board[jungleFlipSquareFromIndex(i)] = { color: p.color, role: p.role, faceDown: true };
  });
  return {
    id: gameId,
    board,
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    firstColor: null,
    moveNumber: 1,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
  };
}

// ── Seats, turn, ink binding ──────────────────────────────────────────────────

export function jungleFlipSeatToMove(state: JungleFlipGameState): JungleFlipSeat {
  return state.ply % 2 === 0 ? 'red' : 'black';
}

/**
 * Takes the binding field structurally so a JungleFlipPlayerView (which carries
 * it) can ask too -- renderers need seat -> ink and must never re-derive it,
 * because a seat is NOT the ink it plays.
 */
export function jungleFlipInkForSeat(
  state: Pick<JungleFlipGameState, 'firstColor'>,
  seat: JungleFlipSeat,
): JungleFlipColor | null {
  if (state.firstColor === null) return null;
  return seat === 'red' ? state.firstColor : oppositeJungleFlipColor(state.firstColor);
}

export function jungleFlipMoverInk(state: JungleFlipGameState): JungleFlipColor | null {
  return jungleFlipInkForSeat(state, jungleFlipSeatToMove(state));
}

/**
 * The ink of the side that made the LAST action, or null before anything has
 * been played. Derived from ply parity (the red SEAT acts on even ply, so the
 * action at ply - 1 was its when ply is odd).
 *
 * Never read this off the board. A flip turns up a RANDOM tile, so the revealed
 * piece's colour is independent of who flipped it -- the same trap as banqi's
 * banqiLastMoverInk, and the reason a raw seat must never reach a colour call.
 */
export function jungleFlipLastMoverInk(
  state: Pick<JungleFlipGameState, 'ply' | 'firstColor'>,
): JungleFlipColor | null {
  if (state.ply <= 0) return null;
  return jungleFlipInkForSeat(state, state.ply % 2 === 1 ? 'red' : 'black');
}

// ── Move generation ───────────────────────────────────────────────────────────

/** Board destinations (move + capture/trade, NOT flips) for the revealed piece on `from`. */
function pseudoBoardDests(board: JungleFlipBoard, from: JungleFlipSquare): JungleFlipSquare[] {
  const piece = board[from];
  if (!piece || piece.faceDown) return [];
  const { file, rank } = jungleFlipCoordOf(from);
  const dests: JungleFlipSquare[] = [];
  for (const [df, dr] of ORTHO) {
    const f = file + df;
    const r = rank + dr;
    if (!jungleFlipInBounds(f, r)) continue;
    const to = jungleFlipSquareOf(f, r);
    const target = board[to];
    if (!target) {
      dests.push(to); // step to empty
    } else if (
      !target.faceDown &&
      target.color !== piece.color &&
      jungleFlipResolveCapture(piece.role, target.role) !== 'blocked'
    ) {
      dests.push(to); // capture or 同归于尽 trade
    }
    // friendly, face-down, or uncapturable enemy → blocked
  }
  return dests;
}

function enumerateJungleFlipMoves(state: JungleFlipGameState): JungleFlipMove[] {
  const moves: JungleFlipMove[] = [];
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    if (state.board[square]?.faceDown) moves.push({ from: square, to: square });
  }
  const moverInk = jungleFlipMoverInk(state);
  if (moverInk !== null) {
    for (const square of ALL_JUNGLE_FLIP_SQUARES) {
      const piece = state.board[square];
      if (piece && !piece.faceDown && piece.color === moverInk) {
        for (const to of pseudoBoardDests(state.board, square)) moves.push({ from: square, to });
      }
    }
  }
  return moves;
}

export function getJungleFlipLegalMoves(state: JungleFlipGameState): JungleFlipMove[] {
  if (state.status.type !== 'playing') return [];
  return enumerateJungleFlipMoves(state);
}

export function getJungleFlipLegalMovesFrom(
  state: JungleFlipGameState,
  from: JungleFlipSquare,
): JungleFlipMove[] {
  return getJungleFlipLegalMoves(state).filter((move) => move.from === from);
}

export function isJungleFlipLegalMove(state: JungleFlipGameState, move: JungleFlipMove): boolean {
  return getJungleFlipLegalMovesFrom(state, move.from).some((m) => m.to === move.to);
}

// ── Repetition key ────────────────────────────────────────────────────────────

function jungleFlipPositionKey(state: JungleFlipGameState): string {
  const sqkey = ALL_JUNGLE_FLIP_SQUARES.map((square) => {
    const piece = state.board[square];
    if (!piece) return '.';
    if (piece.faceDown) return 'x';
    const letter = JUNGLE_ROLE_LETTER[piece.role];
    return piece.color === 'red' ? letter : letter.toLowerCase();
  }).join('');
  return `${sqkey}|${state.ply % 2}|${state.firstColor ?? '?'}`;
}

// ── Apply move + terminal detection ───────────────────────────────────────────

export type JungleFlipApplyMoveOptions = {
  noProgressClockLimit?: number;
  repetitionDrawCount?: number;
  // Draw a fully-revealed two-piece position the moment it can no longer be won
  // ("dead position" — see jungleFlipIsDeadPosition). Default on; the golden-vector
  // emitter disables it so its terminals stay comparable to the engine's.
  adjudicateDeadPosition?: boolean;
};

export const DEFAULT_JUNGLE_FLIP_NO_PROGRESS_PLY_LIMIT = 40;
export const DEFAULT_JUNGLE_FLIP_REPETITION_DRAW_COUNT = 3;

function jungleFlipIsEliminated(state: JungleFlipGameState, seat: JungleFlipSeat): boolean {
  const ink = jungleFlipInkForSeat(state, seat);
  if (ink === null) return false; // colours not bound yet
  return !ALL_JUNGLE_FLIP_SQUARES.some((sq) => state.board[sq]?.color === ink);
}

// Checkerboard colour of a square (0/1). Adjacent squares always differ; two pieces a
// diagonal apart always match.
function jungleFlipSquareColor(square: JungleFlipSquare): 0 | 1 {
  const { file, rank } = jungleFlipCoordOf(square);
  return ((file + rank) % 2) as 0 | 1;
}

/**
 * A "dead position": a fully-revealed endgame of exactly two pieces (one per ink) that
 * can no longer be won by either side, so play could only ever shuffle to a repetition.
 * Returns true only for provably-drawn positions — a winnable one returns false and the
 * game continues.
 *
 * With one piece each the outcome is fixed by rank + geometry:
 *  - equal rank → draw (the pieces can only trade — 同归于尽 — never capture-and-survive);
 *  - otherwise the piece that out-ranks the other (or the rat, which beats the elephant)
 *    is the "pursuer". On the 4×4 the pursuer can force the capture ONLY when the two
 *    pieces sit on opposite square-colours on its own turn — then it can herd the evader
 *    into a wall and corner it. Every other case is a dead draw: the evader keeps the
 *    colour-parity and can never be caught (neither side can change it, since both must
 *    move every turn).
 *
 * This closed form is checked exhaustively against a brute-force retrograde solve of the
 * two-piece subgame in variants-jungle-flip-dead-position.test.ts, so it cannot silently
 * misclassify a position.
 */
export function jungleFlipIsDeadPosition(state: JungleFlipGameState): boolean {
  const pieces: { square: JungleFlipSquare; piece: JungleFlipPiece }[] = [];
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    const piece = state.board[square];
    if (piece) pieces.push({ square, piece });
  }
  if (pieces.length !== 2) return false;
  const [a, b] = pieces;
  if (a.piece.faceDown || b.piece.faceDown) return false; // identities not yet public
  if (a.piece.color === b.piece.color) return false; // one ink only → elimination, handled above

  const aBeatsB = jungleRankBeats(a.piece.role, b.piece.role);
  const bBeatsA = jungleRankBeats(b.piece.role, a.piece.role);
  if (aBeatsB && bBeatsA) return true; // equal rank (beats both ways) → trade-only → draw

  const pursuer = aBeatsB ? a : b;
  const evader = aBeatsB ? b : a;
  const moverInk = jungleFlipMoverInk(state);
  if (moverInk === null) return false; // colours not bound (can't happen with 2 revealed pieces)

  const sameColour = jungleFlipSquareColor(pursuer.square) === jungleFlipSquareColor(evader.square);
  const pursuerToMove = moverInk === pursuer.piece.color;
  // Pursuer wins iff opposite-colour on its turn; every other case is a dead draw.
  return pursuerToMove === sameColour;
}

function computeJungleFlipStatus(
  state: JungleFlipGameState,
  limit: number,
  repLimit: number,
  adjudicateDeadPosition: boolean,
): JungleFlipGameStatus {
  if (state.noProgressClock >= limit)
    return { type: 'finished', winner: null, reason: 'no-progress' };
  if ((state.repCounts[jungleFlipPositionKey(state)] ?? 0) >= repLimit)
    return { type: 'finished', winner: null, reason: 'repetition' };

  // Provable elimination (banqi adjudication): a side with no piece on the board and
  // no tile of its colour left to flip can never act again. Unlike banqi, a 同归于尽
  // trade can wipe out BOTH sides' last pieces in one move, so check both first — a
  // mutual knockout is a DRAW, not a win for whoever struck.
  const seatToMove = jungleFlipSeatToMove(state);
  const moverGone = jungleFlipIsEliminated(state, seatToMove);
  const oppGone = jungleFlipIsEliminated(state, oppositeJungleFlipSeat(seatToMove));
  if (moverGone && oppGone) return { type: 'finished', winner: null, reason: 'stalemate' };
  if (moverGone)
    return { type: 'finished', winner: oppositeJungleFlipSeat(seatToMove), reason: 'stalemate' };
  if (oppGone) return { type: 'finished', winner: seatToMove, reason: 'stalemate' };
  // Has pieces but no legal action (everything blocked) → the side to move loses.
  if (enumerateJungleFlipMoves(state).length === 0) {
    return { type: 'finished', winner: oppositeJungleFlipSeat(seatToMove), reason: 'stalemate' };
  }
  // Dead position: both sides still have a piece and a legal move, but the remaining
  // material can never force a win. End it now instead of shuffling to a repetition.
  if (adjudicateDeadPosition && jungleFlipIsDeadPosition(state))
    return { type: 'finished', winner: null, reason: 'dead-position' };
  return { type: 'playing', turn: seatToMove };
}

export function applyJungleFlipMove(
  state: JungleFlipGameState,
  move: JungleFlipMove,
  opts: JungleFlipApplyMoveOptions = {},
): JungleFlipGameState {
  if (state.status.type !== 'playing') return state;
  if (!isJungleFlipLegalMove(state, move)) return state;

  const limit = opts.noProgressClockLimit ?? DEFAULT_JUNGLE_FLIP_NO_PROGRESS_PLY_LIMIT;
  const repLimit = opts.repetitionDrawCount ?? DEFAULT_JUNGLE_FLIP_REPETITION_DRAW_COUNT;
  const adjudicateDeadPosition = opts.adjudicateDeadPosition ?? true;

  const board: JungleFlipBoard = { ...state.board };
  let firstColor = state.firstColor;
  let noProgressClock: number;
  let irreversible: boolean;
  let captures = state.captures;

  if (move.from === move.to) {
    // FLIP.
    const piece = board[move.from];
    if (!piece) return state;
    board[move.from] = { ...piece, faceDown: false };
    if (firstColor === null && state.ply === 0) firstColor = piece.color;
    noProgressClock = 0;
    irreversible = true;
  } else {
    const moved = board[move.from]!;
    const target = board[move.to]!; // legality guaranteed a revealed enemy when occupied... or empty
    if (target) {
      const outcome = jungleFlipResolveCapture(moved.role, target.role);
      if (outcome === 'trade') {
        // 同归于尽: both pieces removed; attacker does NOT advance.
        captures = [
          ...state.captures,
          { owner: target.color, role: target.role },
          { owner: moved.color, role: moved.role },
        ];
        delete board[move.to];
        delete board[move.from];
      } else {
        // capture: attacker takes the square.
        captures = [...state.captures, { owner: target.color, role: target.role }];
        board[move.to] = moved;
        delete board[move.from];
      }
      noProgressClock = 0;
      irreversible = true;
    } else {
      // quiet move.
      board[move.to] = moved;
      delete board[move.from];
      noProgressClock = state.noProgressClock + 1;
      irreversible = false;
    }
  }

  const ply = state.ply + 1;
  const moveNumber = Math.floor(ply / 2) + 1;
  const repCounts = irreversible ? {} : { ...state.repCounts };

  const next: JungleFlipGameState = {
    ...state,
    board,
    firstColor,
    ply,
    moveNumber,
    noProgressClock,
    repCounts,
    captures,
    lastMove: move,
    status: { type: 'playing', turn: ply % 2 === 0 ? 'red' : 'black' },
  };

  const key = jungleFlipPositionKey(next);
  next.repCounts[key] = (next.repCounts[key] ?? 0) + 1;
  next.status = computeJungleFlipStatus(next, limit, repLimit, adjudicateDeadPosition);
  return next;
}

// ── Player view (symmetric mask) ──────────────────────────────────────────────

export function getJungleFlipPlayerView(
  state: JungleFlipGameState,
  seat: JungleFlipSeat,
): JungleFlipPlayerView {
  const board: JungleFlipPlayerBoard = {};
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    const piece = state.board[square];
    if (!piece) continue;
    board[square] = piece.faceDown
      ? { faceDown: true }
      : { color: piece.color, role: piece.role, faceDown: false };
  }

  const legalMoveState =
    state.status.type === 'playing' && jungleFlipSeatToMove(state) !== seat
      ? { ...state, ply: state.ply + 1 }
      : state;
  const legalMoves = state.status.type === 'playing' ? getJungleFlipLegalMoves(legalMoveState) : [];

  return {
    id: state.id,
    perspective: seat,
    board,
    legalMoves,
    captured: state.captures.map((c) => ({ owner: c.owner, role: c.role })),
    status: state.status,
    ply: state.ply,
    firstColor: state.firstColor,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}

/** Full-information "truth" view (every face-down identity revealed) for postgame review. */
export function jungleFlipTruthView(state: JungleFlipGameState): JungleFlipPlayerView {
  const board: JungleFlipPlayerBoard = {};
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    const piece = state.board[square];
    if (piece) board[square] = { color: piece.color, role: piece.role, faceDown: false };
  }
  return {
    id: state.id,
    perspective: 'red',
    board,
    legalMoves: [],
    captured: state.captures.map((c) => ({ owner: c.owner, role: c.role })),
    status: state.status,
    ply: state.ply,
    firstColor: state.firstColor,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
  };
}
