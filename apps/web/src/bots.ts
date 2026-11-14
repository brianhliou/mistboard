// Public bot directory (/bots) and bot profile (/bot/:id). The directory picks
// a game, then lists one card per opponent (a ladder is one card with a level
// picker; bot-opponents.ts in @mistboard/game holds the grouping); the profile page reuses the player-profile surface primitives
// (profile-shell, header shell, rating rail, game rows) so it renders as a
// sibling of /@handle. Play affordances create the game directly via
// bot-play.ts; there is no setup dialog.
import {
  BANQI_SPEC_ID,
  BOT_OPPONENTS,
  botOpponentById,
  botOpponentForBotId,
  canonicalVariantOrderIndex,
  type GameSpecId,
  JUNGLE_FLIP_SPEC_ID,
  THREE_KINGDOMS_BANQI_SPEC_ID,
} from '@mistboard/game';
import { t } from './i18n/catalog.js';
import './account-profile.css';
import './bots.css';
import './current-games.css';
import { type BotPlayTarget, bindBotPlayControl } from './bot-play.js';
import { CHAMPIONS } from './champions-page.js';
import { buildCommunityLayout } from './community-rail.js';
import { RAPFI_BUILD_URL, RAPFI_REPO_URL } from './engine-credits.js';
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import { botNameForGame, type FeaturedGame, variantDisplayLabel } from './game-display.js';
import {
  JIEQI_FIRST_GAME_LEVEL,
  type LandingBotRung,
  landingBotLadder,
  XIANGQI_FIRST_GAME_LEVEL,
} from './landing-bot-policy.js';
import { buildBotSummaryCard } from './profile-summary-card.js';
import {
  buildProfileDashboard,
  buildProfileGameRow,
  buildProfileOverviewShell,
  buildProfileTabsShell,
} from './profile-ui.js';
import { buildNav, buildNotice } from './site-shell.js';
import {
  setThreeKingdomsBanqiEngineOptions,
  threeKingdomsBanqiOffered,
} from './three-kingdoms-banqi-access.js';
import { buildUiIcon } from './ui-icon.js';
import { renderVariantMarker } from './variant-markers.js';
import type { WebTenantEngineOption } from './variant-tenant/registry.js';
import { variantMiniIdForRawVariant } from './variants.js';

type BotPlayOption = {
  gameSpecId: string;
  engineId: string;
  playable: boolean;
  // The engine build this variant plays, from the server's pins
  // (bot-engine-versions.ts); absent when none is recorded.
  version?: string;
};

type BotRecord = {
  games: number;
  wins: number;
  losses: number;
  draws: number;
};

type BotRatingSnapshot = {
  gameSpecId: string;
  timeClass: 'bullet' | 'blitz' | 'rapid';
  rating: number;
  ratingDeviation: number | null;
  games: number;
  source: 'manual' | 'eve-anchor' | 'import';
  sourceRef: string | null;
  createdAt: string;
  provisional: boolean;
};

type BotProfile = {
  id: string;
  displayName: string;
  bio: string;
  ownerType: 'system' | 'user';
  ownerUserId: string | null;
  activeEngineId: string;
  defaultGameSpecId: string;
  supportedGameSpecIds: string[];
  play: {
    mode: 'pve';
    gameSpecId: string;
    engineId: string;
    timeControl: { initialMs: number; incrementMs: number };
    preferredColor: 'random' | 'white' | 'black' | 'red';
  };
  playOptions?: BotPlayOption[];
  gamesTotal: number;
  record: BotRecord;
  rating: BotRatingSnapshot | null;
  ratings?: BotRatingSnapshot[];
  games?: FeaturedGame[];
  // Per-variant record and recent games, keyed by game spec id. The profile
  // shows ONE variant at a time, so these are what its header, side stats and
  // games list read; `gamesTotal`/`record`/`games` stay lifetime-across-variants
  // for the /bots directory card. Optional so an older payload still renders --
  // botRecordFor/botGamesFor fall back to the lifetime figures.
  recordsByGameSpecId?: Record<string, BotRecord>;
  gamesByGameSpecId?: Record<string, FeaturedGame[]>;
};

class BotNotFound extends Error {}

// Games per "Load more" click on a bot profile (server routes/bots.ts).
// The profile payload carries ten rows per variant; continuation pages carry fifteen.
const BOT_PROFILE_GAMES_PAGE = 10;
const BOT_GAMES_PAGE = 15;

// The top jungle slot above Misty (2026-10, #434); server first-party-bots.ts.
const JUNGLE_TOP_BOT_ID = 'katago';
// The xiangqi bot that plays its worst move (2026-10-17), its own opponent.
const XIANGQI_WORST_BOT_ID = 'general-blunder';
// The game /bots opens on when ?game= names none.
const DEFAULT_DIRECTORY_GAME = 'xiangqi';

// /bots: every game the site's bots play, chosen first in the rail (?game=,
// xiangqi by default), then one card per opponent for that game. The server
// body for crawlers (apps/server bots-page-body.ts) keeps the xiangqi query
// "play xiangqi against the computer" (象棋人机对战) as its heading.
export async function mountBots(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'bots-route');

  const shell = document.createElement('main');
  shell.className = 'site-section community-shell bots-shell';

  const header = document.createElement('section');
  header.className = 'bots-directory-header';
  const headerCopy = document.createElement('div');
  headerCopy.className = 'bots-directory-header-copy';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('bots.directoryHeading');

  const sub = document.createElement('p');
  sub.className = 'bots-sub';
  sub.textContent = t('bots.directorySub');

  const meta = document.createElement('div');
  meta.className = 'bots-directory-meta';
  meta.append(buildDirectoryMeta(t('bots.metaFree')), buildDirectoryMeta(t('bots.metaNoAccount')));
  headerCopy.append(heading, sub, meta);

  header.append(headerCopy);

  const layout = document.createElement('div');
  layout.className = 'current-games-layout bots-layout';
  const rail = document.createElement('nav');
  rail.className = 'current-games-rail bots-game-rail';
  rail.setAttribute('aria-label', t('bots.gamesLabel'));
  const body = document.createElement('section');
  body.className = 'bots-directory';
  body.append(statusLine(t('bots.loading')));
  layout.append(rail, body);

  const content = document.createElement('div');
  content.className = 'bots-main';
  content.append(header, layout);

  shell.append(buildCommunityLayout('/bots', content));
  root.append(buildNav(), shell);

  // The engine roster rides beside the bot list: it says which of Misty's
  // levels this server can seat (Banqi and Flip Jungle Level 8 need a net), and
  // TK's Misty plays by engine id with no bot profile, so /api/bots never names it.
  const botsLoad = fetchBots();
  const rostersLoad = fetchEngineRosters();
  let bots: BotProfile[];
  try {
    bots = await botsLoad;
  } catch {
    body.replaceChildren(buildNotice(t('bots.unavailableTitle'), t('bots.unavailableBody')));
    return;
  }

  const engineOpponents = engineLadderOpponents(bots, await rostersLoad);
  if (bots.length === 0 && engineOpponents.size === 0) {
    body.replaceChildren(statusLine(t('bots.none')));
    return;
  }

  mountDirectory(rail, body, bots, engineOpponents);
}

