import { type Color, clockRemainingMs, type GameEvent, type PlayerView } from '@mistboard/game';
import { shouldShowClockTenths, shouldShowFinalClockTenths } from './account-preferences.js';
import { applyClockEmphasis, setClockFace } from './clock-emphasis.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { flippedBottom } from './live-board-flip.js';
import { isLive } from './live-replay.js';
import { maybePlayLowTimeSound } from './live-sound.js';
import { type LiveRefs, liveState } from './live-state.js';
import { connectionNoticeMode } from './live-status.js';
import { playerNameEl, profileTargetFor } from './profile-link.js';
import { formatClock, formatDayClock, isColor } from './web-utils.js';

type ClockRefs = Pick<
  LiveRefs,
  'clockTop' | 'clockBottom' | 'clockNote' | 'playerTop' | 'playerBottom'
>;

// Tracks the previous active clock color across renderClocks() calls so we can
// detect the turn flip into the seated player's clock and play a flash.
let lastActiveClockColor: Color | null = null;

export function resetClockState(): void {
  lastActiveClockColor = null;
}

export function renderClocks(refs: ClockRefs, view: PlayerView | null): void {
  refs.clockTop.replaceChildren();
  refs.clockBottom.replaceChildren();
  refs.playerTop.replaceChildren();
  refs.playerBottom.replaceChildren();
  refs.clockNote.hidden = true;
  refs.clockNote.textContent = '';
  if (!view?.clock) {
    resetClockState();
    const roomCreated = liveState.events.find(
      (e): e is Extract<GameEvent, { type: 'room-created' }> => e.type === 'room-created',
    );
    const tc = roomCreated?.timeControl;
    const dayScale = daysPerMoveAllowance() !== null;
    // Correspondence rooms are 'playing' before the clock arms (the first
    // move starts it), so the side to move is already real and marked.
    const toMove = dayScale && view?.status.type === 'playing' ? view.status.turn : null;
    const colors: Color[] =
      flippedBottom('white') === 'white' ? ['black', 'white'] : ['white', 'black'];
    colors.forEach((color, index) => {
      const isTurn = color === toMove;
      const playerLine = document.createElement('span');
      playerLine.className = isTurn ? 'clock-player-line active' : 'clock-player-line';
      const name = liveState.seatDisplayNames[color] ?? colorWord(color);
      // Only a real seat name links; the capitalized colour fallback names
      // nobody, so it must not carry the seat's profile href.
      playerLine.append(
        playerNameEl(
          name,
          liveState.seatDisplayNames[color]
            ? profileTargetFor(liveState.seatProfiles[color])
            : null,
          'clock-name',
        ),
      );
      if (isTurn) {
        const pill = document.createElement('span');
        pill.className = 'clock-to-move';
        pill.textContent = color === liveState.seat ? t('live.yourMovePill') : t('live.toMove');
        pill.setAttribute('aria-hidden', 'false');
        playerLine.append(pill);
      }
      (index === 0 ? refs.playerTop : refs.playerBottom).append(playerLine);
      if (!tc) return;
      const row = document.createElement('div');
      row.className = isTurn ? 'pregame active' : 'pregame';
      const time = document.createElement('strong');
      if (dayScale) time.textContent = formatDayClock(tc.initialMs);
      else setClockFace(time, formatClock(tc.initialMs));
      row.append(time);
      (index === 0 ? refs.clockTop : refs.clockBottom).append(row);
    });
    // Correspondence keeps its days-per-move line (it states the pace); live
    // games drop the pregame "clock starts when ready" hint (Brian, 2026-10-02).
    refs.clockNote.textContent = tc && dayScale ? daysPerMoveNote() : '';
    refs.clockNote.hidden = !(tc && dayScale);
    return;
  }

  const clock = view.clock;
  const displayAt = isLive() ? Date.now() : (clock.runningSince ?? Date.now());
  // Top first, bottom last; the bottom follows the board (seat, else the
  // view's perspective, then the viewer's flip).
  const bottom = flippedBottom(
    isColor(liveState.seat) ? liveState.seat : (view.perspective ?? 'white'),
  );
  const colors: Color[] = bottom === 'white' ? ['black', 'white'] : ['white', 'black'];
  const isPvp = liveState.roomMode === 'pvp';
  const humanColor = isColor(liveState.seat) ? liveState.seat : null;
  const playing = view.status.type === 'playing';
  const nextActiveColor = playing ? view.clock.activeColor : null;
  // Flash fires once on the transition: previous render had a different active
  // color (or none), and the new active is the seated player's. Skips the very
  // first render of a game so we don't flash on initial pregame->playing flip.
  const flashThisRender =
    playing &&
    humanColor !== null &&
    nextActiveColor === humanColor &&
    lastActiveClockColor !== null &&
    lastActiveClockColor !== humanColor;
  colors.forEach((color, index) => {
    const isActive = nextActiveColor === color;
    const row = document.createElement('div');
    row.dataset.color = color;
    const playerLine = document.createElement('span');
    playerLine.className = 'clock-player-line';
    const time = document.createElement('strong');
    // Presence dot. Your own seat reflects your *local* socket (connectedSeats is
    // stale while you're disconnected, since no frames arrive): green when
    // healthy, grey-and-pulsing once a reconnect escalates past the grace window
    // — the calm, in-place signal the panel notice used to flash for. Shown in
    // every mode you're seated in (PvP + PvE). The opponent's dot is the server's
    // connectedSeats and only renders in PvP; an engine seat has no socket, so it
    // stays dot-less rather than showing a permanent (and misleading) offline dot.
    const isOwnSeat = color === humanColor;
    if (isOwnSeat) {
      const reconnecting = connectionNoticeMode() !== 'none';
      playerLine.append(presenceDot(!reconnecting, { reconnecting }));
    } else if (isPvp) {
      playerLine.append(presenceDot(liveState.connectedSeats[color] ?? false));
    }
    const serverName = liveState.seatDisplayNames[color];
    const playerName =
      serverName ??
      (color === humanColor
        ? t('live.you')
        : liveState.roomMode === 'pve'
          ? t('play.opponentEngine')
          : colorWord(color));
    // 'You' / 'Bot' / the colour word are placeholders for an unnamed seat, so
    // they stay plain text; only a server-supplied name gets its profile link.
    playerLine.append(
      playerNameEl(
        playerName,
        serverName ? profileTargetFor(liveState.seatProfiles[color]) : null,
        'clock-name',
      ),
    );
    const toMove = document.createElement('span');
    toMove.className = 'clock-to-move';
    toMove.textContent = t('live.toMove');
    toMove.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    playerLine.append(toMove);
    const remainingMs = clockRemainingMs(clock, color, displayAt);
    if (daysPerMoveAllowance() !== null) time.textContent = formatDayClock(remainingMs);
    else
      setClockFace(
        time,
        formatClock(
          remainingMs,
          playing ? shouldShowClockTenths(remainingMs, isActive) : shouldShowFinalClockTenths(),
        ),
      );
    const classes = ['clock-time-row'];
    if (isActive) classes.push('active');
    if (isActive && flashThisRender) classes.push('just-activated');
    row.className = classes.join(' ');
    row.append(time);
    applyClockEmphasis(
      row,
      remainingMs,
      daysPerMoveAllowance() !== null ? null : roomInitialClockMs(),
    );
    if (isActive) playerLine.classList.add('active');
    (index === 0 ? refs.playerTop : refs.playerBottom).append(playerLine);
    (index === 0 ? refs.clockTop : refs.clockBottom).append(row);
  });
  if (daysPerMoveAllowance() !== null) {
    refs.clockNote.textContent = daysPerMoveNote();
    refs.clockNote.hidden = false;
  }
  lastActiveClockColor = nextActiveColor;
}

