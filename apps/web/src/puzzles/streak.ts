import { puzzleShortCode } from '@mistboard/game';
import { puzzleAttemptedProps, track } from '../analytics.js';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { t } from '../i18n/catalog.js';
import type { PuzzleSolverHandle, PuzzleSolverOptions } from '../puzzles.js';
import { colorLabel, type PuzzleDetail, type PuzzleMove, type PuzzleSession } from './adapter.js';
import { type PuzzleAttempt, PuzzlePlayDisabledError, sendPuzzleQualityEvent } from './api.js';

type Outcome = 'solved' | 'skipped' | 'failed';
type Run = {
  runId: string;
  score: number;
  best: number | null;
  skipUsed: boolean;
  finished: boolean;
  results: { id: string; outcome: Outcome }[];
  puzzle: PuzzleDetail | null;
  attempt?: PuzzleAttempt;
  // Sent only with the move that ends the run, so the board can play the
  // answer out without a /reveal (which would book a rated reveal).
  solution?: PuzzleMove[];
};

// Lichess /streak shape: the run lives on the puzzle page. The side panel is
// the streak count; a miss keeps the board on the failed puzzle, plays its
// answer, and turns the panel into Game over with the run's puzzles as chips
// and one New streak button.
export async function mountPuzzleStreak(
  frame: {
    shell: HTMLElement;
    detail: HTMLElement;
    controls: HTMLElement;
  },
  mountSolver: (
    puzzle: PuzzleDetail,
    opts: {
      submitAttempt: NonNullable<PuzzleSolverOptions['submitAttempt']>;
      feedback: (session: PuzzleSession) => HTMLElement;
      onAttempt: (attempt: PuzzleAttempt) => void;
    },
  ) => PuzzleSolverHandle,
): Promise<void> {
  const { shell, detail, controls } = frame;
  const layout = detail.parentElement!;
  shell.classList.add('puzzle-streak-shell');
  let run: Run | null = null;
  let solver: PuzzleSolverHandle | null = null;
  let current: PuzzleDetail | null = null;
  let terminalSent = false;
  let busy = false;
  // The best before this run, so Game over can say "New best!": the server's
  // best already counts the run in progress.
  let bestAtStart: number | null = null;
  let overFocused = false;

  const request = async (body: Record<string, unknown>): Promise<Run> => {
    const response = await fetch('/api/puzzles/streak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 403) throw new PuzzlePlayDisabledError('play disabled');
    if (!response.ok) throw new Error('Could not continue the run. Try again or start a new run.');
    return (await response.json()) as Run;
  };
  const attempted = (outcome: 'failed' | 'skipped' | 'abandoned'): void => {
    if (!current) return;
    track(
      'puzzle_attempted',
      puzzleAttemptedProps({
        puzzleId: current.id,
        variant: current.variant,
        themes: current.themes,
        rated: false,
        mode: 'streak',
        outcome,
        clean: false,
      }),
    );
  };
  const finished = (reason: 'failed' | 'completed' | 'abandoned'): void => {
    if (!run || terminalSent) return;
    terminalSent = true;
    track('puzzle_mode_finished', {
      mode: 'streak',
      variant: 'xiangqi',
      run_length: run.score,
      skip_used: run.skipUsed,
      reason,
    });
  };

  const gameOver = (): HTMLElement => {
    const panel = document.createElement('section');
    panel.className = 'puzzle-streak-over';
    const title = document.createElement('h2');
    title.className = 'puzzle-streak-over-title';
    title.textContent = t('puzzle.streakFinished');
    const newBest = run!.best !== null && run!.score > 0 && run!.score > (bestAtStart ?? 0);
    const score = streakCount(run!.score, t('puzzle.streakFinal'));
    score.dataset.streakScore = 'true';
    const meta = bestLine(run!, newBest);
    const cta = button(t('puzzle.streakNewRun'), start);
    cta.dataset.puzzleNext = 'true';
    panel.append(title, score, meta, chips(run!.results, null), cta, practiceLink());
    return panel;
  };

  const showSummary = (): void => {
    solver?.dispose();
    solver = null;
    const card = document.createElement('div');
    card.className = 'puzzle-streak-card puzzle-left-card';
    card.append(gameOver());
    shell.replaceChildren(card);
    card.querySelector<HTMLElement>('[data-puzzle-next="true"]')?.focus({ preventScroll: true });
  };

  const showBoard = (): void => {
    solver?.dispose();
    if (!run?.puzzle) {
      showSummary();
      return;
    }
    current = run.puzzle;
    overFocused = false;
    shell.replaceChildren(layout);
    controls.replaceChildren();
    const card = document.createElement('section');
    card.className = 'puzzle-left-card puzzle-streak-side';
    const title = document.createElement('h1');
    title.textContent = t('puzzle.streakTitle');
    const rules = document.createElement('p');
    rules.textContent = t('puzzle.streakRules');
    // The run so far, with the puzzle in play as the last chip. Desktop only:
    // the phone stack hides this column, and Game over carries the chips there.
    const progress = document.createElement('div');
    progress.className = 'puzzle-streak-progress';
    card.append(title, rules, progress, practiceLink());
    controls.append(card);
    const paintProgress = (): void => {
      progress.replaceChildren(...(run!.finished ? [] : [chips(run!.results, current!.id)]));
    };
    paintProgress();
    solver = mountSolver(current, {
      submitAttempt: async (id, moves, qualitySessionId) => {
        run = await request({
          action: 'move',
          runId: run!.runId,
          puzzleId: id,
          move: moves.at(-1),
          qualitySessionId,
        });
        if (!run.attempt) throw new Error('Missing attempt');
        return {
          attempt: run.attempt,
          rating: null,
          ...(run.solution ? { solution: run.solution } : {}),
        };
      },
      feedback: (session) => {
        paintProgress();
        if (run!.finished) {
          // Hand focus to New streak once, not to the heading.
          if (!overFocused) {
            overFocused = true;
            session.focusNext = true;
          }
          return gameOver();
        }
        const panel = document.createElement('div');
        panel.className = 'puzzle-feedback puzzle-streak-feedback';
        panel.setAttribute('aria-busy', String(session.submitting));
        const copy = document.createElement('div');
        copy.className = 'puzzle-feedback-copy';
        const count = streakCount(run!.score, t('puzzle.streakCount'));
        count.classList.add('puzzle-feedback-title');
        const meta = bestLine(run!, false);
        meta.classList.add('puzzle-feedback-meta');
        const prompt = document.createElement('span');
        prompt.className = 'puzzle-feedback-body';
        prompt.textContent = session.solved
          ? t('puzzle.streakCorrect')
          : session.feedback.kind === 'bad'
            ? session.feedback.text
            : t('puzzle.toMove', { color: colorLabel(current!.sideToMove) });
        const actions = document.createElement('div');
        actions.className = 'puzzle-assist-row';
        if (session.solved) {
          const next = button(t('puzzle.nextPuzzle'), showBoard);
          next.dataset.puzzleNext = 'true';
          actions.append(next);
        } else {
          const skip = quietButton(
            t(run!.skipUsed ? 'puzzle.streakSkipUsed' : 'puzzle.streakSkip'),
            async () => {
              if (busy || session.submitting || run!.skipUsed) return;
              busy = true;
              skip.disabled = true;
              try {
                run = await request({ action: 'skip', runId: run!.runId, puzzleId: current!.id });
                attempted('skipped');
                void sendPuzzleQualityEvent(current!.id, session.qualitySessionId, 'abandon').catch(
                  () => {},
                );
                if (run.finished) {
                  finished('completed');
                  solver?.end();
                } else showBoard();
              } catch (error) {
                prompt.textContent = errorText(error);
                skip.disabled = false;
                actions.append(button(t('puzzle.streakNewRun'), start));
              } finally {
                busy = false;
              }
            },
          );
          skip.dataset.streakSkip = 'true';
          skip.disabled = session.submitting || run!.skipUsed;
          actions.append(skip);
          // A check that failed in transit leaves the run open: offer a fresh
          // one beside the retry.
          if (session.feedback.kind === 'bad') {
            actions.append(quietButton(t('puzzle.streakNewRun'), start));
          }
        }
        copy.append(count, meta, prompt, actions);
        panel.append(copy);
        return panel;
      },
      onAttempt: (attempt) => {
        if (!attempt.ok) attempted('failed');
        if (run!.finished) finished(attempt.ok ? 'completed' : 'failed');
      },
    });
  };

  async function start(event?: Event): Promise<void> {
    if (busy) return;
    busy = true;
    const control = event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    if (control) control.disabled = true;
    try {
      const nextRun = await request({ action: 'start' });
      if (run && !run.finished) finished('abandoned');
      run = nextRun;
      bestAtStart = run.best;
      terminalSent = false;
      track('puzzle_mode_started', { mode: 'streak', variant: 'xiangqi' });
      if (run.finished) {
        finished('completed');
        showSummary();
      } else showBoard();
    } catch (error) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = errorText(error);
      const previous = shell.querySelector('[role="alert"]');
      if (previous) previous.replaceWith(message);
      else shell.append(message);
      if (control) control.disabled = false;
    } finally {
      busy = false;
    }
  }

  const intro = document.createElement('section');
  intro.className = 'puzzle-streak-card';
  const title = document.createElement('h1');
  title.textContent = t('puzzle.streakTitle');
  const rules = document.createElement('p');
  rules.textContent = t('puzzle.streakIntro');
  const account = document.createElement('p');
  account.textContent = t('puzzle.streakAccount');
  intro.append(title, rules, account, button(t('puzzle.streakStart'), start), practiceLink());
  shell.replaceChildren(intro);
  window.addEventListener(
    'pagehide',
    () => {
      if (!run || run.finished || terminalSent) return;
      if (current && !run.results.some((r) => r.id === current!.id)) attempted('abandoned');
      finished('abandoned');
    },
    { once: true },
  );
}

