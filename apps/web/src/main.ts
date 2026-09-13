import './app-base.css';
import {
  embedChannelFromSearch,
  embedColorFromSearch,
  embedNotationFromSearch,
  embedPlyFromSearch,
  embedPovFromSearch,
  embedRouteFromPath,
  embedThemeFromSearch,
} from './embed/embed-route.js';
import './board-fog.css';
import './styles.css';
import { initializeAccountNav } from './account-nav.js';
import { analysisVariantFromPath, analysisVariantLabel } from './analysis-catalog.js';
import { captureException, setPostHogInstance, trackLocaleResolved } from './analytics.js';
import type { ArticleLang } from './article-i18n.js';
import {
  clearChunkReloadAttempt,
  installGlobalChunkLoadRecovery,
  reloadForChunkLoadError,
} from './chunk-load-recovery.js';
import { editorVariantFromPath } from './editor/editor-catalog.js';
import {
  coordinateTrainerEnabled,
  correspondenceEnabled,
  friendsOnlineEnabled,
} from './feature-flags.js';
import { ensureLocaleCatalog, type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, initializeLocaleFromCurrentUrl, resolveLocale } from './i18n/locale.js';
import {
  challengesNotificationSource,
  correspondenceNotificationSource,
  followersNotificationSource,
  forumNotificationSource,
  inboxNotificationSource,
  registerNotificationSource,
} from './notification-nav.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { mountRestartBanner, setRestartBanner } from './restart-banner.js';
import { initializeThemeSettings, pinSiteTheme } from './theme.js';
import {
  type WebVariantTenant,
  webVariantTenantForRoomId,
  webVariantTenants,
} from './variant-tenant/registry.js';
import { pinXiangqiNotation } from './xiangqi-notation.js';

// Installed before anything else so EVERY later dynamic import — including
// post-bootstrap lazy loads on long-lived tabs (/watch) that no per-mount guard
// wraps — gets the one-shot stale-chunk reload after a deploy.
installGlobalChunkLoadRecovery();
// Resolved before the initializer, which writes a URL-prefixed locale into
// storage: reading the source after that write would report every /zh-hans
// visit as 'stored' and hide how the visitor actually arrived.
const bootLocaleResolution = resolveLocale();
const bootLocale = initializeLocaleFromCurrentUrl();
trackLocaleResolved(bootLocaleResolution);
// zh catalogs live in lazy per-locale chunks (see i18n/catalog.ts). Kick the
// load off now and hold localized rendering (nav, page mounts, localized
// titles) on this one promise, so zh visitors get zh copy on first paint; for
// English it resolves immediately. A failed fetch degrades to English copy;
// the stale-chunk-after-deploy case is already covered by the one-shot reload
// in installGlobalChunkLoadRecovery above.
const localeReady = ensureLocaleCatalog(bootLocale).catch(() => undefined);
initializeThemeSettings();
// Register notification sources before the nav mounts — account-nav mounts the
// bell once signed in, and a bell with no sources is a no-op. Correspondence
// rides its build flag; the inbox source is unconditional (its fetch 401s to a
// zero snapshot for anonymous visitors, and the bell only mounts signed-in).
if (correspondenceEnabled()) registerNotificationSource(correspondenceNotificationSource);
registerNotificationSource(inboxNotificationSource);
registerNotificationSource(followersNotificationSource);
registerNotificationSource(forumNotificationSource);
// Directed challenges are correspondence seeks, so this source has nothing to
// report unless correspondence is on.
if (correspondenceEnabled()) registerNotificationSource(challengesNotificationSource);
// An embed runs inside SOMEONE ELSE'S page, so the site bootstrap below is not
// just wasted work there, it is work we have no business doing in their document:
// the account nav fetches /api/auth/me with credentials, and analytics reports a
// pageview for a visit to a third party's site. embed-route.ts is deliberately
// import-free so this question can be answered before any of that runs.
const isEmbedDocument =
  embedRouteFromPath(window.location.pathname.replace(/\/+$/, '') || '/') !== null;

// An embedder with one theme can pin the board to it. Applied after the theme
// bootstrap above, so it overrides what that resolved from the reader's OS.
if (isEmbedDocument) {
  const pinned = embedThemeFromSearch(window.location.search);
  if (pinned) pinSiteTheme(pinned);
  // Same idea for move labels: an embed's reader has no stored preference, so
  // without this every embed shows the coordinate default.
  const notation = embedNotationFromSearch(window.location.search);
  if (notation) pinXiangqiNotation(notation);
}

// The account nav renders localized labels, so it waits for the locale chunk
// like the route mounts do (mountOrReport). The restart banner is English-only.
if (!isEmbedDocument) {
  void localeReady.then(() => initializeAccountNav());
  mountRestartBanner();
}
// Its only consumers are the restart banner and the rated-mode flag, both of
// which an embed has no use for.
if (!isEmbedDocument)
  void fetch('/api/server-status')
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (
        data: {
          restartAt: number | null;
          restartPhase?: 'pending' | 'restarting' | null;
          ratedEnabled?: boolean;
        } | null,
      ) => {
        if (data) {
          const phase =
            data.restartPhase === 'pending' || data.restartPhase === 'restarting'
              ? data.restartPhase
              : typeof data.restartAt === 'number'
                ? 'pending'
                : null;
          setRestartBanner(phase);
        }
        if (data) setRatedModeEnabled(data.ratedEnabled === true);
      },
    )
    .catch(() => {
      /* banner stays hidden; WS broadcast still covers in-game users */
    });

