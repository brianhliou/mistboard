import { type GameSpecId, maybeGameSpecForId } from '@mistboard/game';
import { isFlipSeatVariant, seatInkForVariant } from './flip-seat-ink.js';
import { type I18nKey, t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import type { ProfileBoardThumb } from './profile-game-board.js';
import { seatColorWord, seatsNamePlayers } from './variant-seat-label.js';

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
  // east/west: xiangqi mahjong, whose seats are winds, not colours (variant-seat-label.ts SEAT_NAMING).
  color: 'white' | 'black' | 'red' | 'east' | 'west';
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

// 'old-rules': played under rules the variant has since changed, so the stored
// game no longer replays. 'unsupported-variant': no page mounts the variant.
export type GameUnavailableReason = 'old-rules' | 'unsupported-variant';

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
  startedAt?: string;
  endedAt?: string;
  // /api/games/showcase only: whether the homepage TV may air the game after the
  // fact (fog variants). See ShowcaseEntry.delayedAir.
  delayedAir?: boolean;
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
  // Profile, favorites and bot lists only: why this game cannot be opened
  // (server replayable-games.ts markUnavailableGames). The row is drawn without
  // a link. Absent means the game opens.
  unavailable?: GameUnavailableReason;
  playerColor?: GameParticipant['color'];
  // Banqi only: the ink bound to the first-mover seat on the opening flip, so list
  // surfaces can show the result by ink ("Black wins") rather than the seat token.
  // Absent/null for every other variant (seat == ink) and for unreplayable games.
  firstColor?: 'red' | 'black' | null;
  // Profile list with `?boards=1` only (#509): the final position as a
  // thumbnail, null when the game has none to draw.
  finalBoard?: ProfileBoardThumb | null;
};

