import { type GameSpecId, maybeGameSpecForId } from '@mistboard/game';
import { isFlipSeatVariant, seatInkForVariant } from './flip-seat-ink.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { seatColorWord } from './variant-seat-label.js';

export const MISTBOARD_ENGINE_SNAPSHOT_ID = 'engine-v2-2026-05-24';
export const MISTBOARD_ENGINE_SNAPSHOT_NAME = 'Mistboard Engine v2.0';
export const MISTBOARD_ENGINE_BASELINE_NAME = 'Mistboard Engine v0.9.5';

// Current player-facing engine identity (the v2 engine). This MUST track the
// server's live active engine (MISTY_DARK_CHESS_ACTIVE_ENGINE_ID in
// apps/server/src/first-party-bots.ts); web and server hold separate literals, so
// bump both together when Misty ships a new version. Used for the homepage
// self-play showcase and as the canonical display name wherever the engine's
// subject id appears.
export const MISTBOARD_ENGINE_MISTY_ID = 'python-v2-v1.6';
export const MISTBOARD_ENGINE_MISTY_NAME = 'Misty 1.6';

export type GameParticipant = {
  color: 'white' | 'black' | 'red';
  displayName: string;
  subjectType: 'guest' | 'user' | 'bot' | 'engine-version' | 'manual' | 'imported';
  subjectId: string | null;
  visibility: 'private' | 'link' | 'unlisted' | 'public';
  // The account handle behind a `user` seat, present only when the profile is
  // safe to link (open account, non-private profile). `subjectId` for a user is
  // an internal user id that /@/:handle cannot address, so this is the ONLY
  // field that may build a member profile href — see profile-link.ts.
  handle?: string | null;
  ratingBefore?: number | null;
  ratingAfter?: number | null;
};

// The shaped seat roster the postgame endpoints emit (`postgamePlayers` on the
// server): private seats name-redacted, corpus names applied, engine seats tagged.
// The review left rail reads THIS, not whiteName/blackName — see
// review/game-review-meta.ts. Optional on FeaturedGame because the showcase/list
// feeds don't carry it; every postgame endpoint does.
export type PostgamePlayerRow = {
  color: string;
  name: string;
  rating: number | null;
  kind: 'account' | 'guest' | 'engine';
  // Linkable profile identity, at most one set. `kind` cannot stand in for
  // these: it collapses users and bots into 'account'. Optional because a few
  // surfaces hand-build partial rows; absent means "no page", same as null.
  handle?: string | null;
  botId?: string | null;
};

export type FeaturedGame = {
  roomId: string;
  variant: string;
  mode?: 'pvp' | 'pve' | 'eve' | 'imported' | 'manual';
  // Whether the game counted toward ratings. Absent on feeds that don't carry
  // it (treated as rated by COALESCE on the server); the profile list relies on
  // it to tag rows rated vs casual.
  rated?: boolean;
  result: string;
  termination: string;
  plyCount: number;
  whiteName: string | null;
  blackName: string | null;
  corpusId: string | null;
  endedAt?: string;
  jobId?: string | null;
  gameIndex?: number | null;
  whiteEngineId?: string | null;
  blackEngineId?: string | null;
  timeControl?: Record<string, unknown> | null;
  // Real-clock games (PvP/PvE) carry their time control in these columns; the
  // legacy `timeControl` blob is null for them. gameMetaForGame rebuilds a
  // time-control object from these when `timeControl` is absent.
  initialMs?: number | null;
  incrementMs?: number | null;
  participants?: GameParticipant[];
  players?: PostgamePlayerRow[];
  playerColor?: GameParticipant['color'];
  // Banqi only: the ink bound to the first-mover seat on the opening flip, so list
  // surfaces can show the result by ink ("Black wins") rather than the seat token.
  // Absent/null for every other variant (seat == ink) and for unreplayable games.
  firstColor?: 'red' | 'black' | null;
};

export function displayParticipantName(
  game: FeaturedGame,
  color: GameParticipant['color'],
): string {
  const participant = participantForColor(game, color);
  if (participant)
    return displayParticipant(
      participant.displayName,
      fallbackSeatName(game.variant, color, game.firstColor),
      participant.subjectId,
    );
  const fallback = fallbackSeatName(game.variant, color, game.firstColor);
  const legacyName =
    color === 'white'
      ? (game.whiteEngineId ?? game.whiteName)
      : color === 'black'
        ? (game.blackEngineId ?? game.blackName)
        : null;
  return displayParticipant(legacyName, fallback);
}

export function participantForColor(
  game: FeaturedGame,
  color: GameParticipant['color'],
): GameParticipant | null {
  return game.participants?.find((participant) => participant.color === color) ?? null;
}

