// The position a study card's thumbnail draws: chapter 1's board, derived once
// here so the card, the homepage widget and (eventually) the OG card agree on
// what a study "looks like".
//
// A composition IS its diagram, so a chapter that carries a `rootFen` draws it
// as-is (the same rule og-image.ts applies). A xiangqi game from the standard
// start would make every game collection show the identical opening array, so
// those draw the position after the first STUDY_PREVIEW_PLIES mainline plies
// instead: each collection then shows its own first game's opening. Replay stops
// at the first move the kernel refuses, keeping whatever was reached, so a
// corrupt mainline degrades to a shallower board rather than no board.
//
// Every study-eligible variant derives a board (#710). What leaves this module
// is a grid of discs, not a position: one character per cell saying only
// "empty", "a red (white) piece", "a black piece", "a face-down piece" or "the
// duck". No role is ever read, so a dealt variant's stored root (whose sixth
// field pins the hidden assignment under every face-down tile) cannot leak
// through a thumbnail: a face-down tile stays a face-down disc, and in banqi and
// flip jungle, where a face-down tile's colour is hidden too, it carries none.
// Plain xiangqi keeps its `fen` alongside, for consumers that parse it.
//
// Variants other than xiangqi and fog xiangqi draw their root position (the
// rootFen, else the variant's standard start) without replaying the mainline: a
// dealt variant's root is exactly the position its FEN states, face-down tiles
// and all, and the other kernels' move spellings are not worth a second parser
// for a 48px picture.
//
// Dispatch is fail-closed: a variant this module does not know gets no grid
// (the client falls back to its marker), never another variant's board.
import {
  ATOMIC_XIANGQI_SPEC_ID,
  applyStandardXiangqiMove,
  BANQI_SPEC_ID,
  CHESS_SPEC_ID,
  CRAZYHOUSE_XIANGQI_SPEC_ID,
  createInitialBanqiState,
  createInitialCrazyhouseXiangqiState,
  createInitialDuckXiangqiState,
  createInitialFortressXiangqiState,
  createInitialJieqiState,
  createInitialJungleFlipState,
  createInitialJungleState,
  createInitialThreeKingdomsBanqiState,
  createInitialXiangqiState,
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  FORTRESS_XIANGQI_SPEC_ID,
  fsfUciToXiangqiSquares,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  parseBanqiFen,
  parseCrazyhouseXiangqiFen,
  parseDarkChessFen,
  parseDuckXiangqiFen,
  parseFortressXiangqiFen,
  parseJieqiFen,
  parseJungleFen,
  parseJungleFlipFen,
  parseStandardChessFen,
  parseStandardXiangqiFen,
  parseThreeKingdomsBanqiFen,
  standardXiangqiFen,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  XIANGQI_SPEC_ID,
  type XiangqiGameState,
} from '@mistboard/game';

export const STUDY_PREVIEW_PLIES = 8;

/** Which board the client draws under the discs. */
export type StudyPreviewShape =
  | 'xiangqi' // 9x10 points, river and palaces
  | 'fortress' // 7x8 points
  | 'chess' // 8x8 checkered squares
  | 'jungle' // 7x9 squares with the two rivers
  | 'banqi' // 8x4 squares
  | 'jungle-flip' // 4x4 squares
  | 'three-kingdoms-banqi'; // 9x5 points

/**
 * One character per cell, rows from the top rank down, files left to right:
 * '.' empty, 'r' red (white in chess), 'b' black, 'R' / 'B' a face-down piece
 * whose side is public (jieqi), '?' a face-down tile of hidden colour (banqi,
 * flip jungle, three kingdoms banqi), 'd' the duck.
 */
export type StudyPreviewGrid = {
  shape: StudyPreviewShape;
  files: number;
  ranks: number;
  cells: string;
};

export type StudyPreviewBoard = {
  variant: string;
  /** Plain xiangqi only: the position as a standard FEN. */
  fen: string | null;
  /** The drawable board, or null when none could be derived. */
  grid: StudyPreviewGrid | null;
};

/** Shape of the `preview_board` jsonb the list queries build for chapter 1. */
export type StudyPreviewSource = {
  variant: string;
  rootFen: string | null;
  /** First mainline plies as stored (FSF-style uci: 'h3e3'), at most STUDY_PREVIEW_PLIES. */
  mainline: string[];
};

