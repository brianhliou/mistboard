// Xiangqi practice PLAYER: a board plus a coach panel driving an engine-adjudicated
// exercise (practice-play.ts). The sibling of xiangqi-gamebook.ts, and the surface
// where the difference between the two is visible to a learner:
//
//   A gamebook says "not that move" because the author wrote a different one.
//   A practice exercise says "that move threw away the win" because the engine
//   says the position got worse, and then it plays on against you.
//
// Reuses the gamebook's layout classes deliberately. The widget anatomy is the
// same (aside + board + coach bubble + controls), the two surfaces sit side by
// side in the same study, and a second near-identical stylesheet is how they
// would drift apart. Practice-only additions carry their own `practice__*` class.
//
// The engine is injected rather than imported: the caller owns the ceval handle
// and its lifetime, and keeping it out of here is what lets the player be driven
// by a scripted engine in a test.

import {
  fsfUciToXiangqiSquares,
  PRACTICE_WIN_CP,
  type PracticeGoal,
  type PracticeVerdict,
  type StandardXiangqiPlayerView,
  type XiangqiColor,
  type XiangqiGameState,
} from '@mistboard/game';
import { attachBoardResizeGrip, restoreBoardScale } from '../board-resize.js';
import { t } from '../i18n/catalog.js';
import { initLiveSound, playSound } from '../live-sound.js';
import { soundForOwnXiangqiMove } from '../live-xiangqi-sound.js';
import { animateXiangqiBoardMove, createXiangqiInteractiveBoard } from '../xiangqi-board.js';
import { renderXiangqiPiece } from '../xiangqi-pieces.js';
import { fitGamebookToViewport } from './gamebook-fit.js';
import {
  createPracticeSession,
  type PracticeEval,
  type PracticePhase,
  type PracticeView,
} from './practice-play.js';
import { xiangqiPracticeConfig } from './xiangqi-practice.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';

/** Hint ink. Matches the learn course's yellow, which is already the colour a
 *  Mistboard board uses to say "look here". */
const HINT_COLOR = '#d8a01d';

import './gamebook.css';
import './practice.css';

export interface XiangqiPracticeOptions {
  /** The exercise's start position. */
  initialTruth: XiangqiGameState;
  goal: PracticeGoal;
  /** Side the learner plays; the engine defends with the other. */
  orientation: XiangqiColor;
  /** Evaluate a position (side-to-move POV). Injected so tests can script it. */
  evaluate: (truth: XiangqiGameState) => Promise<PracticeEval>;
  title?: string;
  summary?: string;
  /** Optional left-rail element (chapter tabs, etc.). */
  aside?: HTMLElement;
  /** A single position page (/practice/position), not a study chapter. */
  single?: boolean;
  /** The concept prose shown under the board, beside the goal. */
  brief?: string;
  /** Where this exercise sits in its set, for the "3 of 32" line. */
  progress?: { index: number; total: number };
  /** Advance to the next exercise. Absent = this is the last one, or the caller
   *  has no notion of a next; the button is then not offered at all rather than
   *  offered and inert. */
  onNext?: () => void;
  /** Called once, the first time the learner solves this exercise, with the
   *  number of moves they took. The caller persists it; failures are the
   *  caller's to swallow, because losing a progress write must never interrupt
   *  the moment the learner just succeeded. */
  onSolved?: (moves: number) => void;
  /** Called each time an attempt fails, with the grade that ended it. A surface
   *  where every learner blunders on move one is MISCALIBRATED rather than
   *  unused, and the two are indistinguishable in a completion count alone. */
  onFailed?: (verdict: PracticeVerdict | 'defeat', moves: number) => void;
  /**
   * Where a GUEST signs in, asked at solve time; undefined for a signed-in
   * learner. A guest's solve is not saved (the server drops it by design), so
   * once they have solved something the panel offers this link, quietly and
   * dismissibly. A function rather than a string because auth can settle after
   * the mount, and because the return URL should be the page as it is at the
   * solve, not as it was when the player opened.
   */
  guestSignInHref?: () => string | undefined;
  /**
   * Site navigation to keep above the player. The mount replaces the root's
   * children, so a caller that built a nav there first would otherwise have it
   * silently wiped -- which is what happened, leaving the page with no way back
   * to the rest of the site.
   */
  nav?: HTMLElement;
  /** Pause before the engine's reply; defaults to PRACTICE_REPLY_DELAY_MS. A
   *  test seam: a scripted engine has no reason to wait. */
  replyDelayMs?: number;
}

