import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  type GameEvent,
  type GameProjection,
  maybeGameSpecForId,
  replayGameEvents,
  type VisibilityRulesId,
} from '@mistboard/game';

// Visibility rule: a finished game is public via replay endpoints; a LIVE game
// is observable only when its spec hides nothing (liveObservePolicy === 'open').
// Enforced at two layers — connection accept (canObserveLiveRoom) and replay
// HTTP (eventReplayResponse).

export type GameAccessMode = 'pvp' | 'pve' | 'eve' | 'imported' | 'manual';

type RuntimeEnvKey =
  | 'MISTBOARD_ADMIN_DEBUG_TOKEN'
  | 'MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE'
  | 'MISTBOARD_ALLOWED_ORIGINS'
  | 'MISTBOARD_ABORT_POLICY_SWEEP_MS'
  | 'MISTBOARD_DRAIN_TOKEN'
  | 'MISTBOARD_GUEST_PRESTART_ABORT_MS'
  | 'MISTBOARD_REQUIRE_DATABASE'
  | 'MISTBOARD_TRUSTED_PROXY_HOPS'
  | 'NODE_ENV'
  | 'RAILWAY_ENVIRONMENT'
  | 'RAILWAY_ENVIRONMENT_NAME'
  | 'RAILWAY_SERVICE_NAME';

export type RuntimeEnv = Partial<Record<RuntimeEnvKey, string>>;

export type EventReplayResponse =
  | { status: 200; body: { events: GameEvent[] } }
  | { status: 403; body: { error: 'game_not_public' } }
  | { status: 404; body: { error: 'not_found' } };

export function eventReplayResponse(events: GameEvent[] | null): EventReplayResponse {
  if (!events) return { status: 404, body: { error: 'not_found' } };
  if (canExposeFullEventReplay(events)) return { status: 200, body: { events } };
  return { status: 403, body: { error: 'game_not_public' } };
}

export function canExposeFullEventReplay(events: GameEvent[]): boolean {
  try {
    return replayGameEvents(events).state.status.type === 'finished';
  } catch {
    // Unknown or non-chess room-family event logs are not public replay data.
    return false;
  }
}

export function modeForProjection(projection: GameProjection): GameAccessMode {
  const whiteIsEngine = isServerEngineClient(projection.seats.white);
  const blackIsEngine = isServerEngineClient(projection.seats.black);
  if (whiteIsEngine && blackIsEngine) return 'eve';
  if (whiteIsEngine !== blackIsEngine) return 'pve';
  return 'pvp';
}

export function isServerEngineClient(clientId: string | undefined): boolean {
  if (!clientId) return false;
  return (
    clientId === 'random-engine' ||
    clientId === 'engine:white' ||
    clientId === 'engine:black' ||
    clientId.startsWith('engine:') ||
    clientId.startsWith('builtin-') ||
    clientId.startsWith('python-')
  );
}

// May a non-seated client join this room's socket? A finished game is public for
// every spec (the replay/review surfaces already serve it). An IN-PROGRESS game is
// observable only when the spec hides NOTHING.
//
// This is deliberately STRICTER than canServeLiveBoard, which also admits the
// symmetric hidden-identity variants (banqi, jungle-flip). The difference is not
// about what may be seen — the masked board leaks nothing either way — but about
// what is BUILT: Mistboard TV constructs the masked spectator payload itself
// (see the per-tenant live watch payload builders), while the socket path would
// hand a spectator whatever viewForClient returns, and for those tenants that is
// still an EMPTY board (`/room/` never reveals). Admitting a spectator here would
// therefore trade a clean refusal for a blank board. Widen this to
// canServeLiveBoard once the tenants serve spectators their masked view.
export function canObserveRoom(isFinished: boolean, gameSpecId: string): boolean {
  if (isFinished) return true;
  const spec = maybeGameSpecForId(gameSpecId);
  if (!spec) return false;
  return liveObservePolicy(spec.visibility) === 'open';
}

// GameProjection-shaped wrapper for the legacy chess room path. Variant-tenant
// rooms carry their own projection type and call canObserveRoom directly, so both
// socket paths decide admission with the same predicate.
export function canObserveLiveRoom(projection: GameProjection, gameSpecId: string): boolean {
  return canObserveRoom(projection.state.status.type === 'finished', gameSpecId);
}

