// Generic Mistboard TV renderer for the tenant SVG family (Jieqi, Banqi, Dark
// Mini Xiangqi — red/black boards rendered as SVG, replayed from a FINISHED
// game's postgame endpoint, never live spectating). This holds ALL the shared
// "TV" chrome — header strip, board panes (one truth pane, or a per-color
// triptych), the control bar + auto-play, ply navigation, and the ReplayHandle
// contract. Each variant supplies a small TenantWatchAdapter (its postgame
// loader/helpers, board renderer, and captures fill); the per-variant module is
// then ~30 lines. See watch-banqi-replay.ts / watch-jieqi-replay.ts.
//
// Crossroads/dark-chess stay on the chessground path in replay.ts; this generic
// is for the xiangqi-style SVG tenants only.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { createPane, type ReplayPaneHandle } from './replay-board.js';
import { createGameHeaderStrip } from './replay-meta.js';
import type { MoveListEntry } from './review/move-list.js';
import {
  reconstructMoveDelays,
  reconstructShowcaseClocks,
  type ShowcaseClockPair,
  showcaseResultMarks,
} from './showcase-clock.js';
import { pickCompactViewKey } from './showcase-compact-view.js';
import {
  clockRemainingMs,
  readTenantWebClock,
  type TenantWebClock,
} from './variant-tenant/clock-projection.js';
import { formatClock } from './web-utils.js';

const AUTO_PLAY_PLY_MS = 1100;
const AUTO_PLAY_LOOP_HOLD_MS = 2600;
// Compact showcase end-of-game hold: long enough to read the 1/0/½ result marks
// before the cycler advances (the chess path holds the same via showcase-board).
const SHOWCASE_END_HOLD_MS = 4000;
// Compact showcase per-move pacing: play each move at its real recorded duration
// clamped to this watchable band, and tick the mover's clock down across it.
const SHOWCASE_MIN_MOVE_MS = 700;
const SHOWCASE_MAX_MOVE_MS = 2500;
const SHOWCASE_CLOCK_TICK_MS = 100;

// The postgame fields the shared TV chrome reads; every tenant postgame response
// carries these (the adapter's Postgame type extends this).
export type WatchPostgameMeta = {
  game: {
    mode: string;
    result: string;
    termination: string;
    plyCount: number;
    rated: boolean;
    initialMs: number | null;
    incrementMs: number | null;
    startedAt?: number | string | null;
  };
  state: {
    timeControl?: { initialMs: number; incrementMs: number } | null;
    // The server's clock snapshot ({ activeColor, remainingMs, runningSince }). A LIVE
    // frame (/api/watch/live) always carries it; it is the anchor the live follow
    // projects to wall-clock time, so the mover's clock counts down between polls.
    // Untyped on the wire; readTenantWebClock narrows it.
    clock?: unknown;
  };
  // Per-event wall-clock timestamps; present on every tenant postgame (move events
  // carry color + ply, terminal events may not). The compact showcase reconstructs
  // the players' real clocks from the move timestamps (the generic tenant postgames
  // carry no dense clock series). Move events also carry the played `move` (from-to
  // coordinates), which the /watch move list reads variant-agnostically; drops
  // (drop-mini-xiangqi) omit `from`.
  timeline?: ReadonlyArray<{
    at: number;
    color?: string;
    ply?: number;
    move?: { from?: string; to?: string };
  }>;
};

// The variant-specific surface. The generic owns everything else.
export type TenantWatchAdapter<Postgame extends WatchPostgameMeta, View, ViewKey extends string> = {
  installStyles(): void;
  /** Appearance event that repaints the current ply without changing replay state. */
  appearanceEvent?: string;
  loadPostgame(roomId: string): Promise<{ ok: true; postgame: Postgame } | { ok: false }>;
  maxPly(postgame: Postgame): number;
  // Boards to show: a triptych [red, truth, black] for per-color hidden info
  // (jieqi/mini-xiangqi) or just [truth] for symmetric variants (banqi).
  viewEntries(postgame: Postgame): ReadonlyArray<{ key: ViewKey; label: string }>;
  viewAtPly(postgame: Postgame, key: ViewKey, ply: number): View | null;
  paneKind(key: ViewKey): 'white' | 'truth' | 'black';
  // The adapter owns fog/perspective (e.g. mini-xiangqi passes showFog when the
  // pane is a per-color view rather than truth).
  renderBoard(view: View, orientation: 'red' | 'black', key: ViewKey): string;
  fillCaptures(host: HTMLElement, view: View, owner: 'red' | 'black'): void;
  // Label one ply for the move list. The default writes `${from}-${to}`, which
  // is every tenant whose move IS a from/to pair. A tenant whose move carries
  // more than that (Duck Xiangqi: a piece move AND a duck placement) must pass
  // its own, or the TV list silently publishes half of each turn.
  moveLabel?(move: Record<string, unknown>): string;
  // Drop/reserve variants (drop-mini-xiangqi, crazyhouse, shogi) where the hand IS
  // the position: the compact showcase flanks the board with vertical reserve
  // strips (each side's hand) instead of top/bottom capture rows.
  sidedCaptures?: boolean;
  // When set, the (single) board defaults to the as-played hidden-identity view
  // (hiddenKey) and a Reveal/Hide control (and the `h` key) swaps it to truth.
  // Tenants without hidden identities omit this and keep their fixed view.
  reveal?: { hiddenKey: ViewKey; truthKey: ViewKey };
  // Override the result string when the recorded result key (seat-based) is not
  // the player-facing color. Banqi needs this: its seats are first/second mover
  // and the ink binds on the opening flip, so "red-wins" may be a Black-ink win.
  // Tenants where seat == ink (jieqi, mini-xiangqi) omit it and keep the default.
  resultLabel?(result: string, postgame: Postgame): string;
  // Same problem one row down: the seat rail cells default to the literal color
  // words for the two seats, which a flip tenant must override with the bound ink
  // so the rail agrees with the board and the result chip above it.
  seatLabel?(seat: 'red' | 'black', postgame: Postgame): string;
  // OPTIONAL piece-glide hook, called after each pane's innerHTML swap when the
  // ply moved by exactly ONE (autoplay tick or manual step). `view` is the pane's
  // freshly rendered view, `prevView` the same pane's view at the previous ply
  // (null when unavailable); the adapter derives the move from those payloads
  // (typically lastMove) — never from diffing boards. Tenants that omit this
  // keep the discrete per-ply repaint.
  animateMove?(
    boardEl: HTMLElement,
    view: View,
    prevView: View | null,
    direction: 'forward' | 'back',
    orientation: 'red' | 'black',
    key: ViewKey,
  ): void;
};

