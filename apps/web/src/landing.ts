import type { GameEvent } from '@mistboard/game';
import './landing-play.css';
import './landing.css';
import './game-route.css';
import { buildHomeArticleCards, initLandingCarousel, mountArticleThumbnails } from './articles.js';
import {
  displayParticipantName,
  type FeaturedGame,
  matchupLabel,
  matchupSeats,
  variantDisplayLabel,
} from './game-display.js';
import { gameMetaForGame } from './game-meta.js';
import {
  cachedHomeDailyPuzzle,
  loadHomeDailyPuzzle,
  renderHomePuzzleWidget,
} from './home-puzzle-widget.js';
import { t } from './i18n/catalog.js';
import { currentLocale, localizedHref } from './i18n/locale.js';
import { buildLandingActivity } from './landing-activity.js';
import { buildLandingAnnouncements } from './landing-announcements.js';
import { buildLandingChat } from './landing-chat.js';
import { buildTopStudiesWidget } from './landing-community-widgets.js';
import { buildLandingEventBanners } from './landing-event-banners.js';
import { buildLandingForumPreview } from './landing-forum-preview.js';
import {
  buildLandingPlayPanel,
  buildLobbyPanel,
  closeActiveLandingDialog,
  fallbackPlayableEngines,
  maybeOpenPlayDeepLink,
  type PlayableEngine,
  setRoomNavigator,
} from './landing-play.js';
import { homepageShowcaseGames, pickHeroPovForGame } from './landing-showcase.js';
import { type LandingTvMode, mountLandingTv } from './landing-tv.js';
import { type GameMeta, mountReplay } from './replay.js';
import { renderWatchReplaySkeleton } from './replay-skeleton.js';
import { enginePanelsForReview, loadGameForReview } from './review.js';
import { roomIdFromPath } from './room-url.js';
import type { ShowcaseEntry } from './showcase-cycler.js';
import { specIdForShowcaseVariant } from './showcase-dispatch.js';
import { buildHomeFooter, buildNav, buildNotice } from './site-shell.js';
import { type WebVariantTenant, webVariantTenantForRoomId } from './variant-tenant/registry.js';
import { buildHomeVideoCards } from './videos.js';

// Adaptive hero-pool refresh. Poll faster while games are being played (they
// unlock on completion, soon), slower when idle. Pool is capped. These three are
// the only knobs — tune from traffic (mirrors the server's SHOWCASE_POOL_SIZE).
const SHOWCASE_REFRESH_ACTIVE_MS = 45_000;
const SHOWCASE_REFRESH_IDLE_MS = 5 * 60_000;
const SHOWCASE_POOL_CAP = 14;
// How long the first paint waits for /api/games/showcase before giving up on
// winning the race. The fetch starts at mount, so on a healthy connection
// (~150-250ms observed) the real pool wins the first paint. On a race loss, dev
// falls back to the bundled static demo; production keeps the skeleton until the
// refresh tick lands real games.
const SHOWCASE_FIRST_PAINT_RACE_MS = 600;

// Honest caption for the showcase: variant name + relative finish time, marking
// these as replays of finished games, not live play. Bundled cold-start demos
// have no real finish time and read as an engine demo. No em dashes in
// user-facing copy; the separator is a middot.
function showcaseCaptionText(variant: string | undefined, endedAt: string | undefined): string {
  const name = variant ? variantDisplayLabel(variant) : 'Recent game';
  if (!endedAt) return `${name} · engine demo`;
  const ended = Date.parse(endedAt);
  if (Number.isNaN(ended)) return `${name} · recent game`;
  const mins = Math.max(0, Math.round((Date.now() - ended) / 60_000));
  if (mins < 1) return `${name} · just now`;
  if (mins < 60) return `${name} · ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${name} · ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${name} · ${days}d ago`;
}

