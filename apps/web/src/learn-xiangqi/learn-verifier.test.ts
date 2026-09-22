// Xiangqi Learn — level verifier. Every registered level must prove itself:
// the FEN lifts, apples sit on empty points, annotation shapes reference real
// intersections, copy keys resolve, and the level is PROVABLY solvable one of
// three ways:
//   - apple levels: nbMoves par is EXACTLY the BFS-optimal move count (a
//     too-generous par silently hands out 3 stars; an impossible par makes 3
//     stars unearnable — both are authoring bugs this catches);
//   - scenario levels: the scripted line is fully legal and ends in success;
//   - everything else: a sampleSolution line replayed through the runner
//     pipeline (capture-threat scan, failure/success asserts, lila order)
//     must complete in exactly nbMoves player moves.

import type {
  XiangqiColor,
  XiangqiGameState,
  XiangqiMove,
  XiangqiPieceRole,
  XiangqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { applesEaten } from './learn-assert.js';
import { learnCopy } from './learn-copy.js';
import {
  applyLearnMove,
  findCaptureThreat,
  isLearnLegalMove,
  learnLegalMoves,
  makeLearnState,
  oppositeColor,
} from './learn-rules.js';
import { createScenario } from './learn-scenario.js';
import { type AssertData, type LearnLevel, readApples } from './learn-types.js';
import { learnXiangqiStages } from './stages/index.js';

const SQUARE_PATTERN = /^[a-i](10|[1-9])$/;
const MOVE_PATTERN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
const BFS_STATE_CAP = 500_000;

/** Points a piece can NEVER stand on, no matter how the game went. Soldiers
 *  never retreat and cannot step sideways before the river, so a soldier off
 *  its own file below rank 6 (own-side relative) is a misread board, not a
 *  hard position; advisors, elephants and generals are confined outright. A
 *  learner who knows the rules reads such a diagram as a bug, so the authoring
 *  gate enforces it. Sliders (chariot, horse, cannon) go anywhere. */
function reachablePoint(
  color: XiangqiColor,
  role: XiangqiPieceRole,
  square: XiangqiSquare,
): boolean {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square.slice(1));
  // Own-side relative coordinates: rank 1 is the piece's own back rank.
  const r = color === 'red' ? rank : 11 - rank;
  const f = color === 'red' ? file : 8 - file;
  switch (role) {
    case 'soldier':
      // Starts on rank 4 on every other file, crosses the river at rank 6, and
      // only then unlocks the sideways step.
      return r >= 6 || (r >= 4 && f % 2 === 0);
    case 'advisor':
      return (
        (r === 1 && (f === 3 || f === 5)) ||
        (r === 2 && f === 4) ||
        (r === 3 && (f === 3 || f === 5))
      );
    case 'elephant':
      return (
        (r === 1 && (f === 2 || f === 6)) ||
        (r === 3 && (f === 0 || f === 4 || f === 8)) ||
        (r === 5 && (f === 2 || f === 6))
      );
    case 'general':
      return r <= 3 && f >= 3 && f <= 5;
    default:
      return true;
  }
}

function levelState(level: LearnLevel): XiangqiGameState {
  const state = makeLearnState(level.fen, `verify-${level.id}`);
  if (level.emptyApples) return state;
  const board = { ...state.board };
  for (const square of readApples(level.apples)) {
    board[square] = { color: oppositeColor(level.color), role: 'soldier' };
  }
  return { ...state, board };
}

function parseSolution(solution: string): XiangqiMove[] {
  return solution
    .split(' ')
    .filter(Boolean)
    .map((token) => {
      const match = MOVE_PATTERN.exec(token);
      if (!match) throw new Error(`bad sampleSolution token "${token}"`);
      return { from: match[1] as XiangqiSquare, to: match[2] as XiangqiSquare };
    });
}

/** Exact minimal player-move count to eat every apple, BFS over the deduped
 *  (player piece positions × remaining apples) state space. Returns null when
 *  no solution exists within `maxDepth`. */
