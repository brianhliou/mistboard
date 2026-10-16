// "Learn from your mistakes" (lichess retrospect): walk one side's mistakes and
// blunders, stop before each on the position it was played from, and let the
// reader try a better move. A try is graded three ways, in order: the engine's
// own refutation line (the comp variation grafted by the whole-game analysis) or
// a game-ending move wins outright; the move that was actually played fails
// outright; anything else is handed to the LOCAL engine and wins when it keeps
// the mover within RETRO_TOLERANCE win% points of the position before the
// mistake (lichess: povDiff > -0.04).
//
// This module is the state machine only. It knows nothing about DOM, boards or
// engines beyond the small RetroHost seam the tree controller hands it, so the
// whole flow is unit-testable with a hand-built tree.
import { winPercent, winPercentK } from '@mistboard/game';
import type { CevalLine } from './engine/ceval-types.js';
import type { GameAnalysis } from './game-analysis.js';
import type { GameTreeNode, TreePath } from './game-tree.js';
import { pathKey } from './move-tree.js';

export type RetroSide = 'red' | 'black';

/** find: waiting for a try · eval: the local engine is grading one · win / fail:
 *  the verdict · view: the reader asked for the solution · offTrack: the reader
 *  navigated away from the position to solve. */
export type RetroFeedback = 'find' | 'eval' | 'win' | 'fail' | 'view' | 'offTrack';

export type RetroNodeRef<Node> = { node: Node; path: TreePath };

export type RetroCurrent<Node> = {
  /** The mistake: the mainline node the graded move landed on. */
  fault: RetroNodeRef<Node>;
  /** The position it was played from: where the reader is asked to find better. */
  prev: RetroNodeRef<Node>;
  /** The first node of the engine's refutation line under `prev`. */
  solution: RetroNodeRef<Node>;
};

/** What the tree controller lends the retro flow. Every function reads or
 *  drives the live tree; none of them is retro-specific. */
export interface RetroHost<Node> {
  analysis: GameAnalysis;
  /** Mainline nodes, index = ply (0 = the start position). */
  mainline(): Node[];
  pathTo(node: Node): TreePath;
  currentPath(): TreePath;
  currentNode(): Node;
  /** Navigate. The host re-renders and calls `onNavigate` back. */
  go(path: TreePath): void;
  /** Remove a failed try that the reader did not author (an off-mainline leaf). */
  deleteAt(path: TreePath): void;
  /** A node grafted from the whole-game analysis (the engine's line). */
  isCompNode(node: Node): boolean;
  /** The game is over at this node (checkmate, or no legal reply). */
  isTerminal(node: Node): boolean;
  /** Local engine, or null when the surface has none. `ensureOn` switches it
   *  on so a try gets a search; `supported` is false where the browser cannot
   *  run it (Safari), in which case a free try cannot be graded. */
  engine: { supported: boolean; ensureOn(): void } | null;
  /** Re-render the retro panel + everything that reads the retro state. */
  redraw(): void;
}

export interface RetroController<Node> {
  readonly side: RetroSide;
  current(): RetroCurrent<Node> | null;
  feedback(): RetroFeedback;
  /** Waiting for, or having just failed, a try. */
  isSolving(): boolean;
  /** [solved, total] over this side's candidates. */
  completion(): [number, number];
  /** A candidate ply the reader has not solved yet: its refutation line, its
   *  advice text and the engine's output stay hidden (lichess hideComputerLine). */
  hidesPly(ply: number): boolean;
  /** The mistake to draw as a warning arrow: set while solving AT the position
   *  to solve, so the reader sees what was played without being shown better. */
  showBadNode(): Node | null;
  /** Hide the local engine's readout (it would show the solution): while
   *  solving at the position to solve. */
  hideEngineOutput(): boolean;
  /** Block stepping forward into the played mistake while solving. */
  preventGoingToNextMove(): boolean;
  /** The grader could not run because the browser has no local engine. */
  engineUnavailable(): boolean;
  /** The host navigated (a try was played, or the reader moved around). */
  onNavigate(): void;
  /** Fresh local-engine lines for the CURRENT position (side-to-move POV). */
  onEngineLines(lines: readonly CevalLine[] | null): void;
  jumpToNext(): void;
  skip(): void;
  viewSolution(): void;
  reset(): void;
}

/** Only mistakes and blunders are worth a retry (lichess evalSwings: a winning-
 *  chance drop over 0.2 raw, which is the mistake threshold); inaccuracies stay
 *  in the summary and the move list. */
const RETRO_JUDGMENTS = new Set(['mistake', 'blunder']);

/** How many win% points a free try may fall short of the pre-mistake eval and
 *  still count (lichess: povDiff > -0.04 on the [-1, 1]/2 scale = 4 points). */
export const RETRO_TOLERANCE = 4;

/** The local search grades a try once it reaches this depth: the server sweep
 *  that produced the pre-mistake eval ran at depth 12, so a shallower local
 *  reading would be compared against a deeper one. */
export const RETRO_GRADE_DEPTH = 12;

type NodeShape<Move, Truth> = GameTreeNode<Move, Truth>;

