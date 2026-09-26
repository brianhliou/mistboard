// Gamebook (interactive-lesson) play engine — the guess-the-move state machine
// over a solution tree. Variant-agnostic and view-agnostic: a view layer drives it
// with the learner's attempted moves and renders the coach text it returns. This is
// the shared core the study gamebook player AND the /learn course mount (study-track
// Decision E). The solution is the tree's mainline; the learner plays one side and
// the opponent's replies are auto-advanced.
//
// Feedback states (lila-style): 'play' (learner to move), 'bad' (wrong attempt →
// show the deviation; the board stays live, so the next attempt IS the retry),
// 'end' (line complete). A correct attempt advances
// past the learner's move and any auto opponent reply, landing on the next 'play' (or
// 'end'). The tree is never mutated — attempts are compared to it by move key.

import { type GameTree, type GameTreeNode, ROOT_PATH, type TreePath } from './game-tree.js';

export type GamebookFeedback = 'play' | 'bad' | 'end';

export interface GamebookView {
  feedback: GamebookFeedback;
  /** Coach line for the current position (the reply just played, or the prompt). */
  comment?: string;
  /** On-demand hint available at a 'play' node. */
  hint?: string;
  /** Explanation shown after a wrong attempt. */
  deviation?: string;
  /** Whether the learner is on the move (board should be interactive). */
  awaitingMove: boolean;
}

export interface GamebookConfig<M, T> {
  /** Stable key for a move (matches GameTreeNode.id — the adapter's moveKey). */
  moveKey: (move: M) => string;
  /** Is `move` legal from `truth`? (A legal-but-wrong move is 'bad'; illegal is ignored.) */
  isLegal: (truth: T, move: M) => boolean;
  /** Side the learner plays — the moves they must find. */
  learner: string;
  /** Whose turn at this truth, or null when the line has ended. */
  sideToMove: (truth: T) => string | null;
  /** Per-node authored coach text. */
  comment: (node: GameTreeNode<M, T>) => string | undefined;
  hint: (node: GameTreeNode<M, T>) => string | undefined;
  deviation: (node: GameTreeNode<M, T>) => string | undefined;
}

export interface GamebookSession<M, T> {
  path(): TreePath;
  node(): GameTreeNode<M, T>;
  view(): GamebookView;
  /** Learner attempts a move. 'good' advances (their move + auto opponent reply);
   *  'bad' stays and shows the deviation until the next attempt, which is
   *  accepted from 'bad' as from 'play'; 'invalid' = not a move from here. */
  attempt(move: M): 'good' | 'bad' | 'invalid';
  /** Clear a 'bad' state back to 'play' at the same position. */
  retry(): void;
  /** Restart the lesson from the top. */
  reset(): void;
}

export function createGamebookSession<M, T, V>(
  tree: GameTree<M, T, V>,
  config: GamebookConfig<M, T>,
): GamebookSession<M, T> {
  let cursor: TreePath = ROOT_PATH;
  let feedback: GamebookFeedback = 'play';
  let badNode: GameTreeNode<M, T> | null = null;

  const nodeAt = (path: TreePath): GameTreeNode<M, T> => tree.nodeAt(path) ?? tree.root;

  // Auto-play opponent replies (along the mainline) until it is the learner's move
  // again, or the line ends.
  function settle(): void {
    for (;;) {
      const node = nodeAt(cursor);
      const main = node.children[0];
      if (!main) {
        feedback = 'end';
        return;
      }
      if (config.sideToMove(node.truth) === config.learner) {
        feedback = 'play';
        return;
      }
      cursor = tree.pathTo(main);
    }
  }

  function attempt(move: M): 'good' | 'bad' | 'invalid' {
    // A wrong move does not lock the board: making a move is how a learner
    // tries again, and a take-back button between every guess was a click that
    // bought nothing (the position never changed on a wrong move).
    if (feedback === 'end') return 'invalid';
    const node = nodeAt(cursor);
    const key = config.moveKey(move);
    const main = node.children[0];
    if (main && main.id === key) {
      cursor = tree.pathTo(main);
      badNode = null;
      settle();
      return 'good';
    }
    const variation = node.children.find((child) => child.id === key) ?? null;
    if (!variation && !config.isLegal(node.truth, move)) return 'invalid';
    badNode = variation;
    feedback = 'bad';
    return 'bad';
  }

  function retry(): void {
    if (feedback === 'bad') {
      feedback = 'play';
      badNode = null;
    }
  }

  function reset(): void {
    cursor = ROOT_PATH;
    feedback = 'play';
    badNode = null;
    settle();
  }

  function view(): GamebookView {
    const node = nodeAt(cursor);
    if (feedback === 'bad') {
      const fromVariation = badNode
        ? (config.deviation(badNode) ?? config.comment(badNode))
        : undefined;
      return {
        feedback,
        comment: config.comment(node),
        deviation: fromVariation ?? config.deviation(node),
        hint: config.hint(node),
        awaitingMove: true,
      };
    }
    if (feedback === 'end') {
      return { feedback, comment: config.comment(node), awaitingMove: false };
    }
    return {
      feedback: 'play',
      comment: config.comment(node),
      hint: config.hint(node),
      awaitingMove: true,
    };
  }

  settle();
  return {
    path: () => cursor,
    node: () => nodeAt(cursor),
    view,
    attempt,
    retry,
    reset,
  };
}
