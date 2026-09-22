// Xiangqi Learn — copy table. Chrome/shared strings live here; every stage's
// strings live in its own stage file (stage.copy) and are merged in at load,
// so parallel stage authoring never edits this file. Keys are shaped like
// i18n catalog entries ('learn.xiangqi.*') so folding the merged table into
// apps/web/src/i18n/catalog.ts later is a mechanical move. House style: no em
// dashes in user-facing copy.

import { currentLocale } from '../i18n/locale.js';
import { LEARN_XIANGQI_ZH_HANS, LEARN_XIANGQI_ZH_HANT } from './learn-copy-zh.js';
import { learnXiangqiStages } from './stages/index.js';

const CHROME_COPY: Record<string, string> = {
  // Chrome
  'learn.xiangqi.title': 'Learn xiangqi',
  'learn.xiangqi.byPlaying': 'by playing!',
  'learn.xiangqi.progress': 'Progress',
  'learn.xiangqi.resetProgress': 'Reset my progress',
  'learn.xiangqi.resetConfirm': 'You will lose all your progress. Reset anyway?',
  'learn.xiangqi.menu': 'Menu',
  'learn.xiangqi.backToMenu': 'Back to menu',
  'learn.xiangqi.play': 'Play',
  'learn.xiangqi.retry': 'Retry',
  'learn.xiangqi.next': 'Next',
  'learn.xiangqi.nextStage': 'Next:',
  'learn.xiangqi.levelFailed': 'Level failed',
  'learn.xiangqi.stage': 'Stage',
  'learn.xiangqi.stageComplete': 'complete',
  'learn.xiangqi.yourScore': 'Your score:',
  'learn.xiangqi.letsGo': "Let's go!",
  'learn.xiangqi.whatNext': 'What next?',
  'learn.xiangqi.whatNextCopy':
    'You know how to play xiangqi, congratulations! Ready to become a stronger player?',

  // Categories
  'learn.xiangqi.categ.pieces': 'Xiangqi pieces',
  'learn.xiangqi.categ.fundamentals': 'Fundamentals',
  'learn.xiangqi.categ.intermediate': 'Intermediate',
  'learn.xiangqi.categ.advanced': 'Advanced',

  // Congrats pool (one shown at random per solved level)
  'learn.xiangqi.congrats.1': 'Nice!',
  'learn.xiangqi.congrats.2': 'Excellent!',
  'learn.xiangqi.congrats.3': 'Great job!',
  'learn.xiangqi.congrats.4': 'Perfect!',
  'learn.xiangqi.congrats.5': 'Outstanding!',
  'learn.xiangqi.congrats.6': 'Way to go!',
  'learn.xiangqi.congrats.7': 'Yes, yes, yes!',
  'learn.xiangqi.congrats.8': "You're good at this!",

  // The "what next" cards under the finished course. Keyed like everything else
  // rather than inlined at the call site: they were the last six English strings
  // on an otherwise translated page.
  'learn.xiangqi.next.register': 'Register',
  'learn.xiangqi.next.registerSub': 'Rated games, a puzzle rating, a profile',
  'learn.xiangqi.next.puzzles': 'Puzzles',
  'learn.xiangqi.next.puzzlesSub': 'Sharpen your tactics',
  'learn.xiangqi.next.playPeople': 'Play people',
  'learn.xiangqi.next.playPeopleSub': 'Opponents from around the world',
  'learn.xiangqi.next.playMachine': 'Play machine',
  'learn.xiangqi.next.playMachineSub': 'Climb the bot ladder',
  'learn.xiangqi.next.videos': 'Videos',
  'learn.xiangqi.next.videosSub': 'Watch instructive xiangqi videos',
  'learn.xiangqi.next.watch': 'Watch',
  'learn.xiangqi.next.watchSub': 'Follow top tournament games',

  // Shared goals
  'learn.xiangqi.goal.grabAllTheStars': 'Grab all the stars!',
};

let merged: Record<string, string> | null = null;

/** The English table: chrome plus every stage's own copy, merged once. */
function table(): Record<string, string> {
  if (!merged) {
    merged = { ...CHROME_COPY };
    for (const stage of learnXiangqiStages) Object.assign(merged, stage.copy);
  }
  return merged;
}

/** Every English key the course can ask for, for the coverage test. */
export function learnCopyKeys(): string[] {
  return Object.keys(table());
}

const OVERLAYS: Record<string, Record<string, string>> = {
  'zh-Hans': LEARN_XIANGQI_ZH_HANS,
  'zh-Hant': LEARN_XIANGQI_ZH_HANT,
};

/**
 * One string of course copy, in the reader's language.
 *
 * The overlay is consulted first and English is the fallback, the same
 * degrade-one-string-at-a-time contract study-i18n.ts states. Kept as tables
 * beside this one rather than folded into the app catalog: the header above
 * calls that fold a later mechanical move, and doing it here would mean editing
 * twenty stage files to no benefit a reader can see.
 *
 * Note the last resort is the KEY itself, which is the existing behaviour and
 * worth knowing about: a missing key renders as `learn.xiangqi.horse.goal.4` on
 * the page rather than as blank space. That is why the coverage test matters
 * more here than the fallback chain does.
 */
export function learnCopy(key: string): string {
  const overlay = OVERLAYS[currentLocale()];
  return overlay?.[key] ?? table()[key] ?? key;
}

export function learnCongrats(): string {
  const index = 1 + Math.floor(Math.random() * 8);
  return learnCopy(`learn.xiangqi.congrats.${index}`);
}