/** The engine tiers this server can seat, from GET /api/engines/playable (the
 *  homepage's source). A list is undefined when the server did not say (a
 *  failed fetch or an older server). */
export type EngineRosters = {
  banqi?: readonly { id: string }[];
  jungleFlip?: readonly { id: string }[];
  threeKingdomsBanqi?: readonly WebTenantEngineOption[];
};

// Never throws: a failed fetch is a roster that said nothing.
async function fetchEngineRosters(): Promise<EngineRosters> {
  try {
    const resp = await fetch('/api/engines/playable', { headers: { accept: 'application/json' } });
    if (!resp.ok) return {};
    const data = (await resp.json()) as {
      banqiEngines?: { id: string }[];
      jungleFlipEngines?: { id: string }[];
      threeKingdomsBanqiEngines?: WebTenantEngineOption[];
    };
    if (threeKingdomsBanqiOffered() && data.threeKingdomsBanqiEngines !== undefined) {
      setThreeKingdomsBanqiEngineOptions(data.threeKingdomsBanqiEngines);
    }
    return {
      banqi: data.banqiEngines,
      jungleFlip: data.jungleFlipEngines,
      threeKingdomsBanqi: data.threeKingdomsBanqiEngines,
    };
  } catch {
    return {};
  }
}

function buildDirectoryMeta(label: string): HTMLElement {
  const item = document.createElement('span');
  item.textContent = label;
  return item;
}

export async function mountBotProfile(root: HTMLElement, botId: string): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'profile-route', 'bots-route');

  const shell = document.createElement('main');
  shell.className = 'profile-shell bot-profile-shell';
  root.append(buildNav(), shell);

  let bot: BotProfile;
  try {
    bot = await fetchBotProfile(botId);
  } catch (err) {
    if (err instanceof BotNotFound) {
      document.title = `${t('bots.notFoundTitle')} · Mistboard`;
      shell.append(buildNotice(t('bots.notFoundTitle'), t('bots.notFoundBody')));
      return;
    }
    document.title = `${t('bots.unavailableTitle')} · Mistboard`;
    shell.append(buildNotice(t('bots.unavailableTitle'), t('bots.profileLoadFailedBody')));
    return;
  }

  document.title = t('bots.profileTitle', { name: bot.displayName });

  const options = playOptionsFor(bot);
  const primaryGameSpecId = primaryRating(bot)?.gameSpecId;
  let selectedGameSpecId =
    options.find((option) => option.gameSpecId === primaryGameSpecId)?.gameSpecId ??
    options[0]?.gameSpecId ??
    bot.defaultGameSpecId;
  let overview = buildBotOverview(bot, selectedGameSpecId);
  // The games panel is rebuilt on variant switch too. It used to be built once,
  // outside this closure, so the list stayed on whatever variant loaded first --
  // and since the flat list was "most recent across all variants", the xiangqi
  // view could show an all-jieqi list.
  let games = buildRecentGames(bot, selectedGameSpecId);
  games.id = `bot-games-${bot.id}`;
  const ratings = buildBotRatingsRail(bot, {
    selectedGameSpecId,
    onSelect: (gameSpecId) => {
      selectedGameSpecId = gameSpecId;
      const nextOverview = buildBotOverview(bot, selectedGameSpecId);
      overview.replaceWith(nextOverview);
      overview = nextOverview;
      const nextGames = buildRecentGames(bot, selectedGameSpecId);
      // The tab panel is addressed by id, so carry it across the swap.
      nextGames.id = games.id;
      games.replaceWith(nextGames);
      games = nextGames;
      syncSelectedBotRating(ratings, selectedGameSpecId);
    },
  });
  const tabs = buildProfileTabsShell([
    {
      label: t('bots.recentGames'),
      panel: games,
    },
  ]);

  shell.append(buildProfileDashboard(ratings, overview, tabs));
}