// Per-visibility-class live-observation policy for Mistboard TV. This is the
// single decision point for whether an IN-PROGRESS game's board may leave the
// server, keyed on the spec's visibility axis and exhaustive over it (a new
// VisibilityRulesId member fails the build until it gets an explicit branch —
// the same fail-closed rule as variant dispatch):
//   'open'   — nothing is hidden; the live board is servable to anyone.
//   'masked' — hidden information exists and the redacted view a spectator would
//              need differs from what at least one PLAYER sees, so serving it is
//              a leak (or a design question) we have not answered.
//   'sealed' — fog: hidden information exists and any pre-completion release
//              leaks it (even time-delayed truth is intel to a live player).
//              Fog games reach TV only via the finished-game replay path.
export type LiveObservePolicy = 'open' | 'masked' | 'sealed';

// The 'hidden-identity' visibility class covers two structurally different games,
// and only one of them can go live (split 2026-07-26; the merged class is why a
// Flip Jungle game could never reach the homepage board):
//
//   SYMMETRIC — the mask is identical for BOTH seats (banqi, jungle-flip: a
//   face-down tile hides its identity from everyone, and the per-seat views
//   differ only in whose turn it is). A spectator board built from either seat's
//   masked view therefore shows exactly what both players already see, so it
//   leaks nothing. These serve live.
//
//   ASYMMETRIC — each player knows something the other does not (luzhanqi: you
//   see your own ranks; jieqi: a capturer learns the role of what it
//   took). There is no single view that is honest to both seats, so a spectator
//   board would have to pick a side. These stay masked until that surface exists.
//
// Explicit and exhaustive over the hidden-identity specs: a new one fails
// hiddenIdentityLiveObservePolicy's key check in watch-live.test.ts until it is
// classified here, and an unclassified spec falls through to 'masked'.
const SYMMETRIC_HIDDEN_IDENTITY_SPEC_IDS = ['banqi', 'jungle-flip'] as const;
const ASYMMETRIC_HIDDEN_IDENTITY_SPEC_IDS = ['jieqi', 'luzhanqi'] as const;

export const HIDDEN_IDENTITY_LIVE_OBSERVE: Readonly<Record<string, LiveObservePolicy>> = {
  ...Object.fromEntries(SYMMETRIC_HIDDEN_IDENTITY_SPEC_IDS.map((id) => [id, 'open' as const])),
  ...Object.fromEntries(ASYMMETRIC_HIDDEN_IDENTITY_SPEC_IDS.map((id) => [id, 'masked' as const])),
};

export function liveObservePolicy(
  visibility: VisibilityRulesId,
  gameSpecId?: string,
): LiveObservePolicy {
  switch (visibility) {
    case 'open':
      return 'open';
    case 'hidden-identity':
      // Unknown/unclassified hidden-identity specs fail closed to 'masked'.
      return (gameSpecId && HIDDEN_IDENTITY_LIVE_OBSERVE[gameSpecId]) || 'masked';
    case 'dark':
      return 'sealed';
    case 'concealed-hands':
      // Mahjong. A spectator could legitimately see the discards and the melds,
      // which are public the moment they are made, so the eventual answer here
      // is 'masked'. Until a masked view exists and has been tested, serve no
      // live board at all: a concealed hand leaking to a spectator is the same
      // class of failure as a fogged piece leaking, and this fails closed.
      return 'sealed';
  }
}

// True only when a live (in-progress) board for this spec may be served to a
// spectator surface. Unknown/unparseable spec ids refuse (fail-closed).
export function canServeLiveBoard(gameSpecId: string): boolean {
  const spec = maybeGameSpecForId(gameSpecId);
  if (!spec) return false;
  return liveObservePolicy(spec.visibility, spec.id) === 'open';
}

// What a room serves a given client, keyed on the spec's visibility class and
// the game's status. This is the executable form of the signed-off matrix in
// docs-private/spectator-visibility-matrix.md, and it is the ONE place that
// decision lives: both the legacy chess payload path and the variant tenants
// consult it, so the two can never disagree about when a fog board opens up.
//
//   'truth'       — canonical state. Only ever returned for a FINISHED game,
//                   which is exactly what /game/:id already serves to any
//                   signed-out stranger, so this reveals nothing new.
//   'own-view'    — the seat's redacted view; what that player legitimately knows.
//   'public-view' — what a neutral observer infers from play alone. Narrower
//                   than either seat's view for asymmetric variants.
//   'nothing'     — no board at all.
//
// The `finished` argument MUST come from canonical projection state. It is the
// single line separating "reveal a completed game" from "reveal a live fog
// game", which is the only catastrophic failure in this table.
export type RoomViewPolicy = 'truth' | 'own-view' | 'public-view' | 'nothing';

