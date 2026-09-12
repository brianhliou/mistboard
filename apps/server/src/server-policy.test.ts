import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createClock, expireClock, type GameEvent, replayGameEvents } from '@mistboard/game';
import {
  adminDebugTokenFromProtocolHeader,
  canExposeFullEventReplay,
  canObserveLiveRoom,
  canServeLiveBoard,
  eventReplayResponse,
  isAdminDebugToken,
  isAllowedWebSocketOrigin,
  isClientRoute,
  isDatabaseRequired,
  isDrainToken,
  isNoindexRoute,
  isPrivateOrReservedIp,
  isReviewShellRoute,
  legacyPageRedirect,
  proxyTrustWarningFor,
  type RuntimeEnv,
  recordMessageTimestamp,
  seatTokenFromProtocolHeader,
} from './server-policy.js';
import { SITEMAP_STATIC_ROUTES } from './server-static-pages.js';

test('live persisted events are not public replay data', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'live-room', variant: 'dark-chess', offer: [] },
    {
      type: 'move-played',
      at: 2,
      roomId: 'live-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];

  assert.equal(canExposeFullEventReplay(events), false);
  assert.deepEqual(eventReplayResponse(events), {
    status: 403,
    body: { error: 'game_not_public' },
  });
});

test('unknown room-family event logs fail closed for replay APIs', () => {
  const events = [
    { type: 'room-created', at: 1, roomId: 'dxq-policy', gameSpecId: 'dark-xiangqi' },
  ] as unknown as GameEvent[];

  assert.equal(canExposeFullEventReplay(events), false);
  assert.deepEqual(eventReplayResponse(events), {
    status: 403,
    body: { error: 'game_not_public' },
  });
});

test('finished Dark Xiangqi event logs stay out of the generic chess replay API', () => {
  const events = [
    { type: 'room-created', at: 1, roomId: 'dxq-postgame', gameSpecId: 'dark-xiangqi' },
    {
      type: 'seat-resigned',
      at: 2,
      roomId: 'dxq-postgame',
      color: 'red',
    },
  ] as unknown as GameEvent[];

  assert.equal(canExposeFullEventReplay(events), false);
  assert.deepEqual(eventReplayResponse(events), {
    status: 403,
    body: { error: 'game_not_public' },
  });
});

test('live replay API returns 403 for every mode (PvP, PvE, EvE)', () => {
  // Uniform rule: live games are private to the seated players regardless of
  // mode. The replay endpoint only exposes finished games.
  const pvp: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'pvp-live', variant: 'dark-chess', offer: [] },
    { type: 'seat-assigned', at: 1, roomId: 'pvp-live', clientId: 'human-white', seat: 'white' },
    { type: 'seat-assigned', at: 1, roomId: 'pvp-live', clientId: 'human-black', seat: 'black' },
    {
      type: 'move-played',
      at: 2,
      roomId: 'pvp-live',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  const pve: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'pve-live', variant: 'dark-chess', offer: [] },
    { type: 'seat-assigned', at: 1, roomId: 'pve-live', clientId: 'human-white', seat: 'white' },
    { type: 'seat-assigned', at: 1, roomId: 'pve-live', clientId: 'random-engine', seat: 'black' },
    {
      type: 'move-played',
      at: 2,
      roomId: 'pve-live',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 3,
      roomId: 'pve-live',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ];
  const eve: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'eve-live', variant: 'dark-chess', offer: [] },
    { type: 'seat-assigned', at: 1, roomId: 'eve-live', clientId: 'engine:white', seat: 'white' },
    { type: 'seat-assigned', at: 1, roomId: 'eve-live', clientId: 'engine:black', seat: 'black' },
    {
      type: 'move-played',
      at: 2,
      roomId: 'eve-live',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];

  for (const events of [pvp, pve, eve]) {
    assert.equal(canExposeFullEventReplay(events), false);
    assert.deepEqual(eventReplayResponse(events), {
      status: 403,
      body: { error: 'game_not_public' },
    });
  }
});