export async function mountLanding(root: HTMLElement): Promise<void> {
  // Kick the showcase fetch off before any DOM work. Measured on prod: waiting
  // for the first refresh tick serialized it behind a /api/live-stats round-trip
  // and it didn't start until ~900ms in, so the static demo always painted first
  // and was visibly torn down ~1s later. Pre-settled to null on failure so the
  // race below and the first refresh tick can both await it safely.
  const firstShowcaseLoad: Promise<FeaturedGame[] | null> = fetchShowcaseGames().catch(() => null);

  root.replaceChildren();
  root.classList.add('landing-page');

  // Render the homepage shell immediately from synchronous fallbacks: a built-in
  // engine seeds the play panel and the board slot holds a skeleton. First paint
  // never waits on a network round-trip. The two homepage APIs (playable engines,
  // recent showcase games) then upgrade both in place below.
  //
  // Previously these two were awaited serially before anything but the nav
  // painted, so a slow /api/games/showcase hung the whole page behind a "Loading
  // games" spinner (much worse over high-latency links). Shell-first also makes a
  // hanging API non-blocking: the shell just keeps standing until real data
  // arrives, instead of stalling the page.
  // [render-jank: render the shell first, fill async — feedback_render_jank_prevention]
  let usingRealGames = false;

  // Shared, by-reference maps the cycler reads: pre-registered here for the static
  // fallback pool, then merged with each live-showcase refresh below.
  const metadataByRoomId: Record<string, GameMeta> = {};
  const povByRoomId: Record<string, 'white' | 'black'> = {};
  // First/second-mover participant names for the tenant compact seats, resolved
  // through the shared seat model (red/black for xiangqi and jungle,
  // white/black otherwise).
  const namesByRoomId: Record<string, { first: string; second: string }> = {};
  // When each game finished, for the honest "recent · 2h ago" caption. Undefined
  // for the bundled cold-start demos (no real finish time) -> caption reads "demo".
  const endedAtByRoomId: Record<string, string | undefined> = {};
  // Persisted variant per room, for the caption's variant name.
  const variantByRoomId: Record<string, string> = {};
  const toShowcaseEntry = (game: FeaturedGame): ShowcaseEntry => {
    metadataByRoomId[game.roomId] ??= gameMetaForGame(game);
    const pov = povByRoomId[game.roomId] ?? pickHeroPovForGame(game);
    povByRoomId[game.roomId] = pov;
    const [firstSeat, secondSeat] = matchupSeats(game);
    namesByRoomId[game.roomId] ??= {
      first: displayParticipantName(game, firstSeat),
      second: displayParticipantName(game, secondSeat),
    };
    endedAtByRoomId[game.roomId] = game.endedAt;
    variantByRoomId[game.roomId] = game.variant;
    return {
      roomId: game.roomId,
      specId: specIdForShowcaseVariant(game.variant),
      pov,
      ...(game.endedAt ? { endedAt: game.endedAt } : {}),
    };
  };
  const params = new URLSearchParams(window.location.search);
  // Dev aid: ?only=<specId> pins the showcase to a single variant (e.g.
  // ?only=drop-mini-xiangqi) instead of the normal all-variants cycle. No param =
  // normal behavior; handy for eyeballing one variant's board/hand.
  const onlySpec = params.get('only');
  // ?demo=<sampleId> forces a specific bundled game to open first.
  const requested = params.get('demo');
  // The bundled Misty self-play demos are an explicit visual-testing aid, never
  // the default homepage in any environment. Local mode follows production:
  // a race loss or empty pool keeps the skeleton until real games arrive, so
  // developers exercise the same cross-variant renderer and clock UI users see.
  // ?demo stays as an escape hatch for opening a bundled sample deliberately.
  const allowBundledDemos = shouldUseBundledShowcaseDemos(window.location.search);
  // With demos available they hold the slot until the real pool is worth cycling
  // (3+); without them any real game beats an empty skeleton.
  const minShowcasePool = allowBundledDemos ? 3 : 1;
  let initialPool = allowBundledDemos ? homepageShowcaseGames().map(toShowcaseEntry) : [];
  if (onlySpec) initialPool = initialPool.filter((entry) => entry.specId === onlySpec);

  const forcedIdx = requested ? initialPool.findIndex((entry) => entry.roomId === requested) : -1;
  if (forcedIdx > 0) {
    const [forced] = initialPool.splice(forcedIdx, 1);
    initialPool.unshift(forced!);
  }

  const stage = buildLandingStage(fallbackPlayableEngines());
  root.replaceChildren(buildNav(), stage.el);
  mountArticleThumbnails(stage.el);
  initLandingCarousel(stage.el);

  // Give the real pool a short head start before falling back to the bundled
  // static demo: the shell is already painted (skeleton in the board slot), and
  // mounting the real game directly beats mounting the demo and visibly swapping
  // it out a second later. ?demo pins a specific bundled game, so it skips the
  // race. A race loss falls back to the static pool; the refresh tick below still
  // swaps real games in when they arrive.
  renderWatchReplaySkeleton(stage.replayRoot);
  let cyclePool = initialPool;
  if (!requested) {
    const early = await Promise.race([
      firstShowcaseLoad,
      delay(SHOWCASE_FIRST_PAINT_RACE_MS).then(() => null),
    ]);
    if (early && early.length >= minShowcasePool) {
      let realEntries = early.slice(0, SHOWCASE_POOL_CAP).map(toShowcaseEntry);
      if (onlySpec) realEntries = realEntries.filter((entry) => entry.specId === onlySpec);
      if (realEntries.length > 0) {
        cyclePool = realEntries;
        usingRealGames = true;
      }
    }
  }

  // Mistboard TV controller (2026-07-20, replaces the endless replay cycler):
  // follow the top-rated LIVE game when one exists, else air the freshest
  // unseen completed game once, else hold the last final position. Each game
  // shows as a single compact board; the completed pool refreshes below.
  const tv = await mountLandingTv(stage.replayRoot, cyclePool, {
    metadataByRoomId,
    namesByRoomId,
    loaderForId: landingEventLoader,
    isConnected: () => stage.el.isConnected,
    onGameChange: ({ roomId, specId, mode }) => {
      stage.viewerLink.href = localizedHref(watchHrefForTvGame(mode, roomId), currentLocale());
      stage.caption.textContent =
        mode === 'live'
          ? `${variantDisplayLabel(variantByRoomId[roomId] ?? specId)} · live`
          : showcaseCaptionText(variantByRoomId[roomId] ?? specId, endedAtByRoomId[roomId]);
    },
  });

  // Upgrade the play panel + deep-link handling once the real playable engines
  // load. The shell already rendered with the "Misty" placeholder, so this is an
  // in-place swap, not a blocker. The fetch is retried with backoff so a
  // transient failure (e.g. the web service restarting mid-deploy) doesn't strand
  // the placeholder until a manual reload; the real roster swaps in on success.
  let enginesLoaded = false;
  const applyRealEngines = (engines: PlayableEngine[]): void => {
    if (enginesLoaded || !stage.el.isConnected) return;
    enginesLoaded = true;
    stage.applyEngines(engines);
    maybeOpenPlayDeepLink(engines);
  };
  void loadPlayableEnginesWithRetry().then((engines) => {
    if (engines) {
      applyRealEngines(engines);
    } else {
      // Every retry failed. Keep the placeholder, but still honor a ?play deep
      // link against it; the focus handler below retries when the tab returns.
      maybeOpenPlayDeepLink(fallbackPlayableEngines());
    }
  });

  // Self-heal a stranded placeholder: if the initial load and its retries never
  // landed the real roster (e.g. the tab was opened mid-deploy), fetch again when
  // the tab regains focus so the visitor never has to reload to get the real
  // engine. Self-removes once the landing unmounts (mirrors the showcase poll's
  // isConnected guard) and is also torn down on the room transition below.
  const refetchEnginesOnFocus = (): void => {
    if (!stage.el.isConnected) {
      document.removeEventListener('visibilitychange', refetchEnginesOnFocus);
      return;
    }
    if (enginesLoaded || document.visibilityState !== 'visible') return;
    void fetchPlayableEnginesOnce().then((engines) => {
      if (engines) applyRealEngines(engines);
    });
  };
  document.addEventListener('visibilitychange', refetchEnginesOnFocus);

  // Adaptively refresh the hero pool so newly finished games rotate in without a
  // page reload. New games' metadata/POV merge into the shared maps the replay
  // reads by reference, then the loop pool is swapped (the current game finishes
  // first). Polls fast while games are live, slow when idle; self-clears on
  // unmount.
  const poolIds = new Set(cyclePool.map((entry) => entry.roomId));
  let showcaseTimer: number | null = null;
  const stopShowcaseRefresh = () => {
    if (showcaseTimer !== null) {
      window.clearTimeout(showcaseTimer);
      showcaseTimer = null;
    }
  };
  // `preloaded` lets the first tick reuse the mount-time fetch (it may have lost
  // the first-paint race but still carry a fresh pool) instead of refetching.
  const refreshShowcasePool = async (preloaded?: FeaturedGame[] | null) => {
    let fresh: FeaturedGame[];
    if (preloaded) {
      fresh = preloaded;
    } else {
      try {
        fresh = await fetchShowcaseGames();
      } catch (err) {
        console.warn('showcase refresh failed', err);
        return;
      }
    }
    if (fresh.length < minShowcasePool) return; // not enough real games yet; keep the pool
    let nextEntries = fresh.slice(0, SHOWCASE_POOL_CAP).map(toShowcaseEntry);
    if (onlySpec) nextEntries = nextEntries.filter((entry) => entry.specId === onlySpec);
    if (nextEntries.length === 0) return; // filtered pool empty; keep what we have
    const nextIds = nextEntries.map((entry) => entry.roomId);
    const changed = nextIds.length !== poolIds.size || nextIds.some((id) => !poolIds.has(id));
    if (!changed) return;
    poolIds.clear();
    for (const id of nextIds) poolIds.add(id);
    // First time real games arrive, jump straight to one instead of letting the
    // static Misty-vs-Misty placeholder play out — it runs minutes before it
    // would end, so visitors otherwise only ever see the fallback.
    const leavingStaticFallback = !usingRealGames;
    if (leavingStaticFallback) usingRealGames = true;
    tv.updateCompletedPool(nextEntries, { jumpNow: leavingStaticFallback });
  };
  let firstRefreshTick = true;
  const tickShowcaseRefresh = async () => {
    if (!stage.el.isConnected) {
      stopShowcaseRefresh();
      return;
    }
    // live-stats only paces the NEXT tick, so it runs in parallel with the pool
    // refresh instead of serializing a round-trip in front of it.
    const playingPromise = fetch('/api/live-stats')
      .then(async (resp) =>
        resp.ok ? (((await resp.json()) as { playing?: number }).playing ?? 0) : 0,
      )
      .catch(() => 0);
    const preloaded = firstRefreshTick ? await firstShowcaseLoad : null;
    firstRefreshTick = false;
    await refreshShowcasePool(preloaded);
    const playing = await playingPromise;
    if (!stage.el.isConnected) {
      stopShowcaseRefresh();
      return;
    }
    // An empty pool means the board slot is still a skeleton (prod race loss with
    // no bundled fallback): retry at the active cadence so the visitor isn't
    // staring at it for the idle interval.
    showcaseTimer = window.setTimeout(
      () => void tickShowcaseRefresh(),
      playing > 0 || poolIds.size === 0 ? SHOWCASE_REFRESH_ACTIVE_MS : SHOWCASE_REFRESH_IDLE_MS,
    );
  };
  // Kick the first refresh promptly so real games replace the static showcase as
  // soon as /api/games/showcase responds when the first-paint race was lost (the
  // tick reuses that same in-flight fetch). Subsequent ticks reschedule at the
  // adaptive active/idle cadence.
  showcaseTimer = window.setTimeout(() => void tickShowcaseRefresh(), 0);

  // Hand off room navigation to an in-place SPA transition so the starting
  // click's user activation survives into the room. A full-document nav would
  // drop it, and browser autoplay policy would then swallow the engine's
  // opening-move sound until the visitor clicked again. The navigator is wired
  // only after the hero replay exists, so a click before then uses the default
  // full reload (safe, just no opening-move sound).
  const teardownLanding = () => {
    setRoomNavigator(null);
    closeActiveLandingDialog();
    stopShowcaseRefresh();
    document.removeEventListener('visibilitychange', refetchEnginesOnFocus);
    tv.destroy();
  };
  setRoomNavigator((url) => {
    void transitionToRoom(root, url, teardownLanding);
  });
}