export function roomViewPolicy(
  visibility: VisibilityRulesId,
  finished: boolean,
  seat: 'player' | 'spectator',
): RoomViewPolicy {
  // Every visibility class opens fully at completion, for players and
  // spectators alike (Brian, 2026-09-06). Before this, the room never revealed
  // at any status and the public reveal lived only at /game/:id, which left a
  // shared room link showing a blank board.
  if (finished) return 'truth';
  switch (visibility) {
    case 'open':
      // Nothing is hidden by the rules, so there is nothing to redact.
      return 'truth';
    case 'hidden-identity':
      return seat === 'player' ? 'own-view' : 'public-view';
    case 'dark':
      // The invariant: a live fog board never leaves the server for anyone but
      // the seat that owns it.
      return seat === 'player' ? 'own-view' : 'nothing';
    case 'concealed-hands':
      // Mahjong (added to the union after the matrix was signed). A live hand
      // is the same class of secret as a fogged piece: the seat sees its own,
      // a spectator sees nothing, matching liveObservePolicy's 'sealed'. The
      // mahjong tenant declares no truthView, so the runtime fails closed
      // before this row is consulted; the row exists so the switch stays
      // total and a future truthView inherits the right live answer.
      return seat === 'player' ? 'own-view' : 'nothing';
  }
}

// SPA fallback allowlist. The web client owns these routes (see apps/web/src/main.ts);
// the server must hand them index.html so direct hits and refreshes don't 404. Keep in
// sync with main.ts — server-policy.test.ts covers literal-route parity, and
// apps/web/src/variant-registry-sync.test.ts covers the per-tenant game/review routes.
// Page routes that were renamed, mapped to their canonical path. A renamed page
// keeps exactly one hop here rather than staying a live client route, so there
// is a single canonical URL for crawlers and one place to see what moved.
//
// /historical-xiangqi named the historical corpus, which is one of the three
// sources the games database lists (broadcast boards and games played here are
// the others), so the old path read as a much narrower surface than the page is.
// The database sat at /games from 2026-08-13 until /games became the
// current-games page (lichess: /games is what is being played now, /games/search
// is the database), so the hop now lands on /games/search. The per-game detail
// path is deliberately absent: /historical-xiangqi/game/:id still serves the
// archive review shell and the opening explorer links into it.
export function legacyPageRedirect(pathname: string): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized === '/historical-xiangqi' || normalized === '/historical-xiangqi/games') {
    return '/games/search';
  }
  // The announcement archive answers on two paths. /feed is canonical (every
  // internal link points there); /news served the identical page, so the pair
  // read as duplicates to a crawler. One permanent hop, no canonical tag.
  if (normalized === '/news') return '/feed';
  return null;
}

// The games database's filter links carried their query on /games for three
// weeks (2026-08-13 to 2026-09-02). A hit on /games with any database parameter
// is one of those links, not the current-games page, so it hops to
// /games/search with the query intact. A bare /games, or /games with the
// current-games page's own parameters, stays put.
const GAMES_SEARCH_QUERY_KEYS: readonly string[] = [
  'player',
  'event',
  'source',
  'result',
  'from',
  'to',
  'plyMin',
  'plyMax',
  'sort',
  'offset',
  'limit',
];

export function gamesSearchQueryRedirect(pathname: string, search: string): string | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (normalized !== '/games' || !search || search === '?') return null;
  const params = new URLSearchParams(search);
  return GAMES_SEARCH_QUERY_KEYS.some((key) => params.has(key)) ? `/games/search${search}` : null;
}

/**
 * Paths served to be embedded in a third-party page. Everything else on this
 * site is same-origin only; these are deliberately frameable, so the patterns
 * are narrow on purpose: a study chapter or a finished game by id, the live
 * board, a puzzle, the analysis board, and nothing else. The web side mirrors
 * this list in embed/embed-route.ts.
 */
