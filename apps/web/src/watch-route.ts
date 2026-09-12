import { type GameEvent, maybeGameSpecForId } from '@mistboard/game';
import { banqiResultLabel } from './banqi-result-label.js';
import { seatInkForVariant } from './flip-seat-ink.js';
import { createGameTable } from './game-table.js';
import { t } from './i18n/catalog.js';
import { jungleFlipResultLabel } from './jungle-flip-result-label.js';
import { renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';
import { variantMiniIdForRawVariant } from './variants.js';
import { boardAspectForSpec } from './watch-board-aspect.js';
import './watch-route.css';
import {
  displayLiveName,
  displayParticipantName,
  type FeaturedGame,
  type GameParticipant,
  matchupLabel,
  matchupSeats,
  participantForColor,
  sourceLabel,
  variantDisplayLabel,
} from './game-display.js';
import { gameMetaForGame, reviewUrlForGame, timeControlLabelForGame } from './game-meta.js';
import { initLiveSound, playSound } from './live-sound.js';
import { participantProfileTarget, playerNameEl, profileTargetFor } from './profile-link.js';
import type { GameMeta, ReplayHandle } from './replay.js';
import { renderWatchReplaySkeleton } from './replay-skeleton.js';
import {
  createGameMetaCard,
  type GameMetaPlayer,
  seatResultScores,
} from './review/game-meta-card.js';
import { createMoveList, type MoveList } from './review/move-list.js';
import { installReviewKeyboard } from './review/review-layout.js';
import { createReviewShell } from './review/review-shell.js';
import { showcaseRendererKindForSpec, specIdForShowcaseVariant } from './showcase-dispatch.js';
import { buildLoadingState, buildNav } from './site-shell.js';
import { buildUiIcon } from './ui-icon.js';
import { seatColorWord, seatInkFamily } from './variant-seat-label.js';
import { formatClock } from './web-utils.js';

// replay.js statically pulls in chessground (~64KB). Importing it dynamically
// keeps it out of watch-route's module-init path, so mountWatch can fire
// /api/watch before that bundle parses. loadReplayModule() is kicked off at the
// top of mountWatch to prefetch the chunk in parallel with the feed fetch, so
// the dynamic import costs no extra round trip by the time the board mounts.
let replayModulePromise: Promise<typeof import('./replay.js')> | null = null;
function loadReplayModule(): Promise<typeof import('./replay.js')> {
  replayModulePromise ??= import('./replay.js');
  return replayModulePromise;
}

type WatchChannelSummary = {
  family: string;
  gameSpecIds: string[];
  id: string;
  label: string;
  sealedCount: number;
  unlockedCount: number;
  // The headline seat for the rail row (name + rating), shown under the channel
  // name lichess-style. null/absent for an empty channel (name-only row).
  topPlayer?: { name: string; rating: number | null } | null;
};
type WatchInitialReplay = {
  events: GameEvent[];
  roomId: string;
};
type WatchFeed = {
  activeChannel: string;
  channels: WatchChannelSummary[];
  now: string;
  sealedActivityWindowMs?: number;
  unlockLimit: number;
  sealedCount: number;
  unlocked: FeaturedGame[];
  initialReplay?: WatchInitialReplay;
};

// Which replay renderer a game needs: a game spec id (the registry's unambiguous
// tenant key) or 'chess' (the chessground fallback for the unregistered dark-chess
// stack). It must NOT key on the coarse watch.family: jieqi and Dark Mini Xiangqi
// both render in the 'xiangqi' family, so a family key would resolve both to the
// same tenant. A switch across renderers must re-mount, not loadGame.
type WatchRendererKind = string;

// Resolve the renderer for the SELECTED GAME by its own variant, not the
// channel's — the Engines channel (and, later, a "Top" auto-channel) is
// cross-variant, so one channel can hold an xiangqi game and a chess game that
// need different renderers. Each game carries its variant; map it to a spec id
// the same way the homepage showcase cycler does, so the two dispatchers can't
// drift. A renderer switch across games re-mounts (chessground vs tenant SVG
// can't loadGame across). Falls back to the channel's primary spec only when the
// roomId is absent from the unlocked list (shouldn't happen post-hydrate).
export function watchRendererKindForGame(feed: WatchFeed, roomId: string): WatchRendererKind {
  const game = feed.unlocked.find((entry) => entry.roomId === roomId);
  if (game) return showcaseRendererKindForSpec(specIdForShowcaseVariant(game.variant));
  const channel = feed.channels.find((entry) => entry.id === feed.activeChannel);
  return showcaseRendererKindForSpec(channel?.gameSpecIds[0] ?? null);
}

// The board aspect ratio to reserve for a game while its renderer mounts. Same
// resolution order as watchRendererKindForGame: the game's own spec, falling
// back to the channel's primary spec (Featured/Engines carry none, so a
// cross-variant channel lands on the neutral square until the game is known).
export function boardAspectForWatchGame(feed: WatchFeed, roomId: string): number {
  const game = feed.unlocked.find((entry) => entry.roomId === roomId);
  if (game) return boardAspectForSpec(specIdForShowcaseVariant(game.variant));
  const channel = feed.channels.find((entry) => entry.id === feed.activeChannel);
  return boardAspectForSpec(channel?.gameSpecIds[0] ?? null);
}

const WATCH_ACTIVE_POLL_MS = 15_000;
const WATCH_IDLE_POLL_MS = 60_000;
// Featured live-follow poll: matches the homepage viewer's cadence so both
// surfaces advance the same live game on the same beat.
const LIVE_TV_TOP_POLL_MS = 4_000;
// Rail clock repaint rate. Matches the renderers' own clock ticks; the displayed mm:ss
// only changes about once a second, but a move's whole think can drain inside a ~700ms
// playback window, so the poll has to be finer than the digits it shows.
const WATCH_CLOCK_TICK_MS = 100;

// The featured LIVE game from /api/watch/live?channel=top (the cross-channel
// election). Mirrors landing-tv.ts's shape; the payload is the tenant's
// postgame-SHAPED live payload the watch renderers replay.
type LiveFeatured = {
  roomId: string;
  gameSpecId: string;
  ply: number;
  // `handle`/`botId` are the seat's linkable identity (LiveTvPlayer on the
  // server); at most one is ever set, and both are absent for a guest seat.
  players?: Array<{
    color: string;
    name: string | null;
    isEngine: boolean;
    handle?: string | null;
    botId?: string | null;
  }>;
  payload?: Record<string, unknown>;
};

// A live flip game's bound ink, read out of the postgame-shaped payload's view.
// The payload is `Record<string, unknown>` by contract (the renderers own its
// shape), so this narrows defensively: anything unexpected reads as unbound,
// which renders a neutral disc rather than a wrong one.
function liveFirstColor(featured: LiveFeatured): 'red' | 'black' | null {
  const view = (featured.payload as { view?: { firstColor?: unknown } } | undefined)?.view;
  const firstColor = view?.firstColor;
  return firstColor === 'red' || firstColor === 'black' ? firstColor : null;
}

export function shouldPlayWatchMoveSound(previousPly: number | null, nextPly: number): boolean {
  return previousPly !== null && nextPly === previousPly + 1;
}

// Ordering guard for user-initiated channel/game switches.
//
// Feed + replay chains resolve OUT OF ORDER: a channel seeded by initialReplay
// settles ~200ms sooner than one that has to fetch its own game payload. Without
// a guard an EARLIER click can therefore commit AFTER a later one and strand the
// user on the channel they just left. Reproduced deterministically on prod:
// Xiangqi then Fog Chess 130ms apart landed on xiangqi.
//
// `begin()` takes the newest token; `isCurrent(token)` is false once any later
// switch has begun. Every await inside a switch is followed by that check, and a
// superseded switch drops its result instead of painting or committing it.
export type WatchSwitchGuard = {
  begin: () => number;
  isCurrent: (token: number) => boolean;
};

export function createWatchSwitchGuard(): WatchSwitchGuard {
  // Tokens start at 1 so the counter's initial value is not a valid token: a
  // caller holding an unset/zeroed token must read as superseded, never as the
  // current switch.
  let latest = 0;
  return {
    begin: () => ++latest,
    isCurrent: (token: number) => token > 0 && token === latest,
  };
}

// Whether a cached channel feed is still reusable. Split out so the TTL rule is
// testable without a fetch: a feed exactly at the TTL boundary is stale, so the
// cache can never serve something older than the poll cadence.
export function watchFeedCacheIsFresh(cachedAt: number, now: number, ttlMs: number): boolean {
  return now - cachedAt < ttlMs;
}

// Queue thumbnails are secondary content. In particular, Jieqi postgames are
// projection-heavy, so starting two previews before the center board can make
// all three requests contend and delay the primary paint.
export async function loadWatchMainBeforePreviews(
  loadMain: () => Promise<void>,
  loadPreviews: () => void,
): Promise<void> {
  await loadMain();
  loadPreviews();
}

// What the right rail's contents center against. Normally the board: it is the
// tallest thing in the middle and the rail reads as its console. Banqi is 8x4,
// so its board is a ~300px stub while the middle column runs on through the
// previously-on strip, and centering on the board floats the clocks up past the
// board's own top edge. When the rail is taller than the board it has already
// outgrown that anchor, so switch to the whole middle column.
export function watchRailAnchor(boardHeight: number, railHeight: number): 'board' | 'column' {
  if (!(boardHeight > 0) || !(railHeight > 0)) return 'board';
  return railHeight > boardHeight ? 'column' : 'board';
}

export async function mountWatch(root: HTMLElement): Promise<void> {
  initLiveSound();
  root.replaceChildren();
  root.classList.add('landing-page', 'watch-route');
  root.append(buildNav(), buildLoadingState(t('watch.loadingReplays')));

  // Start downloading the replay/chessground chunk now, in parallel with the
  // feed fetch below, rather than serializing it behind /api/watch.
  void loadReplayModule();

  let currentFeed = await fetchWatchFeed().catch((err) => {
    console.warn(err);
    return null;
  });
  const watch = buildWatchSection(currentFeed);
  root.replaceChildren(buildNav(), watch.el);
  document.title = t('watch.pageTitle');

  const syncBoardHeight = (): void => {
    const height = watch.boardBox.getBoundingClientRect().height;
    if (height > 0) {
      watch.el.style.setProperty('--watch-board-height', `${height}px`);
    }
    // The column height is only consumed by the short-board anchor, but it is
    // measured unconditionally: the rail's own height is what decides, and that
    // changes with the move list, not with the board.
    const columnHeight = watch.centerColumn.getBoundingClientRect().height;
    if (columnHeight > 0) {
      watch.el.style.setProperty('--watch-center-height', `${columnHeight}px`);
    }
    // The rail box is height-constrained by CSS; its CONTENT keeps its natural
    // height and overflows, so this measurement does not feed back into itself.
    const railHeight = watch.railContent.getBoundingClientRect().height;
    watch.el.dataset.railAnchor = watchRailAnchor(height, railHeight);
  };
  let boardResizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    boardResizeObserver = new ResizeObserver(() => {
      if (!watch.el.isConnected) {
        boardResizeObserver?.disconnect();
        return;
      }
      syncBoardHeight();
    });
    boardResizeObserver.observe(watch.boardBox);
    boardResizeObserver.observe(watch.centerColumn);
    boardResizeObserver.observe(watch.railContent);
  }
  syncBoardHeight();

  let activeRoomId: string | null = null;
  let replayHandle: ReplayHandle | null = null;
  // Which renderer the live handle is: chess (chessground) vs xiangqi (native
  // SVG). A channel switch across families must re-mount, not loadGame.
  let replayHandleKind: WatchRendererKind | null = null;
  // Whether the mounted handle autoplays (baked at mount): feed-driven boards
  // are FROZEN at the final position (the TV model — finished games are never
  // auto-broadcast), while an explicit queue click plays that game once. A
  // mismatch between the two modes forces a re-mount.
  let replayHandleAutoplay = false;
  let pollTimer: number | null = null;
  let refreshInFlight = false;
  // Orders user-initiated switches so a slower earlier click can't win. See
  // createWatchSwitchGuard.
  const switchGuard = createWatchSwitchGuard();
  // Right-rail interactive move list + shared game-table controls. The move list
  // is rebuilt whenever the active game changes. `watchPly` / `watchMaxPly` track
  // the board's ply so the controls'
  // relative steps (prev/next) resolve without a live getter on the handle.
  let moveList: MoveList | null = null;
  // Rail clock rows, mounted per game and repainted by the ticker.
  let clockSeats: { top: HTMLElement; bottom: HTMLElement } | null = null;
  let clockTicker: number | null = null;
  let watchPly = 0;
  let watchMaxPly = 0;
  let lastSoundPly: number | null = null;
  let queuePreviewHandles: ReplayHandle[] = [];
  let queuePreviewKey = '';
  let queueRenderVersion = 0;
  const selectedRoomByChannel = new Map<string, string>();
  const metadataByRoomId: Record<string, GameMeta> = {};
  // First/second-mover names for the tenant compact seats (the tenant postgames
  // carry no player names), keyed by room id — same shape the homepage showcase
  // feeds its compact boards.
  const namesByRoomId: Record<string, { first: string; second: string }> = {};
  const abortController = new AbortController();

  // ── Featured channel live-follow ──────────────────────────────────────────
  // Only the cross-variant 'top' channel follows a LIVE game. It polls
  // /api/watch/live?channel=top and, when a game is featured, the center board
  // follows it ply-synced — exactly what the homepage viewer shows. With no live
  // game the channel is an ordinary cross-variant completed-replay channel (the
  // normal renderFeed path). This is a focused re-implementation of
  // landing-tv.ts's live half; both share the /api/watch/live server contract,
  // which owns all fog/hidden-identity redaction (this client only renders what
  // the fail-closed server elects).
  let liveActive = false;
  let liveRoomId: string | null = null;
  let liveShownPly = -1;
  let liveHandle: ReplayHandle | null = null;
  let livePayload: { roomId: string; payload: Record<string, unknown> } | null = null;
  let livePollTimer: number | null = null;
  const liveLoadPostgameOverride = async (
    roomId: string,
  ): Promise<{ ok: true; postgame: unknown } | { ok: false }> =>
    livePayload && livePayload.roomId === roomId
      ? { ok: true, postgame: livePayload.payload }
      : { ok: false };

  // Tear down the live board + its state without re-rendering (callers decide
  // what replaces it). Idempotent.
  const dropLiveBoard = (): void => {
    liveActive = false;
    liveRoomId = null;
    liveShownPly = -1;
    livePayload = null;
    liveHandle?.destroy();
    liveHandle = null;
    watch.el.classList.remove('watch-live-mode');
  };

  const renderQueue = (
    feed: WatchFeed | null,
    roomId: string | null,
    previousRoomIds: ReadonlySet<string> | null,
  ): void => {
    // Keyed off the rail's OWN list, which now excludes the board's game — so promoting a
    // rail game changes the key and forces a re-render. Keying off feed.unlocked instead
    // would hold the key steady across that click and strand the promoted game in the rail.
    const previewKey = feed
      ? `${feed.activeChannel}:${watchQueueGames(feed, roomId)
          .map((game) => game.roomId)
          .join('|')}`
      : 'unavailable';
    if (previewKey === queuePreviewKey && watch.queueRoot.childElementCount > 0) return;
    queuePreviewKey = previewKey;
    const version = ++queueRenderVersion;
    for (const handle of queuePreviewHandles) handle.destroy();
    queuePreviewHandles = [];
    const previews = renderWatchQueue(watch.queueRoot, feed, roomId, { previousRoomIds });
    if (!feed || previews.length === 0) return;

    void Promise.all(
      previews.map(async ({ game, root: previewRoot }) => {
        try {
          return await mountWatchQueuePreview(previewRoot, game, metadataByRoomId, namesByRoomId);
        } catch (err) {
          console.warn(err);
          renderWatchQueuePreviewError(previewRoot);
          return null;
        }
      }),
    ).then((handles) => {
      const mounted = handles.filter((handle): handle is ReplayHandle => handle !== null);
      if (version !== queueRenderVersion) {
        for (const handle of mounted) handle.destroy();
        return;
      }
      queuePreviewHandles = mounted;
    });
  };

  // Preserve tenant SVG proportions as their width-fixed boards re-render. This
  // lets xiangqi, banqi, jungle, and other rectangular variants determine their
  // own height instead of being letterboxed inside a common square.
  if (typeof MutationObserver !== 'undefined') {
    const centerTenantBoards = (): void => {
      for (const svg of watch.replayRoot.querySelectorAll<SVGElement>(
        '.replay-layout-solo .replay-board svg',
      )) {
        if (svg.getAttribute('preserveAspectRatio') !== 'xMidYMid meet') {
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
      }
    };
    new MutationObserver(centerTenantBoards).observe(watch.replayRoot, {
      childList: true,
      subtree: true,
    });
    centerTenantBoards();
  }

  // Jump the board through the active handle (pauses autoplay). The handle's
  // onPlyChange then fires syncMoveList, re-highlighting + re-bounding.
  const jumpBoardToPly = (ply: number): void => {
    replayHandle?.jumpToPly?.(clampPly(ply, watchMaxPly));
  };

  const moveScrubber = buildWatchScrubber(
    jumpBoardToPly,
    () => watchPly,
    () => watchMaxPly,
    watch.replayControlsRoot,
  );

  installReviewKeyboard(
    watchKeyboardHandlers(
      jumpBoardToPly,
      () => watchPly,
      () => watchMaxPly,
    ),
    abortController.signal,
  );

  // The rail clocks for the ply on the board: the times the players actually had there,
  // so scrubbing rewinds the clocks with the moves (lichess TV's anatomy — clock above the
  // top seat, clock below the bottom one). Seating matches renderWatchPlayers: second
  // mover on top, first mover below. An untimed game or a replay path without
  // clockAtPly leaves both slots empty rather than showing a fake 0:00.
  const clearClocks = (): void => {
    watch.clockTop.replaceChildren();
    watch.clockBottom.replaceChildren();
    clockSeats = null;
  };

  // Mounted once per game, then repainted in place: the ticker runs several times a
  // second, and rebuilding the rows each pass would churn the DOM (and any transition on
  // them) for two strings.
  const ensureClockSeats = (): { top: HTMLElement; bottom: HTMLElement } => {
    if (clockSeats) return clockSeats;
    const mount = (host: HTMLElement): HTMLElement => {
      const row = document.createElement('div');
      row.append(document.createElement('strong'));
      host.replaceChildren(row);
      return row;
    };
    clockSeats = { top: mount(watch.clockTop), bottom: mount(watch.clockBottom) };
    return clockSeats;
  };

  const syncClocks = (): void => {
    const readout = replayHandle?.clockAtPly?.() ?? null;
    if (!readout) {
      if (clockSeats) clearClocks();
      return;
    }
    const seats = ensureClockSeats();
    const paint = (row: HTMLElement, remainingMs: number, live: boolean): void => {
      const time = row.firstElementChild;
      const text = formatClock(remainingMs);
      if (time && time.textContent !== text) time.textContent = text;
      row.classList.toggle('active', live);
    };
    paint(seats.top, readout.second, readout.toMove === 'second');
    paint(seats.bottom, readout.first, readout.toMove === 'first');
  };

  // Poll the handle rather than having it push: both renderers already interpolate the
  // mover's clock across the move's playback window (chess walks its display instant
  // toward the next move's timestamp; the tenant path drains between ply snapshots), so
  // reading on an interval is all the rail needs to tick. Paused/scrubbed, the value is
  // constant and the repaint no-ops.
  const startClockTicker = (): void => {
    if (clockTicker !== null) return;
    clockTicker = window.setInterval(syncClocks, WATCH_CLOCK_TICK_MS);
  };

  const stopClockTicker = (): void => {
    if (clockTicker === null) return;
    window.clearInterval(clockTicker);
    clockTicker = null;
  };

  // Re-highlight the current move + refresh the scrubber bounds/status. Driven by
  // the handle's onPlyChange on every autoplay tick or manual jump.
  const syncMoveList = (ply: number, maxPly: number): void => {
    if (shouldPlayWatchMoveSound(lastSoundPly, ply)) playSound('move');
    lastSoundPly = ply;
    watchPly = ply;
    watchMaxPly = maxPly;
    moveList?.update(ply, jumpBoardToPly);
    moveScrubber.setBounds(ply, maxPly);
    if (moveScrubber.status)
      moveScrubber.status.textContent = maxPly > 0 ? `${ply} / ${maxPly}` : '';
    syncClocks();
  };

  const clearMoveList = (): void => {
    watch.movesRoot.replaceChildren();
    moveList = null;
    watchPly = 0;
    watchMaxPly = 0;
    // A different game's plies are not a continuation of this one's, so the
    // next seed must not read as "one move later" and fire the move sound.
    lastSoundPly = null;
    moveScrubber.setBounds(0, 0);
    stopClockTicker();
    clearClocks();
  };

  const clearPovToggle = (): void => {
    watch.povRoot.replaceChildren();
  };

  // (Re)build the fog-perspective toggle under the board for the freshly loaded
  // game. Shown only for asymmetric fog (dark) variants whose handle offers more
  // than one view; defaults to Truth (which it also pushes to the board), so a
  // channel/game switch always lands on Truth.
  const rebuildPovToggle = (feed: WatchFeed, roomId: string): void => {
    const game = feed.unlocked.find((entry) => entry.roomId === roomId) ?? null;
    renderWatchPovToggle(watch.povRoot, game, replayHandle);
  };

  // Rebuild the move list inside the shared room table from the freshly loaded
  // game's handle. A
  // handle that exposes neither jumpToPly nor plyCount (should not happen for the
  // watch renderers, but the methods are optional) hides the whole panel; a handle
  // with plyCount but no derivable move labels keeps the scrubber and drops the
  // list (empty move labels for that path).
  const rebuildMoveList = (handle: ReplayHandle, startPly: number): void => {
    clearMoveList();
    if (!handle.jumpToPly || !handle.plyCount) return;
    watchMaxPly = handle.plyCount();
    watchPly = clampPly(startPly, watchMaxPly);
    const entries = handle.moveEntries?.() ?? [];

    if (entries.length > 0) {
      moveList = createMoveList(entries);
      watch.movesRoot.append(moveList.el);
    }
    syncMoveList(watchPly, watchMaxPly);
    // Bounded to a loaded game: clearMoveList stops it, so the interval never outlives the
    // board it is drawing for.
    startClockTicker();
  };

  // Mount the right-kind replay handle, re-mounting when the family OR the
  // autoplay mode changes (autoplay is baked at mount); else reuse the handle
  // and just load the next game. Feed-driven boards (`autoplay: false`) land
  // FROZEN at the final position — the TV model never auto-broadcasts a
  // finished game; the scrubber/move list still replay it on demand. An
  // explicit queue click passes `autoplay: true` and plays that game once.
  const ensureReplay = async (
    feed: WatchFeed,
    roomId: string,
    seed: WatchInitialReplay | undefined,
    autoplay: boolean,
  ): Promise<void> => {
    const kind = watchRendererKindForGame(feed, roomId);
    if (!replayHandle || replayHandleKind !== kind || replayHandleAutoplay !== autoplay) {
      // Family change (e.g. switching the channel to Jieqi): the live
      // renderer can't load the new game, so it's torn down and a different
      // chunk + postgame are fetched — two round trips. Paint a skeleton in the
      // board slot up front so the area gives feedback instead of going blank
      // while the swap lands. Null the handle before the await so a failed
      // mount surfaces the empty state rather than a stale, destroyed handle.
      replayHandle?.destroy();
      replayHandle = null;
      replayHandleKind = null;
      // Size the skeleton to the board that is about to mount, so the slot
      // reserves the right box instead of collapsing to a square and growing
      // again when the real board lands.
      renderWatchReplaySkeleton(watch.replayRoot, boardAspectForWatchGame(feed, roomId));
      const mounted = await mountWatchReplay(
        watch.replayRoot,
        roomId,
        metadataByRoomId,
        namesByRoomId,
        seed,
        kind,
        syncMoveList,
        autoplay,
      );
      replayHandle = mounted;
      replayHandleKind = kind;
      replayHandleAutoplay = autoplay;
      seedWatchRail(mounted, autoplay, (startPly) => {
        rebuildMoveList(mounted, startPly);
      });
      rebuildPovToggle(feed, roomId);
      return;
    }
    if (replayHandle.activeSampleId() !== roomId) {
      const handle = replayHandle;
      await handle.loadGame(roomId);
      seedWatchRail(handle, autoplay, (startPly) => {
        rebuildMoveList(handle, startPly);
      });
      rebuildPovToggle(feed, roomId);
    }
  };

  const renderFeed = async (
    nextFeed: WatchFeed | null,
    previousFeed: WatchFeed | null,
    animateNewRows: boolean,
    options: { urlMode?: 'push' | 'replace' | false; switchToken?: number } = {},
  ): Promise<void> => {
    // A user-initiated switch passes its token; if a newer switch started while
    // this one was awaiting, this render is stale and must not touch the DOM.
    // The background poll passes none — it always renders the current channel.
    const superseded = (): boolean =>
      options.switchToken !== undefined && !switchGuard.isCurrent(options.switchToken);
    if (superseded()) return;
    const previousRoomIds =
      animateNewRows && previousFeed
        ? new Set(previousFeed.unlocked.map((game) => game.roomId))
        : null;
    mergeWatchMetadata(metadataByRoomId, namesByRoomId, nextFeed);
    renderWatchChannelList(watch.channelRoot, nextFeed);

    const isTopChannel = nextFeed?.activeChannel === 'top';
    // Leaving Top tears down any live board; its poll idles (gated on the active
    // channel below), and the completed-feed render repaints the board.
    if (!isTopChannel && liveActive) dropLiveBoard();
    // On Top with a live game in progress the live board OWNS the center slot:
    // refresh the rail + "Previously on" queue (completed games only) but leave
    // the live board and its meta untouched.
    if (isTopChannel && liveActive && nextFeed) {
      renderQueue(nextFeed, null, previousRoomIds);
      currentFeed = nextFeed;
      if (options.urlMode) syncWatchUrl(options.urlMode, nextFeed.activeChannel, null);
      return;
    }

    if (!nextFeed || nextFeed.unlocked.length === 0) {
      replayHandle?.destroy();
      replayHandle = null;
      replayHandleKind = null;
      activeRoomId = null;
      clearMoveList();
      clearPovToggle();
      renderWatchEmptyState(watch.replayRoot, nextFeed);
      renderWatchActiveGame(watch, nextFeed, activeRoomId);
      renderQueue(nextFeed, activeRoomId, previousRoomIds);
      currentFeed = nextFeed;
      if (options.urlMode && nextFeed) {
        syncWatchUrl(options.urlMode, nextFeed.activeChannel, activeRoomId);
      }
      return;
    }

    const nextRoomId = resolveWatchRoomId(nextFeed, activeRoomId, selectedRoomByChannel);
    const priorRoomId = activeRoomId;
    activeRoomId = nextRoomId;
    selectedRoomByChannel.set(nextFeed.activeChannel, nextRoomId);
    renderWatchActiveGame(watch, nextFeed, activeRoomId);

    try {
      await loadWatchMainBeforePreviews(
        async () => {
          // Re-checked here because the channel list + meta card above paint
          // synchronously, but the mount is the expensive await: a switch that
          // was superseded during its feed fetch must not also pay for a board
          // nobody asked for.
          if (superseded()) return;
          await ensureReplay(nextFeed, nextRoomId, nextFeed.initialReplay, false);
        },
        () => {
          if (superseded()) return;
          renderQueue(nextFeed, activeRoomId, previousRoomIds);
        },
      );
    } catch (err) {
      console.warn(err);
      if (superseded()) return;
      activeRoomId = priorRoomId;
      if (!replayHandle) renderWatchEmptyState(watch.replayRoot, null);
      renderWatchActiveGame(watch, nextFeed, activeRoomId);
      renderQueue(nextFeed, activeRoomId, null);
      return;
    }

    // The commit point. A superseded switch stops here rather than writing its
    // channel into currentFeed + the URL, which is the bug users saw: click B,
    // wait, land back on A because A's slower chain finished last.
    if (superseded()) return;
    currentFeed = nextFeed;
    if (options.urlMode) {
      syncWatchUrl(options.urlMode, nextFeed.activeChannel, activeRoomId);
    }
  };

  const clearPollTimer = (): void => {
    if (pollTimer === null) return;
    window.clearTimeout(pollTimer);
    pollTimer = null;
  };

  const pollDelay = (feed: WatchFeed | null): number =>
    feed && feed.sealedCount > 0 ? WATCH_ACTIVE_POLL_MS : WATCH_IDLE_POLL_MS;

  const refreshFeed = async (): Promise<void> => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      // The poll is the cache's refresh mechanism, so it always goes to the
      // network — serving it from the cache would freeze the rail at whatever
      // the last click fetched.
      const nextFeed = await fetchWatchFeed(undefined, { force: true });
      const previousFeed = currentFeed;
      await renderFeed(nextFeed, previousFeed, true);
    } catch (err) {
      console.warn(err);
      if (!currentFeed && !replayHandle) {
        await renderFeed(null, null, false);
      }
    } finally {
      refreshInFlight = false;
      clearPollTimer();
      if (!document.hidden) {
        pollTimer = window.setTimeout(() => void refreshFeed(), pollDelay(currentFeed));
      }
    }
  };

  const handleVisibilityChange = (): void => {
    clearPollTimer();
    if (!document.hidden) void refreshFeed();
  };

  const handleNavigationClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    const link = target?.closest<HTMLAnchorElement>('a.watch-queue-row, a.watch-channel-link');
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/watch') return;

    event.preventDefault();
    const channel = url.searchParams.get('channel');
    const roomId = url.searchParams.get('game');
    if (link.classList.contains('watch-channel-link')) {
      void switchWatchChannel(channel, 'push');
      return;
    }
    if (roomId) void switchWatchGame(roomId, 'push');
  };

  // Warm the feed cache on press, before the click resolves. The feed fetch is
  // the first hop of the switch chain and the only one that can start without
  // knowing anything else, so paying it ~100ms early (the press-to-release gap)
  // takes a whole round trip off the visible switch. Cache-only: it never
  // renders, so a press the user aborts costs one request and no UI change.
  const handleNavigationPrefetch = (event: Event): void => {
    const target = event.target as Element | null;
    const link = target?.closest<HTMLAnchorElement>('a.watch-channel-link');
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/watch') return;
    void prefetchWatchFeed(url.searchParams.get('channel'));
  };

  const switchWatchChannel = async (
    channelId: string | null,
    urlMode: 'push' | 'replace',
  ): Promise<void> => {
    const token = switchGuard.begin();
    try {
      const nextFeed = await fetchWatchFeed(channelId);
      if (!switchGuard.isCurrent(token)) return;
      await renderFeed(nextFeed, currentFeed, true, { urlMode, switchToken: token });
    } catch (err) {
      console.warn(err);
    }
  };

  const switchWatchGame = async (roomId: string, urlMode: 'push' | 'replace'): Promise<void> => {
    const feed = currentFeed;
    if (!feed?.unlocked.some((game) => game.roomId === roomId)) return;
    // Deliberately picking a completed game on Top hands the board back from the
    // live feed to a VOD; the live poll may re-air a live game on a later tick.
    if (liveActive) dropLiveBoard();
    if (roomId === activeRoomId) {
      syncWatchUrl(urlMode, feed.activeChannel, activeRoomId);
      return;
    }
    // Shares the channel switch's ordering token: a queue-row click and a
    // channel click compete for the same board, so the newest press wins
    // regardless of which kind it was.
    const token = switchGuard.begin();
    const previousRoomId = activeRoomId;
    activeRoomId = roomId;
    selectedRoomByChannel.set(feed.activeChannel, roomId);
    renderWatchActiveGame(watch, feed, activeRoomId);
    try {
      // User-initiated: play the clicked game once (VOD semantics, not broadcast).
      await loadWatchMainBeforePreviews(
        async () => {
          if (!switchGuard.isCurrent(token)) return;
          await ensureReplay(feed, roomId, feed.initialReplay, true);
        },
        // The rail swaps rather than restyles after the center board is ready:
        // the promoted game leaves it and the outgoing one takes a slot.
        () => {
          if (!switchGuard.isCurrent(token)) return;
          renderQueue(feed, activeRoomId, null);
        },
      );
      if (!switchGuard.isCurrent(token)) return;
      syncWatchUrl(urlMode, feed.activeChannel, activeRoomId);
    } catch (err) {
      console.warn(err);
      if (!switchGuard.isCurrent(token)) return;
      activeRoomId = previousRoomId;
      renderWatchActiveGame(watch, feed, activeRoomId);
      renderQueue(feed, activeRoomId, null);
    }
  };

  const handlePopState = (): void => {
    const channel = watchChannelFromLocation();
    const currentChannel = currentFeed?.activeChannel ?? null;
    if (channel !== currentChannel) {
      void switchWatchChannel(channel, 'replace');
      return;
    }
    const roomId = watchRoomFromLocation();
    if (roomId) void switchWatchGame(roomId, 'replace');
  };

  // ── Featured live-follow: poll the cross-channel election and drive the board ──
  const registerLiveNames = (featured: LiveFeatured): void => {
    const players = featured.players ?? [];
    if (players.length < 2 || namesByRoomId[featured.roomId]) return;
    const first = players.find((p) => p.color === 'red' || p.color === 'white') ?? players[0]!;
    const second = players.find((p) => p !== first) ?? players[1]!;
    namesByRoomId[featured.roomId] = {
      first: displayLiveName(first.name, t('watch.guest')),
      second: displayLiveName(second.name, t('watch.guest')),
    };
  };

  // The featured live game's seats as meta players, first mover (red/white) first
  // so the rows seat like every other watch board. Live payloads carry no
  // ratings, so the rows are name + BOT only. A flip variant's ink is read off the
  // live payload's view (the same `firstColor` the finished feed rows carry), and
  // is legitimately null for the first ply or two — before the opening flip binds,
  // nobody owns a color yet.
  const liveMetaPlayers = (featured: LiveFeatured): GameMetaPlayer[] => {
    const players = featured.players ?? [];
    const first = players.find((p) => p.color === 'red' || p.color === 'white') ?? players[0];
    const ordered = first ? [first, ...players.filter((p) => p !== first)] : players;
    const firstColor = liveFirstColor(featured);
    return ordered.map((p) => ({
      color: seatInkForVariant(featured.gameSpecId, p.color, firstColor),
      name: displayLiveName(p.name, t('watch.guest')),
      rating: null,
      isEngine: p.isEngine,
      profile: profileTargetFor(p),
    }));
  };

  // Left meta card + right-rail seat rows + LIVE badge for the featured game.
  const renderLiveMeta = (featured: LiveFeatured): void => {
    const players = liveMetaPlayers(featured);
    const variantName = variantDisplayLabel(featured.gameSpecId);
    setWatchSeatInkFamily(watch, featured.gameSpecId ?? null);
    renderWatchMainReviewLink(watch.reviewLink, null);
    watch.metaRoot.replaceChildren();
    const badge = document.createElement('div');
    badge.className = 'watch-live-badge';
    badge.textContent = t('watch.liveBadge');
    const card = createGameMetaCard({
      markerId: variantMiniIdForRawVariant(featured.gameSpecId) ?? undefined,
      headline: [t('watch.inProgress')],
      variantName,
      players,
      status: null,
    });
    watch.metaRoot.append(badge, card.el);
    watch.gameTableRoot.hidden = false;
    renderWatchHeadline(watch.headlineRoot, {
      matchup: playersMatchupLabel(players),
      detail: `${t('watch.liveBadge')} · ${variantName}`,
    });
    renderWatchPlayerRows(watch.playerTop, watch.playerBottom, players);
  };

  const enterLive = async (featured: LiveFeatured): Promise<void> => {
    if (!featured.payload) return; // need a payload to mount; the next poll carries one
    registerLiveNames(featured);
    livePayload = { roomId: featured.roomId, payload: featured.payload };
    renderWatchMainReviewLink(watch.reviewLink, null);
    // The live board takes the center slot from the completed-feed board.
    replayHandle?.destroy();
    replayHandle = null;
    replayHandleKind = null;
    clearMoveList();
    clearPovToggle();
    activeRoomId = null;
    renderWatchReplaySkeleton(watch.replayRoot);
    liveHandle = await mountWatchReplay(
      watch.replayRoot,
      featured.roomId,
      metadataByRoomId,
      namesByRoomId,
      undefined,
      showcaseRendererKindForSpec(featured.gameSpecId),
      undefined,
      false,
      { loadPostgameOverride: liveLoadPostgameOverride },
    );
    liveHandle.jumpToPly?.(liveHandle.plyCount?.() ?? 0);
    liveActive = true;
    liveRoomId = featured.roomId;
    liveShownPly = featured.ply;
    watch.el.classList.add('watch-live-mode');
    renderLiveMeta(featured);
    renderQueue(currentFeed, null, null);
    // Top always follows the CURRENT top game, so the shareable URL is
    // channel-only — drop any stale ?game= the completed-feed render left.
    syncWatchUrl('replace', currentFeed?.activeChannel ?? 'top', null);
  };

  const updateLive = async (featured: LiveFeatured): Promise<void> => {
    registerLiveNames(featured);
    if (featured.payload) livePayload = { roomId: featured.roomId, payload: featured.payload };
    if (featured.ply > liveShownPly && featured.payload && liveHandle) {
      await liveHandle.loadGame(featured.roomId);
      liveHandle.jumpToPly?.(liveHandle.plyCount?.() ?? 0);
      liveShownPly = featured.ply;
      renderLiveMeta(featured);
    }
  };

  // The live game ended (or vanished): drop the live board and fall back to the
  // completed cross-variant feed for the Top channel.
  const exitLive = async (): Promise<void> => {
    dropLiveBoard();
    // Repaint the completed cross-variant board and refresh the URL to whatever
    // game it lands on (the live game just finished; its ?game= is now valid).
    await renderFeed(currentFeed, currentFeed, false, { urlMode: 'replace' });
  };

  let liveTickInFlight = false;
  const liveTick = async (): Promise<void> => {
    if (abortController.signal.aborted || liveTickInFlight) return;
    // Only the Top channel follows live; other channels leave the board to the
    // feed poll. Hidden tabs skip the fetch (the reschedule keeps ticking).
    if (currentFeed?.activeChannel !== 'top' || document.hidden) return;
    liveTickInFlight = true;
    try {
      const query =
        liveActive && liveRoomId
          ? `?channel=top&room=${encodeURIComponent(liveRoomId)}&ply=${liveShownPly}`
          : '?channel=top';
      const resp = await fetch(`/api/watch/live${query}`);
      if (resp.ok) {
        const data = (await resp.json()) as { featured: LiveFeatured | null };
        if (data.featured) {
          if (liveActive && data.featured.roomId === liveRoomId) await updateLive(data.featured);
          else await enterLive(data.featured);
        } else if (liveActive) {
          await exitLive();
        }
      }
    } catch {
      // Transient network failure: keep whatever is on the board.
    } finally {
      liveTickInFlight = false;
    }
  };

  const scheduleLivePoll = (): void => {
    livePollTimer = window.setTimeout(async () => {
      if (!watch.el.isConnected || abortController.signal.aborted) return;
      await liveTick();
      scheduleLivePoll();
    }, LIVE_TV_TOP_POLL_MS);
  };

  document.addEventListener('visibilitychange', handleVisibilityChange, {
    signal: abortController.signal,
  });
  window.addEventListener('popstate', handlePopState, { signal: abortController.signal });
  watch.el.addEventListener('click', handleNavigationClick, { signal: abortController.signal });
  // pointerdown (not mouseenter): hover-prefetching ten rail channels would fire
  // ten feed requests for a cursor crossing the rail. A press is an actual
  // intent signal and still lands ~100ms before the click.
  watch.el.addEventListener('pointerdown', handleNavigationPrefetch, {
    signal: abortController.signal,
  });
  abortController.signal.addEventListener('abort', () => {
    if (livePollTimer !== null) window.clearTimeout(livePollTimer);
    dropLiveBoard();
  });
  await renderFeed(currentFeed, null, false, { urlMode: 'replace' });
  if (!document.hidden) {
    pollTimer = window.setTimeout(() => void refreshFeed(), pollDelay(currentFeed));
  }
  scheduleLivePoll();
}

