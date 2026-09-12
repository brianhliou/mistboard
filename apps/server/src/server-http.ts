import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomTimeControl, VariantId } from '@mistboard/game';
import serveHandler from 'serve-handler';
import { articleIsRetired } from './article-meta.js';
import { type HttpApiContext, handleApiRequest } from './http-api.js';
import { serveArticleOgImage, serveGameOgImage, serveStudyOgImage } from './og-image.js';
import { servePositionOgImage } from './og-position.js';
import * as persistence from './persistence.js';
import { RequestBodyTooLargeError } from './routes/lib.js';
import type { DrainController } from './server-drain.js';
import {
  clientIpForRateLimit,
  gamesSearchQueryRedirect,
  isClientRoute,
  isEmbedRoute,
  isReviewShellRoute,
  legacyPageRedirect,
} from './server-policy.js';
import {
  ARTICLE_META,
  serveArticlePage,
  serveArticlesIndexPage,
  serveGamePage,
  serveGoneShell,
  serveNotFoundShell,
  servePrerenderedPage,
  serveRulesIndexPage,
  serveSitemap,
  serveSpaShellWithRoutePreloads,
  serveStudyPage,
} from './server-static-pages.js';
import type { LobbyTicket, Room } from './server-types.js';
import { viewerCountryCookie, viewerCountryFromRequest } from './viewer-country.js';

export type PersistenceHealthEntry = {
  at: number;
  roomId: string;
  eventType: string;
};

type ServerHttpHandlerOptions = {
  rooms: Map<string, Room>;
  lobbyTickets: Map<string, LobbyTicket>;
  lobbyQueue: LobbyTicket[];
  databaseRequired: boolean;
  persistenceErrors: PersistenceHealthEntry[];
  pveBuiltinEngineClientId: string;
  annotationsFile: string;
  liveClockInitialMs: number;
  liveClockIncrementMs: number;
  staticDir: string;
  publicHost: string;
  drainController: DrainController;
  createRoom(
    mode: 'pvp' | 'pve',
    variant: VariantId,
    engineId: string,
    timeControl?: RoomTimeControl,
    rated?: boolean,
    options?: {
      randomSeating?: boolean;
      engineColor?: 'white' | 'black';
      engineReservationId?: string;
      creatorPreference?: 'white' | 'black';
      region?: string;
    },
  ): Promise<Room>;
  reserveLiveEngineSeat(engineId: string, color: 'white' | 'black'): Promise<string | null>;
  releaseLiveEngineReservation(reservationId: string, reason: string): void;
  abandonRoom(
    roomId: string,
    seatToken: string,
  ): Promise<
    { ok: true } | { ok: false; error: 'not_found' | 'unauthorized' | 'already_terminal' }
  >;
  inMemoryGameSummary(roomId: string): persistence.RecentEveGameRecord | null;
};

