/**
 * The trainer's two-column move list: [history..., setup?, ...solution] rows
 * with the active (scrubbed-to) ply highlighted. The history is the source
 * game's moves before the setup move, greyed and numbered as the game numbers
 * them, as lichess shows a puzzle's game. Move notation dispatches through the
 * variant adapter's moveLabels / historyLabels (position-aware) or moveLabel.
 */

import {
  oppositePuzzleColor,
  type PuzzleColor,
  type PuzzleMove,
  type PuzzleSession,
} from './adapter.js';
import { puzzleBoardAdapter } from './registry.js';

/**
 * `onJump`, when given, makes each move a click target that moves the replay
 * cursor to the position after it (its viewPly), so the live position is one
 * click on the current move away from anywhere in the history.
 */
export function moveListPanel(
  session: PuzzleSession,
  onJump?: (viewPly: number) => void,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'puzzle-moves';
  const list = document.createElement('ol');
  list.className = 'puzzle-move-list';
  const rows = puzzleMoveRows(session, onJump);
  for (const row of rows) {
    list.append(row);
  }
  panel.append(list);
  return panel;
}

/**
 * Scroll the move list (not the page) so the active ply is visible. The list is
 * rebuilt on every render, which resets its scroll, and on a phone it is a
 * one-line strip that scrolls sideways (puzzles.css), so a later ply would
 * otherwise sit out of sight while the arrows step to it. Handles both axes:
 * the desktop column scrolls down. Call after the list is in the document.
 */
export function keepActivePuzzleMoveInView(root: ParentNode): void {
  const list = root.querySelector<HTMLElement>('.puzzle-move-list');
  const cell = list?.querySelector<HTMLElement>('.puzzle-move-cell--active');
  const row = cell?.closest<HTMLElement>('.puzzle-move-item');
  if (!list || !cell || !row) return;
  const listBox = list.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  else if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
  // The phone's one-line strip scrolls sideways: bring the active ply in from
  // either edge with a little room, so it never sits clipped at the right.
  const cellBox = cell.getBoundingClientRect();
  const room = 12;
  if (cellBox.right > listBox.right - room) list.scrollLeft += cellBox.right - listBox.right + room;
  else if (cellBox.left < listBox.left + room && list.scrollLeft > 0)
    list.scrollLeft = Math.max(0, list.scrollLeft - (listBox.left + room - cellBox.left));
}

// The opponent's move that set up the puzzle (the mined blunder), if the initial
// state carries one. Prepended to the move list so it reads like a game and the
// opening position (viewPly 0) highlights the move that created the puzzle.
// Held back while the opening glide is pending (#664): the board still shows
// the position before it, so the move lands in the list as it lands on the board.
function puzzleSetupMove(session: PuzzleSession): PuzzleMove | null {
  if (session.setupIntro) return null;
  return session.puzzle.initial.lastMove ?? null;
}

// `mark` reads ✓ on a move the solver found (and, after Streak's miss, on the
// move that was right at that ply) and ✗ on a wrong try, kept on its own row
// under the row it belongs to, like a variation. `revealed` is a move the
// solution showed rather than the solver found.
type PuzzleMoveCell = {
  label: string;
  active: boolean;
  mark?: 'right' | 'wrong';
  revealed?: boolean;
  // A move of the source game before the puzzle: greyed, read-only.
  history?: boolean;
  // The viewPly the board shows after this move (absent on a wrong try).
  viewPly?: number;
};
type PuzzleMoveRowCells = { black?: PuzzleMoveCell; red?: PuzzleMoveCell };
type JumpTo = ((viewPly: number) => void) | undefined;

