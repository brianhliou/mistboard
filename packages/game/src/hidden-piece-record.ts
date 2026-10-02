// The game record of the three hidden-piece variants (jieqi, banqi, Flip
// Jungle): what a finished game's export says about the pieces that started
// face down, and a reference replayer that rebuilds the game from the export
// alone (#484).
//
// The rule, one for all three:
//
// 1. Moves carry reveals. A move that turns a piece over names what it became,
//    and a capture of a face-down piece (jieqi only; banqi and Flip Jungle can
//    only capture a revealed piece) names what was captured. So a record
//    replays from its moves alone, from the standard face-down start.
// 2. The deal is optional. A site game is dealt in full when it is created, so
//    its record also carries the deal as the variant's dealt FEN (the public
//    FEN plus a sixth field naming every face-down piece). An imported engine
//    match has no deal (its referee drew each identity when the piece was
//    turned over), so its record has none, and nothing stands in for it.
// 3. When a record has both, every reveal must agree with the deal. The
//    replayer checks that at every ply.
//
// JSON (the per-game export and every /data line): each ply that turned a
// piece over has `revealed: { color, role }`; each ply that captured a
// face-down piece has `captured_hidden: { color, role }`. Roles are the
// variant's own role words (jieqi: chariot, horse, elephant, advisor, cannon,
// soldier; banqi adds general; Flip Jungle: rat, cat, dog, wolf, leopard,
// tiger, lion, elephant). `deal_fen` sits at the top level when the game had a
// real deal.
//
// PGN movetext, one token per ply, upper case red and lower case black. A
// reveal is `=` and the letter, the shape of a chess promotion, so a standard
// PGN reader keeps it inside the move token (ICGA writes `d8(P)`, but PGN
// reads parentheses as a variation):
//   jieqi        the JSON uci (ICCS coordinates), then `=R` when the move
//                turned the mover over, then `x=n` when it captured a
//                face-down piece: `h2e2`, `e3e4=P`, `b0b7=Cx=n`. Letters are
//                the jieqi FEN's: R chariot, N horse, B elephant, A advisor,
//                C cannon, P soldier.
//   banqi        ICGA (Chen, Shen and Hsu, ICGA Journal 2010): `b4-b2` for a
//                move, `b2=G` for a flip (ICGA's `b2(G)`), on ICGA's 4x8 board (columns a-d,
//                rows 1-8) with ICGA's letters K king, G guard, M minister,
//                R rook, N knight, C cannon, P pawn. The site's 8x4 board maps
//                onto it by swapping the two coordinates: site file a-h is
//                ICGA row 1-8 and site rank 1-4 is ICGA column a-d (site a1 is
//                ICGA a1, h1 is a8, c2 is b3; banqiSquareToIcga). Banqi's rules
//                do not change under the swap, so every line stays legal.
//   Flip Jungle  the JSON uci, flips keep their `@`, then `=E` on a flip:
//                `@c3=E`, `c3c4`. Letters are the Flip Jungle FEN's: R rat,
//                C cat, D dog, W wolf, P leopard, T tiger, L lion, E elephant.
// The start is a `FEN` tag (with `SetUp "1"`) holding the standard face-down
// layout as the variant's public FEN, and `DealFEN` holds the deal when there
// is one. Both FENs use the site's own board and letters.

import { banqiStateToDealtFen, banqiStateToEngineFen, parseBanqiFen } from './banqi-fen.js';
import {
  jieqiStateToDealtFen,
  jieqiStateToPikafishFen,
  parseJieqiFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import {
  jungleFlipStateToDealtFen,
  jungleFlipStateToEngineFen,
  parseJungleFlipFen,
} from './jungle-flip-fen.js';
import {
  applyBanqiMove,
  type BanqiBoard,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiSquare,
  banqiCoordOf,
  createInitialBanqiState,
} from './variants-banqi.js';
import {
  applyJieqiMove,
  createInitialJieqiState,
  type JieqiBoard,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
} from './variants-jieqi.js';
import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  type JungleFlipBoard,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPieceRole,
  type JungleFlipSquare,
} from './variants-jungle-flip.js';

export const HIDDEN_PIECE_VARIANTS = ['jieqi', 'banqi', 'jungle-flip'] as const;
export type HiddenPieceVariant = (typeof HIDDEN_PIECE_VARIANTS)[number];

export function isHiddenPieceVariant(variant: string): variant is HiddenPieceVariant {
  return (HIDDEN_PIECE_VARIANTS as readonly string[]).includes(variant);
}

