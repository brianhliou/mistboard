import {
  DARK_CHESS_SPEC_ID,
  DARK_MINI_XIANGQI_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  GAME_SPECS,
  type GameSpecId,
  isRetiredGameSpec,
} from '@mistboard/game';
import { webVariantTenantForSpecId } from './variant-tenant/registry.js';

// One public-surface switch per game spec. This controls discoverable UI:
// rules rails/tiles, homepage article cards, homepage News, and /feed entries.
// Direct URLs can stay reachable for review/backcompat; they are not listings.
const VARIANT_PUBLIC_SURFACE_ENABLED = {
  'dark-chess': true,
  'dark-draft960': false,
  // Dark Crazyhouse + the Mini Xiangqi sub-family retired from public surfaces
  // 2026-07-03 (project_xiangqi_pivot_track). Direct /rules + play URLs stay live.
  'dark-crazyhouse': false,
  kriegspiel: false,
  'mini-xiangqi': false,
  'dark-mini-xiangqi': false,
  'fortress-xiangqi': true,
  xiangqi: true,
  'dark-xiangqi': true,
  jieqi: true,
  banqi: true,
  luzhanqi: false,
  'reveal-chess': false,
  jungle: true,
  'jungle-flip': true,
  // Hidden until a player has checked the faan table: the hand mathematics is
  // proven against an independent implementation, the SCORING is not proven at
  // all, and a listing would invite people to trust numbers nobody has read.
  mahjong: false,
  'duck-xiangqi': true,
} satisfies Record<GameSpecId, boolean>;

const gameSpecIds = new Set<string>(GAME_SPECS.map((spec) => spec.id));
// Reachable by URL, unlisted and unindexed: /rules/shogi4 is linked from
// outside the site and stays up, but is not a Mistboard variant.
const HIDDEN_RULES_SLUGS = new Set(['shogi4']);
const RULES_GAME_SPEC_BY_SLUG: Record<string, GameSpecId> = {
  'fog-chess': 'dark-chess',
  'fog-xiangqi': 'dark-xiangqi',
};

export function isGameSpecId(value: string): value is GameSpecId {
  return gameSpecIds.has(value);
}

export function variantPublicSurfaceEnabled(id: GameSpecId): boolean {
  return VARIANT_PUBLIC_SURFACE_ENABLED[id];
}

/**
 * A rules page whose variant is retired (runtimeStatus 'retired' in
 * packages/game).
 * The server answers 410 for these paths; the client renders not-found rather
 * than the article, so a client-side navigation cannot show a page the server
 * has declared gone. Derived from the spec's own status: no second list.
 */
export function rulesSlugRetired(slug: string): boolean {
  const gameSpecId = RULES_GAME_SPEC_BY_SLUG[slug] ?? slug;
  return isRetiredGameSpec(gameSpecId);
}

export function rulesSlugPublicSurfaceEnabled(slug: string): boolean {
  if (HIDDEN_RULES_SLUGS.has(slug)) return false;
  const gameSpecId = RULES_GAME_SPEC_BY_SLUG[slug] ?? slug;
  return !isGameSpecId(gameSpecId) || variantPublicSurfaceEnabled(gameSpecId);
}

export function rulesHrefPublicSurfaceEnabled(href: string | undefined): boolean {
  const slug = rulesSlugFromHref(href);
  return slug === null || rulesSlugPublicSurfaceEnabled(slug);
}

export function gameSpecIdFromRulesHref(href: string | undefined): GameSpecId | null {
  const slug = rulesSlugFromHref(href);
  if (slug === null) return null;
  return gameSpecIdFromRulesSlug(slug);
}

/** The variant a `/rules/<slug>` page documents, or null when the slug is a
 *  concept page (`server-enforced-fog`) rather than a game. */
export function gameSpecIdFromRulesSlug(slug: string): GameSpecId | null {
  const gameSpecId = RULES_GAME_SPEC_BY_SLUG[slug] ?? slug;
  return isGameSpecId(gameSpecId) ? gameSpecId : null;
}

/** Whether a variant is offered a computer opponent in the play menu.
 *
 *  This is the ONE answer to "does this variant have a bot" on the web client,
 *  and it is deliberately not derivable from the tenant registry alone: the
 *  chess stack (dark chess) and the Xiangqi fog variants default their engines
 *  server-side and carry no tenant `engineOptions`, so a registry-only read
 *  reports "no bot" for variants that have one. Any surface that offers a
 *  "play the computer" link must call this rather than re-deriving it, or the
 *  link and the dialog it opens will disagree. */
export function variantSupportsPve(gameSpecId: GameSpecId): boolean {
  if (
    gameSpecId === DARK_CHESS_SPEC_ID ||
    gameSpecId === DARK_XIANGQI_SPEC_ID ||
    gameSpecId === DARK_MINI_XIANGQI_SPEC_ID
  )
    return true;
  return Boolean(webVariantTenantForSpecId(gameSpecId)?.landing?.engineOptions);
}

function rulesSlugFromHref(href: string | undefined): string | null {
  if (!href) return null;
  let pathname: string;
  try {
    pathname = new URL(href, 'https://mistboard.local').pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/rules\/([^/]+)$/);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}