test('canObserveLiveRoom keeps a LIVE fog room closed for every mode, and opens it when finished', () => {
  const roomCreated: GameEvent = {
    type: 'room-created',
    at: 1,
    roomId: 'policy-room',
    variant: 'dark-chess',
    offer: [],
  };

  // Live PvP: no observation.
  assert.equal(canObserveLiveRoom(replayGameEvents([roomCreated]), 'dark-chess'), false);
  // Live PvE: no observation (changed — was true under the per-mode rule).
  assert.equal(
    canObserveLiveRoom(
      replayGameEvents([
        roomCreated,
        {
          type: 'seat-assigned',
          at: 1,
          roomId: 'policy-room',
          clientId: 'human-white',
          seat: 'white',
        },
        {
          type: 'seat-assigned',
          at: 1,
          roomId: 'policy-room',
          clientId: 'random-engine',
          seat: 'black',
        },
      ]),
      'dark-chess',
    ),
    false,
  );
  // Live EvE: no observation (changed — was true under the per-mode rule).
  assert.equal(
    canObserveLiveRoom(
      replayGameEvents([
        roomCreated,
        {
          type: 'seat-assigned',
          at: 1,
          roomId: 'policy-room',
          clientId: 'engine:white',
          seat: 'white',
        },
        {
          type: 'seat-assigned',
          at: 1,
          roomId: 'policy-room',
          clientId: 'engine:black',
          seat: 'black',
        },
      ]),
      'dark-chess',
    ),
    false,
  );
  // Finished game (any mode): observation allowed via replay.
  const clock = expireClock(createClock(1, 1, 0), 2, 'white');
  assert.ok(clock);
  assert.equal(
    canObserveLiveRoom(
      replayGameEvents([
        roomCreated,
        { type: 'clock-expired', at: 2, roomId: 'policy-room', color: 'white', clock },
      ]),
      'dark-chess',
    ),
    true,
  );
});

test('canObserveLiveRoom admits a live room iff the spec hides nothing', () => {
  // The room URL now asks the same question Mistboard TV asks before broadcasting
  // (liveObservePolicy), instead of being blanket-closed to every live game.
  const live = (gameSpecId: string): boolean =>
    canObserveLiveRoom(
      replayGameEvents([
        { type: 'room-created', at: 1, roomId: 'policy-room', variant: 'dark-chess', offer: [] },
      ]),
      gameSpecId,
    );

  // 'open': nothing hidden, so a live board is servable to anyone.
  assert.equal(live('xiangqi'), true);
  assert.equal(live('jungle'), true);
  assert.equal(live('fortress-xiangqi'), true);
  // Hidden-identity stays closed on the SOCKET path even where Mistboard TV can
  // now broadcast it (banqi, jungle-flip): TV builds the masked payload itself,
  // while viewForClient still hands a socket spectator an EMPTY board, so
  // admitting one would trade a clean refusal for a blank board.
  assert.equal(live('jungle-flip'), false);
  assert.equal(live('banqi'), false);
  assert.equal(canServeLiveBoard('jungle-flip'), true, 'TV may still broadcast it');
  assert.equal(canServeLiveBoard('banqi'), true, 'TV may still broadcast it');
  // Asymmetric hidden-identity: closed on both surfaces.
  assert.equal(live('jieqi'), false);
  assert.equal(canServeLiveBoard('jieqi'), false);
  // 'sealed': fog leaks on any pre-completion release.
  assert.equal(live('dark-xiangqi'), false);
  // Fail-closed on an id the spec registry cannot resolve.
  assert.equal(live('not-a-real-variant'), false);
});

test('finished persisted events are public replay data', () => {
  const clock = expireClock(createClock(1, 1, 0), 2, 'white');
  assert.ok(clock);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'finished-room', variant: 'dark-chess', offer: [] },
    { type: 'clock-expired', at: 2, roomId: 'finished-room', color: 'white', clock },
  ];

  assert.equal(canExposeFullEventReplay(events), true);
  assert.deepEqual(eventReplayResponse(events), { status: 200, body: { events } });
});

test('missing persisted events return not found for replay API', () => {
  assert.deepEqual(eventReplayResponse(null), { status: 404, body: { error: 'not_found' } });
});

