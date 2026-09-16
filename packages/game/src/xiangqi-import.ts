// Format-agnostic import of a standard-xiangqi game into canonical moves.
//
// Xiangqi move notation is fragmented (coordinate, engine UCI, WXF/human,
// Chinese, DhtmlXQ records), so we do NOT ask the user to pick one: every format
// is a codec that normalizes down to our canonical XiangqiMove ({from,to}), and
// a legality-guided sniffer picks the codec whose moves actually replay into a
// legal game from the standard opening. That single trick resolves the two hard
// ambiguities at once: coordinate 1-indexed vs 0-indexed (the same token string
// is valid in both, only one replays legally), and relative-notation
// disambiguation (WXF/Chinese need the board to know WHICH piece moves).
//
// resolveMove is board-aware for that reason; coordinate codecs ignore the state.

import {
  coordOf,
  createInitialXiangqiState,
  positionRepetitionKey,
  squareOf,
  type XiangqiBoard,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from './variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
  isStandardXiangqiLegalMove,
} from './variants-xiangqi-standard.js';
import {
  parseChineseToken,
  parseWxfToken,
  resolveRelativeMove,
  WXF_LETTER_TO_ROLE,
  WXF_TOKEN,
} from './xiangqi-relative-notation.js';
import { fsfUciToXiangqiSquares, pikafishUciToXiangqiSquares } from './xiangqi-uci.js';

export type XiangqiMoveFormat =
  | 'coordinate' // our square notation = Fairy-Stockfish UCI: files a-i, ranks 1-10
  | 'uci-0indexed' // Pikafish / UCCI / ICCS style: files a-i, ranks 0-9
  | 'algebraic' // chess-style SAN: Ce3, Hc3, Cxe7, Rhe1
  | 'wxf' // WXF / human relative notation: C2.5, H2+3, +C.5
  | 'chinese' // Chinese relative notation: 炮二平五, 马8进7, 前炮平五
  | 'dhtmlxq'; // dpxq.com / dhtmlxq packed record: 4 digits per move

export interface XiangqiImportResult {
  moves: XiangqiMove[];
  /** The format that replayed legally, or null when nothing matched. */
  format: XiangqiMoveFormat | null;
  /** Set when no codec produced a fully-legal game; the most useful reason. */
  error?: string;
  /** The position the moves replay from, when it is not the standard opening:
   *  a caller-supplied initialState, or a [DhtmlXQ_binit] custom start. Callers
   *  that render the game need this, or they draw the wrong board. */
  initialState?: XiangqiGameState;
}

// A codec turns one notation into canonical moves. detect() is a cheap
// whole-input shape gate that narrows candidates before the (more expensive)
// legality replay; resolveMove() decodes one token, board-aware so relative
// notations can disambiguate against the legal move set.
interface XiangqiNotationCodec {
  format: XiangqiMoveFormat;
  detect(input: string): boolean;
  tokenize(input: string): string[];
  resolveMove(token: string, state: XiangqiGameState): XiangqiMove | null;
}

const MOVE_NUMBER = /^\d+\.?$/; // "1." / "23" ordinals, dropped

// Whitespace/comma separated, minus bare move-number ordinals.
function splitTokens(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !MOVE_NUMBER.test(token));
}

const COORD1_MOVE = /^[a-i](?:10|[1-9])-?[a-i](?:10|[1-9])$/;
const coordinate1Codec: XiangqiNotationCodec = {
  format: 'coordinate',
  detect: (input) => {
    const tokens = splitTokens(input);
    return tokens.length > 0 && tokens.every((token) => COORD1_MOVE.test(token));
  },
  tokenize: splitTokens,
  resolveMove: (token) => {
    const squares = fsfUciToXiangqiSquares(token.replace(/-/g, ''));
    return squares ? { from: squares.from, to: squares.to } : null;
  },
};

const COORD0_MOVE = /^[a-i][0-9]-?[a-i][0-9]$/;
const coordinate0Codec: XiangqiNotationCodec = {
  format: 'uci-0indexed',
  detect: (input) => {
    const tokens = splitTokens(input);
    return tokens.length > 0 && tokens.every((token) => COORD0_MOVE.test(token));
  },
  tokenize: splitTokens,
  resolveMove: (token) => {
    const squares = pikafishUciToXiangqiSquares(token.replace(/-/g, ''));
    return squares ? { from: squares.from, to: squares.to } : null;
  },
};