export function createHttpRequestHandler(options: ServerHttpHandlerOptions) {
  return function handleHttpRequest(request: IncomingMessage, response: ServerResponse): void {
    const url = request.url ?? '/';
    const pathname = url.split('?', 1)[0] ?? '/';

    // Framing policy. Every route on this site was frameable by anyone, which
    // is a clickjacking surface on every authenticated page: a hostile site
    // could overlay /account/settings or a challenge accept and harvest the
    // click. Same-origin is the default because the postgame sheet frames
    // /room/:id and the review URLs from our own pages.
    //
    // /embed/study/:studyId/:chapterId is the deliberate exception: it exists
    // to be rendered in someone else's page, so it opts out of both headers
    // rather than being locked down and then quietly failing to embed.
    //
    // Both headers on purpose: frame-ancestors is the one modern browsers
    // honour, X-Frame-Options is what older ones and some scanners read. The
    // pair only disagrees where the older one has no ancestor list to express,
    // which is why the allow case sends neither rather than a wildcard XFO
    // (there is no such value; UAs treat a malformed XFO as DENY).
    if (!isEmbedRoute(pathname)) {
      response.setHeader('X-Frame-Options', 'SAMEORIGIN');
      response.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    } else {
      // An embed shell lives in OTHER PEOPLE'S pages, and the static fallback
      // that serves it sets no Cache-Control and no ETag: only Last-Modified.
      // Chrome then applies heuristic freshness, roughly a tenth of the
      // Last-Modified age, and replays the response with no revalidation.
      //
      // That turns any momentarily-bad shell into a lasting one. On 2026-09-02
      // /embed/puzzle joined the allowlist above fourteen minutes before the
      // deploy carrying it went live; embedders who framed it inside that
      // window kept being handed the framing-blocked response back from disk
      // long after the fix shipped, through ordinary reloads. The same shape
      // applies to a shell pointing at chunk hashes a later deploy replaced.
      //
      // no-cache is "revalidate", not "do not store": the browser still keeps
      // it and still takes a 304, it just may not replay it unasked.
      response.setHeader('Cache-Control', 'no-cache');
    }

    // The postgame review shell mounts an in-browser analysis engine that runs
    // WASM threads, which need SharedArrayBuffer and therefore cross-origin
    // isolation. Send COOP/COEP on exactly the review document routes (set here,
    // before the various index.html handlers below, which only writeHead a
    // content-type and so preserve these). credentialless keeps our same-origin
    // bundle/engine assets working without forcing CORP on every subresource,
    // and leaves the rest of the site (patron's Stripe redirect, etc.)
    // non-isolated. See docs-private/analysis-board-track.md.
    if (isReviewShellRoute(pathname)) {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    }

    // Ceval engines run as dedicated workers (Fairy-Stockfish additionally as
    // emscripten pthreads). A dedicated worker only becomes cross-origin
    // isolated (and can accept the SharedArrayBuffer memory the main thread
    // hands it) when its OWN script response carries COEP; the document's
    // credentialless header does not extend to it, so the worker spawns
    // un-isolated and dies (pthreads: an opaque "pthread sent an error";
    // Chrome on COEP documents: ERR_BLOCKED_BY_RESPONSE before the script
    // runs). Serve ALL vendored engine assets (/engine/<pkg>/<file>) with
    // their own COEP + CORP so the workers isolate; matching on the deeper
    // segment keeps the /engine/:id admin document non-isolated. Scoping this
    // to one engine dir is how misty-* shipped broken in prod on 2026-07-15.
    // (Vite sets these on every dev response, which is why this class only
    // ever breaks in prod.) setHeader survives the static serve-handler's
    // writeHead merge, same as the review-document headers above.
    if (isIsolatedEngineAssetPath(pathname)) {
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    }

    // Page navigations carry the viewer's country (Cloudflare's CF-IPCountry)
    // to the client as a readable cookie, so the nav can skip links that are
    // dead ends there (Discord in mainland China). setHeader survives the
    // later writeHead merges, like the headers above; nothing else sets a
    // cookie on a page navigation.
    if (isPageNavigationRequest(request, pathname)) {
      const country = viewerCountryFromRequest(request);
      if (country) response.setHeader('set-cookie', viewerCountryCookie(country));
    }

    if (url === '/health') {
      void handleHealthRequest(options, response);
      return;
    }

    if (pathname === '/admin/drain' || pathname === '/admin/drain/cancel') {
      void options.drainController.handleRequest(request, response, pathname).catch((err) => {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'drain_handler_failure',
            error: (err as Error).message,
            at: Date.now(),
          }),
        );
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'internal_error' }));
        }
      });
      return;
    }

    if (url.startsWith('/api/')) {
      void handleApiRequest(buildApiContext(options), request, response).catch((err) => {
        // An oversized body is a client error, not a server fault: answering 500
        // sends the caller hunting a nonexistent bug (it cost a real debugging
        // session on the studies API), so map it to 413 and skip the error log.
        const tooLarge = err instanceof RequestBodyTooLargeError;
        if (!tooLarge) {
          console.error(
            JSON.stringify({
              level: 'error',
              kind: 'api_handler_failure',
              url,
              error: (err as Error).message,
              at: Date.now(),
            }),
          );
        }
        if (!response.headersSent) {
          response.writeHead(tooLarge ? 413 : 500, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ error: tooLarge ? 'request_body_too_large' : 'internal_error' }),
          );
        }
      });
      return;
    }

    // /og/position/:variant.png?fen=… — the card for a shared analysis or
    // editor position. Needs no persistence: the position is in the query.
    const positionOgMatch = pathname.match(/^\/og\/position\/([a-z0-9-]+)\.png$/);
    if (positionOgMatch) {
      const fen = new URLSearchParams(url.slice(pathname.length)).get('fen');
      void servePositionOgImage({
        variant: positionOgMatch[1]!,
        fen,
        response,
        renderKey: clientIpForRateLimit(request),
      }).catch((err: Error) => {
        console.warn('position og render failed', err.message);
        if (!response.headersSent) {
          response.writeHead(302, { location: '/og-image.png' });
          response.end();
        }
      });
      return;
    }

    const ogImageMatch = pathname.match(/^\/og\/game\/([^/]+)\.png$/);
    if (ogImageMatch && persistence.isInitialized()) {
      const roomId = decodeURIComponent(ogImageMatch[1]!);
      void serveGameOgImage(roomId, response).catch((err) => {
        console.warn('og image render failed', (err as Error).message);
        if (!response.headersSent) {
          response.writeHead(302, { location: '/og-image.png' });
          response.end();
        }
      });
      return;
    }

    // /og/study/:studyId.png and /og/study/:studyId/:chapterId.png. The chapter
    // form is what makes a shared composition preview as its own diagram; the
    // study form falls back to its first chapter.
    const studyOgMatch = pathname.match(/^\/og\/study\/([^/]+?)(?:\/([^/]+?))?\.png$/);
    if (studyOgMatch && persistence.isInitialized()) {
      void serveStudyOgImage({
        studyId: decodeURIComponent(studyOgMatch[1]!),
        chapterId: studyOgMatch[2] ? decodeURIComponent(studyOgMatch[2]) : undefined,
        response,
      }).catch((err: Error) => {
        console.warn('study og render failed', err.message);
        if (!response.headersSent) {
          response.writeHead(302, { location: '/og-image.png' });
          response.end();
        }
      });
      return;
    }

    const articleOgMatch = pathname.match(/^\/og\/article\/([^/]+)\.png$/);
    if (articleOgMatch) {
      const slug = decodeURIComponent(articleOgMatch[1]!);
      const meta = ARTICLE_META[slug];
      if (meta) {
        void serveArticleOgImage({
          slug,
          title: meta.title,
          kind: meta.kind,
          response,
          staticDir: options.staticDir,
        }).catch((err: Error) => {
          console.warn('article og render failed', err.message);
          if (!response.headersSent) {
            response.writeHead(302, { location: '/og-image.png' });
            response.end();
          }
        });
      } else {
        response.writeHead(302, { location: '/og-image.png' });
        response.end();
      }
      return;
    }

    if (pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(
        `User-agent: *\nAllow: /\nDisallow: /database\nDisallow: /engines\nDisallow: /accounts\nSitemap: ${options.publicHost}/sitemap.xml\n`,
      );
      return;
    }

    if (pathname === '/sitemap.xml') {
      void serveSitemap({
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
      }).catch(() => {
        response.writeHead(500);
        response.end();
      });
      return;
    }

    const gameRouteMatch = pathname.match(/^\/game\/([^/]+)$/);
    if (gameRouteMatch && persistence.isInitialized()) {
      const roomId = decodeURIComponent(gameRouteMatch[1]!);
      void serveGamePage({
        roomId,
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // /study/:id and /study/:id/:chapterId mirror /game/:id: a public study
    // bakes its own title/meta AND a server-rendered body into the shell
    // (crawlers + link previews); unlisted/private serve the plain shell.
    // Locale-prefixed forms get the same treatment. A chapter permalink is
    // resolved to that chapter so it carries its own title and prose rather
    // than repeating the study's on every one of its chapters.
    const studyRouteMatch = pathname.match(
      /^(?:\/(zh-hans|zh-hant))?\/study\/([^/]+)(?:\/([^/]+))?$/,
    );
    if (studyRouteMatch && persistence.isInitialized()) {
      const studyId = decodeURIComponent(studyRouteMatch[2]!);
      const localeSlug = studyRouteMatch[1] ?? 'en';
      const chapterId = studyRouteMatch[3] ? decodeURIComponent(studyRouteMatch[3]) : undefined;
      void serveStudyPage({
        studyId,
        chapterId,
        localeSlug: localeSlug as 'en' | 'zh-hans' | 'zh-hant',
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // The blog's RSS feed, written to dist/blog/feed.xml by the prerender. It
    // has to be claimed here because 'feed.xml' otherwise matches the
    // /blog/:slug article route below, which would answer a feed reader with
    // the SPA shell at 200 rather than 404ing.
    if (pathname === '/blog/feed.xml') {
      request.url = '/blog/feed.xml';
      void serveHandler(request, response, { public: options.staticDir });
      return;
    }

    // The community-posts view is a reserved blog index path, so it must win
    // over the generic /blog/:slug article route below.
    const blogIndexMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/blog(?:\/(community))?\/?$/);
    if (blogIndexMatch) {
      void serveArticlesIndexPage({
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
        langPrefix: blogIndexMatch[1],
        view: blogIndexMatch[2] === 'community' ? 'community' : 'mistboard',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    const blogRouteMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/blog\/([^/]+)$/);
    if (blogRouteMatch) {
      const langPrefix = blogRouteMatch[1];
      const slug = decodeURIComponent(blogRouteMatch[2]!);
      void serveArticlePage({
        slug,
        base: 'blog',
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
        langPrefix,
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // Legacy /articles/<slug> (the blog surface was renamed to /blog): the
    // 'articles' base is never canonical, so serveArticlePage 301s every hit to
    // the slug's /blog (or /rules) home, preserving any language prefix.
    const legacyArticleRouteMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/articles\/([^/]+)$/);
    if (legacyArticleRouteMatch) {
      const langPrefix = legacyArticleRouteMatch[1];
      const slug = decodeURIComponent(legacyArticleRouteMatch[2]!);
      void serveArticlePage({
        slug,
        base: 'articles',
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
        langPrefix,
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // Rules docs are canonical under /rules/<slug>; same renderer as articles,
    // with serveArticlePage 301ing any base/slug mismatch to the canonical path.
    const rulesArticleRouteMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/rules\/([^/]+)$/);
    if (rulesArticleRouteMatch) {
      const langPrefix = rulesArticleRouteMatch[1];
      const slug = decodeURIComponent(rulesArticleRouteMatch[2]!);
      if (articleIsRetired(slug)) {
        void serveGoneShell({ response, staticDir: options.staticDir }).catch(() => {
          request.url = '/';
          void serveHandler(request, response, { public: options.staticDir });
        });
        return;
      }
      void serveArticlePage({
        slug,
        base: 'rules',
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
        langPrefix,
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // Renamed page routes (see legacyPageRedirect): one permanent hop to the
    // canonical path so published links and crawler-cached URLs do not 404.
    // The games database's old filter links (/games?player=...) hop to
    // /games/search with their query; a bare /games is the current-games page.
    const search = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    const legacyPageTarget =
      gamesSearchQueryRedirect(pathname, search) ?? legacyPageRedirect(pathname);
    if (legacyPageTarget) {
      response.writeHead(301, { location: legacyPageTarget });
      response.end();
      return;
    }

    // Legacy /articles index (renamed to /blog): permanent redirect, preserving
    // any language prefix.
    const legacyArticlesIndexMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/articles\/?$/);
    if (legacyArticlesIndexMatch) {
      const langPrefix = legacyArticlesIndexMatch[1];
      response.writeHead(301, { location: `${langPrefix ? `/${langPrefix}` : ''}/blog` });
      response.end();
      return;
    }

    const rulesIndexMatch = pathname.match(/^(?:\/(zh-hans|zh-hant))?\/rules\/?$/);
    if (rulesIndexMatch) {
      void serveRulesIndexPage({
        response,
        publicHost: options.publicHost,
        staticDir: options.staticDir,
        langPrefix: rulesIndexMatch[1],
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    if (pathname === '/') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'home.html',
      }).catch(() => {
        // No prerendered home.html (e.g. an older build): fall back to the shell.
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // Default-locale player page gets its prerendered frame; localized paths
    // stay on the client-rendered shell below.
    if (pathname === '/player') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'player.html',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // The announcement archive, prerendered: static authored copy, so the baked
    // page is what a reader sees. /news redirects here (legacyPageRedirect).
    if (pathname === '/feed') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'feed.html',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // Default-locale learn page gets its prerendered stage map; localized
    // paths stay on the client-rendered shell below.
    if (pathname === '/learn/xiangqi') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'learn-xiangqi.html',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // The patron page, prerendered: it is the route that states what the site
    // sells and at what price, so it has to be readable without running the
    // SPA. Localized paths stay on the client-rendered shell below.
    if (pathname === '/patron') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'patron.html',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    // The puzzles landing page gets its prerendered explainer. Deep links
    // (/puzzles/:idOrShortCode) stay on the client-rendered shell: they open a
    // specific puzzle, so a baked landing frame would be wrong for them.
    if (pathname === '/puzzles') {
      void servePrerenderedPage({
        response,
        staticDir: options.staticDir,
        file: 'puzzles.html',
      }).catch(() => {
        request.url = '/';
        void serveHandler(request, response, { public: options.staticDir });
      });
      return;
    }

    if (pathname === '/leaderboard') {
      response.writeHead(308, { location: '/player' });
      response.end();
      return;
    }

    if (isClientRoute(pathname)) {
      // Known client route: serve the SPA shell with the route's chunk preloads
      // baked into <head> (issue #31) so a cold load fetches the route graph in
      // parallel with the entry instead of one round-trip after it, plus the
      // route's own title/description where it has one. Routes with neither a
      // manifest entry nor route meta fall back to the plain static shell
      // exactly as before.
      void serveSpaShellWithRoutePreloads({
        response,
        staticDir: options.staticDir,
        pathname,
        // The query string rides along for the position routes, whose share
        // meta depends on ?fen=.
        search: url.slice(pathname.length),
        publicHost: options.publicHost,
      })
        .catch(() => false)
        .then((served) => {
          if (served) return;
          request.url = '/';
          void serveHandler(request, response, { public: options.staticDir });
        });
      return;
    }

    // Unknown, non-asset page navigation (e.g. a mistyped or stale URL): serve
    // the SPA shell with a 404 so the client renders the branded not-found page
    // (nav + panel) instead of serve-handler's bare default 404. Requests for
    // missing *assets* (extensioned paths) fall through to serve-handler's real
    // asset 404 — handing back the HTML shell for a missing .js would break
    // caching and mask load failures.
    if (isPageNavigationRequest(request, pathname)) {
      void serveNotFoundShell({ response, staticDir: options.staticDir }).catch((err) => {
        console.warn('not-found shell render failed', (err as Error).message);
        if (!response.headersSent) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Not found');
        }
      });
      return;
    }

    void serveHandler(request, response, { public: options.staticDir });
  };
}

// Vendored ceval engine assets live at /engine/<pkg>/<file> (fairy-stockfish,
// misty-*, and any future engine). The deeper segment is what distinguishes
// them from the /engine/:id admin document, which must stay non-isolated.
export function isIsolatedEngineAssetPath(pathname: string): boolean {
  return /^\/engine\/[^/]+\//.test(pathname);
}

// A page navigation is an extensionless GET/HEAD whose Accept header asks for
// HTML (or is absent — direct address-bar hits and crawlers). Asset requests
// carry a file extension in the final path segment; those are excluded so they
// keep flowing to serve-handler and get a real 404 when absent.
export function isPageNavigationRequest(
  request: Pick<IncomingMessage, 'method' | 'headers'>,
  pathname: string,
): boolean {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return false;
  const lastSegment = pathname.split('/').pop() ?? '';
  if (lastSegment.includes('.')) return false;
  const accept = request.headers.accept ?? '';
  return accept === '' || accept.includes('text/html');
}

async function handleHealthRequest(
  options: Pick<ServerHttpHandlerOptions, 'databaseRequired' | 'persistenceErrors'>,
  response: ServerResponse,
): Promise<void> {
  const persistenceHealth = currentPersistenceHealth(options.persistenceErrors);
  const dbReachable = options.databaseRequired ? await persistence.probeDb() : true;
  const ok = persistenceHealth.count1m === 0 && dbReachable;
  response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      ok,
      databaseRequired: options.databaseRequired,
      persistence: persistence.isInitialized() ? 'enabled' : 'disabled',
      persistenceErrors: persistenceHealth,
    }),
  );
}

function buildApiContext(options: ServerHttpHandlerOptions): HttpApiContext {
  return {
    rooms: options.rooms,
    lobbyTickets: options.lobbyTickets,
    lobbyQueue: options.lobbyQueue,
    databaseRequired: options.databaseRequired,
    pveBuiltinEngineClientId: options.pveBuiltinEngineClientId,
    annotationsFile: options.annotationsFile,
    liveClockInitialMs: options.liveClockInitialMs,
    liveClockIncrementMs: options.liveClockIncrementMs,
    createRoom: options.createRoom,
    reserveLiveEngineSeat: options.reserveLiveEngineSeat,
    releaseLiveEngineReservation: options.releaseLiveEngineReservation,
    abandonRoom: options.abandonRoom,
    inMemoryGameSummary: options.inMemoryGameSummary,
    isDraining: options.drainController.isDraining,
    drainDeadlineMs: options.drainController.drainDeadlineMs,
    restartPhase: options.drainController.restartPhase,
    activeGameCount: options.drainController.activeGameCount,
    deployGateCensus: options.drainController.deployGateCensus,
    persistenceHealth: () => currentPersistenceHealth(options.persistenceErrors),
  };
}

function currentPersistenceHealth(persistenceErrors: readonly PersistenceHealthEntry[]): {
  count1m: number;
  lastAt: number | null;
} {
  const cutoff1m = Date.now() - 60_000;
  const recent = persistenceErrors.filter((entry) => entry.at > cutoff1m);
  const lastAt =
    persistenceErrors.length > 0 ? persistenceErrors[persistenceErrors.length - 1]!.at : null;
  return { count1m: recent.length, lastAt };
}
