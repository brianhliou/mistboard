// /practice/position?fen=…&goal=mate|draw|win&side=red|black: play any xiangqi
// position out against the engine. The endgames page (/blog/xiangqi-endgames)
// links here for each position it shows, and the board editor hands its
// position over the same way.
//
// Same player as a practice study chapter (review/study-practice.ts), minus the
// study: no chapter, no progress write, no next exercise. The URL is the whole
// exercise, so it is read fail-closed (practice-position-params.ts) and a bad
// one gets a reason and a way to the editor, never a guessed exercise.

import type { XiangqiGameState } from '@mistboard/game';
import { track } from './analytics.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { backPath, parsePracticePositionParams } from './practice-position-params.js';
import { createCeval } from './review/engine/ceval.js';
import type { PracticeEval } from './review/practice-play.js';
import { evaluateXiangqiForPractice } from './review/xiangqi-practice.js';
import { mountXiangqiPractice } from './review/xiangqi-practice-player.js';
import { buildNav } from './site-shell.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';
import './live-xiangqi.css';
import './xiangqi-postgame.css';
import './review/practice.css';
import './practice-index.css';

const REJECT_KEYS: Record<'fen' | 'finished' | 'goal' | 'side', I18nKey> = {
  fen: 'practice.position.badFen',
  finished: 'practice.position.finished',
  goal: 'practice.position.badGoal',
  side: 'practice.position.badSide',
};

export function mountPracticePosition(root: HTMLElement): void {
  const request = parsePracticePositionParams(new URLSearchParams(window.location.search));
  if (!request.ok) {
    const box = document.createElement('main');
    box.className = 'practice-position__rejected';
    box.dataset.reason = request.reason;
    const p = document.createElement('p');
    p.className = 'practice-index__notice';
    p.textContent = t(REJECT_KEYS[request.reason]);
    const link = document.createElement('a');
    link.href = localizedHref('/editor/xiangqi');
    link.textContent = t('practice.position.toEditor');
    const linkLine = document.createElement('p');
    linkLine.className = 'practice-index__notice';
    linkLine.append(link);
    box.append(p, linkLine);
    root.replaceChildren(buildNav(), box);
    return;
  }

  root.classList.add('landing-page', 'xiangqi-postgame-route');
  // One engine for the whole exercise, as in a study chapter.
  const ceval = createCeval('xiangqi');
  const evaluate = (truth: XiangqiGameState): Promise<PracticeEval> =>
    evaluateXiangqiForPractice(ceval, truth);
  track('practice_started', { goal: request.goal.kind, source: 'position' });
  mountXiangqiPractice(root, {
    initialTruth: request.state,
    goal: request.goal,
    orientation: request.side,
    evaluate,
    title: t('practice.position.title'),
    nav: buildNav(),
    aside: positionCard(request.side, backPath(new URLSearchParams(location.search))),
    single: true,
  });
}

/** The left column, in the study practice rail's style: the side the learner
 *  plays and, when the link came from an article, the way back to it. */
function positionCard(side: 'red' | 'black', back: string | null): HTMLElement {
  const card = document.createElement('section');
  card.className = 'practice__panel practice__rail-card practice__position-card';
  const head = document.createElement('header');
  head.className = 'practice__rail-head';
  const icon = document.createElement('div');
  icon.className = 'practice__rail-icon';
  icon.innerHTML = renderXiangqiPiece({ color: side, role: 'general' }, { size: 44 });
  const text = document.createElement('div');
  text.className = 'practice__rail-headtext';
  const title = document.createElement('h2');
  title.className = 'practice__rail-title';
  title.textContent = t('practice.position.title');
  const sub = document.createElement('p');
  sub.className = 'practice__rail-sub';
  sub.textContent = t('practice.position.youPlay', {
    side: t(side === 'red' ? 'replay.red' : 'replay.black'),
  });
  text.append(title, sub);
  head.append(icon, text);
  card.append(head);
  if (back) {
    const link = document.createElement('a');
    link.className = 'practice__position-back';
    link.href = back;
    link.textContent = t('practice.position.backToArticle');
    card.append(link);
  }
  return card;
}
