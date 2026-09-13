import { findTimeControl } from '@mistboard/game';
import {
  displayParticipantName,
  type FeaturedGame,
  type GameParticipant,
  matchupSeats,
  participantForColor,
  sourceLabel,
} from './game-display.js';
import type { GameMeta } from './replay.js';
import { timeControlLabelFromMeta } from './replay-meta.js';
import { webVariantTenantForRoomId, webVariantTenantForSpecId } from './variant-tenant/registry.js';

export function gameMetaForGame(game: FeaturedGame): GameMeta {
  // GameMeta's whiteName/blackName are first/second-seat keys, not literal
  // colors: xiangqi/jungle games seat red/black.
  const [firstSeat, secondSeat] = matchupSeats(game);
  return {
    whiteName: withRatingDelta(
      displayParticipantName(game, firstSeat),
      participantForColor(game, firstSeat),
    ),
    blackName: withRatingDelta(
      displayParticipantName(game, secondSeat),
      participantForColor(game, secondSeat),
    ),
    gameUrl: reviewUrlForGame(game),
    modeLabel: sourceLabel(game.mode),
    result: game.result,
    timeControl: game.timeControl ?? clockTimeControlFromGame(game),
    termination: game.termination,
    plyCount: game.plyCount,
  };
}

// Clocked games (PvP/PvE) store their time control in initialMs/incrementMs, not
// the legacy `timeControl` blob (null for them). Rebuild a time-control object so
// the clock label renders and maybeDeriveThinkingBudget treats the game as
// clocked rather than synthesizing a phantom per-move budget from think times.
function clockTimeControlFromGame(game: FeaturedGame): Record<string, unknown> | null {
  if (typeof game.initialMs !== 'number') return null;
  return { initialMs: game.initialMs, incrementMs: game.incrementMs ?? 0 };
}

// Compact time-control label for a finished game ("3 + 2"), or null when the
// game carries no clock (e.g. engine self-play). Prefer the official registry
// label so the profile badge matches the lobby/leaderboard wording; fall back to
// the generic formatter for off-grid clocks (legacy/imported games).
export function timeControlLabelForGame(game: FeaturedGame): string | null {
  const spec = findTimeControl(game.initialMs, game.incrementMs);
  if (spec) return spec.label;
  return timeControlLabelFromMeta(game.timeControl ?? clockTimeControlFromGame(game));
}

export function reviewUrlForGame(game: FeaturedGame): string | null {
  if (game.corpusId === 'replay-samples') return null;
  // Variant-tenant games replay ONLY under their own postgame route: the legacy
  // /game/:id chess shell can't parse a tenant event log and 403s
  // (game_not_public). Resolve the tenant by room-id prefix (robust against
  // legacy variant aliases in persisted rows, e.g. dxq_ rows whose spec-id lookup
  // could miss) and prefer gameRouteBase, the postgame mount. Mirrors
  // databaseReviewHref; reviewRouteBase is the older equivalent some tenants set.
  const tenant = webVariantTenantForRoomId(game.roomId) ?? webVariantTenantForSpecId(game.variant);
  const routeBase = tenant?.gameRouteBase ?? tenant?.reviewRouteBase ?? null;
  return routeBase
    ? `${routeBase}/${encodeURIComponent(game.roomId)}`
    : `/game/${encodeURIComponent(game.roomId)}`;
}

// Append the post-game rating change to a player's name on the game page, e.g.
// "alice · 1662 (+162)". Only for rated games (both ratings present); casual
// games and engines have no ratingBefore/After, so the name is returned as-is.
function withRatingDelta(name: string, participant: GameParticipant | null): string {
  if (!participant || participant.ratingBefore == null || participant.ratingAfter == null) {
    return name;
  }
  const delta = participant.ratingAfter - participant.ratingBefore;
  const sign = delta >= 0 ? '+' : '';
  return `${name} · ${participant.ratingAfter} (${sign}${delta})`;
}