async function transitionToRoom(
  root: HTMLElement,
  url: string,
  teardownLanding: () => void,
): Promise<void> {
  // Load the live room chunk while the landing is still on screen (no blank
  // flash), then dispose the landing and swap the room in place. Same-document
  // navigation preserves the click's sticky user activation.
  const tenant = landingRoomTenantForUrl(url);
  if (tenant?.loadLiveRoomClient) {
    const bootstrap = await tenant.loadLiveRoomClient().catch((err) => {
      console.warn('live room chunk failed to load; falling back to full reload', err);
      return null;
    });
    if (bootstrap === null) {
      window.location.href = url;
      return;
    }
    prepareRoomTransition(root, url, teardownLanding);
    bootstrap();
    return;
  }
  const liveModule = await import('./live.js').catch((err) => {
    console.warn('live room chunk failed to load; falling back to full reload', err);
    return null;
  });
  if (liveModule === null) {
    window.location.href = url;
    return;
  }
  prepareRoomTransition(root, url, teardownLanding);
  liveModule.bootstrapLiveRoom();
}

// Tenants with a self-contained live client transition through
// their own chunk; everything else boots the shared chess live shell.
export function landingRoomTenantForUrl(url: string): WebVariantTenant | null {
  const next = new URL(url, window.location.href);
  const roomId = roomIdFromPath(next.pathname) ?? next.searchParams.get('room');
  const tenant = roomId ? webVariantTenantForRoomId(roomId) : null;
  return tenant?.loadLiveRoomClient && tenant.enabled() ? tenant : null;
}