async function fetchBots(): Promise<BotProfile[]> {
  const resp = await fetch('/api/bots', { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`bots_failed_${resp.status}`);
  const data = (await resp.json()) as { bots: BotProfile[] };
  return data.bots;
}

async function fetchBotProfile(botId: string): Promise<BotProfile> {
  const resp = await fetch(`/api/bots/${encodeURIComponent(botId)}`, {
    headers: { accept: 'application/json' },
  });
  if (resp.status === 404) throw new BotNotFound();
  if (!resp.ok) throw new Error(`bot_profile_failed_${resp.status}`);
  const data = (await resp.json()) as { bot: BotProfile };
  return data.bot;
}

// ── Directory ───────────────────────────────────────────────────────────────

// /bots picks the game first (the rail, ?game=), then shows one card per
// opponent that plays it. A ladder of levels is one card with a level picker,
// not eight cards. Which bots make up an opponent is the explicit map in
// @mistboard/game bot-opponents.ts, never a name prefix; a bot outside it (a
// community bot) is its own card. Each card shows only the chosen game: its
// Play button, its rating and its record. Grouping is presentation only: the
// card plays, links to and reports one member bot.

type DirectoryMember = {
  bot: BotProfile;
  level: number | null;
  /** The picker value when members share a bot id (Misty's levels). */
  key?: string;
  /** What Play posts when the bot id alone does not name the level. */
  play?: BotPlayTarget;
};
type DirectoryOpponent = {
  key: string;
  name: string | undefined;
  members: DirectoryMember[];
  community: boolean;
  /** Plays by engine id with no botId (Three Kingdoms Banqi). */
  engineOnly?: boolean;
  /** The member the card opens on, when it is not the first. */
  defaultLevel?: number;
};

// Misty's ladders open on Level 4, as the homepage's rows do.
const MISTY_LADDER_DEFAULT_LEVEL = 4;

/** Misty's level ladders, which /api/bots lists as one profile per game: one
 *  card with a level picker each, built from the homepage's rungs
 *  (landingBotLadder) so Play posts exactly what the homepage posts.
 *  - Banqi and Flip Jungle play Misty's bot id with the level's engine id, and
 *    replace her plain card. A roster the server sent is the truth for which
 *    levels exist; without one, Levels 1-7 (Level 8 needs a net, so it waits
 *    for the roster to name it). Shown only where her profile offers the game.
 *  - Three Kingdoms Banqi plays by engine id and has no /api/bots profile,
 *    offered under the same door as its play (threeKingdomsBanqiOffered). An
 *    explicit live roster is the truth, even empty; without one, a public build
 *    seeds Levels 1-7 (no net), as the homepage does.
 *  FFQ Banqi is admin-only and never listed here. */
export function engineLadderOpponents(
  bots: readonly BotProfile[],
  rosters: EngineRosters,
): Map<string, DirectoryOpponent[]> {
  const opponents = new Map<string, DirectoryOpponent[]>();
  const misty = bots.find((bot) => bot.id === 'misty');
  for (const [gameSpecId, roster] of [
    [BANQI_SPEC_ID, rosters.banqi],
    [JUNGLE_FLIP_SPEC_ID, rosters.jungleFlip],
  ] as const) {
    if (!misty || !offersGame(misty, gameSpecId)) continue;
    const offered = new Set(roster?.map((engine) => engine.id) ?? []);
    const rungs = landingBotLadder(gameSpecId, undefined, offered).filter(
      (rung) => roster === undefined || offered.has(rung.engineId ?? ''),
    );
    const ladder = mistyLadder('misty', rungs, () => misty);
    if (ladder) opponents.set(gameSpecId, [ladder]);
  }

  if (threeKingdomsBanqiOffered()) {
    const engineIds = new Set(
      rosters.threeKingdomsBanqi?.map((engine) => engine.id) ??
        (threeKingdomsBanqiEnabled()
          ? Array.from({ length: 7 }, (_, i) => `misty-three-kingdoms-banqi-level-${i + 1}`)
          : []),
    );
    const rungs = landingBotLadder(THREE_KINGDOMS_BANQI_SPEC_ID, undefined, engineIds);
    const tkRecord = misty?.recordsByGameSpecId?.[THREE_KINGDOMS_BANQI_SPEC_ID];
    const ladder = mistyLadder(
      'misty-three-kingdoms-banqi',
      rungs,
      (engineId): BotProfile => ({
        ...(misty ?? MISTY_FALLBACK),
        activeEngineId: engineId,
        defaultGameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
        supportedGameSpecIds: [THREE_KINGDOMS_BANQI_SPEC_ID],
        playOptions: [{ gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID, engineId, playable: true }],
        rating: null,
        ratings: [],
        record: tkRecord ?? EMPTY_RECORD,
        gamesTotal: tkRecord?.games ?? 0,
        recordsByGameSpecId: tkRecord ? { [THREE_KINGDOMS_BANQI_SPEC_ID]: tkRecord } : {},
      }),
      { engineOnly: true },
    );
    if (ladder) opponents.set(THREE_KINGDOMS_BANQI_SPEC_ID, [ladder]);
  }
  return opponents;
}

function mistyLadder(
  key: string,
  rungs: readonly LandingBotRung[],
  botFor: (engineId: string) => BotProfile,
  opts: { engineOnly?: boolean } = {},
): DirectoryOpponent | null {
  if (rungs.length === 0) return null;
  const members = rungs.map((rung): DirectoryMember => {
    const engineId = rung.engineId ?? '';
    const play: BotPlayTarget = rung.botId ? { botId: rung.botId, engineId } : { engineId };
    return {
      bot: botFor(engineId),
      level: rungs.length > 1 ? rung.level : null,
      key: engineId,
      play,
    };
  });
  return {
    key,
    name: 'Misty',
    members,
    community: false,
    ...(opts.engineOnly ? { engineOnly: true } : {}),
    defaultLevel: MISTY_LADDER_DEFAULT_LEVEL,
  };
}

// Misty as the card names her when /api/bots did not list her profile.
const MISTY_FALLBACK: BotProfile = {
  id: 'misty',
  displayName: 'Misty',
  bio: '',
  ownerType: 'system',
  ownerUserId: null,
  activeEngineId: '',
  defaultGameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  supportedGameSpecIds: [],
  play: {
    mode: 'pve',
    gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
    engineId: '',
    timeControl: { initialMs: 0, incrementMs: 0 },
    preferredColor: 'random',
  },
  gamesTotal: 0,
  record: { games: 0, wins: 0, losses: 0, draws: 0 },
  rating: null,
};

const EMPTY_RECORD: BotRecord = { games: 0, wins: 0, losses: 0, draws: 0 };

/** Every game some listed bot offers, in the site's shelf order. */
export function directoryGames(
  bots: readonly BotProfile[],
  extraGames: Iterable<string> = [],
): string[] {
  const games = new Set<string>(extraGames);
  for (const bot of bots) for (const option of playOptionsFor(bot)) games.add(option.gameSpecId);
  return [...games].sort(
    (a, b) =>
      canonicalVariantOrderIndex(a as GameSpecId) - canonicalVariantOrderIndex(b as GameSpecId) ||
      a.localeCompare(b),
  );
}

/** ?game= when it names a listed game; otherwise xiangqi, or the first listed. */
export function readDirectoryGame(
  games: readonly string[],
  search = window.location.search,
): string {
  const raw = new URLSearchParams(search).get('game');
  if (raw && games.includes(raw)) return raw;
  return games.includes(DEFAULT_DIRECTORY_GAME) ? DEFAULT_DIRECTORY_GAME : (games[0] ?? '');
}

function offersGame(bot: BotProfile, gameSpecId: string): boolean {
  return playOptionsFor(bot).some((option) => option.gameSpecId === gameSpecId);
}

/** The opponents that play one game, in map order (weakest first), then any
 *  first-party bot the map does not know, then community bots. */
export function directoryOpponents(
  bots: readonly BotProfile[],
  gameSpecId: string,
): DirectoryOpponent[] {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const opponents: DirectoryOpponent[] = [];
  for (const opponent of BOT_OPPONENTS) {
    const members: DirectoryMember[] = [];
    for (const member of opponent.members) {
      const bot = byId.get(member.botId);
      if (bot && offersGame(bot, gameSpecId)) members.push({ bot, level: member.level });
    }
    if (members.length === 0) continue;
    // A ladder with one member here (Pikafish in xiangqi) is a plain card.
    if (members.length === 1) members[0] = { bot: members[0]!.bot, level: null };
    opponents.push({ key: opponent.id, name: opponent.name, members, community: false });
  }
  const unmapped = bots.filter(
    (bot) => !botOpponentForBotId(bot.id) && offersGame(bot, gameSpecId),
  );
  for (const bot of unmapped) {
    opponents.push({
      key: bot.id,
      name: undefined,
      members: [{ bot, level: null }],
      community: bot.ownerType !== 'system',
    });
  }
  return opponents;
}

// The level a newcomer is given, on the opponent that carries it.
function startLevelFor(gameSpecId: string, opponentKey: string): number | null {
  if (gameSpecId === 'xiangqi' && opponentKey === 'fairy-stockfish')
    return XIANGQI_FIRST_GAME_LEVEL;
  if (gameSpecId === 'jieqi' && opponentKey === 'pikafish') return JIEQI_FIRST_GAME_LEVEL;
  return null;
}

/** The bot record cut to one game: only that game's play option, rating and record. */
export function gameScopedProfile(bot: BotProfile, gameSpecId: string): BotProfile {
  const ratings = botRatings(bot).filter((rating) => rating.gameSpecId === gameSpecId);
  const record =
    bot.recordsByGameSpecId?.[gameSpecId] ??
    (supportedGameSpecIds(bot).length <= 1 ? bot.record : EMPTY_RECORD);
  return {
    ...bot,
    defaultGameSpecId: gameSpecId,
    supportedGameSpecIds: [gameSpecId],
    playOptions: playOptionsFor(bot).filter((option) => option.gameSpecId === gameSpecId),
    ratings,
    rating: ratings[0] ?? null,
    record,
    gamesTotal: record.games,
    recordsByGameSpecId: { [gameSpecId]: record },
  };
}

function buildOpponentCard(
  opponent: DirectoryOpponent,
  gameSpecId: string,
  strongest: boolean,
): HTMLElement {
  const startLevel = startLevelFor(gameSpecId, opponent.key);
  const openLevel = startLevel ?? opponent.defaultLevel ?? null;
  // A card shows one game, so Misty takes its name ("Misty Banqi"); the picker
  // carries the level. Every other opponent keeps its own name.
  const name =
    opponent.name === undefined
      ? undefined
      : botNameForGame(opponent.members[0]?.bot.id, opponent.name, gameSpecId);
  const levelled = opponent.members.length > 1;
  const memberKey = (member: DirectoryMember): string => member.key ?? member.bot.id;
  let selected =
    opponent.members.find((member) => member.level !== null && member.level === openLevel) ??
    opponent.members[0]!;

  const picker = levelled ? document.createElement('select') : null;
  if (picker) {
    picker.className = 'site-select bot-level-select';
    picker.setAttribute('aria-label', t('bots.levelPicker', { name: name ?? '' }));
    // Members come weakest first; the picker lists the strongest level first,
    // like the cards (decided 2026-11-12). The level it opens on is unchanged.
    for (const member of [...opponent.members].reverse()) {
      const option = document.createElement('option');
      option.value = memberKey(member);
      option.textContent = t('bots.levelName', { level: member.level ?? 0 });
      picker.append(option);
    }
    picker.value = memberKey(selected);
  }

  const build = (): HTMLElement => {
    const bot = selected.bot;
    const card = buildBotSummaryCard(gameScopedProfile(bot, gameSpecId), {
      ratingGameSpecId: gameSpecId,
      primaryPlayGameSpecId: gameSpecId,
      ...(name ? { name } : {}),
      ...(opponent.community
        ? {}
        : {
            subtitle: t(isHostedOpponent(opponent.key, bot.id) ? 'bots.hosted' : 'bots.firstParty'),
          }),
      ...(selected.play ? { playTarget: selected.play } : {}),
      // A champion card already carries the title; "Strongest" would repeat it.
      badge:
        startLevel !== null && selected.level === startLevel
          ? t('bots.startHere')
          : strongest && !holdsChampionTitle(bot.id, gameSpecId)
            ? t('bots.strongest')
            : undefined,
      bio: opponent.community
        ? undefined
        : opponent.engineOnly
          ? engineOnlyBio(gameSpecId, selected.level)
          : bot.id === 'misty'
            ? t('bots.mistyGameBio', { variant: variantDisplayLabel(gameSpecId) })
            : (systemBotBio(bot) ?? null),
    });
    card.dataset.opponentId = opponent.key;
    layoutDirectoryCard(card, bot, gameSpecId, picker, opponent.engineOnly === true);
    return card;
  };

  let card = build();
  picker?.addEventListener('change', () => {
    const next = opponent.members.find((member) => memberKey(member) === picker.value);
    if (!next) return;
    selected = next;
    const nextCard = build();
    card.replaceWith(nextCard);
    card = nextCard;
    picker.focus();
  });
  return card;
}

function engineOnlyBio(gameSpecId: string, level: number | null): string | null {
  if (gameSpecId !== THREE_KINGDOMS_BANQI_SPEC_ID) return null;
  return level === null
    ? t('bots.mistyThreeKingdomsBio')
    : t('bots.mistyThreeKingdomsLevelBio', { level });
}

// The directory card: the shared summary card, then (from the repo's own
// records only) the champion title and the engine credits under the bio, and a
// foot holding the rating, games and record, and the play row: a ladder's level
// select on the left, Play on the right, the same place on every card.
function layoutDirectoryCard(
  card: HTMLElement,
  bot: BotProfile,
  gameSpecId: string,
  picker: HTMLSelectElement | null,
  engineOnly: boolean,
): void {
  const header = card.querySelector('.profile-summary-card-header');
  const bio = card.querySelector('.profile-summary-card-bio');
  const champion = championTitleLink(bot.id, gameSpecId);
  if (champion) {
    champion.classList.add('bot-card-champion');
    header?.after(champion);
  }
  const credits = engineOnly ? [] : botCredits(bot.id);
  if (credits.length > 0) {
    const list = buildBotCredits(credits);
    list.className = 'bot-card-credits';
    (bio ?? champion ?? header)?.after(list);
  }

  const foot = document.createElement('div');
  foot.className = 'bot-card-foot';
  const rating = card.querySelector('.profile-summary-card-rating-line');
  const footer = card.querySelector('.profile-summary-card-footer');
  let actions = card.querySelector<HTMLElement>('.profile-summary-card-bot-actions');
  if (!actions && picker) {
    actions = document.createElement('div');
    actions.className = 'profile-summary-card-actions profile-summary-card-bot-actions';
  }
  // TK games are kept on engine ids, not Misty's profile: with no TK record,
  // say nothing rather than "0 games".
  if (engineOnly && !bot.recordsByGameSpecId?.[gameSpecId]) footer?.remove();
  else if (footer) foot.append(footer);
  if (rating) foot.prepend(rating);
  if (actions) {
    if (picker) actions.prepend(picker);
    foot.append(actions);
  }
  card.append(foot);
}

/** The champion title a bot holds in this game, linked to /champions; null
 *  when it holds none (champions-page.ts is the record). */
function holdsChampionTitle(botId: string, gameSpecId: string): boolean {
  return CHAMPIONS.some(
    (title) => title.botHref === `/bot/${botId}` && title.gameId === gameSpecId,
  );
}

// Engines other people wrote, run here with credit: the subtitle says hosted,
// never first-party. Mistboard's own bots (Misty, General Blunder) stay first-party.
const HOSTED_OPPONENT_KEYS: ReadonlySet<string> = new Set(['fairy-stockfish', 'pikafish', 'rapfi']);
function isHostedOpponent(opponentKey: string, botId: string): boolean {
  return HOSTED_OPPONENT_KEYS.has(opponentKey) || botCredits(botId).length > 0;
}

function championTitleLink(botId: string, gameSpecId: string): HTMLAnchorElement | null {
  if (!holdsChampionTitle(botId, gameSpecId)) return null;
  const champion = document.createElement('a');
  champion.className = 'bot-champion-title';
  champion.href = '/champions';
  const title = `${variantDisplayLabel(gameSpecId)} ${t('champions.championBadge')}`;
  champion.setAttribute('aria-label', title);
  champion.append(buildUiIcon('title-champion'), title);
  return champion;
}

function buildDirectoryGame(
  bots: readonly BotProfile[],
  gameSpecId: string,
  engineOpponents: ReadonlyMap<string, DirectoryOpponent[]>,
): HTMLElement[] {
  // An engine ladder takes the place of the plain card with its key (Misty on
  // Banqi and Flip Jungle); the rest (TK's Misty) join after the mapped ones.
  const ladders = engineOpponents.get(gameSpecId) ?? [];
  const listed = directoryOpponents(bots, gameSpecId).map(
    (opponent) => ladders.find((ladder) => ladder.key === opponent.key) ?? opponent,
  );
  const opponents = [...listed, ...ladders.filter((ladder) => !listed.includes(ladder))];
  const firstParty = opponents.filter((opponent) => !opponent.community);
  const community = opponents.filter((opponent) => opponent.community);
  // The map lists each game's opponents weakest first; the page shows them
  // strongest first (decided 2026-11-12), so with a choice of first-party
  // opponents the first card is the strongest you can play. Opponents the map
  // does not rank (TK's Misty) follow them.
  const ranked = firstParty.filter((opponent) => botOpponentById(opponent.key)).reverse();
  const unranked = firstParty.filter((opponent) => !botOpponentById(opponent.key));
  const strongestKey = ranked.length > 1 ? ranked[0]?.key : undefined;
  const intro =
    gameSpecId === 'xiangqi'
      ? t('bots.ladderIntro')
      : gameSpecId === 'jieqi'
        ? t('bots.jieqiLadderIntro')
        : '';
  const groups: BotRosterGroup[] = [
    {
      title: gameSpecLabel(gameSpecId),
      intro,
      rows: [...ranked, ...unranked].map((opponent) =>
        buildOpponentCard(opponent, gameSpecId, opponent.key === strongestKey),
      ),
    },
    {
      title: t('bots.communityTitle'),
      intro: t('bots.communityIntro'),
      rows: community.map((opponent) => buildOpponentCard(opponent, gameSpecId, false)),
    },
  ];
  return groups.filter((group) => group.rows.length > 0).map(buildRosterSection);
}

function buildGameRail(
  rail: HTMLElement,
  games: readonly string[],
  active: string,
  select: (gameSpecId: string) => void,
): void {
  rail.replaceChildren(
    ...games.map((gameSpecId) => {
      const link = document.createElement('a');
      link.className = 'current-games-rail-link';
      link.dataset.gameSpecId = gameSpecId;
      const url = new URL(window.location.href);
      if (gameSpecId === DEFAULT_DIRECTORY_GAME) url.searchParams.delete('game');
      else url.searchParams.set('game', gameSpecId);
      link.href = `${url.pathname}${url.search}`;
      const text = document.createElement('span');
      text.className = 'current-games-rail-text';
      const name = document.createElement('span');
      name.className = 'current-games-rail-name';
      name.textContent = gameSpecLabel(gameSpecId);
      text.append(name);
      const thumb =
        variantThumb(gameSpecId, 112, 'current-games-rail-thumb') ??
        Object.assign(document.createElement('span'), { className: 'current-games-rail-thumb' });
      link.append(text, thumb);
      if (gameSpecId === active) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      link.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (gameSpecId === active) return;
        window.history.pushState(null, '', link.href);
        select(gameSpecId);
      });
      return link;
    }),
  );
}

