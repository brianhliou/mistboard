/**
 * The trainer's feedback panels: the neutral/correct/try-again feedback card
 * with its assist row (hint / view solution / skip), and the terminal Success
 * and Solution panels with the next-puzzle CTA + thumb vote.
 */

import { t } from '../i18n/catalog.js';
import {
  colorLabel,
  isSessionSolved,
  type PuzzleNavigation,
  type PuzzleSession,
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
): HTMLElement {
  if (isSessionSolved(session)) return solvedPanel(session, navigation, renderSession, assist);
  if (session.revealed) return revealedPanel(navigation);

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
  body.textContent = session.feedback.text;
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
function revealedPanel(navigation: PuzzleNavigation): HTMLElement {
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

  panel.append(title, cont, feedbackRow);
  return panel;
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
      // Deliberately generic: the puzzle title names the piece + mate depth,
      // which would give the solution away.
      return t('puzzle.toMove', { color: colorLabel(session.puzzle.sideToMove) });
  }
}

const ICON_PLAY =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 3.2v9.6L12.5 8z" fill="currentColor"/></svg>';
const THUMB_UP_SVG =
  '<svg viewBox="0 0 64 64" width="76" height="76" aria-hidden="true"><path d="M23 54h-8a4 4 0 0 1-4-4V30a4 4 0 0 1 4-4h8v28Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M23 29c7-5 9-15 12-18 2-2 6-1 7 3 1 5-3 10-3 12h10c6 0 9 5 7 10l-5 13c-1 4-5 6-9 6H23V29Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';
const THUMB_DOWN_SVG =
  '<svg viewBox="0 0 64 64" width="76" height="76" aria-hidden="true"><path d="M41 10h8a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4h-8V10Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M41 35c-7 5-9 15-12 18-2 2-6 1-7-3-1-5 3-10 3-12H15c-6 0-9-5-7-10l5-13c1-4 5-6 9-6h19v26Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>';