async function mountWatchQueuePreview(
  root: HTMLElement,
  game: FeaturedGame,
  metadataByRoomId: Record<string, GameMeta>,
  namesByRoomId: Record<string, { first: string; second: string }>,
): Promise<ReplayHandle> {
  const { mountShowcaseBoard } = await import('./showcase-board.js');
  const handle = await mountShowcaseBoard(
    root,
    specIdForShowcaseVariant(game.variant),
    game.roomId,
    {
      autoplay: false,
      loaderForId: apiEventLoader,
      metadataByRoomId,
      namesByRoomId,
      pov: 'white',
      revealOnFinish: true,
      hideReserve: true,
    },
  );
  handle.setPov?.('truth');
  handle.jumpToPly?.(handle.plyCount?.() ?? game.plyCount);
  return handle;
}

function renderWatchQueuePreviewError(root: HTMLElement): void {
  root.replaceChildren();
  const message = document.createElement('span');
  message.className = 'watch-queue-preview-error';
  message.textContent = t('watch.finalPositionUnavailable');
  root.append(message);
}

// LIVE-follow mount option for the Featured channel: the tenant renderer draws
// an IN-PROGRESS game from the /api/watch/live payload (served through
// loadPostgameOverride) instead of a finished-game endpoint, and suppresses the
// end-of-game marks at the final known ply. Only the tenant path honors it — no
// chess-stack spec is live-observable (the live election is fail-closed on fog).
type WatchLiveMountOptions = {
  loadPostgameOverride: (
    roomId: string,
  ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
};

async function mountWatchReplay(
  root: HTMLElement,
  roomId: string,
  metadataByRoomId: Record<string, GameMeta>,
  namesByRoomId: Record<string, { first: string; second: string }>,
  seed?: WatchInitialReplay,
  kind: WatchRendererKind = 'chess',
  onPlyChange?: (ply: number, maxPly: number) => void,
  autoplay = false,
  live?: WatchLiveMountOptions,
): Promise<ReplayHandle> {
  // Playback ends exactly once: onGameEnd holds the final position instead of
  // the renderers' default loop (the TV model — a game never replays once
  // aired; the scrubber remains for manual review).
  const holdAtEnd = (): void => {};
  // Tenant renderers load through the registry's dynamic-import closures, so
  // they stay out of the chess path's bundle. `kind` is the channel's spec id
  // (chess uses the chessground fallback below), so the tenant resolves
  // unambiguously even when two channels share a render family. Compact mode is
  // the homepage-showcase single-board layout (.replay-layout-solo); watch CSS
  // makes it width-driven so each variant keeps its natural height.
  const tenant = kind === 'chess' ? null : webVariantTenantForSpecId(kind);
  if (tenant?.watch) {
    return await tenant.watch.mountReplay(root, roomId, {
      autoplay,
      compact: true,
      metadataByRoomId,
      namesByRoomId,
      onGameEnd: holdAtEnd,
      onPlyChange,
      ...(live ? { live: true, loadPostgameOverride: live.loadPostgameOverride } : {}),
    });
  }
  // Chess (chessground): fog channels (dark-chess, reveal-chess, kriegspiel,
  // dark-crazyhouse). Watch only ever serves COMPLETED games, so the middle
  // "Truth" pane is the fully public final-and-throughout board — no hidden-info
  // leak. Render the triptych compact but let watch-route.css isolate the truth
  // pane into the board slot (the panes resolver can only pick a fogged white/
  // black POV, so truth-only is a CSS concern).
  const { mountReplay } = await loadReplayModule();
  return await mountReplay(root, roomId, {
    autoplay,
    showControls: false,
    keyboardNav: false,
    revealOnFinish: false,
    clampPace: true,
    metadataMode: 'compact',
    showCaptures: false,
    hideGameIdPill: true,
    loaderForId: makeWatchEventLoader(seed),
    metadataByRoomId,
    onGameEnd: holdAtEnd,
    onPlyChange,
  });
}

// The initial replay's events ride along in the /api/watch response, so the
// first board paints pieces without a second round trip. The seed is consumed
// once: a later reload of the same game (after polling or queue navigation)
// refetches fresh events, and every other game uses the per-game loader.
function makeWatchEventLoader(seed?: WatchInitialReplay): (roomId: string) => Promise<GameEvent[]> {
  let pending = seed;
  return async (roomId: string) => {
    if (pending && pending.roomId === roomId) {
      const events = pending.events;
      pending = undefined;
      return events;
    }
    return apiEventLoader(roomId);
  };
}

// How long a fetched channel feed stays reusable. Sized under the ACTIVE poll
// (15s) so a cached feed can never be older than the refresh cadence the page
// already accepts, and long enough that browsing the rail — the click-through
// pattern this cache exists for — reuses rather than refetches. Completed-game
// feeds are the only thing cached; the live board has its own 4s poll and never
// reads this.
export const WATCH_FEED_CACHE_MS = 12_000;

type CachedWatchFeed = { at: number; feed: WatchFeed };

// Per-channel feed cache + in-flight dedupe, keyed by the resolved channel id.
// The dedupe half matters as much as the cache: a pointerdown prefetch and the
// click it precedes would otherwise fire the same request twice.
const watchFeedCache = new Map<string, CachedWatchFeed>();
const watchFeedInFlight = new Map<string, Promise<WatchFeed>>();

function watchFeedCacheKey(channel: string | null): string {
  return channel ?? '';
}

// Exported for tests and for the poll, which must always hit the network.
export function invalidateWatchFeedCache(): void {
  watchFeedCache.clear();
}

async function requestWatchFeed(channel: string | null): Promise<WatchFeed> {
  const url = channel ? `/api/watch?channel=${encodeURIComponent(channel)}` : '/api/watch';
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`failed to load watch feed: ${resp.status}`);
  return (await resp.json()) as WatchFeed;
}

