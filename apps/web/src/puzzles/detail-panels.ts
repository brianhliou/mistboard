/**
 * The trainer's feedback panels: the neutral/correct/try-again feedback card
 * with its assist row (hint / view solution / skip), and the terminal Success
 * and Solution panels with the next-puzzle CTA + thumb vote.
 */

import {
  getStandardXiangqiLegalMoves,
  standardXiangqiEngineFen,
  XIANGQI_SPEC_ID,
  type XiangqiGameState,
} from '@mistboard/game';
import { track } from '../analytics.js';
import { t } from '../i18n/catalog.js';
import { deviceIdForBrowser } from '../live-state.js';
import { practicePositionHref } from '../practice-position-params.js';
import { buildUiIcon } from '../ui-icon.js';
import {
  colorLabel,
  isPuzzleComplete,
  isSessionSolved,
  type PuzzleNavigation,
  type PuzzleSession,
  type PuzzleState,
  puzzleGoalLabel,
  puzzleSolvePrompt,
} from './adapter.js';
import { puzzleBoardAdapter } from './registry.js';

// The hint / view-solution actions live in the core (they drive the session
// state machine + server round-trips); the panel gets them as callbacks.
export type PuzzleAssistHooks = {
  onHint: () => void;
  onReveal: () => void;
  onVote: (vote: 'up' | 'down' | null) => void;
};

export function feedbackPanel(
  session: PuzzleSession,
  navigation: PuzzleNavigation,
  renderSession: () => void,
  assist: PuzzleAssistHooks,
  _displayState: PuzzleState,
): HTMLElement {
  // Revealed first: a played-out mate line finishes the board, which would
  // otherwise read as solved and show "Success!" for a give-up.
  if (session.revealed) return revealedPanel(session, navigation, renderSession, assist);
  if (isSessionSolved(session)) return solvedPanel(session, navigation, renderSession, assist);

  const panel = document.createElement('div');
  panel.className = `puzzle-feedback puzzle-feedback--${session.feedback.kind}`;
  const icon = document.createElement('span');
  icon.className = 'puzzle-feedback-icon';
  // The general (xiangqi "king") of the side to move, rendered in the user's
  // chosen piece set — the icon matches the board's variant + skin.
  icon.innerHTML = puzzleBoardAdapter(session.puzzle.variant).sideIconSvg(session.puzzle);
  icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  copy.className = 'puzzle-feedback-copy';
  const title = document.createElement('h2');
  title.className = 'puzzle-feedback-title';
  title.textContent = feedbackTitle(session);
  const body = document.createElement('span');
  body.className = 'puzzle-feedback-body';
  body.textContent =
    session.feedback.kind === 'neutral' &&
    session.puzzle.goal.type === 'checkmate' &&
    session.selectedSquare === null
      ? t('puzzle.toMove', { color: colorLabel(session.puzzle.sideToMove) })
      : session.feedback.text;
  copy.append(title, body, assistRow(session, navigation, assist));
  panel.append(icon, copy);
  return panel;
}

// Persistent escape hatches while a puzzle is unsolved. Hint + view-solution are
// always available (they double as give-up; using either books a failed attempt
// server-side). The advance-to-next CTA appears only once the puzzle is failed,
// and — because it keys on session.failed, not the transient feedback kind — it
// survives the piece-select feedback reset (so a retry can't hide the way out).
function assistRow(
  session: PuzzleSession,
  navigation: PuzzleNavigation,
  assist: PuzzleAssistHooks,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'puzzle-assist-row';

  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'puzzle-feedback-skip puzzle-assist-hint';
  hint.dataset.puzzleHint = 'true';
  hint.textContent = t('puzzle.getHint');
  hint.disabled = session.submitting;
  hint.addEventListener('click', assist.onHint);

  const solution = document.createElement('button');
  solution.type = 'button';
  solution.className = 'puzzle-feedback-skip puzzle-assist-solution';
  solution.dataset.puzzleReveal = 'true';
  solution.textContent = t('puzzle.viewSolution');
  solution.disabled = session.submitting;
  solution.addEventListener('click', assist.onReveal);

  row.append(hint, solution);

  if (session.failed && navigation.hasNext) {
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'puzzle-feedback-skip puzzle-assist-next';
    skip.dataset.puzzleSkip = 'true';
    skip.textContent = t('puzzle.skipToNext');
    skip.addEventListener('click', navigation.goNext);
    row.append(skip);
  }
  return row;
}

