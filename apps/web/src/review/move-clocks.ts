// Remaining clocks per ply for the Move times tab's clock overlay.
//
// "Remaining at ply N" is the RECORDED value once move N has landed, increment
// credited: the same static per-ply label a paused replay shows (memory
// replay_clock_two_states_settled), never a projection. series[0] is both sides
// at the initial time; series[p] is both sides after ply p. `first` is the side
// that moved first.
//
// The tenant postgames persist no dense clock array, so the series is rebuilt from
// the move timestamps and the Fischer time control, by the same reconstruction the
// TV replay clocks use (reconstructShowcaseClocks). A game with no clock to draw
// (untimed, correspondence, a timeline without plies) yields undefined, and the
// chart draws the bars alone.
import { type GameEvent, officialCorrespondenceDays } from '@mistboard/game';
import {
  MOVE_ENDED_TERMINATIONS,
  reconstructShowcaseClocks,
  type ShowcaseClockPair,
} from '../showcase-clock.js';

/** The postgame fields the reconstruction reads; every tenant postgame has them. */
export type MoveClocksPostgame = {
  game: {
    result: string;
    termination: string;
    initialMs?: number | null;
    incrementMs?: number | null;
  };
  state?: { timeControl?: { initialMs: number; incrementMs: number } };
  timeline?: ReadonlyArray<{ at: number; color?: string; ply?: number }>;
};

export function reviewMoveClocks(postgame: MoveClocksPostgame): ShowcaseClockPair[] | undefined {
  const initialMs = postgame.game.initialMs ?? postgame.state?.timeControl?.initialMs ?? null;
  const incrementMs = postgame.game.incrementMs ?? postgame.state?.timeControl?.incrementMs ?? 0;
  if (!clockToDraw(initialMs, incrementMs)) return undefined;
  const timeline = postgame.timeline ?? [];
  const moves = timeline
    .flatMap((event) =>
      typeof event.color === 'string' && typeof event.ply === 'number'
        ? [{ at: event.at, color: event.color, ply: event.ply }]
        : [],
    )
    .sort((a, b) => a.ply - b.ply);
  if (moves.length === 0) return undefined;
  const last = timeline[timeline.length - 1];
  const lastMoveEndsGame =
    postgame.game.result !== 'in-progress' &&
    MOVE_ENDED_TERMINATIONS.has(postgame.game.termination) &&
    typeof last?.ply === 'number';
  return reconstructShowcaseClocks({
    moves,
    initialMs: initialMs as number,
    incrementMs,
    // The side that actually made ply 1. A flip variant binds its colours on the
    // opening reveal, so the first mover is not always 'red'.
    firstColor: moves[0]!.color,
    lastMoveEndsGame,
  });
}

/** The fog-chess event log stamps the server's clock on every move, so its series
 *  is read, not rebuilt. Undefined when any move lacks a clock. */
export function moveClocksFromEvents(
  events: readonly GameEvent[],
): ShowcaseClockPair[] | undefined {
  const moves = events.filter(
    (event): event is Extract<GameEvent, { type: 'move-played' }> => event.type === 'move-played',
  );
  const first = moves[0]?.clock;
  if (!first || moves.some((move) => !move.clock)) return undefined;
  if (!clockToDraw(first.initialMs, first.incrementMs)) return undefined;
  const firstColor = moves[0]!.color;
  const secondColor = firstColor === 'white' ? 'black' : 'white';
  return [
    { first: first.initialMs, second: first.initialMs },
    ...moves.map((move) => ({
      first: move.clock!.remainingMs[firstColor],
      second: move.clock!.remainingMs[secondColor],
    })),
  ];
}

/** A real game clock: timed, and not a days-per-move correspondence allowance. */
function clockToDraw(initialMs: number | null, incrementMs: number): boolean {
  if (initialMs === null || !(initialMs > 0)) return false;
  return officialCorrespondenceDays(initialMs, incrementMs) === null;
}
