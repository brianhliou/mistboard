// Xiangqi gamebook (interactive-lesson) PLAYER: a board + a coach panel that drives
// the guess-the-move session (gamebook-play.ts). Moves are hidden — the learner must
// find the solution move on their side; the opponent's replies auto-play. A wrong
// (legal) move shows the coach's "why not" and lets them try again. This is a
// standalone surface (no move list / engine / variations) — the study page mounts it
// for a gamebook chapter, and /learn will mount the same player later.

import {
  parseStandardXiangqiFen,
  type StandardXiangqiPlayerView,
  type XiangqiColor,
  type XiangqiGameState,
} from '@mistboard/game';
import { attachBoardResizeGrip, restoreBoardScale } from '../board-resize.js';
import { initLiveSound, playSound } from '../live-sound.js';
import { soundForOwnXiangqiMove } from '../live-xiangqi-sound.js';
import { displayComment } from '../study-i18n.js';
import { createXiangqiInteractiveBoard } from '../xiangqi-board.js';
import { fitGamebookToViewport } from './gamebook-fit.js';
import { createGamebookSession, type GamebookFeedback } from './gamebook-play.js';
import { deserializeTree, type SerializedTree } from './tree-serialize.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';
import './gamebook.css';
import './seat-labels.css';

export interface XiangqiGamebookOptions {
  /** The solution tree (with per-node hint/deviation/comment). */
  tree: SerializedTree;
  /** Side the learner plays. */
  orientation: XiangqiColor;
  title?: string;
  summary?: string;
  /** Site nav to keep above the lesson. The mount replaces the root's children,
   *  so a caller that rendered a nav first has to hand it back here. */
  nav?: HTMLElement;
  /** Optional left-rail element (chapter tabs, "edit lesson", etc.). */
  aside?: HTMLElement;
  /** The game this position came from, shown under the prompt: where it was
   *  played. Absent for a lesson that is not a game position. */
  game?: { detail: string };
  /** Who had each side, drawn as the review page's seat strips above and below
   *  the board (the learner's side at the bottom). */
  seats?: { red: string; black: string };
}

