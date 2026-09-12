// Mistboard TV renderer for Reveal Chess (chess-jieqi).
//
// Reveal Chess is identity-hidden (a per-color triptych like Jieqi) but on an
// 8x8 CHESS board with white/black colors, so it cannot use the red/black tenant
// watch generic (watch-tenant-replay.ts). It is a chess-colored, postgame-API
// driven SVG watch and adds the per-color triptych
// + face-down-aware captured pools. There is NO fog: the truth pane reveals every
// identity; the per-color panes render the opponent's face-down pieces as discs
// (the renderer keys off the view entry's faceDown flag, not a render option).
import type { RevealChessColor, RevealChessPlayerView } from '@mistboard/game';
import { fillCapturedPool } from './live-reveal-chess.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { createPane, type ReplayPaneHandle } from './replay-board.js';
import { createGameHeaderStrip } from './replay-meta.js';
import {
  loadRevealChessPostgame,
  postgameReplayMaxPly,
  postgameViewAtPly,
  postgameViewEntries,
  type RevealChessPostgameResponse,
  type RevealChessPostgameViewKey,
} from './reveal-chess-postgame.js';
import { renderRevealChessBoardSvg } from './reveal-chess-render.js';
import { boardAppearanceChangedEvent } from './theme.js';

const AUTO_PLAY_PLY_MS = 1100;
const AUTO_PLAY_LOOP_HOLD_MS = 2600;

export type RevealChessWatchReplayOptions = {
  autoplay?: boolean;
  metadataByRoomId?: Record<string, GameMeta>;
};

type ControlRefs = {
  first: HTMLButtonElement;
  prev: HTMLButtonElement;
  play: HTMLButtonElement;
  next: HTMLButtonElement;
  last: HTMLButtonElement;
  plyLabel: HTMLElement;
};

function resultChipKind(result: string): 'white' | 'black' | 'draw' {
  if (result === 'white-wins') return 'white';
  if (result === 'black-wins') return 'black';
  return 'draw';
}

function resultLabel(result: string): string {
  if (result === 'white-wins') return 'White wins';
  if (result === 'black-wins') return 'Black wins';
  return 'Draw';
}