const phKey = import.meta.env.VITE_POSTHOG_KEY;
const phHost = import.meta.env.VITE_POSTHOG_HOST;
if (phKey && phHost && import.meta.env.PROD && !isEmbedDocument) {
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(phKey, {
      api_host: phHost,
      autocapture: false,
      capture_pageview: false,
      persistence: 'localStorage',
      disable_session_recording: true,
      respect_dnt: true,
      // Real-user load timing: web vitals (LCP/CLS/FCP/INP) so we can actually
      // see homepage load performance and catch regressions. network_timing is a
      // session-replay feature (disabled here), so leave it off — web_vitals is
      // independent of it.
      capture_performance: { web_vitals: true, network_timing: false },
      // Unhandled errors + promise rejections surface as $exception events
      // (Error Tracking), so a broken page reports itself instead of going dark.
      capture_exceptions: true,
      // Drop benign browser noise before ingestion. "ResizeObserver loop
      // completed with undelivered notifications" is a synthetic warning
      // Chromium fires at window.onerror when an observer callback defers a
      // layout to the next frame; nothing breaks and it never reproduces on
      // Firefox/Safari. Filtering here keeps it out of Error Tracking entirely.
      before_send: (event) => {
        const message = event?.properties?.$exception_values?.[0];
        if (typeof message === 'string' && message.includes('ResizeObserver loop')) {
          return null;
        }
        return event;
      },
    });
    posthog.capture('$pageview', { path: window.location.pathname });
    setPostHogInstance(posthog);
  });
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('missing #app');
const appRoot = app;

const params = new URLSearchParams(window.location.search);
const path = window.location.pathname.replace(/\/+$/, '') || '/';
const replaySample = params.get('replay');
const playDeepLink = params.get('play');
const wantsLive =
  import.meta.env.DEV &&
  !playDeepLink &&
  (params.has('room') || params.has('variant') || params.has('dev'));
const page = params.get('page');
const gameRoomId = gameRoomIdFromPath(path);
const gameRoomTenantRedirect = gameRoomId ? tenantRedirectForGameRoomId(gameRoomId) : null;
const tenantPostgame = tenantPostgameFromPath(path);
const liveRoomId = liveRoomIdFromPath(path);
const wantsAbout = path === '/about' || page === 'about';
const wantsSource = path === '/source' || page === 'source';
const wantsContact = path === '/contact' || page === 'contact';
const wantsPatron = path === '/patron' || page === 'patron';
const wantsFaq = path === '/faq' || page === 'faq';
const wantsTerms = path === '/terms' || page === 'terms';
const wantsPrivacy = path === '/privacy' || page === 'privacy';
const wantsContribute = path === '/contribute' || page === 'contribute';
const wantsDevelopers = path === '/developers' || page === 'developers';
const wantsApiDocs = path === '/api-docs' || page === 'api-docs';
const wantsThanks = path === '/thanks' || page === 'thanks';
const wantsLag = path === '/lag' || page === 'lag';
const wantsAccount = path === '/account' || page === 'account';
const wantsAccountSettings =
  path === '/account/settings' ||
  path.startsWith('/account/settings/') ||
  page === 'account-settings';
// /inbox (thread list) and /inbox/:handle (open conversation). Signed-in-only
// surface; the page itself renders a sign-in prompt for anonymous visitors.
// /inbox/reports is the admin report queue and wins over the :handle pattern
// (same reserved-literal tradeoff as the API routes).
const wantsInboxReports = path === '/inbox/reports';
const inboxMatch = wantsInboxReports ? null : path.match(/^\/inbox(?:\/([^/]+))?$/);
const wantsInbox = inboxMatch !== null;
const inboxHandle = inboxMatch?.[1] ? decodeURIComponent(inboxMatch[1]) : null;
// The Friends page (/following): the signed-in viewer's followed players.
// Signed-in-only; the page itself renders a sign-in prompt for anonymous
// visitors. Deliberately not in the sitemap (a private, self-only surface).
const wantsFollowing = path === '/following' || page === 'following';
// Interactive beginner course (lichess /learn parity), xiangqi first. Ungated —
// distinct from the legacy /learn hub above.
const wantsLearnXiangqi = path === '/learn/xiangqi';
// Coordinate + file-number drill. Its own surface rather than a Learn stage:
// Learn levels are declarative positions graded by board asserts, and this is a
// timed generator whose answer is a typed or tapped name. Parked: see #327.
const wantsNotationTrainer = coordinateTrainerEnabled() && path === '/learn/coordinates';
// The routes rendered inside someone else's page. Checked before everything
// else so an embed never picks up site chrome.
const embedRoute = embedRouteFromPath(path);
const wantsRulesIndex =
  path === '/rules' || path === '/zh-hans/rules' || path === '/zh-hant/rules' || page === 'rules';
const articleSlug = articleSlugFromPath(path);
const articleLang = articleLangFromPath(path);
const articleIndexView = articleIndexViewFromPath(path);
const wantsArticlesIndex = articleIndexView !== null || page === 'blog';
const wantsNews = path === '/feed' || path === '/news' || page === 'feed' || page === 'news';
const forumRedirectPostId = forumRedirectPostIdFromPath(path);
const forumTopicId = forumTopicIdFromPath(path);
const wantsForumReports = path === '/forum/reports';
// Reserved literal below the /forum/:category pattern (same tradeoff as
// /forum/reports): it must win over the category dispatch.
const wantsForumEtiquette = path === '/forum/etiquette';
const forumCategorySlug = forumCategorySlugFromPath(path);
const wantsForum =
  path === '/forum' ||
  (forumCategorySlug !== null && !wantsForumReports && !wantsForumEtiquette) ||
  page === 'forum';
const wantsLegacyPlay = path === '/play' || page === 'play';
const wantsWatch = path === '/watch' || page === 'watch';
// Locale-prefixed too. localeFromPath() is generic over any /zh-han[st]/*
// pathname and outranks both the stored choice and the browser language, so the
// prefix alone lands a visitor on the Chinese catalogue -- which is the whole
// point of a shareable, indexable Chinese URL (#293).
const wantsVideos =
  path === '/videos' ||
  path === '/zh-hans/videos' ||
  path === '/zh-hant/videos' ||
  page === 'videos';