// Shown after "View solution": the answer has been played out and the board is a
// locked replay to scrub. Distinct from the solved panel (no "Success!") — a
// reveal counts as a give-up, not a win.
function revealedPanel(
  session: PuzzleSession,
  navigation: PuzzleNavigation,
  renderSession: () => void,
  assist: PuzzleAssistHooks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'puzzle-solved-panel puzzle-revealed-panel';

  const title = document.createElement('h2');
  title.textContent = t('puzzle.solution');

  const cont = document.createElement('button');
  cont.type = 'button';
  cont.className = 'puzzle-continue-button';
  cont.dataset.puzzleNext = 'true';
  cont.innerHTML = `${ICON_PLAY}<span></span>`;
  (cont.lastElementChild as HTMLElement).textContent = t('puzzle.nextPuzzle');
  cont.setAttribute('aria-label', t('puzzle.nextPuzzle'));
  cont.disabled = !navigation.hasNext;
  cont.addEventListener('click', navigation.goNext);

  panel.append(title, cont);
  panel.append(solvedFeedback(session, renderSession, assist));
  panel.append(puzzleReportControl(session));
  return panel;
}

function solvedPanel(
  session: PuzzleSession,
  navigation: PuzzleNavigation,
  renderSession: () => void,
  assist: PuzzleAssistHooks,
): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'puzzle-solved-panel';

  const title = document.createElement('h2');
  title.textContent = t('puzzle.success');

  // Prominent primary CTA (lichess-style bar), in Mistboard's own accent. It
  // advances along the visit's rotated queue and is focused on solve (see
  // renderPuzzleDetail) so Enter or Space moves on immediately.
  const cont = document.createElement('button');
  cont.type = 'button';
  cont.className = 'puzzle-continue-button';
  cont.dataset.puzzleNext = 'true';
  cont.innerHTML = `${ICON_PLAY}<span></span>`;
  (cont.lastElementChild as HTMLElement).textContent = t('puzzle.nextPuzzle');
  cont.setAttribute('aria-label', t('puzzle.nextPuzzle'));
  cont.disabled = !navigation.hasNext;
  cont.addEventListener('click', navigation.goNext);

  panel.append(title, cont);
  panel.append(solvedFeedback(session, renderSession, assist));
  panel.append(puzzleReportControl(session));
  return panel;
}

function solvedFeedback(
  session: PuzzleSession,
  renderSession: () => void,
  assist: PuzzleAssistHooks,
): HTMLElement {
  const feedbackRow = document.createElement('div');
  feedbackRow.className = 'puzzle-solved-feedback';
  // Standard xiangqi now gets an inline local-engine analysis panel below (see
  // renderPuzzleDetail), so the old disabled "analysis board" stub is gone.
  const prompt = document.createElement('span');
  prompt.className = 'puzzle-vote-prompt';
  prompt.textContent = session.vote ? t('puzzle.voteThanks') : t('puzzle.votePrompt');
  const votes = document.createElement('div');
  votes.className = 'puzzle-vote-actions';
  votes.append(
    puzzleVoteButton('up', session, renderSession, assist),
    puzzleVoteButton('down', session, renderSession, assist),
  );
  feedbackRow.append(prompt, votes);
  return feedbackRow;
}

