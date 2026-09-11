import {
  CANONICAL_VARIANT_ORDER,
  DARK_CHESS_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  type GameFamilyId,
  type GameSpecId,
} from '@mistboard/game';
import type { GameMode } from './persistence-game-lifecycle.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

// A variant/family channel surfaces human play only — PvP + PvE. Engine-vs-engine
// games are segregated into the Engines channel (decision: EvE never pollutes a
// variant channel; PvE folds in because it is our liquidity floor).
const VARIANT_CHANNEL_MODES: readonly GameMode[] = ['pvp', 'pve'];

// Channel ids are open-ended (one per watchable variant tenant) plus the
// hardcoded dark-chess channel, so this is a string alias rather than a closed
// union — adding a watchable variant must not require editing this type.
export type WatchChannelId = string;

export type WatchChannel = {
  // Whether the channel's completed feed applies the flagship curation bar
  // (no near-opening stubs, whatever the termination) shared with the homepage showcase
  // pool. True for Featured ONLY: it is the one channel that must agree with
  // the homepage board, and the one whose cross-variant volume can absorb the
  // filter. A per-variant channel stays the full feed — at current liquidity the
  // bar would empty the thin ones (dark-xiangqi had 4 games, 0 above the bar on
  // 2026-08-14), and a variant channel's job is "every game in this variant".
  curated: boolean;
  default: boolean;
  family: GameFamilyId;
  gameSpecIds: readonly GameSpecId[];
  id: WatchChannelId;
  label: string;
  legacyVariants: readonly string[];
  // The game modes this channel surfaces (drives the persistence mode filter).
  // Variant/family channels are human-only (pvp+pve); the Engines channel is eve.
  modes: readonly GameMode[];
};

// Fog Chess is the one channel that cannot be derived from the registry: it is
// a registry MISS (the legacy chess stack is deliberately unregistered), so it
// stays a hardcoded constant and is always enabled. Every other variant channel
// derives from a registered tenant's `watch` field.
const DARK_CHESS_CHANNEL: WatchChannel = {
  curated: false,
  default: false,
  family: 'chess',
  gameSpecIds: [DARK_CHESS_SPEC_ID, DARK_DRAFT960_SPEC_ID],
  id: 'dark-chess',
  label: 'Fog Chess',
  legacyVariants: ['dark-chess', 'draft960'],
  modes: VARIANT_CHANNEL_MODES,
};

// The Featured channel: the flagship, cross-variant channel that mirrors the
// homepage viewer. It has no fixed variant — the client follows the top LIVE
// game (the cross-channel election, PvP over PvE, served by
// /api/watch/live?channel=top) when one exists, and otherwise browses the
// freshest completed human games across every watchable variant that clear the
// shared curation bar (`curated: true`) — the same filter the homepage showcase
// pool applies, so this channel's head IS the game the homepage board freezes
// on. Before 2026-08-14 it was unfiltered and the two disagreed. Like Engines
// it spans families, so it carries no per-channel gameSpecIds (the watch client
// picks a renderer per game). Human play only (pvp+pve) — the live election is
// fail-closed on fog and headless EvE never features here. Its `legacyVariants`
// is filled in listWatchChannels() with the union of the ENABLED variant
// channels' variants (same as Engines) so its completed feed only ever surfaces
// games the client can render. Always enabled; sorts to the FRONT of the rail
// and is the default landing channel. `family` is an inert placeholder.
export const TOP_CHANNEL_ID = 'top';

const TOP_CHANNEL: WatchChannel = {
  curated: true,
  default: true,
  family: 'chess',
  gameSpecIds: [],
  id: TOP_CHANNEL_ID,
  label: 'Featured',
  legacyVariants: [],
  modes: VARIANT_CHANNEL_MODES,
};

// The one composition-keyed channel: every watchable variant's engine-vs-engine
// games, segregated here so they never crowd the human-play channels. Spans
// families, so it carries no per-channel gameSpecIds — the watch client picks a
// renderer per game (from each game's own variant), not per channel. Its
// `legacyVariants` is filled in listWatchChannels() with the union of the ENABLED
// variant channels' variants, so it only ever surfaces EvE games the client has a
// renderer for (an unlaunched/retired variant's EvE game never leaks in). `family`
// is unused downstream; 'chess' is an inert placeholder. Always enabled; sorts to
// the end of the rail.
const ENGINES_CHANNEL: WatchChannel = {
  curated: false,
  default: false,
  family: 'chess',
  gameSpecIds: [],
  id: 'engines',
  label: 'Engines',
  legacyVariants: [],
  modes: ['eve'],
};