export interface XiangqiPracticeHandle {
  /** Current runner view, for tests and for callers that report progress. */
  view(): PracticeView;
  /** Resolves once the opening evaluation has landed and the learner may move. */
  ready(): Promise<void>;
  /** Play a move as the learner, as though dragged on the board. */
  play(move: { from: string; to: string }): Promise<void>;
  destroy(): void;
}

/**
 * The goal line, in the reader's language.
 *
 * The localized twin of describePracticeGoal in packages/game, which stays the
 * English/default so that package holds no presentation copy. Deliberately a
 * switch over the goal's SHAPE rather than a translation of the finished English
 * sentence: this is the one string on the surface that tells a learner what they
 * are being asked to do, and parsing it back out of prose would be a way to get
 * that wrong quietly.
 */
function localizedPracticeGoal(goal: PracticeGoal): string {
  const moves = goal.moves;
  switch (goal.kind) {
    case 'mate':
      return moves === undefined ? t('practice.goal.mate') : t('practice.goal.mateIn', { moves });
    case 'win': {
      if (goal.centipawns !== PRACTICE_WIN_CP) {
        const cp = goal.centipawns;
        return moves === undefined
          ? t('practice.goal.reach', { cp })
          : t('practice.goal.reachIn', { cp, moves });
      }
      return moves === undefined ? t('practice.goal.win') : t('practice.goal.winIn', { moves });
    }
    case 'draw':
      return moves === undefined ? t('practice.goal.draw') : t('practice.goal.drawFor', { moves });
  }
}