function puzzleMoveRows(session: PuzzleSession, onJump: JumpTo): HTMLElement[] {
  const solverColor = session.puzzle.sideToMove ?? 'red';
  const setup = puzzleSetupMove(session);
  const adapter = puzzleBoardAdapter(session.puzzle.variant);
  const history = session.history ?? [];
  const historyLabels =
    history.length > 0 ? adapter.historyLabels?.(session.puzzle, history) : undefined;

  // Combined list: [history..., setup?, ...solution]. With the source game's
  // history it alternates from the game's first move (red in xiangqi), so the
  // row numbers are the game's own. Without, the setup was the opponent's,
  // so it alternates from the opponent's color when a setup exists, and from
  // the solver's otherwise, numbered from 1.
  const labels = adapter.moveLabels?.(session.puzzle, session.playedMoves);
  type Entry = { label: string; solutionIndex: number | null; viewPly: number; history?: true };
  const combined: Entry[] = [];
  for (const [index, move] of history.entries()) {
    combined.push({
      label: historyLabels?.[index] ?? adapter.moveLabel(move),
      solutionIndex: null,
      viewPly: index - history.length,
      history: true,
    });
  }
  if (setup)
    combined.push({
      label: labels?.setup ?? adapter.moveLabel(setup),
      solutionIndex: null,
      viewPly: 0,
    });
  for (const [index, move] of session.playedMoves.entries()) {
    combined.push({
      label: labels?.played[index] ?? adapter.moveLabel(move),
      solutionIndex: index,
      viewPly: index + 1,
    });
  }

  const opener: PuzzleColor = setup ? oppositePuzzleColor(solverColor) : solverColor;
  // The history ends one move before the setup move (the opponent's), even
  // while the glide holds that move back.
  const firstColor: PuzzleColor =
    history.length > 0 ? moveColorAt(oppositePuzzleColor(solverColor), history.length) : opener;
  const setupOffset = history.length + (setup ? 1 : 0);
  // While the opening glide is pending the board shows the position before the
  // setup move, so the last history move is the current one.
  const activeViewPly = session.setupIntro ? -1 : session.viewPly;
  const revealedFrom = session.revealed ? (session.revealedFromPly ?? null) : null;

  const wrong = session.wrongMove ?? null;
  const rows = new Map<number, PuzzleMoveRowCells>();
  for (const [combinedIndex, entry] of combined.entries()) {
    const color = moveColorAt(firstColor, combinedIndex);
    const number = puzzleMoveRowNumber(firstColor, combinedIndex);
    const row = rows.get(number) ?? {};
    const index = entry.solutionIndex;
    const revealed = index !== null && revealedFrom !== null && index >= revealedFrom;
    // The solver's own plies are the even ones (the line opens with its move).
    const found = index !== null && index % 2 === 0 && !revealed;
    const rightAtMiss = wrong !== null && index === wrong.ply;
    row[color] = {
      label: entry.label,
      active: entry.viewPly === activeViewPly,
      viewPly: entry.viewPly,
      ...(entry.history ? { history: true } : {}),
      ...(found || rightAtMiss ? { mark: 'right' as const } : {}),
      ...(revealed ? { revealed: true } : {}),
    };
    rows.set(number, row);
  }

  // Wrong tries, each a ✗ row under the row of the ply it was tried at; a try
  // at a ply the solver has not got past yet sits under the last row.
  const tries = [...(session.wrongTries ?? []), ...(wrong ? [wrong] : [])];
  const variations = new Map<number, PuzzleMoveRowCells[]>();
  const seen = new Set<string>();
  for (const attempt of tries) {
    const before = session.playedMoves.slice(0, attempt.ply);
    const label =
      adapter.moveLabels?.(session.puzzle, [...before, attempt.move]).played[attempt.ply] ??
      adapter.moveLabel(attempt.move);
    const key = `${attempt.ply}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const combinedIndex = attempt.ply + setupOffset;
    const number = puzzleMoveRowNumber(firstColor, combinedIndex);
    const color = moveColorAt(firstColor, combinedIndex);
    const list = variations.get(number) ?? [];
    list.push({ [color]: { label, active: false, mark: 'wrong' } });
    variations.set(number, list);
  }
  const variationRow = (number: number, cells: PuzzleMoveRowCells): HTMLElement => {
    const item = puzzleMoveRow(number, cells, firstColor, undefined);
    item.classList.add('puzzle-move-variation');
    return item;
  };

  const out: HTMLElement[] = combined.length === 0 ? [puzzleMoveContextRow(session)] : [];
  for (const [number, row] of rows) {
    out.push(puzzleMoveRow(number, row, firstColor, session.setupIntro ? undefined : onJump));
    for (const cells of variations.get(number) ?? []) out.push(variationRow(number, cells));
    variations.delete(number);
  }
  for (const number of [...variations.keys()].sort((a, b) => a - b)) {
    for (const cells of variations.get(number) ?? []) out.push(variationRow(number, cells));
  }
  return out;
}

function puzzleMoveContextRow(session: PuzzleSession): HTMLElement {
  const firstColor = session.puzzle.sideToMove ?? 'red';
  const row = document.createElement('li');
  row.className = 'puzzle-move-item puzzle-move-context';
  const number = puzzleMoveCell('puzzle-move-number', '1');
  const red = puzzleMoveCell('puzzle-move-red', firstColor === 'black' ? '...' : '');
  const black = puzzleMoveCell('puzzle-move-black', firstColor === 'red' ? '...' : '');
  row.append(number, red, black);
  return row;
}

function puzzleMoveRow(
  number: number,
  rowMoves: PuzzleMoveRowCells,
  firstColor: PuzzleColor,
  onJump: JumpTo,
): HTMLElement {
  const row = document.createElement('li');
  row.className = 'puzzle-move-item';
  const numberCell = puzzleMoveCell('puzzle-move-number', String(number));
  // When the list leads with black (black-first solve, or a red-solve whose
  // setup move was black's), row 1 has no red move; show the "…" lead marker
  // (matching puzzleMoveContextRow) so the opening move reads as the reply.
  const blackLeads = firstColor === 'black';
  const redCell = puzzleMoveCell(
    'puzzle-move-red',
    rowMoves.red ? rowMoves.red.label : number === 1 && blackLeads ? '...' : '',
  );
  const blackCell = puzzleMoveCell('puzzle-move-black', rowMoves.black ? rowMoves.black.label : '');
  dressMoveCell(redCell, rowMoves.red, onJump);
  dressMoveCell(blackCell, rowMoves.black, onJump);
  row.append(numberCell, redCell, blackCell);
  return row;
}

function dressMoveCell(cell: HTMLElement, move: PuzzleMoveCell | undefined, onJump: JumpTo): void {
  if (!move) return;
  if (move.active) cell.classList.add('puzzle-move-cell--active');
  if (move.history) cell.classList.add('puzzle-move-cell--history');
  if (move.revealed) cell.classList.add('puzzle-move-cell--revealed');
  const target = move.viewPly;
  if (onJump && target !== undefined) {
    cell.classList.add('puzzle-move-cell--jump');
    cell.dataset.viewPly = String(target);
    cell.addEventListener('click', () => onJump(target));
  }
  const mark = move.mark;
  if (!mark) return;
  cell.classList.add(`puzzle-move-cell--${mark}`);
  const glyph = document.createElement('span');
  glyph.className = 'puzzle-move-mark';
  glyph.textContent = mark === 'right' ? ' ✓' : ' ✗';
  cell.append(glyph);
}

function puzzleMoveCell(className: string, text: string): HTMLSpanElement {
  const cell = document.createElement('span');
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function moveColorAt(firstColor: PuzzleColor, plyIndex: number): PuzzleColor {
  return plyIndex % 2 === 0 ? firstColor : oppositePuzzleColor(firstColor);
}

// Full-move number for a solution ply. Red always occupies the left column, so
// when BLACK moves first its opening move sits alone in row 1 (red cell blank),
// pushing red down one — otherwise black's move and red's reply would share a
// row and, printed red-cell-first, read in reversed order (e.g. "1. d2-d6 h7-h3"
// when black actually played h7-h3 first). Red-first is the ordinary chess case.
export function puzzleMoveRowNumber(firstColor: PuzzleColor, plyIndex: number): number {
  const leadOffset = firstColor === 'black' ? 1 : 0;
  return Math.floor((plyIndex + leadOffset) / 2) + 1;
}