function minimalAppleMoves(level: LearnLevel, maxDepth: number): number | null {
  const start = levelState(level);
  const startApples = readApples(level.apples).sort().join(',');
  const stateKey = (state: XiangqiGameState, apples: string): string =>
    `${apples}|${Object.entries(state.board)
      .map(([square, piece]) => `${square}:${piece?.color}${piece?.role}`)
      .sort()
      .join(',')}`;

  let frontier: { state: XiangqiGameState; apples: Set<XiangqiSquare> }[] = [
    { state: start, apples: new Set(readApples(level.apples)) },
  ];
  const seen = new Set<string>([stateKey(start, startApples)]);

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      if (node.apples.size === 0) return depth;
      for (const move of learnLegalMoves(node.state, level.rules)) {
        const applied = applyLearnMove(node.state, level.rules, move, { keepTurn: true });
        const apples = new Set(node.apples);
        apples.delete(move.to);
        const key = stateKey(applied, [...apples].sort().join(','));
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > BFS_STATE_CAP) {
          throw new Error(`BFS state cap exceeded for level ${level.id}`);
        }
        next.push({ state: applied, apples });
      }
    }
    frontier = next;
  }
  return null;
}

function bothGeneralsPresent(state: XiangqiGameState): boolean {
  const colors = new Set<XiangqiColor>();
  for (const piece of Object.values(state.board)) {
    if (piece?.role === 'general') colors.add(piece.color);
  }
  return colors.size === 2;
}

/** Walk the full scenario as scripted and return the final assert data. */
function walkScenario(level: LearnLevel): AssertData {
  let state = levelState(level);
  const apples = new Set(readApples(level.apples));
  const scenario = createScenario(level.scenario);
  let playerMoves = 0;
  let lastPlayerMove: XiangqiMove | null = null;

  for (;;) {
    if (state.status.type !== 'playing') break;
    const step = scenario.peek();
    if (!step) break;
    const mover = state.status.turn;
    expect(
      learnLegalMoves(state, level.rules).some(
        (move) => move.from === step.move.from && move.to === step.move.to,
      ),
      `level ${level.id}: scenario step ${step.move.from}${step.move.to} illegal for ${mover}`,
    ).toBe(true);
    // A relaxed level walks geometry only, so a scripted move that leaves the
    // mover's own general in check passed this gate: perpetual L3 shipped a
    // pinned horse hopping out of its pin (2026-09-22). Whenever both generals
    // are on the board the scripted line must also hold under the real rules;
    // a learner who knows the game reads a self-check as a bug, not a demo.
    if (bothGeneralsPresent(state)) {
      expect(
        learnLegalMoves(state, 'strict').some(
          (move) => move.from === step.move.from && move.to === step.move.to,
        ),
        `level ${level.id}: scenario step ${step.move.from}${step.move.to} is a self-check (or otherwise illegal) for ${mover} under strict rules`,
      ).toBe(true);
    }
    if (mover === level.color) {
      expect(scenario.player(step.move)).toBe('matched');
      playerMoves += 1;
      lastPlayerMove = step.move;
    } else {
      expect(scenario.opponent()).toBe(step);
    }
    state = applyLearnMove(state, level.rules, step.move);
    apples.delete(step.move.to);
  }

  return {
    state,
    playerColor: level.color,
    items: apples,
    vm: {
      moves: playerMoves,
      lastPlayerMove,
      scenarioComplete: scenario.isComplete(),
      scenarioFailed: scenario.isFailed(),
    },
  };
}

/** Walk the scenario asserting each scripted opponent reply is the opponent's
 *  ONLY legal move: the demonstrated line is forced, never cooperative. A
 *  scripted "defense" the opponent was free to dodge makes the level's claim
 *  (usually "mate in N") false against real play. */
function assertForcedReplies(level: LearnLevel): void {
  let state = levelState(level);
  const scenario = createScenario(level.scenario);
  for (;;) {
    if (state.status.type !== 'playing') break;
    const step = scenario.peek();
    if (!step) break;
    if (state.status.turn === level.color) {
      scenario.player(step.move);
    } else {
      const legal = learnLegalMoves(state, level.rules)
        .map((move) => `${move.from}${move.to}`)
        .sort()
        .join(' ');
      expect(
        legal,
        `level ${level.id}: scripted reply ${step.move.from}${step.move.to} must be the opponent's only legal move (forcedReplies)`,
      ).toBe(`${step.move.from}${step.move.to}`);
      scenario.opponent();
    }
    state = applyLearnMove(state, level.rules, step.move);
  }
}