test('production-like runtime requires database unless explicitly allowed', () => {
  assert.equal(isDatabaseRequired({ NODE_ENV: 'production' }), true);
  assert.equal(isDatabaseRequired({ RAILWAY_SERVICE_NAME: 'mistboard' }), true);
  assert.equal(
    isDatabaseRequired({ NODE_ENV: 'production', MISTBOARD_ALLOW_IN_MEMORY_PERSISTENCE: 'true' }),
    false,
  );
  assert.equal(isDatabaseRequired({ MISTBOARD_REQUIRE_DATABASE: '1' }), true);
  assert.equal(isDatabaseRequired({}), false);
});

test('admin debug token is required and constant-length checked', () => {
  const env: RuntimeEnv = { MISTBOARD_ADMIN_DEBUG_TOKEN: 'secret-admin-token' };

  assert.equal(isAdminDebugToken(undefined, env), false);
  assert.equal(isAdminDebugToken('wrong', env), false);
  assert.equal(isAdminDebugToken('secret-admin-token', env), true);
  assert.equal(isAdminDebugToken('secret-admin-token', {}), false);
});

test('drain token is separate from debug token and constant-length checked', () => {
  const env: RuntimeEnv = { MISTBOARD_DRAIN_TOKEN: 'secret-drain-token' };

  assert.equal(isDrainToken(undefined, env), false);
  assert.equal(isDrainToken('wrong', env), false);
  assert.equal(isDrainToken('secret-drain-token', env), true);
  assert.equal(isDrainToken('secret-drain-token', {}), false);
  // Debug token must NOT validate as drain token, even with same value.
  const mixed: RuntimeEnv = { MISTBOARD_ADMIN_DEBUG_TOKEN: 'secret-drain-token' };
  assert.equal(isDrainToken('secret-drain-token', mixed), false);
});

test('admin debug token can be read from a websocket subprotocol header', () => {
  assert.equal(
    adminDebugTokenFromProtocolHeader('foo, mistboard-admin-debug.secret-admin-token, bar'),
    'secret-admin-token',
  );
  assert.equal(
    adminDebugTokenFromProtocolHeader(['foo', 'mistboard-admin-debug.secret-admin-token']),
    'secret-admin-token',
  );
  assert.equal(adminDebugTokenFromProtocolHeader('foo, bar'), undefined);
});

test('seat token can be read from a websocket subprotocol header', () => {
  assert.equal(
    seatTokenFromProtocolHeader('foo, mistboard-seat.seat-token-123, bar'),
    'seat-token-123',
  );
  assert.equal(
    seatTokenFromProtocolHeader(['foo', 'mistboard-seat.seat-token-456']),
    'seat-token-456',
  );
  assert.equal(seatTokenFromProtocolHeader('foo, bar'), undefined);
});

test('production websocket origin defaults to https host and supports explicit allowlist', () => {
  const prod: RuntimeEnv = { NODE_ENV: 'production' };

  assert.equal(isAllowedWebSocketOrigin(undefined, 'mistboard.com', prod), false);
  assert.equal(isAllowedWebSocketOrigin('http://mistboard.com', 'mistboard.com', prod), false);
  assert.equal(isAllowedWebSocketOrigin('https://mistboard.com', 'mistboard.com', prod), true);
  assert.equal(
    isAllowedWebSocketOrigin('https://staging.mistboard.com', 'mistboard.com', {
      ...prod,
      MISTBOARD_ALLOWED_ORIGINS: 'https://mistboard.com, https://staging.mistboard.com',
    }),
    true,
  );
  assert.equal(isAllowedWebSocketOrigin(undefined, 'localhost:3001', {}), true);
});

test('websocket message rate window rejects over-limit bursts and recovers after window', () => {
  const timestamps: number[] = [];

  assert.equal(recordMessageTimestamp(timestamps, 1_000, 2, 1_000), true);
  assert.equal(recordMessageTimestamp(timestamps, 1_100, 2, 1_000), true);
  assert.equal(recordMessageTimestamp(timestamps, 1_200, 2, 1_000), false);
  assert.equal(recordMessageTimestamp(timestamps, 2_300, 2, 1_000), true);
  assert.deepEqual(timestamps, [2_300]);
});