type DiscPiece = { color: string; faceDown?: boolean };
type SquareBoard = Partial<Record<string, DiscPiece>>;

const XIANGQI_FILES = 'abcdefghi';
const CHESS_FILES = 'abcdefgh';
const JUNGLE_FILES = 'abcdefg';
const FORTRESS_FILES = 'abcdefg';
const BANQI_FILES = 'abcdefgh';
const JUNGLE_FLIP_FILES = 'abcd';
const THREE_KINGDOMS_BANQI_FILES = 'abcdefghi';
const CHESS_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PREVIEW_ID = 'study-preview';

// A five-field dealt FEN samples its hidden identities while parsing; the grid
// never reads them, and a fixed generator keeps the parse deterministic.
const fixedRng = () => 0;

export function studyPreviewBoard(source: unknown): StudyPreviewBoard | null {
  const parsed = readSource(source);
  if (!parsed) return null;
  const { variant, rootFen, mainline } = parsed;
  switch (variant) {
    case XIANGQI_SPEC_ID: {
      const state = xiangqiPreviewState(rootFen, mainline, false);
      return {
        variant,
        fen: state ? standardXiangqiFen(state) : null,
        grid: state ? squareGrid('xiangqi', XIANGQI_FILES, 10, state.board) : null,
      };
    }
    case DARK_XIANGQI_SPEC_ID: {
      // Same board and moves as xiangqi; under fog a general may stand en prise.
      const state = xiangqiPreviewState(rootFen, mainline, true);
      return withGrid(variant, state && squareGrid('xiangqi', XIANGQI_FILES, 10, state.board));
    }
    case ATOMIC_XIANGQI_SPEC_ID: {
      // Root only: a capture explodes, which the standard kernel would not replay.
      const state =
        rootFen === null
          ? createInitialXiangqiState(PREVIEW_ID)
          : parseOk(parseStandardXiangqiFen(rootFen, PREVIEW_ID));
      return withGrid(variant, state && squareGrid('xiangqi', XIANGQI_FILES, 10, state.board));
    }
    case CRAZYHOUSE_XIANGQI_SPEC_ID: {
      // The board only; the hands in the FEN's brackets are not drawn.
      const state =
        rootFen === null
          ? createInitialCrazyhouseXiangqiState(PREVIEW_ID)
          : parseOk(parseCrazyhouseXiangqiFen(rootFen, PREVIEW_ID));
      return withGrid(variant, state && squareGrid('xiangqi', XIANGQI_FILES, 10, state.board));
    }
    case DUCK_XIANGQI_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialDuckXiangqiState(PREVIEW_ID)
          : parseOk(parseDuckXiangqiFen(rootFen, PREVIEW_ID));
      if (!state) return withGrid(variant, null);
      const grid = squareGrid('xiangqi', XIANGQI_FILES, 10, state.board);
      return withGrid(variant, state.duck ? markCell(grid, XIANGQI_FILES, state.duck, 'd') : grid);
    }
    case JIEQI_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialJieqiState(PREVIEW_ID)
          : parseOk(parseJieqiFen(rootFen, { rng: fixedRng }));
      return withGrid(
        variant,
        state && squareGrid('xiangqi', XIANGQI_FILES, 10, state.board, 'side'),
      );
    }
    case FORTRESS_XIANGQI_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialFortressXiangqiState(PREVIEW_ID)
          : parseOk(parseFortressXiangqiFen(rootFen, PREVIEW_ID));
      return withGrid(variant, state && squareGrid('fortress', FORTRESS_FILES, 8, state.board));
    }
    case CHESS_SPEC_ID:
    case DARK_CHESS_SPEC_ID: {
      const fen = rootFen ?? CHESS_START_FEN;
      const state = parseOk(
        variant === CHESS_SPEC_ID
          ? parseStandardChessFen(fen, PREVIEW_ID)
          : parseDarkChessFen(fen, PREVIEW_ID),
      );
      return withGrid(variant, state && squareGrid('chess', CHESS_FILES, 8, state.board));
    }
    case JUNGLE_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialJungleState(PREVIEW_ID)
          : parseOk(parseJungleFen(rootFen, PREVIEW_ID));
      return withGrid(variant, state && squareGrid('jungle', JUNGLE_FILES, 9, state.board));
    }
    case BANQI_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialBanqiState(PREVIEW_ID)
          : parseOk(parseBanqiFen(rootFen, { rng: fixedRng }));
      return withGrid(variant, state && squareGrid('banqi', BANQI_FILES, 4, state.board));
    }
    case JUNGLE_FLIP_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialJungleFlipState(PREVIEW_ID)
          : parseOk(parseJungleFlipFen(rootFen, { rng: fixedRng }));
      return withGrid(
        variant,
        state && squareGrid('jungle-flip', JUNGLE_FLIP_FILES, 4, state.board),
      );
    }
    case THREE_KINGDOMS_BANQI_SPEC_ID: {
      const state =
        rootFen === null
          ? createInitialThreeKingdomsBanqiState(PREVIEW_ID, fixedRng)
          : parseOk(parseThreeKingdomsBanqiFen(rootFen, { rng: fixedRng }));
      return withGrid(
        variant,
        state && squareGrid('three-kingdoms-banqi', THREE_KINGDOMS_BANQI_FILES, 5, state.board),
      );
    }
    default:
      return { variant, fen: null, grid: null };
  }
}