export function mountXiangqiGamebook(root: HTMLElement, opts: XiangqiGamebookOptions): void {
  // Same reasoning as the practice player: a lesson board is played, not read.
  initLiveSound();

  // A composition chapter roots the lesson at its hand-set position (an invalid
  // rootFen degrades to the standard start, same posture as a corrupt blob).
  const rootParsed = opts.tree.rootFen ? parseStandardXiangqiFen(opts.tree.rootFen) : null;
  const tree = deserializeTree(
    xiangqiTreeAdapter,
    opts.tree,
    rootParsed?.ok ? rootParsed.state : undefined,
  );
  const session = createGamebookSession(tree, {
    moveKey: xiangqiTreeAdapter.moveKey,
    isLegal: xiangqiTreeAdapter.isLegal,
    learner: opts.orientation,
    sideToMove: (truth: XiangqiGameState) =>
      truth.status.type === 'playing' ? truth.status.turn : null,
    comment: (node) => displayComment(node.annotations?.comments?.[0]),
    hint: (node) => node.annotations?.gamebook?.hint,
    deviation: (node) => node.annotations?.gamebook?.deviation,
  });

  const currentView = (): StandardXiangqiPlayerView =>
    xiangqiTreeAdapter.project(session.node().truth)[0]!.view;

  // ── Layout ──
  const wrap = document.createElement('section');
  wrap.className = 'gamebook';
  if (opts.aside) {
    const aside = document.createElement('div');
    aside.className = 'gamebook__aside';
    aside.append(opts.aside);
    wrap.append(aside);
  }
  // The board host is repainted on every move, so the resize grip hangs off a
  // stable frame around it (the practice player's pattern), and the frame is the
  // grid item that carries the scaled width.
  const boardFrame = document.createElement('div');
  boardFrame.className = 'gamebook__board-frame';
  const boardEl = document.createElement('div');
  boardEl.className = 'gamebook__board xiangqi-live-board';
  boardEl.setAttribute('aria-label', 'Xiangqi lesson board');
  boardFrame.append(boardEl);
  // The same strips the review and game pages hang on their boards, so a game
  // position reads the same everywhere: names beside the board, not in a panel.
  // The board never flips here, so the learner's side is always the bottom one.
  if (opts.seats) {
    wrap.classList.add('gamebook--seated');
    boardFrame.classList.add('review-board-wrap--seated');
    const far: XiangqiColor = opts.orientation === 'red' ? 'black' : 'red';
    boardFrame.append(
      seatStrip(opts.seats[far], far, 'top'),
      seatStrip(opts.seats[opts.orientation], opts.orientation, 'bottom'),
    );
  }
  wrap.append(boardFrame);
  // The same grip and persisted --uni-board-scale as every other board, so a
  // size set once holds here too.
  restoreBoardScale();
  attachBoardResizeGrip(boardFrame, boardFrame);

  // Coach column, top to bottom: what to do (the side to play, in that side's
  // ink), which game this is, then the lesson's own text and the feedback on the
  // last attempt. The prompt used to be a bold line at the END of the comment,
  // so the one instruction on the page was the last thing read.
  const coach = document.createElement('aside');
  coach.className = 'gamebook__coach';
  const prompt = document.createElement('header');
  prompt.className = 'gamebook__prompt';
  const promptSide = document.createElement('p');
  promptSide.className = `gamebook__prompt-side gamebook__prompt-side--${opts.orientation}`;
  const promptDot = document.createElement('span');
  promptDot.className = 'gamebook__prompt-dot';
  promptDot.setAttribute('aria-hidden', 'true');
  promptSide.append(promptDot, opts.orientation === 'black' ? 'Black to play' : 'Red to play');
  const promptTask = document.createElement('p');
  promptTask.className = 'gamebook__prompt-task';
  promptTask.textContent = 'Find the best move.';
  prompt.append(promptSide, promptTask);
  coach.append(prompt);
  if (opts.game?.detail) {
    const game = document.createElement('p');
    game.className = 'gamebook__game';
    game.textContent = opts.game.detail;
    coach.append(game);
  }
  const bubble = document.createElement('div');
  bubble.className = 'gamebook__bubble';
  const comment = document.createElement('p');
  comment.className = 'gamebook__comment';
  const feedback = document.createElement('p');
  feedback.className = 'gamebook__feedback';
  const hintText = document.createElement('p');
  hintText.className = 'gamebook__hint';
  bubble.append(comment, feedback, hintText);
  const controls = document.createElement('div');
  controls.className = 'gamebook__controls';
  const hintBtn = button('Hint', 'gamebook__btn');
  const restartBtn = button('Restart lesson', 'gamebook__btn');
  controls.append(hintBtn, restartBtn);
  coach.append(bubble, controls);
  wrap.append(coach);

  const interactive = createXiangqiInteractiveBoard({
    board: boardEl,
    getInteractionView: () => currentView(),
    getPerspective: () => opts.orientation,
    // Only the learner's side is draggable, and only while awaiting their move.
    seatFor: () => (session.view().awaitingMove ? opts.orientation : null),
    enabled: () => session.view().awaitingMove,
    onMove: (move) => {
      // Captured before the attempt: a correct move advances the cursor past the
      // opponent's reply too, so afterwards the position it was played from is
      // already two plies behind.
      const parent = session.node().truth;
      const result = session.attempt(move);
      if (result === 'invalid') return;
      if (result === 'good') {
        playSound(soundForOwnXiangqiMove(xiangqiTreeAdapter.project(parent)[0]!.view, move));
      } else {
        // The lesson's own "not that one", never the ranked defeat sting.
        playSound('learn-failure');
      }
      render(result);
    },
  });

  // The hint rings the piece the lesson's move starts from, as well as showing
  // the authored text: a sentence alone left a long retreat unfindable, and the
  // square is known from the mainline without any extra authoring.
  hintBtn.addEventListener('click', () => {
    const next = session.node().children[0]?.move;
    if (next) {
      interactive.setMarkers([
        { square: next.from, kind: 'circle', className: 'xq-marker--gamebook-hint' },
      ]);
    }
    hintText.textContent = session.view().hint ?? (next ? 'Look at the circled piece.' : '');
  });
  restartBtn.addEventListener('click', () => {
    session.reset();
    render();
  });

  // Transition bookkeeping, so completing the lesson chimes once and a retry or
  // a re-render of the finished position does not chime again.
  let lastFeedback: GamebookFeedback | null = null;

  function render(justAttempted?: 'good' | 'bad'): void {
    const view = session.view();
    // A hint ring belongs to the position it was asked in.
    if (justAttempted === 'good' || view.feedback !== 'bad') interactive.setMarkers([]);
    interactive.render(currentView(), opts.orientation);
    coach.dataset.state = view.feedback;
    hintText.textContent = '';
    if (view.feedback === 'end' && lastFeedback !== 'end') playSound('level-end');
    lastFeedback = view.feedback;

    if (view.feedback === 'bad') {
      // The lesson text stays; the note under it says what was wrong, and the
      // board is still live, so the next move is the retry.
      comment.textContent = view.comment ?? '';
      feedback.textContent = view.deviation ?? 'Not that one. Try another move.';
    } else if (view.feedback === 'end') {
      comment.textContent = view.comment ?? '';
      feedback.textContent = 'Lesson complete! 🎉';
    } else {
      comment.textContent = view.comment ?? '';
      // The prompt above already says whose move it is; this line reports only
      // on an attempt.
      feedback.textContent = justAttempted === 'good' ? 'Correct! Keep going.' : '';
    }

    hintBtn.hidden = view.feedback === 'end' || !session.node().children[0];
    restartBtn.hidden = view.feedback !== 'end';
  }

  // A page header only when a caller wants one, as in the practice player: an
  // empty <header> still adds a gap above the columns.
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
}

function seatStrip(name: string, ink: XiangqiColor, slot: 'top' | 'bottom'): HTMLElement {
  const el = document.createElement('div');
  el.className = `review-seat review-seat--${slot} review-seat--${ink}`;
  const disc = document.createElement('span');
  disc.className = 'review-seat__disc';
  const label = document.createElement('span');
  label.className = 'review-seat__name';
  label.textContent = name;
  el.append(disc, label);
  return el;
}

function button(label: string, className: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  return el;
}