// One fetch per (channel, in-flight window), with the result cached for
// WATCH_FEED_CACHE_MS. `force` bypasses the cache but still joins an in-flight
// request — the poll uses it so a refresh is never served a stale body.
async function fetchWatchFeed(
  channelOverride?: string | null,
  options: { force?: boolean } = {},
): Promise<WatchFeed> {
  const channel = channelOverride ?? watchChannelFromLocation();
  const key = watchFeedCacheKey(channel);
  const now = Date.now();
  if (!options.force) {
    const cached = watchFeedCache.get(key);
    if (cached && now - cached.at < WATCH_FEED_CACHE_MS) return cached.feed;
  }
  const inFlight = watchFeedInFlight.get(key);
  if (inFlight) return await inFlight;

  const pending = requestWatchFeed(channel)
    .then((feed) => {
      watchFeedCache.set(key, { at: Date.now(), feed });
      return feed;
    })
    .finally(() => {
      watchFeedInFlight.delete(key);
    });
  watchFeedInFlight.set(key, pending);
  return await pending;
}

// Warm the cache without rendering. Errors are swallowed: a failed prefetch must
// be indistinguishable from never having prefetched, and the click that follows
// will surface the real failure through its own path.
async function prefetchWatchFeed(channelOverride?: string | null): Promise<void> {
  try {
    await fetchWatchFeed(channelOverride);
  } catch {
    // Prefetch is best-effort by design.
  }
}

