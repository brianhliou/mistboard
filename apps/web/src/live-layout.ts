import { attachBoardResizeGrip, restoreBoardScale } from './board-resize.js';
import { createGameTable } from './game-table.js';
import './live-lifecycle-effects.css';
import type { LiveRefs } from './live-state.js';
import './review/review-shell.css';
import './live-review.css';
import { buildLiveRoomChat } from './review/spectator-chat.js';
import { buildNav } from './site-shell.js';

export function setLiveLayoutGameSpec(target: HTMLElement, gameSpecId: string | null): void {
  // The chess stack (fog chess / Draft960) has no tenant route class; give it
  // one so it can carry uniboard tokens (aspect / capture-strip chrome) like
  // every other variant.
  target.classList.toggle(
    'live-route--chess',
    gameSpecId === null || gameSpecId === 'dark-chess' || gameSpecId === 'dark-draft960',
  );
  target.classList.toggle(
    'live-route--xiangqi',
    gameSpecId === 'dark-xiangqi' || gameSpecId === 'xiangqi',
  );
  target.classList.toggle(
    'live-route--mini-xiangqi',
    gameSpecId === 'mini-xiangqi' ||
      gameSpecId === 'dark-mini-xiangqi' ||
      gameSpecId === 'drop-mini-xiangqi',
  );
  target.classList.toggle('live-route--drop-mini-xiangqi', gameSpecId === 'drop-mini-xiangqi');
  target.classList.toggle('live-route--duck-xiangqi', gameSpecId === 'duck-xiangqi');
  target.classList.toggle('live-route--fortress-xiangqi', gameSpecId === 'fortress-xiangqi');
  target.classList.toggle('live-route--crossroads-chess', gameSpecId === 'crossroads-chess');
  target.classList.toggle('live-route--jieqi', gameSpecId === 'jieqi');
  target.classList.toggle('live-route--banqi', gameSpecId === 'banqi');
  target.classList.toggle('live-route--reveal-chess', gameSpecId === 'reveal-chess');
  target.classList.toggle('live-route--shogi', gameSpecId === 'dark-shogi');
  target.classList.toggle('live-route--crazyhouse', gameSpecId === 'dark-crazyhouse');
  target.classList.toggle('live-route--kriegspiel', gameSpecId === 'kriegspiel');
  target.classList.toggle('live-route--jungle', gameSpecId === 'jungle');
  target.classList.toggle('live-route--jungle-flip', gameSpecId === 'jungle-flip');
}