export function isEmbedRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    /^\/embed\/study\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/.test(normalized) ||
    // A finished game, by room id. The page only ever shows what the public
    // review page already shows (the summary and events endpoints apply the
    // post-terminal reveal gate), so framing it widens nothing.
    /^\/embed\/game\/[A-Za-z0-9_-]{1,64}$/.test(normalized) ||
    // The live board (a channel's featured game, else its last finished one),
    // today's puzzle or one by id, and the xiangqi analysis board. Each shows
    // only what the anonymous public sees on /watch, /puzzles and /analysis.
    normalized === '/embed/tv' ||
    /^\/embed\/puzzle(?:\/[A-Za-z0-9_-]{1,64})?$/.test(normalized) ||
    /^\/embed\/analysis(?:\/xiangqi)?$/.test(normalized)
  );
}

export function isClientRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    normalized === '/about' ||
    // The legacy /learn hub is intentionally NOT here: it is gated off in the
    // web build (learnEnabled), so a prod direct hit falls through to the
    // branded 404 shell instead of booting a dead route. /learn/xiangqi (the
    // ungated xiangqi course) stays a client route.
    normalized === '/learn/xiangqi' ||
    // /embed/study/:studyId/:chapterId — the one route on this site meant to be
    // rendered inside someone else's page. It is a client route like any other;
    // what makes it an embed is that the framing headers let it be framed and
    // the page renders the board alone (see isEmbedRoute).
    isEmbedRoute(normalized) ||
    normalized === '/rules' ||
    normalized === '/zh-hans/rules' ||
    normalized === '/zh-hant/rules' ||
    normalized === '/play' ||
    normalized === '/watch' ||
    normalized === '/videos' ||
    normalized === '/zh-hans/videos' ||
    normalized === '/zh-hant/videos' ||
    normalized === '/streamer' ||
    normalized === '/puzzles' ||
    normalized === '/source' ||
    normalized === '/contact' ||
    normalized === '/patron' ||
    normalized === '/faq' ||
    normalized === '/terms' ||
    normalized === '/privacy' ||
    normalized === '/contribute' ||
    normalized === '/developers' ||
    normalized === '/api-docs' ||
    normalized === '/thanks' ||
    normalized === '/lag' ||
    normalized === '/account' ||
    normalized === '/account/settings' ||
    normalized.startsWith('/account/settings/') ||
    normalized === '/inbox' ||
    normalized.startsWith('/inbox/') ||
    normalized === '/following' ||
    normalized === '/correspondence' ||
    normalized.startsWith('/challenge/') ||
    normalized === '/player' ||
    normalized === '/player/rating-stats' ||
    normalized === '/leaderboard' ||
    normalized === '/news' ||
    normalized === '/feed' ||
    normalized === '/forum' ||
    normalized === '/forum/reports' ||
    normalized === '/forum/etiquette' ||
    normalized === '/database' ||
    normalized === '/stats' ||
    normalized === '/metrics' ||
    normalized === '/verify-title' ||
    normalized === '/titles' ||
    // Coach directory: /coach (list), /coach/edit (own editor), /coach/:handle
    // (public detail). All three are SPA client routes (apps/web/src/coach.ts).
    normalized === '/coach' ||
    normalized.startsWith('/coach/') ||
    // Current games (/games: everything in progress right now) and the games
    // database (/games/search). The /historical-xiangqi index paths 301 to the
    // database in server-http and are not client routes any more. The per-game
    // detail path (/historical-xiangqi/game/:id) is unchanged and still below.
    normalized === '/games' ||
    normalized === '/games/search' ||
    // Import: paste a game, land on the analysis board. Mints nothing, so it
    // needs no server route of its own beyond being served the SPA shell.
    normalized === '/import' ||
    normalized === '/engines' ||
    normalized === '/accounts' ||
    normalized === '/readouts' ||
    normalized === '/bots' ||
    normalized === '/xiangqi-demo' ||
    normalized === '/blog' ||
    normalized === '/zh-hans/blog' ||
    normalized === '/zh-hant/blog' ||
    normalized.startsWith('/blog/') ||
    normalized.startsWith('/puzzles/') ||
    normalized.startsWith('/zh-hans/blog/') ||
    normalized.startsWith('/zh-hant/blog/') ||
    normalized.startsWith('/rules/') ||
    /^\/forum\/[^/]+$/.test(normalized) ||
    normalized.startsWith('/forum/t/') ||
    normalized.startsWith('/forum/redirect/post/') ||
    normalized === '/broadcast/xiangqi' ||
    normalized === '/broadcast/xiangqi/ops' ||
    /^\/broadcast\/xiangqi\/(?!board$)[^/]+$/.test(normalized) ||
    /^\/broadcast\/xiangqi\/[^/]+\/round\/[^/]+$/.test(normalized) ||
    /^\/broadcast\/xiangqi\/board\/[^/]+$/.test(normalized) ||
    normalized.startsWith('/zh-hans/rules/') ||
    normalized.startsWith('/zh-hant/rules/') ||
    normalized.startsWith('/xiangqi/game/') ||
    normalized.startsWith('/historical-xiangqi/game/') ||
    normalized.startsWith('/dark-xiangqi/game/') ||
    normalized.startsWith('/banqi/game/') ||
    normalized.startsWith('/jungle/game/') ||
    normalized.startsWith('/jungle-flip/game/') ||
    normalized.startsWith('/jieqi/game/') ||
    normalized.startsWith('/dark-crazyhouse/game/') ||
    normalized.startsWith('/kriegspiel/game/') ||
    normalized.startsWith('/fortress-xiangqi/game/') ||
    normalized.startsWith('/duck-xiangqi/game/') ||
    normalized.startsWith('/game/') ||
    // Study browse index (/study) + persisted study chapters. The study pages
    // serves the review SPA shell + mounts the ceval engine, so it is also a
    // review-shell route (COOP/COEP) below; the bare index is a plain client page.
    // The practice index is a plain client page: it lists curated studies and
    // mounts no board, so unlike /study/:id it is not a review-shell route.
    normalized === '/practice' ||
    normalized === '/study' ||
    /^\/study\/[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?$/.test(normalized) ||
    // Locale-prefixed study permalinks (/zh-hans/study/:id) serve the same SPA
    // shell with localized meta; without these they would 404.
    /^\/(?:zh-hans|zh-hant)\/study\/[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?$/.test(normalized) ||
    // Standalone analysis board: bare /analysis (opens the flagship variant) or
    // /analysis/:variant, fed by a move list rather than a room. Serves the
    // review SPA shell and mounts the ceval engine, so it must also be a
    // review-shell route (COOP/COEP) below.
    /^\/analysis(?:\/[a-z0-9-]+)?$/.test(normalized) ||
    // Board editor: bare /editor (the flagship) or /editor/:variant, the same
    // catalog as /analysis. Plain client page: no engine, so not a review-shell
    // route.
    /^\/editor(?:\/[a-z0-9-]+)?$/.test(normalized) ||
    // /engine/:id is the admin engine-profile SPA page (single segment). Deeper
    // paths like /engine/fairy-stockfish/stockfish.js are vendored ceval assets
    // and MUST fall through to the static handler, not the index.html rewrite.
    /^\/engine\/[^/]+$/.test(normalized) ||
    normalized.startsWith('/bot/') ||
    normalized.startsWith('/@/') ||
    normalized.startsWith('/room/')
  );
}

