import './game-shell.css';
import { t } from './i18n/catalog.js';
import { createMoveNavBar, syncMoveNavMenu } from './move-nav-bar.js';
import { REPLAY_ICON_ANALYSIS, REPLAY_ICON_FLIP } from './replay-icons.js';

export type GameTableRefs = {
  actionSection: HTMLElement;
  actionStatus: HTMLDivElement;
  capturesBottom: HTMLDivElement;
  capturesTop: HTMLDivElement;
  clockBottom: HTMLDivElement;
  clockNote: HTMLParagraphElement;
  clockTop: HTMLDivElement;
  gameControls: HTMLDivElement;
  gameControlsSection: HTMLElement;
  /** The flip variants' "still face-down" pool (hidden-pool-panel.ts); empty elsewhere. */
  hiddenPool: HTMLDivElement;
  moveList: HTMLOListElement;
  movesRoot: HTMLDivElement;
  playerBottom: HTMLDivElement;
  playerTop: HTMLDivElement;
  replayControls: NodeListOf<HTMLButtonElement>;
  replayControlsRoot: HTMLDivElement;
  replayMeta: HTMLParagraphElement;
  roomActions: HTMLDivElement;
};

export type GameTable = {
  el: HTMLElement;
  refs: GameTableRefs;
};

/**
 * The element that scrolls a move list: the room table's wrapper (it also holds
 * the result block that follows the list), else the list itself (replay and
 * review panels, where the list scrolls on its own).
 */
export function moveListScroller(list: HTMLElement): HTMLElement {
  const wrapper = list.parentElement;
  return wrapper?.classList.contains('game-table-moves') ? wrapper : list;
}

/**
 * Points the bar menu's Analyse row at the review page, or hides it (null) while
 * the game is still being played. `anchor` is any element inside the console.
 */
export function setReplayAnalysisHref(anchor: HTMLElement, href: string | null): void {
  const link = anchor
    .closest('.game-console')
    ?.querySelector<HTMLAnchorElement>('[data-replay-analysis]');
  if (!link) return;
  const hidden = href === null;
  if (href !== null && link.getAttribute('href') !== href) link.href = href;
  if (link.hidden === hidden) return;
  link.hidden = hidden;
  syncMoveNavMenu(link);
}

/**
 * Shows the bar menu's Flip row and runs `onFlip` on press, or hides it (null)
 * for a room whose board cannot flip. `anchor` is any element in the console.
 */
export function setReplayFlipHandler(anchor: HTMLElement, onFlip: (() => void) | null): void {
  const button = anchor
    .closest('.game-console')
    ?.querySelector<HTMLButtonElement>('[data-replay-flip]');
  if (!button) return;
  button.hidden = onFlip === null;
  button.onclick = onFlip;
  syncMoveNavMenu(button);
}

/** The flip shortcut: a bare `f` outside text inputs, as on the review pages. */
export function isFlipShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== 'f' && event.key !== 'F') return false;
  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return false;
  }
  return true;
}

/**
 * The shared right-column game table used by live rooms and Mistboard TV.
 * Behavior stays route-owned, while the player rows, replay controls, move
 * region, actions, clocks, and captures keep one DOM contract and one CSS skin.
 */
export function createGameTable(opts: { navMenu?: boolean } = {}): GameTable {
  const el = document.createElement('section');
  el.className = 'panel-section game-console';
  el.innerHTML = `
    <div data-captures-top class="captures-strip captures-strip-top rail-material" aria-label="Pieces captured by the top side"></div>
    <div data-clock-top class="clocks clock-slot"></div>
    <div class="round-table__box">
      <div data-player-top class="round-table__player round-table__player--top"></div>
      <div class="replay-console">
        <div data-replay-controls></div>
        <div data-game-table-moves class="game-table-moves">
          <ol data-move-list class="move-list"></ol>
          <div data-game-result class="game-result" hidden></div>
        </div>
        <p data-replay-meta class="replay-meta" hidden>Live</p>
      </div>
      <div data-action-section class="round-table__row" hidden>
        <div data-action-status class="action-status"></div>
      </div>
      <div class="round-table__row">
        <div data-room-actions class="room-actions"></div>
      </div>
      <div data-game-controls-section class="round-table__row" hidden>
        <div data-game-controls class="game-controls"></div>
      </div>
      <div data-player-bottom class="round-table__player round-table__player--bottom"></div>
    </div>
    <div data-clock-bottom class="clocks clock-slot"></div>
    <div data-captures class="captures-strip captures-strip-bottom rail-material" aria-label="Pieces captured by the bottom side"></div>
    <div data-hidden-pool class="hidden-pool" aria-label="Pieces still face-down"></div>
    <p data-clocks-note class="clocks-pregame-note" hidden></p>
  `;

  // The shared move-nav bar (#523): first / prev / next / last / ☰, the last
  // glowing while scrubbed back from the live position. The ☰ holds Flip (shown
  // once a room that can flip its board wires it, setReplayFlipHandler) and
  // Analyse (shown once the game is finished, setReplayAnalysisHref: no analysis
  // while a game is being played). TV has neither, so it drops the ☰.
  const bar = createMoveNavBar({
    liveGlow: true,
    menuPlacement: 'down',
    menu: opts.navMenu !== false,
    menuItems: [
      {
        label: t('review.flipBoard'),
        icon: REPLAY_ICON_FLIP,
        dataset: { replayFlip: '' },
        hidden: true,
      },
      {
        label: t('live.reviewThisMove'),
        icon: REPLAY_ICON_ANALYSIS,
        href: '',
        dataset: { replayAnalysis: '' },
        hidden: true,
      },
    ],
  });
  bar.el.dataset.replayControls = '';
  el.querySelector('[data-replay-controls]')?.replaceWith(bar.el);

  const refs = {
    actionSection: el.querySelector<HTMLElement>('[data-action-section]'),
    actionStatus: el.querySelector<HTMLDivElement>('[data-action-status]'),
    capturesBottom: el.querySelector<HTMLDivElement>('[data-captures]'),
    capturesTop: el.querySelector<HTMLDivElement>('[data-captures-top]'),
    clockBottom: el.querySelector<HTMLDivElement>('[data-clock-bottom]'),
    clockNote: el.querySelector<HTMLParagraphElement>('[data-clocks-note]'),
    clockTop: el.querySelector<HTMLDivElement>('[data-clock-top]'),
    gameControls: el.querySelector<HTMLDivElement>('[data-game-controls]'),
    gameControlsSection: el.querySelector<HTMLElement>('[data-game-controls-section]'),
    hiddenPool: el.querySelector<HTMLDivElement>('[data-hidden-pool]'),
    moveList: el.querySelector<HTMLOListElement>('[data-move-list]'),
    movesRoot: el.querySelector<HTMLDivElement>('[data-game-table-moves]'),
    playerBottom: el.querySelector<HTMLDivElement>('[data-player-bottom]'),
    playerTop: el.querySelector<HTMLDivElement>('[data-player-top]'),
    replayControls: el.querySelectorAll<HTMLButtonElement>('[data-replay]'),
    replayControlsRoot: el.querySelector<HTMLDivElement>('[data-replay-controls]'),
    replayMeta: el.querySelector<HTMLParagraphElement>('[data-replay-meta]'),
    roomActions: el.querySelector<HTMLDivElement>('[data-room-actions]'),
  };

  for (const [name, node] of Object.entries(refs)) {
    if (!node || ('length' in node && node.length === 0)) {
      throw new Error(`missing game table region: ${name}`);
    }
  }

  return { el, refs: refs as GameTableRefs };
}
