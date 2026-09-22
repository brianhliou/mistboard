// Xiangqi Learn — the /learn/xiangqi page (lila learn view.ts + runView.ts
// port). Hash-routed inside the page: '' = map screen, '#/<stageKey>' =
// stage (resumes at the first unscored level), '#/<stageKey>/<levelId>' =
// a specific level. All DOM lives here; game logic lives in the runner.

import '../live-xiangqi.css';
import '../tile-map.css';
import './learn-xiangqi.css';

import type { XiangqiPieceRole, XiangqiSquare } from '@mistboard/game';
import { loadCachedCurrentUser } from '../account-nav.js';
import { initLiveSound, playSound } from '../live-sound.js';
import { isLikelySignedIn } from '../signed-in-state.js';
import { buildNav } from '../site-shell.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import {
  createXiangqiInteractiveBoard,
  type XiangqiBoardArrow,
  type XiangqiBoardMarker,
} from '../xiangqi-board.js';
import { renderXiangqiPiece } from '../xiangqi-pieces.js';
import { learnCongrats, learnCopy } from './learn-copy.js';
import { createLevelRunner, type LearnSound, type LevelRunner } from './learn-level-runner.js';
import { levelRank, stageRank, starsOfRank } from './learn-score.js';
import {
  completedLevelCount,
  firstUnscoredLevelId,
  isStageComplete,
  type LearnProgress,
  loadLearnProgress,
  resetLearnProgress,
  saveLevelScore,
  stageHasProgress,
  stageScores,
} from './learn-storage.js';
import type { LearnLevel, LearnShape, LearnStage } from './learn-types.js';
import {
  learnXiangqiCategories,
  learnXiangqiStages,
  stageAfter,
  stageByKey,
  totalLevelCount,
} from './stages/index.js';

// Long enough for the level-end arpeggio and the staggered star pop to land
// before the board swaps; the completion beat is part of the reward.
const AUTO_ADVANCE_DELAY_MS = 1800;
// How long the pickup sparkle marker stays on the board (matches the CSS
// animation length so it never freezes mid-frame).
const SPARKLE_MS = 500;
const SCORE_COUNT_UP_MS = 900;

// "What next?" funnel tiles (map bottom). Watch takes lichess's Practice slot.
const WHAT_NEXT_TILES: {
  title: string;
  subtitle: string;
  href: string;
  glyph: string;
  /** Renders in the done state, ribbon and all, once the visitor has an account.
   *  Only Register can be finished: every other tile is somewhere to go, not a
   *  thing to complete. Asking a signed-in player to register reads as though
   *  the progress the card promises to keep is not actually being kept. */
  doneWhenSignedIn?: boolean;
}[] = [
  {
    title: 'learn.xiangqi.next.register',
    subtitle: 'learn.xiangqi.next.registerSub',
    href: '/account',
    glyph: '👤',
    doneWhenSignedIn: true,
  },
  {
    title: 'learn.xiangqi.next.puzzles',
    subtitle: 'learn.xiangqi.next.puzzlesSub',
    href: '/puzzles',
    glyph: '🎯',
  },
  {
    title: 'learn.xiangqi.next.playPeople',
    subtitle: 'learn.xiangqi.next.playPeopleSub',
    href: '/',
    glyph: '⚔️',
  },
  {
    title: 'learn.xiangqi.next.playMachine',
    subtitle: 'learn.xiangqi.next.playMachineSub',
    href: '/',
    glyph: '🤖',
  },
  {
    title: 'learn.xiangqi.next.videos',
    subtitle: 'learn.xiangqi.next.videosSub',
    href: '/videos',
    glyph: '🎬',
  },
  {
    title: 'learn.xiangqi.next.watch',
    subtitle: 'learn.xiangqi.next.watchSub',
    href: '/broadcast/xiangqi',
    glyph: '📺',
  },
];

type Route = { kind: 'map' } | { kind: 'run'; stage: LearnStage; levelId: number };