async function apiEventLoader(roomId: string): Promise<GameEvent[]> {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) throw new Error(`failed to load events for ${roomId}: ${resp.status}`);
  const data = (await resp.json()) as { events: GameEvent[] };
  return data.events;
}

function mergeWatchMetadata(
  target: Record<string, GameMeta>,
  namesTarget: Record<string, { first: string; second: string }>,
  feed: WatchFeed | null | undefined,
): void {
  if (!feed) return;
  for (const game of feed.unlocked) {
    target[game.roomId] = gameMetaForGame(game);
    // First/second-mover names for the tenant compact seats, resolved through the
    // shared seat model (red/black for xiangqi + jungle, white/black
    // otherwise). The chess path reads names from metadataByRoomId.
    const [firstSeat, secondSeat] = matchupSeats(game);
    namesTarget[game.roomId] = {
      first: displayParticipantName(game, firstSeat),
      second: displayParticipantName(game, secondSeat),
    };
  }
}

function resolveWatchRoomId(
  feed: WatchFeed,
  activeRoomId: string | null,
  selectedRoomByChannel: ReadonlyMap<string, string>,
): string {
  const roomIds = new Set(feed.unlocked.map((game) => game.roomId));
  const candidates = [
    selectedRoomByChannel.get(feed.activeChannel),
    activeRoomId,
    watchRoomFromLocation(),
    feed.unlocked[0]?.roomId,
  ];
  for (const candidate of candidates) {
    if (candidate && roomIds.has(candidate)) return candidate;
  }
  return feed.unlocked[0]!.roomId;
}

function watchChannelFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('channel');
}

function watchRoomFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get('game');
}

function syncWatchUrl(mode: 'push' | 'replace', channelId: string, roomId: string | null): void {
  const params = new URLSearchParams();
  params.set('channel', channelId);
  if (roomId) params.set('game', roomId);
  const nextUrl = `/watch?${params.toString()}`;
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (nextUrl === currentUrl) return;
  const method = mode === 'push' ? 'pushState' : 'replaceState';
  window.history[method](null, '', nextUrl);
}

function clampPly(ply: number, maxPly: number): number {
  return Math.max(0, Math.min(maxPly, ply));
}

type WatchScrubber = {
  el: HTMLElement;
  status: HTMLElement | null;
  setBounds(ply: number, maxPly: number): void;
};

// First / prev / next / last playback behavior. Production binds this to the
// shared room table's replay controls; the standalone fallback keeps the helper
// directly testable. No play/pause: the TV autoplays and a manual jump pauses it.
// `getPly` / `getMaxPly` read the live board ply at click time (the handle has
// no ply getter), so relative steps resolve correctly after any jump.
export function buildWatchScrubber(
  jump: (ply: number) => void,
  getPly: () => number,
  getMaxPly: () => number,
  sharedControls?: HTMLElement,
): WatchScrubber {
  const el = sharedControls ?? document.createElement('div');
  let status: HTMLElement | null = null;
  let first: HTMLButtonElement;
  let prev: HTMLButtonElement;
  let next: HTMLButtonElement;
  let last: HTMLButtonElement;
  if (sharedControls) {
    first = requiredWatchControl(sharedControls, 'first');
    prev = requiredWatchControl(sharedControls, 'prev');
    next = requiredWatchControl(sharedControls, 'next');
    last = requiredWatchControl(sharedControls, 'latest');
  } else {
    el.className = 'review-scrubber';
    status = document.createElement('span');
    status.className = 'review-scrubber__status';
    status.setAttribute('aria-live', 'polite');
    first = watchScrubButton('|<', t('watch.firstMove'));
    prev = watchScrubButton('<', t('watch.previousMove'));
    next = watchScrubButton('>', t('watch.nextMove'));
    last = watchScrubButton('>|', t('watch.lastMove'));
    el.append(status, first, prev, next, last);
  }
  first.addEventListener('click', () => jump(0));
  prev.addEventListener('click', () => jump(getPly() - 1));
  next.addEventListener('click', () => jump(getPly() + 1));
  last.addEventListener('click', () => jump(getMaxPly()));
  return {
    el,
    status,
    setBounds(ply, maxPly) {
      first.disabled = ply <= 0;
      prev.disabled = ply <= 0;
      next.disabled = ply >= maxPly;
      last.disabled = ply >= maxPly;
    },
  };
}

// Arrow keys drive the same jump the on-screen controls do, so TV steps like the
// review page (lichess parity: the keys work anywhere on the page, not only
// while a control is focused). `enabled` stands the listener down when there is
// nothing to step through: the live-follow board and the empty state both
// leave maxPly at 0, and swallowing the arrows there would kill page scrolling
// for nothing. No `flip`: TV's only orientation control is the fog POV toggle.
export function watchKeyboardHandlers(
  jump: (ply: number) => void,
  getPly: () => number,
  getMaxPly: () => number,
): Parameters<typeof installReviewKeyboard>[0] {
  return {
    enabled: () => getMaxPly() > 0,
    stepBack: () => jump(getPly() - 1),
    stepForward: () => jump(getPly() + 1),
    toStart: () => jump(0),
    toEnd: () => jump(getMaxPly()),
  };
}