// Client routes that must never appear in a search index: the signed-in surface
// (auth, settings, inbox) and the per-account feeds, whose content is either
// per-account or empty to a crawler.
//
// /feed is NOT one of them and was removed 2026-08-27. Its name put it in this
// list on 2026-08-14, but it is the public announcement archive (the same class
// of page as /blog), not a personalised timeline, and it had been carrying a
// noindex while every internal link on the site pointed at it.
//
// These are already absent from the sitemap, which is not sufficient — a
// sitemap invites crawling, it does not forbid it, and Search Console showed
// /account?tab=login and /following picking up impressions on brand queries in
// the 90 days to 2026-08-14. A login page as a search result is the
// visible symptom; the quieter cost is that a dozen thin account pages compete
// with the real pages for the same query.
//
// robots.txt Disallow is the wrong tool here. These URLs are already indexed,
// and disallowing them would block the recrawl that is required to *see* the
// noindex, freezing them in the index instead of removing them. Serve the tag
// and let the crawler act on it.
//
// Deliberately excluded: /player, /source, /leaderboard, /privacy and /terms.
// The first two are in the sitemap on purpose and the rest are ordinary public
// pages — thin is not the same as private.
export function isNoindexRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    normalized === '/account' ||
    normalized === '/account/settings' ||
    normalized.startsWith('/account/settings/') ||
    normalized === '/inbox' ||
    normalized.startsWith('/inbox/') ||
    normalized === '/following' ||
    normalized === '/correspondence' ||
    normalized.startsWith('/challenge/')
  );
}