function mountDirectory(
  rail: HTMLElement,
  body: HTMLElement,
  bots: readonly BotProfile[],
  engineOpponents: ReadonlyMap<string, DirectoryOpponent[]>,
): void {
  const games = directoryGames(bots, engineOpponents.keys());
  if (games.length === 0) {
    body.replaceChildren(statusLine(t('bots.none')));
    return;
  }
  const render = (): void => {
    const game = readDirectoryGame(games);
    buildGameRail(rail, games, game, render);
    body.replaceChildren(...buildDirectoryGame(bots, game, engineOpponents));
  };
  window.addEventListener('popstate', () => {
    if (body.isConnected) render();
  });
  render();
}

// Only system-owned prose gets a catalog overlay; community biographies stay
// verbatim. Unknown system bots keep their stored bio as a fallback.
function systemBotBio(bot: BotProfile): string | undefined {
  if (bot.ownerType !== 'system') return undefined;
  const placed = botOpponentForBotId(bot.id);
  const level = placed?.member.level;
  if (placed?.opponent.id === 'fairy-stockfish' && level) {
    return t('bots.fairyStockfishLevelBio', { level });
  }
  if (placed?.opponent.id === 'pikafish' && level && bot.id !== 'pikafish') {
    return t('bots.pikafishLevelBio', { level });
  }
  if (bot.id === XIANGQI_WORST_BOT_ID) return t('bots.generalBlunderBio');
  if (bot.id === 'pikafish') return t('bots.pikafishBio');
  if (bot.id === 'ab-jchess') return t('bots.abJchessBio');
  if (bot.id === 'jqe') return t('bots.jqeBio');
  if (bot.id === JUNGLE_TOP_BOT_ID) return t('bots.katagoBio');
  if (bot.id === 'misty') return t('bots.mistyBio');
  return undefined;
}

