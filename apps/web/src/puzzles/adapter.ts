/**
 * Shared puzzle-session model + the per-variant board-adapter contract.
 *
 * The puzzles page splits along the same seam as the live tenants
 * (variant-tenant/live-client.ts) and the /watch TV renderer
 * (watch-tenant-replay.ts): a variant-agnostic session/panel core (puzzles.ts)
 * drives a small per-variant PuzzleBoardAdapter that owns board painting,
 * click/drag interaction, move animation, and replay move application. Adding
 * a puzzle variant = one adapter module + a registry entry
 * (puzzles/registry.ts); the core never dispatches on variant ids.
 *
 * The session model is deliberately structural ('red' | 'black' colors,
 * string squares, {from,to}/{drop,to} moves) so the core compiles without
 * importing any variant's concrete state types; adapters narrow to their own
 * types at the boundary, exactly like the live tenants do.
 */

import { deepCloneJson, type XiangqiMotifId } from '@mistboard/game';
import { type I18nKey, t } from '../i18n/catalog.js';
import type { VariantMiniId } from '../variant-mini-boards.js';
import type { PuzzleVariant } from './variant-ids.js';

// Every puzzle variant plays red vs black (Jungle included).
export type PuzzleColor = 'red' | 'black';

// A board move or a reserve drop; adapters narrow the strings to their own
// square/role literal types at the boundary.
export type PuzzleMove = { from: string; to: string } | { drop: string; to: string };

// The minimal status shape shared by every variant's GameState. Narrowing on
// status.type === 'playing' exposes the turn; the core never reads more.
export type PuzzleStatus =
  | { type: 'playing'; turn: PuzzleColor }
  | { type: 'finished' }
  | { type: 'aborted' };

// Structural supertype of every variant's GameState: the core only needs the
// square->piece board map (for the capture-sound piece count), the status, and
// the optional mined setup move. Adapters cast to their concrete state.
export type PuzzleState = {
  board: object;
  status: PuzzleStatus;
  lastMove?: PuzzleMove;
};

export type PuzzleGoal =
  | { type: 'checkmate'; winner?: PuzzleColor }
  | { type: 'win'; winner?: PuzzleColor }
  | { type: 'winning-advantage'; winner?: PuzzleColor; centipawns?: number };

export type PuzzleSummary = {
  id: string;
  variant: PuzzleVariant;
  title: string;
  sideToMove: PuzzleColor | null;
  goal: PuzzleGoal;
  themes: string[];
  /** Named kill patterns (杀法) by id, standard-xiangqi mates only. */
  motifs: XiangqiMotifId[];
  solutionPlyCount: number;
  rating: number;
  ratingProvisional: boolean;
  // Attribution for the "From game" card (standard-xiangqi mined puzzles). The
  // source game is not hosted yet, so this is display-only, not a link.
  sourceGame?: {
    gameId: string;
    ply: number;
    event?: string;
    playedOn?: string;
    result?: string;
    redName?: string;
    blackName?: string;
  };
};

export type PuzzleDetail = PuzzleSummary & { initial: PuzzleState };

export type FeedbackKind = 'neutral' | 'good' | 'bad' | 'pending';

export type PuzzleSession = {
  // Fresh for every puzzle view and never reused across puzzles. This lets the
  // server aggregate anonymous quality outcomes without a cross-puzzle identity.
  qualitySessionId: string;
  puzzle: PuzzleDetail;
  state: PuzzleState;
  playedMoves: PuzzleMove[];
  solverMoves: PuzzleMove[];
  viewPly: number;
  selectedSquare: string | null;
  selectedDrop: string | null;
  draggingFrom: string | null;
  feedback: { kind: FeedbackKind; text: string };
  submitting: boolean;
  // True once the server confirmed the full solution line (attempt.complete).
  // Tracked on the session because winning-advantage puzzles complete mid-game:
  // their final state is still 'playing', so board status alone cannot signal
  // "solved" (and the next-puzzle CTA would never appear).
  solved: boolean;
  // Persistent (unlike feedback, which piece-selects reset to 'neutral'): set on
  // the first wrong move OR the first reveal/hint. Drives the always-visible
  // advance-to-next CTA + fail action row so a retry/select can't hide the way
  // out. The user may keep trying moves, take a hint, view the solution, or move
  // on — lichess "you failed this puzzle" semantics.
  failed: boolean;
  // The full solution has been fetched and played out; solving is locked (the
  // board becomes a replay of the answer). Distinct from `solved` (which shows
  // the Success panel) — a reveal is a give-up, not a win.
  revealed: boolean;
  // One-shot flag: focus the next-puzzle button on the render right after a
  // solve, so Enter or Space advances without reaching for the mouse.
  focusNext: boolean;
  // The viewer's "did you like this puzzle?" thumb vote, if any. Kept on the
  // session so the selected-button feedback survives renderSession() rebuilds
  // (the solved panel is rebuilt from scratch on every render). Voting shows
  // feedback in place and does NOT advance to the next puzzle.
  vote: 'up' | 'down' | null;
  // Post-completion engine analysis (adapters that expose createAnalysis).
  // Created lazily the first time a completed puzzle renders, then persists
  // across renderSession() rebuilds so the engine toggle + eval + arrows
  // survive a full re-render. Disposed when the session is replaced.
  analysis?: PuzzleAnalysisController | null;
};

