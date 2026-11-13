import {
  validateStandardXiangqiPuzzle,
  XIANGQI_PUZZLE_THEMES,
  type XiangqiPuzzle,
} from './puzzles-xiangqi.js';
import { xiangqiPuzzleHasStartingChoice, xiangqiPuzzleTitle } from './puzzles-xiangqi-mining.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(
  value: unknown,
  allowed: string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    throw new Error(`Invalid position-only ${label} fields`);
}

function text(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max
  );
}

/** Fail closed rather than stripping a planted source game or nested history.
 * Rebuild the permitted shape so every public serving path sees the same data. */
export function readXiangqiPositionOnlyPuzzle(value: unknown): XiangqiPuzzle {
  fields(
    value,
    ['id', 'variant', 'title', 'initial', 'solution', 'goal', 'themes', 'credit'],
    'puzzle',
  );
  if (!text(value.id, 200) || value.variant !== 'xiangqi')
    throw new Error('Invalid position-only identity');
  const state = value.initial;
  fields(
    state,
    [
      'id',
      'board',
      'status',
      'moveNumber',
      'progressClock',
      'positionCounts',
      'progressClockLimit',
    ],
    'state',
  );
  fields(state.status, ['type', 'turn'], 'status');
  if (
    state.id !== value.id ||
    state.status.type !== 'playing' ||
    !['red', 'black'].includes(String(state.status.turn)) ||
    state.moveNumber !== 1 ||
    state.progressClock !== 0 ||
    !record(state.positionCounts) ||
    Object.keys(state.positionCounts).length !== 0 ||
    typeof state.progressClockLimit !== 'number' ||
    ![60, 120].includes(state.progressClockLimit)
  )
    throw new Error('Invalid position-only initial state');
  if (!record(state.board)) throw new Error('Invalid position-only board');
  const generals = { red: 0, black: 0 };
  const board: Record<string, unknown> = {};
  for (const [square, piece] of Object.entries(state.board).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    fields(piece, ['color', 'role'], 'piece');
    if (
      !/^[a-i](?:[1-9]|10)$/.test(square) ||
      !['red', 'black'].includes(String(piece.color)) ||
      !['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'].includes(
        String(piece.role),
      )
    )
      throw new Error('Invalid position-only piece');
    if (piece.role === 'general') generals[piece.color as 'red' | 'black']++;
    board[square] = { color: piece.color, role: piece.role };
  }
  if (generals.red !== 1 || generals.black !== 1)
    throw new Error('Position-only puzzle needs both generals');
  const credit = value.credit;
  fields(credit, ['name', 'event', 'red', 'black', 'url'], 'credit');
  if (
    !text(credit.name, 100) ||
    !text(credit.event, 512) ||
    !text(credit.red, 200) ||
    !text(credit.black, 200) ||
    typeof credit.url !== 'string' ||
    !/^http:\/\/www\.dpxq\.com\/hldcg\/search\/view_m_\d{1,12}\.html$/.test(credit.url)
  )
    throw new Error('Position-only credit needs event, both players and a canonical archive link');
  if (
    !Array.isArray(value.solution) ||
    value.solution.length < 3 ||
    value.solution.length > 7 ||
    value.solution.length % 2 !== 1
  )
    throw new Error('Position-only solution must have three to seven plies');
  for (const move of value.solution) {
    fields(move, ['from', 'to'], 'move');
    if (
      typeof move.from !== 'string' ||
      typeof move.to !== 'string' ||
      !/^[a-i](?:[1-9]|10)$/.test(move.from) ||
      !/^[a-i](?:[1-9]|10)$/.test(move.to)
    )
      throw new Error('Invalid position-only move');
  }
  fields(value.goal, ['type', 'winner', 'centipawns'], 'goal');
  if (
    !['checkmate', 'winning-advantage'].includes(String(value.goal.type)) ||
    value.goal.winner !== state.status.turn ||
    ('centipawns' in value.goal &&
      (value.goal.type !== 'winning-advantage' || !Number.isFinite(value.goal.centipawns)))
  )
    throw new Error('Invalid position-only goal');
  if (
    !Array.isArray(value.themes) ||
    value.themes.some((t) => !(XIANGQI_PUZZLE_THEMES as readonly unknown[]).includes(t))
  )
    throw new Error('Invalid position-only themes');
  const puzzle = {
    id: value.id,
    variant: 'xiangqi',
    title: value.title,
    initial: {
      id: value.id,
      board,
      status: { type: 'playing', turn: state.status.turn },
      moveNumber: 1,
      progressClock: 0,
      positionCounts: {},
      progressClockLimit: state.progressClockLimit,
    },
    solution: value.solution.map((m) => ({ from: m.from, to: m.to })),
    goal: {
      type: value.goal.type,
      winner: value.goal.winner,
      ...('centipawns' in value.goal ? { centipawns: value.goal.centipawns } : {}),
    },
    themes: [...value.themes],
    credit: {
      name: credit.name,
      event: credit.event,
      red: credit.red,
      black: credit.black,
      url: credit.url,
    },
  } as XiangqiPuzzle;
  if (
    puzzle.title !==
    xiangqiPuzzleTitle(state.status.turn as 'red' | 'black', puzzle.goal, puzzle.solution.length)
  )
    throw new Error('Position-only title must state the validated objective');
  if (!xiangqiPuzzleHasStartingChoice(puzzle.initial))
    throw new Error('Position-only puzzle needs a starting choice');
  const validation = validateStandardXiangqiPuzzle(puzzle);
  if (!validation.ok) throw new Error(`Invalid position-only solution: ${validation.issue.code}`);
  return puzzle;
}
