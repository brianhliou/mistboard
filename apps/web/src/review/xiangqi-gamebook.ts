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
  type XiangqiMove,
} from '@mistboard/game';
import { pieceAnimationDurationMs } from '../board-anim.js';
import { attachBoardResizeGrip, restoreBoardScale } from '../board-resize.js';
import { t } from '../i18n/catalog.js';
import {
  createLiveFinishBadges,
  finishBadgesForResult,
  generalSquareOn,
} from '../live-finish-badges.js';
import { initLiveSound, playSound } from '../live-sound.js';
import { soundForOwnXiangqiMove } from '../live-xiangqi-sound.js';
import { displayComment, displayGamebookText } from '../study-i18n.js';
import {
  animateXiangqiBoardMove,
  createXiangqiInteractiveBoard,
  type XiangqiBoardMarker,
} from '../xiangqi-board.js';
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
  /** This chapter's place in its study, shown as the practice player shows it
   *  ("#3 of 10"). The phone bar carries its own pill, so CSS hides it there. */
  progress?: { index: number; total: number };
  /** Opens the following chapter. Omitted on the last chapter, so the button is
   *  not offered at all rather than offered and inert. */
  onNext?: () => void;
}

// The puzzle page's timings, so a lesson and a puzzle answer a move alike: a
// wrong try stays on the board under its cross this long before it glides
// back, and the mated general's slash waits this long after the mating move.
const WRONG_HOLD_MS = 700;
const MATE_SLASH_DELAY_MS = 250;

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
    hint: (node) => displayGamebookText(node.annotations?.gamebook, 'hint'),
    deviation: (node) => displayGamebookText(node.annotations?.gamebook, 'deviation'),
  });

  // The session settles synchronously; the board presents those moves one at a time.
  let displayed = tree.root;
  let playing = false;
  let playback = 0;
  // A wrong try, shown where it was played until it is taken back.
  let wrongTry: { move: XiangqiMove; view: StandardXiangqiPlayerView } | null = null;
  // The square the hint ringed, kept until the position changes.
  let hintSquare: XiangqiMove['from'] | null = null;
  const currentView = (): StandardXiangqiPlayerView =>
    wrongTry?.view ?? tree.project(displayed)[0]!.view;
  const busy = (): boolean => playing || wrongTry !== null;

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
  // The puzzle page's game-over layer: a slash across the mated general. The
  // frame is the stage because the board inside it is repainted on every move.
  const finishBadges = createLiveFinishBadges(boardFrame, boardEl);

  // Coach: prompt, played moves, lesson text and feedback. Game details live in the rail.
  const coach = document.createElement('aside');
  coach.className = 'gamebook__coach';
  const prompt = document.createElement('header');
  prompt.className = 'gamebook__prompt';
  if (opts.progress) {
    // The practice player's band: the number carries the weight, "of N" beside it.
    const head = document.createElement('p');
    head.className = 'gamebook__progress';
    const num = document.createElement('span');
    num.className = 'gamebook__progress-num';
    num.textContent = `#${opts.progress.index}`;
    const of = document.createElement('span');
    of.className = 'gamebook__progress-of';
    of.textContent = t('practice.ofTotal', { total: opts.progress.total });
    head.append(num, of);
    prompt.append(head);
  }
  const promptSide = document.createElement('p');
  const promptDot = document.createElement('span');
  promptDot.className = 'gamebook__prompt-dot';
  promptDot.setAttribute('aria-hidden', 'true');
  const promptLabel = document.createElement('span');
  promptLabel.className = 'gamebook__prompt-label';
  promptSide.append(promptDot, promptLabel);
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
  controls.append(hintBtn);
  // The only control once the line is solved. There is no Restart: the chapter
  // list beside the board replays any puzzle.
  const onNext = opts.onNext;
  const nextBtn = onNext
    ? button(t('study.gamebook.nextPuzzle'), 'gamebook__btn gamebook__btn--primary gamebook__next')
    : null;
  if (nextBtn && onNext) {
    nextBtn.addEventListener('click', () => onNext());
    controls.append(nextBtn);
  }
  coach.append(bubble, controls);
  wrap.append(coach);

  // On a phone the solved text is a sheet over the board's lower ranks
  // (gamebook.css). A tap on the board tucks it back to the strip so the whole
  // final position shows; a tap on the strip opens it again. Elsewhere the
  // attribute styles nothing.
  // Read on the way down: the move that solves the line is itself a tap on the
  // board, and must not tuck the sheet it is about to open.
  let solvedBeforeTap = false;
  boardFrame.addEventListener(
    'click',
    () => {
      solvedBeforeTap = coach.dataset.state === 'end';
    },
    true,
  );
  // Only a sheet that covers part of the board can be tucked: on a tall screen
  // the text fits under the board, and cutting it short would hide it for nothing.
  const coversBoard = (): boolean =>
    coach.getBoundingClientRect().top < boardFrame.getBoundingClientRect().bottom - 8;
  boardFrame.addEventListener('click', () => {
    if (solvedBeforeTap && coach.dataset.state === 'end' && coversBoard()) {
      coach.dataset.tucked = 'true';
    }
  });
  coach.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    delete coach.dataset.tucked;
  });

  const interactive = createXiangqiInteractiveBoard({
    board: boardEl,
    getInteractionView: () => currentView(),
    getPerspective: () => opts.orientation,
    // Only the learner's side is draggable, and only while awaiting their move.
    seatFor: () => (!busy() && session.view().awaitingMove ? opts.orientation : null),
    enabled: () => !busy() && session.view().awaitingMove,
    onMove: (move) => {
      // Captured before the attempt: a correct move advances the cursor past the
      // opponent's reply too, so afterwards the position it was played from is
      // already two plies behind.
      if (busy()) return;
      const parent = session.node();
      const result = session.attempt(move);
      if (result === 'invalid') return;
      if (result === 'good') {
        const played = parent.children[0]!;
        // As on the puzzle page, the move that solves the line sounds the solve
        // in place of its own move sound (renderCoach plays it once).
        const solves = session.node() === played && session.view().feedback === 'end';
        if (!solves) playSound(soundForOwnXiangqiMove(tree.project(parent)[0]!.view, move));
        hintSquare = null;
        // Paint the learner's move before presenting the auto reply.
        playFrom(played, result);
      } else {
        // The lesson's own "not that one", never the ranked defeat sting.
        playSound('learn-failure');
        holdWrongTry(parent.truth, move);
      }
    },
  });

  // The puzzle page's wrong try: the move stays where it was played under a
  // cross, then glides back, and the board takes no move until it has.
  function holdWrongTry(from: XiangqiGameState, move: XiangqiMove): void {
    const run = playback;
    wrongTry = {
      move,
      view: xiangqiTreeAdapter.project(xiangqiTreeAdapter.applyMove(from, move))[0]!.view,
    };
    render('bad');
    window.setTimeout(() => {
      if (run !== playback || !root.contains(wrap) || !wrongTry) return;
      const taken = wrongTry.move;
      wrongTry = null;
      render('bad');
      animateXiangqiBoardMove(boardEl, taken, opts.orientation, { reverse: true });
    }, WRONG_HOLD_MS);
  }

  // The board's marks: the puzzle page's check on the learner's move while it is
  // the position shown, its cross on a wrong try, and the hint ring.
  function boardMarkers(): XiangqiBoardMarker[] {
    if (wrongTry) {
      return [
        { square: wrongTry.move.to, kind: 'glyph', icon: 'cross', className: 'xq-marker--blunder' },
      ];
    }
    const marks: XiangqiBoardMarker[] = [];
    const mover = displayed.parent?.truth.status;
    if (displayed.move && mover?.type === 'playing' && mover.turn === opts.orientation) {
      marks.push({
        square: displayed.move.to,
        kind: 'glyph',
        icon: 'check',
        className: 'xq-marker--good',
      });
    }
    if (hintSquare) {
      marks.push({ square: hintSquare, kind: 'circle', className: 'xq-marker--gamebook-hint' });
    }
    return marks;
  }

  function paintBoard(): void {
    interactive.setMarkers(boardMarkers());
    interactive.render(currentView(), opts.orientation);
  }

  // The puzzle page's mate slash, decided by the kernel's own result for the
  // shown position (a checkmate status), never by a "#" in the notation.
  function playMateSlash(): void {
    const status = displayed.truth.status;
    if (status.type !== 'finished' || status.reason !== 'checkmate' || !status.winner) return;
    const board = displayed.truth.board;
    const badges = finishBadgesForResult({
      variant: 'xiangqi',
      colors: ['red', 'black'] as const,
      winner: status.winner,
      reason: 'checkmate',
      generalSquare: (color) => generalSquareOn(board, color),
    });
    if (badges.length) finishBadges.play('gamebook', badges, { delayMs: MATE_SLASH_DELAY_MS });
  }

  // Stacked (phone), the coach sits under the board; once the line is solved,
  // bring the band and the Next button up if they are below the fold. The
  // button lands at the bottom edge, so the board stays on screen above it.
  function revealSolved(): void {
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(max-width: 60rem)').matches) return;
    const target = nextBtn ?? bubble;
    const rect = target.getBoundingClientRect();
    // The study's phone dock covers the bottom of the screen; the button's
    // scroll margin (gamebook.css) carries its height, so "on screen" means
    // above the dock, and scrollIntoView stops there too.
    const covered = Number.parseFloat(getComputedStyle(target).scrollMarginBottom) || 0;
    if (rect.height === 0 || rect.bottom <= window.innerHeight - covered) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  // The hint rings the piece the lesson's move starts from, as well as showing
  // the authored text: a sentence alone left a long retreat unfindable, and the
  // square is known from the mainline without any extra authoring.
  hintBtn.addEventListener('click', () => {
    if (busy()) return;
    const next = session.node().children[0]?.move;
    if (next) {
      hintSquare = next.from;
      interactive.setMarkers(boardMarkers());
    }
    hintText.textContent = session.view().hint ?? (next ? t('study.gamebook.hintPiece') : '');
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
    wrongTry = null;
    // A hint ring belongs to the position it was asked in.
    hintSquare = null;
    finishBadges.clear();
    interactive.clearSelection();
    render(justAttempted);
    if (!playing) return;

    function advance(): void {
      // A chapter change or a restart invalidates pending paints and sounds.
      if (run !== playback || !root.contains(wrap)) return;
      const next = displayed.children[0];
      if (!next?.move) return;
      displayed = next;
      paintBoard();
      renderHistory();
      renderCoach(justAttempted);
      // The scripted reply is silent, as on the puzzle page.
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
    paintBoard();
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
    boardEl.setAttribute('aria-busy', String(busy()));
    hintBtn.disabled = busy();
    coach.dataset.state = view.feedback;
    if (view.feedback !== 'end' || lastFeedback !== 'end') delete coach.dataset.tucked;
    // The handle (gamebook.css) shows only on a sheet that can be tucked.
    if (view.feedback !== 'end') delete coach.dataset.over;
    else if (!coach.dataset.tucked) coach.toggleAttribute('data-over', coversBoard());
    hintText.textContent = '';
    // The puzzle page's solve sound, once, when the line's last move lands.
    const justSolved = !playing && view.feedback === 'end' && lastFeedback !== 'end';
    if (!playing) lastFeedback = view.feedback;

    // Solved, the header stops asking for a move and says so instead; the
    // author's closing comment under it is what the reader came for.
    const solved = view.feedback === 'end';
    promptSide.className = `gamebook__prompt-side gamebook__prompt-side--${solved ? 'solved' : opts.orientation}`;
    promptLabel.textContent = solved
      ? t('practice.solved')
      : t(opts.orientation === 'black' ? 'study.gamebook.blackToPlay' : 'study.gamebook.redToPlay');
    // The author's own prompt ("Checkmate in one move.") already says what the
    // generic line would, so the generic one is only for a node with no comment.
    promptTask.hidden = solved || Boolean(view.comment);

    if (view.feedback === 'bad') {
      // The lesson text stays; the note under it says what was wrong, and the
      // board is still live, so the next move is the retry.
      comment.textContent = view.comment ?? '';
      feedback.textContent = view.deviation ?? t('study.gamebook.wrongMove');
    } else if (view.feedback === 'end') {
      comment.textContent = view.comment ?? '';
      // With a chapter still to come, "Lesson complete!" read as the end of the
      // study; the header says Solved and the Next button leads on. The last
      // chapter keeps the closing line.
      feedback.textContent = nextBtn ? '' : t('study.gamebook.complete');
    } else {
      comment.textContent = view.comment ?? '';
      // The prompt above already says whose move it is; this line reports only
      // on an attempt.
      feedback.textContent = justAttempted === 'good' ? t('study.gamebook.correctMove') : '';
    }

    hintBtn.hidden = view.feedback === 'end' || !session.node().children[0];
    if (nextBtn) nextBtn.hidden = view.feedback !== 'end';

    if (justSolved) {
      playSound('puzzle-solved');
      playMateSlash();
      revealSolved();
    }
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