export function landingRoomClientKindForUrl(url: string): 'tenant' | 'standard' {
  return landingRoomTenantForUrl(url) ? 'tenant' : 'standard';
}

function prepareRoomTransition(root: HTMLElement, url: string, teardownLanding: () => void): void {
  teardownLanding();
  window.history.pushState(null, '', url);
  root.classList.remove('landing-page', 'game-route');
  root.replaceChildren();
  window.addEventListener('popstate', reloadOnPopState);
}

// After an in-place landing -> room swap, Back/Forward changes the URL without a
// document load, leaving the live DOM stranded on a non-room URL. A full reload
// re-runs main.ts route dispatch for whatever URL we landed on. The listener
// dies with the document on reload, so it never needs explicit removal.
function reloadOnPopState(): void {
  window.location.reload();
}

async function fetchShowcaseGames(): Promise<FeaturedGame[]> {
  const resp = await fetch('/api/games/showcase');
  if (!resp.ok) throw new Error(`failed to load showcase games: ${resp.status}`);
  const data = (await resp.json()) as { games: FeaturedGame[] };
  return data.games;
}

export function shouldUseBundledShowcaseDemos(search: string): boolean {
  return new URLSearchParams(search).has('demo');
}

export async function mountGame(root: HTMLElement, roomId: string): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'game-route');

  const shell = document.createElement('main');
  shell.className = 'game-shell';
  const replayRoot = document.createElement('div');
  replayRoot.className = 'game-replay';
  shell.append(replayRoot);
  root.append(buildNav(), shell);

  const loaded = await loadGameForReview(roomId);
  if (!loaded) {
    replayRoot.append(
      buildNotice('Game not found', 'This game is not available as a public replay.'),
    );
    return;
  }

  const { game, events } = loaded;
  document.title = buildGamePageTitle(game);

  // Flagship Dark Chess rides the shared review-layout shell (truth-primary +
  // POV secondaries), matching every other fog variant. The rich chessground
  // replay stays only for games that carry engine analysis artifacts (belief /
  // trace panels), which the standardized shell does not host yet.
  const hasEngineAnalysis = loaded.beliefRows.length > 0 || loaded.traceRows.length > 0;
  if (game.variant === 'dark-chess' && !hasEngineAnalysis) {
    const gameEvents = events ?? (await apiEventLoader(game.roomId));
    const { mountDarkChessPostgame } = await import('./dark-chess-postgame.js');
    mountDarkChessPostgame(root, game, gameEvents);
    return;
  }

  const exportLinks = buildGameExportLinks(game.roomId, game.variant);
  if (exportLinks) shell.append(exportLinks);
  await mountReplay(replayRoot, game.roomId, {
    autoplay: false,
    initialPly: initialGamePly(),
    onPlyChange: syncGamePlyUrl,
    showControls: true,
    controlsMode: 'panel',
    metadataMode: 'header',
    captureLayout: 'split',
    // FoW review preserves each player's perspective: keep their fog as it
    // was at game end. Truth is always shown on the truth pane; the only
    // post-finish change to the POVs is the king-capture attacker reveal —
    // i.e. the attacker becoming visible at the moment of death, which is
    // what the loser actually saw.
    revealOnFinish: false,
    loaderForId: events ? async () => events : apiEventLoader,
    metadataByRoomId: {
      [game.roomId]: gameMetaForGame(game),
    },
    enginePanels: loaded.review
      ? enginePanelsForReview(
          loaded.review,
          loaded.beliefRows.length > 0,
          loaded.beliefRows.length > 0 && loaded.traceRows.length > 0,
        )
      : undefined,
    belief:
      loaded.beliefRows.length > 0
        ? {
            rowsForSampleId: () => loaded.beliefRows,
            traceRowsForSampleId: () => loaded.traceRows,
          }
        : undefined,
    // Annotation panel is research-only — not shown on the public game viewer
    // (use a dedicated research surface when annotating).
    annotation: undefined,
  });
}

