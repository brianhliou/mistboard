// Xiangqi gamebook (interactive-lesson) PLAYER: a board + a coach panel that drives
// the guess-the-move session (gamebook-play.ts). Moves are hidden — the learner must
// find the solution move on their side; the opponent's replies auto-play. A wrong
// (legal) move shows the coach's "why not" and lets them try again. This is a
// standalone surface (played moves only, no engine or variations) — the study page mounts it
// for a gamebook chapter, and /learn will mount the same player later.

import {
  parseStandardXiangqiFen,
  type StandardXiangqiPlayerView,
  type XiangqiColor,
  type XiangqiGameState,
} from '@mistboard/game';
import { pieceAnimationDurationMs } from '../board-anim.js';
import { attachBoardResizeGrip, restoreBoardScale } from '../board-resize.js';
import { t } from '../i18n/catalog.js';
import { initLiveSound, playSound } from '../live-sound.js';
import { classifyXiangqiOpponentSound, soundForOwnXiangqiMove } from '../live-xiangqi-sound.js';
import { displayComment } from '../study-i18n.js';
import { animateXiangqiBoardMove, createXiangqiInteractiveBoard } from '../xiangqi-board.js';
import { fitGamebookToViewport } from './gamebook-fit.js';
import { createGamebookSession, type GamebookFeedback } from './gamebook-play.js';
import { createMoveList, type MoveListEntry } from './move-list.js';
import { deserializeTree, type SerializedTree } from './tree-serialize.js';
import { xiangqiTreeAdapter } from './xiangqi-tree-adapter.js';
import './gamebook.css';
import './seat-labels.css';
import { seatDiscEl } from '../seat-disc.js';

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

  // The session settles synchronously; the board presents those moves one at a time.
  let displayed = tree.root;
  let playing = false;
  let playback = 0;
  const currentView = (): StandardXiangqiPlayerView => tree.project(displayed)[0]!.view;

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
  boardEl.setAttribute('aria-label', t('study.gamebook.boardLabel'));
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

  // Coach: prompt, played moves, lesson text and feedback. Game details live in the rail.
  const coach = document.createElement('aside');
  coach.className = 'gamebook__coach';
  const prompt = document.createElement('header');
  prompt.className = 'gamebook__prompt';
  const promptSide = document.createElement('p');
  promptSide.className = `gamebook__prompt-side gamebook__prompt-side--${opts.orientation}`;
  const promptDot = document.createElement('span');
  promptDot.className = 'gamebook__prompt-dot';
  promptDot.setAttribute('aria-hidden', 'true');
  promptSide.append(
    promptDot,
    t(opts.orientation === 'black' ? 'study.gamebook.blackToPlay' : 'study.gamebook.redToPlay'),
  );
  const promptTask = document.createElement('p');
  promptTask.className = 'gamebook__prompt-task';
  promptTask.textContent = t('study.gamebook.findBestMove');
  prompt.append(promptSide, promptTask);
  coach.append(prompt);
  const history = document.createElement('div');
  history.className = 'gamebook__moves';
  coach.append(history);
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
  const hintBtn = button(t('study.gamebook.hint'), 'gamebook__btn');
  const restartBtn = button(t('study.gamebook.restart'), 'gamebook__btn');
  controls.append(hintBtn, restartBtn);
  coach.append(bubble, controls);
  wrap.append(coach);

  const interactive = createXiangqiInteractiveBoard({
    board: boardEl,
    getInteractionView: () => currentView(),
    getPerspective: () => opts.orientation,
    // Only the learner's side is draggable, and only while awaiting their move.
    seatFor: () => (!playing && session.view().awaitingMove ? opts.orientation : null),
    enabled: () => !playing && session.view().awaitingMove,
    onMove: (move) => {
      // Captured before the attempt: a correct move advances the cursor past the
      // opponent's reply too, so afterwards the position it was played from is
      // already two plies behind.
      if (playing) return;
      const parent = session.node();
      const result = session.attempt(move);
      if (result === 'invalid') return;
      if (result === 'good') {
        playSound(soundForOwnXiangqiMove(tree.project(parent)[0]!.view, move));
      } else {
        // The lesson's own "not that one", never the ranked defeat sting.
        playSound('learn-failure');
      }
      if (result === 'good') {
        // Paint the learner's move before presenting the auto reply.
        playFrom(parent.children[0]!, result);
      } else {
        render(result);
      }
    },
  });

  // The hint rings the piece the lesson's move starts from, as well as showing
  // the authored text: a sentence alone left a long retreat unfindable, and the
  // square is known from the mainline without any extra authoring.
  hintBtn.addEventListener('click', () => {
    if (playing) return;
    const next = session.node().children[0]?.move;
    if (next) {
      interactive.setMarkers([
        { square: next.from, kind: 'circle', className: 'xq-marker--gamebook-hint' },
      ]);
    }
    hintText.textContent = session.view().hint ?? (next ? t('study.gamebook.hintPiece') : '');
  });
  restartBtn.addEventListener('click', () => {
    session.reset();
    playFrom(tree.root);
  });

  // Transition bookkeeping, so completing the lesson chimes once and a retry or
  // a re-render of the finished position does not chime again.
  let lastFeedback: GamebookFeedback | null = null;

  function renderHistory(): void {
    const entries: MoveListEntry[] = [];
    for (let node = displayed; node.parent; node = node.parent) {
      entries.unshift({ ply: node.ply, label: node.label });
    }
    history.replaceChildren();
    if (!entries.length) return;
    const list = createMoveList(entries, {
      firstMover:
        tree.root.truth.status.type === 'playing' && tree.root.truth.status.turn === 'black'
          ? 'b'
          : 'a',
      firstNumber: tree.root.truth.moveNumber,
    });
    // A record of the lesson so far, with no navigation into the solution.
    for (const cell of list.el.querySelectorAll<HTMLButtonElement>('button')) cell.disabled = true;
    history.append(list.el);
    list.update(displayed.ply, () => {});
  }

  function playFrom(start: typeof tree.root, justAttempted?: 'good'): void {
    const run = ++playback;
    const target = session.node();
    displayed = start;
    playing = displayed !== target;
    interactive.clearSelection();
    render(justAttempted);
    if (!playing) return;

    function advance(): void {
      // A chapter change or a restart invalidates pending paints and sounds.
      if (run !== playback || !root.contains(wrap)) return;
      const before = currentView();
      const next = displayed.children[0];
      if (!next?.move) return;
      displayed = next;
      interactive.render(currentView(), opts.orientation);
      renderHistory();
      renderCoach(justAttempted);
      const sound = classifyXiangqiOpponentSound(before, currentView(), opts.orientation);
      if (sound) playSound(sound);
      animateXiangqiBoardMove(boardEl, next.move, opts.orientation);
      const finish = (): void => {
        if (run !== playback || !root.contains(wrap)) return;
        if (displayed !== target) {
          window.setTimeout(advance, 500);
        } else {
          playing = false;
          // Keep the painted SVG: repainting here would erase its arrival marks.
          renderCoach(justAttempted);
        }
      };
      const duration = pieceAnimationDurationMs();
      if (duration > 0) window.setTimeout(finish, duration);
      else finish();
    }
    window.setTimeout(advance, 500);
  }

  function render(justAttempted?: 'good' | 'bad'): void {
    const view = session.view();
    // A hint ring belongs to the position it was asked in.
    if (justAttempted === 'good' || view.feedback !== 'bad') interactive.setMarkers([]);
    interactive.render(currentView(), opts.orientation);
    renderHistory();
    renderCoach(justAttempted);
  }

  function renderCoach(justAttempted?: 'good' | 'bad'): void {
    // Coach text follows the board too; completion waits for the last reply to land.
    const view = playing
      ? {
          ...session.view(),
          feedback: 'play' as const,
          comment: displayComment(displayed.annotations?.comments?.[0]),
        }
      : session.view();
    boardEl.setAttribute('aria-busy', String(playing));
    hintBtn.disabled = playing;
    coach.dataset.state = view.feedback;
    hintText.textContent = '';
    if (!playing && view.feedback === 'end' && lastFeedback !== 'end') playSound('level-end');
    if (!playing) lastFeedback = view.feedback;

    if (view.feedback === 'bad') {
      // The lesson text stays; the note under it says what was wrong, and the
      // board is still live, so the next move is the retry.
      comment.textContent = view.comment ?? '';
      feedback.textContent = view.deviation ?? t('study.gamebook.wrongMove');
    } else if (view.feedback === 'end') {
      comment.textContent = view.comment ?? '';
      feedback.textContent = t('study.gamebook.complete');
    } else {
      comment.textContent = view.comment ?? '';
      // The prompt above already says whose move it is; this line reports only
      // on an attempt.
      feedback.textContent = justAttempted === 'good' ? t('study.gamebook.correctMove') : '';
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
  playFrom(tree.root);
}

function seatStrip(name: string, ink: XiangqiColor, slot: 'top' | 'bottom'): HTMLElement {
  const el = document.createElement('div');
  el.className = `review-seat review-seat--${slot} review-seat--${ink}`;
  const disc = seatDiscEl(ink, 'review-seat__disc');
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