export function displayParticipantName(
  game: FeaturedGame,
  color: GameParticipant['color'],
): string {
  const participant = participantForColor(game, color);
  if (participant) {
    // The server names a nameless guest seat with the English literal 'Guest';
    // it is a placeholder, not a name, so it goes through the catalog like the
    // live paths' fallback does.
    if (participant.subjectType === 'guest' && (participant.displayName ?? 'Guest') === 'Guest')
      return t('watch.guest');
    return displayParticipant(
      participant.displayName,
      fallbackSeatName(game.variant, color, game.firstColor),
      game.variant,
      participant.subjectId,
      {
        botId: participant.subjectType === 'bot' ? participant.subjectId : null,
        isEngine: participant.subjectType === 'bot' || participant.subjectType === 'engine-version',
      },
    );
  }
  const fallback = fallbackSeatName(game.variant, color, game.firstColor);
  const legacyName =
    color === 'white'
      ? (game.whiteEngineId ?? game.whiteName)
      : color === 'black'
        ? (game.blackEngineId ?? game.blackName)
        : null;
  return displayParticipant(legacyName, fallback, game.variant);
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
// resolves without editing here: xiangqi and jungle play red vs black,
// mahjong east vs west, Gomoku black vs white, chess white vs black.
export type MatchupSeatPair = readonly [GameParticipant['color'], GameParticipant['color']];

export function matchupSeats(game: FeaturedGame): MatchupSeatPair {
  // Gomoku opens with Black, including when persisted participants arrive
  // in white/black storage order.
  if (maybeGameSpecForId(game.variant)?.family === 'gomoku') return ['black', 'white'];
  const colors = new Set((game.participants ?? []).map((participant) => participant.color));
  if (colors.size >= 2) {
    if (colors.has('east') && colors.has('west')) return ['east', 'west'];
    if (!colors.has('red')) return ['white', 'black'];
    return colors.has('white') ? ['white', 'red'] : ['red', 'black'];
  }
  const family = maybeGameSpecForId(game.variant)?.family;
  if (family === 'xiangqi' || family === 'jungle') return ['red', 'black'];
  if (family === 'mahjong') return ['east', 'west'];
  return ['white', 'black'];
}

// The shared "X vs Y" line for list surfaces. Resolving the seats first is the
// whole trick: a xiangqi game has no 'white' participant, so a hardcoded
// 'white' lookup falls through to the literal seat word and drops the red
// player's name.
export function matchupLabel(game: FeaturedGame): string {
  const [first, second] = matchupSeats(game);
  return namesMatchupLabel(
    displayParticipantName(game, first),
    displayParticipantName(game, second),
  );
}

// "X vs Y" from two already-resolved names: a whole-phrase key, because the
// joining word is not "vs" in every locale.
export function namesMatchupLabel(first: string, second: string): string {
  return t('watch.matchup', { first, second });
}

function fallbackSeatName(
  variant: string | null | undefined,
  color: GameParticipant['color'],
  firstColor?: 'red' | 'black' | null,
): string {
  // A variant whose seat id is bookkeeping (xiangqi mahjong's east/west) has no
  // seat word to fall back on: a nameless seat is a guest, never "West".
  if (seatsNamePlayers(variant)) return t('watch.guest');
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
  gameSpecId: string,
  subjectId?: string | null,
  seat: SeatIdentity = {},
): string {
  const label = engineDisplayName(subjectId ?? name) ?? name;
  if (!label) return fallback;
  return seatNameForGame(label, gameSpecId, seat);
}

// Player-facing brand for a Misty build. Every Misty ships one brand: the
// variant tag and version ("Misty DXQ 1.1", "Misty 1.5") are
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

// Misty is one bot account playing several games. Wherever she is shown in one
// game, she takes that game's name ("Misty Banqi", "Misty 暗棋"); her multi-game
// profile and anything listing her across games keep plain "Misty". Display
// only: the bot id, ratings, URLs and stored names do not change.
export const MISTY_BOT_ID = 'misty';
// The ids Misty played under before her profiles merged (server
// first-party-bots.ts legacyBotIds); an old bot seat may still carry one.
const MISTY_LEGACY_BOT_IDS: ReadonlySet<string> = new Set([
  'misty-dark-chess',
  'misty-dmx',
  'misty-banqi',
  'misty-xiangqi-mahjong',
]);
// An engine seat's Misty names as the server resolves them: the brand, a rung
// ("Misty Level 4", "Misty level 4", "Misty Jungle level 3") or an older engine
// brand ("MistyBanqi Level 4"). Read only on a seat already known to be an
// engine, so a human account named "Misty" is never renamed.
const MISTY_ENGINE_SEAT =
  /^Misty(?:\s?(?:Banqi|Jungle|JungleFlip|ThreeKingdomsBanqi|FFQ))?(?:\s+[Ll]evel\s+\d+)?$/;

/** Who a seat is, as far as a payload says. */
export type SeatIdentity = { botId?: string | null; isEngine?: boolean };

/** The bot id behind a seat: its own when the payload names one, else Misty's
 *  when the seat is a Misty engine build or (on an engine seat) a Misty name. */
export function seatBotId(name: string | null | undefined, seat: SeatIdentity = {}): string | null {
  if (seat.botId) return seat.botId;
  if (!name) return null;
  if (MISTY_BUILD.test(name)) return MISTY_BOT_ID;
  return seat.isEngine && MISTY_ENGINE_SEAT.test(name) ? MISTY_BOT_ID : null;
}

/** A bot's name in one game. Misty takes the game's localized name and keeps
 *  her level ("Misty Banqi Level 4"); an unknown game leaves her "Misty". Every
 *  other bot keeps `name` unchanged. */
export function botNameForGame(
  botId: string | null | undefined,
  name: string,
  gameSpecId: string | null | undefined,
): string {
  if (!botId || (botId !== MISTY_BOT_ID && !MISTY_LEGACY_BOT_IDS.has(botId))) return name;
  const level = /[Ll]evel\s+(\d+)$/.exec(name)?.[1];
  const spec = gameSpecId ? maybeGameSpecForId(gameSpecId) : undefined;
  const base = spec ? `Misty ${variantDisplayLabel(spec.id)}` : 'Misty';
  return level ? `${base} Level ${level}` : base;
}

/** A seat name as a page about one game shows it: engine builds collapse to the
 *  brand, and Misty takes the game's name. */
export function seatNameForGame(
  name: string,
  gameSpecId: string | null | undefined,
  seat: SeatIdentity = {},
): string {
  const branded = brandedEngineName(name) ?? name;
  const botId = seatBotId(name, seat);
  return botId ? botNameForGame(botId, branded, gameSpecId) : branded;
}

/** A live payload's seat name as a page should show it. The finished-game feeds
 *  reach the same result through displayParticipant; live frames carry a bare
 *  name, so they brand here instead. With the game, Misty takes its name. */
export function displayLiveName(
  name: string | null | undefined,
  fallback: string,
  game?: SeatIdentity & { gameSpecId?: string | null },
): string {
  if (!name) return fallback;
  if (!game) return brandedEngineName(name) ?? name;
  return seatNameForGame(name, game.gameSpecId, game);
}

// The seat that moves first in a live game: red (xiangqi family, jungle), white
// (chess) or east (Xiangqi Mahjong's dealer seat). Gomoku seats black and white
// and black moves first, so the colour alone cannot decide it: the spec is required.
const FIRST_MOVER_COLORS = new Set(['red', 'white', 'east']);

export function liveFirstMover<T extends { color: string }>(
  players: readonly T[],
  gameSpecId: string,
): T | undefined {
  if (maybeGameSpecForId(gameSpecId)?.family === 'gomoku') {
    return players.find((player) => player.color === 'black') ?? players[0];
  }
  return players.find((player) => FIRST_MOVER_COLORS.has(player.color)) ?? players[0];
}

/** First/second-mover names for a live featured game, or null without two
 *  seats. A null name is a guest seat. */
export function liveMatchupNames(
  players: readonly ({ color: string; name: string | null | undefined } & SeatIdentity)[],
  guest: string,
  gameSpecId: string,
): { first: string; second: string } | null {
  if (players.length < 2) return null;
  const first = liveFirstMover(players, gameSpecId)!;
  const second = players.find((player) => player !== first) ?? players[1]!;
  return {
    first: displayLiveName(first.name, guest, { ...first, gameSpecId }),
    second: displayLiveName(second.name, guest, { ...second, gameSpecId }),
  };
}

// Correspondence seeks store a side as MOVE ORDER ('first'/'second'), variant-neutral, so
// one seek board serves every eligible variant. These map that axis back to the words a
// player recognises: chess is White/Black, the xiangqi family Red/Black, Jungle Red/Blue. Banqi
// and Flip Jungle seat 'red'/'black' but a player's colour is decided by the first flip,
// so their sides are First/Second, as the play menu labels them. Fail-safe: an unknown spec
// falls back to White/Black rather than throwing (worst case a wrong color WORD on the
// label; the seat itself is always assigned by the tenant's own colors). The mahjong
// family seats east and west, and east deals first.
const WHITE_FIRST_SPECS: ReadonlySet<string> = new Set(['dark-chess', 'chess']);

export function firstMoverColorName(gameSpecId: string): string {
  if (maybeGameSpecForId(gameSpecId)?.family === 'gomoku') return t('setup.black');
  if (isFlipSeatVariant(gameSpecId)) return t('setup.first');
  if (maybeGameSpecForId(gameSpecId)?.family === 'mahjong') return t('live.seatEast');
  if (WHITE_FIRST_SPECS.has(gameSpecId) || !maybeGameSpecForId(gameSpecId)) {
    return t('setup.white');
  }
  return t('setup.red');
}

export function secondMoverColorName(gameSpecId: string): string {
  if (maybeGameSpecForId(gameSpecId)?.family === 'gomoku') return t('setup.white');
  if (maybeGameSpecForId(gameSpecId)?.family === 'mahjong') return t('live.seatWest');
  return isFlipSeatVariant(gameSpecId) ? t('setup.second') : seatColorWord(gameSpecId, 'black');
}

// Catalog name key per spec. Exhaustive over GameSpecId on purpose: a new
// union member fails the build until it decides, matching the fail-closed
// registry rule. `null` means "no catalog name yet" (the runtimeStatus
// 'future' specs), and the caller falls back to the
// spec's English publicName rather than inventing a product name.
export const VARIANT_NAME_KEYS: Readonly<Record<GameSpecId, I18nKey | null>> = {
  gomoku: 'variant.gomoku.name',
  banqi: 'variant.banqi.name',
  'ffq-banqi': null,
  // runtimeStatus 'future': falls back to the spec's English publicName.
  mahjong: null,
  'xiangqi-mahjong': 'variant.xiangqiMahjong.name',
  // Hidden playtest (#628, #684): admin-only on prod.
  'three-kingdoms-banqi': 'variant.threeKingdomsBanqi.name',
  'dark-chess': 'variant.darkChess.name',
  'dark-xiangqi': 'variant.darkXiangqi.name',
  'fortress-xiangqi': 'variant.fortressXiangqi.name',
  jieqi: 'variant.jieqi.name',
  jungle: 'variant.jungle.name',
  'jungle-flip': 'variant.jungleFlip.name',
  xiangqi: 'variant.xiangqi.name',
  'crazyhouse-xiangqi': 'variant.crazyhouseXiangqi.name',
  'duck-xiangqi': 'variant.duckXiangqi.name',
  'atomic-xiangqi': 'variant.atomicXiangqi.name',
  // Study-only, but it sits beside xiangqi studies on /study, so it is named.
  chess: 'variant.chess.name',
};

// Localized variant name for a spec id, or null when the catalog has no name
// for it. The single home for this mapping: analysis-page and bots each kept
// their own partial copy, and the bots one silently missed xiangqi, jungle,
// jungle-flip, and dark-xiangqi.
export function variantNameKeyForSpecId(gameSpecId: string): I18nKey | null {
  const id = maybeGameSpecForId(gameSpecId)?.id;
  return id ? VARIANT_NAME_KEYS[id] : null;
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

// "<Color> wins" for a resolved ink word. The colour word and the verb are one
// key so the zh catalogs can write 红方获胜 instead of gluing "红方" to "wins".
export function colorWinsLabel(colorWord: string): string {
  return t('watch.colorWins', { color: colorWord });
}

// A finished game's outcome as data, so every sentence built around it (the
// review meta card's "Checkmate • Red is victorious", the TV chip's "Red wins")
// is one catalog key with the winner's word as a parameter. The string-surgery
// version (strip " wins" off an English label to recover the winner) broke the
// moment the label was translated. `winner` is the resolved ink WORD; `label`
// is an outcome the model does not understand, shown as-is.
export type GameOutcome = { winner: string } | { draw: true } | { label: string };

// Outcome for the fixed-colour variants (seat == ink). Flip variants resolve
// the winner through firstColor in their own modules (banqiOutcome,
// jungleFlipOutcome).
export function gameOutcome(result: string, variant?: string | null): GameOutcome {
  if (result === 'red-wins') return { winner: seatColorWord(variant, 'red') };
  if (result === 'black-wins') return { winner: seatColorWord(variant, 'black') };
  if (result === 'white-wins') return { winner: seatColorWord(variant, 'white') };
  if (result === 'draw') return { draw: true };
  if (result === 'east-wins' || result === 'west-wins') {
    // No participants reach this function, so a player-named variant gets the
    // seat-neutral word rather than "West wins" (variant-seat-label.ts SEAT_NAMING).
    if (seatsNamePlayers(variant)) return { label: t('watch.won') };
    return { winner: seatColorWord(variant, result === 'east-wins' ? 'east' : 'west') };
  }
  return { label: humanizeToken(result) };
}

// "Red wins" / "Draw" / the pass-through label.
export function outcomeLabel(outcome: GameOutcome): string {
  if ('winner' in outcome) return colorWinsLabel(outcome.winner);
  if ('draw' in outcome) return t('watch.draw');
  return outcome.label;
}

// 'no-progress' -> 'No progress'. The fallback for a code no catalog names.
export function humanizeToken(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Player-facing label for a persisted games.termination code. Total over the
// server's GameTermination union; an unknown code (a future one, or a legacy row)
// humanizes the kebab token rather than throwing, so a list surface never dies
// on one row. Mirrors the live room's reasonPhraseLabel, which covers only the
// six reasons the chess stack emits.
const TERMINATION_KEYS: Record<string, I18nKey> = {
  'king-captured': 'replay.endKingCaptured',
  'general-captured': 'replay.endGeneralCaptured',
  timeout: 'replay.endTimeout',
  checkmate: 'replay.endCheckmate',
  draw: 'replay.endDraw',
  resignation: 'replay.endResignation',
  'engine-failure': 'replay.endEngineFailure',
  'worker-aborted': 'replay.endWorkerAborted',
  'server-restarted': 'replay.endServerRestarted',
  abandoned: 'replay.endAbandoned',
  abandonment: 'replay.endAbandoned',
  'no-legal-moves': 'replay.endNoLegalMoves',
  stalemate: 'replay.endStalemate',
  repetition: 'replay.endRepetition',
  'progress-clock': 'replay.endProgressClock',
  truncated: 'replay.endTruncated',
  race: 'replay.endRace',
  chasing: 'replay.endChasing',
  'perpetual-chase': 'replay.endPerpetualChase',
  'dead-position': 'replay.endDeadPosition',
  points: 'replay.endPoints',
  'den-entered': 'replay.endDenEntered',
  'pieces-captured': 'replay.endPiecesCaptured',
};

// The persisted goal-win code is shared by two different rules. A scoped
// lookup must name the variant explicitly, never borrow another game's goal.
const RACE_TERMINATION_KEYS = new Map<GameSpecId, I18nKey>([
  ['gomoku', 'replay.endFive'],
  ['jungle', 'replay.endRace'],
  ['jungle-flip', 'replay.endRace'],
]);

export function terminationLabel(
  termination: string,
  locale?: Locale,
  variant?: GameSpecId,
): string {
  if (!termination) return '';
  if (termination === 'race' && variant !== undefined) {
    const key = RACE_TERMINATION_KEYS.get(variant);
    if (!key) throw new Error(`Unsupported race termination for ${variant}`);
    return t(key, {}, locale);
  }
  const key = TERMINATION_KEYS[termination];
  if (key) return t(key, {}, locale);
  return humanizeToken(termination);
}

/** The ending as it reads mid-sentence ("Red wins by timeout"): the label lowercased. */
export function terminationReason(termination: string, locale?: Locale): string {
  return terminationLabel(termination, locale).toLowerCase();
}

// A watch/games rail channel's name in the page locale. The server's `label` is
// English; every variant channel's id IS its spec id, so the variant-name
// catalog covers it, and the two cross-variant channels (Featured, Engines) get
// their own keys. A channel the catalog cannot name keeps the server label.
export function watchChannelLabel(channel: { id: string; label: string }): string {
  if (channel.id === 'top') return t('watch.featuredChannel');
  if (channel.id === 'engines') return t('watch.enginesChannel');
  const key = variantNameKeyForSpecId(channel.id);
  return key ? t(key) : channel.label;
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
