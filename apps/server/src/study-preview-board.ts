// The position a study card's thumbnail draws: chapter 1's board, derived once
// here so the card, the homepage widget and (eventually) the OG card agree on
// what a study "looks like".
//
// A composition IS its diagram, so a chapter that carries a `rootFen` draws it
// as-is (the same rule og-image.ts applies). A game from the standard start
// would make every game collection show the identical opening array, so those
// draw the position after the first STUDY_PREVIEW_PLIES mainline plies instead:
// each collection then shows its own first game's opening. Replay stops at the
// first move the kernel refuses, keeping whatever was reached, so a corrupt
// mainline degrades to a shallower board rather than no board.
//
// Only plain xiangqi derives a board today. The other study variants carry
// their own FEN dialects (a duck, treasures, dealt hidden pieces) and get a
// null fen; the client draws its variant tile from `variant` for those.
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  fsfUciToXiangqiSquares,
  parseStandardXiangqiFen,
  standardXiangqiFen,
} from '@mistboard/game';

export const STUDY_PREVIEW_PLIES = 8;

export type StudyPreviewBoard = { variant: string; fen: string | null };

/** Shape of the `preview_board` jsonb the list queries build for chapter 1. */
export type StudyPreviewSource = {
  variant: string;
  rootFen: string | null;
  /** First mainline plies as stored (FSF-style uci: 'h3e3'), at most STUDY_PREVIEW_PLIES. */
  mainline: string[];
};

export function studyPreviewBoard(source: unknown): StudyPreviewBoard | null {
  const parsed = readSource(source);
  if (!parsed) return null;
  const { variant } = parsed;
  if (variant !== 'xiangqi') return { variant, fen: null };

  if (parsed.rootFen !== null) {
    // Present-but-unparseable is a failure, not an absence: falling through to
    // the standard start would draw a board the study does not hold.
    const result = parseStandardXiangqiFen(parsed.rootFen, 'study-preview');
    return { variant, fen: result.ok ? standardXiangqiFen(result.state) : null };
  }

  let state = createInitialXiangqiState('study-preview');
  for (const uci of parsed.mainline.slice(0, STUDY_PREVIEW_PLIES)) {
    const move = fsfUciToXiangqiSquares(uci);
    if (!move) break;
    const next = applyStandardXiangqiMove(state, move);
    if (next === state) break;
    state = next;
  }
  return { variant, fen: standardXiangqiFen(state) };
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
