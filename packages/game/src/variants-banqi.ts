// Banqi (半棋 / Chinese Dark Chess) — 8×4 half-xiangqi with hidden piece
// IDENTITIES on a symmetric-information board.
//
// Canonical rules reference: docs-private/fow-of-war/library/variants/banqi.md
// (LOCKED 2026-06-14, Taiwanese + TCGA draw rules) and the §7 constants this
// kernel MUST match the engine on. Golden move-gen reference:
// ~/projects/mistboard-engine/src/fow_chess/banqi/board.py.
//
// The short version this kernel implements:
//   - Board: 8 files a–h (0–7) × 4 ranks 1–4 = 32 squares. Square index =
//     file + (rank-1)*8 (a1=0 … h4=31), shared with the engine for parity.
//   - All 32 pieces start FACE-DOWN. The "deal" (which face-down square holds
//     which piece) is the ONLY hidden state, hidden from BOTH players equally.
//   - A turn is exactly one of: FLIP a face-down piece (move with from === to),
//     revealing it; or MOVE/CAPTURE with one of your revealed pieces. Every
//     piece moves one orthogonal step (NOT a slide — banqi chariots step once);
//     the cannon is the exception (§5: screen capture).
//   - First flip binds colour: when the FIRST mover (the 'red' SEAT) flips a tile,
//     that tile's ink becomes the red seat's colour for the game (so the opener
//     always reveals their OWN piece). The 'black' seat gets the other ink.
//   - Capture ladder (§4): General>Advisor>Elephant>Chariot>Horse>Soldier, with
//     the soldier↔general cycle (soldier takes general; general cannot take
//     soldier). The cannon as ATTACKER ignores rank (screen capture); as a
//     TARGET it sits above only the soldier (capturable by all but the soldier).
//   - No check, no palace, no river, no facing-generals: the general is just the
//     top of the ladder and is captured outright. Win = the side to move has no
//     legal move (subsumes all-pieces-captured). Draws: the 40-ply no-progress
//     clock (resets on capture OR flip) and threefold position repetition.
//   - Perpetual chase (長捉) limit: one piece may chase the same fleeing enemy
//     piece at most BANQI_CHASE_LIMIT times in a row; the move that would extend
//     the stretch is then illegal (unless it is the only legal move). Positions
//     inside a chase stretch do not count toward the repetition draw, so a chase
//     cannot reach threefold before the limit bites. See "Perpetual chase" below.
//
// TWO AXES (same red/black values, distinct concepts):
//   - BanqiColor ('red'|'black') = a piece's INK (its glyph colour). Pieces, the
//     deal, captures, and the colour bound on the first flip are all BanqiColor.
//   - BanqiSeat  ('red'|'black') = a PLAYER seat; 'red' = the first mover (acts on
//     even ply). Turn, seats, clock, and the winner are all BanqiSeat — never null.
// They share the red/black value set (the platform's seat-token vocabulary) but
// are a DIFFERENT axis: a seat's ink is unbound until the first flip, and the red
// SEAT may end up owning the black INK. The runtime routes by seat and never needs
// the ink; banqiInkForSeat maps seat → ink once firstColor is bound, for move-gen
// and rendering. Do NOT compare a BanqiSeat to a piece's BanqiColor.
//
// SYMMETRIC INFORMATION (§8): both players and spectators see the IDENTICAL
// masked board — a face-down tile carries NO colour or identity to anyone (unlike
// jieqi, where a face-down piece's colour is known because it sits on your side).
// So getBanqiPlayerView is a passthrough mask with no per-seat redaction; the
// only redaction boundary is the engine request (strip the deal). This module
// owns the canonical state (it knows every true identity under each face-down
// tile, and the seat→ink binding).

import type { AbortReason } from './types.js';

export type BanqiColor = 'red' | 'black';

// A player seat; 'red' = the first mover (acts on even ply) and binds its ink on
// the opening flip. Shares values with BanqiColor but is the seat axis, not ink.
export type BanqiSeat = 'red' | 'black';
export const BANQI_SEATS: readonly [BanqiSeat, BanqiSeat] = ['red', 'black'];

export type BanqiPieceRole =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'chariot'
  | 'horse'
  | 'cannon'
  | 'soldier';

export type BanqiFile = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';
export type BanqiRank = '1' | '2' | '3' | '4';
export type BanqiSquare = `${BanqiFile}${BanqiRank}`;

// `role` is always the TRUE identity, even while face-down; `color` is the ink.
// The kernel is the deal authority and knows every identity; redaction happens at
// the view/engine boundary, never in the canonical state.
export type BanqiPiece = {
  color: BanqiColor;
  role: BanqiPieceRole;
  faceDown: boolean;
};

