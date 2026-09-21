import { terminationLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { createPane, type ReplayPaneHandle } from './replay-board.js';
import { createGameHeaderStrip } from './replay-meta.js';
import { pickCompactViewKey } from './showcase-compact-view.js';
import { formatClock } from './web-utils.js';

const AUTO_PLAY_PLY_MS = 1100;
const AUTO_PLAY_LOOP_HOLD_MS = 2600;

export type FogTriptychPostgameMeta = {
  game: {
    mode: string;
    result: string;
    termination: string;
    plyCount: number;
    rated: boolean;
    initialMs: number | null;
    incrementMs: number | null;
  };
  state: { timeControl?: { initialMs: number; incrementMs: number } | null };
};

export type FogTriptychWatchOptions = {
  autoplay?: boolean;
  metadataByRoomId?: Record<string, GameMeta>;
  /** Fires after a distinct autoplay or manual ply change. */
  onPlyChange?: (ply: number, maxPly: number) => void;
  /**
   * Homepage showcase mode: render a SINGLE fogged board (no header/control-bar/
   * ply-line) instead of the first|truth|second triptych. These are all fog
   * variants, so compact shows one random side's own POV — never the truth board.
   * Pairs with onGameEnd for cross-variant cycling.
   */
  compact?: boolean;
  /**
   * Called once when the game reaches its final ply under autoplay (after the
   * loop hold), instead of restarting the same game. Lets an outer showcase
   * controller advance to the next pooled game (possibly a different variant).
   */
  onGameEnd?: () => void;
};

type ResultChipKind = 'white' | 'black' | 'red' | 'draw';

export type FogTriptychWatchAdapter<
  Postgame extends FogTriptychPostgameMeta,
  View,
  ViewKey extends string,
  Color extends string,
> = {
  firstColor: Color;
  firstLabel: string;
  secondColor: Color;
  secondLabel: string;
  boardClass?: string;
  layoutClass?: string;
  installStyles(): void;
  loadPostgame(roomId: string): Promise<{ ok: true; postgame: Postgame } | { ok: false }>;
  maxPly(postgame: Postgame): number;
  viewEntries(postgame: Postgame): ReadonlyArray<{ key: ViewKey; label: string; view: View }>;
  viewAtPly(postgame: Postgame, key: ViewKey, ply: number): View | null;
  paneKind(key: ViewKey): 'white' | 'truth' | 'black';
  renderBoard(view: View, orientation: Color, key: ViewKey): string;
  renderCaptures?(args: {
    pane: ReplayPaneHandle;
    view: View;
    bottomColor: Color;
    topColor: Color;
    key: ViewKey;
    ply: number;
    postgame: Postgame;
  }): void;
  resultChipKind(result: string): ResultChipKind;
  resultLabel(result: string): string;
};

type ControlRefs = {
  first: HTMLButtonElement;
  prev: HTMLButtonElement;
  play: HTMLButtonElement;
  next: HTMLButtonElement;
  last: HTMLButtonElement;
  plyLabel: HTMLElement;
};

type SeatCell = { row: HTMLElement; clock: HTMLElement };

function timeControlLabel(postgame: FogTriptychPostgameMeta): string {
  const initialMs = postgame.game.initialMs ?? postgame.state.timeControl?.initialMs ?? null;
  const incrementMs = postgame.game.incrementMs ?? postgame.state.timeControl?.incrementMs ?? null;
  if (initialMs === null && incrementMs === null) return t('watch.untimed');
  return `${Math.round((initialMs ?? 0) / 60000)}+${Math.round((incrementMs ?? 0) / 1000)}`;
}

function matchupLabel(mode: string): string {
  if (mode === 'pve') return t('watch.humanVsEngine');
  if (mode === 'eve') return t('watch.engineVsEngine');
  return t('watch.humanVsHuman');
}

function seatCell(name: string): SeatCell {
  const row = document.createElement('div');
  row.className = 'replay-clock-row';
  const label = document.createElement('span');
  label.className = 'replay-clock-side';
  label.textContent = name;
  const clock = document.createElement('span');
  clock.className = 'replay-clock-time';
  row.append(label, clock);
  return { row, clock };
}

function controlButton(symbol: string, aria: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay-button';
  button.textContent = symbol;
  button.setAttribute('aria-label', aria);
  return button;
}

export async function mountFogTriptychWatchReplay<
  Postgame extends FogTriptychPostgameMeta,
  View,
  ViewKey extends string,
  Color extends string,
>(
  root: HTMLElement,
  roomId: string,
  options: FogTriptychWatchOptions,
  adapter: FogTriptychWatchAdapter<Postgame, View, ViewKey, Color>,
): Promise<ReplayHandle> {
  adapter.installStyles();
  const autoplay = options.autoplay ?? true;
  const compact = options.compact === true;
  const onGameEnd = options.onGameEnd;
  const onPlyChange = options.onPlyChange;

  let activeId = roomId;
  let destroyed = false;
  let timer: number | null = null;
  let paused = !autoplay;
  // Guards a single onGameEnd fire per game so the loop hold can't re-enter it.
  let endFired = false;

  let boardTargets: Array<{
    pane: ReplayPaneHandle;
    key: ViewKey;
    fallbackView: View;
  }> = [];
  let controls: ControlRefs | null = null;
  let seatCells: { first: SeatCell; second: SeatCell } | null = null;
  let initialClock: number | null = null;
  let maxPly = 0;
  let currentPly = 0;
  let lastNotifiedPly: number | null = null;
  let boardOrientation: Color = adapter.firstColor;
  let activePostgame: Postgame | null = null;

  const otherColor = (color: Color): Color =>
    color === adapter.firstColor ? adapter.secondColor : adapter.firstColor;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const renderPaneCaptures = (
    pane: ReplayPaneHandle,
    view: View,
    key: ViewKey,
    postgame: Postgame,
  ): void => {
    pane.topCapturesEl.replaceChildren();
    pane.capturesEl.replaceChildren();
    adapter.renderCaptures?.({
      pane,
      view,
      bottomColor: boardOrientation,
      topColor: otherColor(boardOrientation),
      key,
      ply: currentPly,
      postgame,
    });
  };

  const sync = (): void => {
    if (!activePostgame) return;
    for (const target of boardTargets) {
      const view = adapter.viewAtPly(activePostgame, target.key, currentPly) ?? target.fallbackView;
      target.pane.boardEl.innerHTML = adapter.renderBoard(view, boardOrientation, target.key);
      renderPaneCaptures(target.pane, view, target.key, activePostgame);
    }
    if (controls) {
      const result =
        currentPly >= maxPly ? ` - ${adapter.resultLabel(activePostgame.game.result)}` : '';
      controls.plyLabel.textContent = `Ply ${currentPly} / ${maxPly}${result}`;
      controls.first.disabled = currentPly <= 0;
      controls.prev.disabled = currentPly <= 0;
      controls.next.disabled = currentPly >= maxPly;
      controls.last.disabled = currentPly >= maxPly;
    }

    const toMove: Color | null =
      currentPly >= maxPly ? null : currentPly % 2 === 0 ? adapter.firstColor : adapter.secondColor;
    if (seatCells) {
      if (initialClock !== null) {
        seatCells.first.clock.textContent = formatClock(initialClock);
        seatCells.second.clock.textContent = formatClock(initialClock);
      }
      seatCells.first.row.classList.toggle('active', toMove === adapter.firstColor);
      seatCells.second.row.classList.toggle('active', toMove === adapter.secondColor);
    }
    if (onPlyChange && lastNotifiedPly !== currentPly) {
      lastNotifiedPly = currentPly;
      onPlyChange(currentPly, maxPly);
    }
  };

  const scheduleAuto = (): void => {
    if (paused || destroyed || maxPly <= 0) return;
    clearTimer();
    const atEnd = currentPly >= maxPly;
    timer = window.setTimeout(
      () => {
        if (destroyed) return;
        if (atEnd) {
          // Showcase mode hands off to the outer controller instead of replaying
          // the same game. Watch (no onGameEnd) loops the single game as before.
          if (onGameEnd) {
            if (!endFired) {
              endFired = true;
              onGameEnd();
            }
            return;
          }
          currentPly = 0;
        } else {
          currentPly += 1;
        }
        sync();
        scheduleAuto();
      },
      atEnd ? AUTO_PLAY_LOOP_HOLD_MS : AUTO_PLAY_PLY_MS,
    );
  };

  const setPaused = (next: boolean): void => {
    paused = next;
    if (controls) controls.play.textContent = paused ? '▶ Play' : '⏸ Pause';
    if (paused) clearTimer();
    else scheduleAuto();
  };

  const manualJump = (ply: number): void => {
    setPaused(true);
    currentPly = Math.max(0, Math.min(maxPly, ply));
    sync();
  };

  // The single fogged board to show in compact showcase mode: one random side's
  // own POV, stable per room, oriented to that side. Never the truth board.
  const pickCompactTarget = (game: Postgame): { key: ViewKey; view: View; orientation: Color } => {
    const entries = adapter.viewEntries(game);
    const choice = pickCompactViewKey({ roomId: activeId, entries, paneKind: adapter.paneKind });
    const entry = entries.find((candidate) => candidate.key === choice.key) ?? entries[0]!;
    const orientation = choice.side === 'second' ? adapter.secondColor : adapter.firstColor;
    return { key: entry.key, view: entry.view, orientation };
  };

  const buildGame = (postgame: Postgame): void => {
    activePostgame = postgame;
    maxPly = adapter.maxPly(postgame);
    currentPly = 0;
    lastNotifiedPly = null;
    paused = !autoplay;
    boardOrientation = adapter.firstColor;
    initialClock = postgame.game.initialMs ?? postgame.state.timeControl?.initialMs ?? null;
    endFired = false;

    // Compact showcase: a single fogged board, no header/control-bar/ply-line.
    if (compact) {
      const target = pickCompactTarget(postgame);
      boardOrientation = target.orientation;
      const pane = createPane('', adapter.paneKind(target.key), true, 'split');
      if (adapter.boardClass) pane.boardEl.classList.add(adapter.boardClass);
      boardTargets = [{ pane, key: target.key, fallbackView: target.view }];
      controls = null;
      seatCells = null;
      const layout = document.createElement('div');
      layout.className = `replay-layout replay-layout-solo${adapter.layoutClass ? ` ${adapter.layoutClass}` : ''}`;
      layout.append(pane.el);
      root.replaceChildren(layout);
      sync();
      scheduleAuto();
      return;
    }

    const header = createGameHeaderStrip();
    header.title.textContent = matchupLabel(postgame.game.mode);
    const chip = document.createElement('span');
    chip.className = `replay-game-header-result-chip replay-game-header-result-${adapter.resultChipKind(postgame.game.result)}`;
    chip.textContent = adapter.resultLabel(postgame.game.result);
    const detail = document.createElement('span');
    detail.className = 'replay-game-header-result-detail';
    detail.textContent = t('watch.byReason', {
      reason: terminationLabel(postgame.game.termination),
    });
    header.result.append(chip, detail);
    const plies = document.createElement('span');
    plies.textContent = t('watch.plyCount', { count: postgame.game.plyCount });
    const sep = document.createElement('span');
    sep.className = 'replay-game-header-sep';
    sep.textContent = '·';
    const clock = document.createElement('span');
    clock.textContent = timeControlLabel(postgame);
    const sepRated = document.createElement('span');
    sepRated.className = 'replay-game-header-sep';
    sepRated.textContent = '·';
    const rated = document.createElement('span');
    rated.textContent = postgame.game.rated ? t('watch.rated') : t('watch.casual');
    header.meta.append(plies, sep, clock, sepRated, rated);

    const firstCell = seatCell(adapter.firstLabel);
    const secondCell = seatCell(adapter.secondLabel);
    header.whiteCell.append(firstCell.row);
    header.blackCell.append(secondCell.row);
    seatCells = { first: firstCell, second: secondCell };

    const layout = document.createElement('div');
    layout.className = `replay-layout replay-layout-all${adapter.layoutClass ? ` ${adapter.layoutClass}` : ''}`;
    boardTargets = [];
    for (const entry of adapter.viewEntries(postgame)) {
      const label = adapter.paneKind(entry.key) === 'truth' ? t('watch.truth') : entry.label;
      const pane = createPane(label, adapter.paneKind(entry.key), true, 'split');
      if (adapter.boardClass) pane.boardEl.classList.add(adapter.boardClass);
      boardTargets.push({ pane, key: entry.key, fallbackView: entry.view });
      layout.append(pane.el);
    }

    const bar = document.createElement('div');
    bar.className = 'replay-control-bar';
    const first = controlButton('|<', t('watch.firstMove'));
    const prev = controlButton('<', t('watch.previousMove'));
    const play = controlButton(
      paused ? t('replay.playButton') : t('replay.pauseButton'),
      t('watch.playPause'),
    );
    const next = controlButton('>', t('watch.nextMove'));
    const last = controlButton('>|', t('watch.lastMove'));
    const flip = controlButton(`↕ ${t('replay.flip')}`, t('watch.flipBoards'));
    bar.append(first, prev, play, next, last, flip);
    const plyLine = document.createElement('div');
    plyLine.className = 'replay-ply-line';
    const plyLabel = document.createElement('span');
    plyLine.append(plyLabel);

    controls = { first, prev, play, next, last, plyLabel };
    first.onclick = () => manualJump(0);
    prev.onclick = () => manualJump(currentPly - 1);
    next.onclick = () => manualJump(currentPly + 1);
    last.onclick = () => manualJump(maxPly);
    play.onclick = () => setPaused(!paused);
    flip.onclick = () => {
      boardOrientation = otherColor(boardOrientation);
      sync();
    };

    root.replaceChildren(header.el, layout, bar, plyLine);

    sync();
    scheduleAuto();
  };

  const load = async (nextId: string): Promise<void> => {
    clearTimer();
    activeId = nextId;
    const result = await adapter.loadPostgame(nextId);
    if (destroyed) return;
    if (!result.ok) {
      const notice = document.createElement('p');
      notice.className = 'watch-empty';
      notice.textContent = t('watch.gameLoadFailed');
      root.replaceChildren(notice);
      return;
    }
    buildGame(result.postgame);
  };

  await load(roomId);

  return {
    activeSampleId: () => activeId,
    destroy: () => {
      destroyed = true;
      clearTimer();
      root.replaceChildren();
    },
    loadGame: async (sampleId: string) => {
      await load(sampleId);
    },
    jumpToPly: (ply: number) => manualJump(ply),
    plyCount: () => maxPly,
    updateLoopPool: () => {},
  };
}
