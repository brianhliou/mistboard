// The one game loop every engine measurement shares.
//
// The kernel is the referee. A policy proposes a move; the loop checks it is
// among the kernel's legal moves, applies it through the kernel, and asks the
// kernel whether the game is over. An engine that proposes an illegal move
// aborts the run with the position and the move, because a record of a
// different game is worse than no record.

import type { LabEngine } from './engine.js';
import { pick, type Rng } from './rng.js';
import type { GameRecord, LabColor, LabKernel } from './types.js';

export type Policy<S, M> = (state: S, history: readonly string[]) => Promise<M | null>;

export function randomPolicy<S, M>(kernel: LabKernel<S, M>, rng: Rng): Policy<S, M> {
  return async (state) =>
    kernel.randomMove
      ? kernel.randomMove(state, rng)
      : (pick(kernel.legalMoves(state), rng) ?? null);
}

export function isLegal<S, M>(kernel: LabKernel<S, M>, state: S, move: M): boolean {
  if (kernel.isLegal) return kernel.isLegal(state, move);
  const key = kernel.moveKey(move);
  return kernel.legalMoves(state).some((legal) => kernel.moveKey(legal) === key);
}

/**
 * The engine plays from the kernel's initial FEN plus the move list, never
 * from `startpos`: a variant whose start array is randomised (960-style) or
 * declared by the adapter has no other way to tell the engine where it is.
 */
export function enginePolicy<S, M>(
  kernel: LabKernel<S, M>,
  engine: LabEngine,
  nodes: number,
  rootFen: string,
  options: { fresh?: boolean } = {},
): Policy<S, M> {
  return async (state, history) => {
    const { move } = await engine.bestMove(rootFen, history, nodes, options);
    if (move === '(none)') return null;
    const parsed = kernel.fromUci(state, move);
    if (!parsed) {
      throw new Error(
        `engine move "${move}" does not parse at ply ${kernel.ply(state)}\n  fen ${kernel.fen(state)}`,
      );
    }
    return parsed;
  };
}

export type PlayOptions<M> = {
  plyCap: number;
  /** Moves forced before the policies take over (a paired-opening ladder). */
  opening?: readonly M[];
  gameId?: string;
};

export type PlayedGame<S> = GameRecord & { finalState: S };

export async function playGame<S, M>(
  kernel: LabKernel<S, M>,
  policies: Readonly<Record<LabColor, Policy<S, M>>>,
  options: PlayOptions<M>,
): Promise<PlayedGame<S>> {
  let state = kernel.initial(options.gameId ?? 'lab');
  const history: string[] = [];
  const push = (move: M) => {
    history.push(kernel.toUci(move));
    state = kernel.apply(state, move);
  };
  for (const move of options.opening ?? []) push(move);

  let reason = 'ply-cap';
  while (history.length < options.plyCap) {
    const status = kernel.status(state);
    if (status.type !== 'playing') break;
    const move = await policies[status.turn](state, history);
    if (move === null) {
      reason = 'no-move';
      break;
    }
    if (!isLegal(kernel, state, move)) {
      throw new Error(
        `ILLEGAL move ${kernel.toUci(move)} for ${status.turn} at ply ${history.length}\n  fen ${kernel.fen(state)}\n  history ${history.join(' ')}`,
      );
    }
    push(move);
  }

  const status = kernel.status(state);
  return {
    moves: history,
    plies: history.length,
    winner: status.type === 'finished' ? status.winner : null,
    reason: status.type === 'finished' ? status.reason : reason,
    finalState: state,
  };
}
