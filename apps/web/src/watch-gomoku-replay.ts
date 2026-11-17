// Gomoku keeps colour ownership fixed: first = Black, second = White, even
// when a dealt opening leaves White next. Read turns and clocks from the server
// frames; the red/black tenant replay's parity and clock reconstruction do not
// describe this contract. Capability registration belongs to the integration.
import type { GomokuColor, GomokuMove, GomokuPlayerView } from '@mistboard/game';
import { terminationLabel } from './game-display.js';
import { GOMOKU_MOVE_NUMBER_MIN_PX, gomokuBoardSvg, numberGomokuStones } from './gomoku-board.js';
import './gomoku-board.css';
import { t } from './i18n/catalog.js';
import { currentLocale } from './i18n/locale.js';
import { anchorForPly, offsetsFromTimestamps, positionAt } from './recorded-playback.js';
import type { ReplayClockReadout, ReplayHandle } from './replay.js';
import { createPane } from './replay-board.js';
import { createGameHeaderStrip } from './replay-meta.js';
import { seatDiscEl } from './seat-disc.js';
import {
  clockRemainingMs,
  readTenantWebClock,
  type TenantWebClock,
} from './variant-tenant/clock-projection.js';
import type { TenantWatchReplayOptions, WatchPostgameMeta } from './watch-tenant-replay.js';
import { formatClock } from './web-utils.js';

type Frame = {
  ply: number;
  at: number;
  view: GomokuPlayerView;
  clock?: TenantWebClock<GomokuColor>;
};

/** Both /api/gomoku/games/:id and the live watch builder use this contract. */
export type GomokuWatchPayload = Omit<WatchPostgameMeta, 'game' | 'timeline'> & {
  game: WatchPostgameMeta['game'] & {
    roomId: string;
    variant: 'gomoku';
    players?: Array<{ color: string; name: string }>;
  };
  history: { truth: Frame[] };
  timeline: Array<{
    type: string;
    at: number;
    color?: GomokuColor;
    move?: GomokuMove;
    ply?: number;
  }>;
};

export type GomokuWatchReplayOptions = TenantWatchReplayOptions;
type Seat = 'first' | 'second';
const COLORS = ['black', 'white'] as const;

/** The stones placed in frames 1..ply, in order; dealt opening stones are not placements. */
export function placementsThrough(frames: readonly Frame[], ply: number): GomokuMove[] {
  const placed: GomokuMove[] = [];
  for (const frame of frames.slice(1, ply + 1))
    if (frame.view.lastMove) placed.push(frame.view.lastMove);
  return placed;
}
const sideFor = (color: GomokuColor): Seat => (color === 'black' ? 'first' : 'second');

function readPayload(value: unknown): GomokuWatchPayload | null {
  const payload = value as GomokuWatchPayload | null;
  if (
    payload?.game?.variant !== 'gomoku' ||
    !payload.state ||
    !Array.isArray(payload.timeline) ||
    !Array.isArray(payload.history?.truth) ||
    payload.history.truth.length === 0
  )
    return null;
  // Event-counted plies start at zero, independently of the dealt stone count.
  if (
    !payload.history.truth.every(
      (frame, index) =>
        frame?.ply === index &&
        Number.isFinite(frame.at) &&
        Array.isArray(frame.view?.board) &&
        frame.view.board.length === 225 &&
        Array.isArray(frame.view.winningLine) &&
        !!frame.view.status,
    )
  )
    return null;
  return payload;
}