// Bind a freshly loaded game to the rail. A feed-driven board mounts FROZEN at
// its last ply, so the rail has to be seeded with that ply, not zero: the
// scrubber has no getter on the handle and derives prev/next/first/last purely
// from the number it was last told. Seeded at zero against a board sitting at
// the end, |< and < come up disabled on a finished game (you cannot rewind
// without clicking a move) and > jumps to ply 1. The jump and the seed are done
// together here so they cannot drift apart again.
export function seedWatchRail(
  handle: Pick<ReplayHandle, 'jumpToPly' | 'plyCount'>,
  autoplay: boolean,
  bind: (startPly: number) => void,
): void {
  const startPly = autoplay ? 0 : (handle.plyCount?.() ?? 0);
  if (!autoplay) handle.jumpToPly?.(startPly);
  bind(startPly);
}

function requiredWatchControl(root: HTMLElement, action: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`[data-replay="${action}"]`);
  if (!button) throw new Error(`missing shared watch control: ${action}`);
  return button;
}

function watchScrubButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-scrubber__button';
  button.setAttribute('aria-label', label);
  button.textContent = text;
  return button;
}

// Whether the fog-perspective toggle applies to a variant: only asymmetric fog
// (`visibility: 'dark'`) games have distinct per-side views worth switching
// between. Symmetric-mask hidden-identity (jieqi/banqi/jungle-flip/reveal-chess)
// and open variants render a single board and get no toggle.
export function watchPovToggleApplies(variant: string): boolean {
  return maybeGameSpecForId(variant)?.visibility === 'dark';
}

// The color words for the two side-perspective buttons, from the variant's
// family: the chess family reads White/Black; every other family (xiangqi,
// jungle, shogi, …) reads Red vs its second-seat word — "Blue" for
// the Jungle family, "Black" elsewhere (see variant-seat-label.ts). paneKind
// 'white' is the first/red/white seat, 'black' the second.
function watchPovSideLabels(variant: string): { first: string; second: string } {
  const family = maybeGameSpecForId(variant)?.family;
  return family === 'chess'
    ? { first: t('setup.white'), second: t('setup.black') }
    : { first: t('setup.red'), second: seatColorWord(variant, 'black') };
}