const wantsXiangqiBroadcastIndex = path === '/broadcast/xiangqi';
const wantsXiangqiBroadcastOps = path === '/broadcast/xiangqi/ops';
const xiangqiBroadcastBoardId = xiangqiBroadcastBoardIdFromPath(path);
const xiangqiBroadcastRound = xiangqiBroadcastRoundFromPath(path);
const xiangqiBroadcastTourSlug = xiangqiBroadcastTourSlugFromPath(path);
const puzzleId = puzzleIdFromPath(path);
const wantsPuzzles = path === '/puzzles' || page === 'puzzles' || puzzleId !== null;
// Behind the correspondence build flag (soft launch). The nav bell + this
// dashboard share the gate; the route is invisible until the flag is on.
const wantsCorrespondence = correspondenceEnabled() && path === '/correspondence';
// The challenge landing page (/challenge/:id) rides the correspondence flag:
// challenges are correspondence seeks, so the surface is invisible until it is on.
const challengeId =
  correspondenceEnabled() && path.startsWith('/challenge/')
    ? decodeURIComponent(path.slice('/challenge/'.length))
    : null;
const wantsLeaderboard = path === '/player' || path === '/leaderboard' || page === 'leaderboard';
const wantsRatingStats = path === '/player/rating-stats';
// Unlisted admin game browser. No nav entry; the page itself is admin-gated by
// the /api/admin/games/query endpoint (open in local dev). Direct-URL only.
const wantsDatabase = path === '/database';
// Public site statistics (/stats) and the admin superset (/metrics), one module.
// /metrics adds account count/growth + results from /api/stats (admin-gated,
// open in local dev), so it stays unlisted and direct-URL only like /database.
const wantsStats = path === '/stats';
const wantsMetrics = path === '/metrics';
// Title verification: player-facing request form. Linked from profile copy,
// no nav entry.
const wantsVerifyTitle = path === '/verify-title';
// Streamers directory: /streamer (public list). Basic empty-state scaffold for
// now (apps/web/src/streamer.ts), linked from the Watch nav.
const wantsStreamer = path === '/streamer';
// Coach directory: /coach (public list) and /coach/:handle (public detail)
// share one module. /coach/edit is the signed-in editor, a reserved literal
// below the :handle pattern that must win over it (same tradeoff as
// /inbox/reports).
const wantsCoachEdit = path === '/coach/edit';
const coachMatch = wantsCoachEdit ? null : path.match(/^\/coach(?:\/([^/]+))?$/);
const wantsCoach = coachMatch !== null;
const coachHandle = coachMatch?.[1] ? decodeURIComponent(coachMatch[1]) : null;
// Unlisted admin review queue for title requests. No nav entry; admin-gated by
// /api/admin/titles (open in local dev). Direct-URL only.
const wantsTitlesAdmin = path === '/titles';
// Unlisted admin engine tracker. No nav entry; admin-gated by /api/admin/engines
// (open in local dev). Direct-URL only.
const wantsEngines = path === '/engines';
// Unlisted admin readout history (/readouts): the scheduled operating readout,
// admin-gated by /api/admin/readouts (open in local dev).
const wantsReadoutsAdmin = path === '/readouts';
// Unlisted admin player roster (/accounts): every registered account. Admin-
// gated by /api/admin/accounts (open in local dev); reached from the account
// menu's admin group.
const wantsAccountsAdmin = path === '/accounts';
// Unlisted admin per-engine profile (/engine/:id). Same admin gate as /engines.
const engineProfileId = path.startsWith('/engine/')
  ? decodeURIComponent(path.slice('/engine/'.length))
  : null;
const wantsBots = path === '/bots';
const botProfileId = path.startsWith('/bot/')
  ? decodeURIComponent(path.slice('/bot/'.length))
  : null;
const profileHandle = profileHandleFromPath(path);
// Standalone analysis boards (lichess.org/analysis): /analysis opens the
// flagship (xiangqi); /analysis/<variant> opens any catalog variant. Unknown
// slugs return null and fall through to 404 (fail-closed — see analysis-catalog).
const analysisVariant = analysisVariantFromPath(path);
// The board editor (lichess.org/editor) covers the same catalog: /editor opens
// the flagship, /editor/<variant> any catalog variant, unknown slugs 404.
const editorVariant = editorVariantFromPath(path);
// /games is the current-games page: everything in progress right now, live and
// correspondence, across every variant (lichess's "Current games").
const wantsCurrentGames = path === '/games';
// The games database is canonically /games/search (lichess's advanced search).
// The old /historical-xiangqi index paths named one of the three sources the
// page lists rather than the page, and server-http 301s them here, so this
// matcher stays single-valued: a route literal here that isClientRoute does not
// know about is a conformance failure.
const wantsHistoricalXiangqiSearch = path === '/games/search';
const wantsXiangqiImport = path === '/import';
const historicalXiangqiGameId = historicalXiangqiGameIdFromPath(path);
// Accepts the locale-prefixed permalink too (/zh-hans/study/:id). The locale
// itself is already picked up from the URL by initializeLocaleFromCurrentUrl;
// without this pattern the localized URL fell through to the 404 shell even
// though the server happily served it with localized meta.
const studyBaseId = /^(?:\/(?:zh-hans|zh-hant))?\/study\/([A-Za-z0-9]+)$/.exec(path)?.[1] ?? null;
const studyChapterRoute = studyChapterRouteFromPath(path);
const studyId = studyBaseId ?? studyChapterRoute?.studyId ?? null;
const studyChapterId = studyChapterRoute?.chapterId ?? null;
const wantsStudyIndex = path === '/study';
const wantsPractice = path === '/practice';
// Hidden DEV-only lab for Jungle river-movement cues (rat / tiger / lion). No nav entry.
const wantsJungleCuesLab = import.meta.env.DEV && path === '/jungle-cues';
// Hidden DEV-only audition lab for sound sets. No nav entry.
const wantsSoundLab = import.meta.env.DEV && path === '/sound-lab';
// Hidden DEV-only variant sheet: every variant's opening in the showcase widget.
const wantsShowcaseSheet = import.meta.env.DEV && path === '/showcase-sheet';
// Hidden DEV-only game sheet: every live variant's room + review page with a
// watch-feed sample (tuning sweep).
const wantsGameSheet =
  import.meta.env.DEV && (path === '/game-sheet' || path === '/postgame-sheet');