export function mountLearnXiangqi(root: HTMLElement): void {
  initLiveSound();

  const page = document.createElement('div');
  page.className = 'learn-xq';
  root.replaceChildren(buildNav(), page);

  let progress: LearnProgress = loadLearnProgress();
  // The hint, not the answer: it paints the right shape on the first frame and
  // is reconciled below once /api/auth/me settles. A stale one is possible
  // (signed out in another tab), which is exactly what the reconcile is for.
  let signedIn = isLikelySignedIn();
  let runner: LevelRunner | null = null;
  const pageTimers = new Set<ReturnType<typeof setTimeout>>();

  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      pageTimers.delete(timer);
      fn();
    }, ms);
    pageTimers.add(timer);
  };

  function teardownLevel(): void {
    runner?.dispose();
    runner = null;
    for (const timer of pageTimers) clearTimeout(timer);
    pageTimers.clear();
  }

  function parseRoute(): Route {
    const match = /^#\/([a-z0-9-]+)(?:\/(\d+))?$/.exec(window.location.hash);
    if (!match) return { kind: 'map' };
    const stage = stageByKey(match[1] ?? '');
    if (!stage) return { kind: 'map' };
    const levelId = match[2]
      ? Math.min(Math.max(Number(match[2]), 1), stage.levels.length)
      : firstUnscoredLevelId(progress, stage);
    return { kind: 'run', stage, levelId };
  }

  function navigate(hash: string): void {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  function render(): void {
    teardownLevel();
    const route = parseRoute();
    if (route.kind === 'map') renderMap();
    else renderRun(route.stage, route.levelId);
  }

  window.addEventListener('hashchange', render);

  // Reconcile the auth guess. Re-render only when the answer differs AND we are
  // on the map: a player who opened a level while this was in flight is mid-move
  // on a board the runner owns, and rebuilding the page under them would throw
  // that away to restyle a tile they cannot see.
  void loadCachedCurrentUser()
    .then((user) => user !== null)
    .catch(() => false)
    .then((resolved) => {
      if (resolved === signedIn) return;
      signedIn = resolved;
      if (parseRoute().kind === 'map') render();
    });
  // Pieces are baked as inline SVG glyphs at render time, so a live piece-set
  // change (fired by the appearance picker) needs a full re-render to repaint
  // the board and the piece legend. Without this, the setting only takes effect
  // after a reload. Mirrors xiangqi-replay.ts.
  window.addEventListener(xiangqiAppearanceChangedEvent, render);

  // ── Map screen ─────────────────────────────────────────────────────────────
  // The map builders live at module scope (below) so the prerenderer can render
  // the same stage list without a mounted page or localStorage. These wrappers
  // just bind them to this mount's mutable progress + re-render callbacks.

  function renderMap(): void {
    page.className = 'learn-xq learn-xq--map';
    page.replaceChildren(
      buildLearnMapSidebar(progress, () => {
        if (window.confirm(learnCopy('learn.xiangqi.resetConfirm'))) {
          resetLearnProgress();
          progress = loadLearnProgress();
          render();
        }
      }),
      buildLearnMapMain(progress, signedIn),
    );
  }

  // ── Run screen ─────────────────────────────────────────────────────────────

  function renderRun(stage: LearnStage, levelId: number): void {
    const level = stage.levels[levelId - 1];
    if (!level) {
      navigate('');
      return;
    }
    page.className = 'learn-xq learn-xq--run';

    const side = runSidebar(stage);
    const main = document.createElement('main');
    main.className = 'learn-xq-run-main';
    const boardWrap = document.createElement('div');
    boardWrap.className = 'learn-xq-board xiangqi-live-board';
    if (level.cssClass) boardWrap.classList.add(level.cssClass);
    const boardHost = document.createElement('div');
    boardHost.className = 'learn-xq-board-host';
    boardWrap.append(boardHost);
    main.append(boardWrap);

    const table = document.createElement('aside');
    table.className = 'learn-xq-table';

    page.replaceChildren(side, main, table);

    mountLevel(stage, level, boardHost, table);

    // First visit to a stage: intro overlay (with its own stage-start sound).
    // Every other level mount gets a soft level-start ping instead.
    if (!stageHasProgress(progress, stage) && levelId === 1) {
      page.append(stageStartOverlay(stage));
    } else {
      playSound('level-start');
    }
  }

  function runSidebar(activeStage: LearnStage): HTMLElement {
    const side = document.createElement('aside');
    side.className = 'learn-xq-run-side';
    const back = document.createElement('a');
    back.className = 'learn-xq-back';
    back.href = '#';
    back.textContent = `← ${learnCopy('learn.xiangqi.backToMenu')}`;
    side.append(back);
    for (const [categoryIndex, categ] of learnXiangqiCategories.entries()) {
      const section = document.createElement('section');
      section.className = 'learn-xq-side-category';
      const categoryHasActiveStage = categ.stages.some((stage) => stage.key === activeStage.key);
      if (categoryHasActiveStage) section.classList.add('expanded');

      const heading = document.createElement('h3');
      const toggle = document.createElement('button');
      const panelId = `learn-xq-side-category-${categoryIndex}`;
      toggle.type = 'button';
      toggle.className = 'learn-xq-side-category-toggle';
      toggle.setAttribute('aria-controls', panelId);
      toggle.setAttribute('aria-expanded', String(categoryHasActiveStage));
      toggle.innerHTML = `<span>${learnCopy(categ.name)}</span><span class="learn-xq-side-category-chevron" aria-hidden="true">›</span>`;
      heading.append(toggle);

      const stages = document.createElement('div');
      stages.id = panelId;
      stages.className = 'learn-xq-side-category-stages';
      stages.hidden = !categoryHasActiveStage;
      for (const stage of categ.stages) {
        const link = document.createElement('a');
        link.href = `#/${stage.key}`;
        link.className = 'learn-xq-side-stage';
        if (stage.key === activeStage.key) {
          link.classList.add('active');
          link.setAttribute('aria-current', 'step');
        }
        if (isStageComplete(progress, stage)) link.classList.add('done');
        link.innerHTML = `<span class="learn-xq-side-illus">${stageIllustration(stage, 24)}</span>${learnCopy(stage.title)}`;
        stages.append(link);
      }
      toggle.addEventListener('click', () => {
        const willExpand = !section.classList.contains('expanded');
        for (const candidate of side.querySelectorAll<HTMLElement>('.learn-xq-side-category')) {
          const candidateToggle = candidate.querySelector<HTMLButtonElement>(
            '.learn-xq-side-category-toggle',
          );
          const candidateStages = candidate.querySelector<HTMLElement>(
            '.learn-xq-side-category-stages',
          );
          const expanded = candidate === section && willExpand;
          candidate.classList.toggle('expanded', expanded);
          candidateToggle?.setAttribute('aria-expanded', String(expanded));
          if (candidateStages) candidateStages.hidden = !expanded;
        }
      });
      section.append(heading, stages);
      side.append(section);
    }
    return side;
  }

  function mountLevel(
    stage: LearnStage,
    level: LearnLevel,
    boardHost: HTMLElement,
    table: HTMLElement,
  ): void {
    let shapes: readonly LearnShape[] = [];
    // Squares wearing a transient pickup-sparkle marker (apple just eaten).
    const sparkles = new Set<XiangqiSquare>();

    const board = createXiangqiInteractiveBoard({
      board: boardHost,
      // Goal copy names points ("lift each cannon to b3 and h3", "every
      // advisor road runs through e2"), so the labels are part of the lesson:
      // always on, in the native a-i / 1-10 squares the copy uses, whatever
      // the reader's board preference says.
      coordinates: true,
      coordinateStyle: 'coordinate',
      getInteractionView: () => runner?.view() ?? null,
      getPerspective: () => level.color,
      seatFor: () => level.color,
      enabled: () => runner !== null && !runner.vm().completed && !runner.vm().failed,
      onMove: (move) => runner?.userMove(move),
    });

    const syncOverlays = (): void => {
      const arrows: XiangqiBoardArrow[] = [];
      const markers: XiangqiBoardMarker[] = [];
      for (const shape of shapes) {
        if (shape.kind === 'arrow') {
          arrows.push({
            from: shape.from,
            to: shape.to,
            className: `xq-arrow--learn-${shape.brush ?? 'green'}`,
          });
        } else {
          markers.push({
            square: shape.square,
            kind: 'circle',
            className: `xq-marker--${shape.brush ?? 'green'}`,
          });
        }
      }
      for (const square of runner?.apples() ?? []) {
        markers.push({ square, kind: 'star', className: 'xq-marker--apple' });
      }
      for (const square of sparkles) {
        markers.push({ square, kind: 'star', className: 'xq-marker--sparkle' });
      }
      board.setArrows(arrows);
      board.setMarkers(markers);
    };

    const rerender = (): void => {
      if (!runner) return;
      board.render(runner.view(), level.color);
      syncOverlays();
      renderTable(stage, level, table);
    };

    runner = createLevelRunner(level, {
      onChange: rerender,
      onShapes: (next) => {
        shapes = next;
        syncOverlays();
      },
      onSound: (sound) => {
        // Apple pickup: flash a sparkle on the collected point. lastMove is
        // already the pickup move when the take sound fires.
        if (sound === 'take') {
          const square = runner?.view().lastMove?.to;
          if (square) {
            sparkles.add(square);
            later(() => {
              sparkles.delete(square);
              syncOverlays();
            }, SPARKLE_MS);
          }
        }
        playLearnSound(sound);
      },
      onComplete: (score) => {
        progress = saveLevelScore(stage.key, level.id, score);
        renderTable(stage, level, table);
        if (!level.nextButton) later(() => advance(stage, level), AUTO_ADVANCE_DELAY_MS);
      },
      onFail: () => renderTable(stage, level, table),
    });

    runner.start();
    rerender();
  }

  function advance(stage: LearnStage, level: LearnLevel): void {
    const nextLevel = stage.levels[level.id];
    if (nextLevel) {
      navigate(`#/${stage.key}/${nextLevel.id}`);
      return;
    }
    // Last level: stage-complete overlay over the run screen.
    page.append(stageCompleteOverlay(stage));
  }

  function renderTable(stage: LearnStage, level: LearnLevel, table: HTMLElement): void {
    const vm = runner?.vm() ?? { moves: 0, score: 0, completed: false, failed: false };
    table.replaceChildren();

    const header = document.createElement('div');
    header.className = 'learn-xq-table-header';
    header.innerHTML = `
      <div class="learn-xq-table-illus">${stageIllustration(stage, 48)}</div>
      <div><h2>${learnCopy(stage.title)}</h2><p>${learnCopy(stage.subtitle)}</p></div>`;
    table.append(header);

    const body = document.createElement('div');
    body.className = 'learn-xq-table-body';
    if (vm.failed) {
      body.classList.add('learn-xq-result--failed');
      body.innerHTML = `<p>${learnCopy('learn.xiangqi.levelFailed')}</p><button type="button" class="learn-xq-retry">${learnCopy('learn.xiangqi.retry')}</button>`;
      body.addEventListener('click', () => render());
    } else if (vm.completed) {
      body.classList.add('learn-xq-result--completed');
      const stars = starsOfRank(levelRank(level, vm.score));
      body.innerHTML = `<p class="learn-xq-congrats">${learnCongrats()}</p><div class="learn-xq-stars learn-xq-stars--animated">${starIcons(stars)}</div>`;
      if (level.nextButton) {
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'learn-xq-next';
        next.textContent = learnCopy('learn.xiangqi.next');
        next.addEventListener('click', () => advance(stage, level));
        body.append(next);
      }
    } else {
      body.innerHTML = `<p class="learn-xq-goal">${learnCopy(level.goal)}</p>`;
    }
    table.append(body);

    const pills = document.createElement('div');
    pills.className = 'learn-xq-pills';
    const scores = stageScores(progress, stage.key);
    for (const candidate of stage.levels) {
      const pill = document.createElement('a');
      pill.href = `#/${stage.key}/${candidate.id}`;
      pill.className = 'learn-xq-pill';
      if (candidate.id === level.id) pill.classList.add('active');
      const score = scores[candidate.id - 1] ?? 0;
      if (score > 0) {
        pill.classList.add('done');
        pill.innerHTML = starIcons(starsOfRank(levelRank(candidate, score)));
      } else {
        pill.textContent = String(candidate.id);
      }
      pills.append(pill);
    }
    table.append(pills);
  }

  // ── Overlays ───────────────────────────────────────────────────────────────

  function stageStartOverlay(stage: LearnStage): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'learn-xq-overlay';
    const card = document.createElement('div');
    card.className = 'learn-xq-overlay-card';
    card.innerHTML = `
      <h2>${learnCopy('learn.xiangqi.stage')} ${stage.id}: ${learnCopy(stage.title)}</h2>
      <div class="learn-xq-overlay-illus">${stageIllustration(stage, 96)}</div>
      <p>${learnCopy(stage.intro)}</p>
      <button type="button" class="learn-xq-overlay-go">${learnCopy('learn.xiangqi.letsGo')}</button>`;
    overlay.append(card);
    overlay.addEventListener('click', () => overlay.remove());
    playSound('stage-start');
    return overlay;
  }

  function stageCompleteOverlay(stage: LearnStage): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'learn-xq-overlay';
    const card = document.createElement('div');
    card.className = 'learn-xq-overlay-card learn-xq-overlay-card--complete';
    const scores = stageScores(progress, stage.key);
    const stars = starsOfRank(stageRank(stage, scores));
    const total = scores.reduce((sum, score) => sum + score, 0);
    const next = stageAfter(stage);
    card.innerHTML = `
      <div class="learn-xq-stars learn-xq-stars--animated">${starIcons(stars)}</div>
      <h2>${learnCopy('learn.xiangqi.stage')} ${stage.id} ${learnCopy('learn.xiangqi.stageComplete')}</h2>
      <p class="learn-xq-score"><span>${learnCopy('learn.xiangqi.yourScore')}</span> <em class="learn-xq-score-value">0</em></p>
      <p>${learnCopy(stage.complete)}</p>`;
    // Count the score up from zero while the stars pop.
    const scoreValue = card.querySelector<HTMLElement>('.learn-xq-score-value');
    if (scoreValue) {
      const startedAt = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - startedAt) / SCORE_COUNT_UP_MS);
        const eased = 1 - (1 - t) ** 3;
        scoreValue.textContent = Math.round(total * eased).toLocaleString();
        if (t < 1 && overlay.isConnected) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
    const buttons = document.createElement('div');
    buttons.className = 'learn-xq-overlay-buttons';
    if (next) {
      const nextButton = document.createElement('button');
      nextButton.type = 'button';
      nextButton.className = 'learn-xq-overlay-go';
      nextButton.textContent = `${learnCopy('learn.xiangqi.nextStage')} ${learnCopy(next.title)} ›`;
      nextButton.addEventListener('click', () => navigate(`#/${next.key}`));
      buttons.append(nextButton);
    }
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'learn-xq-overlay-menu';
    menuButton.textContent = `‹ ${learnCopy('learn.xiangqi.backToMenu')}`;
    menuButton.addEventListener('click', () => navigate(''));
    buttons.append(menuButton);
    card.append(buttons);
    overlay.append(card);
    playSound('stage-end');
    return overlay;
  }

  // ── Shared bits ────────────────────────────────────────────────────────────

  function playLearnSound(sound: LearnSound): void {
    // The lila seven-sound palette: pickups, failures, and level completion
    // each have their own voice. 'failure' is deliberately NOT the ranked
    // 'lose' sting: a lesson retry should feel invited, not punished.
    const mapping = {
      move: 'move',
      take: 'learn-take',
      capture: 'capture',
      failure: 'learn-failure',
      levelEnd: 'level-end',
    } as const;
    playSound(mapping[sound]);
  }

  render();
}