export function createRetro<Move, Truth>(
  host: RetroHost<NodeShape<Move, Truth>>,
  side: RetroSide,
): RetroController<NodeShape<Move, Truth>> {
  type Node = NodeShape<Move, Truth>;
  let feedback: RetroFeedback = 'find';
  let current: RetroCurrent<Node> | null = null;
  /** The try being graded by the engine (feedback 'eval'). */
  let tryPath: TreePath | null = null;
  let solvedPlies: number[] = [];
  let candidatePlies: number[] = [];

  const same = (a: TreePath, b: TreePath): boolean => pathKey(a) === pathKey(b);
  const isSolved = (ply: number): boolean => solvedPlies.includes(ply);
  const isSolving = (): boolean => feedback === 'find' || feedback === 'fail';
  const atPrev = (): boolean => !!current && same(host.currentPath(), current.prev.path);

  /** This side's mistakes/blunders that have a refutation line to learn from. */
  function findCandidates(): RetroCurrent<Node>[] {
    const nodes = host.mainline();
    const out: RetroCurrent<Node>[] = [];
    for (const move of host.analysis.moves) {
      if (move.mover !== side || !move.judgment || !RETRO_JUDGMENTS.has(move.judgment)) continue;
      const fault = nodes[move.ply];
      const prev = nodes[move.ply - 1];
      if (!fault || !prev) continue;
      const solution = prev.children.find((child) => host.isCompNode(child));
      if (!solution) continue;
      out.push({
        fault: { node: fault, path: host.pathTo(fault) },
        prev: { node: prev, path: host.pathTo(prev) },
        solution: { node: solution, path: host.pathTo(solution) },
      });
    }
    return out;
  }

  function jumpToNext(): void {
    feedback = 'find';
    tryPath = null;
    const candidates = findCandidates();
    candidatePlies = candidates.map((c) => c.fault.node.ply);
    const next = candidates.find((c) => !isSolved(c.fault.node.ply)) ?? null;
    current = next;
    if (next) host.go(next.prev.path);
    host.redraw();
  }

  function solveCurrent(): void {
    if (current && !isSolved(current.fault.node.ply)) solvedPlies.push(current.fault.node.ply);
  }

  function onWin(): void {
    solveCurrent();
    tryPath = null;
    feedback = 'win';
    host.redraw();
  }

  function onFail(): void {
    if (!current) return;
    const bad = { node: host.currentNode(), path: host.currentPath() };
    tryPath = null;
    feedback = 'fail';
    host.go(current.prev.path);
    // The reader's failed try is scaffolding, not authorship: drop it unless it is
    // the played move itself, the engine's line, or something they built on.
    const onMainline = host.mainline().includes(bad.node);
    if (!onMainline && !host.isCompNode(bad.node) && bad.node.children.length === 0) {
      host.deleteAt(bad.path);
    }
    host.redraw();
  }

  /** Grade a child of the position to solve. */
  function grade(node: Node, path: TreePath): void {
    if (!current) return;
    if (host.isCompNode(node) || host.isTerminal(node)) {
      onWin();
      return;
    }
    if (node === current.fault.node) {
      onFail();
      return;
    }
    feedback = 'eval';
    tryPath = path;
    host.engine?.ensureOn();
    host.redraw();
  }

  function onNavigate(): void {
    if (!current) return;
    const path = host.currentPath();
    const node = host.currentNode();
    if (feedback === 'eval') {
      // Left the try mid-search: back to waiting, whatever the engine says later.
      if (!tryPath || !same(path, tryPath)) {
        feedback = 'find';
        tryPath = null;
      }
      return;
    }
    if (feedback === 'offTrack') {
      if (same(path, current.prev.path)) feedback = 'find';
      return;
    }
    if (!isSolving()) return;
    if (node.parent === current.prev.node) grade(node, path);
    else if (!same(path, current.prev.path)) feedback = 'offTrack';
  }

  function onEngineLines(lines: readonly CevalLine[] | null): void {
    if (feedback !== 'eval' || !current || !tryPath || !lines?.length) return;
    if (!same(host.currentPath(), tryPath)) return;
    const best = lines[0]!;
    if (best.depth < RETRO_GRADE_DEPTH) return;
    // The engine reports the try's position from the side to move, i.e. the
    // opponent; the mover's chances are the complement.
    const winAfter = 100 - winPercent(best.scoreCp, best.mate);
    const before = host.analysis.evals.find((e) => e.ply === current!.fault.node.ply - 1);
    if (!before) return;
    // Each side on its own engine's curve: the try is the browser engine's score (lila's
    // curve), the position before it the stored analysis (its engineId's curve).
    const redBefore = winPercent(before.cp, before.mate, winPercentK(host.analysis.engineId));
    const winBefore = side === 'red' ? redBefore : 100 - redBefore;
    if (winAfter >= winBefore - RETRO_TOLERANCE) onWin();
    else onFail();
  }

  jumpToNext();

  return {
    side,
    current: () => current,
    feedback: () => feedback,
    isSolving,
    completion: () => [solvedPlies.length, candidatePlies.length],
    hidesPly: (ply) => candidatePlies.includes(ply) && !isSolved(ply),
    showBadNode: () => (current && isSolving() && atPrev() ? current.fault.node : null),
    hideEngineOutput: () => isSolving() && atPrev(),
    preventGoingToNextMove: () => isSolving() && atPrev(),
    engineUnavailable: () => feedback === 'eval' && !(host.engine?.supported ?? false),
    onNavigate,
    onEngineLines,
    jumpToNext,
    skip() {
      solveCurrent();
      jumpToNext();
    },
    viewSolution() {
      if (!current) return;
      feedback = 'view';
      tryPath = null;
      solveCurrent();
      host.go(current.solution.path);
      host.redraw();
    },
    reset() {
      solvedPlies = [];
      jumpToNext();
    },
  };
}