// Static room chrome only. Live game decisions stay in live-render.ts.
export function createLiveLayout(
  target: HTMLDivElement,
  options: { debugRequested: boolean; roomId: string },
): LiveRefs {
  target.innerHTML = `
    <main class="shell${options.debugRequested ? ' debug-shell' : ''}">
      ${
        options.debugRequested
          ? `
      <section class="topbar">
        <div>
          <h1>Fog Debug</h1>
          <p data-room-meta>Connecting</p>
        </div>
      </section>`
          : '<p data-room-meta hidden></p>'
      }

      <section class="play-grid">
        <div class="review-shell__cluster live-review__cluster">
          <aside class="side-panel meta-panel review-shell__rail review-shell__left" aria-label="Game info">
            <section class="panel-section">
              <div data-game-info></div>
            </section>
            <section data-offer-section class="panel-section">
              <h2>Dark Draft960 Offer</h2>
              <div data-starts class="starts"></div>
            </section>
            <section data-selection-section class="panel-section">
              <h2>Selections</h2>
              <div data-selections class="selection-list"></div>
            </section>
            <div data-live-room-chat></div>
          </aside>
          <div class="review-shell__center">
          <div class="board-shell">
            <div class="board-stage">
              <div data-board-status class="board-status">
                <div class="board-status__inner">
                  <span data-board-status-spinner class="board-status__spinner" aria-hidden="true"></span>
                  <p data-board-status-label class="board-status__label">Connecting</p>
                </div>
              </div>
              <div data-board class="board" aria-label="chess board"></div>
              <div data-board-paused class="board-paused" hidden role="status" aria-live="polite">
                <div class="board-paused__badge">
                  <strong data-board-paused-title>Game paused</strong>
                  <span data-board-paused-body>Server is restarting — your game will resume shortly</span>
                </div>
              </div>
              <div data-draft-picker class="draft-picker" hidden></div>
              <div data-promotion class="promotion-picker" hidden></div>
            </div>
          </div>
          </div>
          <aside data-game-table-host class="side-panel moves-panel review-shell__rail review-shell__right" aria-label="Game table"></aside>
        </div>
        <section data-dev-views-section class="debug-page" hidden>
          <div class="debug-header">
            <h2>Debug Views</h2>
          </div>
          <div data-dev-views class="debug-views"></div>
        </section>
      </section>
    </main>
  `;

  const gameTableHost = target.querySelector<HTMLElement>('[data-game-table-host]');
  if (!gameTableHost) throw new Error('missing game table host');
  const gameTable = createGameTable();
  gameTableHost.append(gameTable.el);

  const chatHost = target.querySelector<HTMLElement>('[data-live-room-chat]');
  if (!chatHost) throw new Error('missing live room chat host');
  chatHost.replaceWith(buildLiveRoomChat(options.roomId));

  // The room rides the shared site nav (brand + Watch/Leaderboard + Learn +
  // account), prepended as an element so its dropdown and mobile toggle wire
  // up; account-nav.ts hydrates it via its body MutationObserver like every
  // other page. Previously this was a hand-rolled static string that drifted
  // (no Learn menu, no mobile toggle) — converging keeps one nav source.
  target.prepend(buildNav());

  // Board zoom: restore the user's persisted scale and hang the drag grip off
  // the board-stage corner (board-stage width == board width in the room).
  restoreBoardScale();
  const boardStage = target.querySelector<HTMLElement>('.board-stage');
  if (boardStage) attachBoardResizeGrip(boardStage, boardStage);

  const roomMeta = target.querySelector<HTMLParagraphElement>('[data-room-meta]');
  const gameInfo = target.querySelector<HTMLDivElement>('[data-game-info]');
  const board = target.querySelector<HTMLDivElement>('[data-board]');
  const boardPaused = target.querySelector<HTMLDivElement>('[data-board-paused]');
  const boardStatus = target.querySelector<HTMLDivElement>('[data-board-status]');
  const {
    actionSection,
    actionStatus,
    capturesBottom,
    capturesTop,
    clockBottom,
    clockNote,
    clockTop,
    gameControls,
    gameControlsSection,
    hiddenPool,
    moveList,
    playerBottom,
    playerTop,
    replayControls,
    replayMeta,
    roomActions,
  } = gameTable.refs;
  const devViewsSection = target.querySelector<HTMLElement>('[data-dev-views-section]');
  const devViewsPanel = target.querySelector<HTMLDivElement>('[data-dev-views]');
  const offerSection = target.querySelector<HTMLElement>('[data-offer-section]');
  const draftPicker = target.querySelector<HTMLDivElement>('[data-draft-picker]');
  const promotion = target.querySelector<HTMLDivElement>('[data-promotion]');
  const selectionSection = target.querySelector<HTMLElement>('[data-selection-section]');
  const starts = target.querySelector<HTMLDivElement>('[data-starts]');
  const selectionList = target.querySelector<HTMLDivElement>('[data-selections]');
  if (
    !roomMeta ||
    !gameInfo ||
    !board ||
    !boardPaused ||
    !boardStatus ||
    !devViewsSection ||
    !devViewsPanel ||
    !offerSection ||
    !draftPicker ||
    !promotion ||
    !selectionSection ||
    !starts ||
    !selectionList
  ) {
    throw new Error('missing app region');
  }

  return {
    board,
    boardPaused,
    boardStatus,
    clockBottom,
    clockNote,
    clockTop,
    draftPicker,
    actionSection,
    actionStatus,
    capturesBottom,
    capturesTop,
    devViews: devViewsPanel,
    devViewsSection,
    gameInfo,
    hiddenPool,
    moveList,
    offerSection,
    playerBottom,
    playerTop,
    promotion,
    replayControls,
    replayMeta,
    roomActions,
    selectionSection,
    roomMeta,
    selectionList,
    starts,
    gameControls,
    gameControlsSection,
  };
}