// Parity: every literal client route in apps/web/src/main.ts must be in the SPA
// fallback allowlist. Static parse of main.ts catches the bug class where a new
// route is wired client-side but the server still 404s direct hits.
// Intentionally-parked or DEV-only client routes that should NOT 200 in prod.
const PARKED_CLIENT_ROUTES = new Set<string>([
  '/xiangqi-spike', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/pixel-lab', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/variant-marks', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/sound-lab', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/jungle-cues', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/deepdive', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/engine-review', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/showcase-sheet', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/postgame-sheet', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/game-sheet', // DEV-only (renamed postgame-sheet); gated by import.meta.env.DEV in main.ts
  '/dobutsu-chess-preview', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/dobutsu-ui-preview', // DEV-only; gated by import.meta.env.DEV in main.ts
  '/learn/coordinates', // coordinate trainer; parked, gated off in prod (coordinateTrainerEnabled)
]);

function readMainTsSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const mainPath = resolve(here, '..', '..', 'web', 'src', 'main.ts');
  return readFileSync(mainPath, 'utf-8');
}

test('isClientRoute covers every literal route declared in main.ts', () => {
  const source = readMainTsSource();
  // Matches `path === '/foo'` or `path === '/foo/bar'` — the canonical pattern
  // for top-level routes in main.ts (e.g. wantsAbout, wantsContact). Parametric
  // routes matched against `path` (regex + startsWith) are parsed by the
  // parametric-matcher test below; helper functions at the bottom of main.ts
  // match against their own `value` parameter and are exercised by the explicit
  // parametric-route assertions.
  const literalRoutes = Array.from(source.matchAll(/path === '(\/[^']*)'/g))
    .map((match) => match[1]!)
    // `/` is served as the static index.html itself, no SPA fallback needed.
    .filter((route) => route !== '/' && !PARKED_CLIENT_ROUTES.has(route));
  assert.ok(literalRoutes.length > 0, 'expected to find literal routes in main.ts');
  for (const route of literalRoutes) {
    assert.equal(
      isClientRoute(route),
      true,
      `main.ts routes ${route} client-side but server isClientRoute() returns 404`,
    );
  }
});

// Sample paths for every parametric route matcher main.ts applies to `path`.
// Keys are the regex sources exactly as written in main.ts; the test below
// extracts the matchers from the source and fails when one has no sample here,
// so a new parametric route cannot ship without isClientRoute parity coverage
// (the bug class: /study/:id had no parity assert at all).
const PARAMETRIC_ROUTE_SAMPLES: Record<string, readonly string[]> = {
  '^\\/inbox(?:\\/([^/]+))?$': ['/inbox', '/inbox/somehandle'],
  '^\\/coach(?:\\/([^/]+))?$': ['/coach', '/coach/somehandle'],
  '^(?:\\/(?:zh-hans|zh-hant))?\\/study\\/([A-Za-z0-9]+)$': [
    '/study/Ab12cd',
    '/zh-hans/study/Ab12cd',
    '/zh-hant/study/Ab12cd',
  ],
};