export type HiddenPieceColor = 'red' | 'black';

/** A piece identity as the record states it: the ink and the variant's role word. */
export type HiddenPieceIdentity = { color: HiddenPieceColor; role: string };

/** What one ply turned over, and what face-down piece it captured. */
export type HiddenPieceReveal = {
  revealed: HiddenPieceIdentity | null;
  capturedHidden: HiddenPieceIdentity | null;
};

/** One ply as the JSON export carries it (only the fields a replay reads). */
export type HiddenPieceRecordPly = {
  uci: string;
  revealed?: HiddenPieceIdentity | null;
  captured_hidden?: HiddenPieceIdentity | null;
};

/** A game record: the JSON export, or a parsed PGN, reduced to what replays it. */
export type HiddenPieceRecord = {
  variant: string;
  deal_fen?: string | null;
  plies: readonly HiddenPieceRecordPly[];
};

// ── Reading reveals off the kernel (the export side) ─────────────────────────

function identity(piece: { color: HiddenPieceColor; role: string }): HiddenPieceIdentity {
  return { color: piece.color, role: piece.role };
}

/** A jieqi ply's reveals, read off the position before it. A piece whose
 *  identity was never determined (an imported game) is never named. */
export function jieqiPlyReveal(before: JieqiGameState, move: JieqiMove): HiddenPieceReveal {
  const mover = before.board[move.from];
  const victim = before.board[move.to];
  return {
    revealed: mover?.faceDown && !mover.unknown ? identity(mover) : null,
    capturedHidden: victim?.faceDown && !victim.unknown ? identity(victim) : null,
  };
}

/** A banqi ply's reveal: a flip (from === to) names the tile it turned over. */
export function banqiPlyReveal(before: BanqiGameState, move: BanqiMove): HiddenPieceReveal {
  const tile = move.from === move.to ? before.board[move.from] : undefined;
  return { revealed: tile?.faceDown ? identity(tile) : null, capturedHidden: null };
}

/** A Flip Jungle ply's reveal, the same rule as banqi. */
export function jungleFlipPlyReveal(
  before: JungleFlipGameState,
  move: JungleFlipMove,
): HiddenPieceReveal {
  const tile = move.from === move.to ? before.board[move.from] : undefined;
  return { revealed: tile?.faceDown ? identity(tile) : null, capturedHidden: null };
}

// ── Start positions ──────────────────────────────────────────────────────────

/** The standard face-down start as the variant's public FEN (no identities). */
export function hiddenPieceStartFen(variant: HiddenPieceVariant): string {
  if (variant === 'jieqi') return jieqiStateToPikafishFen(createInitialJieqiState('start'));
  if (variant === 'banqi') return banqiStateToEngineFen(createInitialBanqiState('start'));
  return jungleFlipStateToEngineFen(createInitialJungleFlipState('start'));
}

// ── PGN move tokens ──────────────────────────────────────────────────────────

const JIEQI_LETTER: Record<JieqiPieceRole, string> = {
  chariot: 'R',
  horse: 'N',
  elephant: 'B',
  advisor: 'A',
  cannon: 'C',
  soldier: 'P',
  general: 'K',
};

// ICGA 2010, Table 1.
const BANQI_ICGA_LETTER: Record<BanqiPieceRole, string> = {
  general: 'K',
  advisor: 'G',
  elephant: 'M',
  chariot: 'R',
  horse: 'N',
  cannon: 'C',
  soldier: 'P',
};

const JUNGLE_FLIP_LETTER: Record<JungleFlipPieceRole, string> = {
  rat: 'R',
  cat: 'C',
  dog: 'D',
  wolf: 'W',
  leopard: 'P',
  tiger: 'T',
  lion: 'L',
  elephant: 'E',
};

function letterTable(variant: HiddenPieceVariant): Readonly<Record<string, string>> {
  if (variant === 'jieqi') return JIEQI_LETTER;
  if (variant === 'banqi') return BANQI_ICGA_LETTER;
  return JUNGLE_FLIP_LETTER;
}

function identityLetter(variant: HiddenPieceVariant, piece: HiddenPieceIdentity): string {
  const letter = letterTable(variant)[piece.role];
  if (!letter) throw new Error(`${variant}: no letter for role ${piece.role}`);
  return piece.color === 'red' ? letter : letter.toLowerCase();
}