export type TenantWatchReplayOptions = {
  autoplay?: boolean;
  locale?: Locale;
  metadataByRoomId?: Record<string, GameMeta>;
  /**
   * Homepage showcase mode: render a SINGLE board (no header/control-bar/ply-line)
   * instead of the full TV triptych. The compact view honors hidden info —
   * perfect-info/symmetric variants show truth; hidden-identity/per-color variants
   * show the as-played hidden view (a reveal tenant's hiddenKey, or one random
   * color's POV — never the truth board). Pairs with onGameEnd for cross-variant
   * cycling.
   */
  compact?: boolean;
  /**
   * Compact only: the side to show the game from, instead of the random pick.
   * A per-color fog tenant shows that side's own (post-reveal, so public) view
   * oriented to them; a perfect-information tenant keeps the truth board and
   * turns it to that side; `truth` is the fog-off board. A view the loaded game
   * does not carry falls back to the orientation alone.
   */
  pov?: 'white' | 'truth' | 'black';
  /**
   * Compact only: suppress the flanking reserve strips for drop/reserve variants
   * (fortress-xiangqi), rendering just the bare board. The "Previously on" queue
   * thumbnails use this — at thumbnail scale the hands are unreadable clutter, so
   * the preview shows the board alone. The featured board and full TV keep them.
   */
  hideReserve?: boolean;
  /**
   * Called once when the game reaches its final ply under autoplay (after the
   * loop hold), instead of restarting the same game. Lets an outer showcase
   * controller advance to the next pooled game (possibly a different variant).
   */
  onGameEnd?: () => void;
  /**
   * Player names for the compact showcase seats, keyed by room id: `first` is the
   * red/first-mover side, `second` is black. The tenant postgames carry no names
   * (they come from the feed's participants), so the caller supplies them here;
   * absent names fall back to the color labels.
   */
  namesByRoomId?: Record<string, { first: string; second: string }>;
  /**
   * Called on every ply change (autoplay tick, manual jump, or loop reset) with
   * the current ply and the game's max ply. The /watch right rail uses it to keep
   * the move list highlight + scrubber bounds in sync. OPTIONAL: the homepage
   * showcase omits it.
   */
  onPlyChange?: (ply: number, maxPly: number) => void;
  /**
   * LIVE-follow mode: the loaded payload is an in-progress game's position so
   * far, not a finished replay. Standing at the final known ply means "caught
   * up", not "game over" — end-of-game result marks are suppressed and the
   * side to move keeps its active highlight. The outer controller re-loads the
   * game (via loadPostgameOverride) as new moves arrive and jumps to the end.
   */
  live?: boolean;
  /**
   * Payload source override for live games: returns the postgame-SHAPED payload
   * (from /api/watch/live) instead of fetching the tenant's finished-game
   * endpoint. `{ ok: false }` falls back to the adapter's normal loader — which
   * is exactly the live→finished handoff (the real postgame exists once the
   * game ends). The postgame is cast to the adapter's payload type; the caller
   * owns shape fidelity.
   */
  loadPostgameOverride?: (
    roomId: string,
  ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
  /**
   * Called when a game's postgame cannot be loaded (the endpoint 404s or the
   * fetch fails). Return `true` to signal the caller has handled the failure and
   * the renderer should LEAVE the current board untouched instead of wiping it to
   * the "could not be loaded" notice. Used by the homepage TV live→frozen
   * handoff, where a followed live game that merely went idle (or whose finished
   * record has not persisted yet) must keep its last frame rather than flash an
   * error. Absent / returning `false` keeps the default notice behavior.
   */
  onLoadError?: () => boolean;
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
  if (result === 'red-wins') return 'white';
  if (result === 'black-wins') return 'black';
  return 'draw';
}

function resultLabel(result: string, locale: Locale): string {
  if (result === 'red-wins') return t('watch.redWins', {}, locale);
  if (result === 'black-wins') return t('watch.blackWins', {}, locale);
  return t('result.draw', {}, locale);
}

function labelize(value: string): string {
  const spaced = value.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function timeControlLabel(postgame: WatchPostgameMeta, locale: Locale): string {
  const initialMs = postgame.game.initialMs ?? postgame.state.timeControl?.initialMs ?? null;
  const incrementMs = postgame.game.incrementMs ?? postgame.state.timeControl?.incrementMs ?? null;
  if (initialMs === null && incrementMs === null) return t('watch.untimed', {}, locale);
  return `${Math.round((initialMs ?? 0) / 60000)}+${Math.round((incrementMs ?? 0) / 1000)}`;
}

// Title is the matchup (like the dark-chess watch's "Human vs engine"), not the
// variant name; the channel tab already conveys the variant.
function matchupLabel(mode: string, locale: Locale): string {
  if (mode === 'pve') return t('watch.humanVsEngine', {}, locale);
  if (mode === 'eve') return t('watch.engineVsEngine', {}, locale);
  return t('watch.humanVsHuman', {}, locale);
}

function localizeResultLabel(label: string | undefined, result: string, locale: Locale): string {
  if (label === 'Red wins' || (!label && result === 'red-wins'))
    return t('watch.redWins', {}, locale);
  if (label === 'Black wins' || (!label && result === 'black-wins'))
    return t('watch.blackWins', {}, locale);
  if (label === 'Draw' || !label) return resultLabel(result, locale);
  return label;
}

function terminationLabel(reason: string, locale: Locale): string {
  if (locale === 'en') return labelize(reason);
  switch (reason) {
    case 'resignation':
      return t('result.resignation', {}, locale);
    case 'timeout':
      return t('result.timeout', {}, locale);
    case 'abandonment':
      return t('result.abandonment', {}, locale);
    case 'checkmate':
      return t('result.checkmate', {}, locale);
    default:
      return labelize(reason);
  }
}

function localizePaneLabel(label: string, locale: Locale): string {
  if (label === 'Truth') return t('watch.truth', {}, locale);
  if (label === 'Red') return t('replay.red', {}, locale);
  if (label === 'Black') return t('replay.black', {}, locale);
  return label;
}

type SeatCell = { row: HTMLElement; clock: HTMLElement };

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

// A variant-agnostic move list from a tenant postgame's timeline: one entry per
// move event (`ply` 1-based, matching currentPly), labeled by from-to coordinates
// (the `${from}-${to}` convention the tenant postgame reviews use). Drop moves
// (no `from`) fall back to the destination square. Entries without a `move`
// (terminal events) are skipped.
function buildTenantMoveEntries(
  postgame: WatchPostgameMeta,
  moveLabel?: (move: Record<string, unknown>) => string,
): MoveListEntry[] {
  const entries: MoveListEntry[] = [];
  for (const event of postgame.timeline ?? []) {
    const move = event.move;
    if (!move) continue;
    const from = typeof move.from === 'string' ? move.from : '';
    const to = typeof move.to === 'string' ? move.to : '';
    if (!from && !to) continue;
    entries.push({
      ply: typeof event.ply === 'number' ? event.ply : entries.length + 1,
      label: moveLabel ? moveLabel(move) : from && to ? `${from}-${to}` : to || from,
    });
  }
  return entries;
}

function controlButton(symbol: string, aria: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay-button';
  button.textContent = symbol;
  button.setAttribute('aria-label', aria);
  return button;
}

export async function mountTenantWatchReplay<
  Postgame extends WatchPostgameMeta,
  View,
  ViewKey extends string,
>(
  root: HTMLElement,
  roomId: string,
  options: TenantWatchReplayOptions,
  adapter: TenantWatchAdapter<Postgame, View, ViewKey>,
): Promise<ReplayHandle> {
  adapter.installStyles();
  const autoplay = options.autoplay ?? true;
  const locale = options.locale ?? currentLocale();
  const compact = options.compact === true;
  const live = options.live === true;
  const onGameEnd = options.onGameEnd;
  const namesByRoomId = options.namesByRoomId;
  const onPlyChange = options.onPlyChange;
  // Guards a single onPlyChange fire per distinct ply (sync also runs on flips /
  // reveal toggles, which don't move the ply).
  let lastNotifiedPly: number | null = null;

  let activeId = roomId;
  let destroyed = false;
  let timer: number | null = null;
  let paused = !autoplay;
  // Guards a single onGameEnd fire per game so the loop hold can't re-enter it.
  let endFired = false;

  // Per-game render state, rebuilt on each loadGame.
  let boardTargets: Array<{ pane: ReplayPaneHandle; key: ViewKey }> = [];
  let controls: ControlRefs | null = null;
  let seatCells: { red: SeatCell; black: SeatCell } | null = null;
  // Static initial time per side; null when untimed (the tenant postgame payload
  // carries no dense clock series, so there is no continuous countdown).
  let initialClock: { red: number; black: number } | null = null;
  let maxPly = 0;
  let currentPly = 0;
  // The ply the previous sync rendered; a one-ply delta animates the step
  // (adapter.animateMove). Null right after a (re)load so the first paint of a
  // game never glides.
  let lastSyncedPly: number | null = null;
  let boardOrientation: 'red' | 'black' = 'red';
  let activePostgame: Postgame | null = null;
  // Default to the as-played (hidden) board when the tenant supports reveal.
  let revealed = false;
  let revealBtn: HTMLButtonElement | null = null;
  // Compact showcase seats (player name + real reconstructed clock), rebuilt per
  // game; `side` maps each seat to the first(red)/second(black) clock slot.
  let compactSeats: {
    top: { row: HTMLElement; clockEl: HTMLElement; side: 'first' | 'second' };
    bottom: { row: HTMLElement; clockEl: HTMLElement; side: 'first' | 'second' };
  } | null = null;
  // Vertical reserve strips flanking the board for drop/reserve variants
  // (adapter.sidedCaptures); null for board-only variants (captures ride the pane).
  let compactSideStrips: { left: HTMLElement; right: HTMLElement } | null = null;
  // series[p] = both seats' remaining ms after ply p; null when untimed or timeline-less.
  // Drives the compact seat clocks AND the full TV rail clocks (through clockAtPly).
  let clockSeries: ShowcaseClockPair[] | null = null;
  let moveDelays: number[] | null = null;
  let clockTickTimer: number | null = null;
  // Live follow only: the server's authoritative clock from the latest live frame.
  // The reconstruction above only knows about moves that have LANDED, so on its own
  // the mover's clock froze between polls and both clocks jumped together when the
  // next frame arrived. This snapshot is projected to Date.now() on every tick
  // instead (the same arithmetic the live room uses). Null for finished games and
  // untimed rooms.
  let liveClock: TenantWebClock<'red' | 'black'> | null = null;

  // Red moves first, so an even ply leaves Red (first) to move; nobody is on the clock
  // once the game has ended. In live mode the final known ply is "caught up",
  // not "game over", so the side to move keeps its turn there.
  const toMoveAtPly = (): 'first' | 'second' | null =>
    currentPly >= maxPly && !live ? null : currentPly % 2 === 0 ? 'first' : 'second';

  // A CLOCK ONLY EVER TICKS AT ONE SECOND PER SECOND. That leaves exactly two states, and
  // there is deliberately no third:
  //
  //   live    — the server's clock projected against Date.now() (liveClockNow below).
  //   replay  — the ply's recorded value, rendered as a STATIC label by sync(). No animation.
  //
  // Until 2026-09-04 replay had a third state: the mover's clock drained the real time the
  // move cost across the CLAMPED playback window (moveDelays, [700, 2500] ms). The delta was
  // real, the window was compressed, so the rate was whatever fell out of the ratio — on a
  // measured homepage game the bot read a uniform 1.61x and the human swung 1.00x-7.60x,
  // which is what got it reported. Landing exactly on the recorded value at each ply is not
  // worth a clock that lies about how fast time passes.
  //
  // Do not re-add the drain on top of the clamp. Lichess animates a replay clock only in
  // 'realtime' autoplay, where the playback window IS the recorded think time (unclamped,
  // ui/analyse/src/autoplay.ts) so the ratio is 1 by construction; it subtracts real elapsed
  // wall time, never a fraction of a window (ui/analyse/src/view/clocks.ts). We clamp on
  // purpose — an unattended landing-page board cannot sit frozen through a 19-second think —
  // and a clamped window and an honest countdown cannot both hold.
  const liveClockNow = (): ShowcaseClockPair | null => {
    if (!liveClock || currentPly < maxPly) return null;
    const now = Date.now();
    return {
      first: clockRemainingMs(liveClock, 'red', now),
      second: clockRemainingMs(liveClock, 'black', now),
    };
  };

  // Live only: replay clocks are static per ply, so nothing here needs a timer.
  const tickCompactClock = (): void => {
    if (!compactSeats) return;
    const liveNow = liveClockNow();
    if (!liveNow) return;
    for (const seat of [compactSeats.top, compactSeats.bottom]) {
      seat.clockEl.textContent = formatClock(liveNow[seat.side]);
    }
  };

  const compactSeatRow = (name: string): { row: HTMLElement; clockEl: HTMLElement } => {
    const row = document.createElement('div');
    row.className = 'showcase-seat';
    const nameEl = document.createElement('span');
    nameEl.className = 'showcase-seat-name';
    nameEl.textContent = name;
    const clockEl = document.createElement('span');
    clockEl.className = 'showcase-seat-clock';
    row.append(nameEl, clockEl);
    return { row, clockEl };
  };

  // Lichess convention: a player's captured material sits next to that player.
  const renderPaneCaptures = (
    pane: ReplayPaneHandle,
    view: View,
    bottomColor: 'red' | 'black',
  ): void => {
    const topColor: 'red' | 'black' = bottomColor === 'red' ? 'black' : 'red';
    // Reset before each per-ply re-render: the family fill helpers append a row
    // rather than replace, so without this the rows accumulate across plies as the
    // TV auto-advances (a fixed-height strip used to hide it by clipping).
    pane.topCapturesEl.replaceChildren();
    pane.capturesEl.replaceChildren();
    adapter.fillCaptures(pane.topCapturesEl, view, topColor);
    adapter.fillCaptures(pane.capturesEl, view, bottomColor);
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const sync = (): void => {
    if (!activePostgame) return;
    // Exactly one ply moved since the last sync: glide the step. Flips, reveal
    // toggles, jumps, and the first paint (lastSyncedPly null) stay discrete.
    const stepDelta = lastSyncedPly === null ? 0 : currentPly - lastSyncedPly;
    const animatedPrevPly = Math.abs(stepDelta) === 1 ? lastSyncedPly : null;
    for (const target of boardTargets) {
      const key = adapter.reveal
        ? ((revealed ? adapter.reveal.truthKey : adapter.reveal.hiddenKey) as ViewKey)
        : target.key;
      // Fall back to the pane's own key if the chosen view is missing (e.g. a game
      // stored without per-color histories): better a revealed board than blank.
      const view =
        adapter.viewAtPly(activePostgame, key, currentPly) ??
        adapter.viewAtPly(activePostgame, target.key, currentPly);
      if (view) {
        target.pane.boardEl.innerHTML = adapter.renderBoard(view, boardOrientation, key);
        if (adapter.animateMove && animatedPrevPly !== null) {
          const prevView =
            adapter.viewAtPly(activePostgame, key, animatedPrevPly) ??
            adapter.viewAtPly(activePostgame, target.key, animatedPrevPly);
          adapter.animateMove(
            target.pane.boardEl,
            view,
            prevView,
            stepDelta > 0 ? 'forward' : 'back',
            boardOrientation,
            key,
          );
        }
        if (compactSideStrips) {
          // Reserve strips: opponent's hand on the left, the oriented side's on
          // the right (each below its own player).
          const topColor: 'red' | 'black' = boardOrientation === 'red' ? 'black' : 'red';
          compactSideStrips.left.replaceChildren();
          compactSideStrips.right.replaceChildren();
          adapter.fillCaptures(compactSideStrips.left, view, topColor);
          adapter.fillCaptures(compactSideStrips.right, view, boardOrientation);
        } else if (!compact) {
          // Watch (full TV) keeps captures on the pane; compact non-drop shows none.
          renderPaneCaptures(target.pane, view, boardOrientation);
        }
      }
    }
    if (compactSeats) {
      // At the final ply the clocks give way to the result (1 / 0 / ½) for the
      // hold; earlier plies show the reconstructed clocks (toggles also clear the
      // result state when a loop restarts the same game at ply 0). Live games
      // have no result yet, so the final known ply keeps showing clocks.
      const atGameEnd = !live && maxPly > 0 && currentPly >= maxPly;
      const marks = atGameEnd ? showcaseResultMarks(activePostgame.game.result) : null;
      const winner =
        marks === null || marks.first === marks.second
          ? null
          : marks.first === '1'
            ? 'first'
            : 'second';
      const liveNow = liveClockNow();
      for (const seat of [compactSeats.top, compactSeats.bottom]) {
        if (marks) {
          seat.clockEl.textContent = marks[seat.side];
        } else if (liveNow) {
          seat.clockEl.textContent = formatClock(liveNow[seat.side]);
        } else if (clockSeries) {
          const at = clockSeries[Math.min(currentPly, clockSeries.length - 1)]!;
          seat.clockEl.textContent = formatClock(at[seat.side]);
        }
        seat.clockEl.classList.toggle('showcase-seat-result', marks !== null);
        seat.row.classList.toggle('result-win', seat.side === winner);
      }
      compactSeats.top.row.classList.toggle('active', toMoveAtPly() === compactSeats.top.side);
      compactSeats.bottom.row.classList.toggle(
        'active',
        toMoveAtPly() === compactSeats.bottom.side,
      );
    }
    if (controls) {
      const result =
        currentPly >= maxPly
          ? localizeResultLabel(
              adapter.resultLabel?.(activePostgame.game.result, activePostgame),
              activePostgame.game.result,
              locale,
            )
          : '';
      controls.plyLabel.textContent = result
        ? t('watch.plyProgressResult', { current: currentPly, total: maxPly, result }, locale)
        : t('watch.plyProgress', { current: currentPly, total: maxPly }, locale);
      controls.first.disabled = currentPly <= 0;
      controls.prev.disabled = currentPly <= 0;
      controls.next.disabled = currentPly >= maxPly;
      controls.last.disabled = currentPly >= maxPly;
    }

    // Red moves first, so after an even ply Red is to move; no active side once
    // the game has ended.
    const toMove = currentPly >= maxPly ? null : currentPly % 2 === 0 ? 'red' : 'black';
    if (seatCells) {
      if (initialClock) {
        seatCells.red.clock.textContent = formatClock(initialClock.red);
        seatCells.black.clock.textContent = formatClock(initialClock.black);
      }
      seatCells.red.row.classList.toggle('active', toMove === 'red');
      seatCells.black.row.classList.toggle('active', toMove === 'black');
    }
    lastSyncedPly = currentPly;
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
      atEnd
        ? onGameEnd
          ? SHOWCASE_END_HOLD_MS
          : AUTO_PLAY_LOOP_HOLD_MS
        : (moveDelays?.[currentPly + 1] ?? AUTO_PLAY_PLY_MS),
    );
  };

  const setPaused = (next: boolean): void => {
    paused = next;
    if (controls)
      controls.play.textContent = paused
        ? `▶ ${t('watch.play', {}, locale)}`
        : `⏸ ${t('watch.pause', {}, locale)}`;
    // Replay clocks are static per ply, so pause/resume only has to start and stop playback:
    // the displayed value is already the ply's true one either way.
    if (paused) clearTimer();
    else scheduleAuto();
  };

  // A manual step pauses auto-play (TV you can pause and scrub).
  const manualJump = (ply: number): void => {
    setPaused(true);
    currentPly = Math.max(0, Math.min(maxPly, ply));
    sync();
  };

  const toggleReveal = (): void => {
    if (!adapter.reveal) return;
    // A live game has no truth track to reveal — the server withholds it while the
    // game is in progress (that IS the hidden-info boundary), so the control would
    // silently fall back to the masked board. Refuse rather than pretend.
    if (live) return;
    revealed = !revealed;
    if (revealBtn)
      revealBtn.textContent = revealed
        ? t('watch.hide', {}, locale)
        : t('watch.reveal', {}, locale);
    sync();
  };

  // The single board to show in compact showcase mode. Honors hidden info:
  //  - reveal tenants (jieqi): the as-played masked board (hiddenKey), never truth;
  //  - per-color hidden info (dark-xiangqi fog): one random side's own POV, stable
  //    per room, oriented to that side;
  //  - perfect-info / symmetric (banqi, jungle, mini-open): the truth board.
  // The showcase only ever replays FINISHED games (whose truth is already public
  // via the reveal gate), so this is a product choice — show the fog off — not a
  // redaction boundary.
  const pickCompactTarget = (game: Postgame): { key: ViewKey; orientation: 'red' | 'black' } => {
    const choice = pickCompactViewKey({
      roomId: activeId,
      entries: adapter.viewEntries(game),
      paneKind: adapter.paneKind,
      reveal: adapter.reveal,
    });
    return { key: choice.key, orientation: choice.side === 'second' ? 'black' : 'red' };
  };

  // The random pick, unless the caller named a side: then that side's own view
  // when the game carries one, and otherwise the picked view turned their way.
  const compactTargetFor = (postgame: Postgame): { key: ViewKey; orientation: 'red' | 'black' } => {
    const picked = pickCompactTarget(postgame);
    const pov = options.pov;
    if (!pov) return picked;
    const orientation: 'red' | 'black' = pov === 'black' ? 'black' : 'red';
    for (const entry of adapter.viewEntries(postgame)) {
      if (adapter.paneKind(entry.key) === pov) return { key: entry.key, orientation };
    }
    return pov === 'truth' ? picked : { key: picked.key, orientation };
  };

  const buildGame = (postgame: Postgame): void => {
    activePostgame = postgame;
    maxPly = adapter.maxPly(postgame);
    currentPly = 0;
    lastSyncedPly = null;
    lastNotifiedPly = null;
    paused = !autoplay;
    boardOrientation = 'red';
    const initialMs = postgame.game.initialMs ?? postgame.state.timeControl?.initialMs ?? null;
    initialClock = initialMs === null ? null : { red: initialMs, black: initialMs };
    endFired = false;

    // Reconstruct the players' real remaining clocks from the move timestamps (the generic
    // tenant postgames carry no dense clock series). Built for BOTH the compact previews and
    // the full TV board — the latter reads it per ply through clockAtPly for the rail clocks.
    // Null when untimed or timeline-less, which every reader renders as "no clock".
    const clockIncrementMs =
      postgame.game.incrementMs ?? postgame.state.timeControl?.incrementMs ?? 0;
    const timelineMoves = (postgame.timeline ?? []).flatMap((event) =>
      typeof event.color === 'string' && typeof event.ply === 'number'
        ? [{ at: event.at, color: event.color, ply: event.ply }]
        : [],
    );
    clockSeries =
      initialMs !== null && timelineMoves.length > 0
        ? reconstructShowcaseClocks({
            moves: timelineMoves,
            startedAt: null,
            initialMs,
            incrementMs: clockIncrementMs,
            firstColor: 'red',
          })
        : null;
    // Only an in-progress live frame anchors the projection: a finished game's stored
    // clock may still carry a runningSince, and projecting it would count a frozen
    // board down forever.
    liveClock =
      live && postgame.game.result === 'in-progress'
        ? readTenantWebClock(postgame.state.clock, ['red', 'black'] as const)
        : null;
    // Play each move at its real recorded duration (clamped), so a long think LINGERS and
    // a snap move flicks by — and the draining clock reads as thinking rather than as a
    // number spinning on a metronome. Also read by scheduleAuto for the playback pace.
    // Hoisted out of the compact branch: the full TV board wants the same pacing its own
    // queue previews already had.
    moveDelays =
      timelineMoves.length > 0
        ? reconstructMoveDelays({
            moves: timelineMoves,
            minMs: SHOWCASE_MIN_MOVE_MS,
            maxMs: SHOWCASE_MAX_MOVE_MS,
          })
        : null;

    // Compact showcase: a single board framed by a player name + real clock on
    // each side (no control-bar/ply-line).
    if (compact) {
      const target = compactTargetFor(postgame);
      boardOrientation = target.orientation;
      // Compact never uses the pane's top/bottom capture rows: drop/reserve
      // variants show side strips, and every other variant shows no captures here.
      // hideReserve drops the strips too (queue thumbnails render the bare board).
      const sided = adapter.sidedCaptures === true && options.hideReserve !== true;
      const pane = createPane('', adapter.paneKind(target.key), false, 'split');
      boardTargets = [{ pane, key: target.key }];
      controls = null;
      seatCells = null;

      // Bottom seat = the side the board is oriented to; top = the opponent.
      // `first` is the red/first-mover clock slot.
      const names = namesByRoomId?.[activeId];
      const bottomSide: 'first' | 'second' = boardOrientation === 'red' ? 'first' : 'second';
      const topSide: 'first' | 'second' = bottomSide === 'first' ? 'second' : 'first';
      const nameFor = (side: 'first' | 'second'): string =>
        names
          ? side === 'first'
            ? names.first
            : names.second
          : side === 'first'
            ? t('replay.red', {}, locale)
            : t('replay.black', {}, locale);
      const topSeat = compactSeatRow(nameFor(topSide));
      const bottomSeat = compactSeatRow(nameFor(bottomSide));
      compactSeats = {
        top: { row: topSeat.row, clockEl: topSeat.clockEl, side: topSide },
        bottom: { row: bottomSeat.row, clockEl: bottomSeat.clockEl, side: bottomSide },
      };

      // Flank the board with vertical reserve strips for drop/reserve variants;
      // otherwise the board pane stands alone (captures ride the pane top/bottom).
      let boardRow: HTMLElement = pane.el;
      if (sided) {
        const left = document.createElement('div');
        left.className = 'showcase-reserve showcase-reserve-left';
        const right = document.createElement('div');
        right.className = 'showcase-reserve showcase-reserve-right';
        compactSideStrips = { left, right };
        boardRow = document.createElement('div');
        boardRow.className = 'showcase-board-row';
        boardRow.append(left, pane.el, right);
      } else {
        compactSideStrips = null;
      }

      const layout = document.createElement('div');
      layout.className = 'replay-layout replay-layout-solo';
      layout.append(topSeat.row, boardRow, bottomSeat.row);
      root.replaceChildren(layout);
      sync();
      scheduleAuto();
      // Only a live game ticks. The cycler reuses this mount across games, so a replay
      // following a live game must also STOP the ticker, not just leave it no-opping.
      if (liveClock && clockTickTimer === null) {
        clockTickTimer = window.setInterval(tickCompactClock, SHOWCASE_CLOCK_TICK_MS);
      } else if (!liveClock && clockTickTimer !== null) {
        window.clearInterval(clockTickTimer);
        clockTickTimer = null;
      }
      return;
    }

    const header = createGameHeaderStrip();
    header.title.textContent = matchupLabel(postgame.game.mode, locale);
    const chip = document.createElement('span');
    chip.className = `replay-game-header-result-chip replay-game-header-result-${resultChipKind(postgame.game.result)}`;
    chip.textContent = localizeResultLabel(
      adapter.resultLabel?.(postgame.game.result, postgame),
      postgame.game.result,
      locale,
    );
    const detail = document.createElement('span');
    detail.className = 'replay-game-header-result-detail';
    detail.textContent = t(
      'watch.byReason',
      { reason: terminationLabel(postgame.game.termination, locale) },
      locale,
    );
    header.result.append(chip, detail);
    const plies = document.createElement('span');
    plies.textContent = t('watch.plyCount', { count: postgame.game.plyCount }, locale);
    const sep = document.createElement('span');
    sep.className = 'replay-game-header-sep';
    sep.textContent = '·';
    const clock = document.createElement('span');
    clock.textContent = timeControlLabel(postgame, locale);
    const sepRated = document.createElement('span');
    sepRated.className = 'replay-game-header-sep';
    sepRated.textContent = '·';
    const rated = document.createElement('span');
    rated.textContent = postgame.game.rated
      ? t('play.rated', {}, locale)
      : t('play.casual', {}, locale);
    header.meta.append(plies, sep, clock, sepRated, rated);
    // The tenant postgame payloads carry no seat-name fields, so the cells fall
    // back to the color labels (matchup name lives in the header title). A flip
    // tenant supplies seatLabel to name the BOUND ink instead of the seat.
    const seatWord = (seat: 'red' | 'black'): string =>
      adapter.seatLabel?.(seat, postgame) ??
      t(seat === 'red' ? 'replay.red' : 'replay.black', {}, locale);
    const redCell = seatCell(seatWord('red'));
    const blackCell = seatCell(seatWord('black'));
    header.whiteCell.append(redCell.row);
    header.blackCell.append(blackCell.row);
    seatCells = { red: redCell, black: blackCell };

    const layout = document.createElement('div');
    layout.className = 'replay-layout replay-layout-all';
    boardTargets = [];
    for (const entry of adapter.viewEntries(postgame)) {
      // The center board reads "Truth" on watch, matching the dark-chess TV (the
      // postgame review keeps its own "Server truth" label).
      const label = localizePaneLabel(
        adapter.paneKind(entry.key) === 'truth' ? 'Truth' : entry.label,
        locale,
      );
      const pane = createPane(label, adapter.paneKind(entry.key), true, 'split');
      boardTargets.push({ pane, key: entry.key });
      layout.append(pane.el);
    }

    // Control bar below the boards (matches the dark-chess watch: no move list).
    const bar = document.createElement('div');
    bar.className = 'replay-control-bar';
    const first = controlButton('|<', t('watch.firstMove', {}, locale));
    const prev = controlButton('<', t('watch.previousMove', {}, locale));
    const play = controlButton(
      paused ? `▶ ${t('watch.play', {}, locale)}` : `⏸ ${t('watch.pause', {}, locale)}`,
      t('watch.playPause', {}, locale),
    );
    const next = controlButton('>', t('watch.nextMove', {}, locale));
    const last = controlButton('>|', t('watch.lastMove', {}, locale));
    const flip = controlButton('↕', t('watch.flipBoards', {}, locale));
    bar.append(first, prev, play, next, last, flip);
    if (adapter.reveal && !live) {
      revealBtn = controlButton(
        revealed ? t('watch.hide', {}, locale) : t('watch.reveal', {}, locale),
        t('watch.revealHiddenIdentities', {}, locale),
      );
      revealBtn.title = t('watch.revealHiddenIdentitiesShortcut', {}, locale);
      revealBtn.onclick = toggleReveal;
      bar.append(revealBtn);
    }
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
      boardOrientation = boardOrientation === 'red' ? 'black' : 'red';
      sync();
    };

    // Append directly to root (no wrapper), exactly like the dark-chess watch, so
    // the header/boards/control-bar spacing and alignment are inherited.
    root.replaceChildren(header.el, layout, bar, plyLine);

    sync();
    scheduleAuto();
  };

  // Single-entry prefetch cache: the showcase cycler warms the next same-variant
  // game's postgame while the current one plays, so advancing is instant. A
  // mismatched or failed prefetch just falls back to a fresh fetch, so it can never
  // surface the wrong game (or hidden info — it fetches the exact same postgame the
  // load would).
  let prefetched: { roomId: string; promise: ReturnType<typeof adapter.loadPostgame> } | null =
    null;

  const load = async (nextId: string): Promise<void> => {
    clearTimer();
    activeId = nextId;
    let result: Awaited<ReturnType<typeof adapter.loadPostgame>>;
    if (options.loadPostgameOverride) {
      // Live-follow source. An empty override answer falls through to the
      // adapter's normal finished-game loader (the live→finished handoff).
      const overridden = await options
        .loadPostgameOverride(nextId)
        .catch(() => ({ ok: false as const }));
      if (overridden.ok) {
        result = { ok: true, postgame: overridden.postgame as Postgame };
      } else {
        result = await adapter.loadPostgame(nextId);
      }
      if (destroyed) return;
      if (!result.ok) {
        if (options.onLoadError?.()) return;
        const notice = document.createElement('p');
        notice.className = 'watch-empty';
        notice.textContent = t('watch.gameLoadFailed', {}, locale);
        root.replaceChildren(notice);
        return;
      }
      buildGame(result.postgame);
      return;
    }
    if (prefetched && prefetched.roomId === nextId) {
      const cached = prefetched.promise;
      prefetched = null;
      try {
        result = await cached;
      } catch {
        result = await adapter.loadPostgame(nextId);
      }
    } else {
      prefetched = null; // discard a stale prefetch (e.g. a jumpNow pool swap)
      result = await adapter.loadPostgame(nextId);
    }
    if (destroyed) return;
    if (!result.ok) {
      if (options.onLoadError?.()) return;
      const notice = document.createElement('p');
      notice.className = 'watch-empty';
      notice.textContent = t('watch.gameLoadFailed', {}, locale);
      root.replaceChildren(notice);
      return;
    }
    buildGame(result.postgame);
  };

  // Keyboard reveal toggle (`h`), only when the tenant supports reveal.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!adapter.reveal || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT')
    ) {
      return;
    }
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      toggleReveal();
    }
  };
  if (adapter.reveal && !compact) window.addEventListener('keydown', onKeydown);
  const onAppearance = (): void => sync();
  if (adapter.appearanceEvent) window.addEventListener(adapter.appearanceEvent, onAppearance);

  // The view entry (and board orientation) for a requested perspective, resolved
  // through the adapter's paneKind. Orient a side view to that side; truth keeps
  // the red/first orientation. Null when the loaded game has no such view.
  const povTarget = (
    kind: 'white' | 'truth' | 'black',
  ): { key: ViewKey; orientation: 'red' | 'black' } | null => {
    if (!activePostgame) return null;
    for (const entry of adapter.viewEntries(activePostgame)) {
      if (adapter.paneKind(entry.key) === kind) {
        return { key: entry.key, orientation: kind === 'black' ? 'black' : 'red' };
      }
    }
    return null;
  };

  await load(roomId);

  return {
    activeSampleId: () => activeId,
    destroy: () => {
      destroyed = true;
      clearTimer();
      if (clockTickTimer !== null) {
        window.clearInterval(clockTickTimer);
        clockTickTimer = null;
      }
      if (adapter.reveal && !compact) window.removeEventListener('keydown', onKeydown);
      if (adapter.appearanceEvent) {
        window.removeEventListener(adapter.appearanceEvent, onAppearance);
      }
      root.replaceChildren();
    },
    loadGame: async (sampleId: string) => {
      await load(sampleId);
    },
    plyCount: () => maxPly,
    // manualJump already pauses autoplay, clamps, and re-syncs (which fires
    // onPlyChange). The /watch move list + scrubber drive the board through it.
    jumpToPly: (ply: number) => manualJump(ply),
    moveEntries: () =>
      activePostgame ? buildTenantMoveEntries(activePostgame, adapter.moveLabel) : [],
    // The clocks the players actually had, reconstructed from the move timestamps. A live
    // game projects the server clock to now (so polling this ticks it down at real speed);
    // a replay reports the ply's recorded value and does not move between plies. Null (no
    // clock) for an untimed game.
    clockAtPly: () => {
      const toMove = toMoveAtPly();
      const liveNow = liveClockNow();
      if (liveNow) return { ...liveNow, toMove };
      if (!clockSeries) return null;
      const at = clockSeries[Math.min(currentPly, clockSeries.length - 1)];
      if (!at) return null;
      return { first: at.first, second: at.second, toMove };
    },
    // Re-point the single compact board at the view whose paneKind matches, then
    // re-render at the current ply (no glide: pov swap doesn't move the ply). A
    // kind the loaded game doesn't carry is a no-op. HIDDEN-INFO NOTE: watch only
    // serves COMPLETED games, so every per-side view is that player's own
    // now-public past view — showing it post-reveal leaks nothing new.
    setPov: (kind: 'white' | 'truth' | 'black') => {
      const target = povTarget(kind);
      if (!target || boardTargets.length === 0) return;
      boardTargets[0]!.key = target.key;
      boardOrientation = target.orientation;
      sync();
    },
    availablePovs: () => {
      if (!activePostgame) return [];
      const kinds = new Set<'white' | 'truth' | 'black'>();
      for (const entry of adapter.viewEntries(activePostgame)) {
        kinds.add(adapter.paneKind(entry.key));
      }
      return [...kinds];
    },
    prefetchGame: (nextId: string) => {
      if (destroyed || activeId === nextId || prefetched?.roomId === nextId) return;
      const promise = adapter.loadPostgame(nextId);
      // Swallow rejections so an unused/failed prefetch never becomes an unhandled
      // rejection; load() re-fetches on a cache miss anyway.
      void promise.catch(() => undefined);
      prefetched = { roomId: nextId, promise };
    },
    // Watch drives game selection through the queue; no internal auto-advance pool.
    updateLoopPool: () => {},
  };
}