// Linked credits for a bot built on other people's engines and nets, shown on its
// page under the bio. hzyhhzy agreed to KataGo running here credited
// (hzyhhzy/KataGomo#12); the net is Kouza's, shipped in Dandelion 4.
type BotCredit = { label: string; href: string };

export function botCredits(botId: string): BotCredit[] {
  if (/^rapfi-level-[1-8]$/.test(botId)) {
    return [
      { label: t('thanks.rapfiAuthors'), href: RAPFI_REPO_URL },
      { label: t('thanks.rapfiBuildAuthor'), href: RAPFI_BUILD_URL },
    ];
  }
  if (botId === 'jqe') {
    return [{ label: t('bots.jqeCredit'), href: 'https://github.com/devinokeefe/jieqi' }];
  }
  if (botId === 'ab-jchess') {
    return [{ label: t('bots.abJchessCredit'), href: 'https://github.com/lxsgx23/AB-JChess' }];
  }
  if (botId !== JUNGLE_TOP_BOT_ID) return [];
  return [
    {
      label: t('bots.katagoCreditKatagomo'),
      href: 'https://github.com/hzyhhzy/KataGomo/tree/AnimalChess2025',
    },
    { label: t('bots.katagoCreditKatago'), href: 'https://github.com/lightvector/KataGo' },
    { label: t('bots.katagoCreditNet'), href: 'https://github.com/lxsgx23/Dandelion-Chess' },
  ];
}

