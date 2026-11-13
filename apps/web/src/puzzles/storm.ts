import { track } from '../analytics.js';
import { t } from '../i18n/catalog.js';
import type { PuzzleSolverHandle, PuzzleSolverOptions } from '../puzzles.js';
import { type PuzzleDetail, type PuzzleSession, puzzleSolvePrompt } from './adapter.js';
import { fetchPuzzleDetail, type PuzzleAttempt, PuzzlePlayDisabledError } from './api.js';
import { puzzleResultChips } from './result-chips.js';
import { signInCta } from './sign-in-cta.js';

type StormRun = {
  runId: string;
  version: number;
  score: number;
  combo: number;
  best: number | null;
  dailyBest: number | null;
  startedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number;
  finished: boolean;
  results: { id: string; outcome: 'solved' | 'failed' }[];
  puzzle: PuzzleDetail | null;
  upcoming: PuzzleDetail[];
  progress: Extract<PuzzleAttempt, { ok: true }> | null;
  attempt?: PuzzleAttempt;
};
type Frame = { shell: HTMLElement; detail: HTMLElement; controls: HTMLElement };
type MountSolver = (puzzle: PuzzleDetail, options: PuzzleSolverOptions) => PuzzleSolverHandle;
type SavedRun = { runId: string; finished: boolean };
const RUN_KEY = 'mistboard:puzzles:storm-run';
const SEEN_KEY = 'mistboard:puzzles:storm-seen';

