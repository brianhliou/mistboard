import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_CHESS_SPEC_ID } from '@mistboard/game';
// Watch channels (other than the hardcoded dark-chess default) derive from the
// variant-tenant registry, so the registrations must be populated for the
// derived channels to appear. This side-effect import registers every tenant.
import './variant-tenant/register-tenants.js';
import { channelTopPlayer } from './routes/games.js';
import { defaultWatchChannel, listWatchChannels, watchChannelForId } from './watch-channels.js';

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

test('an empty channel has no headline seat', () => {
  assert.equal(channelTopPlayer([]), null);
});