/** Xiangqi (or fog xiangqi) root, or the standard start replayed to the preview
 *  ply. A present-but-unparseable rootFen is a failure, not an absence: falling
 *  through to the standard start would draw a board the study does not hold. */
function xiangqiPreviewState(
  rootFen: string | null,
  mainline: string[],
  allowExposedGeneral: boolean,
): XiangqiGameState | null {
  if (rootFen !== null) {
    return parseOk(parseStandardXiangqiFen(rootFen, PREVIEW_ID, { allowExposedGeneral }));
  }
  let state = createInitialXiangqiState(PREVIEW_ID);
  for (const uci of mainline.slice(0, STUDY_PREVIEW_PLIES)) {
    const move = fsfUciToXiangqiSquares(uci);
    if (!move) break;
    const next = applyStandardXiangqiMove(state, move);
    if (next === state) break;
    state = next;
  }
  return state;
}

function parseOk<S>(result: { ok: true; state: S } | { ok: false; error: string }): S | null {
  return result.ok ? result.state : null;
}

function withGrid(variant: string, grid: StudyPreviewGrid | null): StudyPreviewBoard {
  return { variant, fen: null, grid };
}

/**
 * Read a square-keyed board ('a1'.., rank 1 at the bottom) into the cell string.
 * `faceDown` says what a face-down piece may show: 'side' keeps its colour
 * (jieqi, whose dark pieces start on their own side's home squares), 'hidden'
 * drops it (banqi, flip jungle, three kingdoms banqi). The role is never read either way.
 */
function squareGrid(
  shape: StudyPreviewShape,
  files: string,
  ranks: number,
  board: object,
  faceDown: 'side' | 'hidden' = 'hidden',
): StudyPreviewGrid {
  const squares = board as SquareBoard;
  let cells = '';
  for (let rank = ranks; rank >= 1; rank -= 1) {
    for (const file of files) {
      const piece = squares[`${file}${rank}`];
      cells += piece ? discChar(piece, faceDown) : '.';
    }
  }
  return { shape, files: files.length, ranks, cells };
}

function discChar(piece: DiscPiece, faceDown: 'side' | 'hidden'): string {
  if (piece.faceDown) {
    if (faceDown === 'hidden') return '?';
    return piece.color === 'black' ? 'B' : 'R';
  }
  return piece.color === 'black' ? 'b' : 'r';
}

function markCell(
  grid: StudyPreviewGrid,
  files: string,
  square: string,
  mark: string,
): StudyPreviewGrid {
  const file = files.indexOf(square.charAt(0));
  const rank = Number(square.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > grid.ranks) return grid;
  const index = (grid.ranks - rank) * grid.files + file;
  return { ...grid, cells: grid.cells.slice(0, index) + mark + grid.cells.slice(index + 1) };
}

function readSource(raw: unknown): StudyPreviewSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const { variant, rootFen, mainline } = raw as Record<string, unknown>;
  if (typeof variant !== 'string') return null;
  return {
    variant,
    rootFen: typeof rootFen === 'string' ? rootFen : null,
    mainline: Array.isArray(mainline)
      ? mainline.filter((m): m is string => typeof m === 'string')
      : [],
  };
}