export function puzzlePlayPosition(
  session: PuzzleSession,
  displayState: PuzzleState,
): HTMLAnchorElement | null {
  if (!isPuzzleComplete(session)) return null;
  // Use the board's replay-aware state, including steps before a final mate.
  // This practice route only understands standard xiangqi.
  if (session.puzzle.variant !== XIANGQI_SPEC_ID || !session.puzzle.sideToMove) return null;
  const state = displayState as XiangqiGameState;
  if (state.status.type !== 'playing' || getStandardXiangqiLegalMoves(state).length === 0)
    return null;

  const link = document.createElement('a');
  link.className = 'puzzle-play-position';
  link.dataset.puzzlePlayPosition = 'true';
  // A quiet text link under Next puzzle, kept out of the vote row so it does
  // not read as a third rating button.
  link.title = t('lobby.panelTabComputer');
  // The words hide in the phone strip; the label keeps the icon named.
  link.setAttribute('aria-label', link.title);
  const label = document.createElement('span');
  label.textContent = link.title;
  link.append(buildUiIcon('play-engine'), label);
  link.target = '_blank';
  link.rel = 'noopener';
  link.href = practicePositionHref(
    standardXiangqiEngineFen(state),
    'mate',
    session.puzzle.sideToMove,
  );
  const ply = session.viewPly;
  link.addEventListener('click', () => {
    track('puzzle_play_position', {
      puzzle_id: session.puzzle.id,
      outcome: session.revealed ? 'revealed' : session.failed ? 'failed' : 'solved',
      ply,
    });
  });
  return link;
}

const reportStates = new WeakMap<
  PuzzleSession,
  {
    pending: boolean;
    sent: boolean;
    reason: string;
    dialog?: HTMLDialogElement;
    trigger?: HTMLButtonElement;
    home?: HTMLElement;
    closeOnNavigation?: () => void;
  }
>();