// Shared by the live mount and the prerenderer; no page or progress state.
function pieceSvg(role: XiangqiPieceRole, size: number): string {
  return renderXiangqiPiece({ color: 'red', role }, { size });
}

function stageIllustration(stage: LearnStage, size: number): string {
  if (stage.illustration.piece) {
    return pieceSvg(stage.illustration.piece as XiangqiPieceRole, size);
  }
  return `<span class="learn-xq-glyph" style="font-size:${size * 0.8}px">${stage.illustration.glyph ?? '★'}</span>`;
}

function starIcons(count: number): string {
  return Array.from(
    { length: 3 },
    (_, index) => `<span class="learn-xq-star${index < count ? ' filled' : ''}">★</span>`,
  ).join('');
}

// ── Map screen builders (module scope) ───────────────────────────────────────
// Pure over `progress`, so both the live mount and the build-time prerenderer
// use the same code path. `onReset` is omitted by the prerenderer: with empty
// progress the reset button is not rendered anyway.

function stageState(progress: LearnProgress, stage: LearnStage): 'done' | 'ongoing' | 'future' {
  if (isStageComplete(progress, stage)) return 'done';
  const prev = learnXiangqiStages.find((candidate) => candidate.id === stage.id - 1);
  if (!prev || isStageComplete(progress, prev) || stageHasProgress(progress, stage)) {
    return 'ongoing';
  }
  return 'future';
}