function buildBotCredits(credits: readonly BotCredit[]): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'profile-side-links bot-profile-credits';
  for (const credit of credits) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = credit.href;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = credit.label;
    item.append(link);
    list.append(item);
  }
  return list;
}

type BotRosterGroup = {
  title: string;
  intro: string;
  rows: HTMLElement[];
};

function buildRosterSection(group: BotRosterGroup): HTMLElement {
  const section = document.createElement('section');
  section.className = 'bot-roster-section';

  const header = document.createElement('div');
  header.className = 'bot-roster-header';
  const headerCopy = document.createElement('div');
  headerCopy.className = 'bot-roster-header-copy';

  const title = document.createElement('h2');
  title.textContent = group.title;

  const intro = document.createElement('p');
  intro.className = 'bot-roster-intro';
  intro.textContent = group.intro;
  headerCopy.append(title, intro);

  const count = document.createElement('span');
  count.className = 'bot-roster-count';
  count.textContent = t(group.rows.length === 1 ? 'bots.countOne' : 'bots.countMany', {
    count: group.rows.length,
  });

  header.append(headerCopy, count);

  const list = document.createElement('div');
  list.className = 'bot-roster';
  list.append(...group.rows);

  section.append(header, list);
  return section;
}

// ── Profile ─────────────────────────────────────────────────────────────────

function buildBotOverview(bot: BotProfile, gameSpecId: string): HTMLElement {
  const option =
    playOptionsFor(bot).find((candidate) => candidate.gameSpecId === gameSpecId) ??
    playOptionsFor(bot)[0];
  const overview = buildProfileOverviewShell({
    identity: buildBotIdentity(bot, gameSpecId),
    actions: option ? buildBotPlayAction(bot, option) : null,
    primary: buildBotRatingSpotlight(bot, gameSpecId),
    side: buildBotSideInfo(bot, gameSpecId),
  });
  const about = buildBotAbout(bot);
  if (about) overview.querySelector('.profile-overview-top')?.after(about);
  return overview;
}

// The bio and credits, at the page's width under the header. In the side column
// they had a third of the card, and a long credit ran past its edge.
function buildBotAbout(bot: BotProfile): HTMLElement | null {
  // The roster card's localized bio, so the page and the card say the same thing
  // in every locale; other bots keep their stored bio.
  const bioText = systemBotBio(bot) ?? bot.bio;
  const credits = botCredits(bot.id);
  if (bioText.trim().length === 0 && credits.length === 0) return null;
  const about = document.createElement('div');
  about.className = 'bot-profile-about';
  if (bioText.trim().length > 0) {
    const bio = document.createElement('p');
    bio.className = 'profile-side-line profile-side-bio';
    bio.textContent = bioText;
    about.append(bio);
  }
  if (credits.length > 0) about.append(buildBotCredits(credits));
  return about;
}

function buildBotIdentity(bot: BotProfile, gameSpecId: string): HTMLElement {
  const identity = document.createElement('div');
  identity.className = 'profile-identity';

  const heading = document.createElement('h1');
  heading.className = 'profile-identity-handle';
  heading.textContent = bot.displayName;
  identity.append(heading);

  const meta = document.createElement('p');
  meta.className = 'profile-header-meta profile-header-badges';
  const badge = document.createElement('span');
  badge.className = 'profile-role-badge profile-role-bot';
  badge.textContent = t('watch.botBadge');
  const owner = document.createElement('span');
  owner.className = 'profile-role-badge profile-role-owner';
  owner.textContent = t(
    bot.ownerType === 'system' ? 'bots.firstPartyBadge' : 'bots.communityBadge',
  );
  meta.append(badge, owner);
  const champion = championTitleLink(bot.id, gameSpecId);
  if (champion) heading.after(champion);
  identity.append(meta);

  const counts = document.createElement('div');
  counts.className = 'profile-counts';
  // Games and Record are scoped to the SELECTED variant: they sit directly under
  // a variant selector, so lifetime totals there read as a broken filter (they
  // stayed at 100 / 82-18-0 across both of pikafish's variants). Variants stays
  // a whole-bot figure, which is what it is about.
  //
  // "here" is load-bearing, not filler. These count games played ON THE SITE,
  // while the rating beside them reads "Elo from 36 engine games" -- a different
  // population entirely (a clockless engine-vs-engine ladder anchored to
  // random-legal = 1500, see ratingSampleLabel). Naming only one of the two
  // populations is what makes the pair read as a contradiction: pikafish shows
  // 2,334 from 36 engine games next to 12 games and a 12-0-0 record, and a bare
  // "Games" invites the reader to reconcile numbers that were never the same
  // measurement.
  const record = botRecordFor(bot, gameSpecId);
  counts.append(
    buildBotCount(new Intl.NumberFormat().format(record.games), t('bots.gamesHere')),
    buildBotCount(recordLabel(record), t('bots.recordHere')),
    buildBotCount(String(playOptionsFor(bot).length), t('bots.variants')),
  );
  identity.append(counts);
  return identity;
}

function buildBotCount(value: string, label: string): HTMLElement {
  const count = document.createElement('span');
  count.className = 'profile-count';
  const valueEl = document.createElement('span');
  valueEl.className = 'profile-count-value';
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'profile-count-label';
  labelEl.textContent = label;
  count.append(valueEl, labelEl);
  return count;
}

function buildBotPlayAction(bot: BotProfile, option: BotPlayOption): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'profile-relation-actions bot-profile-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = option.playable ? 'landing-setup-start' : 'landing-setup-back';
  button.disabled = !option.playable;
  button.textContent = option.playable
    ? t('bots.playVariant', { variant: gameSpecLabel(option.gameSpecId) })
    : t('play.unavailable');
  if (option.playable) {
    bindBotPlayControl(
      button,
      () => ({ botId: bot.id, gameSpecId: option.gameSpecId, preferredColor: 'random' }),
      { pendingLabel: t('bots.starting'), errorLabel: t('setup.tryAgain') },
    );
  }
  actions.append(button);
  return actions;
}

