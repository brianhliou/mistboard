// What a puzzle detail carries from its stored source game (standard xiangqi
// mined puzzles, whose source lives in historical_xiangqi_games):
//
// - `setupMove`: the opponent's setup move with the piece it captured, so the
//   trainer can show the board one move earlier and glide it in (#664).
// - `history`: the game's moves BEFORE the setup move, so the move list can
//   show how the game reached the puzzle, as lichess does. Never a move at or
//   past the puzzle's start: the game's continuation is the solution (or the
//   blunder's refutation) and would spoil it.
// - `sourceGame` with the row's player names and `hosted: true`, so the "From
//   game" card names the players the game page names and links to that page.
//   The names stored on the puzzle are copied at mine time, and the source
//   dump re-pseudonymizes players on each release, so the row is the truth.
// - English forms of the event and both player names (`eventEn`,
//   `redNameEn`, `blackNameEn`), from the broadcast translators, so an English
//   page reads no Chinese; the originals stay for the Chinese pages.
//
// One query per source game, cached for the process lifetime (puzzle rows and
// source games do not change under a served id). Persistence off (seed only),
// a missing row, or a row that disagrees with `initial` give no setup move and
// no history; the puzzle works as before. A private row (the by-id game route
// 404s it) gives neither history nor names nor a link. Additive and fail-soft:
// an error never fails the detail route.

import {
  deriveXiangqiPuzzleSetupMove,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
} from '@mistboard/game';
import type { HistoricalXiangqiVisibility } from './persistence-historical-xiangqi.js';
import {
  romanizeXiangqiPlayerName,
  translateXiangqiEventName,
  translateXiangqiTeamName,
} from './xiangqi-broadcast-translate.js';

export type PuzzleSourceGameRow = {
  moves: readonly XiangqiMove[];
  redNameRaw: string | null;
  blackNameRaw: string | null;
  visibility: HistoricalXiangqiVisibility;
};

export type SourceGameLoader = (gameId: string) => Promise<PuzzleSourceGameRow | null>;

type SourceGame = NonNullable<XiangqiPuzzle['sourceGame']>;

export type PuzzleDetailSourceGame = SourceGame & {
  hosted?: true;
  eventEn?: string;
  redNameEn?: string;
  blackNameEn?: string;
};

export type PuzzleDetailSourceFields = {
  sourceGame?: PuzzleDetailSourceGame;
  setupMove?: XiangqiPuzzleSetupMove;
  history?: XiangqiMove[];
};

type SourceContext = {
  setupMove: XiangqiPuzzleSetupMove | null;
  history: XiangqiMove[] | null;
  // The row's names, when the row exists and is not private.
  names: { redName: string | null; blackName: string | null } | null;
};

// Bounded well above the mined corpus (1,589 puzzles on 2026-10-28). An entry
// holds at most one game's moves before its puzzle, a few KB.
const CACHE_LIMIT = 4096;
const cache = new Map<string, SourceContext>();

export function resetPuzzleSetupMoveCacheForTests(): void {
  cache.clear();
}

async function sourceContext(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'initial' | 'sourceGame'>,
  load: SourceGameLoader,
): Promise<SourceContext | null> {
  const source = puzzle.sourceGame;
  if (!source) return null;
  const cached = cache.get(puzzle.id);
  if (cached) return cached;
  let row: PuzzleSourceGameRow | null;
  try {
    row = await load(source.gameId);
  } catch {
    // Transient (pool, network): answer without the fields and retry next time.
    return null;
  }
  const setupMove =
    row && puzzle.initial.lastMove ? deriveXiangqiPuzzleSetupMove(puzzle, row.moves) : null;
  const listed = row !== null && row.visibility !== 'private';
  const context: SourceContext = {
    setupMove,
    // Only behind a verified setup move: the first `ply` moves then replay
    // legally from the opening to exactly `initial`, and the history is the
    // first `ply - 1` of them, one short of the puzzle position.
    history: row && setupMove && listed ? row.moves.slice(0, source.ply - 1).map(copyMove) : null,
    names: row && listed ? { redName: row.redNameRaw, blackName: row.blackNameRaw } : null,
  };
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(puzzle.id, context);
  return context;
}