function labelize(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function timeControlLabel(postgame: RevealChessPostgameResponse): string {
  const initialMs = postgame.game.initialMs ?? postgame.state.timeControl?.initialMs ?? null;
  const incrementMs = postgame.game.incrementMs ?? postgame.state.timeControl?.incrementMs ?? null;
  if (initialMs === null && incrementMs === null) return 'Untimed';
  return `${Math.round((initialMs ?? 0) / 60000)}+${Math.round((incrementMs ?? 0) / 1000)}`;
}

function matchupLabel(mode: string): string {
  if (mode === 'pve') return 'Human vs engine';
  if (mode === 'eve') return 'Engine vs engine';
  return 'Human vs human';
}

function paneKind(key: RevealChessPostgameViewKey): 'white' | 'truth' | 'black' {
  if (key === 'white') return 'white';
  if (key === 'black') return 'black';
  return 'truth';
}

function controlButton(symbol: string, aria: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay-button';
  button.textContent = symbol;
  button.setAttribute('aria-label', aria);
  return button;
}

export async function mountRevealChessWatchReplay(
  root: HTMLElement,
  roomId: string,
  options: RevealChessWatchReplayOptions,
): Promise<ReplayHandle> {
  const autoplay = options.autoplay ?? true;

  let activeId = roomId;
  let destroyed = false;
  let timer: number | null = null;
  let paused = !autoplay;

  let boardTargets: Array<{ pane: ReplayPaneHandle; key: RevealChessPostgameViewKey }> = [];
  let controls: ControlRefs | null = null;
  let maxPly = 0;
  let currentPly = 0;
  let boardOrientation: RevealChessColor = 'white';
  let activePostgame: RevealChessPostgameResponse | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const renderPaneCaptures = (
    pane: ReplayPaneHandle,
    view: RevealChessPlayerView,
    bottomColor: RevealChessColor,
  ): void => {
    const topColor: RevealChessColor = bottomColor === 'white' ? 'black' : 'white';
    fillCapturedPool(pane.topCapturesEl, view.captured, topColor);
    fillCapturedPool(pane.capturesEl, view.captured, bottomColor);
  };

  const sync = (): void => {
    if (!activePostgame || !controls) return;
    for (const target of boardTargets) {
      const view = postgameViewAtPly(activePostgame, target.key, currentPly);
      if (view) {
        target.pane.boardEl.innerHTML = renderRevealChessBoardSvg(view, {
          perspective: boardOrientation,
        });
        renderPaneCaptures(target.pane, view, boardOrientation);
      }
    }
    const result = currentPly >= maxPly ? ` - ${resultLabel(activePostgame.game.result)}` : '';
    controls.plyLabel.textContent = `Ply ${currentPly} / ${maxPly}${result}`;
    controls.first.disabled = currentPly <= 0;
    controls.prev.disabled = currentPly <= 0;
    controls.next.disabled = currentPly >= maxPly;
    controls.last.disabled = currentPly >= maxPly;
  };

  const scheduleAuto = (): void => {
    if (paused || destroyed || maxPly <= 0) return;
    clearTimer();
    const atEnd = currentPly >= maxPly;
    timer = window.setTimeout(
      () => {
        if (destroyed) return;
        currentPly = atEnd ? 0 : currentPly + 1;
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

  const buildGame = (postgame: RevealChessPostgameResponse): void => {
    activePostgame = postgame;
    maxPly = postgameReplayMaxPly(postgame);
    currentPly = 0;
    paused = !autoplay;
    boardOrientation = 'white';

    const header = createGameHeaderStrip();
    header.title.textContent = matchupLabel(postgame.game.mode);
    const chip = document.createElement('span');
    chip.className = `replay-game-header-result-chip replay-game-header-result-${resultChipKind(postgame.game.result)}`;
    chip.textContent = resultLabel(postgame.game.result);
    const detail = document.createElement('span');
    detail.className = 'replay-game-header-result-detail';
    detail.textContent = `by ${labelize(postgame.game.termination)}`;
    header.result.append(chip, detail);
    const plies = document.createElement('span');
    plies.textContent = `${postgame.game.plyCount} plies`;
    const sep = document.createElement('span');
    sep.className = 'replay-game-header-sep';
    sep.textContent = '·';
    const clock = document.createElement('span');
    clock.textContent = timeControlLabel(postgame);
    const sepRated = document.createElement('span');
    sepRated.className = 'replay-game-header-sep';
    sepRated.textContent = '·';
    const rated = document.createElement('span');
    rated.textContent = postgame.game.rated ? 'Rated' : 'Casual';
    header.meta.append(plies, sep, clock, sepRated, rated);

    const layout = document.createElement('div');
    layout.className = 'replay-layout replay-layout-all watch-reveal-chess-layout';
    boardTargets = [];
    for (const entry of postgameViewEntries(postgame)) {
      const kind = paneKind(entry.key);
      const label = kind === 'truth' ? 'Truth' : entry.label;
      const pane = createPane(label, kind, true, 'split');
      pane.boardEl.classList.add('reveal-chess-live-board');
      boardTargets.push({ pane, key: entry.key });
      layout.append(pane.el);
    }

    const bar = document.createElement('div');
    bar.className = 'replay-control-bar';
    const first = controlButton('|<', 'First move');
    const prev = controlButton('<', 'Previous move');
    const play = controlButton(paused ? '▶ Play' : '⏸ Pause', 'Play / pause');
    const next = controlButton('>', 'Next move');
    const last = controlButton('>|', 'Last move');
    const flip = controlButton('↕ Flip', 'Flip boards');
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
      boardOrientation = boardOrientation === 'white' ? 'black' : 'white';
      sync();
    };

    root.replaceChildren(header.el, layout, bar, plyLine);

    sync();
    scheduleAuto();
  };

  const load = async (nextId: string): Promise<void> => {
    clearTimer();
    activeId = nextId;
    const result = await loadRevealChessPostgame(nextId);
    if (destroyed) return;
    if (!result.ok) {
      const notice = document.createElement('p');
      notice.className = 'watch-empty';
      notice.textContent = 'This game could not be loaded.';
      root.replaceChildren(notice);
      return;
    }
    buildGame(result.postgame);
  };

  const syncAppearance = (): void => sync();
  window.addEventListener(boardAppearanceChangedEvent, syncAppearance);

  await load(roomId);

  return {
    activeSampleId: () => activeId,
    destroy: () => {
      destroyed = true;
      clearTimer();
      window.removeEventListener(boardAppearanceChangedEvent, syncAppearance);
      root.replaceChildren();
    },
    loadGame: async (sampleId: string) => {
      await load(sampleId);
    },
    updateLoopPool: () => {},
  };
}
