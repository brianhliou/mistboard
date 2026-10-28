import { puzzleAttemptedProps, track } from '../analytics.js';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { t } from '../i18n/catalog.js';
import type { PuzzleSolverHandle, PuzzleSolverOptions } from '../puzzles.js';
import { colorLabel, type PuzzleDetail, type PuzzleMove, type PuzzleSession } from './adapter.js';
import { type PuzzleAttempt, PuzzlePlayDisabledError, sendPuzzleQualityEvent } from './api.js';
import { puzzleInfoCard } from './queue-panel.js';
import { puzzleResultChips } from './result-chips.js';

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

// Lichess /streak shape: opening the page starts a run, with no start screen.
// The left card says what the mode is; the side panel is the streak count; a
// miss keeps the board on the failed puzzle, plays its answer, and turns the
// panel into Game over with the run's puzzles as chips and one New streak
// button. The open run's id is kept for the tab (sessionStorage), so a reload
// or a back/forward that rebuilds the page resumes it instead of starting a
// second one; a run is only created once the page is actually shown, never
// while it is prerendered or sitting in a background tab.
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
    const next = (await response.json()) as Run;
    rememberSeen(next.results.map((result) => result.id));
    return next;
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
    // An ended run is not resumed; an abandoned one (pagehide) still may be.
    if (reason !== 'abandoned') rememberRun(null);
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

  // The left card: what the mode is in two short lines, a sign-in line for a
  // guest (known once the run answers), the run so far, and practice. Desktop
  // only: the phone stack hides this column, and the side panel and Game over
  // carry the count, sign-in and chips there.
  const sideCard = (): { card: HTMLElement; progress: HTMLElement; signIn: HTMLElement | null } => {
    const card = document.createElement('section');
    card.className = 'puzzle-left-card puzzle-streak-side';
    const title = document.createElement('h1');
    title.textContent = t('puzzle.streakTitle');
    const rules = document.createElement('p');
    rules.textContent = t('puzzle.streakRules');
    const facts = document.createElement('p');
    facts.className = 'puzzle-streak-meta';
    facts.textContent = t('puzzle.streakFacts');
    card.append(title, rules, facts);
    const signIn = run && run.best === null ? bestLine(run, false) : null;
    if (signIn) card.append(signIn);
    // The run so far, with the puzzle in play as the last chip.
    const progress = document.createElement('div');
    progress.className = 'puzzle-streak-progress';
    card.append(progress, practiceLink());
    return { card, progress, signIn };
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
    const { card, progress, signIn } = sideCard();
    // The regular page's puzzle info card on top, as on Lichess's streak: the
    // rating stays hidden until the run is over.
    let info = streakInfoCard(current, false);
    controls.replaceChildren(info, card);
    const paintProgress = (): void => {
      progress.replaceChildren(...(run!.finished ? [] : [chips(run!.results, current!.id)]));
      // Game over carries its own sign-in line.
      if (signIn) signIn.hidden = run!.finished;
      if (run!.finished && info.dataset.revealed !== 'true') {
        const revealed = streakInfoCard(current!, true);
        info.replaceWith(revealed);
        info = revealed;
      }
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
      const recent = seenPuzzleIds();
      const nextRun = await request({ action: 'start', ...(recent.length ? { recent } : {}) });
      if (run && !run.finished) finished('abandoned');
      run = nextRun;
      bestAtStart = run.best;
      terminalSent = false;
      rememberRun(run.finished ? null : { runId: run.runId, bestAtStart });
      track('puzzle_mode_started', { mode: 'streak', variant: 'xiangqi' });
      if (run.finished) {
        finished('completed');
        showSummary();
      } else showBoard();
    } catch (error) {
      showStartError(errorText(error));
      if (control) control.disabled = false;
    } finally {
      busy = false;
    }
  }

  // A start that failed: before the first run the message and a retry sit in
  // the waiting board's side panel (shown on the phone too); after a run, by
  // the New streak button that was pressed.
  const showStartError = (text: string): void => {
    shell.querySelector('[data-streak-alert]')?.remove();
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.dataset.streakAlert = 'true';
    message.className = 'puzzles-status';
    message.textContent = text;
    const pending = detail.querySelector<HTMLElement>(
      '.puzzle-board-panel--pending .puzzle-side-panel',
    );
    if (pending) {
      const retry = button(t('puzzle.streakNewRun'), start);
      pending.replaceChildren(message, retry);
      return;
    }
    const over = shell.querySelector('.puzzle-streak-over');
    (over ?? controls.querySelector('.puzzle-streak-side') ?? shell).append(message);
  };

  // Resume the tab's open run if the server still has it open for this
  // player; otherwise start one.
  const begin = async (): Promise<void> => {
    const saved = rememberedRun();
    if (saved) {
      busy = true;
      try {
        const resumed = await request({ action: 'resume', runId: saved.runId });
        if (!resumed.finished && resumed.puzzle) {
          run = resumed;
          bestAtStart = saved.bestAtStart;
          terminalSent = false;
          showBoard();
          return;
        }
      } catch {
        // Gone, ended, or another account's: start fresh.
      } finally {
        busy = false;
      }
      rememberRun(null);
    }
    await start();
  };

  // The run layout from the first paint: the left card over the waiting board.
  shell.replaceChildren(layout);
  controls.replaceChildren(sideCard().card);
  window.addEventListener('pagehide', (event) => {
    // A page kept in the back/forward cache comes back with the run in play.
    if (event.persisted || !run || run.finished || terminalSent) return;
    if (current && !run.results.some((r) => r.id === current!.id)) attempted('abandoned');
    finished('abandoned');
  });
  void whenShown().then(begin);
}