const OUTCOME_KEYS = {
  solved: 'puzzle.streakOutcomeSolved',
  skipped: 'puzzle.streakOutcomeSkipped',
  failed: 'puzzle.streakOutcomeFailed',
} as const;

// The streak as a big number over its label.
function streakCount(score: number, label: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'puzzle-streak-count';
  const value = document.createElement('strong');
  value.textContent = String(score);
  const caption = document.createElement('span');
  caption.textContent = label;
  block.append(value, caption);
  return block;
}

// Best for a signed-in player ("New best!" when this run beat it); a quiet
// sign-in line for a guest, whose best is not kept.
function bestLine(run: Run, newBest: boolean): HTMLElement {
  if (run.best === null) {
    const link = document.createElement('a');
    link.className = 'puzzle-streak-meta puzzle-streak-signin';
    link.href = loginHrefForCurrentPage();
    link.textContent = t('puzzle.streakSignInBest');
    return link;
  }
  const line = document.createElement('p');
  line.className = newBest ? 'puzzle-streak-meta puzzle-streak-new-best' : 'puzzle-streak-meta';
  line.textContent = newBest
    ? t('puzzle.streakNewBest')
    : t('puzzle.streakBest', { best: run.best });
  return line;
}

// One small numbered chip per puzzle in the run, each a link to that puzzle's
// own page; `currentId` adds the puzzle in play as an unlinked last chip.
function chips(results: Run['results'], currentId: string | null): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'puzzle-streak-chips';
  nav.setAttribute('aria-label', t('puzzle.streakReview'));
  results.forEach((result, index) => {
    const chip = document.createElement('a');
    chip.className = `puzzle-streak-chip puzzle-streak-chip--${result.outcome}`;
    chip.dataset.outcome = result.outcome;
    chip.href = `/puzzles/${encodeURIComponent(result.id)}`;
    chip.textContent = String(index + 1);
    const label = t('puzzle.streakResult', {
      code: puzzleShortCode(result.id),
      outcome: t(OUTCOME_KEYS[result.outcome]),
    });
    chip.title = label;
    chip.setAttribute('aria-label', label);
    nav.append(chip);
  });
  if (currentId && !results.some((r) => r.id === currentId)) {
    const chip = document.createElement('span');
    chip.className = 'puzzle-streak-chip puzzle-streak-chip--current';
    chip.setAttribute('aria-current', 'step');
    chip.textContent = String(results.length + 1);
    nav.append(chip);
  }
  return nav;
}

function errorText(error: unknown): string {
  return error instanceof PuzzlePlayDisabledError
    ? t('puzzle.streakPlayDisabled')
    : t('puzzle.streakContinueFailed');
}
function button(label: string, action: (event: Event) => void | Promise<void>): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'puzzle-continue-button';
  el.textContent = label;
  el.addEventListener('click', (event) => {
    void action(event);
  });
  return el;
}
function quietButton(label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const el = button(label, action);
  el.className = 'puzzle-feedback-skip';
  return el;
}
function practiceLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'puzzle-streak-practice';
  link.href = '/puzzles';
  link.textContent = t('puzzle.streakPractice');
  return link;
}