function daysPerMoveNote(): string {
  const allowance = daysPerMoveAllowance();
  if (allowance === null) return '';
  return allowance === 1
    ? t('live.oneDayPerMoveNote')
    : t('live.daysPerMoveNote', { count: allowance });
}

// The room's days-per-move allowance, or null for live clocks. Present on every
// state frame of a correspondence room (the tenant snapshot carries the room's
// persisted time control), so it never flickers across reconnects.
function daysPerMoveAllowance(): number | null {
  const days = liveState.timeControl?.daysPerMove;
  return typeof days === 'number' && days > 0 ? days : null;
}

// Lightweight per-tick refresh used by the 100ms interval. Updates only the
// time text and low-time emphasis on existing rows so a CSS animation applied
// to the active row by renderClocks() is not restarted each tick.
export function tickClockTimers(refs: ClockRefs, view: PlayerView | null): void {
  if (!view?.clock || view.status.type !== 'playing') return;
  if (refs.clockTop.children.length === 0 || refs.clockBottom.children.length === 0) {
    renderClocks(refs, view);
    return;
  }
  const displayAt = isLive() ? Date.now() : (view.clock.runningSince ?? Date.now());
  const humanColor = isLive() && isColor(liveState.seat) ? liveState.seat : null;
  // Day-scale rooms keep the per-tick refresh (cheap, and the final hour ticks
  // in M:SS) but skip the low-time sound: its threshold is a fraction of the
  // initial budget, which on a days-long clock would chime hours out.
  const dayScale = daysPerMoveAllowance() !== null;
  const rows = [...Array.from(refs.clockTop.children), ...Array.from(refs.clockBottom.children)];
  for (const row of rows as HTMLDivElement[]) {
    const color = row.dataset.color;
    if (color !== 'white' && color !== 'black') continue;
    const isActive = view.clock.activeColor === color;
    const remainingMs = clockRemainingMs(view.clock, color, displayAt);
    if (color === humanColor && !dayScale) {
      maybePlayLowTimeSound(view.id, remainingMs, roomInitialClockMs());
    }
    const strong = row.querySelector('strong');
    if (strong) {
      if (dayScale) strong.textContent = formatDayClock(remainingMs);
      else
        setClockFace(
          strong,
          formatClock(remainingMs, shouldShowClockTenths(remainingMs, isActive)),
        );
    }
    applyClockEmphasis(row, remainingMs, dayScale ? null : roomInitialClockMs());
  }
}

// The room's initial clock budget, for the low-time threshold. Fog snapshots
// keep event lists short, so the find stays cheap at tick frequency.
function roomInitialClockMs(): number | null {
  const roomCreated = liveState.events.find(
    (e): e is Extract<GameEvent, { type: 'room-created' }> => e.type === 'room-created',
  );
  return roomCreated?.timeControl?.initialMs ?? null;
}

function presenceDot(connected: boolean, opts?: { reconnecting?: boolean }): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = `presence-dot ${connected ? 'is-online' : 'is-offline'}`;
  const label = connected
    ? t('live.connConnected')
    : opts?.reconnecting
      ? t('live.statusReconnecting')
      : t('live.connDisconnected');
  dot.setAttribute('aria-label', label);
  dot.title = label;
  return dot;
}

// The placeholder for an unnamed seat: the shared setup.* colour word, so the
// clock rows read the same word as the pregame picker and the result line.
const COLOR_WORD_KEYS: Record<Color, I18nKey> = { white: 'setup.white', black: 'setup.black' };

function colorWord(color: Color): string {
  return t(COLOR_WORD_KEYS[color]);
}