export function mountXiangqiPractice(
  root: HTMLElement,
  opts: XiangqiPracticeOptions,
): XiangqiPracticeHandle {
  // The review tree is silent everywhere else, and for an analysis board that is
  // right. A practice board is not one: the learner is PLAYING here, against an
  // opponent that answers, so it gets the same voice a live board has. Idempotent,
  // and a no-op in a test (no AudioContext, no sound).
  initLiveSound();

  const session = createPracticeSession(
    xiangqiPracticeConfig({
      goal: opts.goal,
      learner: opts.orientation,
      initialTruth: opts.initialTruth,
      evaluate: opts.evaluate,
      ...(opts.replyDelayMs === undefined ? {} : { minReplyDelayMs: opts.replyDelayMs }),
      onMovePlayed: (move, parentTruth, by) => {
        // The full standard-xiangqi voice, including the cannon boom, from the
        // classifier the live rooms use: a drill that clicks where a game booms
        // teaches the wrong ear for the piece.
        playSound(soundForOwnXiangqiMove(xiangqiTreeAdapter.project(parentTruth)[0]!.view, move));
        // Paint every ply NOW, in the same task as its sound, rather than when
        // the evaluation of the new position has settled. That evaluation waits
        // on a tablebase round trip (up to PRACTICE_TABLEBASE_TIMEOUT_MS), so a
        // repaint deferred to it let the defender's move click and then land on
        // the board half a second or more later; for the learner's own move it
        // held the old position for the whole search and then jumped two plies.
        // A new move returns a reader who was looking back to the live position.
        // The defender's move glides the way a live opponent's does; the
        // learner's own move was just dragged or clicked into place.
        viewing = null;
        render({ glide: by === 'defender' });
      },
    }),
  );

  const viewOf = (truth: XiangqiGameState): StandardXiangqiPlayerView =>
    xiangqiTreeAdapter.project(truth)[0]!.view;
  const currentView = (): StandardXiangqiPlayerView => viewOf(session.truth());
  // Index into session.line() of a position the reader stepped back to, or null
  // for the live position. Looking back never changes the attempt: the board is
  // read-only there, and the next move snaps it live again.
  let viewing: number | null = null;
  // The line position last painted, so a one-step move can glide.
  let painted = -1;
  const shownIndex = (): number => viewing ?? session.line().length - 1;
  const browsing = (): boolean => viewing !== null;

  // ── Layout ──
  const wrap = document.createElement('section');
  wrap.className = 'gamebook practice';
  // One position from a URL, not a chapter of a set: on a phone the page drops
  // its card and generic heading so the board, goal and coach fit one screen.
  if (opts.single) wrap.classList.add('practice--single');
  if (opts.aside) {
    const aside = document.createElement('div');
    aside.className = 'gamebook__aside';
    aside.append(opts.aside);
    wrap.append(aside);
  }
  // Board column: the board, then the brief UNDER it. lichess puts the goal and
  // the concept prose below the board rather than in the side panel, and it is
  // the right call -- the goal is what the learner re-reads while staring at the
  // position, so it belongs in their eyeline, not off to one side.
  const boardCol = document.createElement('div');
  boardCol.className = 'practice__board-col';
  // The board host is repainted with innerHTML on every render, so anything
  // appended to it is destroyed on the next move. The resize grip therefore
  // hangs off a stable FRAME around it rather than off the board itself --
  // attaching it to the board is why it silently vanished the first time.
  const boardFrame = document.createElement('div');
  boardFrame.className = 'practice__board-frame';
  const boardEl = document.createElement('div');
  boardEl.className = 'gamebook__board xiangqi-live-board';
  boardEl.setAttribute('aria-label', t('practice.boardLabel'));
  boardFrame.append(boardEl);
  boardCol.append(boardFrame);

  const brief = document.createElement('div');
  brief.className = 'practice__brief';
  const briefGoal = document.createElement('p');
  briefGoal.className = 'practice__brief-goal';
  // The learner's colour leads, as a composed problem states it: "Black to
  // play and win", not a bare "Win" the reader has to pair with the board.
  briefGoal.textContent = t('practice.goal.sideTo', {
    color: opts.orientation === 'black' ? t('setup.black') : t('setup.red'),
    goal: localizedPracticeGoal(opts.goal),
  });
  brief.append(briefGoal);
  if (opts.brief) {
    const briefText = document.createElement('p');
    briefText.className = 'practice__brief-text';
    briefText.textContent = opts.brief;
    brief.append(briefText);
  }
  boardCol.append(brief);
  wrap.append(boardCol);

  // The board is adjustable by the SAME grip and the SAME persisted token as the
  // room, review, analysis and puzzle boards (--uni-board-scale). A second
  // sizing mechanism here would mean a reader who set their board size once had
  // to set it again on this surface alone.
  restoreBoardScale();
  // Grip on the frame (stable), measuring the frame (which carries the scaled
  // width, so it is the painted board's width).
  attachBoardResizeGrip(boardFrame, boardFrame);

  // Right column, top to bottom: where you are, what you have played, then the
  // coach. lichess anchors the coach at the BOTTOM of this column under a
  // coloured strip, so the panel reads as "reference above, live state below"
  // instead of one undifferentiated stack.
  const side = document.createElement('aside');
  side.className = 'practice__panel practice__side';

  if (opts.progress) {
    // A band with the number carrying the weight, not one grey line. lichess
    // anchors this column with a substantial "#19" header; without something of
    // similar mass the column reads as an empty box with a caption.
    const head = document.createElement('div');
    head.className = 'practice__side-head';
    const num = document.createElement('span');
    num.className = 'practice__side-num';
    num.textContent = `#${opts.progress.index}`;
    const of = document.createElement('span');
    of.className = 'practice__side-of';
    of.textContent = t('practice.ofTotal', { total: opts.progress.total });
    head.append(num, of);
    side.append(head);
  }

  // The played line. A study chapter has a move list; an exercise has none, so
  // without this a learner who has just failed cannot see what they played.
  const movesEl = document.createElement('ol');
  movesEl.className = 'practice__moves';
  side.append(movesEl);
  // Step through the attempt, as any move list does. Arrow keys do the same.
  const stepper = document.createElement('div');
  stepper.className = 'practice__stepper';
  const prevBtn = button('\u25c0', 'practice__step');
  prevBtn.setAttribute('aria-label', t('replay.previous'));
  prevBtn.title = t('replay.previous');
  const nextStepBtn = button('\u25b6', 'practice__step');
  nextStepBtn.setAttribute('aria-label', t('replay.next'));
  nextStepBtn.title = t('replay.next');
  stepper.append(prevBtn, nextStepBtn);
  side.append(stepper);

  const coach = document.createElement('div');
  coach.className = 'practice__coach';
  const coachStrip = document.createElement('p');
  coachStrip.className = 'practice__coach-strip';
  coachStrip.textContent = t('practice.coachStrip');
  const bubble = document.createElement('div');
  bubble.className = 'gamebook__bubble practice__coach-body';
  // The LEARNER's own general, not a generic mascot. The line beside it reads
  // "Your move", so the face should be the seat the reader is sitting in -- and
  // on a hold-the-draw exercise that seat is Black, which a fixed colour would
  // quietly misreport.
  const avatar = document.createElement('div');
  avatar.className = 'practice__coach-avatar';
  avatar.innerHTML = renderXiangqiPiece({ color: opts.orientation, role: 'general' }, { size: 34 });
  const feedback = document.createElement('p');
  feedback.className = 'gamebook__feedback';
  const hintText = document.createElement('p');
  hintText.className = 'gamebook__hint';
  const say = document.createElement('div');
  say.className = 'practice__coach-say';
  say.append(feedback, hintText);
  bubble.append(avatar, say);

  const controls = document.createElement('div');
  controls.className = 'gamebook__controls';
  const hintBtn = button(t('practice.hint'), 'gamebook__btn');
  const retryBtn = button(t('practice.takeItBack'), 'gamebook__btn gamebook__btn--primary');
  const restartBtn = button(t('practice.restart'), 'gamebook__btn');
  const nextBtn = button(t('practice.nextExercise'), 'gamebook__btn gamebook__btn--primary');
  controls.append(hintBtn, retryBtn, restartBtn, nextBtn);
  coach.append(coachStrip, bubble);
  coach.append(controls);
  // Guest only, after a solve: the progress they just made is not kept.
  const savePrompt = document.createElement('p');
  savePrompt.className = 'practice__save-prompt';
  savePrompt.hidden = true;
  const savePromptLink = document.createElement('a');
  savePromptLink.className = 'practice__save-prompt-link';
  savePromptLink.textContent = t('practice.signInToKeep');
  const savePromptClose = button('\u00d7', 'practice__save-prompt-close');
  savePromptClose.setAttribute('aria-label', t('practice.signInDismiss'));
  savePromptClose.title = t('practice.signInDismiss');
  savePromptClose.addEventListener('click', () => {
    dismissPracticeSavePrompt();
    savePrompt.hidden = true;
  });
  savePrompt.append(savePromptLink, savePromptClose);
  coach.append(savePrompt);
  side.append(coach);
  wrap.append(side);

  // Reentrancy guard: the engine is async, so without this a fast second drag
  // could open a new attempt while the first is still resolving.
  let busy = false;
  // One report per mount: a learner who solves, restarts and solves again has
  // not solved a second exercise.
  let reportedSolved = false;
  // Failures ARE reported per occurrence -- each one is a separate data point
  // about the exercise's difficulty -- so this tracks the transition rather than
  // suppressing repeats. render() runs on every state change, including retry.
  let lastPhase: PracticePhase | null = null;

  const interactive = createXiangqiInteractiveBoard({
    board: boardEl,
    getInteractionView: () => currentView(),
    getPerspective: () => opts.orientation,
    seatFor: () => (session.view().awaitingMove && !busy && !browsing() ? opts.orientation : null),
    enabled: () => session.view().awaitingMove && !busy && !browsing(),
    onMove: (move) => {
      void attempt(move);
    },
  });

  async function attempt(move: { from: string; to: string }): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    try {
      await session.attempt(move as never);
    } finally {
      busy = false;
    }
    render();
  }

  function stepTo(index: number): void {
    const last = session.line().length - 1;
    const target = Math.max(0, Math.min(index, last));
    const next = target === last ? null : target;
    if (next === viewing) return;
    viewing = next;
    render({ glide: true });
  }
  prevBtn.addEventListener('click', () => stepTo(shownIndex() - 1));
  nextStepBtn.addEventListener('click', () => stepTo(shownIndex() + 1));
  const onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const el = event.target instanceof Element ? event.target : null;
    if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!wrap.isConnected) return;
    event.preventDefault();
    stepTo(shownIndex() + (event.key === 'ArrowLeft' ? -1 : 1));
  };
  document.addEventListener('keydown', onKey);

  hintBtn.addEventListener('click', () => {
    session.hint();
    render();
  });
  retryBtn.addEventListener('click', () => {
    session.retry();
    viewing = null;
    render();
  });
  nextBtn.addEventListener('click', () => {
    opts.onNext?.();
  });
  restartBtn.addEventListener('click', () => {
    viewing = null;
    busy = true;
    render();
    void session.reset().finally(() => {
      busy = false;
      render();
    });
  });

  /** What the coach says about the move just graded. */
  function verdictLine(view: PracticeView): string {
    // A move the tablebase graded says so: "the tablebase says" is a fact about
    // the position, where the engine lines below are an estimate.
    switch (view.tablebase) {
      case 'keepsWin':
        return t('practice.tablebase.keepsWin');
      case 'holdsDraw':
        return t('practice.tablebase.holdsDraw');
      case 'throwsWin':
        return t('practice.tablebase.throwsWin');
      case 'loses':
        return t('practice.tablebase.loses');
    }
    switch (view.verdict) {
      case 'blunder':
        return t('practice.verdictBlunder');
      case 'mistake':
        return t('practice.verdictMistake');
      case 'inaccuracy':
        return t('practice.verdictInaccuracy');
      default:
        return t('practice.verdictGood');
    }
  }

  function render(paint: { glide?: boolean } = {}): void {
    const view = session.view();
    const line = session.line();
    if (viewing !== null && viewing >= line.length - 1) viewing = null;
    const shown = shownIndex();
    const shownView = viewOf(line[shown]!);
    interactive.render(shownView, opts.orientation);
    // One step forward glides the move just reached; one step back glides the
    // move being undone back to where it came from.
    if (paint.glide && shown === painted + 1 && shownView.lastMove) {
      animateXiangqiBoardMove(boardEl, shownView.lastMove, opts.orientation);
    } else if (paint.glide && shown === painted - 1) {
      const undone = viewOf(line[painted]!).lastMove;
      if (undone) animateXiangqiBoardMove(boardEl, undone, opts.orientation, { reverse: true });
    }
    painted = shown;
    wrap.classList.toggle('practice--browsing', browsing());
    const state = busy ? 'thinking' : view.phase;
    coach.dataset.state = state;
    side.dataset.state = state;

    // Hints are DRAWN, the way lila does them: first click rings the square to
    // move from, second draws the whole move. Naming squares in prose would make
    // the learner translate coordinates instead of looking at the board.
    hintText.textContent = '';
    const hint = browsing() ? null : view.hint;
    if (!hint) {
      interactive.setMarkers([]);
      interactive.setArrows([]);
    } else {
      const from = fsfUciToXiangqiSquares(hint.uci);
      if (!from) {
        interactive.setMarkers([]);
        interactive.setArrows([]);
      } else if (hint.level === 'origin') {
        interactive.setArrows([]);
        // A ring marker takes its stroke ENTIRELY from CSS keyed on the class
        // name: `kind: 'circle'` alone renders `fill="none"` with no stroke and
        // is invisible on the board. The rule lives in practice.css.
        interactive.setMarkers([
          { square: from.from, kind: 'circle', className: 'xq-marker--practice-hint' },
        ]);
        hintText.textContent = t('practice.hintPiece');
      } else {
        interactive.setMarkers([]);
        // Arrows carry their colour inline, so this one does not depend on a
        // stylesheet being imported.
        interactive.setArrows([
          {
            from: from.from,
            to: from.to,
            className: 'xq-arrow--practice-hint',
            color: HINT_COLOR,
            width: 12,
          },
        ]);
        hintText.textContent = t('practice.hintMove');
      }
    }

    // Report the solve once, the first time this run reaches it. Guarded rather
    // than fired from the success branch of attempt(), because render() also
    // runs on retry and restart and would otherwise re-report.
    if (view.phase === 'success' && !reportedSolved) {
      reportedSolved = true;
      playSound('level-end');
      opts.onSolved?.(view.movesPlayed);
      // Decided once, at the first solve of this exercise: a guest who signs in
      // in another tab still sees it here, which is harmless and self-correcting.
      const href = practiceSavePromptDismissed() ? undefined : opts.guestSignInHref?.();
      if (href) {
        savePromptLink.href = href;
        savePrompt.hidden = false;
      }
    }
    // On the TRANSITION into failed, so a re-render of the same failed state
    // (asking for a hint, say) does not count as a second failure.
    if (view.phase === 'failed' && lastPhase !== 'failed' && view.verdict) {
      playSound('learn-failure');
      opts.onFailed?.(view.verdict, view.movesPlayed);
    }
    // Losing the exercise outright gets the same soft note as failing a move,
    // NOT the ranked defeat sting. A learning surface needs its own reward and
    // failure voice: the game's win/lose stings make a drill failure feel
    // punitive and a drill solve feel generic (learn course, 2026-07-15).
    if (view.phase === 'defeat' && lastPhase !== 'defeat') {
      playSound('learn-failure');
      // A defeat ends the run as surely as a failed move does (a draw the
      // engine reads as lost, a defender with no reply), so it is reported as a
      // failure too. Without it a draw chapter that ended this way logged a
      // start and nothing else, indistinguishable from a learner who left.
      opts.onFailed?.('defeat', view.movesPlayed);
    }
    lastPhase = view.phase;

    if (state === 'thinking') {
      feedback.textContent = t('practice.thinking');
    } else if (view.phase === 'failed') {
      feedback.textContent = verdictLine(view);
    } else if (view.phase === 'success') {
      feedback.textContent = t('practice.solved');
    } else if (view.phase === 'defeat') {
      feedback.textContent = t('practice.notHoldable');
    } else if (view.movesPlayed === 0) {
      feedback.textContent = t('practice.yourMove');
    } else {
      feedback.textContent = verdictLine(view);
    }

    renderMoves(view, shown);
    prevBtn.disabled = shown === 0;
    nextStepBtn.disabled = !browsing();
    stepper.hidden = view.moves.length === 0;

    hintBtn.hidden = view.phase !== 'play' || busy;
    retryBtn.hidden = view.phase !== 'failed';
    // Restart stays available for the whole run, not only at the end: a learner
    // who has wandered into a lost-but-not-yet-failed position should not have
    // to play it out to start again.
    restartBtn.hidden = busy || view.movesPlayed === 0;
    nextBtn.hidden = view.phase !== 'success' || !opts.onNext;
  }

  function renderMoves(view: PracticeView, shown: number): void {
    movesEl.replaceChildren();
    for (const [index, label] of view.moves.entries()) {
      const li = document.createElement('li');
      li.className = 'practice__move';
      if (index + 1 === shown) li.classList.add('is-current');
      // Even indices are the learner's moves (they always move first from the
      // exercise's start; an exercise that opens on the defender plays that
      // reply before the learner is handed the board, so the log still starts
      // with whoever moved first).
      li.classList.add(index % 2 === 0 ? 'practice__move--learner' : 'practice__move--defender');
      const moveBtn = button(label, 'practice__move-button');
      moveBtn.addEventListener('click', () => stepTo(index + 1));
      li.append(moveBtn);
      movesEl.append(li);
    }
    movesEl.hidden = view.moves.length === 0;
    // Keep the shown move in view: a column on desktop, one row on a phone.
    const current = movesEl.querySelector<HTMLElement>('.is-current');
    if (current && browsing()) {
      current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      movesEl.scrollTop = movesEl.scrollHeight;
      movesEl.scrollLeft = movesEl.scrollWidth;
    }
  }

  // A page header only when a caller actually wants one. The study mount does
  // not: the set's name lives in the rail card and the goal lives under the
  // board, so an empty <header> here would just add a gap above the columns.
  const chrome: HTMLElement[] = [];
  if (opts.nav) chrome.push(opts.nav);
  if (opts.title || opts.summary) {
    const header = document.createElement('header');
    header.className = 'gamebook__header';
    if (opts.title) {
      const h1 = document.createElement('h1');
      h1.className = 'gamebook__title';
      h1.textContent = opts.title;
      header.append(h1);
    }
    if (opts.summary) {
      const p = document.createElement('p');
      p.className = 'gamebook__summary';
      p.textContent = opts.summary;
      header.append(p);
    }
    chrome.push(header);
  }

  root.replaceChildren(...chrome, wrap);
  fitGamebookToViewport(wrap);
  render();
  const started = session.start().then(() => render());

  return {
    view: () => session.view(),
    ready: () => started,
    play: attempt,
    destroy: () => {
      // The interactive board has no teardown of its own (its listeners live on
      // the elements it renders), so dropping the subtree is the whole cleanup.
      document.removeEventListener('keydown', onKey);
      root.replaceChildren();
    },
  };
}

// Per browser tab, like the visit it belongs to: a dismissed prompt stays
// dismissed across this session's exercises and comes back on a later visit.
const SAVE_PROMPT_DISMISSED_KEY = 'mb_practice_save_prompt_dismissed';

export function practiceSavePromptDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(SAVE_PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissPracticeSavePrompt(): void {
  try {
    window.sessionStorage.setItem(SAVE_PROMPT_DISMISSED_KEY, '1');
  } catch {
    // Storage unavailable: the prompt still hides for this exercise.
  }
}

function button(label: string, className: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}