const RUN_STORAGE_KEY = 'mistboard:puzzles:streak-run';
// The puzzles met in recent runs, oldest first, sent with a start so a new
// run draws others. The server reads an account's own runs; this covers guests.
const SEEN_STORAGE_KEY = 'mistboard:puzzles:streak-seen';
const SEEN_LIMIT = 120;

function seenPuzzleIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage?.getItem(SEEN_STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function rememberSeen(ids: readonly string[]): void {
  if (!ids.length) return;
  const seen = seenPuzzleIds();
  const fresh = ids.filter((id) => !seen.includes(id));
  if (!fresh.length) return;
  try {
    window.localStorage?.setItem(
      SEEN_STORAGE_KEY,
      JSON.stringify([...seen, ...fresh].slice(-SEEN_LIMIT)),
    );
  } catch {
    // Storage blocked: the server still shuffles each run.
  }
}
type RememberedRun = { runId: string; bestAtStart: number | null };

function rememberedRun(): RememberedRun | null {
  try {
    const raw = window.sessionStorage?.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<RememberedRun>;
    if (typeof value.runId !== 'string') return null;
    return {
      runId: value.runId,
      bestAtStart: typeof value.bestAtStart === 'number' ? value.bestAtStart : null,
    };
  } catch {
    return null;
  }
}

function rememberRun(value: RememberedRun | null): void {
  try {
    if (value) window.sessionStorage?.setItem(RUN_STORAGE_KEY, JSON.stringify(value));
    else window.sessionStorage?.removeItem(RUN_STORAGE_KEY);
  } catch {
    // Storage blocked: a reload then starts a new run, as before.
  }
}

// Resolves once the page is in front of someone: not while it is prerendered
// (a speculative load that may never show) or opened in a background tab.
function whenShown(): Promise<void> {
  const shown = (): boolean =>
    !(document as Document & { prerendering?: boolean }).prerendering &&
    document.visibilityState !== 'hidden';
  if (shown()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = (): void => {
      if (!shown()) return;
      document.removeEventListener('prerenderingchange', check);
      document.removeEventListener('visibilitychange', check);
      resolve();
    };
    document.addEventListener('prerenderingchange', check);
    document.addEventListener('visibilitychange', check);
  });
}

function streakInfoCard(puzzle: PuzzleDetail, over: boolean): HTMLElement {
  const card = puzzleInfoCard(puzzle, {
    rating: over ? puzzle.rating : null,
    status: null,
    goalRevealed: over,
  });
  if (over) card.dataset.revealed = 'true';
  return card;
}

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
  return puzzleResultChips(results, currentId, { label: t('puzzle.streakReview'), text: 'index' });
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