// Rail order, derived from the shared CANONICAL_VARIANT_ORDER so the watch rail
// matches the play menu / leaderboard / rules rail. Every watch channel id equals
// its spec id, so the spec order IS the channel order (dark-draft960 has no
// channel and is simply never matched). The registry's Map iteration order tracks
// tenant import order, not the rail's order, so channels are sorted by this list;
// dark-chess sorts to its canonical position like any other id (ids absent here
// sort to the end), and remains the default landing channel via its `default`.
const WATCH_CHANNEL_ORDER: readonly string[] = CANONICAL_VARIANT_ORDER;

function channelOrderIndex(channelId: string): number {
  const index = WATCH_CHANNEL_ORDER.indexOf(channelId);
  return index === -1 ? WATCH_CHANNEL_ORDER.length : index;
}

// The per-variant channels mapped from every registered tenant that declares a
// watch surface, sorted into the canonical rail order. Derived (not hardcoded)
// so adding a watchable variant = setting `watch` on its registration.
function channelsDerivedFromRegistry(): WatchChannel[] {
  const channels: WatchChannel[] = [];
  for (const registration of registeredVariantTenants()) {
    const watch = registration.watch;
    if (!watch) continue;
    channels.push({
      curated: false,
      default: watch.default ?? false,
      family: watch.family as GameFamilyId,
      gameSpecIds: [registration.gameSpecId as GameSpecId],
      id: watch.channelId,
      label: watch.label,
      legacyVariants: watch.legacyVariants,
      modes: VARIANT_CHANNEL_MODES,
    });
  }
  return channels;
}

// Channels can be gated behind a feature flag so a variant's watch tab only
// appears once the variant is being launched. Hidden channels are also
// unreachable by deep link (watchChannelForId returns null for them). Dark
// chess is always on; every derived channel reuses its tenant's enabled() so
// the watch rail can never drift from the live-room gate.
function channelEnabled(channel: WatchChannel): boolean {
  if (channel.id === DARK_CHESS_CHANNEL.id) return true;
  const registration = registeredVariantTenants().find(
    (entry) => entry.watch?.channelId === channel.id,
  );
  return registration?.enabled() ?? false;
}

export function listWatchChannels(): readonly WatchChannel[] {
  // Fog Chess sorts into its canonical rail position alongside the derived
  // channels rather than leading — the xiangqi pivot deranks chess, so the watch
  // rail must match the play menu / rules rail order. Featured is the default
  // landing channel and leads the rail (see defaultWatchChannel).
  const variantChannels = [DARK_CHESS_CHANNEL, ...channelsDerivedFromRegistry()].filter(
    channelEnabled,
  );
  variantChannels.sort((a, b) => channelOrderIndex(a.id) - channelOrderIndex(b.id));
  // The Featured and Engines channels both span exactly the watchable variants
  // — the union of the enabled variant channels' variant strings — so their
  // completed feeds never surface a game the client has no renderer for, and they
  // grow automatically as variants launch. Featured leads the rail (the flagship
  // default), Engines closes it (appended after the ordered variant channels).
  const watchableVariants = [
    ...new Set(variantChannels.flatMap((channel) => [...channel.legacyVariants])),
  ];
  const topChannel: WatchChannel = { ...TOP_CHANNEL, legacyVariants: watchableVariants };
  const enginesChannel: WatchChannel = { ...ENGINES_CHANNEL, legacyVariants: watchableVariants };
  return [topChannel, ...variantChannels, enginesChannel];
}

export function defaultWatchChannel(): WatchChannel {
  const enabled = listWatchChannels();
  return enabled.find((channel) => channel.default) ?? enabled[0]!;
}

export function watchChannelForId(id: string | null | undefined): WatchChannel | null {
  const enabled = listWatchChannels();
  if (!id) return defaultWatchChannel();
  return enabled.find((channel) => channel.id === id) ?? null;
}