function copyMove(move: XiangqiMove): XiangqiMove {
  return { from: move.from, to: move.to };
}

/**
 * The source-game fields of a standard-xiangqi puzzle detail. `load` is null
 * when nothing is stored (persistence off): the stored attribution then goes
 * out as it is, unlinked.
 */
export async function puzzleDetailSourceFields(
  puzzle: Pick<XiangqiPuzzle, 'id' | 'initial' | 'sourceGame'>,
  load: SourceGameLoader | null,
): Promise<PuzzleDetailSourceFields> {
  const stored = puzzle.sourceGame;
  if (!stored) return {};
  const context = load ? await sourceContext(puzzle, load) : null;
  const fields: PuzzleDetailSourceFields = { sourceGame: withEnglishNames(stored) };
  if (!context) return fields;
  if (context.names) {
    const { redName: _staleRed, blackName: _staleBlack, ...rest } = stored;
    fields.sourceGame = withEnglishNames({
      ...rest,
      ...(context.names.redName ? { redName: context.names.redName } : {}),
      ...(context.names.blackName ? { blackName: context.names.blackName } : {}),
      hosted: true,
    });
  }
  if (context.setupMove) fields.setupMove = context.setupMove;
  if (context.history && context.history.length > 0) fields.history = context.history;
  return fields;
}

// Han characters and the full-width punctuation that travels with them.
const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

function englishOnly(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  return trimmed && !CJK.test(trimmed) ? trimmed : undefined;
}

/**
 * A source-game player as an English page shows it. The archive writes the
 * team first and the player last ("山东省棋牌运动管理中心 黄蕾蕾"), so the
 * last token is romanized as a name (scoped by the team, as broadcasts scope by
 * federation) and the rest translated as a team: "Huang Leilei (Shandong Board
 * Games Centre)". A team the glossary leaves with Chinese in it is dropped
 * rather than shown half translated. Undefined when the name has no Chinese.
 */
export function englishSourcePlayerName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!CJK.test(trimmed)) return undefined;
  const tokens = trimmed.split(/\s+/u);
  // The player is the last token, or every trailing Latin token when the
  // player is written in Latin letters ("金州 Son X Nguyen").
  let start = tokens.length - 1;
  if (!CJK.test(tokens[start] ?? '')) {
    while (start > 0 && !CJK.test(tokens[start - 1] ?? '')) start -= 1;
  }
  const player = tokens.slice(start).join(' ');
  const team = tokens.slice(0, start).join(' ');
  const name =
    (CJK.test(player)
      ? englishOnly(romanizeXiangqiPlayerName(player, team || undefined))
      : englishOnly(player)) ?? englishOnly(romanizeXiangqiPlayerName(trimmed));
  if (!name) return undefined;
  const teamEn = team ? englishOnly(translateXiangqiTeamName(team)) : undefined;
  return teamEn ? `${name} (${teamEn})` : name;
}

function withEnglishNames(source: PuzzleDetailSourceGame): PuzzleDetailSourceGame {
  const { eventEn: _staleEvent, redNameEn: _staleRed, blackNameEn: _staleBlack, ...rest } = source;
  const eventEn = source.event ? englishOnly(translateXiangqiEventName(source.event)) : undefined;
  const redNameEn = source.redName ? englishSourcePlayerName(source.redName) : undefined;
  const blackNameEn = source.blackName ? englishSourcePlayerName(source.blackName) : undefined;
  return {
    ...rest,
    ...(eventEn ? { eventEn } : {}),
    ...(redNameEn ? { redNameEn } : {}),
    ...(blackNameEn ? { blackNameEn } : {}),
  };
}