// The two seats a game is played across, in first-mover/second-mover order.
// Persisted participants are decisive when both seats are present (they
// reflect what's actually stored and are immune to legacy variant aliases);
// otherwise the pair derives from the canonical spec family, so a new variant
// resolves without editing here: the xiangqi and jungle families play red vs
// black, the crossroads-chess family (open + dark) plays white vs red, and
// everything else is orthodox white vs black.
export type MatchupSeatPair = readonly [GameParticipant['color'], GameParticipant['color']];

export function matchupSeats(game: FeaturedGame): MatchupSeatPair {
  const colors = new Set((game.participants ?? []).map((participant) => participant.color));
  if (colors.size >= 2) {
    if (!colors.has('red')) return ['white', 'black'];
    return colors.has('white') ? ['white', 'red'] : ['red', 'black'];
  }
  if (isCrossroadsChessVariant(game.variant)) return ['white', 'red'];
  const family = maybeGameSpecForId(game.variant)?.family;
  if (family === 'xiangqi' || family === 'jungle') return ['red', 'black'];
  if (family === 'crossroads-chess') return ['white', 'red'];
  return ['white', 'black'];
}

// The shared "X vs Y" line for list surfaces. Resolving the seats first is the
// whole trick: a xiangqi game has no 'white' participant, so a hardcoded
// 'white' lookup falls through to the literal seat word and drops the red
// player's name.
export function matchupLabel(game: FeaturedGame): string {
  const [first, second] = matchupSeats(game);
  return `${displayParticipantName(game, first)} vs ${displayParticipantName(game, second)}`;
}

// Crossroads kept its legacy 'dual-chess' id in old rows; the spec registry
// only knows the canonical id, so alias-aware callers check here.
export function isCrossroadsChessVariant(variant: string): boolean {
  return variant === 'crossroads-chess' || variant === 'dual-chess';
}

function fallbackSeatName(
  variant: string | null | undefined,
  color: GameParticipant['color'],
  firstColor?: 'red' | 'black' | null,
): string {
  // Flip variants (banqi, jungle-flip) seat by MOVE ORDER, so the seat id is not a
  // colour claim: naming a nameless seat "Red" is wrong for half of all games. Use
  // the bound ink when the row carries firstColor, and the move-order word when it
  // does not — which is every surface whose feed never derives it (profile, landing,
  // /database), plus any game whose log will not replay.
  if (isFlipSeatVariant(variant)) {
    const ink = seatInkForVariant(variant, color, firstColor ?? null);
    if (ink === null) return color === 'red' ? t('setup.first') : t('setup.second');
    return seatColorWord(variant, ink);
  }
  // Jungle's second seat reads "Blue" (see variant-seat-label.ts); every other
  // variant keeps the literal color word.
  return seatColorWord(variant, color);
}

function displayParticipant(
  name: string | null | undefined,
  fallback: string,
  subjectId?: string | null,
): string {
  const label = engineDisplayName(subjectId ?? name) ?? name;
  if (!label) return fallback;
  return brandedEngineName(label) ?? label;
}

// Player-facing brand for a Misty build. Every Misty ships one brand: the
// variant tag and version ("Misty DXQ 1.1", "Misty 1.5", "Misty DMX 1.0") are
// engine identity, and asking a player to parse them mid-board buys nothing —
// they are playing Misty. The exact build still shows wherever it decides
// something: the admin engine registry, /engines, and the engine detail pages
// all read the registry directly rather than passing through here.
//
// The shape is deliberately narrow — brand, optional uppercase variant tag,
// dotted version — so it can only ever match a build string. A human account
// called "Misty" already renders as "Misty"; one called "Misty the Great" is
// left alone rather than being renamed by an engine rule.
const MISTY_BUILD = /^Misty(?:\s+[A-Z]{2,5})?\s+\d+(?:\.\d+)*$/;

export function brandedEngineName(name: string): string | null {
  return MISTY_BUILD.test(name) ? 'Misty' : null;
}

/** A live payload's seat name as a page should show it. The finished-game feeds
 *  reach the same result through displayParticipant; live frames carry a bare
 *  name, so they brand here instead. */
export function displayLiveName(name: string | null | undefined, fallback: string): string {
  if (!name) return fallback;
  return brandedEngineName(name) ?? name;
}

// Correspondence seeks store a side as MOVE ORDER ('first'/'second'), variant-neutral, so
// one seek board serves every eligible variant. These map that axis back to the colors a
// player recognises: chess is White/Black, xiangqi Red/Black. Both eligible specs share
// Black as the second mover, so only the first-mover name varies. Fail-safe: an unmapped
// spec falls back to White/Black rather than throwing (worst case a wrong color WORD on the
// label; the seat itself is always assigned by the tenant's own colors).
export function firstMoverColorName(gameSpecId: string): string {
  return gameSpecId === 'xiangqi' ? t('setup.red') : t('setup.white');
}