export type BanqiBoard = Partial<Record<BanqiSquare, BanqiPiece>>;

// A turn action. A board move/capture is { from, to } with from !== to; a FLIP is
// the self-move { from: X, to: X } (a normal move never has from === to). Mirrors
// the engine's BanqiMove convention.
export type BanqiMove = {
  from: BanqiSquare;
  to: BanqiSquare;
};

// The deal: 32 pieces indexed by square index (a1=0 … h4=31). Held server-side as
// the hidden secret; the engine never sees it.
export type BanqiDealPiece = { color: BanqiColor; role: BanqiPieceRole };
export type BanqiDeal = BanqiDealPiece[];

export type BanqiGameEndReason =
  | 'stalemate' // a side can no longer act: it has no legal move on its turn, or it is provably eliminated (no piece on the board and no tile of its colour left to flip up) — subsumes all-pieces-captured
  | 'no-progress' // 40 plies with no capture and no flip
  | 'repetition' // threefold position repetition
  | 'timeout'
  | 'resignation'
  | 'abandonment';

export type BanqiGameStatus =
  | { type: 'playing'; turn: BanqiSeat }
  | { type: 'finished'; winner: BanqiSeat | null; reason: BanqiGameEndReason }
  | { type: 'aborted'; reason: AbortReason };

// Captures only ever remove REVEALED pieces (adjacency and cannon both require a
// revealed target), so the ink is always public — no per-seat redaction.
export type BanqiCapture = {
  owner: BanqiColor;
  role: BanqiPieceRole;
};

// One side's running chase stretch (see "Perpetual chase" below). Squares are
// where the two pieces stand NOW, updated as they move.
export type BanqiChaseStretch = {
  chaser: BanqiSquare; // the chasing piece
  target: BanqiSquare; // the chased (fleeing) enemy piece
  count: number; // consecutive chase moves so far
};

export type BanqiGameState = {
  id: string;
  board: BanqiBoard;
  status: BanqiGameStatus;
  // Actions taken. The 'red' seat (first mover) acts on even ply; banqiSeatToMove reads this.
  ply: number;
  // The INK bound to the 'red' seat on the opening flip; null until then. The
  // 'black' seat owns the opposite ink. banqiInkForSeat resolves a seat → ink.
  firstColor: BanqiColor | null;
  moveNumber: number;
  // Plies since the last capture OR flip. Powers the no-progress draw.
  noProgressClock: number;
  // (positionKey → times seen) within the current no-progress window; cleared on
  // any capture/flip (those are irreversible). Powers the repetition draw.
  repCounts: Record<string, number>;
  captures: BanqiCapture[];
  lastMove?: BanqiMove;
  // Running chase stretches, keyed by the CHASING seat (at most one each).
  // Derived from public information only (face-up pieces + the move list), and
  // never sent to clients: the view's legalMoves already omit a forbidden move.
  chases?: Partial<Record<BanqiSeat, BanqiChaseStretch>>;
  // Max chase moves in one stretch. undefined = BANQI_CHASE_LIMIT; null = the
  // limit is off (no forbidden moves, chase positions count for repetition).
  chaseLimit?: number | null;
};

// ── Player view (symmetric mask; same board for both seats + spectators) ──────

// A face-down tile carries NO colour or identity to anyone (the deal is hidden
// from both). This is the key contrast with jieqi's per-seat-coloured dark piece.
export type BanqiVisibleBoardEntry =
  | { color: BanqiColor; role: BanqiPieceRole; faceDown: false }
  | { faceDown: true };

export type BanqiPlayerBoard = Partial<Record<BanqiSquare, BanqiVisibleBoardEntry>>;

// Captured pieces were revealed when taken, so the ink is known to everyone.
export type BanqiCapturedView = {
  owner: BanqiColor;
  role: BanqiPieceRole;
};

export type BanqiPlayerView = {
  id: string;
  perspective: BanqiSeat;
  board: BanqiPlayerBoard;
  legalMoves: BanqiMove[];
  captured: BanqiCapturedView[];
  status: BanqiGameStatus;
  ply: number;
  // The seat→ink binding, so the client can colour each seat's pieces once known.
  firstColor: BanqiColor | null;
  moveNumber: number;
  lastMove?: BanqiMove;
  // The 長捉 limit this game is played under, present only while the rule is in
  // force. Public (a rule, not a secret): a client that replays a finished game
  // from its deal passes it back as BanqiRules (banqiRulesFromView). Absent means
  // the rule is off, so a game created before it shipped replays as it was played.
  chaseLimit?: number;
};

