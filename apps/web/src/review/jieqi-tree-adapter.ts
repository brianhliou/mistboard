// Jieqi adapter for the shared GameTree spine. Jieqi is
// IDENTITY-hidden, not position-hidden: the 15 non-general pieces per side are
// shuffled face-down onto the home squares and reveal WHEN THEY MOVE (there is no
// flip self-move — a dark piece moves by its starting-square role, then flips to its
// true role). Post-game the deal is KNOWN — recovered from the fully-revealed
// `history.truth` stream (jieqi's spoiler key is 'truth', not 'revealed') and baked
// into the truth — so branching is deterministic and the adapter is a FACTORY over
// that deal. The board is projected MASKED (getJieqiPlayerView): dark pieces keep
// their color but hide their role until a move in THIS line reveals them.

import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  isJieqiLegalMove,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiPlayerView,
  type JieqiSquare,
  jieqiHomeSquares,
  jieqiTruthView,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

/** Parse a JieqiSquare ('a1'..'i10') from a UCI token. Jieqi squares are xiangqi
 *  squares: file a–i + rank 1–10, so the token is 3–4 chars (rank can be two
 *  digits). Validate structurally rather than against an enumerated set. */
function parseJieqiSquare(token: string): JieqiSquare | null {
  return /^[a-i](?:[1-9]|10)$/.test(token) ? (token as JieqiSquare) : null;
}

/** Split a from+to UCI where each square is 'a1'..'i10'. The file letters are the
 *  only unambiguous split points: 'to' starts at the second [a-i]. */
function splitJieqiUci(uci: string): [string, string] | null {
  const secondFile = uci.slice(1).search(/[a-i]/);
  if (secondFile < 0) return null;
  const cut = secondFile + 1;
  return [uci.slice(0, cut), uci.slice(cut)];
}

/** Recover the per-side deal from a fully-revealed board — the earliest snapshot in
 *  the postgame `history.truth` stream, where every home square shows its true role.
 *  Reads roles in jieqiHomeSquares order (the same order createInitialJieqiState
 *  consumes). Throws if a home square is missing/masked so the caller degrades to an
 *  error rather than a wrong board (generals are face-up and excluded from the
 *  deal).
 *
 *  An imported game can carry pieces whose identity was NEVER determined (the
 *  truth view marks them `unknown`). The kernel still needs a whole deal, so
 *  those squares get a draw from what that side's set has left, and the deal
 *  lists them as `undetermined`: the pieces stay unknown in every truth view and
 *  in the analysis hand-off, and only a side line that moves one shows a (drawn,
 *  hypothetical) identity. */
export function recoverJieqiDeal(
  truth: JieqiPlayerView,
  rng: () => number = Math.random,
): JieqiDeal {
  const undetermined: Record<'red' | 'black', JieqiSquare[]> = { red: [], black: [] };
  const readSide = (color: 'red' | 'black'): JieqiPieceRole[] => {
    const squares = jieqiHomeSquares(color);
    const roles = squares.map((square): JieqiPieceRole | null => {
      const entry = truth.board[square];
      if (entry?.faceDown && entry.unknown) {
        undetermined[color].push(square);
        return null;
      }
      if (!entry || entry.faceDown) {
        throw new Error(`jieqi deal recovery: home square ${square} is not revealed`);
      }
      return entry.role;
    });
    const left = [...STANDARD_JIEQI_DEAL[color]];
    for (const role of roles) {
      if (role === null) continue;
      const index = left.indexOf(role);
      if (index < 0) throw new Error(`jieqi deal recovery: too many ${color} ${role}s`);
      left.splice(index, 1);
    }
    for (let i = left.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [left[i], left[j]] = [left[j]!, left[i]!];
    }
    return roles.map((role) => role ?? left.pop()!);
  };
  const deal: JieqiDeal = { red: readSide('red'), black: readSide('black') };
  if (undetermined.red.length + undetermined.black.length > 0) deal.undetermined = undetermined;
  return deal;
}

function projectJieqiView(truth: JieqiGameState, revealAll: boolean): JieqiPlayerView {
  const masked = getJieqiPlayerView(
    truth,
    truth.status.type === 'playing' ? truth.status.turn : 'red',
  );
  if (!revealAll) return masked;
  const full = jieqiTruthView(truth);
  return { ...masked, board: full.board, captured: full.captured };
}

export function makeJieqiTreeAdapter(
  gameId: string,
  // Null when the caller roots the tree at a parsed position (TreeReviewConfig
  // `root`), in which case initialTruth is never consulted; asking anyway is a
  // wiring bug, so it throws rather than minting a deal the URL does not carry.
  deal: JieqiDeal | null,
  // Read at PROJECTION time, not at construction: the review menu's Reveal toggle
  // flips the caller's flag and re-renders, and the adapter picks it up on the next
  // project() rather than being rebuilt (which would drop the tree).
  opts: { revealAll?: () => boolean } = {},
): VariantTreeAdapter<JieqiMove, JieqiGameState, JieqiPlayerView> {
  return {
    mode: 'perfect-info',
    initialTruth: () => {
      if (!deal) throw new Error('jieqi tree adapter: no deal; mount with config.root');
      return createInitialJieqiState(gameId, deal);
    },
    isLegal: (truth, move) => truth.status.type === 'playing' && isJieqiLegalMove(truth, move),
    applyMove: (truth, move) => applyJieqiMove(truth, move),
    project: (truth): ProjectedView<JieqiPlayerView>[] => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        // Masked as-played view, projected for the SIDE TO MOVE so legalMoves
        // populate for the color the board is about to play. Revealed, only the
        // hidden knowledge changes: the board and the captured pool come from the
        // truth while legalMoves / inCheck / status stay the side-to-move's, so
        // the line is still playable with the spoiler on.
        view: projectJieqiView(truth, opts.revealAll?.() === true),
      },
    ],
    // Jieqi has no flip move — every move is a board move; label as from-to.
    moveLabel: (move) => `${move.from}-${move.to}`,
    moveKey: (move) => `${move.from}${move.to}`,
    toEngineUci: (move) => `${move.from}${move.to}`,
    fromUci: (uci) => {
      const parts = splitJieqiUci(uci);
      if (!parts) return null;
      const from = parseJieqiSquare(parts[0]);
      const to = parseJieqiSquare(parts[1]);
      return from && to ? { from, to } : null;
    },
  };
}