function identityFromLetter(
  variant: HiddenPieceVariant,
  letter: string,
): HiddenPieceIdentity | null {
  const upper = letter.toUpperCase();
  const entry = Object.entries(letterTable(variant)).find(([, ch]) => ch === upper);
  if (!entry) return null;
  return { color: letter === upper ? 'red' : 'black', role: entry[0] };
}

const BANQI_FILES = 'abcdefgh';
const ICGA_COLUMNS = 'abcd';

/** Site square (8 files x 4 ranks) -> ICGA square (4 columns x 8 rows):
 *  the site rank is the ICGA column, the site file the ICGA row. a1 -> a1,
 *  h1 -> a8, a4 -> d1, h4 -> d8. */
export function banqiSquareToIcga(square: BanqiSquare): string {
  const { file, rank } = banqiCoordOf(square);
  return `${ICGA_COLUMNS[rank - 1]}${file + 1}`;
}

/** ICGA square -> site square, or null when it is off the 4x8 board. */
export function icgaSquareToBanqi(square: string): BanqiSquare | null {
  const m = /^([a-d])([1-8])$/.exec(square);
  if (!m) return null;
  return `${BANQI_FILES[Number(m[2]) - 1]}${ICGA_COLUMNS.indexOf(m[1]!) + 1}` as BanqiSquare;
}

/** The PGN movetext token for one ply. */
export function hiddenPiecePgnToken(
  variant: HiddenPieceVariant,
  ply: HiddenPieceRecordPly,
): string {
  const revealed = ply.revealed ? `=${identityLetter(variant, ply.revealed)}` : '';
  if (variant === 'banqi') {
    const flip = /^@([a-h][1-4])$/.exec(ply.uci);
    if (flip) return `${banqiSquareToIcga(flip[1] as BanqiSquare)}${revealed}`;
    const move = /^([a-h][1-4])([a-h][1-4])$/.exec(ply.uci);
    if (!move) throw new Error(`banqi: unreadable uci ${ply.uci}`);
    return `${banqiSquareToIcga(move[1] as BanqiSquare)}-${banqiSquareToIcga(move[2] as BanqiSquare)}`;
  }
  const captured = ply.captured_hidden ? `x=${identityLetter(variant, ply.captured_hidden)}` : '';
  return `${ply.uci}${revealed}${captured}`;
}

const JIEQI_TOKEN = /^([a-i][0-9][a-i][0-9])(?:=([A-Za-z]))?(?:x=([A-Za-z]))?$/;
const JUNGLE_FLIP_TOKEN = /^(@[a-d][1-4]|[a-d][1-4][a-d][1-4])(?:=([A-Za-z]))?$/;
const BANQI_FLIP_TOKEN = /^([a-d][1-8])=([A-Za-z])$/;
const BANQI_MOVE_TOKEN = /^([a-d][1-8])-([a-d][1-8])$/;

/** One movetext token back into a record ply, or null when it is not one. */
export function parseHiddenPiecePgnToken(
  variant: HiddenPieceVariant,
  token: string,
): HiddenPieceRecordPly | null {
  const letter = (ch: string | undefined): HiddenPieceIdentity | null | undefined =>
    ch === undefined ? undefined : identityFromLetter(variant, ch);
  if (variant === 'banqi') {
    const flip = BANQI_FLIP_TOKEN.exec(token);
    if (flip) {
      const square = icgaSquareToBanqi(flip[1]!);
      const revealed = letter(flip[2]);
      if (!square || !revealed) return null;
      return { uci: `@${square}`, revealed };
    }
    const move = BANQI_MOVE_TOKEN.exec(token);
    if (!move) return null;
    const from = icgaSquareToBanqi(move[1]!);
    const to = icgaSquareToBanqi(move[2]!);
    return from && to ? { uci: `${from}${to}` } : null;
  }
  const m = (variant === 'jieqi' ? JIEQI_TOKEN : JUNGLE_FLIP_TOKEN).exec(token);
  if (!m) return null;
  const revealed = letter(m[2]);
  const capturedHidden = letter(m[3]);
  if (revealed === null || capturedHidden === null) return null;
  return {
    uci: m[1]!,
    ...(revealed ? { revealed } : {}),
    ...(capturedHidden ? { captured_hidden: capturedHidden } : {}),
  };
}

// ── PGN writer and reader ────────────────────────────────────────────────────

const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'Red', 'Black', 'Result'];

function tagLine(name: string, value: string): string {
  return `[${name} "${value.replace(/[\\"]/g, (char) => `\\${char}`)}"]`;
}