export type PuzzleNavigation = {
  index: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
  goPrevious: () => void;
  goNext: () => void;
};

// A lichess-style local-engine surface shown once a puzzle is finished
// (solved, failed, or revealed): an on/off toggle, eval + principal-variation
// lines, and the engine's candidate moves drawn as arrows on the puzzle board.
export type PuzzleAnalysisController = {
  // The engine control bar + PV lines. Placed at the TOP of the move list so the
  // puzzle mirrors the analysis/review board's analyse table.
  engineEl: HTMLElement;
  // The "Open in analysis board" link. Placed on its own, below the scrub
  // controls (centered), so it reads as a jump-out affordance, not engine chrome.
  openLinkEl: HTMLElement;
  // Re-point the engine at the currently displayed (replay-aware) position and
  // (re-)apply the engine arrows to the freshly rebuilt board host. Called
  // after each render with the state the board just painted.
  refresh(session: PuzzleSession, displayState: PuzzleState, boardHost: HTMLElement): void;
  dispose(): void;
};

// Everything an adapter's paint/interaction code needs from the core. The
// callbacks route through the shared session machinery (attempt submission,
// re-render) so adapters never import the core module (no cycle).
export type PuzzleBoardContext = {
  session: PuzzleSession;
  /** Replay-aware state to paint: the live state, or the scrubbed reconstruction. */
  displayState: PuzzleState;
  renderSession: () => void;
  /** Submit a candidate solution move through the shared attempt path. */
  submitMove: (move: PuzzleMove) => Promise<void>;
};

/**
 * The per-variant contract. One adapter per GameSpecId with puzzles; the core
 * resolves adapters through puzzles/registry.ts (fail-closed: an unknown
 * variant throws, it never falls back to another variant's board).
 */
export type PuzzleBoardAdapter = {
  /** The GameSpecId this adapter serves (mirrors its registry key). */
  variant: string;
  /** Catalog key for the display name (variant picker, info card, "From set X").
   *  A key, not a literal: the name has to follow the visitor's locale. */
  labelKey: I18nKey;
  /** Variant marker id for the info-card icon. */
  markerId: VariantMiniId;
  /** Install the variant's board CSS once per puzzles mount. */
  installStyles?: () => void;
  /** Paint the interactive board (+ reserves) into the host and wire click/drag. */
  paintBoard(board: HTMLElement, ctx: PuzzleBoardContext): void;
  /**
   * Glide a board move on the mounted board. Called AFTER the render painted
   * the final position; drop moves never reach here (they stay discrete).
   */
  animateMove(
    board: HTMLElement,
    session: PuzzleSession,
    move: { from: string; to: string },
    opts: { reverse?: boolean },
  ): void;
  /** Apply a puzzle move to a state (replay/scrub reconstruction). */
  applyMove(state: PuzzleState, move: PuzzleMove): PuzzleState;
  /** Move-list label for one ply. */
  moveLabel(move: PuzzleMove): string;
  /** Side icon SVG for the feedback panel (the variant's "general"). */
  sideIconSvg(puzzle: PuzzleDetail): string;
  /** Post-completion engine analysis; omit when the variant has no client engine. */
  createAnalysis?: () => PuzzleAnalysisController;
};

// ── Pure session helpers (shared by the core and every adapter) ──────────────

export function isReplayLive(session: PuzzleSession): boolean {
  return session.viewPly >= session.playedMoves.length;
}

export function activeTurn(session: PuzzleSession): PuzzleColor {
  return session.state.status.type === 'playing'
    ? session.state.status.turn
    : (session.puzzle.sideToMove ?? 'red');
}

export function isSessionSolved(session: PuzzleSession): boolean {
  // `solved` mirrors the server's attempt.complete. Checking board status alone
  // missed winning-advantage puzzles, whose solution line ends while the game
  // is still in progress; a finished board still counts for mate/win lines.
  return session.solved || session.state.status.type === 'finished';
}

// The puzzle outcome is locked: solved, or the solution was revealed (a give-up
// that plays the answer out). A bare wrong move does NOT count — the trainer
// keeps solving open (retry / hint / view-solution), so the analysis engine
// stays hidden to avoid spoiling a still-open attempt.
export function isPuzzleComplete(session: PuzzleSession): boolean {
  return isSessionSolved(session) || session.revealed;
}

export function clonePuzzleState<State extends PuzzleState>(state: State): State {
  return deepCloneJson(state);
}

export function oppositePuzzleColor(color: PuzzleColor): PuzzleColor {
  return color === 'red' ? 'black' : 'red';
}

export function colorLabel(color: PuzzleColor | null): string {
  if (color === 'black') return t('setup.black');
  return t('setup.red');
}

export function dropRoleLabel(role: string): string {
  return `${role[0]?.toUpperCase() ?? ''}${role.slice(1)}`;
}