// --- algebraic (chess-style SAN) ---------------------------------------------
// The display formatter's grammar (xiangqi-notation-format.ts): piece letter,
// optional origin file / rank / square, optional `x`, destination square,
// optional `+`/`#`. Resolved against the legal move set, so a token that names
// more than one move (a missing disambiguator) is rejected rather than guessed.

const ALGEBRAIC_MOVE = /^([KAEBHNRCP])([a-i])?(10|[1-9])?(x)?([a-i](?:10|[1-9]))[+#]?$/;

const algebraicCodec: XiangqiNotationCodec = {
  format: 'algebraic',
  detect: (input) => {
    const tokens = splitTokens(input);
    return tokens.length > 0 && tokens.every((token) => ALGEBRAIC_MOVE.test(token));
  },
  tokenize: splitTokens,
  resolveMove: (token, state) => {
    const match = ALGEBRAIC_MOVE.exec(token);
    if (!match || state.status.type !== 'playing') return null;
    const role = WXF_LETTER_TO_ROLE[match[1]!];
    const originFile = match[2];
    const originRank = match[3] ? Number(match[3]) : undefined;
    const to = match[5] as XiangqiSquare;
    const candidates = getStandardXiangqiLegalMoves(state).filter((move) => {
      if (move.to !== to || state.board[move.from]?.role !== role) return false;
      const from = coordOf(move.from);
      if (originFile && move.from[0] !== originFile) return false;
      if (originRank !== undefined && from.rank !== originRank) return false;
      return true;
    });
    return candidates.length === 1 ? candidates[0]! : null;
  },
};

// --- relative notation (WXF + Chinese) ---------------------------------------
// The shared spec model, board-aware resolver, and token grammars live in
// xiangqi-relative-notation.ts, where the display formatter also reads them, so
// parse and format can never drift apart.

const wxfCodec: XiangqiNotationCodec = {
  format: 'wxf',
  detect: (input) => {
    const tokens = splitTokens(input);
    return tokens.length > 0 && tokens.every((token) => WXF_TOKEN.test(token));
  },
  tokenize: splitTokens,
  resolveMove: (token, state) => {
    const spec = parseWxfToken(token);
    return spec ? resolveRelativeMove(state, spec) : null;
  },
};

// --- Chinese codec -----------------------------------------------------------
// Token grammar shared via xiangqi-relative-notation.ts; this codec owns only
// the record-level cleaning and 4-character chunking.

// Drop move-number ordinals (digits + period), CJK punctuation, and inline
// capture glosses (士去 etc.), leaving a run of 4-character moves. Classical
// woodblock records interleave all three with the moves; 去 never occurs inside
// a move token (the operators are 进/退/平), so a <piece>去 pair is always a
// gloss, not notation.
const CN_CAPTURE_GLOSS = /[车車马馬相象仕士帅将帥將炮砲包兵卒]去/g;
const CJK_PUNCTUATION = /[。．、，；：！？（）「」『』]/g;
function chineseCleaned(input: string): string {
  return input
    .replace(/\d+\./g, '')
    .replace(CN_CAPTURE_GLOSS, '')
    .replace(CJK_PUNCTUATION, '')
    .replace(/[\s,]+/g, '');
}

function chineseChunks(input: string): string[] {
  const cleaned = chineseCleaned(input);
  const chunks: string[] = [];
  for (let i = 0; i + 4 <= cleaned.length; i += 4) chunks.push(cleaned.slice(i, i + 4));
  return chunks;
}

const chineseCodec: XiangqiNotationCodec = {
  format: 'chinese',
  detect: (input) => {
    const cleaned = chineseCleaned(input);
    if (cleaned.length === 0 || cleaned.length % 4 !== 0) return false;
    const chunks = chineseChunks(input);
    return chunks.length > 0 && chunks.every((token) => parseChineseToken(token) !== null);
  },
  tokenize: chineseChunks,
  resolveMove: (token, state) => {
    const spec = parseChineseToken(token);
    return spec ? resolveRelativeMove(state, spec) : null;
  },
};

// --- DhtmlXQ codec -----------------------------------------------------------
// dpxq.com / dhtmlxq records pack each move as 4 digits: fromCol fromRow toCol
// toRow, columns 0-8 left-to-right (= our file index) and rows 0-9 with row 0 at
// black's top, so our rank is 10 - row. Confirmed against the dpxq clipboard
// writer (GGchessQi) and anchored by 炮二平五 = h3->e3 = "7747". Accepts either a
// raw movelist digit string or a full [DhtmlXQ_movelist]...[ block.
//
// [DhtmlXQ_binit] carries the starting position, which classical endgame
// compositions depend on. It is 32 two-digit pairs in a FIXED piece order, one
// per piece of the standard array, holding that piece's square as colRow, with
// '99' for a piece that is off the board. The order was read off the standard
// position's own binit rather than assumed, and checked by replaying 82 real
// compositions from their own published solutions: all 82 were legal to the
// last ply. Without this, every composition replays onto the opening position.

// One entry per piece of the standard array, in binit order.
const DHTMLXQ_BACK_RANK: readonly XiangqiPieceRole[] = [
  'chariot',
  'horse',
  'elephant',
  'advisor',
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
];

const DHTMLXQ_SLOTS: readonly (readonly ['red' | 'black', XiangqiPieceRole])[] = (
  ['red', 'black'] as const
).flatMap((color) => [
  ...DHTMLXQ_BACK_RANK.map((role) => [color, role] as const),
  [color, 'cannon'] as const,
  [color, 'cannon'] as const,
  ...([0, 1, 2, 3, 4] as const).map(() => [color, 'soldier'] as const),
]);

/** Decode a [DhtmlXQ_binit] starting position. Returns null when the string is
 *  not 64 digits or does not describe a playable position (both generals). */
export function xiangqiBoardFromDhtmlxqBinit(binit: string): XiangqiBoard | null {
  const digits = binit.match(/\[DhtmlXQ_binit\]([^[]*)/i)?.[1]?.replace(/\D/g, '') ?? binit;
  if (!/^\d{64}$/.test(digits)) return null;
  const board: XiangqiBoard = {};
  let generals = 0;
  for (let i = 0; i < 32; i++) {
    const pair = digits.slice(i * 2, i * 2 + 2);
    const file = Number(pair[0]);
    const row = Number(pair[1]);
    // '99' is the off-board sentinel; anything else out of range is malformed.
    if (file > 8 || row > 9) continue;
    const slot = DHTMLXQ_SLOTS[i];
    if (!slot) continue;
    const [color, role] = slot;
    if (role === 'general') generals++;
    board[squareOf(file, 10 - row)] = { color, role };
  }
  return generals === 2 ? board : null;
}

function dhtmlxqStateFromBinit(input: string): XiangqiGameState | null {
  const board = xiangqiBoardFromDhtmlxqBinit(input);
  if (!board) return null;
  const base: XiangqiGameState = {
    id: 'import',
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
  return { ...base, positionCounts: { [positionRepetitionKey(base)]: 1 } };
}

function dhtmlxqDigits(input: string): string {
  const tag = input.match(/\[DhtmlXQ_movelist\]([^[]*)/i);
  return (tag ? tag[1]! : input).replace(/\D/g, '');
}

function dhtmlxqChunks(input: string): string[] {
  const digits = dhtmlxqDigits(input);
  const chunks: string[] = [];
  for (let i = 0; i + 4 <= digits.length; i += 4) chunks.push(digits.slice(i, i + 4));
  return chunks;
}

function decodeDhtmlxqMove(token: string): XiangqiMove | null {
  if (!/^\d{4}$/.test(token)) return null;
  const fromCol = Number(token[0]);
  const fromRow = Number(token[1]);
  const toCol = Number(token[2]);
  const toRow = Number(token[3]);
  if (fromCol > 8 || toCol > 8) return null; // columns are 0-8; rows 0-9 always fit
  const file = (col: number): string => String.fromCharCode(97 + col); // 'a' + col
  return {
    from: `${file(fromCol)}${10 - fromRow}` as XiangqiSquare,
    to: `${file(toCol)}${10 - toRow}` as XiangqiSquare,
  };
}

const dhtmlxqCodec: XiangqiNotationCodec = {
  format: 'dhtmlxq',
  detect: (input) => {
    const digits = dhtmlxqDigits(input);
    return digits.length >= 4 && digits.length % 4 === 0;
  },
  tokenize: dhtmlxqChunks,
  resolveMove: (token) => decodeDhtmlxqMove(token),
};

// Priority order. Distinctive notations (Chinese CJK chars, WXF piece letters +
// operators, DhtmlXQ pure digits) go first; the two coordinate codecs overlap for
// ranks 1-9, and coordinate (1-indexed, our native) is tried before uci-0indexed
// so a game legal under both is read as ours. A rank-10 token is unambiguously
// 1-indexed (fails the 0-indexed shape) and a rank-0 token is unambiguously
// 0-indexed, so only the genuinely-ambiguous middle needs the legality tiebreak.
const CODECS: XiangqiNotationCodec[] = [
  chineseCodec,
  wxfCodec,
  algebraicCodec,
  dhtmlxqCodec,
  coordinate1Codec,
  coordinate0Codec,
];

export interface XiangqiImportOptions {
  /** Replay from here instead of the standard opening. Set by the PGN reader
   *  when a [FEN] tag names a custom start, which is how classical endgame
   *  compositions are recorded. */
  initialState?: XiangqiGameState;
}

/** Parse a pasted game in any supported notation into canonical moves. Returns
 *  the detected format, or an error when nothing replays legally. */
export function importXiangqiGame(
  input: string,
  options: XiangqiImportOptions = {},
): XiangqiImportResult {
  const trimmed = input.trim();
  if (!trimmed) return { moves: [], format: null, error: 'Enter a game to import.' };
  // An explicit initialState wins; otherwise a DhtmlXQ record may carry its own
  // start. binit appears only in DhtmlXQ records, so this cannot disturb the
  // other codecs.
  const start = options.initialState ?? dhtmlxqStateFromBinit(trimmed) ?? undefined;
  let firstError: string | undefined;
  for (const codec of CODECS) {
    if (!codec.detect(trimmed)) continue;
    const attempt = replayWithCodec(codec, trimmed, start);
    if (attempt.moves.length > 0 && !attempt.error) {
      return start
        ? { moves: attempt.moves, format: codec.format, initialState: start }
        : { moves: attempt.moves, format: codec.format };
    }
    firstError ??= attempt.error;
  }
  return { moves: [], format: null, error: firstError ?? 'Unrecognized move notation.' };
}

// Fold a codec's tokens through the rules engine; a token that does not resolve
// to a legal move fails the whole codec (so the sniffer moves on to the next).
function replayWithCodec(
  codec: XiangqiNotationCodec,
  input: string,
  initialState?: XiangqiGameState,
): { moves: XiangqiMove[]; error?: string } {
  const tokens = codec.tokenize(input);
  if (tokens.length === 0) return { moves: [], error: 'No moves found.' };
  let state = initialState ?? createInitialXiangqiState('import');
  const moves: XiangqiMove[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const move = codec.resolveMove(token, state);
    if (!move || state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move)) {
      return { moves, error: `Move ${index + 1} ("${token}") is not legal as ${codec.format}.` };
    }
    state = applyStandardXiangqiMove(state, move);
    moves.push(move);
  }
  return { moves };
}

// --- per-format resolution (for callers that already know the notation) ------
// The PGN reader sniffs the format once from the mainline, then walks a move
// TREE: a variation's tokens must resolve against the position at their branch
// point, not against the mainline. That needs one token decoded at a time in a
// known format, which the sniffer above never has to expose.

const CODECS_BY_FORMAT: ReadonlyMap<XiangqiMoveFormat, XiangqiNotationCodec> = new Map(
  CODECS.map((codec) => [codec.format, codec]),
);

/** Decode a single token in a known notation against a known position. Returns
 *  null when the token is unreadable OR resolves to an illegal move, so callers
 *  get one rejection path rather than two. */
export function resolveXiangqiMoveInFormat(
  token: string,
  state: XiangqiGameState,
  format: XiangqiMoveFormat,
): XiangqiMove | null {
  const codec = CODECS_BY_FORMAT.get(format);
  if (!codec || state.status.type !== 'playing') return null;
  const move = codec.resolveMove(token, state);
  if (!move || !isStandardXiangqiLegalMove(state, move)) return null;
  return move;
}