// The server owns all scoring and timing. performance.now keeps the displayed
// countdown independent of the phone's wall clock, including a clock change.
// No answer is guessed locally: each accepted response carries the next board.
export async function mountPuzzleStorm(frame: Frame, mountSolver: MountSolver): Promise<void> {
  const { shell, detail, controls } = frame;
  const layout = detail.parentElement!;
  shell.classList.add('puzzle-streak-shell', 'puzzle-storm-shell');
  let run: StormRun | null = null;
  let solver: PuzzleSolverHandle | null = null;
  let deadline = 0;
  let busy = false;
  let stopped = false;
  let terminalSent = false;
  let error: unknown = null;
  let change = '';
  let reviewing = false;
  let reviewToken = 0;
  let resumeId = rememberedRun()?.runId ?? null;
  let pendingReviewId = new URLSearchParams(window.location.search).get('review');

  const active = (): boolean => !stopped && shell.isConnected;
  const remaining = (): number =>
    run?.deadlineAt === null ? run.remainingMs : Math.max(0, deadline - performance.now());
  const request = async (body: Record<string, unknown>): Promise<StormRun> => {
    const sent = performance.now();
    const response = await fetch('/api/puzzles/storm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 403) throw new PuzzlePlayDisabledError('play disabled');
    if (!response.ok) throw new Error(String(response.status));
    const next = (await response.json()) as StormRun;
    if (!active()) throw new Error('Page left');
    // Subtract the whole round trip conservatively; expiry is always confirmed
    // through resume, so a slow response cannot end a run that earned time.
    deadline = performance.now() + Math.max(0, next.remainingMs - (performance.now() - sent));
    return next;
  };
  const adopt = (next: StormRun): void => {
    change = '';
    if (run && next.runId === run.runId && next.version > run.version && next.deadlineAt !== null) {
      const delta = next.deadlineAt - (run.deadlineAt ?? next.startedAt! + 180_000);
      if (delta) change = `${delta > 0 ? '+' : '−'}${Math.abs(delta) / 1000}s`;
    }
    const completed = run !== null && !run.finished && next.finished;
    run = next;
    resumeId = null;
    error = null;
    shell.classList.remove('puzzle-storm-error');
    // Results belong to this run too; reload must not start another clock.
    rememberRun({ runId: next.runId, finished: next.finished });
    rememberSeen(next.results.map((result) => result.id));
    if (completed) finish();
  };
  const finish = (): void => {
    if (!run || terminalSent) return;
    terminalSent = true;
    track('puzzle_mode_finished', {
      mode: 'storm',
      variant: 'xiangqi',
      run_length: run.score,
      reason: 'completed',
    });
  };
  const clock = (): HTMLElement => {
    const el = document.createElement('strong');
    el.dataset.stormClock = 'true';
    el.setAttribute('role', 'timer');
    el.setAttribute('aria-label', t('puzzle.stormTime'));
    el.textContent = clockText(run?.finished ? 0 : remaining());
    return el;
  };
  const tally = (): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'puzzle-storm-tally';
    for (const [key, label, value] of [
      ['score', t('puzzle.stormScore'), run?.score ?? 0],
      ['combo', t('puzzle.stormCombo'), run?.combo ?? 0],
    ] as const) {
      const block = document.createElement('div');
      const number = document.createElement('strong');
      number.dataset[key === 'score' ? 'stormScore' : 'stormCombo'] = 'true';
      number.textContent = String(value);
      const caption = document.createElement('span');
      caption.textContent = label;
      block.append(number, caption);
      row.append(block);
    }
    return row;
  };
  const recovery = (): HTMLElement => {
    const box = document.createElement('div');
    box.className = 'puzzle-storm-recovery';
    if (error) {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = t(
        error instanceof PuzzlePlayDisabledError
          ? 'puzzle.streakPlayDisabled'
          : 'puzzle.stormContinueFailed',
      );
      box.append(message);
      const canResume = (run && !run.finished) || resumeId;
      if (canResume || !(error instanceof PuzzlePlayDisabledError)) {
        box.append(
          button(
            t(canResume ? 'puzzle.stormResume' : 'puzzle.stormNewRun'),
            canResume ? resume : start,
          ),
        );
      }
    }
    return box;
  };
  const bestRuns = (): void => {
    layout.querySelector('.puzzle-storm-bests')?.remove();
    if (!run || run.best === null) return;
    const row = document.createElement('section');
    row.className = 'puzzle-storm-bests';
    row.setAttribute('aria-label', t('puzzle.stormBestRuns'));
    const heading = document.createElement('h2');
    heading.textContent = t('puzzle.stormBestRuns');
    row.append(heading);
    for (const [label, value] of [
      [t('puzzle.stormAllTime'), run.best],
      [t('puzzle.stormToday'), run.dailyBest ?? 0],
    ] as const) {
      const tile = document.createElement('div');
      const score = document.createElement('strong');
      score.textContent = String(value);
      const caption = document.createElement('span');
      caption.textContent = label;
      tile.append(score, caption);
      row.append(tile);
    }
    // The row closes the panel, so the run's numbers read as one block.
    (
      layout.querySelector('.puzzle-storm-feedback, .puzzle-storm-results') ??
      layout.querySelector('.puzzle-side-panel') ??
      layout
    ).append(row);
  };
  const panelIntro = (status: string): HTMLElement => {
    const header = document.createElement('header');
    const title = document.createElement('h1');
    title.textContent = t('puzzle.stormTitle');
    const prompt = document.createElement('p');
    prompt.className = 'puzzle-storm-status';
    prompt.textContent = status;
    header.append(title, prompt);
    return header;
  };
  const feedback = (session: PuzzleSession): HTMLElement => {
    shell.classList.toggle('puzzle-storm-error', Boolean(error));
    const panel = document.createElement('section');
    panel.className = 'puzzle-storm-feedback';
    panel.setAttribute('aria-busy', String(session.submitting));
    const status =
      run?.deadlineAt === null
        ? session.puzzle.goal.type === 'checkmate'
          ? `${puzzleSolvePrompt(session.puzzle)} · ${t('puzzle.stormMoveToStart')}`
          : t('puzzle.stormMoveToStart')
        : puzzleSolvePrompt(session.puzzle);
    const delta = document.createElement('span');
    delta.dataset.stormChange = 'true';
    delta.setAttribute('role', 'status');
    delta.textContent = change;
    const rules = document.createElement('p');
    rules.className = 'puzzle-storm-rules';
    rules.textContent = `${t('puzzle.stormRules')} ${t('puzzle.stormFacts')}`;
    panel.append(panelIntro(status), clock(), delta, tally(), rules);
    if (run?.best === null) panel.append(signInCta(t('puzzle.streakSignInBest')));
    panel.append(recovery());
    return panel;
  };
  const showSummary = (): void => {
    if (!run || !active()) return;
    ++reviewToken;
    reviewing = false;
    shell.classList.remove('puzzle-storm-reviewing');
    solver?.dispose();
    solver = null;
    const card = document.createElement('section');
    card.className = 'puzzle-storm-results';
    card.dataset.stormResults = 'true';
    const title = document.createElement('h1');
    title.textContent = t('puzzle.stormFinished');
    const chips = puzzleResultChips(run.results, null, {
      label: t('puzzle.streakReview'),
      text: 'index',
      onPick: (id) => void review(id),
    });
    // Modified clicks and copied links must retain the same unrated review.
    chips.querySelectorAll<HTMLAnchorElement>('a').forEach((chip, index) => {
      chip.href = `/puzzles?mode=storm&review=${encodeURIComponent(run!.results[index]!.id)}`;
    });
    const next = button(t('puzzle.stormNewRun'), start);
    card.append(title, clock(), tally(), chips, next, recovery());
    if (run.best === null) card.append(signInCta(t('puzzle.streakSignInBest')));
    shell.replaceChildren(layout);
    controls.replaceChildren();
    // Keep the last board in place, locked by dispose. A results reload has
    // no board snapshot, but reserves the same board track beside the panel.
    let side = detail.querySelector('.puzzle-side-panel');
    if (!side) {
      const board = document.createElement('div');
      board.className = 'puzzle-board puzzle-storm-finished-board';
      side = document.createElement('aside');
      side.className = 'puzzle-side-panel';
      detail.replaceChildren(board, side);
    }
    side.replaceChildren(card);
    bestRuns();
    next.focus({ preventScroll: true });
    openPendingReview();
  };
  const showBoard = (): void => {
    if (!active() || !run) return;
    if (run.finished || !run.puzzle) {
      showSummary();
      return;
    }
    reviewing = false;
    shell.classList.remove('puzzle-storm-reviewing');
    solver?.dispose();
    shell.replaceChildren(layout);
    controls.replaceChildren();
    bestRuns();
    solver = mountSolver(run.puzzle, {
      mode: 'storm',
      analysis: false,
      initialAttempt: run.progress,
      feedback,
      afterRender: () => bestRuns(),
      submitAttempt: async (id, moves, qualitySessionId) => {
        // An uncertain response is reconciled by resume before another move.
        if (busy || error || !run || remaining() <= 0) throw new Error('Resume required');
        busy = true;
        try {
          const next = await request({
            action: 'move',
            runId: run.runId,
            version: run.version,
            puzzleId: id,
            move: moves.at(-1),
            qualitySessionId,
          });
          adopt(next);
          if (!next.attempt) {
            if (next.finished) showSummary();
            else throw new Error('Missing attempt');
            throw new Error('Run ended');
          }
          return { attempt: next.attempt, rating: null };
        } catch (cause) {
          if (active() && !run?.finished) error = cause;
          throw cause;
        } finally {
          busy = false;
        }
      },
      // The solver has emitted the outcome and painted its accepted move.
      // Mount the response's next board immediately, without a new detail GET.
      onAttempt: (attempt) => {
        if (run?.finished) showSummary();
        else if (!attempt.ok && attempt.code !== 'incorrect-move') {
          showError(new Error('Checker unavailable'));
        } else if (!attempt.ok || attempt.complete) showBoard();
      },
    });
  };
  const showError = (cause: unknown): void => {
    if (!active()) return;
    error = cause;
    shell.classList.add('puzzle-storm-error');
    const panel = shell.querySelector('.puzzle-storm-recovery');
    if (panel) panel.replaceWith(recovery());
    else shell.append(recovery());
  };
  const showStart = (cause: PuzzlePlayDisabledError | null = null): void => {
    error = cause;
    shell.classList.toggle('puzzle-storm-error', Boolean(error));
    solver?.dispose();
    solver = null;
    shell.replaceChildren(layout);
    detail.replaceChildren();
    controls.replaceChildren();
    const panel = document.createElement('aside');
    panel.className = 'puzzle-side-panel puzzle-storm-feedback';
    panel.append(panelIntro(t('puzzle.stormMoveToStart')));
    panel.append(error ? recovery() : button(t('puzzle.stormNewRun'), start));
    detail.append(panel);
  };
  function openPendingReview(): void {
    if (!pendingReviewId) return;
    const id = pendingReviewId;
    pendingReviewId = null;
    void review(id);
  }
  async function resume(): Promise<void> {
    const runId = run?.runId ?? resumeId;
    if (busy || !runId || !active()) return;
    const initialReconcile = run === null;
    busy = true;
    solver?.end();
    try {
      adopt(await request({ action: 'resume', runId }));
      showBoard();
    } catch (cause) {
      if (!active()) return;
      const missing = cause instanceof Error && cause.message === '404';
      const disabled = cause instanceof PuzzlePlayDisabledError;
      if (missing || disabled) {
        run = null;
        resumeId = null;
        rememberRun(null);
        showStart(disabled ? cause : null);
        if (initialReconcile) openPendingReview();
      } else {
        // Keep the live snapshot (and its eventual completion transition)
        // until the server can reconcile it. A review must wait too.
        showError(cause);
      }
    } finally {
      busy = false;
    }
  }
  async function start(): Promise<void> {
    if (busy || !active()) return;
    busy = true;
    ++reviewToken;
    pendingReviewId = null;
    try {
      const next = await request({ action: 'start', recent: seenIds() });
      window.history.replaceState(null, '', '/puzzles?mode=storm');
      terminalSent = false;
      adopt(next);
      track('puzzle_mode_started', { mode: 'storm', variant: 'xiangqi' });
      showBoard();
    } catch (cause) {
      showError(cause);
    } finally {
      busy = false;
    }
  }
  async function review(id: string): Promise<void> {
    if (run && !run.finished) return;
    const token = ++reviewToken;
    reviewing = true;
    shell.classList.add('puzzle-storm-reviewing');
    solver?.dispose();
    shell.replaceChildren(layout);
    controls.replaceChildren();
    const header = document.createElement('div');
    header.className = 'puzzle-storm-review';
    const title = document.createElement('h2');
    title.textContent = t('puzzle.stormReview');
    header.append(title);
    if (error instanceof PuzzlePlayDisabledError) header.append(recovery());
    else {
      header.append(
        button(t(run ? 'puzzle.stormBack' : 'puzzle.stormNewRun'), run ? showSummary : start),
      );
    }
    detail.replaceChildren(header);
    try {
      const puzzle = await fetchPuzzleDetail(id);
      if (!active() || token !== reviewToken) return;
      if (!puzzle) throw new Error('Missing puzzle');
      // The standalone solver sends rated:false for attempts, hints and reveals.
      // Keep the player's saved practice preference intact; never mount the
      // regular trainer for a result chip.
      solver = mountSolver(puzzle, {
        analysis: false,
        fast: true,
        afterRender: (host) => {
          host.querySelector('.puzzle-trainer-panel')?.prepend(header);
          bestRuns();
        },
      });
    } catch (cause) {
      showError(cause);
    }
  }

  const tick = (): void => {
    if (!active()) {
      stop();
      return;
    }
    if (!run || run.finished || reviewing) return;
    const left = remaining();
    for (const el of shell.querySelectorAll<HTMLElement>('[data-storm-clock]')) {
      el.textContent = clockText(left);
      el.classList.toggle('puzzle-storm-clock--low', left <= 10_000);
    }
    // A move already in flight blocks input itself. Its verdict may earn time;
    // let it settle before confirming expiry, rather than dropping its result.
    if (!left && !busy && !error) void resume();
  };
  const onPageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) stop();
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted && run && !run.finished) void resume();
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (run && !run.finished && !terminalSent) {
      terminalSent = true;
      track('puzzle_mode_finished', {
        mode: 'storm',
        variant: 'xiangqi',
        run_length: run.score,
        reason: 'abandoned',
      });
    }
    ++reviewToken;
    solver?.dispose();
    window.clearInterval(timer);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', beginWhenVisible);
    document.removeEventListener('prerenderingchange', beginWhenVisible);
  };
  let begun = false;
  const beginWhenVisible = (): void => {
    if (
      begun ||
      !active() ||
      document.visibilityState === 'hidden' ||
      (document as Document & { prerendering?: boolean }).prerendering
    )
      return;
    begun = true;
    document.removeEventListener('visibilitychange', beginWhenVisible);
    document.removeEventListener('prerenderingchange', beginWhenVisible);
    // Reconcile a saved run before opening a review so a live clock never
    // runs unseen. showSummary opens the pending review once the run ends.
    // An initial 404 or play lock may open it without a finished run.
    if (resumeId) void resume();
    else if (pendingReviewId) openPendingReview();
    else {
      void start();
    }
  };
  const timer = window.setInterval(tick, 100);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', beginWhenVisible);
  document.addEventListener('prerenderingchange', beginWhenVisible);
  controls.replaceChildren();
  beginWhenVisible();
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
function clockText(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function rememberedRun(): SavedRun | null {
  try {
    const value = JSON.parse(window.sessionStorage?.getItem(RUN_KEY) ?? 'null') as {
      runId?: unknown;
      finished?: unknown;
    } | null;
    if (typeof value?.runId === 'string') {
      return { runId: value.runId, finished: value.finished === true };
    }
    return null;
  } catch {
    return null;
  }
}
function rememberRun(run: SavedRun | null): void {
  try {
    if (run) window.sessionStorage?.setItem(RUN_KEY, JSON.stringify(run));
    else window.sessionStorage?.removeItem(RUN_KEY);
  } catch {
    /* Storage blocked: the run still plays. */
  }
}
function seenIds(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage?.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string').slice(-120)
      : [];
  } catch {
    return [];
  }
}
function rememberSeen(ids: string[]): void {
  try {
    window.localStorage?.setItem(
      SEEN_KEY,
      JSON.stringify([...new Set([...seenIds(), ...ids])].slice(-120)),
    );
  } catch {
    /* The server also remembers signed-in runs. */
  }
}