// One attempt at loading the real playable roster. Returns the engines on
// success, or null if the API is unreachable, errors, or (defensively) returns
// an empty list — callers keep the placeholder and may retry. Never throws.
export async function fetchPlayableEnginesOnce(): Promise<PlayableEngine[] | null> {
  try {
    const resp = await fetch('/api/engines/playable');
    if (!resp.ok) return null;
    const data = (await resp.json()) as { engines: PlayableEngine[] };
    return data.engines.length > 0 ? data.engines : null;
  } catch {
    return null;
  }
}

// Retry the engines fetch with backoff so a transient failure (a deploy/restart,
// a cold start, a network blip) doesn't strand the placeholder until the visitor
// manually reloads. Returns the roster, or null if every attempt failed.
export async function loadPlayableEnginesWithRetry(): Promise<PlayableEngine[] | null> {
  const backoffMs = [600, 1200, 2400, 4800];
  for (let attempt = 0; ; attempt += 1) {
    const engines = await fetchPlayableEnginesOnce();
    if (engines) return engines;
    if (attempt >= backoffMs.length) return null;
    await delay(backoffMs[attempt]!);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function apiEventLoader(roomId: string): Promise<GameEvent[]> {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) throw new Error(`failed to load events for ${roomId}: ${resp.status}`);
  const data = (await resp.json()) as { events: GameEvent[] };
  return data.events;
}

async function landingEventLoader(roomId: string): Promise<GameEvent[]> {
  if (isStaticReplaySampleId(roomId)) return fetchStaticSample(roomId);
  return apiEventLoader(roomId);
}

function isStaticReplaySampleId(roomId: string): boolean {
  return /^(sample-\d+|engine-v2-g\d{4})$/.test(roomId);
}

async function fetchStaticSample(sampleId: string): Promise<GameEvent[]> {
  const safeId = sampleId.replace(/[^a-zA-Z0-9_-]/g, '');
  const resp = await fetch(`/replay-samples/${safeId}.jsonl`);
  if (!resp.ok) throw new Error(`failed to load replay sample ${safeId}: ${resp.status}`);
  // Vite's SPA fallback returns 200 + text/html for any unmatched path. Detect it so we get a
  // clear error instead of a JSON.parse crash on <!doctype html>.
  const contentType = resp.headers.get('content-type') ?? '';
  if (contentType.startsWith('text/html')) throw new Error(`static sample not found: ${safeId}`);
  const text = await resp.text();
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as GameEvent);
}