function buildLearnMapSidebar(progress: LearnProgress, onReset?: () => void): HTMLElement {
  const side = document.createElement('aside');
  side.className = 'learn-xq-side-card';
  const illus = document.createElement('div');
  illus.className = 'learn-xq-mascot';
  illus.innerHTML = pieceSvg('general', 96);
  const title = document.createElement('h1');
  title.textContent = learnCopy('learn.xiangqi.title');
  const sub = document.createElement('p');
  sub.textContent = learnCopy('learn.xiangqi.byPlaying');
  const done = completedLevelCount(progress, learnXiangqiStages);
  const total = totalLevelCount();
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const bar = document.createElement('div');
  bar.className = 'learn-xq-progress-bar';
  bar.innerHTML = `<div class="learn-xq-progress-fill" style="width:${pct}%"></div><span>${learnCopy('learn.xiangqi.progress')}: ${pct}%</span>`;
  side.append(illus, title, sub, bar);
  if (done > 0 && onReset) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'learn-xq-reset';
    reset.textContent = learnCopy('learn.xiangqi.resetProgress');
    reset.addEventListener('click', onReset);
    side.append(reset);
  }
  return side;
}

function buildLearnMapMain(progress: LearnProgress, signedIn: boolean): HTMLElement {
  const main = document.createElement('main');
  main.className = 'learn-xq-map-main';
  for (const categ of learnXiangqiCategories) {
    const section = document.createElement('section');
    section.className = 'learn-xq-categ';
    const heading = document.createElement('h2');
    heading.textContent = learnCopy(categ.name);
    const grid = document.createElement('div');
    grid.className = 'learn-xq-tile-grid';
    for (const stage of categ.stages) grid.append(buildLearnStageTile(progress, stage));
    section.append(heading, grid);
    main.append(section);
  }
  main.append(buildLearnWhatNextSection(signedIn));
  return main;
}