test('isClientRoute covers every parametric route matcher declared in main.ts', () => {
  const source = readMainTsSource();

  // Top-level parametric routes in main.ts are expressed against `path` in
  // three shapes: `path.match(/regex/)`, `/regex/.exec(path)`, and
  // `path.startsWith('/prefix/')`. Extract all three. Parser limitation: the
  // regex extraction reads lazily up to the closing `/)`; a future route regex
  // containing that character pair would be truncated, land outside the sample
  // map, and fail this test loudly (asking for a sample) rather than silently
  // passing.
  const regexSources = [
    ...source.matchAll(/path\.match\(\/(.*?)\/\)/g),
    ...source.matchAll(/\/(\^.*?)\/\.exec\(path\)/g),
  ].map((match) => match[1]!);
  assert.ok(regexSources.length >= 3, 'expected regex route matchers in main.ts');
  for (const regexSource of regexSources) {
    const samples = PARAMETRIC_ROUTE_SAMPLES[regexSource];
    assert.ok(
      samples,
      `main.ts matches paths against /${regexSource}/ but PARAMETRIC_ROUTE_SAMPLES has no entry for it; add sample paths so isClientRoute parity covers the route`,
    );
    for (const sample of samples) {
      assert.ok(
        new RegExp(regexSource).test(sample),
        `sample ${sample} no longer matches /${regexSource}/ — update PARAMETRIC_ROUTE_SAMPLES`,
      );
      assert.equal(
        isClientRoute(sample),
        true,
        `main.ts routes ${sample} client-side (via /${regexSource}/) but server isClientRoute() returns 404`,
      );
    }
  }

  const prefixes = Array.from(source.matchAll(/path\.startsWith\('(\/[^']*)'\)/g)).map(
    (match) => match[1]!,
  );
  assert.ok(prefixes.length >= 4, 'expected startsWith route matchers in main.ts');
  for (const prefix of prefixes) {
    const sample = prefix.endsWith('/') ? `${prefix}sample` : `${prefix}/sample`;
    assert.equal(
      isClientRoute(sample),
      true,
      `main.ts routes ${prefix}* client-side but server isClientRoute() rejects ${sample}`,
    );
  }
});

// One concrete path per branch of isNoindexRoute, including the parametric
// prefixes, so the parity check below actually exercises each one.
const NOINDEX_ROUTE_SAMPLES = [
  '/account',
  '/account/settings',
  '/account/settings/profile',
  '/inbox',
  '/inbox/abc123',
  '/following',
  '/correspondence',
  '/challenge/abc123',
];

// A noindex route that is not a client route never reaches the shell handler
// that injects the tag, so the policy would be inert without anyone noticing.
test('every noindex route is a client route', () => {
  for (const route of NOINDEX_ROUTE_SAMPLES) {
    assert.equal(
      isClientRoute(route),
      true,
      `${route} is marked noindex but is not a client route, so the robots tag is never served`,
    );
  }
});

// Advertising a URL in the sitemap while telling crawlers not to index it is a
// direct contradiction, and it is the exact hand-mirror shape this file already
// guards elsewhere: two lists maintained separately, drifting silently.
test('no noindex route is advertised in the sitemap', () => {
  for (const route of SITEMAP_STATIC_ROUTES) {
    assert.equal(
      isNoindexRoute(route),
      false,
      `sitemap advertises ${route}, but isNoindexRoute() marks it noindex`,
    );
  }
});

// Thin is not the same as private. These are ordinary public pages and a
// regression that swept them into the noindex set would quietly delist real
// content, which is far more expensive than the problem this policy solves.
test('public pages are never noindexed', () => {
  for (const route of ['/', '/about', '/player', '/source', '/leaderboard', '/privacy', '/terms']) {
    assert.equal(isNoindexRoute(route), false, `${route} is a public page and must stay indexable`);
  }
});

// /feed spent 2026-08-14 to 2026-08-27 noindexed because its name reads like a
// personalised timeline. It is the public announcement archive, it is in the
// sitemap, and the homepage News box and the site footer both link to it.
test('the announcement archive is indexable and answers on one URL', () => {
  assert.equal(isNoindexRoute('/feed'), false);
  assert.equal(isNoindexRoute('/feed/'), false);
  assert.ok(SITEMAP_STATIC_ROUTES.includes('/feed'));
  assert.equal(legacyPageRedirect('/news'), '/feed');
  assert.equal(legacyPageRedirect('/news/'), '/feed');
  assert.equal(legacyPageRedirect('/feed'), null);
});

test('isNoindexRoute ignores a trailing slash', () => {
  assert.equal(isNoindexRoute('/account/'), true);
  assert.equal(isNoindexRoute('/following/'), true);
});