function initialGamePly(): number {
  const value = new URLSearchParams(window.location.search).get('ply');
  if (!value) return 0;
  const ply = Number.parseInt(value, 10);
  return Number.isFinite(ply) ? ply : 0;
}

function syncGamePlyUrl(ply: number): void {
  const url = new URL(window.location.href);
  if (ply <= 0) {
    url.searchParams.delete('ply');
  } else {
    url.searchParams.set('ply', String(ply));
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

// Where the TV widget's click goes. A frozen/aired board hands /watch the exact
// room it is showing (?game=), so clicking through continues THAT game instead
// of the channel's own head. The two agree on the freshest game (Featured and
// the homepage pool share one curation bar), but the widget also airs a game
// that finished mid-session and freezes on it, so the board can legitimately sit
// on a non-head game. A LIVE board links to the bare channel: /watch runs the
// same top-election poll and picks the live game up itself, and ?game= resolves
// only against the COMPLETED feed, which a still-running room is not in.
export function watchHrefForTvGame(mode: LandingTvMode, roomId: string): string {
  if (mode === 'live') return '/watch?channel=top';
  return `/watch?channel=top&game=${encodeURIComponent(roomId)}`;
}

function buildLandingStage(
  engines: PlayableEngine[],
  opts: { skipLiveWidgets?: boolean } = {},
): {
  el: HTMLElement;
  replayRoot: HTMLElement;
  caption: HTMLElement;
  viewerLink: HTMLAnchorElement;
  applyEngines: (engines: PlayableEngine[]) => void;
} {
  const locale = currentLocale();
  const stage = document.createElement('main');
  stage.className = 'landing-stage';

  const section = document.createElement('section');
  section.className = 'landing-demo';

  // ── Left column (grid-area: left, band 1): the event-banner spotlight (rare,
  // timely announcements — tournaments, broadcasts; the slot collapses when no
  // event is on, which is almost always) with the cycling showcase board beneath
  // it. The News feed left the homepage; its history lives on at /feed. ──
  const leftColumn = document.createElement('div');
  leftColumn.className = 'landing-left-column';
  leftColumn.append(buildLandingEventBanners());
  const viewerColumn = document.createElement('div');
  viewerColumn.className = 'landing-viewer-column';
  const boardColumn = document.createElement('div');
  boardColumn.className = 'landing-board-column';
  // The viewer is a link to the Featured channel on Mistboard TV: /watch's Top
  // channel follows the very same top-election game this widget shows (live,
  // ply-synced, else frozen on the latest), so clicking through keeps watching
  // it full-size. Wrapping the board (not just the caption) makes the whole
  // widget the click target.
  const viewerLink = document.createElement('a');
  viewerLink.className = 'landing-viewer-link';
  viewerLink.href = localizedHref('/watch?channel=top', locale);
  viewerLink.setAttribute('aria-label', 'Watch the top game on Mistboard TV');
  const replayRoot = document.createElement('div');
  replayRoot.id = 'landing-replay';
  // Widget styling (compact board + name/clock seats) is keyed on this class,
  // shared with the dev variant sheet's cells.
  replayRoot.classList.add('showcase-widget');
  viewerLink.append(replayRoot);
  boardColumn.append(viewerLink);
  // Honest "recent · 2h ago" caption: kept wired (the cycler's onGameChange still
  // updates it) but NOT mounted for now — the viewer shows only players/clock/result
  // and the board, no variant/time metadata. Re-append to restore.
  const caption = document.createElement('div');
  caption.className = 'showcase-caption';
  viewerColumn.append(boardColumn);
  leftColumn.append(viewerColumn);

  // ── Center panel (grid-area: panel, band 1): the tabbed lobby board — Lobby
  // (engine seeds + live player seeks) / Quick pairing / Correspondence
  // (lichess's central lobby). The start-a-game entry stays on the right; this
  // is the complementary "join a game" surface. ──
  const lobbyPanel = document.createElement('section');
  lobbyPanel.className = 'landing-lobby-panel';
  lobbyPanel.append(buildLobbyPanel(locale, { hydrate: !opts.skipLiveWidgets }));

  // ── Play column (grid-area: play, band 1 right): the small h1 tagline, then
  // the single unified Play button (the setup dialog owns the opponent choice)
  // and the activity stats. Chat left this rail for the band-2 slot, so the
  // remaining trio centers vertically against the tall lobby panel. ──
  let playPanel = buildLandingPlayPanel(engines, { locale, showLobbyRequests: false });
  const playStack = document.createElement('div');
  playStack.className = 'landing-play-stack';
  // Button then the activity box render their frame synchronously (placeholder /
  // skeleton rows) so the column reserves its footprint from first paint; the
  // prerendered shell carries the same frames, hydration skipped.
  playStack.append(playPanel, buildLandingActivity({ hydrate: !opts.skipLiveWidgets }));
  // The page's single (small) h1: the about tagline at the top of the right rail.
  const about = document.createElement('h1');
  about.className = 'landing-about';
  appendLinkedTagline(about, t('home.tagline', {}, locale), localizedHref('/about', locale));
  const playColumn = document.createElement('div');
  playColumn.className = 'landing-play-column';
  playColumn.append(about, playStack);

  // ── Band 2: forum topics (center) and the lobby chat (right) beside the daily
  // puzzle. Chat took this slot from Top studies 2026-07-21, which moved down to
  // the band-3/4 right rail; the chat box is server-driven (the empty mount
  // paints nothing until the chat flag is confirmed). ──
  const forumColumn = document.createElement('div');
  forumColumn.className = 'landing-forum-column';
  forumColumn.append(buildLandingForumPreview({ hydrate: !opts.skipLiveWidgets }));
  const chatColumn = document.createElement('div');
  chatColumn.className = 'landing-chat-column';
  chatColumn.append(
    buildLandingChat({
      hydrate: !opts.skipLiveWidgets,
      mode: import.meta.env.DEV ? 'mock' : 'live',
    }),
  );

  // ── Band 3 (grid-area: blogs): the full-width blog row — compact article
  // cards (six per view), an announcement can take a slot, newest first. ──
  // Six, not eight: the row is one screen-width strip of "what's new", and the
  // curated list keeps growing while the strip does not.
  const articleCards = buildHomeArticleCards(6, locale);
  articleCards?.classList.add('landing-articles-row');

  // ── Band 4 (grid-area: videos): a parallel video strip beneath the blog row —
  // the same carousel, filled with curated English-first xiangqi videos (YouTube
  // for now; Mistboard/partner only in the future). Photographic thumbnails plus
  // a play glyph read as "video" beside the blog strip's board diagrams. The
  // default limit leaves room for the fresh slots on top of the curated arc, so
  // a mining run reaches the homepage without an edit here (see videos.ts). ──
  const videoCards = buildHomeVideoCards(undefined, locale);
  videoCards?.classList.add('landing-videos-row');

  // ── Bands 3-4 side rails: the News feed returns to the homepage on the left
  // (its full history stays at /feed) and Top studies takes the right. Both
  // span the blog AND video rows, so each box top-aligns with the blog row and
  // bottom-aligns with the video row. ──
  const newsColumn = document.createElement('div');
  newsColumn.className = 'landing-news-column';
  newsColumn.append(buildLandingAnnouncements(locale));
  const studiesColumn = document.createElement('div');
  studiesColumn.className = 'landing-studies-column';
  studiesColumn.append(buildTopStudiesWidget({ hydrate: !opts.skipLiveWidgets }));

  // ── Puzzle column (grid-area: puzzle, band 2 left): the daily puzzle. ──
  const puzzleColumn = document.createElement('div');
  puzzleColumn.className = 'landing-puzzle-column';
  if (!opts.skipLiveWidgets) {
    // Daily puzzle: render instantly from the cached copy (exact real footprint,
    // no pop-in) and swap in place if the day rolled over; only a first-ever visit
    // still appends on load.
    const cachedPuzzle = cachedHomeDailyPuzzle();
    let puzzleEl: HTMLElement | null = cachedPuzzle ? renderHomePuzzleWidget(cachedPuzzle) : null;
    if (puzzleEl) puzzleColumn.append(puzzleEl);
    void loadHomeDailyPuzzle().then((daily) => {
      if (!daily) return; // API failed: keep the cached render
      if (cachedPuzzle && daily.puzzle.id === cachedPuzzle.puzzle.id) return; // same day
      const fresh = renderHomePuzzleWidget(daily);
      if (puzzleEl) {
        puzzleEl.replaceWith(fresh);
      } else {
        puzzleColumn.append(fresh);
      }
      puzzleEl = fresh;
    });
  }

  // Swap the play panel in place once the real playable engines arrive (the shell
  // renders first with a built-in fallback).
  const applyEngines = (next: PlayableEngine[]): void => {
    const replacement = buildLandingPlayPanel(next, { locale, showLobbyRequests: false });
    playPanel.replaceWith(replacement);
    playPanel = replacement;
  };

  // Grid placement (see landing.css): band 1 = [banners+viewer · lobby panel ·
  // play button+activity], band 2 = [puzzle · forum · chat], bands 3-4 = [news ·
  // blog row then video row · top studies], with the two side rails spanning both
  // rows. Append order is irrelevant (grid-area governs).
  section.append(
    leftColumn,
    lobbyPanel,
    playColumn,
    puzzleColumn,
    forumColumn,
    chatColumn,
    newsColumn,
    studiesColumn,
  );
  if (articleCards) section.append(articleCards);
  if (videoCards) section.append(videoCards);

  // Center tenant (SVG) showcase boards within the square box so a non-square
  // (portrait xiangqi) board pillarboxes symmetrically rather than jamming against
  // the center column. The tenant frameworks re-render the board SVG every ply, so
  // a one-shot attribute set (like the puzzle's static render) wouldn't stick;
  // re-apply on each mutation. Chess is on chessground (no viewBox <svg>), so it
  // never matches — no-op there.
  if (!opts.skipLiveWidgets && typeof MutationObserver !== 'undefined') {
    const centerTenantBoards = (): void => {
      for (const svg of replayRoot.querySelectorAll<SVGElement>(
        '.replay-layout-solo .replay-board svg',
      )) {
        if (svg.getAttribute('preserveAspectRatio') !== 'xMidYMid meet') {
          svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
      }
    };
    new MutationObserver(centerTenantBoards).observe(replayRoot, {
      childList: true,
      subtree: true,
    });
    centerTenantBoards();
  }

  // The footer lives only on the homepage now (stripped from interior routes),
  // blended into the bottom of the stage rather than rendered as a separate bar.
  stage.append(section, buildHomeFooter(locale));
  return { el: stage, replayRoot, caption, viewerLink, applyEngines };
}

// Build-time static render of the homepage (nav + stage), baked by the prerender
// so crawlers, no-JS clients, and first paint get real content (the heading, play
// panel, article links, footer) instead of the empty SPA shell. The board replay
// and live game pool stay client-hydrated; the live lobby widget is skipped
// because it fetches on construction. Returns the inner HTML for `#app`.
export function renderLandingShellForPrerender(): string {
  const nav = buildNav();
  const stage = buildLandingStage(fallbackPlayableEngines(), { skipLiveWidgets: true });
  return `${nav.outerHTML}${stage.el.outerHTML}`;
}

function appendLinkedTagline(target: HTMLElement, tagline: string, href: string): void {
  const mistboardIndex = tagline.indexOf('Mistboard');
  const dotBoundary = mistboardIndex >= 0 ? tagline.lastIndexOf('. ', mistboardIndex) : -1;
  const fullStopBoundary = mistboardIndex >= 0 ? tagline.lastIndexOf('。', mistboardIndex) : -1;
  const useDot = dotBoundary > fullStopBoundary;
  const boundary = useDot ? dotBoundary : fullStopBoundary;
  if (boundary < 0) {
    const fallback = document.createElement('a');
    fallback.href = href;
    fallback.textContent = tagline;
    target.append(fallback);
    return;
  }

  const linkStart = boundary + (useDot ? 2 : 1);
  const lead = tagline.slice(0, linkStart);
  const linkedText = tagline.slice(linkStart);
  target.append(document.createTextNode(useDot ? lead : `${lead} `));
  const link = document.createElement('a');
  link.href = href;
  link.textContent = linkedText;
  target.append(link);
}

function buildGameExportLinks(roomId: string, variant: string | undefined): HTMLElement | null {
  // Draft960 export is deferred until the schema can encode post-draft starting
  // positions. Hide the section entirely for now to avoid shipping broken PGN.
  if (variant === 'draft960') return null;

  const section = document.createElement('section');
  section.className = 'game-export-links';

  const heading = document.createElement('span');
  heading.className = 'game-export-links-label';
  heading.textContent = 'Download';

  const encoded = encodeURIComponent(roomId);
  const pgnLink = document.createElement('a');
  pgnLink.href = `/api/games/${encoded}/export.pgn`;
  pgnLink.textContent = 'PGN';
  pgnLink.setAttribute('download', `mistboard-${roomId}.pgn`);

  const jsonLink = document.createElement('a');
  jsonLink.href = `/api/games/${encoded}/export.json`;
  jsonLink.textContent = 'JSON';
  jsonLink.setAttribute('download', `mistboard-${roomId}.json`);

  section.append(heading, pgnLink, jsonLink);
  return section;
}

function buildGamePageTitle(game: FeaturedGame): string {
  return `${matchupLabel(game)} · Mistboard`;
}