function wrap(text: string, width = 80): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join('\n');
}

export type HiddenPiecePgnWriteGame = {
  variant: HiddenPieceVariant;
  tags: Readonly<Record<string, string>>;
  result: string;
  dealFen: string | null;
  plies: readonly HiddenPieceRecordPly[];
};

/** A whole PGN game: the tag block (seven-tag roster first, then SetUp, FEN,
 *  DealFEN when there is a deal, then the rest), and the movetext. */
export function writeHiddenPiecePgn(game: HiddenPiecePgnWriteGame): string {
  const tags: Record<string, string> = {
    ...game.tags,
    Result: game.result,
    SetUp: '1',
    FEN: hiddenPieceStartFen(game.variant),
  };
  if (game.dealFen) tags.DealFEN = game.dealFen;
  else delete tags.DealFEN;
  const lines: string[] = [];
  for (const name of SEVEN_TAG_ROSTER) lines.push(tagLine(name, tags[name] ?? '?'));
  for (const name of ['SetUp', 'FEN', 'DealFEN']) {
    if (tags[name] !== undefined) lines.push(tagLine(name, tags[name]));
  }
  for (const [name, value] of Object.entries(tags)) {
    if (!SEVEN_TAG_ROSTER.includes(name) && !['SetUp', 'FEN', 'DealFEN'].includes(name)) {
      lines.push(tagLine(name, value));
    }
  }
  const body: string[] = [];
  game.plies.forEach((ply, index) => {
    if (index % 2 === 0) body.push(`${index / 2 + 1}.`);
    body.push(hiddenPiecePgnToken(game.variant, ply));
  });
  body.push(game.result);
  return `${lines.join('\n')}\n\n${wrap(body.join(' '))}\n`;
}

export type ParsedHiddenPiecePgn =
  | { ok: true; tags: Record<string, string>; record: HiddenPieceRecord }
  | { ok: false; error: string };

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** Read one PGN game written by writeHiddenPiecePgn (or by hand in the same
 *  grammar). The variant comes from MistboardVariant, else Variant. */
export function parseHiddenPiecePgn(text: string): ParsedHiddenPiecePgn {
  const tags: Record<string, string> = {};
  const movetext: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const tag = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]$/.exec(line);
    if (tag) tags[tag[1]!] = tag[2]!.replace(/\\(.)/g, '$1');
    else if (line.length > 0) movetext.push(line);
  }
  const named = (tags.MistboardVariant ?? tags.Variant ?? '').toLowerCase();
  const variant = named === 'flip jungle' ? 'jungle-flip' : named;
  if (!isHiddenPieceVariant(variant)) {
    return { ok: false, error: `not a hidden-piece variant: "${named}"` };
  }
  const plies: HiddenPieceRecordPly[] = [];
  const body = movetext.join(' ').replace(/\{[^}]*\}/g, ' ');
  for (const token of body.split(/\s+/).filter(Boolean)) {
    if (/^\d+\.(\.\.)?$/.test(token) || RESULT_TOKENS.has(token)) continue;
    const ply = parseHiddenPiecePgnToken(variant, token);
    if (!ply) return { ok: false, error: `unreadable move "${token}"` };
    plies.push(ply);
  }
  return {
    ok: true,
    tags,
    record: { variant, ...(tags.DealFEN ? { deal_fen: tags.DealFEN } : {}), plies },
  };
}

/** Every game in a multi-game PGN file (a /data monthly file): games are
 *  separated by a blank line before the next tag block. */