export async function mountGomokuWatchReplay(
  root: HTMLElement,
  initialRoomId: string,
  options: GomokuWatchReplayOptions = {},
): Promise<ReplayHandle> {
  const locale = options.locale ?? currentLocale();
  const compact = options.compact === true;
  let roomId = initialRoomId;
  let payload: GomokuWatchPayload | null = null;
  let ply = 0;
  let orientation: GomokuColor = options.pov === 'white' ? 'white' : 'black';
  let paused = true;
  let destroyed = false;
  let loadSeq = 0;
  let interval: number | null = null;
  let endTimer: number | null = null;
  let anchor: number | null = null;
  let offsets: number[] = [0];
  let airStart = options.airStartMs;
  let lastNotified = '';
  let endFired = false;
  let controls: {
    first: HTMLButtonElement;
    prev: HTMLButtonElement;
    play: HTMLButtonElement;
    next: HTMLButtonElement;
    last: HTMLButtonElement;
  } | null = null;

  const pane = createPane(compact ? '' : t('watch.truth', {}, locale), 'truth', false);
  pane.boardEl.classList.add('gomoku-live-board');
  pane.boardEl.setAttribute('aria-label', t('live.gomokuBoard', {}, locale));
  const layout = document.createElement('div');
  layout.className = 'replay-layout replay-layout-solo gomoku-watch-layout';
  const progress = document.createElement('div');
  progress.className = 'replay-ply-line';
  const rows = COLORS.map((color) => {
    const row = document.createElement('div');
    row.className = compact ? 'showcase-seat' : 'replay-clock-row';
    row.dataset.seat = sideFor(color);
    const name = document.createElement('span');
    name.className = compact ? 'showcase-seat-name' : 'replay-clock-side';
    const clock = document.createElement('span');
    clock.className = compact ? 'showcase-seat-clock' : 'replay-clock-time';
    if (options.seatDiscs) row.append(seatDiscEl(color));
    row.append(name, clock);
    return { color, row, name, clock };
  });

  const maxPly = (): number => (payload?.history.truth.length ?? 1) - 1;
  const frame = (): Frame | null => payload?.history.truth[ply] ?? null;
  const ended = (): boolean => !!payload && payload.game.result !== 'in-progress';
  const atEnd = (): boolean => ended() && ply === maxPly();
  const toMove = (): Seat | null => {
    const status = frame()?.view.status;
    return !atEnd() && status?.type === 'playing' ? sideFor(status.turn) : null;
  };
  const resultLabel = (): string => {
    switch (payload?.game.result) {
      case 'black-wins':
        return t('watch.blackWins', {}, locale);
      case 'white-wins':
        return t('watch.whiteWins', {}, locale);
      case 'in-progress':
        return t('watch.inProgress', {}, locale);
      default:
        return t('result.draw', {}, locale);
    }
  };

  const clockAtPly = (): ReplayClockReadout | null => {
    const current = frame();
    if (!payload || !current) return null;
    const live = options.live && !ended() && ply === maxPly();
    const clock = readTenantWebClock(live ? payload.state.clock : current.clock, COLORS);
    if (!clock) return null;
    // Scrubbing reads the filed values. Live follow projects the server anchor;
    // recorded autoplay projects through this frame's think at one real second
    // per second. Pre-arm/paused clocks already have no running colour.
    let at: number | null = live ? Date.now() : null;
    if (!live && anchor !== null && ply < maxPly()) {
      const elapsed = Math.max(
        0,
        Math.min(Date.now() - anchor - offsets[ply]!, offsets[ply + 1]! - offsets[ply]!),
      );
      at = current.at + elapsed;
    }
    const left = (color: GomokuColor): number =>
      at === null || atEnd() ? clock.remainingMs[color] : clockRemainingMs(clock, color, at);
    return {
      first: left('black'),
      second: left('white'),
      toMove: toMove(),
      initialMs: payload.game.initialMs ?? payload.state.timeControl?.initialMs ?? null,
    };
  };

  const paintClocks = (): void => {
    const clocks = clockAtPly();
    for (const { color, row, clock } of rows) {
      const side = sideFor(color);
      const won = payload?.game.result === `${color}-wins`;
      const mark = payload?.game.result === 'draw' ? '½' : won ? '1' : '0';
      clock.textContent = compact && atEnd() ? mark : clocks ? formatClock(clocks[side]) : '';
      clock.classList.toggle('showcase-seat-result', compact && atEnd());
      row.classList.toggle('result-win', atEnd() && won);
      row.classList.toggle('active', toMove() === side);
    }
  };

  const render = (): void => {
    const current = frame();
    if (!payload || !current || destroyed) return;
    pane.boardEl.innerHTML = gomokuBoardSvg(current.view, false);
    // Numbered stones on a board big enough to read them (the homepage viewer,
    // /watch), plain stones on the small /games cards.
    if (pane.boardEl.clientWidth >= GOMOKU_MOVE_NUMBER_MIN_PX)
      numberGomokuStones(pane.boardEl, placementsThrough(payload.history.truth, ply));
    paintClocks();
    progress.textContent = atEnd()
      ? t(
          'watch.plyProgressResult',
          { current: ply, total: maxPly(), result: resultLabel() },
          locale,
        )
      : t('watch.plyProgress', { current: ply, total: maxPly() }, locale);
    if (controls) {
      controls.first.disabled = controls.prev.disabled = ply === 0;
      controls.next.disabled = controls.last.disabled = ply === maxPly();
      controls.play.textContent = paused
        ? `▶ ${t('watch.play', {}, locale)}`
        : `⏸ ${t('watch.pause', {}, locale)}`;
    }
    const notification = `${ply}/${maxPly()}`;
    if (notification !== lastNotified) {
      lastNotified = notification;
      options.onPlyChange?.(ply, maxPly());
    }
  };

  const arrange = (): void => {
    const bottom = rows.find((seat) => seat.color === orientation)!;
    const top = rows.find((seat) => seat.color !== orientation)!;
    if (compact) layout.replaceChildren(top.row, pane.el, bottom.row);
  };
  const stop = (): void => {
    if (interval !== null) window.clearInterval(interval);
    if (endTimer !== null) window.clearTimeout(endTimer);
    interval = endTimer = anchor = null;
  };
  const finishPlayback = (): void => {
    stop();
    if (endFired) return;
    endTimer = window.setTimeout(
      () => {
        endTimer = null;
        if (destroyed || paused) return;
        if (options.onGameEnd) {
          endFired = true;
          options.onGameEnd();
        } else {
          ply = 0;
          render();
          start();
        }
      },
      options.onGameEnd ? 4_000 : 2_600,
    );
  };
  const tick = (): void => {
    if (destroyed) return;
    if (anchor !== null) {
      const next = Math.min(positionAt(offsets, Date.now() - anchor).ply, maxPly());
      if (next !== ply) {
        ply = next;
        render();
      }
      if (ply === maxPly()) {
        finishPlayback();
        return;
      }
    }
    paintClocks();
  };
  const start = (): void => {
    stop();
    if (destroyed || !payload) return;
    if (!paused && !options.live) {
      if (atEnd() && airStart === undefined) {
        finishPlayback();
        return;
      }
      anchor =
        typeof airStart === 'number' && Number.isFinite(airStart)
          ? airStart
          : anchorForPly(offsets, ply, Date.now());
      airStart = undefined;
    }
    if (anchor !== null || (options.live && !ended() && ply === maxPly() && payload.state.clock)) {
      interval = window.setInterval(tick, 100);
      tick();
    }
  };
  function jumpToPly(next: number): void {
    if (destroyed || !Number.isFinite(next)) return;
    paused = true;
    stop();
    ply = Math.max(0, Math.min(Math.trunc(next), maxPly()));
    render();
    start();
  }
  const togglePlay = (): void => {
    paused = !paused;
    start();
    render();
  };
  const setPov = (pov: 'white' | 'truth' | 'black'): void => {
    orientation = pov === 'white' ? 'white' : 'black';
    arrange();
    render();
  };

  const build = (): void => {
    if (!payload) return;
    for (const { color, name } of rows) {
      const supplied = options.namesByRoomId?.[roomId];
      const meta = options.metadataByRoomId?.[roomId];
      name.textContent =
        (color === 'black' ? supplied?.first : supplied?.second) ??
        payload.game.players?.find((player) => player.color === color)?.name ??
        (color === 'black' ? meta?.blackName : meta?.whiteName) ??
        t(color === 'black' ? 'setup.black' : 'setup.white', {}, locale);
    }
    controls = null;
    if (compact) {
      arrange();
      root.replaceChildren(layout);
      return;
    }
    const header = createGameHeaderStrip();
    header.title.textContent = t(
      payload.game.mode === 'pve'
        ? 'watch.humanVsEngine'
        : payload.game.mode === 'eve'
          ? 'watch.engineVsEngine'
          : 'watch.humanVsHuman',
      {},
      locale,
    );
    const chip = document.createElement('span');
    const kind =
      payload.game.result === 'black-wins'
        ? 'black'
        : payload.game.result === 'white-wins'
          ? 'white'
          : 'draw';
    chip.className = `replay-game-header-result-chip replay-game-header-result-${kind}`;
    chip.textContent = resultLabel();
    header.result.append(chip);
    if (ended()) {
      const detail = document.createElement('span');
      detail.className = 'replay-game-header-result-detail';
      const reason = payload.game.termination;
      const label =
        reason === 'five'
          ? t('result.five', {}, locale)
          : reason === 'board-full'
            ? t('result.boardFull', {}, locale)
            : reason === 'agreement'
              ? t('result.agreement', {}, locale)
              : terminationLabel(reason, 'gomoku', locale);
      detail.textContent = t('watch.byReason', { reason: label }, locale);
      header.result.append(detail);
    }
    const initial = payload.game.initialMs ?? payload.state.timeControl?.initialMs;
    const increment = payload.game.incrementMs ?? payload.state.timeControl?.incrementMs ?? 0;
    header.meta.textContent = [
      t('watch.plyCount', { count: maxPly() }, locale),
      initial == null
        ? t('watch.untimed', {}, locale)
        : `${Math.round(initial / 60_000)}+${Math.round(increment / 1_000)}`,
      t('play.casual', {}, locale),
    ].join(' · ');
    header.whiteCell.append(rows[0]!.row);
    header.blackCell.append(rows[1]!.row);
    layout.replaceChildren(pane.el);
    const bar = document.createElement('div');
    bar.className = 'replay-control-bar';
    const button = (symbol: string, label: string, click: () => void): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'replay-button';
      el.textContent = symbol;
      el.setAttribute('aria-label', label);
      el.onclick = click;
      bar.append(el);
      return el;
    };
    controls = {
      first: button('|<', t('watch.firstMove', {}, locale), () => jumpToPly(0)),
      prev: button('<', t('watch.previousMove', {}, locale), () => jumpToPly(ply - 1)),
      play: button('', t('watch.playPause', {}, locale), togglePlay),
      next: button('>', t('watch.nextMove', {}, locale), () => jumpToPly(ply + 1)),
      last: button('>|', t('watch.lastMove', {}, locale), () => jumpToPly(maxPly())),
    };
    root.replaceChildren(header.el, layout, bar, progress);
  };

  const fetchFinished = async (id: string): Promise<unknown> => {
    try {
      const response = await fetch(`/api/gomoku/games/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  const loadGame: ReplayHandle['loadGame'] = async (id, loadOptions) => {
    if (destroyed) return;
    const seq = ++loadSeq;
    const sameLiveGame = options.live && payload !== null && roomId === id;
    const following = ply === maxPly();
    const previousPly = ply;
    stop();
    const overridden = await options
      .loadPostgameOverride?.(id)
      .catch(() => ({ ok: false as const }));
    const value = overridden?.ok ? overridden.postgame : await fetchFinished(id);
    if (destroyed || seq !== loadSeq) return;
    const loaded = readPayload(value);
    if (!loaded) {
      if (options.onLoadError?.()) return;
      payload = null;
      const notice = document.createElement('p');
      notice.className = 'watch-empty';
      notice.textContent = t('watch.gameLoadFailed', {}, locale);
      root.replaceChildren(notice);
      return;
    }
    payload = loaded;
    roomId = id;
    // A static card (followEnd: the /games "Just finished" tiles) opens on the
    // final position, as the shared tenant replay does; ply 0 is only the
    // dealt opening.
    const wanted =
      loadOptions?.initialPly ??
      (sameLiveGame && !following ? previousPly : options.live || options.followEnd ? maxPly() : 0);
    ply = Number.isFinite(wanted) ? Math.max(0, Math.min(Math.trunc(wanted), maxPly())) : 0;
    paused = !(loadOptions?.startAutoplay ?? options.autoplay ?? true);
    endFired = false;
    lastNotified = '';
    const moves = payload.timeline.filter((event) => event.type === 'move-played' && event.move);
    const started = payload.game.startedAt;
    const startedAt = typeof started === 'string' ? Date.parse(started) : (started ?? null);
    offsets = offsetsFromTimestamps(
      startedAt,
      moves.map((move) => move.at),
    );
    while (offsets.length <= maxPly()) offsets.push(offsets.at(-1)! + 1_100);
    build();
    render();
    start();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, button, [contenteditable]')
    )
      return;
    switch (event.key) {
      case 'ArrowLeft':
        jumpToPly(ply - 1);
        break;
      case 'ArrowRight':
        jumpToPly(ply + 1);
        break;
      case 'Home':
        jumpToPly(0);
        break;
      case 'End':
        jumpToPly(maxPly());
        break;
      case ' ':
        togglePlay();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') tick();
  };
  if (!compact) window.addEventListener('keydown', onKeydown);
  window.addEventListener('mistboard:display-preferences-change', render);
  document.addEventListener('visibilitychange', onVisibility);
  await loadGame(initialRoomId);
  return {
    activeSampleId: () => roomId,
    loadGame,
    destroy: () => {
      destroyed = true;
      loadSeq += 1;
      stop();
      if (!compact) window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mistboard:display-preferences-change', render);
      document.removeEventListener('visibilitychange', onVisibility);
      root.replaceChildren();
    },
    updateLoopPool: () => {},
    jumpToPly,
    plyCount: maxPly,
    moveEntries: () =>
      (payload?.timeline ?? []).flatMap((event) =>
        event.type === 'move-played' && event.move && event.ply !== undefined
          ? [{ ply: event.ply, label: event.move.to }]
          : [],
      ),
    playedMoves: () =>
      (payload?.timeline ?? []).flatMap((event) =>
        event.type === 'move-played' && event.move && event.ply !== undefined
          ? [{ ply: event.ply, to: event.move.to }]
          : [],
      ),
    moveSoundAtPly: (at) => (at >= 1 && at <= maxPly() ? 'move' : null),
    gameResult: () => payload?.game.result ?? null,
    availablePovs: () => ['truth'],
    setPov,
    bottomSeat: () => sideFor(orientation),
    clockAtPly,
  };
}