function puzzleReportControl(session: PuzzleSession): HTMLElement {
  let state = reportStates.get(session);
  if (!state) {
    state = { pending: false, sent: false, reason: 'wrong-solution' };
    reportStates.set(session, state);
  }
  const reportState = state;
  const details = document.createElement('div');
  details.className = 'puzzle-report';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'puzzle-report-link';
  link.textContent = reportState.sent ? t('puzzle.reportSent') : t('puzzle.reportProblem');
  details.append(link);
  reportState.trigger = link;
  reportState.home = details;
  if (reportState.sent) {
    link.disabled = true;
    return details;
  }
  const open = (): void => {
    const dialog = reportState.dialog!;
    // Solution playback rebuilds the trainer. Keep an open form outside that
    // subtree so its focus, pending send and error feedback survive each ply.
    document.body.append(dialog);
    dialog.showModal();
    window.addEventListener('popstate', closeOnNavigation);
  };
  reportState.closeOnNavigation ??= () => reportState.dialog?.close();
  const closeOnNavigation = reportState.closeOnNavigation;
  link.addEventListener('click', open);
  if (reportState.dialog) {
    if (!reportState.dialog.open) details.append(reportState.dialog);
    return details;
  }

  const dialog = document.createElement('dialog');
  reportState.dialog = dialog;
  dialog.className = 'puzzle-report-dialog';
  dialog.setAttribute('aria-label', t('puzzle.reportProblem'));
  const heading = document.createElement('h2');
  heading.textContent = t('puzzle.reportProblem');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'puzzle-feedback-skip';
  close.textContent = t('setup.cancel');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    window.removeEventListener('popstate', closeOnNavigation);
    if (reportState.home?.isConnected) reportState.home.append(dialog);
    else dialog.remove();
    reportState.trigger?.focus({ preventScroll: true });
  });
  const form = document.createElement('form');
  const label = document.createElement('label');
  label.textContent = t('puzzle.reportReasonLabel');
  const reason = document.createElement('select');
  reason.className = 'puzzle-select';
  reason.setAttribute('aria-label', t('puzzle.reportReasonAria'));
  for (const [value, key] of [
    ['wrong-solution', 'puzzle.reportWrongSolution'],
    ['second-winning-move', 'puzzle.reportSecondMove'],
    ['wrong-theme', 'puzzle.reportWrongTheme'],
    ['other', 'puzzle.reportOther'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = t(key);
    reason.append(option);
  }
  reason.value = reportState.reason;
  reason.addEventListener('change', () => {
    reportState.reason = reason.value;
  });
  label.append(reason);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'puzzle-feedback-skip';
  send.textContent = reportState.pending ? t('puzzle.reportSending') : t('puzzle.reportSend');
  send.disabled = reportState.pending;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  form.append(label, send, close, status);
  dialog.append(heading, form);
  details.append(dialog);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (reportState.pending || reportState.sent) return;
    reportState.pending = true;
    send.disabled = true;
    // Revealing plays the answer over a rejected move. Preserve that actual
    // try, so the report's position and move still explain a second answer.
    const wrong = session.wrongTries?.slice(-1)[0] ?? session.wrongMove;
    const moves = wrong
      ? [...session.solverMoves.slice(0, Math.floor(wrong.ply / 2)), wrong.move]
      : [...session.solverMoves];
    try {
      const response = await fetch(`/api/puzzles/${encodeURIComponent(session.puzzle.id)}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reason: reason.value,
          deviceId: deviceIdForBrowser() ?? session.qualitySessionId,
          moves,
        }),
      });
      if (!response.ok) throw new Error('report failed');
      reportState.sent = true;
      reportState.trigger!.textContent = t('puzzle.reportSent');
      reportState.trigger!.setAttribute('role', 'status');
      reportState.trigger!.disabled = true;
      form.hidden = true;
      dialog.close();
    } catch {
      status.textContent = t('puzzle.reportFailed');
    } finally {
      reportState.pending = false;
      send.disabled = reportState.sent;
    }
  });
  return details;
}

// The thumb vote records a like/dislike and shows in-place feedback (the chosen
// button reads as selected). It deliberately does NOT advance to the next
// puzzle — advancing is the "Next puzzle" CTA's job.
function puzzleVoteButton(
  kind: 'up' | 'down',
  session: PuzzleSession,
  renderSession: () => void,
  assist: PuzzleAssistHooks,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  const selected = session.vote === kind;
  button.className = `puzzle-vote-button puzzle-vote-button--${kind}${
    selected ? ' puzzle-vote-button--selected' : ''
  }`;
  button.setAttribute('aria-label', kind === 'up' ? t('puzzle.voteUp') : t('puzzle.voteDown'));
  button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  button.innerHTML = kind === 'up' ? THUMB_UP_SVG : THUMB_DOWN_SVG;
  button.addEventListener('click', () => {
    // Toggle off if re-clicking the current vote, else set it. Re-render so both
    // buttons reflect the new state (and the prompt updates).
    session.vote = session.vote === kind ? null : kind;
    assist.onVote(session.vote);
    renderSession();
  });
  return button;
}

function feedbackTitle(session: PuzzleSession): string {
  switch (session.feedback.kind) {
    case 'good':
      return isSessionSolved(session) ? t('puzzle.statusSolved') : t('puzzle.statusCorrect');
    case 'bad':
      return t('puzzle.statusTryAgain');
    case 'pending':
      return t('puzzle.statusChecking');
    case 'neutral':
      return session.puzzle.goal.type === 'checkmate'
        ? puzzleGoalLabel(session.puzzle)
        : puzzleSolvePrompt(session.puzzle);
  }
}

const ICON_PLAY =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 3.2v9.6L12.5 8z" fill="currentColor"/></svg>';
const THUMB_UP_SVG =
  '<svg viewBox="0 0 64 64" width="76" height="76" aria-hidden="true"><path d="M23 54h-8a4 4 0 0 1-4-4V30a4 4 0 0 1 4-4h8v28Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23 29c7-5 9-15 12-18 2-2 6-1 7 3 1 5-3 10-3 12h10c6 0 9 5 7 10l-5 13c-1 4-5 6-9 6H23V29Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';
const THUMB_DOWN_SVG =
  '<svg viewBox="0 0 64 64" width="76" height="76" aria-hidden="true"><path d="M41 10h8a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-8V10Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M41 35c-7 5-9 15-12 18-2 2-6 1-7-3-1-5 3-10 3-12H15c-6 0-9-5-7-10l5-13c1-4 5-6 9-6h19v26Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';