// Render the fog-perspective segmented control under the board for a dark game,
// or clear the slot. Buttons: [<first>'s view] [Truth] [<second>'s view], mapped
// to handle.setPov('white'|'truth'|'black'). Defaults to Truth and pushes that
// perspective to the board, so every (re)build lands on Truth. Non-dark games,
// a handle without setPov/availablePovs, or a single-view game render nothing.
function renderWatchPovToggle(
  root: HTMLElement,
  game: FeaturedGame | null,
  handle: ReplayHandle | null,
): void {
  root.replaceChildren();
  if (!game || !handle?.setPov) return;
  if (!watchPovToggleApplies(game.variant)) return;
  const povs = handle.availablePovs?.() ?? [];
  if (povs.length <= 1) return;

  const labels = watchPovSideLabels(game.variant);
  // Compact single-word perspective labels (the side's color); "Truth" in the
  // middle frames all three as perspectives. Full "X's view" phrasing overflowed
  // the height-capped board width into an ellipsis.
  const options: Array<{ kind: 'white' | 'truth' | 'black'; label: string }> = [
    { kind: 'white', label: labels.first },
    { kind: 'truth', label: t('watch.truth') },
    { kind: 'black', label: labels.second },
  ];

  const group = document.createElement('div');
  group.className = 'watch-pov';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', t('watch.boardPerspective'));

  const buttons: HTMLButtonElement[] = [];
  const select = (kind: 'white' | 'truth' | 'black'): void => {
    handle.setPov?.(kind);
    for (const button of buttons) {
      const active = button.dataset.pov === kind;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  for (const option of options) {
    if (!povs.includes(option.kind)) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'watch-pov__button';
    button.dataset.pov = option.kind;
    button.textContent = option.label;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => select(option.kind));
    buttons.push(button);
    group.append(button);
  }

  root.append(group);
  // Default the board (and the control) to Truth on every (re)build.
  select('truth');
}

type WatchSection = {
  el: HTMLElement;
  metaRoot: HTMLElement;
  headlineRoot: HTMLElement;
  channelRoot: HTMLElement;
  replayRoot: HTMLElement;
  reviewLink: HTMLAnchorElement;
  povRoot: HTMLElement;
  queueRoot: HTMLElement;
  gameTableRoot: HTMLElement;
  playerBottom: HTMLElement;
  playerTop: HTMLElement;
  // The shared table's clock slots, seated like the player rows: second mover on top,
  // first mover below. Driven per ply from the replay handle's clockAtPly.
  clockTop: HTMLElement;
  clockBottom: HTMLElement;
  movesRoot: HTMLElement;
  replayControlsRoot: HTMLElement;
  boardBox: HTMLElement;
  // The whole middle column (board + pov slot + previously-on strip) and the
  // right rail's own content box, both measured to decide what the rail centers
  // against. See watchRailAnchor.
  centerColumn: HTMLElement;
  railContent: HTMLElement;
};

// The /watch page rides the SHARED review-shell (left info rail | center board |
// right rail), the same layout the room + review pages use, so Mistboard TV reads
// like the rest of the site. LEFT: game meta card + channel list. CENTER: a
// fixed-width, naturally proportioned board with two completed mini-boards. RIGHT:
// the same shared game table the corresponding room uses.
function buildWatchSection(feed: WatchFeed | null): WatchSection {
  // ── Left rail: meta card (top) + channel list (below) + sealed-status badge ──
  const left = document.createElement('div');
  left.className = 'watch-left';

  const metaRoot = document.createElement('div');
  metaRoot.className = 'watch-meta';

  const channelRail = document.createElement('aside');
  channelRail.className = 'watch-channel-rail';
  const channelRoot = document.createElement('nav');
  channelRoot.className = 'watch-channel-list';
  channelRoot.setAttribute('aria-label', t('watch.channels'));
  channelRail.append(channelRoot);

  left.append(metaRoot, channelRail);

  // ── Center: width-fixed, naturally proportioned board + final boards ──
  const center = document.createElement('div');
  center.className = 'watch-center';

  // Phone-only headline above the board. On col1 the left rail (which carries
  // the meta card) drops to the bottom of the stack, so the page used to open
  // on a board with nothing above it: no players, no variant, no indication of
  // what you were looking at. Hidden from col2 up, where the console beside the
  // board already names both players.
  const headlineRoot = document.createElement('div');
  headlineRoot.className = 'watch-headline';

  const boardBox = document.createElement('div');
  boardBox.className = 'watch-board-box';
  const replayRoot = document.createElement('div');
  replayRoot.className = 'watch-tv-board';
  // The finished board is itself the link to its review page. The anchor is a
  // transparent overlay rather than a wrapper: the mounted replay contains its
  // own buttons (control bar, reveal), and nesting those inside an <a> is
  // invalid — the watch CSS only hides them. Nothing under the overlay is
  // clickable on this surface, so covering the board costs no interaction.
  const reviewLink = document.createElement('a');
  reviewLink.className = 'watch-main-review-link';
  reviewLink.hidden = true;
  // An invisible overlay is undiscoverable, so hover/focus surfaces a chip. It
  // stays out of the accessibility tree: the anchor already carries the full
  // "Review X vs Y" label, and a chip reading "Review" would only shadow it.
  const reviewChip = document.createElement('span');
  reviewChip.className = 'watch-main-review-link__chip';
  reviewChip.textContent = t('watch.review');
  reviewChip.setAttribute('aria-hidden', 'true');
  reviewLink.append(reviewChip);
  boardBox.append(replayRoot, reviewLink);

  // Fog-perspective toggle slot, directly under the board-box. Populated only for
  // asymmetric fog (dark) games with more than one available view; empty and
  // display:none-collapsed otherwise (see renderWatchPovToggle).
  const povRoot = document.createElement('div');
  povRoot.className = 'watch-pov-slot';

  const queueRoot = document.createElement('section');
  queueRoot.className = 'watch-previously';
  queueRoot.setAttribute('aria-label', t('watch.previouslyOn'));

  center.append(headlineRoot, boardBox, povRoot, queueRoot);

  // ── Right rail: the shared room game table, with watch-owned behavior ──
  const right = document.createElement('div');
  right.className = 'watch-right';
  const gameTable = createGameTable();
  gameTable.el.classList.add('watch-game-table');
  right.append(gameTable.el);

  const el = createReviewShell({
    left,
    center,
    right,
    pageClassName: 'watch-review-shell',
    ariaLabel: t('watch.mistboardTv'),
  });

  renderWatchChannelList(channelRoot, feed);
  return {
    el,
    metaRoot,
    headlineRoot,
    channelRoot,
    replayRoot,
    reviewLink,
    povRoot,
    queueRoot,
    gameTableRoot: gameTable.el,
    playerBottom: gameTable.refs.playerBottom,
    playerTop: gameTable.refs.playerTop,
    clockTop: gameTable.refs.clockTop,
    clockBottom: gameTable.refs.clockBottom,
    movesRoot: gameTable.refs.movesRoot,
    replayControlsRoot: gameTable.refs.replayControlsRoot,
    boardBox,
    centerColumn: center,
    railContent: right,
  };
}

// Human label for a kebab-cased termination code ("king-captured" -> "King
// captured"), for the meta-card result line.
function watchTerminationLabel(termination: string): string {
  if (!termination) return '';
  const spaced = termination.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The FeaturedGame currently showing on the board (the active room), or null.
function activeWatchGame(feed: WatchFeed | null, activeRoomId: string | null): FeaturedGame | null {
  if (!feed || !activeRoomId) return null;
  return feed.unlocked.find((game) => game.roomId === activeRoomId) ?? null;
}

// The seat rows for a game, in first-mover/second-mover order, resolved through
// the shared seat model. Shared by the left meta card and the right-rail rows.
// The row's `color` is the INK, not the seat: a flip variant's seats are move-order
// slots, so painting the raw seat contradicts both the board and this page's own
// "Black wins" line for half of all Banqi / Flip Jungle games.
export function watchGamePlayers(game: FeaturedGame): GameMetaPlayer[] {
  const seats = matchupSeats(game);
  // Scored off the SEATS, not the inks resolved below: the feed's result names
  // the winning seat, so a flip variant scores correctly without firstColor.
  const scores = seatResultScores(game.result, seats);
  return seats.map((seat, index) => {
    const participant = participantForColor(game, seat);
    return {
      color: seatInkForVariant(game.variant, seat, game.firstColor ?? null),
      name: displayParticipantName(game, seat),
      rating: watchParticipantRating(participant),
      isEngine: participant?.subjectType === 'engine-version' || participant?.subjectType === 'bot',
      score: scores[index] ?? null,
      profile: participantProfileTarget(participant),
    };
  });
}

function watchParticipantRating(participant: GameParticipant | null): number | null {
  if (!participant) return null;
  return participant.ratingAfter ?? participant.ratingBefore ?? null;
}

// Stamp the showing variant's seat-ink family on the shell, so seat-disc-ink.css
// can hang per-family disc colours off it (today: the Jungle family's second seat
// is Blue, not black). Review pages get this from a static `.jungle-review` page
// class; /watch is ONE page that swaps variants as you change channel, so it has
// to be re-stamped per game and CLEARED when the next game is not in the family.
//
// Called from BOTH row-builders. The completed-feed path and the live-follow path
// render the meta card and seat rows independently -- renderWatchActiveGame returns
// early while a live game is airing -- so a stamp in only one of them leaves the
// other painting the wrong colour, the same way each of this page's seat-vs-ink
// builders had to learn `firstColor` separately.
export function setWatchSeatInkFamily(watch: WatchSection, variant: string | null): void {
  const family = seatInkFamily(variant);
  if (family) watch.el.dataset.seatInkFamily = family;
  else delete watch.el.dataset.seatInkFamily;
}

// Re-render the left meta card + right-rail player rows from the active game.
// Called on every feed refresh and channel/game switch (the active game changes).
function renderWatchActiveGame(
  watch: WatchSection,
  feed: WatchFeed | null,
  activeRoomId: string | null,
): void {
  const game = activeWatchGame(feed, activeRoomId);
  setWatchSeatInkFamily(watch, game?.variant ?? null);
  renderWatchMetaCard(watch.metaRoot, game);
  renderWatchHeadline(
    watch.headlineRoot,
    game
      ? {
          matchup: watchQueueMatchupLabel(game),
          detail: `${variantDisplayLabel(game.variant)} · ${watchGameStatusLine(game)}`,
        }
      : null,
  );
  renderWatchMainReviewLink(watch.reviewLink, game);
  watch.gameTableRoot.hidden = !game;
  renderWatchPlayers(watch.playerTop, watch.playerBottom, game);
}

export function renderWatchMainReviewLink(
  link: HTMLAnchorElement,
  game: FeaturedGame | null,
): void {
  const reviewUrl = game ? reviewUrlForGame(game) : null;
  if (!game || !reviewUrl) {
    link.hidden = true;
    link.removeAttribute('href');
    link.removeAttribute('aria-label');
    link.removeAttribute('title');
    return;
  }

  const label = `Review ${watchQueueMatchupLabel(game)}`;
  link.href = reviewUrl;
  link.hidden = false;
  link.setAttribute('aria-label', label);
  link.title = label;
}

function renderWatchMetaCard(root: HTMLElement, game: FeaturedGame | null): void {
  root.replaceChildren();
  if (!game) return;
  const players = watchGamePlayers(game);
  const ratedSegment =
    game.rated === true ? t('watch.rated') : game.rated === false ? t('watch.casual') : null;
  const card = createGameMetaCard({
    markerId: variantMiniIdForRawVariant(game.variant) ?? undefined,
    headline: [timeControlLabelForGame(game), ratedSegment, sourceLabel(game.mode)],
    variantName: variantDisplayLabel(game.variant),
    players,
    status: watchGameStatusLine(game),
  });
  root.append(card.el);
}

// The phone headline: who is playing on the first line, what you are watching on
// the second. Both watch paths (a finished FeaturedGame and the live featured
// payload) funnel through here so the two never drift apart.
export function renderWatchHeadline(
  root: HTMLElement,
  headline: { matchup: string; detail: string } | null,
): void {
  root.replaceChildren();
  root.hidden = !headline;
  if (!headline) return;
  const matchup = document.createElement('p');
  matchup.className = 'watch-headline__matchup';
  matchup.textContent = headline.matchup;
  const detail = document.createElement('p');
  detail.className = 'watch-headline__detail';
  detail.textContent = headline.detail;
  root.append(matchup, detail);
}

// "Name vs Name" from an already-resolved seat list (the live path has no
// FeaturedGame to hand to matchupLabel).
function playersMatchupLabel(players: GameMetaPlayer[]): string {
  return players.map((player) => player.name).join(' vs ');
}

function watchGameStatusLine(game: FeaturedGame): string {
  const result = watchQueueResultLabel(game);
  const termination = watchTerminationLabel(game.termination);
  return termination ? `${result} by ${termination}` : result;
}

// Populate the shared room table's board-relative player rows. The second mover
// sits above the board and the first mover below it, matching every room's
// default orientation.
function renderWatchPlayers(
  top: HTMLElement,
  bottom: HTMLElement,
  game: FeaturedGame | null,
): void {
  renderWatchPlayerRows(top, bottom, game ? watchGamePlayers(game) : null);
}

// The seat rows for an already-resolved player list (first mover below the board,
// second mover above). Shared by the completed-game path and the Featured
// channel's live path, which resolves players from the /api/watch/live payload
// rather than a FeaturedGame.
function renderWatchPlayerRows(
  top: HTMLElement,
  bottom: HTMLElement,
  players: GameMetaPlayer[] | null,
): void {
  top.replaceChildren();
  bottom.replaceChildren();
  if (!players) return;
  const [firstMover, secondMover] = players;
  if (secondMover) top.append(watchGameTablePlayer(secondMover));
  if (firstMover) bottom.append(watchGameTablePlayer(firstMover));
}

function watchGameTablePlayer(player: GameMetaPlayer): HTMLElement {
  const row = document.createElement('span');
  row.className = 'clock-player-line watch-game-table__player';
  const disc = document.createElement('span');
  // A null color is a flip variant whose opening flip has not bound an ink yet:
  // render the neutral ring rather than guessing a side.
  disc.className = `watch-player-disc watch-player-disc--${player.color ?? 'unbound'}`;
  disc.setAttribute('aria-hidden', 'true');
  row.append(disc, playerNameEl(player.name, player.profile ?? null, 'clock-name'));
  if (player.isEngine) {
    const bot = document.createElement('span');
    bot.className = 'watch-player-bot';
    bot.textContent = t('watch.botBadge');
    row.append(bot);
  }
  if (player.rating != null) {
    const rating = document.createElement('span');
    rating.className = 'watch-player-rating';
    rating.textContent = String(player.rating);
    row.append(rating);
  }
  return row;
}

// The shared variant marker for each watch channel, so the TV rail reads in
// the same icon language as the picker, rules rail, leaderboard, and profile.
// Channel ids match VariantMiniId ids; the dark-chess channel (which also carries dark-draft960 games) shows the
// dark-chess marker. An unmapped channel keeps its (empty) marker slot so the
// rows stay grid-aligned.
const CHANNEL_MINI_BY_ID: Record<string, VariantMiniId> = {
  'dark-chess': 'dark-chess',
  xiangqi: 'xiangqi',
  'dark-xiangqi': 'dark-xiangqi',
  'mini-xiangqi': 'mini-xiangqi',
  'dark-mini-xiangqi': 'dark-mini-xiangqi',
  'drop-mini-xiangqi': 'drop-mini-xiangqi',
  'fortress-xiangqi': 'fortress-xiangqi',
  'duck-xiangqi': 'duck-xiangqi',
  jieqi: 'jieqi',
  banqi: 'banqi',
  'dark-shogi': 'dark-shogi',
  'dark-crazyhouse': 'dark-crazyhouse',
  kriegspiel: 'kriegspiel',
  'reveal-chess': 'reveal-chess',
  jungle: 'jungle',
  'jungle-flip': 'jungle-flip',
};

// Lichess's `cogs` icon, used for its Bot and computer TV channels. Mistboard
// and Lichess are both AGPL-3.0-or-later, so keep the source link beside this
// extracted outline: https://github.com/lichess-org/lila/blob/master/public/font/lichess.sfd
const ENGINES_CHANNEL_MARKER = `<svg class="watch-channel-gears" viewBox="-18 4 548 504" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M216 204Q195 183 165 183Q134 183 113 204Q91 228 91 256Q91 284 113 308Q134 329 165 329Q195 329 216 308Q238 286 238 256Q238 226 216 204ZM457 402Q457 387 446 377Q436 366 421 366Q405 366 395 377Q384 388 384 402Q384 417 395 428Q406 439 421 439Q435 439 446 428Q457 418 457 402ZM457 110Q457 94 446 84Q435 73 421 73Q406 73 395 84Q384 95 384 110Q384 123 395 136Q405 146 421 146Q436 146 446 136Q457 125 457 110ZM347 230V283Q347 287 345 288Q344 291 341 291L297 298Q291 312 287 320Q309 348 313 353Q315 357 315 359Q315 362 313 364Q311 367 290 390Q271 407 267 407Q265 407 261 405L228 379Q214 385 206 388Q203 419 200 432Q197 439 191 439H138Q136 439 132 437Q132 436 131 435Q130 433 129 432L123 388Q114 385 101 379L68 405Q64 407 62 407Q59 407 56 404Q15 366 15 359Q15 357 17 353Q20 348 29 338Q32 334 37 328Q42 322 42 321Q33 301 32 297L-11 290Q-14 290-16 288Q-18 286-18 282V229Q-18 225-16 224Q-14 221-12 221L33 214Q36 205 42 192Q20 164 16 159Q14 155 14 153Q14 150 16 148Q18 145 39 122Q58 105 62 105Q64 105 68 107L101 133Q107 130 123 124Q126 94 129 80Q132 73 138 73H191Q193 73 197 75Q200 78 200 80L206 124Q215 127 228 133L261 107Q265 105 267 105Q270 105 273 108Q314 145 314 153Q314 157 312 159Q309 164 300 174Q298 178 296 181Q293 184 291 187Q288 190 287 191Q294 206 297 215L341 221Q342 222 343 223Q344 224 345 224Q347 226 347 230ZM530 382V422Q530 426 488 431Q487 433 486 436Q484 439 483 442Q481 444 479 446Q494 479 494 485L493 487L457 508Q455 508 444 494Q440 490 436 484Q431 477 429 475H412Q410 477 405 484Q400 490 397 494Q386 508 384 508Q372 501 349 487Q347 487 347 485Q347 479 362 446L353 431Q311 426 311 422V382Q311 378 353 373Q359 363 362 359Q347 326 347 319L349 317Q353 315 359 311Q362 309 368 306Q373 303 375 302L384 297Q386 297 397 310Q400 314 403 318Q406 322 409 326Q411 329 412 330Q416 329 421 329Q425 329 429 330Q438 318 455 298L457 297Q458 297 493 317Q493 318 494 318Q494 318 494 319Q494 326 479 359Q482 363 488 373Q530 378 530 382ZM530 90V130Q530 134 488 139Q480 151 479 153Q494 186 494 193Q494 194 494 194Q493 194 493 195Q488 198 484 201Q479 203 476 205Q472 207 469 209Q466 210 464 211Q462 212 461 213Q459 214 458 214L457 215Q454 215 444 202Q441 198 438 194Q435 190 433 187Q430 183 429 182Q425 183 421 183Q416 183 412 182Q411 183 409 187Q406 190 403 194Q400 198 397 202Q387 215 384 215Q372 208 349 195L347 193Q347 186 362 153Q359 149 353 139Q311 134 311 130V90Q311 86 353 81Q358 72 362 66Q347 33 347 27Q347 25 349 25Q349 24 359 19Q361 17 375 9L384 5Q387 5 397 18Q400 22 405 29Q410 35 412 37H429Q444 18 455 5H457Q460 5 493 25Q494 26 494 27Q494 33 479 66Q484 72 488 81Q530 86 530 90Z"/></svg>`;

export function renderWatchChannelList(root: HTMLElement, feed: WatchFeed | null): void {
  root.replaceChildren();
  root.hidden = !feed || feed.channels.length <= 1;
  const rail = root.closest<HTMLElement>('.watch-channel-rail');
  if (rail) rail.hidden = root.hidden;
  if (!feed || feed.channels.length <= 1) return;

  for (const channel of feed.channels) {
    const link = document.createElement('a');
    link.className = 'watch-channel-link';
    link.href = `/watch?channel=${encodeURIComponent(channel.id)}`;
    const player = channel.topPlayer ?? null;
    const playerLine = player
      ? player.rating != null
        ? `${player.name} ${player.rating}`
        : player.name
      : '';
    link.setAttribute('aria-label', playerLine ? `${channel.label}, ${playerLine}` : channel.label);
    // Lichess-style row: text block (channel name over the top-rated player)
    // right-aligned, with the variant marker on the RIGHT edge. Decorative
    // marker; aria-hidden because the link's aria-label already names the
    // channel. notranslate keeps Google Translate off the SVG's aria text.
    const thumb = document.createElement('span');
    thumb.className = 'watch-channel-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    const miniId = CHANNEL_MINI_BY_ID[channel.id];
    if (channel.id === 'top') {
      thumb.append(buildUiIcon('featured-channel', 'watch-channel-crown'));
    } else if (channel.id === 'engines') {
      thumb.innerHTML = ENGINES_CHANNEL_MARKER;
    } else if (miniId) {
      thumb.classList.add('notranslate');
      thumb.setAttribute('translate', 'no');
      thumb.innerHTML = renderVariantMarker(miniId, {
        size: 112,
        label: `${channel.label} marker`,
      });
    }
    const label = document.createElement('span');
    label.className = 'watch-channel-name';
    label.textContent = channel.label;
    const text = document.createElement('span');
    text.className = 'watch-channel-text';
    text.append(label);
    if (playerLine) {
      const player_ = document.createElement('span');
      player_.className = 'watch-channel-player';
      player_.textContent = playerLine;
      player_.title = playerLine;
      text.append(player_);
    }
    link.append(text, thumb);
    if (channel.id === feed.activeChannel) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    root.append(link);
  }
}

// A sized placeholder for the board slot while a renderer swap is in flight
// (channel switch across families, or the first mount). It reserves the board's
// footprint so the swap doesn't shift layout, and every renderer's mount path
// calls root.replaceChildren(), so the skeleton is wiped the moment real
// content is ready. aria-hidden: it's a transient loading affordance, not state.
// Re-exported from the leaf so the existing watch-route test keeps importing it
// from here; the homepage showcase cycler imports it from './replay-skeleton.js'.
export { renderWatchReplaySkeleton };

function renderWatchEmptyState(root: HTMLElement, feed: WatchFeed | null): void {
  root.replaceChildren();

  const empty = document.createElement('section');
  empty.className = 'watch-empty';
  const title = document.createElement('h2');
  title.textContent = feed
    ? watchFeedIsDark(feed)
      ? t('watch.noUnlockedDarkReplays')
      : t('watch.noReplaysYet')
    : t('watch.replayFeedUnavailable');
  const body = document.createElement('p');
  body.textContent = feed
    ? feed.sealedCount > 0
      ? watchFeedIsDark(feed)
        ? 'Dark games are being played, but they stay hidden until completion.'
        : t('watch.gamesHiddenUntilComplete')
      : watchFeedIsDark(feed)
        ? 'Start a dark game and it can become the next replay after it finishes.'
        : t('watch.startGameBecomeReplay')
    : 'The watch feed needs persistence, so it is not available in this runtime.';

  const actions = document.createElement('div');
  actions.className = 'watch-empty-actions';
  const engine = document.createElement('a');
  engine.href = '/?play=computer';
  engine.textContent = t('watch.playEngine');
  const friend = document.createElement('a');
  friend.href = '/?play=friend';
  friend.textContent = t('watch.startFriendGame');
  actions.append(engine, friend);

  empty.append(title, body, actions);
  root.append(empty);
}

export type WatchQueuePreview = { game: FeaturedGame; root: HTMLElement };

/** The rail's two slots. */
const WATCH_QUEUE_SLOTS = 2;

/** What the rail offers: the newest completed games for the channel EXCEPT the one already
 *  on the main board (lichess TV's "previously on" never mirrors the featured game). Both
 *  the render and its memo key derive the rail from here, so the key cannot describe a
 *  different list than the one on screen. */
function watchQueueGames(feed: WatchFeed, activeRoomId: string | null): FeaturedGame[] {
  return feed.unlocked.filter((game) => game.roomId !== activeRoomId).slice(0, WATCH_QUEUE_SLOTS);
}

// The newest completed games for the active channel, rendered as real final
// boards. Each preview links to the finished game's variant-aware review page.
// Corpus samples have no review page, so those keep the in-place TV fallback.
export function renderWatchQueue(
  root: HTMLElement,
  feed: WatchFeed | null,
  activeRoomId: string | null,
  options: { previousRoomIds?: ReadonlySet<string> | null } = {},
): WatchQueuePreview[] {
  root.replaceChildren();
  const previousRoomIds = options.previousRoomIds ?? null;
  const previews: WatchQueuePreview[] = [];

  const heading = document.createElement('div');
  heading.className = 'watch-previously-heading';
  const title = document.createElement('h2');
  title.textContent = t('watch.previouslyOn');
  heading.append(title);
  root.append(heading);

  if (!feed) {
    const empty = document.createElement('p');
    empty.className = 'watch-previously-empty';
    empty.textContent = t('watch.feedUnavailable');
    root.append(empty);
    return previews;
  }

  // Empty means "nothing ELSE to watch": a channel holding only the game already on the
  // board has an empty rail, not a rail mirroring the board.
  if (watchQueueGames(feed, activeRoomId).length === 0) {
    const empty = document.createElement('p');
    empty.className = 'watch-previously-empty';
    empty.textContent = t('watch.noOtherCompleted');
    root.append(empty);
    return previews;
  }

  const list = document.createElement('ol');
  list.className = 'watch-queue-list';

  for (const game of watchQueueGames(feed, activeRoomId)) {
    const item = document.createElement('li');
    item.className = 'watch-queue-item';
    item.dataset.roomId = game.roomId;
    if (previousRoomIds && !previousRoomIds.has(game.roomId)) item.classList.add('is-new');

    const row = document.createElement('a');
    row.className = 'watch-queue-row';
    const reviewUrl = reviewUrlForGame(game);
    row.href = reviewUrl ?? watchQueueGameHref(feed, game.roomId);

    row.setAttribute(
      'aria-label',
      reviewUrl
        ? `Review ${watchQueueMatchupLabel(game)}`
        : `Watch ${watchQueueMatchupLabel(game)}`,
    );
    const previewRoot = document.createElement('div');
    previewRoot.className = 'watch-queue-preview';
    row.append(previewRoot);
    item.append(row);
    list.append(item);
    previews.push({ game, root: previewRoot });
  }

  root.append(list);
  return previews;
}

function watchQueueGameHref(feed: WatchFeed, roomId: string): string {
  const params = new URLSearchParams();
  params.set('game', roomId);
  params.set('channel', feed.activeChannel);
  return `/watch?${params.toString()}`;
}

export function watchFeedIsDark(feed: Pick<WatchFeed, 'activeChannel' | 'channels'>): boolean {
  const channel = feed.channels.find((candidate) => candidate.id === feed.activeChannel);
  if (!channel) return false;
  return channel.id.includes('dark') || channel.gameSpecIds.some((id) => id.includes('dark'));
}

export function watchQueueMatchupLabel(game: FeaturedGame): string {
  return matchupLabel(game);
}

export function formatWatchScope(
  feed: Pick<WatchFeed, 'activeChannel' | 'channels' | 'unlockLimit'>,
): string {
  return watchFeedIsDark(feed)
    ? `dark variants · latest ${feed.unlockLimit}`
    : `latest ${feed.unlockLimit}`;
}

export function resultLabel(result: string): string {
  if (result === 'white-wins') return t('watch.whiteWins');
  if (result === 'black-wins') return t('watch.blackWins');
  if (result === 'red-wins') return t('watch.redWins');
  return t('watch.draw');
}

// Flip variants (Banqi, Flip Jungle) decouple seat from ink, so their seat-keyed
// result needs the game's firstColor to read by ink ("Black wins" / "Blue wins").
// Every other variant has seat == ink; route the winning-side word through
// seatColorWord so the Jungle family reads "Blue wins" (its canonical second-seat
// color) instead of "Black wins".
export function watchQueueResultLabel(game: FeaturedGame): string {
  if (game.variant === 'banqi') return banqiResultLabel(game.result, game.firstColor ?? null);
  if (game.variant === 'jungle-flip')
    return jungleFlipResultLabel(game.result, game.firstColor ?? null);
  const result = game.result;
  if (result === 'red-wins') return `${seatColorWord(game.variant, 'red')} wins`;
  if (result === 'black-wins') return `${seatColorWord(game.variant, 'black')} wins`;
  if (result === 'white-wins') return `${seatColorWord(game.variant, 'white')} wins`;
  return resultLabel(result);
}