// Tenants with a self-contained live client are routed to it
// *before* the shared live-room shell so they never touch the fog-critical
// live.ts monolith; tenants riding the chess shell fall through to it.
const tenantLiveRoomCandidate = liveRoomId ?? (wantsLive ? params.get('room') : null);
const tenantLiveRoom = tenantLiveRoomCandidate
  ? webVariantTenantForRoomId(tenantLiveRoomCandidate)
  : null;
const wantsTenantLiveRoom =
  tenantLiveRoom?.loadLiveRoomClient !== undefined && tenantLiveRoom.enabled();

if (replaySample) {
  setTitle('Replay');
  // Honor &ply=N as a start cursor (mirrors the /game/:id review route). Lets a
  // deep-link drop straight onto a position of interest in a long replay.
  const replayPlyRaw = params.get('ply');
  const replayPly = replayPlyRaw ? Number.parseInt(replayPlyRaw, 10) : NaN;
  // Keep the White/Black POV panes fogged even after the game ends — only the
  // Truth pane reveals. A finished game shouldn't retroactively lift the fog a
  // player actually saw the game under.
  const replayOpts = {
    revealOnFinish: false,
    ...(Number.isFinite(replayPly) ? { initialPly: replayPly } : {}),
  };
  void mountOrReport(() =>
    import('./replay.js').then(({ mountReplay }) =>
      mountReplay(appRoot, replaySample, replayOpts).then(() => undefined),
    ),
  );
} else if (wantsTenantLiveRoom && tenantLiveRoom?.loadLiveRoomClient) {
  setTitle(tenantLiveRoom.pageTitle);
  const loadTenantLiveRoom = tenantLiveRoom.loadLiveRoomClient;
  void mountOrReport(() =>
    loadTenantLiveRoom().then((bootstrap) => {
      bootstrap();
    }),
  );
} else if (liveRoomId || wantsLive) {
  setTitle('Live');
  void mountOrReport(() =>
    import('./live.js').then(({ bootstrapLiveRoom }) => bootstrapLiveRoom()),
  );
} else if (tenantPostgame?.tenant.enabled()) {
  const { tenant, mount, roomId } = tenantPostgame;
  appRoot.dataset.favoriteGameId = roomId;
  setTitle(tenant.pageTitle);
  void mountOrReport(() => mount(appRoot, roomId).then(() => undefined));
} else if (gameRoomTenantRedirect) {
  // A stale/shared /game/<tenant-id> link (e.g. /game/dxq_...): variant-tenant
  // games replay ONLY under their tenant postgame route; the legacy chess shell
  // 403s (game_not_public) on their event log. Redirect to the canonical route
  // so the link works and the URL is correct (replace, not push, so the broken
  // URL leaves no history entry). The reload lands on the tenantPostgame branch.
  window.location.replace(gameRoomTenantRedirect);
} else if (gameRoomId) {
  appRoot.dataset.favoriteGameId = gameRoomId;
  setTitle('Game');
  void mountOrReport(() =>
    import('./landing.js').then(({ mountGame }) => mountGame(appRoot, gameRoomId)),
  );
} else if (wantsLeaderboard) {
  setTitleKey('profile.leaderboard');
  void mountOrReport(() =>
    import('./profile.js').then(({ mountLeaderboard }) => mountLeaderboard(appRoot)),
  );
} else if (wantsRatingStats) {
  setTitleKey('profile.ratingStats');
  void mountOrReport(() =>
    import('./profile.js').then(({ mountRatingStats }) => mountRatingStats(appRoot)),
  );
} else if (analysisVariant) {
  setTitle(t('analysis.pageTitle', { variant: analysisVariantLabel(analysisVariant) }));
  void mountOrReport(() =>
    import('./analysis-page.js').then(({ mountAnalysisPage }) =>
      mountAnalysisPage(appRoot, analysisVariant),
    ),
  );
} else if (editorVariant) {
  setTitle(t('editor.pageTitle', { variant: analysisVariantLabel(editorVariant) }));
  void mountOrReport(() =>
    import('./editor/editor-page.js').then(({ mountEditorPage }) =>
      mountEditorPage(appRoot, editorVariant),
    ),
  );
} else if (wantsPractice) {
  setTitleKey('nav.practice');
  void mountOrReport(() =>
    import('./practice-index.js').then(({ mountPracticeIndex }) => {
      mountPracticeIndex(appRoot);
    }),
  );
} else if (wantsStudyIndex) {
  setTitleKey('nav.studies');
  void mountOrReport(() =>
    import('./study-index.js').then(({ mountStudyIndex }) => {
      mountStudyIndex(appRoot);
    }),
  );
} else if (studyId) {
  setTitleKey('nav.studies');
  void mountOrReport(() =>
    import('./study.js').then(({ mountStudy }) => {
      mountStudy(appRoot, studyId, studyChapterId ?? undefined);
    }),
  );
} else if (wantsXiangqiImport) {
  setTitle('Import a game');
  void mountOrReport(() =>
    import('./xiangqi-import-page.js').then(({ mountXiangqiImport }) =>
      mountXiangqiImport(appRoot),
    ),
  );
} else if (wantsCurrentGames) {
  setTitleKey('nav.currentGames');
  void mountOrReport(() =>
    import('./current-games.js').then(({ mountCurrentGames }) => mountCurrentGames(appRoot)),
  );
} else if (wantsHistoricalXiangqiSearch) {
  setTitle('Xiangqi game search');
  void mountOrReport(() =>
    import('./historical-xiangqi-search.js').then(({ mountHistoricalXiangqiSearch }) =>
      mountHistoricalXiangqiSearch(appRoot),
    ),
  );
} else if (historicalXiangqiGameId) {
  setTitle('Xiangqi game');
  void mountOrReport(() =>
    import('./historical-xiangqi-postgame.js').then(({ mountHistoricalXiangqiPostgame }) => {
      mountHistoricalXiangqiPostgame(appRoot, historicalXiangqiGameId);
    }),
  );
} else if (wantsDatabase) {
  setTitle('Game database');
  void mountOrReport(() =>
    import('./database.js').then(({ mountDatabase }) => mountDatabase(appRoot)),
  );
} else if (wantsStats) {
  setTitle('Statistics');
  void mountOrReport(() =>
    import('./metrics.js').then(({ mountMetrics }) => mountMetrics(appRoot, { admin: false })),
  );
} else if (wantsMetrics) {
  setTitle('Metrics');
  void mountOrReport(() =>
    import('./metrics.js').then(({ mountMetrics }) => mountMetrics(appRoot, { admin: true })),
  );
} else if (wantsVerifyTitle) {
  setTitleKey('verifyTitle.heading');
  void mountOrReport(() =>
    import('./verify-title.js').then(({ mountVerifyTitle }) => mountVerifyTitle(appRoot)),
  );
} else if (wantsStreamer) {
  setTitleKey('streamer.heading');
  void mountOrReport(() =>
    import('./streamer.js').then(({ mountStreamer }) => mountStreamer(appRoot)),
  );
} else if (wantsCoachEdit) {
  setTitleKey('coach.editHeading');
  void mountOrReport(() =>
    import('./coach-edit.js').then(({ mountCoachEdit }) => mountCoachEdit(appRoot)),
  );
} else if (wantsCoach) {
  if (coachHandle) {
    setTitle(`@${coachHandle}`);
  } else {
    setTitleKey('coach.heading');
  }
  void mountOrReport(() =>
    import('./coach.js').then(({ mountCoach }) => mountCoach(appRoot, coachHandle)),
  );
} else if (wantsTitlesAdmin) {
  setTitle('Title verification');
  void mountOrReport(() =>
    import('./titles-admin.js').then(({ mountTitlesAdmin }) => mountTitlesAdmin(appRoot)),
  );
} else if (wantsReadoutsAdmin) {
  setTitle('Readouts');
  void mountOrReport(() =>
    import('./readouts-admin.js').then(({ mountReadoutsAdmin }) => mountReadoutsAdmin(appRoot)),
  );
} else if (wantsAccountsAdmin) {
  setTitle('Accounts');
  void mountOrReport(() =>
    import('./accounts-admin.js').then(({ mountAccountsAdmin }) => mountAccountsAdmin(appRoot)),
  );
} else if (wantsEngines) {
  setTitle('Engines');
  void mountOrReport(() =>
    import('./engines.js').then(({ mountEngines }) => mountEngines(appRoot)),
  );
} else if (engineProfileId) {
  setTitle('Engine');
  void mountOrReport(() =>
    import('./engine-profile.js').then(({ mountEngineProfile }) =>
      mountEngineProfile(appRoot, engineProfileId),
    ),
  );
} else if (wantsBots) {
  setTitleKey('profile.bots');
  void mountOrReport(() => import('./bots.js').then(({ mountBots }) => mountBots(appRoot)));
} else if (botProfileId) {
  setTitle('Bot');
  void mountOrReport(() =>
    import('./bots.js').then(({ mountBotProfile }) => mountBotProfile(appRoot, botProfileId)),
  );
} else if (profileHandle) {
  setTitle(`@${profileHandle}`);
  void mountOrReport(() =>
    import('./profile.js').then(({ mountProfile }) => mountProfile(appRoot, profileHandle)),
  );
} else if (wantsAccountSettings) {
  setTitleKey('account.settings');
  void mountOrReport(() =>
    import('./account.js').then(({ mountAccountSettings }) => mountAccountSettings(appRoot)),
  );
} else if (wantsAccount) {
  setTitleKey('account.account');
  void mountOrReport(() =>
    import('./account.js').then(({ mountAccount }) => mountAccount(appRoot)),
  );
} else if (wantsFollowing) {
  setTitleKey('nav.friends');
  void mountOrReport(() =>
    import('./following.js').then(({ mountFollowing }) => mountFollowing(appRoot)),
  );
} else if (wantsInboxReports) {
  setTitle('Message reports');
  void mountOrReport(() =>
    import('./inbox.js').then(({ mountInboxReports }) => mountInboxReports(appRoot)),
  );
} else if (wantsInbox) {
  setTitleKey('inbox.title');
  void mountOrReport(() =>
    import('./inbox.js').then(({ mountInbox }) => mountInbox(appRoot, inboxHandle)),
  );
} else if (wantsCorrespondence) {
  setTitle('Correspondence');
  void mountOrReport(() =>
    import('./correspondence.js').then(({ mountCorrespondence }) => mountCorrespondence(appRoot)),
  );
} else if (challengeId) {
  setTitle('Challenge');
  void mountOrReport(() =>
    import('./challenge-accept.js').then(({ mountChallengeAccept }) =>
      mountChallengeAccept(appRoot, challengeId),
    ),
  );
} else if (wantsWatch) {
  setTitleKey('nav.watch');
  void mountOrReport(() =>
    import('./watch-route.js').then(({ mountWatch }) => mountWatch(appRoot)),
  );
} else if (wantsVideos) {
  setTitleKey('nav.videoLibrary');
  void mountOrReport(() => import('./videos.js').then(({ mountVideos }) => mountVideos(appRoot)));
} else if (wantsXiangqiBroadcastIndex) {
  setTitle('Xiangqi broadcasts');
  void mountOrReport(() =>
    import('./xiangqi-broadcast.js').then(({ mountXiangqiBroadcastIndex }) =>
      mountXiangqiBroadcastIndex(appRoot),
    ),
  );
} else if (wantsXiangqiBroadcastOps) {
  setTitle('Xiangqi broadcast ops');
  void mountOrReport(() =>
    import('./xiangqi-broadcast-ops.js').then(({ mountXiangqiBroadcastOps }) =>
      mountXiangqiBroadcastOps(appRoot),
    ),
  );
} else if (xiangqiBroadcastBoardId) {
  setTitle('Xiangqi broadcast');
  void mountOrReport(() =>
    import('./xiangqi-broadcast.js').then(({ mountXiangqiBroadcastBoard }) =>
      mountXiangqiBroadcastBoard(appRoot, xiangqiBroadcastBoardId),
    ),
  );
} else if (xiangqiBroadcastRound) {
  setTitle('Xiangqi broadcast');
  void mountOrReport(() =>
    import('./xiangqi-broadcast.js').then(({ mountXiangqiBroadcastRound }) =>
      mountXiangqiBroadcastRound(
        appRoot,
        xiangqiBroadcastRound.tourSlug,
        xiangqiBroadcastRound.roundId,
      ),
    ),
  );
} else if (xiangqiBroadcastTourSlug) {
  setTitle('Xiangqi broadcast');
  void mountOrReport(() =>
    import('./xiangqi-broadcast.js').then(({ mountXiangqiBroadcastTour }) =>
      mountXiangqiBroadcastTour(appRoot, xiangqiBroadcastTourSlug),
    ),
  );
} else if (wantsPuzzles) {
  setTitleKey('nav.puzzles');
  void mountOrReport(() =>
    import('./puzzles.js').then(({ mountPuzzles }) => mountPuzzles(appRoot, puzzleId)),
  );
} else if (wantsJungleCuesLab) {
  setTitle('Jungle movement cues');
  void mountOrReport(() =>
    import('./jungle-cues-lab.js').then(({ mountJungleCuesLab }) => mountJungleCuesLab(appRoot)),
  );
} else if (wantsShowcaseSheet) {
  setTitle('Showcase sheet');
  void mountOrReport(() =>
    import('./showcase-sheet.js').then(({ mountShowcaseSheet }) => mountShowcaseSheet(appRoot)),
  );
} else if (wantsGameSheet) {
  setTitle('Game sheet');
  void mountOrReport(() =>
    import('./game-sheet.js').then(({ mountGameSheet }) => mountGameSheet(appRoot)),
  );
} else if (wantsSoundLab) {
  setTitle('Sound lab');
  void mountOrReport(() =>
    import('./sound-lab.js').then(({ mountSoundLab }) => mountSoundLab(appRoot)),
  );
} else if (wantsLegacyPlay) {
  window.history.replaceState(null, '', '/');
  void mountOrReport(() =>
    import('./landing.js').then(({ mountLanding }) => mountLanding(appRoot)),
  );
} else if (articleSlug) {
  setTitleKey('articles.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountArticle }) =>
      mountArticle(appRoot, articleSlug, articleLang),
    ),
  );
} else if (wantsNews) {
  setTitleKey('news.feedHeading');
  void mountOrReport(() => import('./pages-static.js').then(({ mountNews }) => mountNews(appRoot)));
} else if (forumRedirectPostId) {
  setTitle('Forum');
  void mountOrReport(() =>
    import('./forum.js').then(({ mountForumPostRedirect }) =>
      mountForumPostRedirect(appRoot, forumRedirectPostId),
    ),
  );
} else if (forumTopicId) {
  setTitle('Forum');
  void mountOrReport(() =>
    import('./forum.js').then(({ mountForumTopic }) => mountForumTopic(appRoot, forumTopicId)),
  );
} else if (wantsForumReports) {
  setTitle('Forum reports');
  void mountOrReport(() =>
    import('./forum.js').then(({ mountForumReports }) => mountForumReports(appRoot)),
  );
} else if (wantsForumEtiquette) {
  setTitle('Forum etiquette');
  void mountOrReport(() =>
    import('./forum.js').then(({ mountForumEtiquette }) => mountForumEtiquette(appRoot)),
  );
} else if (wantsForum) {
  setTitle('Forum');
  void mountOrReport(() => import('./forum.js').then(({ mountForum }) => mountForum(appRoot)));
} else if (wantsArticlesIndex) {
  setTitleKey('articles.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountArticlesIndex }) =>
      mountArticlesIndex(appRoot, articleLang, articleIndexView ?? 'mistboard'),
    ),
  );
} else if (wantsRulesIndex) {
  setTitleKey('rules.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountRulesIndex }) =>
      mountRulesIndex(appRoot, articleLang),
    ),
  );
} else if (embedRoute?.kind === 'study') {
  const studyRoute = embedRoute.route;
  // `?ply=N` was parsed but only ever reached the GAME embed, so a study
  // embed silently ignored it and always opened on move one. A chapter
  // linked to make a point about one move should be able to open on it.
  const studyPly = embedPlyFromSearch(window.location.search);
  void mountOrReport(() =>
    import('./embed/embed-study-page.js').then(({ mountEmbedStudy }) =>
      mountEmbedStudy(appRoot, studyRoute, { startPly: studyPly }),
    ),
  );
} else if (embedRoute?.kind === 'game') {
  const gameRoute = embedRoute.route;
  const startPly = embedPlyFromSearch(window.location.search);
  const pov = embedPovFromSearch(window.location.search);
  void mountOrReport(() =>
    import('./embed/embed-game-page.js').then(({ mountEmbedGame }) =>
      mountEmbedGame(appRoot, gameRoute, { startPly, pov }),
    ),
  );
} else if (embedRoute?.kind === 'tv') {
  const channel = embedChannelFromSearch(window.location.search);
  void mountOrReport(() =>
    import('./embed/embed-tv-page.js').then(({ mountEmbedTv }) =>
      mountEmbedTv(appRoot, { channel }),
    ),
  );
} else if (embedRoute?.kind === 'puzzle') {
  const puzzleRoute = embedRoute.route;
  void mountOrReport(() =>
    import('./embed/embed-puzzle-page.js').then(({ mountEmbedPuzzle }) =>
      mountEmbedPuzzle(appRoot, puzzleRoute),
    ),
  );
} else if (embedRoute?.kind === 'analysis') {
  const color = embedColorFromSearch(window.location.search);
  void mountOrReport(() =>
    import('./embed/embed-analysis-page.js').then(({ mountEmbedAnalysis }) =>
      mountEmbedAnalysis(appRoot, { color }),
    ),
  );
} else if (wantsLearnXiangqi) {
  setTitleKey('nav.learn');
  void mountOrReport(() =>
    import('./learn-xiangqi/learn-xiangqi-page.js').then(({ mountLearnXiangqi }) =>
      mountLearnXiangqi(appRoot),
    ),
  );
} else if (wantsNotationTrainer) {
  setTitleKey('nav.learn');
  void mountOrReport(() =>
    import('./notation-trainer/notation-trainer-page.js').then(({ mountNotationTrainer }) =>
      mountNotationTrainer(appRoot),
    ),
  );
} else if (wantsAbout) {
  setTitleKey('footer.about');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountAbout }) => mountAbout(appRoot)),
  );
} else if (wantsSource) {
  setTitleKey('source.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountSource }) => mountSource(appRoot)),
  );
} else if (wantsContact) {
  setTitleKey('contact.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountContact }) => mountContact(appRoot)),
  );
} else if (wantsPatron) {
  setTitleKey('patron.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountPatron }) => mountPatron(appRoot)),
  );
} else if (wantsFaq) {
  setTitleKey('faq.heading');
  void mountOrReport(() => import('./pages-static.js').then(({ mountFaq }) => mountFaq(appRoot)));
} else if (wantsTerms) {
  setTitleKey('footer.terms');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountTerms }) => mountTerms(appRoot)),
  );
} else if (wantsPrivacy) {
  setTitleKey('footer.privacy');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountPrivacy }) => mountPrivacy(appRoot)),
  );
} else if (wantsContribute) {
  setTitleKey('contribute.heading');
  void mountOrReport(() =>
    import('./contribute-page.js').then(({ mountContribute }) => mountContribute(appRoot)),
  );
} else if (wantsDevelopers) {
  setTitleKey('developers.heading');
  void mountOrReport(() =>
    import('./developers-page.js').then(({ mountDevelopers }) => mountDevelopers(appRoot)),
  );
} else if (wantsApiDocs) {
  setTitleKey('apiDocs.heading');
  void mountOrReport(() =>
    import('./api-docs-page.js').then(({ mountApiDocs }) => mountApiDocs(appRoot)),
  );
} else if (wantsThanks) {
  setTitleKey('thanks.heading');
  void mountOrReport(() =>
    import('./thanks-page.js').then(({ mountThanks }) => mountThanks(appRoot)),
  );
} else if (wantsLag) {
  setTitleKey('lag.heading');
  void mountOrReport(() => import('./lag-page.js').then(({ mountLag }) => mountLag(appRoot)));
} else if (path === '/') {
  void mountOrReport(() =>
    import('./landing.js').then(({ mountLanding }) => mountLanding(appRoot)),
  );
} else {
  setTitleKey('notFound.heading');
  void mountOrReport(() =>
    import('./pages-static.js').then(({ mountNotFound }) => mountNotFound(appRoot)),
  );
}