// ── Geometry (8×4, self-contained — NOT the 9×10 xiangqi helpers) ────────────

export const BANQI_WIDTH = 8;
export const BANQI_HEIGHT = 4;
const FILE_CHARS = 'abcdefgh';

// Orthogonal steps / ray directions: [df, dr].
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function banqiInBounds(file: number, rank: number): boolean {
  return file >= 0 && file < BANQI_WIDTH && rank >= 1 && rank <= BANQI_HEIGHT;
}

export function banqiSquareOf(file: number, rank: number): BanqiSquare {
  return `${FILE_CHARS[file]}${rank}` as BanqiSquare;
}

export function banqiCoordOf(square: BanqiSquare): { file: number; rank: number } {
  return { file: FILE_CHARS.indexOf(square[0]), rank: Number(square[1]) };
}

export function banqiSquareIndex(square: BanqiSquare): number {
  const { file, rank } = banqiCoordOf(square);
  return file + (rank - 1) * BANQI_WIDTH;
}

export function banqiSquareFromIndex(index: number): BanqiSquare {
  return banqiSquareOf(index % BANQI_WIDTH, Math.floor(index / BANQI_WIDTH) + 1);
}

/** All 32 squares in canonical index order (a1=0 … h4=31). */
export const ALL_BANQI_SQUARES: BanqiSquare[] = Array.from(
  { length: BANQI_WIDTH * BANQI_HEIGHT },
  (_, i) => banqiSquareFromIndex(i),
);

// ── Capture ladder (§4, mirrors the engine's RANK + can_capture) ─────────────

// Cannon sits at 2 for DEFENSE only (an adjacent cannon is capturable by horse
// and above, not by a soldier). As an ATTACKER the cannon ignores rank entirely
// (screen capture), so this map is never read for a cannon attacker.
const RANK: Record<BanqiPieceRole, number> = {
  general: 7,
  advisor: 6,
  elephant: 5,
  chariot: 4,
  horse: 3,
  cannon: 2,
  soldier: 1,
};

const ROLE_TO_LETTER: Record<BanqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

/**
 * Adjacency capture for NON-cannon attackers: same-or-higher rank captures, with
 * the soldier↔general cycle. Cannon captures are screen-based and never use this.
 */
export function banqiCanCapture(attacker: BanqiPieceRole, target: BanqiPieceRole): boolean {
  if (attacker === 'soldier' && target === 'general') return true;
  if (attacker === 'general' && target === 'soldier') return false;
  return RANK[attacker] >= RANK[target];
}

// ── Canonical constants (§7) ─────────────────────────────────────────────────

export const DEFAULT_NO_PROGRESS_PLY_LIMIT = 40;
export const DEFAULT_REPETITION_DRAW_COUNT = 3;
// 長捉 limit: chase moves one piece may make in a row on the same fleeing enemy
// piece before the next one becomes illegal. 暗棋2 uses 7; FunTown/Baike use 10.
export const BANQI_CHASE_LIMIT = 7;

export const BANQI_PIECE_COUNTS: Record<BanqiPieceRole, number> = {
  general: 1,
  advisor: 2,
  elephant: 2,
  chariot: 2,
  horse: 2,
  cannon: 2,
  soldier: 5,
};

// ── Deal ─────────────────────────────────────────────────────────────────────

function fullPieceList(): BanqiDealPiece[] {
  const out: BanqiDealPiece[] = [];
  for (const color of ['red', 'black'] as BanqiColor[]) {
    for (const role of Object.keys(BANQI_PIECE_COUNTS) as BanqiPieceRole[]) {
      for (let n = 0; n < BANQI_PIECE_COUNTS[role]; n += 1) out.push({ color, role });
    }
  }
  return out;
}

function multisetKey(pieces: BanqiDealPiece[]): string {
  return pieces
    .map((p) => `${p.color}-${p.role}`)
    .sort()
    .join(',');
}

const STANDARD_MULTISET = multisetKey(fullPieceList());

// A deterministic, UNSHUFFLED deal (valid multiset in canonical order). Real
// games always mint a crypto-shuffled deal via createBanqiDeal; this exists only
// as the default for the runtime's throwaway seed projection (the room-created
// event immediately replaces it with the real deal) and for tests. Do NOT use it
// as a live deal — it is fully predictable.
export const STANDARD_BANQI_DEAL: BanqiDeal = fullPieceList();