function buildLearnStageTile(progress: LearnProgress, stage: LearnStage): HTMLElement {
  const state = stageState(progress, stage);
  const tile = document.createElement('a');
  tile.className = `learn-xq-tile learn-xq-tile--${state}`;
  tile.href = `#/${stage.key}`;
  const illus = document.createElement('div');
  illus.className = 'learn-xq-tile-illus';
  illus.innerHTML = stageIllustration(stage, 56);
  const text = document.createElement('div');
  text.className = 'learn-xq-tile-text';
  const title = document.createElement('h3');
  title.textContent = learnCopy(stage.title);
  const subtitle = document.createElement('p');
  subtitle.textContent = learnCopy(stage.subtitle);
  text.append(title, subtitle);
  tile.append(illus, text);
  // Folded corner ribbon (lichess anatomy): stars once done, progress text
  // while ongoing, nothing on locked (future) stages.
  if (state !== 'future') {
    const wrap = document.createElement('div');
    wrap.className = 'learn-xq-ribbon-wrap';
    const ribbon = document.createElement('div');
    ribbon.className = `learn-xq-ribbon learn-xq-ribbon--${state}`;
    if (state === 'done') {
      ribbon.innerHTML = starIcons(starsOfRank(stageRank(stage, stageScores(progress, stage.key))));
    } else {
      const done = stageScores(progress, stage.key).filter((score) => score > 0).length;
      ribbon.textContent =
        done > 0 ? `${done} / ${stage.levels.length}` : learnCopy('learn.xiangqi.play');
    }
    wrap.append(ribbon);
    tile.append(wrap);
  }
  return tile;
}