// The sitemap must never advertise a route the server 404s: every static route
// it lists (except '/', served as the static index itself) has to be accepted
// by the SPA fallback allowlist AND stay out of the parked/prod-404 set. This
// kills the hand-mirror class that once advertised /learn while server-policy
// parked it.
test('sitemap static routes are live client routes, never parked ones', () => {
  assert.ok(SITEMAP_STATIC_ROUTES.length > 0, 'expected sitemap static routes');
  for (const route of SITEMAP_STATIC_ROUTES) {
    if (route === '/') continue;
    assert.equal(
      PARKED_CLIENT_ROUTES.has(route),
      false,
      `sitemap advertises ${route}, but it is parked/prod-404 (PARKED_CLIENT_ROUTES)`,
    );
    assert.equal(
      isClientRoute(route),
      true,
      `sitemap advertises ${route}, but isClientRoute() rejects it so prod serves a 404 shell`,
    );
  }
});

test('isClientRoute matches parametric SPA routes', () => {
  assert.equal(isClientRoute('/game/abc123'), true);
  assert.equal(isClientRoute('/dark-xiangqi/game/dxq_abc123'), true);
  assert.equal(isClientRoute('/jungle/game/jgl_abc123'), true);
  assert.equal(isClientRoute('/jungle-flip/game/jgf_abc123'), true);
  assert.equal(isClientRoute('/room/abc123'), true);
  assert.equal(isClientRoute('/challenge/seek_abc123'), true);
  assert.equal(isClientRoute('/puzzles/mini-xiangqi-red-back-rank-net-1'), true);
  assert.equal(isClientRoute('/account/settings/privacy'), true);
  assert.equal(isClientRoute('/@/brianhliou'), true);
  assert.equal(isClientRoute('/blog/dark-chess-concepts'), true);
  assert.equal(isClientRoute('/blog/community'), true);
  assert.equal(isClientRoute('/zh-hans/blog'), true);
  assert.equal(isClientRoute('/zh-hans/blog/community'), true);
  assert.equal(isClientRoute('/zh-hant/blog'), true);
  assert.equal(isClientRoute('/rules/fog-chess'), true);
  assert.equal(isClientRoute('/rules/dark-draft960'), true);
  assert.equal(isClientRoute('/forum/general-discussion'), true);
  assert.equal(isClientRoute('/forum/t/topic_123/example-topic'), true);
  assert.equal(isClientRoute('/forum/redirect/post/post_123'), true);
  assert.equal(isClientRoute('/broadcast/xiangqi'), true);
  assert.equal(isClientRoute('/broadcast/xiangqi/2025-wxc-sample'), true);
  assert.equal(isClientRoute('/broadcast/xiangqi/2025-wxc-sample/round/men-r1'), true);
  assert.equal(isClientRoute('/broadcast/xiangqi/board/2025-wxc-sample-men-r1-b01'), true);
  assert.equal(isClientRoute('/zh-hans/rules/fog-chess'), true);
  assert.equal(isClientRoute('/zh-hant/rules/fog-chess'), true);
  assert.equal(isClientRoute('/engine/random-engine'), true); // admin engine-profile page
  assert.equal(isClientRoute('/analysis/xiangqi'), true); // standalone analysis board
  assert.equal(isClientRoute('/analysis/jungle-flip'), true); // every catalog variant slug
  assert.equal(isClientRoute('/analysis'), true); // bare /analysis opens the flagship
  assert.equal(isClientRoute('/editor/xiangqi'), true); // board editor
  assert.equal(isClientRoute('/editor/jungle-flip'), true); // every catalog variant slug
  assert.equal(isClientRoute('/editor'), true); // bare /editor opens the flagship
  assert.equal(isClientRoute('/games'), true); // current games
  assert.equal(isClientRoute('/games/search'), true); // games database
  // The old index paths are 301s now (server-http), not client routes; the
  // per-game detail path is untouched and still serves the archive review shell.
  assert.equal(isClientRoute('/historical-xiangqi'), false);
  assert.equal(isClientRoute('/historical-xiangqi/games'), false);
  assert.equal(isClientRoute('/historical-xiangqi/game/hxq_abc123'), true);
});