/** Throws if `deal` is not a permutation of the full 32-piece banqi multiset. */
export function assertValidBanqiDeal(deal: BanqiDeal): void {
  if (deal.length !== BANQI_WIDTH * BANQI_HEIGHT) {
    throw new Error(
      `invalid banqi deal: expected ${BANQI_WIDTH * BANQI_HEIGHT} pieces, got ${deal.length}`,
    );
  }
  if (multisetKey(deal) !== STANDARD_MULTISET) {
    throw new Error(
      'invalid banqi deal: pieces are not a permutation of the standard 32-piece set',
    );
  }
}

/**
 * Build a valid random deal by shuffling the full 32-piece multiset. `rng`
 * returns a float in [0, 1); the server supplies a crypto-backed one (the deal is
 * a hidden-information secret), tests supply a seeded one. Always valid by
 * construction. The result is indexed by square index (entry i → square i).
 */
export function createBanqiDeal(rng: () => number): BanqiDeal {
  const pieces = fullPieceList();
  for (let i = pieces.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces;
}

export function oppositeBanqiColor(color: BanqiColor): BanqiColor {
  return color === 'red' ? 'black' : 'red';
}

export function oppositeBanqiSeat(seat: BanqiSeat): BanqiSeat {
  return seat === 'red' ? 'black' : 'red';
}

// ── Rules a game is played under, and the stored setup that carries them ─────
//
// Rules are stamped per game, not read from today's constants: a stored game is
// its event log replayed through this kernel, and applyBanqiMove ignores a move
// the rules call illegal, so a game played before a rule change must replay under
// the rules it was played with. The 長捉 limit (2026-10) is the first such rule.

/** Rule parameters for one game. Omitted fields take the current defaults. */
export type BanqiRules = {
  /** 長捉 limit; null = off (rooms created before the rule shipped). */
  chaseLimit?: number | null;
};

/** The rules every stored game created before the 長捉 limit was played under. */
export const LEGACY_BANQI_RULES: Readonly<Required<BanqiRules>> = { chaseLimit: null };

/**
 * The server-secret room-created setup for a room created since the 長捉 limit
 * shipped: the deal plus the limit the room is played under. A room created before
 * it stored the bare deal array (BanqiDeal), which reads as LEGACY_BANQI_RULES.
 */
export type BanqiSetup = { deal: BanqiDeal; chaseLimit: number | null };

/** What a room-created event may hold: a current setup or a pre-rule bare deal. */
export type BanqiStoredSetup = BanqiSetup | BanqiDeal;

/** A fresh setup for a new room: a random deal under the current rules. */
export function createBanqiSetup(rng: () => number): BanqiSetup {
  return { deal: createBanqiDeal(rng), chaseLimit: BANQI_CHASE_LIMIT };
}

/**
 * Read a stored setup, failing closed: a bare deal array, or a setup object whose
 * limit is missing or malformed, is a pre-rule game (chase limit off), never the
 * current rule. Only an absent setup (no stored game: tests, the runtime's seed
 * projection) gets the current defaults.
 */
export function readBanqiSetup(setup: unknown): { deal?: BanqiDeal; rules: BanqiRules } {
  if (setup === undefined || setup === null) return { rules: {} };
  if (Array.isArray(setup)) return { deal: setup as BanqiDeal, rules: { ...LEGACY_BANQI_RULES } };
  if (typeof setup === 'object') {
    const candidate = setup as { deal?: unknown; chaseLimit?: unknown };
    const limit = candidate.chaseLimit;
    const chaseLimit =
      typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : null;
    return {
      ...(Array.isArray(candidate.deal) ? { deal: candidate.deal as BanqiDeal } : {}),
      rules: { chaseLimit },
    };
  }
  return { rules: { ...LEGACY_BANQI_RULES } };
}

/** The initial state of a stored game, under the rules its setup records. */
export function createBanqiStateFromSetup(gameId: string, setup: unknown): BanqiGameState {
  const { deal, rules } = readBanqiSetup(setup);
  return createInitialBanqiState(gameId, deal, rules);
}

/**
 * The rules a finished game's view says it was played under, for a client that
 * replays it from the deal. A view without `chaseLimit` is a game with the limit
 * off (fail closed: never replay an old game under the new rule).
 */
export function banqiRulesFromView(view: Pick<BanqiPlayerView, 'chaseLimit'>): BanqiRules {
  return { chaseLimit: view.chaseLimit ?? null };
}

/**
 * `rules` defaults to the current rules, which is right only for a fresh game. A
 * caller replaying a stored or recorded game passes the rules it was played under
 * (LEGACY_BANQI_RULES for any record made before the 長捉 limit). Every non-test
 * call site passes `rules` explicitly; apps/server/src/banqi-rules-stamp.test.ts
 * enforces that.
 */
export function createInitialBanqiState(
  gameId: string,
  deal: BanqiDeal = STANDARD_BANQI_DEAL,
  rules: BanqiRules = {},
): BanqiGameState {
  assertValidBanqiDeal(deal);
  const board: BanqiBoard = {};
  deal.forEach((p, i) => {
    board[banqiSquareFromIndex(i)] = { color: p.color, role: p.role, faceDown: true };
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
    ...(rules.chaseLimit !== undefined ? { chaseLimit: rules.chaseLimit } : {}),
  };
}

// ── Seats, turn, and the seat→ink binding ────────────────────────────────────

/** The seat to move: 'red' (first mover) on even ply, 'black' on odd. Always defined. */
export function banqiSeatToMove(state: BanqiGameState): BanqiSeat {
  return state.ply % 2 === 0 ? 'red' : 'black';
}

/**
 * The ink a seat owns, or null before the first flip binds it. Takes the binding
 * fields structurally so a BanqiPlayerView (which carries them) can ask too --
 * renderers need the seat -> ink mapping and must not re-derive it, because a
 * seat is NOT the ink it plays.
 */
export function banqiInkForSeat(
  state: Pick<BanqiGameState, 'firstColor'>,
  seat: BanqiSeat,
): BanqiColor | null {
  if (state.firstColor === null) return null;
  return seat === 'red' ? state.firstColor : oppositeBanqiColor(state.firstColor);
}

/** The ink of the side to move, or null before the first flip binds it. */
export function banqiMoverInk(state: BanqiGameState): BanqiColor | null {
  return banqiInkForSeat(state, banqiSeatToMove(state));
}

/**
 * The ink of the side that made the LAST action, or null before anything has
 * been played. Derived from ply parity (red acts on even ply, so the action at
 * ply - 1 was red's when ply is odd).
 *
 * Never read this off the board. A flip turns up a RANDOM tile, so the revealed
 * piece's colour is independent of who flipped it and the two disagree about
 * half the time -- exactly the case where a viewer needs to be told.
 */
export function banqiLastMoverInk(
  state: Pick<BanqiGameState, 'ply' | 'firstColor'>,
): BanqiColor | null {
  if (state.ply <= 0) return null;
  return banqiInkForSeat(state, state.ply % 2 === 1 ? 'red' : 'black');
}

// ── Move generation ──────────────────────────────────────────────────────────

/** Board destinations (move + capture, NOT flips) for the revealed piece on `from`. */
function pseudoBoardDests(board: BanqiBoard, from: BanqiSquare): BanqiSquare[] {
  const piece = board[from];
  if (!piece || piece.faceDown) return []; // only revealed pieces move
  const { file, rank } = banqiCoordOf(from);
  const color = piece.color;
  const dests: BanqiSquare[] = [];

  if (piece.role === 'cannon') {
    // Non-capturing: exactly one orthogonal step to an empty square.
    for (const [df, dr] of ORTHO) {
      const f = file + df;
      const r = rank + dr;
      if (banqiInBounds(f, r) && !board[banqiSquareOf(f, r)]) dests.push(banqiSquareOf(f, r));
    }
    // Capturing: slide over empties to the screen (first occupied, any piece incl.
    // face-down), skip it, then the first occupied square beyond is the target —
    // captured only if a revealed enemy. A friendly or face-down target blocks.
    for (const [df, dr] of ORTHO) {
      let f = file + df;
      let r = rank + dr;
      while (banqiInBounds(f, r) && !board[banqiSquareOf(f, r)]) {
        f += df;
        r += dr;
      }
      if (!banqiInBounds(f, r)) continue; // no screen
      f += df;
      r += dr; // skip the screen
      while (banqiInBounds(f, r) && !board[banqiSquareOf(f, r)]) {
        f += df;
        r += dr;
      }
      if (!banqiInBounds(f, r)) continue; // no target beyond the screen
      const target = board[banqiSquareOf(f, r)];
      if (target && !target.faceDown && target.color !== color) dests.push(banqiSquareOf(f, r));
    }
    return dests;
  }

  for (const [df, dr] of ORTHO) {
    const f = file + df;
    const r = rank + dr;
    if (!banqiInBounds(f, r)) continue;
    const target = board[banqiSquareOf(f, r)];
    if (!target) {
      dests.push(banqiSquareOf(f, r)); // step to empty
    } else if (
      !target.faceDown &&
      target.color !== color &&
      banqiCanCapture(piece.role, target.role)
    ) {
      dests.push(banqiSquareOf(f, r)); // capture revealed enemy on the ladder
    }
    // friendly, face-down, or uncapturable enemy → blocked
  }
  return dests;
}

/** Pure move enumeration (no status guard) for the current board/ply/binding. */
function enumerateBanqiMoves(state: BanqiGameState): BanqiMove[] {
  const moves: BanqiMove[] = [];
  // Flips first (any face-down square), in square-index order — matches the engine.
  for (const square of ALL_BANQI_SQUARES) {
    const piece = state.board[square];
    if (piece?.faceDown) moves.push({ from: square, to: square });
  }
  // Board moves for the mover's revealed pieces (only once an ink is bound).
  const moverInk = banqiMoverInk(state);
  if (moverInk !== null) {
    for (const square of ALL_BANQI_SQUARES) {
      const piece = state.board[square];
      if (piece && !piece.faceDown && piece.color === moverInk) {
        for (const to of pseudoBoardDests(state.board, square)) moves.push({ from: square, to });
      }
    }
  }
  return moves;
}

export function getBanqiLegalMoves(state: BanqiGameState): BanqiMove[] {
  if (state.status.type !== 'playing') return [];
  const moves = enumerateBanqiMoves(state);
  const forbidden = forbiddenChaseMoves(state, moves);
  if (forbidden.length === 0) return moves;
  const allowed = moves.filter((m) => !forbidden.includes(m));
  // No loss by rule edge: if extending the chase is all the chaser can do, it stays legal.
  return allowed.length > 0 ? allowed : moves;
}

/**
 * The moves the 長捉 limit takes away from the side to move right now (empty when
 * none, or when they are its only moves and so stay legal). The bot driver passes
 * the remaining legal moves to the engine as its root move list.
 */
export function getBanqiForbiddenChaseMoves(state: BanqiGameState): BanqiMove[] {
  if (state.status.type !== 'playing') return [];
  const moves = enumerateBanqiMoves(state);
  const forbidden = forbiddenChaseMoves(state, moves);
  return forbidden.length < moves.length ? forbidden : [];
}

export function getBanqiLegalMovesFrom(state: BanqiGameState, from: BanqiSquare): BanqiMove[] {
  return getBanqiLegalMoves(state).filter((move) => move.from === from);
}

export function isBanqiLegalMove(state: BanqiGameState, move: BanqiMove): boolean {
  return getBanqiLegalMovesFrom(state, move.from).some((m) => m.to === move.to);
}

// ── Perpetual chase (長捉) ───────────────────────────────────────────────────
//
// A CHASE MOVE is a quiet move (no flip, no capture) after which the moved piece
// could capture, under the normal capture rules (ladder, soldier takes general,
// cannon over a screen), the enemy piece that moved on the previous ply. Whether
// that target is protected does not matter. A CHASE STRETCH is consecutive chase
// moves by one piece on one target, the target fleeing in between; any flip, any
// capture, or any other move by either side ends it. Once a stretch holds the
// limit, the chaser's move that would extend it is illegal, unless it is the only
// legal move. The threat test reads only face-up pieces and square occupancy,
// both public, so the rule leaks nothing about the deal.
//
// Repetition: a position reached by a chase move, or by the target fleeing a live
// stretch, is not counted toward threefold. Otherwise a chase cycle of 2 or 4
// squares repeats long before 7 chases, and the chaser would keep the draw the
// limit exists to take away. Positions reached by any other move count as before.

function chaseLimitOf(state: BanqiGameState): number | null {
  return state.chaseLimit === undefined ? BANQI_CHASE_LIMIT : state.chaseLimit;
}

/** The view's `chaseLimit` field: present only while the limit is in force. */
function chaseLimitViewField(state: BanqiGameState): { chaseLimit?: number } {
  const limit = chaseLimitOf(state);
  return limit === null ? {} : { chaseLimit: limit };
}

/** Can the face-up piece on `from` capture the face-up enemy on `target` on `board`? */
function banqiThreatens(board: BanqiBoard, from: BanqiSquare, target: BanqiSquare): boolean {
  const attacker = board[from];
  const victim = board[target];
  if (!attacker || attacker.faceDown || !victim || victim.faceDown) return false;
  if (attacker.color === victim.color) return false;
  return pseudoBoardDests(board, from).includes(target);
}

/**
 * If `move` is a chase move in `state`, the square of the piece it chases (the
 * enemy piece that moved on the previous ply); else null. `move` must be legal.
 */
function chaseTargetOf(state: BanqiGameState, move: BanqiMove): BanqiSquare | null {
  if (move.from === move.to) return null; // flip
  if (state.board[move.to]) return null; // capture
  const last = state.lastMove;
  if (!last || last.from === last.to) return null; // nothing moved last ply
  const board: BanqiBoard = { ...state.board };
  board[move.to] = board[move.from];
  delete board[move.from];
  return banqiThreatens(board, move.to, last.to) ? last.to : null;
}

/** Moves (from `moves`) that would push the mover's stretch past the limit. */
function forbiddenChaseMoves(state: BanqiGameState, moves: BanqiMove[]): BanqiMove[] {
  const limit = chaseLimitOf(state);
  if (limit === null) return [];
  const stretch = state.chases?.[banqiSeatToMove(state)];
  if (!stretch || stretch.count < limit) return [];
  return moves.filter(
    (m) => m.from === stretch.chaser && chaseTargetOf(state, m) === stretch.target,
  );
}

/**
 * The chase stretches after `move` (legal, quiet or not) is played in `state`,
 * and whether the resulting position belongs to a stretch (so is kept out of the
 * repetition count).
 */
function nextChases(
  state: BanqiGameState,
  move: BanqiMove,
): { chases: Partial<Record<BanqiSeat, BanqiChaseStretch>>; inChase: boolean } {
  if (move.from === move.to || state.board[move.to]) return { chases: {}, inChase: false };
  const mover = banqiSeatToMove(state);
  const opponent = oppositeBanqiSeat(mover);
  const chases: Partial<Record<BanqiSeat, BanqiChaseStretch>> = {};
  let inChase = false;
  // The opponent's stretch lives on only if its target fled with this move.
  const theirs = state.chases?.[opponent];
  if (theirs && move.from === theirs.target) {
    chases[opponent] = { ...theirs, target: move.to };
    inChase = true;
  }
  // The mover's own stretch: extended, started afresh, or ended.
  const target = chaseTargetOf(state, move);
  if (target !== null) {
    const mine = state.chases?.[mover];
    const extends_ = mine !== undefined && mine.chaser === move.from && mine.target === target;
    chases[mover] = { chaser: move.to, target, count: extends_ ? mine.count + 1 : 1 };
    inChase = true;
  }
  return { chases, inChase };
}

// ── Repetition key ───────────────────────────────────────────────────────────

/**
 * The repetition key (§7): masked board squares + side-to-move (+ binding).
 * Face-down tiles hash as 'x' (the deal is EXCLUDED); the clock and bag are
 * excluded too. Mirrors the engine's position_key for golden parity.
 */
function banqiPositionKey(state: BanqiGameState): string {
  const sqkey = ALL_BANQI_SQUARES.map((square) => {
    const piece = state.board[square];
    if (!piece) return '.';
    if (piece.faceDown) return 'x';
    const letter = ROLE_TO_LETTER[piece.role];
    return piece.color === 'red' ? letter : letter.toLowerCase();
  }).join('');
  return `${sqkey}|${state.ply % 2}|${state.firstColor ?? '?'}`;
}

// ── Apply move + terminal detection ──────────────────────────────────────────

export type BanqiApplyMoveOptions = {
  noProgressClockLimit?: number;
  repetitionDrawCount?: number;
};

function computeBanqiStatus(
  state: BanqiGameState,
  limit: number,
  repLimit: number,
): BanqiGameStatus {
  // Draw clocks are checked before no-legal-move, matching the engine's result().
  if (state.noProgressClock >= limit)
    return { type: 'finished', winner: null, reason: 'no-progress' };
  if ((state.repCounts[banqiPositionKey(state)] ?? 0) >= repLimit) {
    return { type: 'finished', winner: null, reason: 'repetition' };
  }
  if (enumerateBanqiMoves(state).length === 0) {
    // The side to move has no legal action and loses.
    return {
      type: 'finished',
      winner: oppositeBanqiSeat(banqiSeatToMove(state)),
      reason: 'stalemate',
    };
  }
  // Provable-elimination adjudication. A side is finished the moment it has no
  // piece on the board AND no tile of its colour still face-down: it can never
  // hold a piece again, so every remaining turn of its is a forced flip of an
  // opponent tile that ends in a certain no-legal-move loss. We adjudicate now —
  // outcome-identical to playing it out, just sooner — sparing both sides the
  // pointless tail (e.g. your last piece is captured while only opponent tiles
  // remain, or you flip the last tile and it is the opponent's). `color` is the
  // TRUE identity even while face-down, and the remaining face-down composition is
  // publicly inferable (fixed deal minus reveals minus captures), so reading it
  // here leaks nothing. The draw clocks above still take precedence. The engine's
  // result() (Python board.py + Rust banqi_rust) mirrors this exact adjudication,
  // so all three rule kernels agree on the terminal ply.
  const seatToMove = banqiSeatToMove(state);
  const isEliminated = (seat: BanqiSeat): boolean => {
    const ink = banqiInkForSeat(state, seat);
    if (ink === null) return false; // colours not bound yet (pre-first-flip)
    return !ALL_BANQI_SQUARES.some((sq) => state.board[sq]?.color === ink);
  };
  if (isEliminated(seatToMove)) {
    // The side to move can never act with a piece again; it loses now.
    return { type: 'finished', winner: oppositeBanqiSeat(seatToMove), reason: 'stalemate' };
  }
  if (isEliminated(oppositeBanqiSeat(seatToMove))) {
    // The side to move outlasts the wiped-out waiting side and wins.
    return { type: 'finished', winner: seatToMove, reason: 'stalemate' };
  }
  return { type: 'playing', turn: seatToMove };
}

export function applyBanqiMove(
  state: BanqiGameState,
  move: BanqiMove,
  opts: BanqiApplyMoveOptions = {},
): BanqiGameState {
  if (state.status.type !== 'playing') return state;
  if (!isBanqiLegalMove(state, move)) return state;

  const limit = opts.noProgressClockLimit ?? DEFAULT_NO_PROGRESS_PLY_LIMIT;
  const repLimit = opts.repetitionDrawCount ?? DEFAULT_REPETITION_DRAW_COUNT;

  const board: BanqiBoard = { ...state.board };
  let firstColor = state.firstColor;
  let noProgressClock: number;
  let irreversible: boolean;
  let captures = state.captures;

  if (move.from === move.to) {
    // FLIP: reveal the face-down tile (the kernel already knows its identity).
    const piece = board[move.from];
    if (!piece) return state;
    board[move.from] = { ...piece, faceDown: false };
    // First flip binds the 'red' seat's ink. (The first action is always a flip
    // — pre-binding only flips are legal — so this runs exactly once, at ply 0.)
    if (firstColor === null && state.ply === 0) firstColor = piece.color;
    noProgressClock = 0;
    irreversible = true;
  } else {
    // MOVE / CAPTURE. A capture only ever removes a revealed enemy.
    const target = board[move.to];
    const moved = board[move.from]!;
    if (target) {
      captures = [...state.captures, { owner: target.color, role: target.role }];
      noProgressClock = 0;
      irreversible = true;
    } else {
      noProgressClock = state.noProgressClock + 1;
      irreversible = false;
    }
    board[move.to] = moved;
    delete board[move.from];
  }

  const ply = state.ply + 1;
  const moveNumber = Math.floor(ply / 2) + 1;
  // A flip/capture is irreversible → fresh repetition window; else carry counts.
  const repCounts = irreversible ? {} : { ...state.repCounts };
  const chase = nextChases(state, move);

  const next: BanqiGameState = {
    ...state,
    board,
    firstColor,
    ply,
    moveNumber,
    noProgressClock,
    repCounts,
    captures,
    lastMove: move,
    chases: chase.chases,
    status: { type: 'playing', turn: ply % 2 === 0 ? 'red' : 'black' },
  };

  // A position inside a chase stretch is kept out of the repetition count (see
  // "Perpetual chase"), unless the limit is switched off for this game.
  if (!chase.inChase || chaseLimitOf(state) === null) {
    const key = banqiPositionKey(next);
    next.repCounts[key] = (next.repCounts[key] ?? 0) + 1;
  }
  next.status = computeBanqiStatus(next, limit, repLimit);
  return next;
}

// ── Player view (symmetric mask) ─────────────────────────────────────────────

export function getBanqiPlayerView(state: BanqiGameState, seat: BanqiSeat): BanqiPlayerView {
  const board: BanqiPlayerBoard = {};
  for (const square of ALL_BANQI_SQUARES) {
    const piece = state.board[square];
    if (!piece) continue;
    board[square] = piece.faceDown
      ? { faceDown: true } // no ink/identity to anyone — the deal is hidden
      : { color: piece.color, role: piece.role, faceDown: false };
  }

  const legalMoveState =
    state.status.type === 'playing' && banqiSeatToMove(state) !== seat
      ? { ...state, ply: state.ply + 1 }
      : state;
  const legalMoves = state.status.type === 'playing' ? getBanqiLegalMoves(legalMoveState) : [];

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
    ...chaseLimitViewField(state),
  };
}

/**
 * A full-information "truth" view (every face-down identity revealed) for postgame
 * review. Unlike getBanqiPlayerView nothing is masked — never ship this to a live
 * client. Symmetric info means there is only one truth view (no per-seat split),
 * but it keeps the player-view shape so the review renderer can reuse the pipeline.
 */
export function banqiTruthView(state: BanqiGameState): BanqiPlayerView {
  const board: BanqiPlayerBoard = {};
  for (const square of ALL_BANQI_SQUARES) {
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
    ...chaseLimitViewField(state),
  };
}