export function parseHiddenPiecePgnGames(text: string): ParsedHiddenPiecePgn[] {
  return text
    .split(/\r?\n\s*\r?\n(?=\[)/)
    .filter((chunk) => chunk.trim().length > 0)
    .map(parseHiddenPiecePgn);
}

// ── Reference replayer ───────────────────────────────────────────────────────

export type HiddenPieceReplayResult =
  | {
      ok: true;
      variant: HiddenPieceVariant;
      plies: number;
      /** The final position as the variant's public FEN. */
      finalFen: string;
      /** The final position with every face-down identity, when the record had a deal. */
      finalDealtFen: string | null;
      status: { type: string; winner?: string | null; reason?: string };
    }
  | { ok: false; ply: number; error: string };

type Fail = { ok: false; ply: number; error: string };

// A fixed "random" source: without a deal the start's face-down identities are
// placeholders, each overwritten by the record when the piece is turned over,
// so which placeholder goes where never shows. Fixed keeps the function pure.
const PLACEHOLDER_RNG = (): number => 0;

function sameIdentity(a: { color: string; role: string }, b: HiddenPieceIdentity): boolean {
  return a.color === b.color && a.role === b.role;
}

type FaceDownBoard = Partial<Record<string, { color: string; role: string; faceDown: boolean }>>;

/**
 * Make the face-down piece on `square` be `want`. With a deal the identity is
 * fixed, so it must already match (the consistency check). Without one, the
 * placeholder there trades identities with a face-down piece that holds `want`,
 * which keeps the hidden multiset exactly what the game's was. Returns a new
 * board, or an error string.
 */
function settleIdentity<B extends FaceDownBoard>(
  board: B,
  square: string,
  want: HiddenPieceIdentity,
  pinned: boolean,
  sameColorOnly: boolean,
): B | string {
  const piece = board[square];
  if (!piece?.faceDown) return `${square} holds no face-down piece`;
  if (sameIdentity(piece, want)) return board;
  if (pinned) {
    return `${square} turns over ${want.color} ${want.role} but the deal has ${piece.color} ${piece.role} there`;
  }
  if (sameColorOnly && piece.color !== want.color) {
    return `${square} holds a ${piece.color} piece, the record names ${want.color}`;
  }
  const donor = Object.entries(board).find(
    ([sq, other]) => sq !== square && other?.faceDown && sameIdentity(other, want),
  );
  if (!donor) return `${square}: no face-down ${want.color} ${want.role} is left to turn over`;
  const [donorSquare, donorPiece] = donor;
  return {
    ...board,
    [square]: { ...piece, color: want.color, role: want.role },
    [donorSquare]: { ...donorPiece!, color: piece.color, role: piece.role },
  };
}

function replayJieqi(record: HiddenPieceRecord): HiddenPieceReplayResult {
  const pinned = Boolean(record.deal_fen);
  const parsed = parseJieqiFen(record.deal_fen ?? hiddenPieceStartFen('jieqi'), {
    gameId: 'record',
    rng: PLACEHOLDER_RNG,
  });
  if (!parsed.ok) return { ok: false, ply: 0, error: `deal_fen: ${parsed.error}` };
  if (pinned && parsed.sampled) {
    return { ok: false, ply: 0, error: 'deal_fen leaves an identity open' };
  }
  let state = parsed.state;
  for (const [index, ply] of record.plies.entries()) {
    const n = index + 1;
    const fail = (error: string): Fail => ({ ok: false, ply: n, error });
    const move = pikafishUciToJieqiMove(ply.uci);
    if (!move) return fail(`unreadable uci ${ply.uci}`);
    let board: JieqiBoard = state.board;
    const mover = board[move.from];
    if (!mover) return fail(`no piece on ${move.from}`);
    if (mover.faceDown !== Boolean(ply.revealed)) {
      return fail(
        mover.faceDown
          ? 'turns a piece over and names nothing'
          : 'names a reveal for a face-up piece',
      );
    }
    if (ply.revealed) {
      const next = settleIdentity(board, move.from, ply.revealed, pinned, true);
      if (typeof next === 'string') return fail(next);
      board = next;
    }
    const victim = board[move.to];
    if (Boolean(victim?.faceDown) !== Boolean(ply.captured_hidden)) {
      return fail(
        victim?.faceDown
          ? 'captures a face-down piece and names nothing'
          : 'names a hidden capture that is not one',
      );
    }
    if (ply.captured_hidden) {
      const next = settleIdentity(board, move.to, ply.captured_hidden, pinned, true);
      if (typeof next === 'string') return fail(next);
      board = next;
    }
    const before: JieqiGameState = { ...state, board };
    const after = applyJieqiMove(before, move as JieqiMove);
    if (after === before) return fail(`illegal move ${ply.uci}`);
    state = after;
  }
  return {
    ok: true,
    variant: 'jieqi',
    plies: record.plies.length,
    finalFen: jieqiStateToPikafishFen(state),
    finalDealtFen: pinned ? jieqiStateToDealtFen(state) : null,
    status: state.status,
  };
}

type FlipKernel<State, Board extends FaceDownBoard, Move> = {
  variant: 'banqi' | 'jungle-flip';
  parse(fen: string): { ok: true; state: State; sampled: boolean } | { ok: false; error: string };
  board(state: State): Board;
  withBoard(state: State, board: Board): State;
  apply(state: State, move: Move): State;
  fen(state: State): string;
  dealtFen(state: State): string;
  status(state: State): { type: string; winner?: string | null; reason?: string };
  move(uci: string): Move | null;
};

function replayFlip<State, Board extends FaceDownBoard, Move extends { from: string; to: string }>(
  record: HiddenPieceRecord,
  kernel: FlipKernel<State, Board, Move>,
): HiddenPieceReplayResult {
  const pinned = Boolean(record.deal_fen);
  const parsed = kernel.parse(record.deal_fen ?? hiddenPieceStartFen(kernel.variant));
  if (!parsed.ok) return { ok: false, ply: 0, error: `deal_fen: ${parsed.error}` };
  if (pinned && parsed.sampled) {
    return { ok: false, ply: 0, error: 'deal_fen leaves an identity open' };
  }
  let state = parsed.state;
  for (const [index, ply] of record.plies.entries()) {
    const n = index + 1;
    const fail = (error: string): Fail => ({ ok: false, ply: n, error });
    if (ply.captured_hidden) return fail(`${kernel.variant} cannot capture a face-down piece`);
    const move = kernel.move(ply.uci);
    if (!move) return fail(`unreadable uci ${ply.uci}`);
    const isFlip = move.from === move.to;
    if (isFlip !== Boolean(ply.revealed)) {
      return fail(isFlip ? 'turns a piece over and names nothing' : 'names a reveal on a move');
    }
    let before = state;
    if (ply.revealed) {
      const next = settleIdentity(kernel.board(state), move.from, ply.revealed, pinned, false);
      if (typeof next === 'string') return fail(next);
      before = kernel.withBoard(state, next);
    }
    const after = kernel.apply(before, move);
    if (after === before) return fail(`illegal move ${ply.uci}`);
    state = after;
  }
  return {
    ok: true,
    variant: kernel.variant,
    plies: record.plies.length,
    finalFen: kernel.fen(state),
    finalDealtFen: pinned ? kernel.dealtFen(state) : null,
    status: kernel.status(state),
  };
}

function flipUciMove<Square extends string>(
  uci: string,
  squares: RegExp,
): { from: Square; to: Square } | null {
  const flip = new RegExp(`^@(${squares.source})$`).exec(uci);
  if (flip) return { from: flip[1] as Square, to: flip[1] as Square };
  const move = new RegExp(`^(${squares.source})(${squares.source})$`).exec(uci);
  return move ? { from: move[1] as Square, to: move[2] as Square } : null;
}

/**
 * Rebuild a hidden-piece game from its record alone and return the final
 * position. With `deal_fen` the start is that deal and every reveal must match
 * it; without one the start is the standard face-down layout and each reveal
 * decides the identity it names. Errors name the ply (1-based; 0 is the start).
 */
export function replayHiddenPieceRecord(record: HiddenPieceRecord): HiddenPieceReplayResult {
  if (!isHiddenPieceVariant(record.variant)) {
    return { ok: false, ply: 0, error: `not a hidden-piece variant: ${record.variant}` };
  }
  if (record.variant === 'jieqi') return replayJieqi(record);
  if (record.variant === 'banqi') {
    return replayFlip<BanqiGameState, BanqiBoard, BanqiMove>(record, {
      variant: 'banqi',
      parse: (fen) => parseBanqiFen(fen, { gameId: 'record', rng: PLACEHOLDER_RNG }),
      board: (state) => state.board,
      withBoard: (state, board) => ({ ...state, board }),
      apply: (state, move) => applyBanqiMove(state, move),
      fen: banqiStateToEngineFen,
      dealtFen: banqiStateToDealtFen,
      status: (state) => state.status,
      move: (uci) => flipUciMove<BanqiSquare>(uci, /[a-h][1-4]/),
    });
  }
  return replayFlip<JungleFlipGameState, JungleFlipBoard, JungleFlipMove>(record, {
    variant: 'jungle-flip',
    parse: (fen) => parseJungleFlipFen(fen, { gameId: 'record', rng: PLACEHOLDER_RNG }),
    board: (state) => state.board,
    withBoard: (state, board) => ({ ...state, board }),
    apply: (state, move) => applyJungleFlipMove(state, move),
    fen: jungleFlipStateToEngineFen,
    dealtFen: jungleFlipStateToDealtFen,
    status: (state) => state.status,
    move: (uci) => flipUciMove<JungleFlipSquare>(uci, /[a-d][1-4]/),
  });
}