// A renamed page has to do both halves: the old URL redirects, and it stops
// being a client route. Leaving it in isClientRoute would serve the SPA at two
// URLs; dropping it without the redirect would 404 every published link.
test('legacyPageRedirect sends the old games-database paths to /games/search, once', () => {
  assert.equal(legacyPageRedirect('/historical-xiangqi'), '/games/search');
  assert.equal(legacyPageRedirect('/historical-xiangqi/'), '/games/search');
  assert.equal(legacyPageRedirect('/historical-xiangqi/games'), '/games/search');
  // The redirect target is itself a client route, so the hop terminates.
  assert.equal(legacyPageRedirect('/games/search'), null);
  assert.equal(legacyPageRedirect('/games'), null);
  assert.equal(isClientRoute('/games/search'), true);
  // Game detail keeps its path: it is a different surface, still linked from
  // the opening explorer.
  assert.equal(legacyPageRedirect('/historical-xiangqi/game/hxq_abc123'), null);
});

test('isClientRoute lets vendored ceval engine assets fall through to static', () => {
  // /engine/:id is the admin engine-profile SPA page, but /engine/fairy-stockfish/*
  // are real vendored files. They MUST NOT be rewritten to index.html, or the local
  // analysis engine (ceval) loads HTML as a script and dies with "engine global
  // missing after script load" (prod regression 2026-07-05: `startsWith('/engine/')`
  // swallowed the asset subtree).
  assert.equal(isClientRoute('/engine/fairy-stockfish/stockfish.js'), false);
  assert.equal(isClientRoute('/engine/fairy-stockfish/stockfish.wasm'), false);
  assert.equal(isClientRoute('/engine/fairy-stockfish/stockfish.worker.js'), false);
  assert.equal(isClientRoute('/engine/fairy-stockfish/fortress-xiangqi.ini'), false);
});

test('isReviewShellRoute matches postgame review documents (COOP/COEP scope)', () => {
  // Bare dark-chess review + every /<variant>/game/:id review tenant.
  assert.equal(isReviewShellRoute('/game/abc123'), true);
  assert.equal(isReviewShellRoute('/xiangqi/game/xq_abc123'), true);
  assert.equal(isReviewShellRoute('/dark-xiangqi/game/dxq_abc123'), true);
  assert.equal(isReviewShellRoute('/fortress-xiangqi/game/fxq_abc123'), true);
  assert.equal(isReviewShellRoute('/jungle-flip/game/jgf_abc123'), true);
  assert.equal(isReviewShellRoute('/historical-xiangqi/game/hxq_abc123'), true);
  assert.equal(isReviewShellRoute('/game/abc123?ply=4'.split('?', 1)[0]!), true);
  // The standalone analysis board mounts the same ceval engine, so it needs the
  // COOP/COEP isolation headers too (else SharedArrayBuffer is unavailable).
  assert.equal(isReviewShellRoute('/analysis/xiangqi'), true);
  assert.equal(isReviewShellRoute('/analysis/banqi'), true);
  assert.equal(isReviewShellRoute('/analysis'), true);
  // The board editor has no engine: a plain client page, never cross-origin
  // isolated.
  assert.equal(isReviewShellRoute('/editor'), false);
  assert.equal(isReviewShellRoute('/editor/xiangqi'), false);
  // The puzzle trainer mounts the same ceval engine after a puzzle is completed.
  // Both the list and a specific puzzle must be isolated, because the isolation
  // is fixed at document load and pushState nav between puzzles never reloads.
  assert.equal(isReviewShellRoute('/puzzles'), true);
  assert.equal(isReviewShellRoute('/puzzles/xq-mined-hxq_abc123-60'), true);
  assert.equal(isReviewShellRoute('/puzzles/bMpKA'), true);
});