// Global friends-online widget (bottom-corner). Route-agnostic and self-gating
// (it no-ops for anonymous viewers), so it mounts once regardless of the page
// that rendered above. Lazy-imported so its bundle only loads when the flag is
// on.
// Not in an embed: it self-gates by asking /api/auth/me who the viewer is, and
// that question is the one an embed must not ask from inside a third party's
// page. It was also the last thing still asking it after the guard above.
if (friendsOnlineEnabled() && !isEmbedDocument) {
  void localeReady.then(() =>
    import('./friends-online.js').then(({ mountFriendsOnline }) => mountFriendsOnline()),
  );
}

function setTitle(page: string): void {
  document.title = `${page} · Mistboard`;
}

function setTitleKey(key: I18nKey): void {
  // Localized titles wait for the locale chunk so zh visitors never see an
  // English tab title stick around; for English this resolves immediately.
  void localeReady.then(() => setTitle(t(key, {}, currentLocale())));
}

async function mountOrReport(run: () => Promise<void>): Promise<void> {
  try {
    // Every page mount renders through t(), so the locale chunk gates all of
    // them here; awaiting the resolved promise is free for English visitors.
    await localeReady;
    await run();
    clearChunkReloadAttempt();
  } catch (err) {
    console.error(err);
    if (reloadForChunkLoadError(err)) return;
    // Surface the swallowed mount failure to Error Tracking. Without this the
    // friendly "Page failed to load" panel below is the ONLY trace of a broken
    // route (e.g. a stale /game/<tenant-id> link 403ing on the chess shell) —
    // handled errors never reach posthog's automatic $exception hook.
    captureException(err, { context: 'route_mount', path: window.location.pathname });
    appRoot.replaceChildren();
    appRoot.classList.add('landing-page');
    const shell = document.createElement('main');
    shell.className = 'site-section app-error-panel';
    const heading = document.createElement('h1');
    heading.className = 'site-section-heading';
    heading.textContent = 'Page failed to load';
    const detail = document.createElement('pre');
    detail.textContent = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'landing-cta-primary';
    reload.textContent = 'Reload';
    reload.addEventListener('click', () => {
      clearChunkReloadAttempt();
      location.reload();
    });
    shell.append(heading, detail, reload);
    appRoot.append(shell);
  }
}