function buildBotRatingSpotlight(bot: BotProfile, gameSpecId: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-rating-spotlight bot-rating-spotlight';
  const rating = botRatings(bot).find((candidate) => candidate.gameSpecId === gameSpecId);
  const option = playOptionsFor(bot).find((candidate) => candidate.gameSpecId === gameSpecId);

  const head = document.createElement('header');
  head.className = 'profile-chart-head';
  const headline = document.createElement('div');
  headline.className = 'profile-chart-headline';
  const name = document.createElement('span');
  name.className = 'profile-chart-variant';
  name.textContent = gameSpecLabel(gameSpecId);
  const value = document.createElement('span');
  value.className = 'profile-chart-value';
  const detail = document.createElement('span');
  detail.className = 'profile-chart-detail';
  if (rating) {
    value.textContent = new Intl.NumberFormat().format(rating.rating);
    if (rating.provisional) {
      const q = document.createElement('span');
      q.className = 'profile-rating-q';
      q.textContent = '?';
      value.append(q);
    }
    detail.textContent = ratingSampleLabel(rating, { style: 'spotlight' });
  } else {
    value.textContent = '—';
    value.classList.add('profile-chart-value-empty');
    detail.textContent = t('bots.noPublishedRating');
  }
  headline.append(name, value, detail);
  head.append(headline);

  const play = document.createElement('div');
  play.className = 'bot-rating-spotlight-play';
  const marker = variantThumb(gameSpecId, 64, 'bot-rating-spotlight-marker');
  if (marker) play.append(marker);
  const playCopy = document.createElement('div');
  playCopy.className = 'bot-rating-spotlight-copy';
  const playTitle = document.createElement('span');
  playTitle.className = 'bot-rating-spotlight-title';
  playTitle.textContent = option?.playable
    ? t('bots.playAgainst', { name: bot.displayName })
    : t('bots.offline');
  const clock = document.createElement('span');
  clock.className = 'bot-rating-spotlight-clock';
  clock.textContent = option?.playable
    ? t('bots.clockRandomSide', { control: timeControlLabel(bot.play.timeControl) })
    : t('bots.notAvailable');
  playCopy.append(playTitle, clock);
  play.append(playCopy);
  section.append(head, play);
  return section;
}

function buildBotSideInfo(bot: BotProfile, gameSpecId: string): HTMLElement {
  const side = document.createElement('aside');
  side.className = 'profile-overview-side';

  // The selected variant's engine build: Misty runs a different one per variant.
  const version = playOptionsFor(bot).find(
    (candidate) => candidate.gameSpecId === gameSpecId,
  )?.version;
  if (version) side.append(buildBotSideStat(t('bots.version'), version));

  const rating = botRatings(bot).find((candidate) => candidate.gameSpecId === gameSpecId);
  if (rating) side.append(buildBotSideStat(t('bots.publishedRating'), ratingLabel(rating)));
  // Sits directly under "Published rating", which is an engine-ladder number.
  // Same disambiguation as the header counts: say which population this counts.
  side.append(buildBotSideStat(t('bots.recordHere'), recordLabel(botRecordFor(bot, gameSpecId))));
  // No engine id here: it is an internal name (jqe-jieqi, pikafish-jieqi-level-8), and
  // the credits above already say whose engine it is.
  return side;
}

function buildBotSideStat(label: string, value: string): HTMLElement {
  const stat = document.createElement('div');
  stat.className = 'profile-side-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'profile-side-stat-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'profile-side-stat-value bot-profile-provenance';
  valueEl.textContent = value;
  stat.append(labelEl, valueEl);
  return stat;
}

function buildBotRatingsRail(
  bot: BotProfile,
  opts: { selectedGameSpecId: string; onSelect: (gameSpecId: string) => void },
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-ratings bot-profile-ratings';

  const heading = document.createElement('h2');
  heading.className = 'profile-ratings-heading';
  heading.textContent = t('bots.ratings');
  section.append(heading);

  const options = playOptionsFor(bot);
  if (options.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'profile-ratings-empty';
    empty.textContent = t('bots.noPublishedRating');
    section.append(empty);
    return section;
  }

  const rail = document.createElement('div');
  rail.className = 'profile-ratings-rail';
  for (const option of options) {
    const rating = botRatings(bot).find((candidate) => candidate.gameSpecId === option.gameSpecId);
    rail.append(buildBotRatingRow(option, rating, opts));
  }
  section.append(rail);
  return section;
}

function buildBotRatingRow(
  option: BotPlayOption,
  rating: BotRatingSnapshot | undefined,
  opts: { selectedGameSpecId: string; onSelect: (gameSpecId: string) => void },
): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'profile-rating-row bot-rating-row';
  row.dataset.gameSpecId = option.gameSpecId;
  const selected = option.gameSpecId === opts.selectedGameSpecId;
  row.classList.toggle('profile-rating-row-selected', selected);
  row.setAttribute('aria-pressed', String(selected));
  row.addEventListener('click', () => opts.onSelect(option.gameSpecId));

  const thumb = variantThumb(option.gameSpecId, 32, 'profile-rating-thumb');
  if (thumb) row.append(thumb);

  const meta = document.createElement('div');
  meta.className = 'profile-rating-meta';

  const name = document.createElement('span');
  name.className = 'profile-rating-name';
  name.textContent = gameSpecLabel(option.gameSpecId);

  const figures = document.createElement('span');
  figures.className = 'profile-rating-figures';

  const value = document.createElement('span');
  value.className = 'profile-rating-value';
  value.textContent = rating ? new Intl.NumberFormat().format(rating.rating) : '—';
  if (rating?.provisional) {
    const q = document.createElement('span');
    q.className = 'profile-rating-q';
    q.textContent = '?';
    value.append(q);
  }

  const games = document.createElement('span');
  games.className = 'profile-rating-games';
  games.textContent = rating
    ? ratingSampleLabel(rating, { style: 'rail' })
    : option.playable
      ? t('profile.unrated')
      : t('play.unavailable');

  figures.append(value, games);
  meta.append(name, figures);
  row.append(meta);
  const chevron = document.createElement('span');
  chevron.className = 'profile-rating-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  row.append(chevron);
  return row;
}