// Review-shell document routes: the postgame board at /game/:id and each
// /<variant>/game/:id, the standalone analysis board /analysis/:variant, study
// pages, and the puzzle trainer /puzzles(/:id). These serve a SPA shell that can
// mount the in-browser analysis engine (WASM threads, SharedArrayBuffer, which
// requires cross-origin isolation). server-http sends COOP/COEP on exactly these
// responses so the isolation stays scoped to these surfaces. Live /room/ routes
// are deliberately excluded: the engine is postgame-only, and isolation there
// would buy nothing.
//
// Both /puzzles (the list) and /puzzles/:id are included: cross-origin isolation
// is fixed at document-load time and client-side pushState navigation between
// puzzles does not re-request the document, so whichever puzzle URL the user
// first loads must already carry the headers for the post-completion engine to
// run. COEP is `credentialless` (see server-http), so isolating the puzzle page
// does not force CORP on its cross-origin subresources.
//
// Keep the single optional variant segment in sync with the /<variant>/game/
// tenants in isClientRoute above.
export function isReviewShellRoute(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return (
    /^(?:\/[a-z0-9-]+)?\/game\/[^/]+$/.test(normalized) ||
    /^\/historical-xiangqi\/game\/[^/]+$/.test(normalized) ||
    /^\/analysis(?:\/[a-z0-9-]+)?$/.test(normalized) ||
    // Both the bare and locale-prefixed study permalinks mount the ceval engine,
    // so both need the COOP/COEP headers or SharedArrayBuffer silently goes away
    // on the localized URL only.
    /^(?:\/(?:zh-hans|zh-hant))?\/study\/[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?$/.test(normalized) ||
    normalized === '/puzzles' ||
    /^\/puzzles\/[^/]+$/.test(normalized)
  );
}

export function adminDebugTokenFromProtocolHeader(
  value: string | string[] | undefined,
): string | undefined {
  return tokenFromProtocolHeader(value, 'mistboard-admin-debug.');
}

export function seatTokenFromProtocolHeader(
  value: string | string[] | undefined,
): string | undefined {
  return tokenFromProtocolHeader(value, 'mistboard-seat.');
}

function tokenFromProtocolHeader(
  value: string | string[] | undefined,
  prefix: string,
): string | undefined {
  const header = Array.isArray(value) ? value.join(',') : value;
  if (!header) return undefined;
  return header
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

export function isAdminDebugToken(
  candidate: string | undefined,
  env: RuntimeEnv = process.env,
): boolean {
  const expected = env.MISTBOARD_ADMIN_DEBUG_TOKEN;
  if (!expected || !candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Drain-token check. Uses a SEPARATE env var from the debug token so a leak in
// either secret doesn't escalate. Constant-time compare. See
// docs/server-restart-pause-resume.md (Security & hardening).
export function isDrainToken(
  candidate: string | undefined,
  env: RuntimeEnv = process.env,
): boolean {
  const expected = env.MISTBOARD_DRAIN_TOKEN;
  if (!expected || !candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function isDatabaseRequired(env: RuntimeEnv = process.env): boolean {
  if (parseBooleanEnv(env.MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE)) return false;
  if (parseBooleanEnv(env.MISTBOARD_REQUIRE_DATABASE)) return true;
  return isProductionLikeRuntime(env);
}

export function isProductionLikeRuntime(env: RuntimeEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'production' ||
    env.RAILWAY_ENVIRONMENT === 'production' ||
    env.RAILWAY_ENVIRONMENT_NAME === 'production' ||
    env.RAILWAY_SERVICE_NAME !== undefined
  );
}

export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  host: string | undefined,
  env: RuntimeEnv = process.env,
): boolean {
  if (!isProductionLikeRuntime(env)) return true;
  if (!origin) return false;
  return allowedWebSocketOrigins(host, env).has(origin);
}

export function allowedWebSocketOrigins(
  host: string | undefined,
  env: RuntimeEnv = process.env,
): Set<string> {
  const configured = parseCsvEnv(env.MISTBOARD_ALLOWED_ORIGINS);
  if (configured.length > 0) return new Set(configured);
  return host ? new Set([`https://${host}`]) : new Set();
}

export function recordMessageTimestamp(
  timestamps: number[],
  now: number,
  limit: number,
  windowMs: number,
): boolean {
  const cutoff = now - windowMs;
  while (timestamps.length > 0 && timestamps[0]! < cutoff) timestamps.shift();
  timestamps.push(now);
  return timestamps.length <= limit;
}

export function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseNonNegativeInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

// Number of proxy hops in front of the server that we trust to have appended a
// correct client address to X-Forwarded-For. The trusted client IP is that many
// hops from the END of the list — everything to its left is client-supplied and
// must not be trusted. Defaults to 1, matching the Railway deployment (a single
// edge proxy). Set MISTBOARD_TRUSTED_PROXY_HOPS to the real depth if the request
// path changes. A value of 0 means "trust no forwarded hop" — use the socket
// address only.
export function trustedProxyHops(env: RuntimeEnv = process.env): number {
  return parseNonNegativeInteger(env.MISTBOARD_TRUSTED_PROXY_HOPS) ?? 1;
}

// True if `ip` is private, loopback, link-local, CGNAT, unspecified, or the
// 'unknown' sentinel — i.e. not a public address. A correctly-resolved client
// IP should be public, so a private one signals that MISTBOARD_TRUSTED_PROXY_HOPS
// no longer matches the real proxy topology. Handles IPv4, IPv6, and IPv4-mapped
// IPv6 (::ffff:a.b.c.d).
export function isPrivateOrReservedIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return true;
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith('[')) addr = addr.slice(1);
  if (addr.endsWith(']')) addr = addr.slice(0, -1);
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) addr = mapped[1]!;

  if (addr.includes(':')) {
    if (addr === '::1' || addr === '::') return true; // loopback / unspecified
    const head = Number.parseInt(addr.split(':')[0] ?? '', 16);
    if (Number.isNaN(head)) return true; // unparseable → not a usable public addr
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
  }

  const octets = addr.split('.');
  if (octets.length !== 4) return true;
  const o = octets.map((p) => Number.parseInt(p, 10));
  if (o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = o as number[];
  if (a === 10 || a === 127 || a === 0) return true; // 10/8, loopback, 0/8
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 172 && b! >= 16 && b! <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 100 && b! >= 64 && b! <= 127) return true; // 100.64/10 CGNAT
  return false;
}

let cachedProxyTrustWarning: string | null = null;

// Returns a warning string if `ip` (resolved from X-Forwarded-For) is
// private/reserved in a production-like runtime — the signature of a proxy-depth
// misconfiguration — else null. Pure; the once-per-process side effect lives in
// clientIpForRateLimit.
export function proxyTrustWarningFor(
  ip: string,
  hops: number,
  env: RuntimeEnv = process.env,
): string | null {
  if (!isProductionLikeRuntime(env)) return null;
  if (!isPrivateOrReservedIp(ip)) return null;
  return (
    `[proxy-trust] client IP "${ip}" resolved from X-Forwarded-For is private/reserved; ` +
    `MISTBOARD_TRUSTED_PROXY_HOPS=${hops} likely no longer matches the real proxy depth. ` +
    `Rate-limit keys may collapse into one bucket (over-throttle), or if hops is too high the ` +
    `spoofable X-Forwarded-For prefix is being read (GHSA-3fx7 reopened). Verify the proxy topology.`
  );
}

// The first proxy-trust warning observed this process, or null. Exposed on
// /api/server-status so the proxy-depth assumption can be checked without log access.
export function getProxyTrustWarning(): string | null {
  return cachedProxyTrustWarning;
}

// Resolve the client IP used as a rate-limit / abuse key. We trust only the hop
// the proxy appended (counted from the right), never the leftmost hop, which is
// fully attacker-controlled: a client can send any X-Forwarded-For it likes, and
// the proxy only appends — it does not strip — so the first entry is spoofable.
// Reading the wrong end let an attacker rotate the header to land in a fresh
// bucket every request and bypass every per-IP limit. Falls back to the socket
// address when the header is missing, has too few hops, or hop trust is disabled,
// and to a stable 'unknown' so address-less requests still share one bucket
// rather than slipping past the limiter.
export function clientIpForRateLimit(
  request: Pick<IncomingMessage, 'headers' | 'socket'>,
  env: RuntimeEnv = process.env,
): string {
  const hops = trustedProxyHops(env);
  const header = request.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (hops > 0 && typeof raw === 'string' && raw.length > 0) {
    const forwarded = raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const trusted = forwarded[forwarded.length - hops];
    if (trusted) {
      if (cachedProxyTrustWarning === null) {
        const warning = proxyTrustWarningFor(trusted, hops, env);
        if (warning) {
          cachedProxyTrustWarning = warning;
          console.warn(warning);
        }
      }
      return trusted;
    }
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