function gameRoomIdFromPath(value: string): string | null {
  const match = value.match(/^\/game\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function studyChapterRouteFromPath(value: string): { studyId: string; chapterId: string } | null {
  const match = value.match(/^(?:\/(?:zh-hans|zh-hant))?\/study\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)$/);
  return match ? { studyId: match[1]!, chapterId: match[2]! } : null;
}

// Variant-tenant postgame routes (<gameRouteBase>/:roomId) resolve through the
// web registry; a miss falls through to the chess routes. Tenants without a
// postgame surface (dark-chess correspondence) are skipped the same way.
function tenantPostgameFromPath(value: string): {
  tenant: WebVariantTenant;
  mount: NonNullable<WebVariantTenant['mountPostgame']>;
  roomId: string;
} | null {
  for (const tenant of webVariantTenants()) {
    if (!tenant.gameRouteBase || !tenant.mountPostgame) continue;
    const prefix = `${tenant.gameRouteBase}/`;
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    if (!rest || rest.includes('/')) continue;
    return { tenant, mount: tenant.mountPostgame.bind(tenant), roomId: decodeURIComponent(rest) };
  }
  return null;
}

// Canonical tenant postgame URL for a room-id reached via the legacy /game/:id
// route, or null when the id is a chess-family game that belongs on /game/:id.
// Resolves the tenant by room-id prefix; a tenant with a postgame surface
// (gameRouteBase + mountPostgame) owns the replay, so /game/<its id> is a stale
// link that must redirect there rather than 403 on the chess shell.
function tenantRedirectForGameRoomId(roomId: string): string | null {
  const tenant = webVariantTenantForRoomId(roomId);
  if (!tenant?.gameRouteBase || !tenant.mountPostgame || !tenant.enabled()) return null;
  return `${tenant.gameRouteBase}/${encodeURIComponent(roomId)}`;
}

function liveRoomIdFromPath(value: string): string | null {
  if (value === '/room') return 'dev-room';
  const match = value.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function puzzleIdFromPath(value: string): string | null {
  const match = value.match(/^\/puzzles\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function xiangqiBroadcastTourSlugFromPath(value: string): string | null {
  const match = value.match(/^\/broadcast\/xiangqi\/([^/]+)$/);
  if (!match || match[1] === 'board') return null;
  return decodeURIComponent(match[1]!);
}

function xiangqiBroadcastRoundFromPath(value: string): {
  tourSlug: string;
  roundId: string;
} | null {
  const match = value.match(/^\/broadcast\/xiangqi\/([^/]+)\/round\/([^/]+)$/);
  return match
    ? { tourSlug: decodeURIComponent(match[1]!), roundId: decodeURIComponent(match[2]!) }
    : null;
}

function xiangqiBroadcastBoardIdFromPath(value: string): string | null {
  const match = value.match(/^\/broadcast\/xiangqi\/board\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function historicalXiangqiGameIdFromPath(value: string): string | null {
  const match = value.match(/^\/historical-xiangqi\/game\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function profileHandleFromPath(value: string): string | null {
  const match = value.match(/^\/@\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function forumCategorySlugFromPath(value: string): string | null {
  const match = value.match(/^\/forum\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function forumTopicIdFromPath(value: string): string | null {
  const match = value.match(/^\/forum\/t\/([^/]+)(?:\/[^/]+)?$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function forumRedirectPostIdFromPath(value: string): string | null {
  const match = value.match(/^\/forum\/redirect\/post\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]!) : null;
}

// Article + rules-doc routes accept an optional language prefix:
// /zh-han[st]/{blog,rules}/<slug>. Rules docs and blog posts share the same
// renderer; only the URL base differs. The slug parser strips the lang prefix
// and matches either base (but NOT the bare /rules or /blog index, which
// have no slug segment); the lang parser reports the prefix.
function articleSlugFromPath(value: string): string | null {
  const match = value.replace(/^\/zh-han[st]/, '').match(/^\/(?:blog|rules)\/([^/]+)$/);
  const slug = match ? decodeURIComponent(match[1]!) : null;
  return slug === 'community' && value.includes('/blog/') ? null : slug;
}

function articleIndexViewFromPath(value: string): import('./articles.js').ArticleIndexView | null {
  const normalized = value.replace(/^\/zh-han[st]/, '');
  if (normalized === '/blog') return 'mistboard';
  if (normalized === '/blog/community') return 'community';
  return null;
}

function articleLangFromPath(value: string): ArticleLang | null {
  if (value === '/zh-hans/rules' || value.startsWith('/zh-hans/rules/')) return 'zh-Hans';
  if (value === '/zh-hant/rules' || value.startsWith('/zh-hant/rules/')) return 'zh-Hant';
  if (value === '/zh-hans/blog' || value.startsWith('/zh-hans/blog/')) return 'zh-Hans';
  if (value === '/zh-hant/blog' || value.startsWith('/zh-hant/blog/')) return 'zh-Hant';
  return null;
}