export function secondMoverColorName(_gameSpecId: string): string {
  return t('setup.black');
}

// Catalog name key per spec. Exhaustive over GameSpecId on purpose: a new
// union member fails the build until it decides, matching the fail-closed
// registry rule. `null` means "no catalog name yet" (the runtimeStatus
// 'future' specs and parked luzhanqi), and the caller falls back to the
// spec's English publicName rather than inventing a product name.
export const VARIANT_NAME_KEYS: Record<GameSpecId, I18nKey | null> = {
  banqi: 'variant.banqi.name',
  // runtimeStatus 'future': falls back to the spec's English publicName.
  mahjong: null,
  'crossroads-chess': 'variant.crossroadsChess.name',
  'dark-antichess': null,
  'dark-chess': 'variant.darkChess.name',
  'dark-crazyhouse': 'variant.darkCrazyhouse.name',
  'dark-crossroads-chess': 'variant.darkCrossroadsChess.name',
  'dark-draft960': 'variant.darkDraft960.name',
  'dark-mini-xiangqi': 'variant.darkMiniXiangqi.name',
  'dark-omega': null,
  'dark-seirawan': null,
  'dark-shogi': 'variant.darkShogi.name',
  'dark-xiangqi': 'variant.darkXiangqi.name',
  'drop-mini-xiangqi': 'variant.dropMiniXiangqi.name',
  'fortress-xiangqi': 'variant.fortressXiangqi.name',
  jieqi: 'variant.jieqi.name',
  jungle: 'variant.jungle.name',
  'jungle-flip': 'variant.jungleFlip.name',
  kriegspiel: 'variant.kriegspiel.name',
  'lao-tzu': null,
  luzhanqi: null,
  'mini-xiangqi': 'variant.miniXiangqi.name',
  'reveal-chess': 'variant.revealChess.name',
  'sun-tzu': null,
  xiangqi: 'variant.xiangqi.name',
};

// Localized variant name for a spec id, or null when the catalog has no name
// for it. The single home for this mapping: analysis-page and bots each kept
// their own partial copy, and the bots one silently missed xiangqi, jungle,
// jungle-flip, and dark-xiangqi.
export function variantNameKeyForSpecId(gameSpecId: string): I18nKey | null {
  const spec = maybeGameSpecForId(gameSpecId);
  return spec ? (VARIANT_NAME_KEYS[spec.id] ?? null) : null;
}

// Human label for a persisted games.variant value. Legacy/alias strings resolve
// through maybeGameSpecForId, so the catalog name covers them too; everything
// else derives from the canonical spec so new variants are labelled without
// editing here.
export function variantDisplayLabel(variant: string): string {
  const key = variantNameKeyForSpecId(variant);
  if (key) return t(key);
  return maybeGameSpecForId(variant)?.publicName ?? variant;
}

export function sourceLabel(mode: FeaturedGame['mode']): string {
  if (mode === 'eve') return t('watch.engineVsEngine');
  if (mode === 'pve') return t('watch.humanVsEngine');
  if (mode === 'pvp') return t('watch.humanVsHuman');
  if (mode === 'imported') return t('watch.importedGame');
  if (mode === 'manual') return t('watch.manualGame');
  return t('watch.fogChessGame');
}

function engineDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const known: Record<string, string> = {
    'builtin-capture-seeker': 'Capture Seeker v1',
    'builtin-random-legal': 'Random Legal v1',
    [MISTBOARD_ENGINE_SNAPSHOT_ID]: MISTBOARD_ENGINE_SNAPSHOT_NAME,
    [MISTBOARD_ENGINE_MISTY_ID]: MISTBOARD_ENGINE_MISTY_NAME,
    // Historical Misty versions keep their exact shipped label here so an id
    // always resolves to the build that actually played. Player-facing rows then
    // collapse them to the brand (brandedEngineName); this map is the identity,
    // not the display.
    'python-v2-v1.0': 'Misty 1.0',
    'python-v2-v1.1': 'Misty 1.1',
    'python-v2-v1.2': 'Misty 1.2',
    'python-v2-v1.3': 'Misty 1.3',
    'python-v2-v1.4': 'Misty 1.4',

    'python-random-legal': 'Random Legal Python v1',
    'python-tier1-v0.7.0': 'Mistboard Engine preview',
    'python-tier1-v0.7.22': 'Mistboard Engine preview',
    'python-tier1-v0.8.9': 'Mistboard Engine preview',
    'python-tier1-v0.9.1': 'Mistboard Engine preview',
    'python-tier1-v0.9.5': MISTBOARD_ENGINE_BASELINE_NAME,
    'python-tier1-current': 'Mistboard Engine dev build',
    'python-dmx-v1.0': 'Misty DMX 1.0',
  };
  return known[name] ?? null;
}
