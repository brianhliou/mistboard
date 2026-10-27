import { puzzleShortCode } from '@mistboard/game';
import { puzzleAttemptedProps, track } from '../analytics.js';
import { colorLabel, type PuzzleDetail, type PuzzleSession } from './adapter.js';
import {
  type PuzzleAttempt,
  PuzzlePlayDisabledError,
  sendPuzzleQualityEvent,
  type submitPuzzleAttempt,
} from './api.js';

type Run = {
  runId: string;
  score: number;
  best: number | null;
  skipUsed: boolean;
  finished: boolean;
  results: { id: string; outcome: 'solved' | 'skipped' | 'failed' }[];
  puzzle: PuzzleDetail | null;
  attempt?: PuzzleAttempt;
};

export async function mountPuzzleStreak(
  frame: {
    shell: HTMLElement;
    detail: HTMLElement;
    controls: HTMLElement;
  },
  mountSolver: (
    puzzle: PuzzleDetail,
    opts: {
      submitAttempt: typeof submitPuzzleAttempt;
      feedback: (session: PuzzleSession) => HTMLElement;
      onAttempt: (attempt: PuzzleAttempt) => void;
    },
  ) => { dispose(): void },
): Promise<void> {
  const { shell, detail, controls } = frame;
  const layout = detail.parentElement!;
  shell.classList.add('puzzle-streak-shell');
  let run: Run | null = null;
  let solver: { dispose(): void } | null = null;
  let current: PuzzleDetail | null = null;
  let terminalSent = false;
  let busy = false;

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
  const showSummary = (): void => {
    solver?.dispose();
    solver = null;
    const card = document.createElement('section');
    card.className = 'puzzle-streak-card';
    const title = document.createElement('h1');
    title.textContent = 'Streak finished';
    const score = document.createElement('p');
    score.dataset.streakScore = 'true';
    score.textContent = `Solved: ${run!.score} · ${bestLabel(run!)}`;
    const list = document.createElement('ol');
    list.setAttribute('aria-label', 'Review this run');
    for (const result of run!.results) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/puzzles/${encodeURIComponent(result.id)}`;
      link.textContent = `Puzzle #${puzzleShortCode(result.id)}: ${result.outcome}`;
      item.append(link);
      list.append(item);
    }
    card.append(title, score, button('Play again', start), practiceLink(), list);
    shell.replaceChildren(card);
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  };
  const showBoard = (): void => {
    solver?.dispose();
    if (!run?.puzzle) {
      showSummary();
      return;
    }
    current = run.puzzle;
    shell.replaceChildren(layout);
    controls.replaceChildren();
    const card = document.createElement('section');
    card.className = 'puzzle-left-card';
    const title = document.createElement('h1');
    title.textContent = 'Puzzle Streak';
    const rules = document.createElement('p');
    rules.textContent = 'Puzzles get harder. One wrong move ends the run. No clock. One skip.';
    card.append(title, rules, practiceLink());
    controls.append(card);
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
        return { attempt: run.attempt, rating: null };
      },
      feedback: (session) => {
        const panel = document.createElement('div');
        panel.className = 'puzzle-feedback puzzle-streak-feedback';
        panel.setAttribute('aria-busy', String(session.submitting));
        const copy = document.createElement('div');
        copy.className = 'puzzle-feedback-copy';
        const title = document.createElement('h2');
        title.className = 'puzzle-feedback-title';
        title.textContent = `Streak: ${run!.score} · ${bestLabel(run!)}`;
        const prompt = document.createElement('span');
        prompt.className = 'puzzle-feedback-body';
        prompt.textContent = session.solved
          ? 'Correct!'
          : session.feedback.kind === 'bad'
            ? session.feedback.text
            : `${colorLabel(current!.sideToMove)} to move`;
        const actions = document.createElement('div');
        actions.className = 'puzzle-assist-row';
        if (session.solved) {
          actions.append(button('Next puzzle', showBoard));
        } else {
          const skip = button(run!.skipUsed ? 'Skip used' : 'Skip (1 left)', async () => {
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
                showSummary();
              } else showBoard();
            } catch (error) {
              prompt.textContent = errorText(error);
              skip.disabled = false;
              actions.append(button('New run', start));
            } finally {
              busy = false;
            }
          });
          skip.disabled = session.submitting || run!.skipUsed;
          actions.append(skip);
          if (session.feedback.kind === 'bad') actions.append(button('New run', start));
        }
        copy.append(title, prompt, actions);
        panel.append(copy);
        return panel;
      },
      onAttempt: (attempt) => {
        if (!attempt.ok) attempted('failed');
        if (run!.finished) {
          finished(attempt.ok ? 'completed' : 'failed');
          showSummary();
        }
      },
    });
  };
  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    const control = shell.querySelector<HTMLButtonElement>('button');
    if (control) control.disabled = true;
    try {
      const nextRun = await request({ action: 'start' });
      if (run && !run.finished) finished('abandoned');
      run = nextRun;
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
  title.textContent = 'Puzzle Streak';
  const rules = document.createElement('p');
  rules.textContent =
    'Start easy and solve progressively harder puzzles. One wrong move ends your run. No clock. One skip per run.';
  const account = document.createElement('p');
  account.textContent =
    'Play as a guest, or sign in to save your best streak. Streak does not change your puzzle rating.';
  intro.append(title, rules, account, button('Start streak', start), practiceLink());
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

function bestLabel(run: Run): string {
  return run.best === null ? 'Guest' : `Best: ${run.best}`;
}
function errorText(error: unknown): string {
  return error instanceof PuzzlePlayDisabledError
    ? 'Puzzle play is disabled for this account.'
    : 'Could not continue the run. Try again or start a new run.';
}
function button(label: string, action: () => void | Promise<void>): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'puzzle-continue-button';
  el.textContent = label;
  el.addEventListener('click', () => {
    void action();
  });
  return el;
}
function practiceLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '/puzzles';
  link.textContent = 'Puzzle practice';
  return link;
}