function syncSelectedBotRating(section: HTMLElement, gameSpecId: string): void {
  for (const row of section.querySelectorAll<HTMLElement>('.profile-rating-row')) {
    const selected = row.dataset.gameSpecId === gameSpecId;
    row.classList.toggle('profile-rating-row-selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  }
}

function buildRecentGames(bot: BotProfile, gameSpecId: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-games bot-profile-games';

  const games = botGamesFor(bot, gameSpecId);
  if (games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'landing-games-empty';
    // Names the variant: on a page with a variant selector, a bare "no games"
    // reads as "this bot has never played", which is a different claim.
    empty.textContent = t('bots.noCompletedGames', { variant: variantDisplayLabel(gameSpecId) });
    section.append(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'profile-game-list profile-activity';
  for (const game of games) list.append(buildProfileGameRow(game));
  section.append(list);
  // A full initial page may have older games. Counts can change as games finish.
  if (games.length >= BOT_PROFILE_GAMES_PAGE) {
    section.append(
      buildBotGamesMore(bot.id, gameSpecId, games[games.length - 1], (page) => {
        for (const game of page) list.append(buildProfileGameRow(game));
      }),
    );
  }
  return section;
}

// Continue strictly before the last row. New finishes cannot shift the next
// page, and only a short response means the history is exhausted.
function buildBotGamesMore(
  botId: string,
  gameSpecId: string,
  lastGame: FeaturedGame,
  appendGames: (games: FeaturedGame[]) => void,
): HTMLElement {
  let before = JSON.stringify([lastGame.endedAt, lastGame.roomId]);
  const moreWrap = document.createElement('div');
  moreWrap.className = 'profile-games-more';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'profile-games-more-btn';
  button.textContent = t('profile.loadMore');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = t('profile.loadingMore');
    const page = await fetchBotGamesPage(botId, gameSpecId, before).catch((err) => {
      console.warn(err);
      return null;
    });
    if (!page) {
      button.disabled = false;
      button.textContent = t('profile.loadMore');
      return;
    }
    appendGames(page);
    const last = page[page.length - 1];
    if (last) before = JSON.stringify([last.endedAt, last.roomId]);
    if (page.length < BOT_GAMES_PAGE) {
      moreWrap.remove();
    } else {
      button.disabled = false;
      button.textContent = t('profile.loadMore');
    }
  });
  moreWrap.append(button);
  return moreWrap;
}

async function fetchBotGamesPage(
  botId: string,
  gameSpecId: string,
  before: string,
): Promise<FeaturedGame[]> {
  const params = new URLSearchParams({
    variant: gameSpecId,
    before,
    limit: String(BOT_GAMES_PAGE),
  });
  const resp = await fetch(`/api/bots/${encodeURIComponent(botId)}/games?${params}`, {
    headers: { accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`bot_games_failed_${resp.status}`);
  const data = (await resp.json()) as { games: FeaturedGame[] };
  return data.games;
}

// The bot's record in ONE variant. Falls back to the lifetime record only when
// the payload predates recordsByGameSpecId; a supported variant the bot has
// never played is present in the map as a real 0-0-0, so the fallback does not
// fire for it and the page never reports lifetime numbers under a variant label.
function botRecordFor(bot: BotProfile, gameSpecId: string): BotRecord {
  return bot.recordsByGameSpecId?.[gameSpecId] ?? bot.record;
}

// The bot's recent games in ONE variant. Same fallback rule; note the flat
// `bot.games` list is NOT filtered as a fallback, because its row cap is applied
// before any variant split -- filtering it would silently show an empty list for
// a variant that has games (see gamesByGameSpecId on the server).
function botGamesFor(bot: BotProfile, gameSpecId: string): FeaturedGame[] {
  return bot.gamesByGameSpecId?.[gameSpecId] ?? bot.games ?? [];
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function variantThumb(gameSpecId: string, size: number, className: string): HTMLElement | null {
  const miniId = variantMiniIdForRawVariant(gameSpecId);
  if (!miniId) return null;
  const thumb = document.createElement('span');
  thumb.className = className;
  thumb.setAttribute('aria-hidden', 'true');
  thumb.innerHTML = renderVariantMarker(miniId, { size });
  return thumb;
}

function statusLine(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'bots-status';
  p.textContent = text;
  return p;
}

function playOptionsFor(bot: BotProfile): BotPlayOption[] {
  const options =
    bot.playOptions && bot.playOptions.length > 0
      ? bot.playOptions
      : supportedGameSpecIds(bot).map((gameSpecId) => ({
          gameSpecId,
          engineId: bot.activeEngineId,
          playable: true,
        }));
  return options;
}

function supportedGameSpecIds(bot: BotProfile): string[] {
  return bot.supportedGameSpecIds.length > 0 ? bot.supportedGameSpecIds : [bot.defaultGameSpecId];
}

function botRatings(bot: BotProfile): BotRatingSnapshot[] {
  return bot.ratings && bot.ratings.length > 0 ? bot.ratings : bot.rating ? [bot.rating] : [];
}

function primaryRating(bot: BotProfile): BotRatingSnapshot | null {
  const ratings = botRatings(bot);
  return (
    ratings.find(
      (rating) => rating.gameSpecId === bot.defaultGameSpecId && rating.timeClass === 'blitz',
    ) ??
    bot.rating ??
    ratings[0] ??
    null
  );
}

// Delegates to the single catalog-name map in game-display. The local copy this
// replaced was missing xiangqi, jungle, jungle-flip, and dark-xiangqi, so those
// bot labels fell back to the English publicName in every locale.
function gameSpecLabel(gameSpecId: string): string {
  return variantDisplayLabel(gameSpecId);
}

function timeControlLabel(timeControl: BotProfile['play']['timeControl']): string {
  const initialMinutes = timeControl.initialMs / 60_000;
  const incrementSeconds = timeControl.incrementMs / 1_000;
  if (Number.isInteger(initialMinutes) && Number.isInteger(incrementSeconds)) {
    return `${initialMinutes}+${incrementSeconds}`;
  }
  return t('bots.timeControlSeconds', {
    initial: Math.round(timeControl.initialMs / 1_000),
    increment: Math.round(timeControl.incrementMs / 1_000),
  });
}

function recordLabel(record: BotRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`;
}

function ratingLabel(rating: BotRatingSnapshot): string {
  return `${new Intl.NumberFormat().format(rating.rating)}${rating.provisional ? '?' : ''}`;
}

function timeClassLabel(timeClass: BotRatingSnapshot['timeClass']): string {
  const keys = {
    bullet: 'live.timeClassBullet',
    blitz: 'live.timeClassBlitz',
    rapid: 'live.timeClassRapid',
  } as const;
  return t(keys[timeClass]);
}

/**
 * What a bot rating's sample actually is, in words.
 *
 * `rating.games` is the snapshot's sample size, NOT games played on the site --
 * two different populations that used to sit inches apart on the profile as
 * "36 rated games" beside a "12 Games" header, reading as though 36 of the
 * bot's games counted and 12 did not.
 *
 * For an `eve-anchor` snapshot (every published bot rating today) the sample is
 * an engine-vs-engine ladder, on a scale anchored to random-legal = 1500. It is
 * not the human rated pool: PvE is unrated by decision, so calling these "rated
 * games" on a page whose other numbers are casual PvE games is the wrong claim.
 * The time class is omitted for the same reason -- that ladder is run clockless
 * (sourceRef carries `time=untimed`) and 'blitz' is only the bucket the
 * snapshot was published into, so printing "Blitz" states something false.
 */
function ratingSampleLabel(
  rating: BotRatingSnapshot,
  opts: { style: 'rail' | 'spotlight' },
): string {
  const spotlight = opts.style === 'spotlight';
  if (rating.source === 'eve-anchor') {
    // The rail row is a narrow fixed-width cell beside the number, so it takes
    // the bare sample; "Elo from ..." overflowed it into an ellipsis. The
    // spotlight has the room to say what the number is.
    const sample = t(rating.games === 1 ? 'bots.engineGameOne' : 'bots.engineGameMany', {
      count: rating.games,
    });
    return spotlight ? t('bots.eloFromSample', { sample }) : sample;
  }
  const suffix = spotlight ? ` · ${timeClassLabel(rating.timeClass)}` : '';
  return `${t(rating.games === 1 ? 'profile.ratedGameOne' : 'profile.ratedGameMany', {
    count: rating.games,
  })}${suffix}`;
}