/** Replay a sampleSolution through the exact runner pipeline (lila order:
 *  matched scenario moves skip the gates; otherwise capture threat, then the
 *  failure assert, then success). Returns issue strings; empty = proven. */
function simulateSampleSolution(level: LearnLevel): string[] {
  const moves = parseSolution(level.sampleSolution ?? '');
  if (moves.length === 0) return ['sampleSolution is empty'];

  let state = levelState(level);
  const apples = new Set(readApples(level.apples));
  const scenario = createScenario(level.scenario);
  let nbMoves = 0;
  let lastPlayerMove: XiangqiMove | null = null;
  let completed = false;

  const data = (): AssertData => ({
    state,
    playerColor: level.color,
    items: apples,
    vm: {
      moves: nbMoves,
      lastPlayerMove,
      scenarioComplete: scenario.isComplete(),
      scenarioFailed: scenario.isFailed(),
    },
  });
  const succeeds = (): boolean => (level.success ?? applesEaten)(data());

  for (const move of moves) {
    // Auto-play scripted opponent steps until it is the player's turn.
    while (state.status.type === 'playing' && state.status.turn !== level.color) {
      const step = scenario.opponent();
      if (!step) {
        return [`opponent to move with no scripted step before ${move.from}${move.to}`];
      }
      state = applyLearnMove(state, level.rules, step.move);
      apples.delete(step.move.to);
    }
    if (state.status.type !== 'playing') return ['game ended before the line finished'];
    if (!isLearnLegalMove(state, level.rules, move)) {
      return [`illegal move ${move.from}${move.to} in sampleSolution`];
    }

    nbMoves += 1;
    lastPlayerMove = move;
    const matched = scenario.player(move) === 'matched';
    state = applyLearnMove(state, level.rules, move, {
      keepTurn: level.rules === 'relaxed' && level.keepTurn,
    });
    apples.delete(move.to);

    if (!matched) {
      if (scenario.isFailed()) return [`move ${move.from}${move.to} deviates from the scenario`];
      if (level.detectCapture !== false && state.status.type === 'playing') {
        const threat = findCaptureThreat(
          state,
          level.color,
          level.detectCapture === true ? true : 'unprotected',
          level.rules,
        );
        if (threat) {
          return [
            `sampleSolution fails detectCapture: ${threat.move.from}${threat.move.to} captures after ${move.from}${move.to}`,
          ];
        }
      }
      if (level.failure?.(data()) ?? false) {
        return [`sampleSolution trips the failure assert after ${move.from}${move.to}`];
      }
    }

    if (succeeds()) {
      completed = true;
      break;
    }
  }

  const issues: string[] = [];
  if (!completed) issues.push('sampleSolution does not complete the level');
  if (nbMoves !== level.nbMoves) {
    issues.push(`sampleSolution uses ${nbMoves} player moves, nbMoves is ${level.nbMoves}`);
  }
  return issues;
}

/** Enumerate every legal first move through the exact runner pipeline and
 *  count, for a one-move level: `solutions` (moves that complete the level)
 *  and `candidates` (moves satisfying the intent's candidate assert on the
 *  raw post-move position, before the capture-threat and failure gates). */
function classifyFirstMoves(level: LearnLevel): { solutions: number; candidates: number } {
  const start = levelState(level);
  const success = level.success ?? applesEaten;
  let solutions = 0;
  let candidates = 0;

  for (const move of learnLegalMoves(start, level.rules)) {
    const state = applyLearnMove(start, level.rules, move, {
      keepTurn: level.rules === 'relaxed' && level.keepTurn,
    });
    const apples = new Set(readApples(level.apples));
    apples.delete(move.to);
    const data: AssertData = {
      state,
      playerColor: level.color,
      items: apples,
      vm: { moves: 1, lastPlayerMove: move, scenarioComplete: false, scenarioFailed: false },
    };

    if (level.intent?.candidates?.assert(data)) candidates += 1;

    // Runner gate order: capture-threat scan, then the failure assert, then
    // success. A move only solves when it passes both gates AND succeeds.
    if (level.detectCapture !== false && state.status.type === 'playing') {
      const threat = findCaptureThreat(
        state,
        level.color,
        level.detectCapture === true ? true : 'unprotected',
        level.rules,
      );
      if (threat) continue;
    }
    if (level.failure?.(data) ?? false) continue;
    if (success(data)) solutions += 1;
  }

  return { solutions, candidates };
}