test('isReviewShellRoute excludes non-review surfaces (keeps them non-isolated)', () => {
  // Live rooms are postgame-engine-free; the rest of the site must stay
  // non-isolated so cross-origin flows (e.g. patron's Stripe redirect) are unaffected.
  assert.equal(isReviewShellRoute('/room/abc123'), false);
  assert.equal(isReviewShellRoute('/'), false);
  assert.equal(isReviewShellRoute('/patron'), false);
  assert.equal(isReviewShellRoute('/play'), false);
  assert.equal(isReviewShellRoute('/broadcast/xiangqi/board/2025-wxc-sample-men-r1-b01'), false);
  assert.equal(isReviewShellRoute('/xiangqi/game/'), false); // no game id
  assert.equal(isReviewShellRoute('/historical-xiangqi/games'), false);
  assert.equal(isReviewShellRoute('/blog/dark-chess-concepts'), false);
  assert.equal(isReviewShellRoute('/a/b/game/c'), false); // too many segments
});

test('isClientRoute rejects unknown paths', () => {
  assert.equal(isClientRoute('/does-not-exist'), false);
  assert.equal(isClientRoute('/api/games/recent'), false);
  assert.equal(isClientRoute('/broadcast/xiangqi/board'), false);
  assert.equal(isClientRoute('/forum/general-discussion/extra'), false);
});

test('isPrivateOrReservedIp flags private, reserved, and unparseable addresses', () => {
  for (const ip of [
    '10.0.0.1',
    '172.16.5.4',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '169.254.10.1', // link-local
    '100.64.0.1', // CGNAT
    '100.127.255.1', // CGNAT upper
    '0.0.0.0',
    '::1', // IPv6 loopback
    'fc00::1', // unique-local
    'fd12:3456:789a::1', // unique-local
    'fe80::1ff:fe23:4567:890a', // link-local
    '::ffff:10.0.0.1', // IPv4-mapped private
    'unknown',
    '',
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), true, `expected private/reserved: ${ip}`);
  }
});

test('isPrivateOrReservedIp treats real public addresses as public', () => {
  for (const ip of [
    '203.0.113.7',
    '8.8.8.8',
    '172.15.0.1', // just below 172.16/12
    '172.32.0.1', // just above 172.31
    '100.63.0.1', // just below CGNAT
    '100.128.0.1', // just above CGNAT
    '::ffff:8.8.8.8', // IPv4-mapped public
    '2606:4700:4700::1111', // public IPv6
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), false, `expected public: ${ip}`);
  }
});

test('proxyTrustWarningFor warns only in production when the resolved IP is private', () => {
  const prod: RuntimeEnv = { RAILWAY_SERVICE_NAME: 'web' };
  // prod + private resolved IP → warns, and names the IP + hops in the message
  const warning = proxyTrustWarningFor('10.0.0.5', 1, prod);
  assert.ok(warning?.includes('10.0.0.5') && warning.includes('MISTBOARD_TRUSTED_PROXY_HOPS=1'));
  // prod + public resolved IP → no warning
  assert.equal(proxyTrustWarningFor('203.0.113.7', 1, prod), null);
  // non-production → never warns, even for a private IP
  assert.equal(proxyTrustWarningFor('10.0.0.5', 1, {}), null);
});

// Locale-prefixed study permalinks. The review-shell assert is the load-bearing
// one: that gate carries COOP/COEP, and a study page that misses it still
// renders but silently loses SharedArrayBuffer, so the engine dies on the
// localized URL only (same bug class as the /analysis saga).
test('locale-prefixed study permalinks are client routes AND review-shell routes', () => {
  for (const path of [
    '/study/Ab12cd',
    '/study/Ab12cd/Xy34ef',
    '/zh-hans/study/Ab12cd',
    '/zh-hans/study/Ab12cd/Xy34ef',
    '/zh-hant/study/Ab12cd',
    '/zh-hant/study/Ab12cd/Xy34ef',
  ]) {
    assert.equal(isClientRoute(path), true, `${path} should serve the SPA shell`);
    assert.equal(isReviewShellRoute(path), true, `${path} needs COOP/COEP for the engine`);
  }
});

test('a bogus locale prefix on a study path is not a route', () => {
  for (const path of [
    '/fr/study/Ab12cd',
    '/zh/study/Ab12cd',
    '/zh-hans/study/',
    '/study/Ab12cd/Xy34ef/extra',
  ]) {
    assert.equal(isClientRoute(path), false, `${path} should not match`);
  }
});
