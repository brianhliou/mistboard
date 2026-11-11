import { threeKingdomsBanqiRooms } from './three-kingdoms-banqi-registration.js';
import './routes/three-kingdoms-banqi-games.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_CHESS_SPEC_ID, maybeGameSpecForId } from '@mistboard/game';
// Watch channels (other than the hardcoded dark-chess default) derive from the
// variant-tenant registry, so the registrations must be populated for the
// derived channels to appear. This side-effect import registers every tenant.
import './variant-tenant/register-tenants.js';
import './routes/gomoku-games.js';
import { collectCurrentGames } from './current-games.js';
import { gomokuRooms } from './gomoku-registration.js';
import { buildOpenApiDocument, WATCH_CHANNEL_IDS } from './openapi.js';
import { channelTopPlayer } from './routes/games.js';
import type { HttpApiContext } from './routes/lib.js';
import { variantTenantForSpecId } from './variant-tenant/registry.js';
import {
  defaultWatchChannel,
  listedOnSurface,
  listWatchChannels,
  watchChannelForId,
} from './watch-channels.js';
import { collectLiveTvCandidates } from './watch-live.js';

test('Gomoku registers TV and Rapfi names without opening hidden listings', () => {
  const registration = variantTenantForSpecId('gomoku')!;
  assert.deepEqual(registration.watch, {
    channelId: 'gomoku',
    family: 'gomoku',
    label: 'Gomoku',
    legacyVariants: ['gomoku'],
  });
  for (const level of [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(registration.engineDisplayName?.(`rapfi-level-${level}`), 'Rapfi');
  for (const id of ['human', 'rapfi-level-0', 'rapfi-level-9', 'rapfi-level-8\n'])
    assert.equal(registration.engineDisplayName?.(id), null);
});

test('hidden Gomoku stays out of channels, Featured, Engines, current games and live TV', () => {
  const spec = maybeGameSpecForId('gomoku')!;
  const original = spec.publicSurface;
  const originalFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
  const now = Date.now();
  const roomId = 'gmk_hidden-listing-test';
  const ctx = { rooms: new Map() } as unknown as HttpApiContext;
  gomokuRooms.set(roomId, {
    id: roomId,
    events: [
      { type: 'room-created', at: now - 60_000 },
      { type: 'move-played', at: now - 1_000 },
    ],
    projection: {
      state: { status: { type: 'playing' }, moveNumber: 8 },
      seats: { black: 'human', white: 'rapfi-level-8' },
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    },
    seatTokens: {},
    clients: [],
  } as unknown as Parameters<typeof gomokuRooms.set>[1]);
  try {
    assert.equal(spec.publicSurface, 'casual');
    spec.publicSurface = 'hidden';
    for (const enabled of ['false', 'true']) {
      process.env.MISTBOARD_GOMOKU_ENABLED = enabled;
      assert.equal(listedOnSurface('gomoku'), false);
      assert.equal(watchChannelForId('gomoku'), null);
      const channels = listWatchChannels();
      assert.equal(JSON.stringify(channels).includes('gomoku'), false);
      assert.equal(JSON.stringify(collectCurrentGames(ctx, now)).includes(roomId), false);
      assert.equal(JSON.stringify(collectLiveTvCandidates(ctx, now)).includes(roomId), false);
    }
    // Prove the fixture would be listed after a launch, with the same flag.
    spec.publicSurface = 'casual';
    assert.equal(watchChannelForId('gomoku')?.family, 'gomoku');
    for (const channel of ['top', 'engines'])
      assert.ok(watchChannelForId(channel)?.legacyVariants.includes('gomoku'));
    for (const game of [
      collectCurrentGames(ctx, now).find((g) => g.roomId === roomId),
      collectLiveTvCandidates(ctx, now).find((g) => g.roomId === roomId),
    ]) {
      assert.ok(game, 'public, enabled fixture must be eligible');
      // Live listings resolve the first-party bot profile before the engine name.
      assert.equal(game.players.find((p) => p.isEngine)?.name, 'Rapfi Level 8');
    }
    process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
    assert.equal(watchChannelForId('gomoku'), null);
    assert.equal(
      collectCurrentGames(ctx, now).some((g) => g.roomId === roomId),
      false,
    );
    assert.equal(
      collectLiveTvCandidates(ctx, now).some((g) => g.roomId === roomId),
      false,
    );
  } finally {
    spec.publicSurface = original;
    gomokuRooms.delete(roomId);
    if (originalFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = originalFlag;
  }
});

test('Gomoku watch enums are supported but documented only when public and enabled', () => {
  assert.ok((WATCH_CHANNEL_IDS as readonly string[]).includes('gomoku'));
  const spec = maybeGameSpecForId('gomoku')!;
  const original = spec.publicSurface;
  const originalFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
  try {
    for (const surface of ['hidden', 'casual'] as const) {
      spec.publicSurface = surface;
      for (const enabled of ['false', 'true']) {
        process.env.MISTBOARD_GOMOKU_ENABLED = enabled;
        const doc = buildOpenApiDocument('https://mistboard.com') as {
          paths: Record<
            string,
            {
              get: {
                parameters: Array<{
                  name: string;
                  schema: { enum?: string[] };
                }>;
              };
            }
          >;
        };
        for (const path of ['/api/watch', '/api/watch/live']) {
          const channels = doc.paths[path]!.get.parameters.find((p) => p.name === 'channel')!.schema
            .enum!;
          assert.equal(channels.includes('gomoku'), surface === 'casual' && enabled === 'true');
        }
      }
    }
  } finally {
    spec.publicSurface = original;
    if (originalFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = originalFlag;
  }
});

// The Mini Xiangqi sub-family (open, dark, drop) was retired from Mistboard TV
// on 2026-07-05 (xiangqi pivot): their registrations carry `watch: null`, so no
// channel derives for them and their `?channel=` ids resolve to null. Fog Chess
// is the only baseline VARIANT channel in a launched-flags-off environment; the
// cross-variant Featured channel leads the rail (the flagship default) and the
// composition-keyed Engines channel is always on and closes the rail.
const BASELINE_WATCH_CHANNELS = ['top', 'dark-chess', 'engines'] as const;

// Retired sub-family ids that must NOT resolve to a watch channel.
const RETIRED_WATCH_CHANNEL_IDS = ['mini-xiangqi', 'dark-mini-xiangqi'] as const;

test('watch channels expose Featured as the default channel', () => {
  const channel = defaultWatchChannel();
  assert.equal(channel.id, 'top');
  assert.equal(channel.label, 'Featured');
  // Cross-variant flagship: no fixed spec, the client dispatches a renderer per
  // game (live-followed or completed).
  assert.deepEqual(channel.gameSpecIds, []);
  assert.deepEqual([...channel.modes].sort(), ['pve', 'pvp']);
});

test('Fog Chess stays a launched variant channel, just not the default', () => {
  const channel = watchChannelForId('dark-chess');
  assert.ok(channel);
  assert.equal(channel.default, false);
  assert.equal(channel.label, 'Fog Chess');
  assert.deepEqual(channel.gameSpecIds, [DARK_CHESS_SPEC_ID]);
  assert.deepEqual(channel.legacyVariants, ['dark-chess']);
});

test('watch channel lookup defaults empty input and rejects unknown channels', () => {
  assert.equal(watchChannelForId(null)?.id, 'top');
  assert.equal(watchChannelForId(undefined)?.id, 'top');
  assert.equal(watchChannelForId('top')?.id, 'top');
  assert.equal(watchChannelForId('dark-chess')?.id, 'dark-chess');
  assert.equal(watchChannelForId('unknown'), null);
});

test('watch channel list is immutable by convention', () => {
  assert.deepEqual(
    listWatchChannels().map((channel) => channel.id),
    BASELINE_WATCH_CHANNELS,
  );
});

test('watch channels expose every launched baseline variant in canonical order', () => {
  const channels = listWatchChannels();
  assert.deepEqual(
    channels.map((entry) => entry.id),
    BASELINE_WATCH_CHANNELS,
  );
  // Featured leads the rail and is the default landing channel.
  assert.equal(channels[0]?.id, 'top');
  assert.equal(defaultWatchChannel().id, 'top');
});

test('the Featured channel is cross-variant, human-only, deep-linkable, and leads', () => {
  const top = watchChannelForId('top');
  assert.ok(top, 'top channel must be enabled + reachable by deep link');
  assert.equal(top.default, true);
  assert.deepEqual([...top.modes].sort(), ['pve', 'pvp']);
  // No per-channel renderer spec — the client dispatches a renderer per game.
  assert.deepEqual([...top.gameSpecIds], []);
  // Bounded to the union of the enabled variant channels' variants (like Engines)
  // so its completed feed never surfaces a game the client can't render.
  const watchableVariants = new Set(
    listWatchChannels()
      .filter((channel) => channel.id !== 'top' && channel.id !== 'engines')
      .flatMap((channel) => [...channel.legacyVariants]),
  );
  assert.deepEqual(new Set(top.legacyVariants), watchableVariants);
  assert.ok(top.legacyVariants.includes('dark-chess'));
});

test('Featured is the ONLY curated channel', () => {
  // The curation bar (no abandonment, no near-opening stubs) exists to keep the
  // flagship channel in agreement with the homepage board, which applies the same
  // filter. It must stay scoped to Top: at current liquidity it would empty the
  // thin per-variant channels, whose job is to show every game in their variant.
  for (const channel of listWatchChannels()) {
    assert.equal(
      channel.curated,
      channel.id === 'top',
      `${channel.id}: only the Featured channel may be curated`,
    );
  }
});

test('variant/family channels surface human play only (pvp + pve, never eve)', () => {
  // Decision #6: engine-vs-engine games are segregated to the Engines channel so
  // they never pollute a variant channel; PvE folds in because it is the
  // liquidity floor. Every derived channel + Fog Chess must be human-only.
  for (const channel of listWatchChannels()) {
    if (channel.id === 'engines') continue;
    assert.deepEqual(
      [...channel.modes].sort(),
      ['pve', 'pvp'],
      `${channel.id} must surface pvp+pve and exclude eve`,
    );
  }
});

test('the Engines channel is EvE-only, bounded to watchable variants, deep-linkable', () => {
  const engines = watchChannelForId('engines');
  assert.ok(engines, 'engines channel must be enabled + reachable by deep link');
  assert.deepEqual([...engines.modes], ['eve']);
  assert.equal(engines.default, false);
  // No per-channel renderer spec — the client dispatches a renderer per game.
  assert.deepEqual([...engines.gameSpecIds], []);
  // Bounded to the union of the enabled variant channels' variants so it never
  // surfaces an EvE game the client can't render. In a flags-off env only Fog
  // Chess is enabled, so Engines spans exactly its variants.
  const watchableVariants = new Set(
    listWatchChannels()
      .filter((channel) => channel.id !== 'engines')
      .flatMap((channel) => [...channel.legacyVariants]),
  );
  assert.deepEqual(new Set(engines.legacyVariants), watchableVariants);
  assert.ok(engines.legacyVariants.includes('dark-chess'));
});

test('retired Mini Xiangqi sub-family has no watch channel', () => {
  const ids = listWatchChannels().map((channel) => channel.id);
  for (const id of RETIRED_WATCH_CHANNEL_IDS) {
    assert.equal(ids.includes(id), false, `${id} must not appear in the watch rail`);
    assert.equal(watchChannelForId(id), null, `${id} must not resolve by deep link`);
  }
});

// ---------------------------------------------------------------------------
// Rail headline seat. Ranking purely by rating named the BOT on PvE channels,
// because bots carry calibrated ratings and their human opponents are usually
// unrated guests.
// ---------------------------------------------------------------------------

function record(
  participants: { displayName: string; subjectType: string; rating?: number }[],
): Parameters<typeof channelTopPlayer>[0][number] {
  return {
    participants: participants.map((p, index) => ({
      color: index === 0 ? 'red' : 'black',
      displayName: p.displayName,
      subjectType: p.subjectType,
      subjectId: null,
      visibility: 'public',
      ratingBefore: p.rating ?? null,
      ratingAfter: p.rating ?? null,
    })),
  } as unknown as Parameters<typeof channelTopPlayer>[0][number];
}

test('channel rail names the human, not the higher-rated bot, in a PvE game', () => {
  const top = channelTopPlayer([
    record([
      { displayName: 'Misty', subjectType: 'bot', rating: 1881 },
      { displayName: 'Guest', subjectType: 'guest' },
    ]),
  ]);
  assert.equal(top?.name, 'Guest');
});

test('channel rail still ranks humans by rating among themselves', () => {
  const top = channelTopPlayer([
    record([
      { displayName: 'ada', subjectType: 'user', rating: 1500 },
      { displayName: 'grace', subjectType: 'user', rating: 1700 },
    ]),
  ]);
  assert.equal(top?.name, 'grace');
  assert.equal(top?.rating, 1700);
});

test('an all-machine channel (Engines) still names the engine', () => {
  const top = channelTopPlayer([
    record([
      { displayName: 'Fairy-Stockfish - Level 4', subjectType: 'engine-version', rating: 1600 },
      { displayName: 'Pikafish', subjectType: 'engine-version', rating: 2400 },
    ]),
  ]);
  assert.equal(top?.name, 'Pikafish');
});

test('channel rail names the head game player, not a higher-rated seat further down the feed', () => {
  // Prod, 2026-10-04: the jieqi rail read "scene-1174 1662" (a rated game from
  // ten hours earlier) while the board showed Guest vs Pikafish L4.
  const top = channelTopPlayer([
    record([
      { displayName: 'Guest', subjectType: 'guest' },
      { displayName: 'Pikafish Level 4', subjectType: 'bot', rating: 1500 },
    ]),
    record([
      { displayName: 'scene-1174', subjectType: 'user', rating: 1662 },
      { displayName: 'ada', subjectType: 'user', rating: 1500 },
    ]),
  ]);
  assert.equal(top?.name, 'Guest');
  assert.equal(top?.rating, null);
});

test('an empty channel has no headline seat', () => {
  assert.equal(channelTopPlayer([]), null);
});

test('hidden Three Kingdoms Banqi stays out of channels, Featured, Engines, current games and live TV', () => {
  const spec = maybeGameSpecForId('three-kingdoms-banqi')!;
  const original = spec.publicSurface;
  const originalFlag = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED;
  const now = Date.now();
  const roomId = 'tkb_hidden-listing-test';
  const ctx = { rooms: new Map() } as unknown as HttpApiContext;
  threeKingdomsBanqiRooms.set(roomId, {
    id: roomId,
    events: [
      { type: 'room-created', at: now - 60_000 },
      { type: 'move-played', at: now - 1_000 },
    ],
    projection: {
      state: { status: { type: 'playing' }, moveNumber: 8 },
      seats: { red: 'human', black: 'misty-three-kingdoms-banqi-level-8' },
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    },
    seatTokens: {},
    clients: [],
  } as unknown as Parameters<typeof threeKingdomsBanqiRooms.set>[1]);
  try {
    assert.equal(spec.publicSurface, 'casual');
    spec.publicSurface = 'hidden';
    for (const enabled of ['false', 'true']) {
      process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = enabled;
      assert.equal(listedOnSurface('three-kingdoms-banqi'), false);
      assert.equal(watchChannelForId('three-kingdoms-banqi'), null);
      const channels = listWatchChannels();
      assert.equal(JSON.stringify(channels).includes('three-kingdoms-banqi'), false);
      assert.equal(JSON.stringify(collectCurrentGames(ctx, now)).includes(roomId), false);
      assert.equal(JSON.stringify(collectLiveTvCandidates(ctx, now)).includes(roomId), false);
    }
    // Prove the fixture would be listed after a launch, with the same flag.
    spec.publicSurface = 'casual';
    assert.equal(watchChannelForId('three-kingdoms-banqi')?.family, 'xiangqi');
    for (const channel of ['top', 'engines'])
      assert.ok(watchChannelForId(channel)?.legacyVariants.includes('three-kingdoms-banqi'));
    for (const game of [
      collectCurrentGames(ctx, now).find((g) => g.roomId === roomId),
      collectLiveTvCandidates(ctx, now).find((g) => g.roomId === roomId),
    ]) {
      assert.ok(game, 'public, enabled fixture must be eligible');
      // Live listings resolve the first-party bot profile before the engine name.
      assert.ok(game.players.find((p) => p.isEngine)?.name);
    }
    process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = 'false';
    assert.equal(watchChannelForId('three-kingdoms-banqi'), null);
    assert.equal(
      collectCurrentGames(ctx, now).some((g) => g.roomId === roomId),
      false,
    );
    assert.equal(
      collectLiveTvCandidates(ctx, now).some((g) => g.roomId === roomId),
      false,
    );
  } finally {
    spec.publicSurface = original;
    threeKingdomsBanqiRooms.delete(roomId);
    if (originalFlag === undefined) delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED;
    else process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = originalFlag;
  }
});