describe('learn xiangqi level verifier', () => {
  for (const stage of learnXiangqiStages) {
    describe(`stage ${stage.key}`, () => {
      it('resolves stage copy keys', () => {
        for (const key of [stage.title, stage.subtitle, stage.intro, stage.complete]) {
          expect(learnCopy(key), `missing copy for ${key}`).not.toBe(key);
        }
      });

      for (const level of stage.levels) {
        describe(`level ${level.id}`, () => {
          it('lifts the FEN and resolves goal copy', () => {
            expect(() => makeLearnState(level.fen, 'verify')).not.toThrow();
            expect(learnCopy(level.goal), `missing copy for ${level.goal}`).not.toBe(level.goal);
            expect(level.nbMoves).toBeGreaterThanOrEqual(1);
          });

          it('places apples on valid empty points', () => {
            const state = makeLearnState(level.fen, 'verify');
            for (const square of readApples(level.apples)) {
              expect(square, `bad apple square ${square}`).toMatch(SQUARE_PATTERN);
              expect(state.board[square], `apple on occupied point ${square}`).toBeUndefined();
            }
          });

          it('places every piece on a point a real game could reach', () => {
            const state = makeLearnState(level.fen, 'verify');
            for (const [square, piece] of Object.entries(state.board)) {
              expect(
                reachablePoint(piece.color, piece.role, square as XiangqiSquare),
                `${piece.color} ${piece.role} on ${square} is unreachable in a legal game`,
              ).toBe(true);
            }
          });

          it('references valid squares in shapes', () => {
            for (const shape of level.shapes ?? []) {
              const squares = shape.kind === 'arrow' ? [shape.from, shape.to] : [shape.square];
              for (const square of squares) {
                expect(square, `bad shape square ${square}`).toMatch(SQUARE_PATTERN);
              }
            }
          });

          if (level.apples && !level.scenario) {
            it(`is solvable in exactly nbMoves=${level.nbMoves} (par honesty)`, () => {
              const minimal = minimalAppleMoves(level, level.nbMoves + 3);
              expect(minimal, 'level is unsolvable near par').not.toBeNull();
              expect(minimal, 'nbMoves must equal the BFS-optimal move count').toBe(level.nbMoves);
            });
          }

          if (level.scenario) {
            it('scripted line is legal and ends in success', () => {
              const data = walkScenario(level);
              const success = level.success ?? applesEaten;
              expect(success(data), 'scenario walk must satisfy the success assert').toBe(true);
              expect(
                level.failure === undefined || !level.failure(data),
                'scenario walk must not trip the failure assert',
              ).toBe(true);
              expect(data.vm.moves, 'nbMoves should match scripted player moves').toBe(
                level.nbMoves,
              );
            });

            if (level.forcedReplies) {
              it('every scripted opponent reply is forced (only legal move)', () => {
                assertForcedReplies(level);
              });
            }
          }

          if (!level.apples && !level.scenario) {
            it('provides a sampleSolution (only provable path for this level)', () => {
              expect(
                level.sampleSolution,
                'levels without apples or a scenario must ship a sampleSolution proof',
              ).toBeDefined();
            });
          }

          if (level.sampleSolution) {
            it('sampleSolution completes the level through the runner pipeline', () => {
              expect(simulateSampleSolution(level)).toEqual([]);
            });
          }

          if (level.intent) {
            it('honors the declared intent (craft contract)', () => {
              expect(level.nbMoves, 'intent requires a one-move level').toBe(1);
              expect(level.apples, 'intent does not support apple levels').toBeUndefined();
              expect(level.scenario, 'intent does not support scenario levels').toBeUndefined();
              const { solutions, candidates } = classifyFirstMoves(level);
              expect(
                solutions,
                `exactly ${level.intent?.solutions} first move(s) must solve the level`,
              ).toBe(level.intent?.solutions);
              if (level.intent?.candidates) {
                expect(
                  candidates,
                  `at least ${level.intent.candidates.min} first moves must satisfy the candidate assert (tempting wrong answers)`,
                ).toBeGreaterThanOrEqual(level.intent.candidates.min);
              }
            });
          }
        });
      }
    });
  }
});