function buildLearnWhatNextSection(signedIn: boolean): HTMLElement {
  const section = document.createElement('section');
  section.className = 'learn-xq-categ learn-xq-what-next';
  const heading = document.createElement('h2');
  heading.textContent = learnCopy('learn.xiangqi.whatNext');
  const copy = document.createElement('p');
  copy.className = 'learn-xq-what-next-copy';
  copy.textContent = learnCopy('learn.xiangqi.whatNextCopy');
  const grid = document.createElement('div');
  grid.className = 'learn-xq-tile-grid';
  for (const item of WHAT_NEXT_TILES) {
    const done = item.doneWhenSignedIn === true && signedIn;
    const tile = document.createElement('a');
    tile.className = `learn-xq-tile learn-xq-tile--${done ? 'done' : 'link'}`;
    tile.href = item.href;
    tile.innerHTML = `
        <div class="learn-xq-tile-illus learn-xq-tile-glyph">${item.glyph}</div>
        <div class="learn-xq-tile-text"><h3>${learnCopy(item.title)}</h3><p>${learnCopy(item.subtitle)}</p></div>`;
    // Same anatomy a finished stage uses: the folded corner ribbon is what
    // actually reads as "done" on this page, since the done and link tints are
    // the same colour.
    if (done) {
      const wrap = document.createElement('div');
      wrap.className = 'learn-xq-ribbon-wrap';
      const ribbon = document.createElement('div');
      ribbon.className = 'learn-xq-ribbon learn-xq-ribbon--done';
      // Labelled, not decorative: a bare check character is what a screen
      // reader would otherwise announce, and it is the only thing on the tile
      // that says the visitor has already done this.
      ribbon.setAttribute('role', 'img');
      ribbon.setAttribute('aria-label', 'Completed');
      ribbon.innerHTML = '<span class="learn-xq-check">✓</span>';
      wrap.append(ribbon);
      tile.append(wrap);
    }
    grid.append(tile);
  }
  section.append(heading, copy, grid);
  return section;
}

// Build-time prerender of the stage map: nav + sidebar + all 20 stage tiles.
// Crawlers and no-JS clients get the real course outline instead of an empty
// shell; the client mount replaces it on takeover. Progress is always empty
// here (it lives in localStorage), which is also what a first-time visitor sees.
export function renderLearnXiangqiShellForPrerender(): string {
  const emptyProgress: LearnProgress = { stages: {} };
  const page = document.createElement('div');
  page.className = 'learn-xq learn-xq--map';
  // Signed-out, always: this HTML is built once and served to every visitor, so
  // it cannot carry one visitor's auth state. The client mount restyles the
  // Register tile on takeover, the same way it fills in real progress.
  page.append(buildLearnMapSidebar(emptyProgress), buildLearnMapMain(emptyProgress, false));
  return `${buildNav().outerHTML}${page.outerHTML}`;
}
