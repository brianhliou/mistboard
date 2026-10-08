// Glue between a practice STUDY CHAPTER and the practice player: turn the stored
// chapter into a start position, hand the player a real client engine, and mount.
//
// Kept out of study.ts on purpose. study.ts is already one of the largest files
// in the web app and the ceval import chain is heavy; a practice chapter is a
// minority of chapters, so this module is dynamically imported at the point a
// practice chapter is actually opened rather than loaded into every study view.

import type { PracticeGoal, XiangqiColor, XiangqiGameState } from '@mistboard/game';
import { createInitialXiangqiState, parseStandardXiangqiFen } from '@mistboard/game';
import { track } from '../analytics.js';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { isLikelySignedIn } from '../signed-in-state.js';
import { displayComment } from '../study-i18n.js';
import { createCeval } from './engine/ceval.js';
import type { PracticeEval } from './practice-play.js';
import { evaluateXiangqiForPractice } from './xiangqi-practice.js';
import { mountXiangqiPractice, type XiangqiPracticeHandle } from './xiangqi-practice-player.js';

export interface PracticeChapterInput {
  /** The chapter's serialized tree. A practice chapter uses only its `rootFen`
   *  (the start position) and the root comment (the concept prose); the move
   *  tree itself is ignored, because the engine supplies the opposition. */
  root: {
    rootFen?: string;
    root?: {
      annotations?: { comments?: { text?: string; i18n?: Record<string, string> }[] };
    };
  };
  orientation: string;
}

/** The concept prose for the exercise: the chapter's root comment, in the
 *  reader's locale.
 *
 *  Through `displayComment` rather than `.text`, which is the whole point: the
 *  overlay rides on the comment, and reading the base text is how a chapter that
 *  IS translated still renders English. The 32 practice exercises had their
 *  Chinese written and stored, and this line was the reason the board still said
 *  "A bare horse vs A bare advisor" above it. */
export function practiceBrief(chapter: PracticeChapterInput): string | undefined {
  const text = displayComment(chapter.root?.root?.annotations?.comments?.[0])?.trim();
  return text ? text : undefined;
}

export interface MountPracticeChapterOptions {
  chapter: PracticeChapterInput;
  goal: PracticeGoal;
  title?: string;
  summary?: string;
  aside?: HTMLElement;
  /** Site nav to keep above the player (the mount replaces the root's children). */
  nav?: HTMLElement;
  progress?: { index: number; total: number };
  onNext?: () => void;
  /** Chapter id, so a solve can be recorded against it. */
  chapterId?: string;
  /** Study id, for the analytics events only. */
  studyId?: string;
}

/**
 * The exercise's start position.
 *
 * A practice chapter without a usable `rootFen` is a real authoring error, not a
 * cosmetic one: the standard start position is not an endgame exercise, and
 * quietly substituting it would present the learner with a goal ("hold the
 * draw") attached to a position that has nothing to do with it. We still fall
 * back rather than throw, because a blank board is a worse failure than a wrong
 * one, but the caller is told so it can surface the problem.
 */
export function practiceStartPosition(chapter: PracticeChapterInput): {
  state: XiangqiGameState;
  fromFen: boolean;
} {
  const fen = chapter.root?.rootFen;
  if (fen) {
    const parsed = parseStandardXiangqiFen(fen);
    if (parsed.ok) return { state: parsed.state, fromFen: true };
  }
  return { state: createInitialXiangqiState('practice'), fromFen: false };
}

export function practiceOrientation(chapter: PracticeChapterInput): XiangqiColor {
  return chapter.orientation === 'black' ? 'black' : 'red';
}

export function mountPracticeChapter(
  root: HTMLElement,
  opts: MountPracticeChapterOptions,
): XiangqiPracticeHandle {
  const { state } = practiceStartPosition(opts.chapter);
  // One engine for the whole exercise: creating it per move would pay the WASM
  // load on every ply, and the practice depth is the same every time.
  const ceval = createCeval('xiangqi');
  const evaluate = (truth: XiangqiGameState): Promise<PracticeEval> =>
    evaluateXiangqiForPractice(ceval, truth);

  // Two events, low volume, one per mount. `practice_started` is the denominator
  // the #358 gate reads; without it a completion count cannot tell "nobody
  // finished" apart from "nobody tried", which are different problems with
  // different answers.
  track('practice_started', {
    ...(opts.studyId === undefined ? {} : { studyId: opts.studyId }),
    ...(opts.chapterId === undefined ? {} : { chapterId: opts.chapterId }),
    goal: opts.goal.kind,
  });

  return mountXiangqiPractice(root, {
    initialTruth: state,
    goal: opts.goal,
    orientation: practiceOrientation(opts.chapter),
    evaluate,
    ...(opts.title === undefined ? {} : { title: opts.title }),
    ...(opts.summary === undefined ? {} : { summary: opts.summary }),
    ...(opts.aside === undefined ? {} : { aside: opts.aside }),
    ...(opts.nav === undefined ? {} : { nav: opts.nav }),
    ...(() => {
      const brief = practiceBrief(opts.chapter);
      return brief === undefined ? {} : { brief };
    })(),
    ...(opts.progress === undefined ? {} : { progress: opts.progress }),
    ...(opts.onNext === undefined ? {} : { onNext: opts.onNext }),
    // A guest's solve is dropped server-side, so after one the panel offers
    // sign-in, returning to this chapter (the current URL) afterwards.
    guestSignInHref: () => (isLikelySignedIn() ? undefined : loginHrefForCurrentPage()),
    ...(opts.chapterId === undefined
      ? {}
      : {
          onSolved: (moves: number) => {
            track('practice_solved', {
              ...(opts.studyId === undefined ? {} : { studyId: opts.studyId }),
              chapterId: opts.chapterId,
              goal: opts.goal.kind,
              moves,
            });
            // Fire and forget. A progress write that fails must not interrupt
            // the moment the learner just succeeded, and there is nothing
            // useful to tell them about it -- the next page load simply will
            // not show the tick.
            void fetch('/api/practice/complete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ chapterId: opts.chapterId, moves }),
            }).catch(() => {});
          },
          onFailed: (verdict: string, moves: number) => {
            track('practice_failed', {
              ...(opts.studyId === undefined ? {} : { studyId: opts.studyId }),
              chapterId: opts.chapterId,
              goal: opts.goal.kind,
              verdict,
              moves,
            });
          },
        }),
  });
}
