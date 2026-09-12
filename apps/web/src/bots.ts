// Public bot directory (/bots) and bot profile (/bot/:id). The directory is a
// compact lichess-density roster (featured identities + the Fairy-Stockfish
// ladder); the profile page reuses the player-profile surface primitives
// (profile-shell, header shell, rating rail, game rows) so it renders as a
// sibling of /@handle. Play affordances create the game directly via
// bot-play.ts; there is no setup dialog.
import './account-profile.css';
import './bots.css';
import { bindBotPlayControl } from './bot-play.js';
import { buildCommunityLayout } from './community-rail.js';
import { type FeaturedGame, variantDisplayLabel } from './game-display.js';
import { buildBotSummaryCard } from './profile-summary-card.js';
import {
  buildProfileDashboard,
  buildProfileGameRow,
  buildProfileOverviewShell,
  buildProfileTabsShell,
} from './profile-ui.js';
import { buildNav, buildNotice } from './site-shell.js';
import { renderVariantMarker } from './variant-markers.js';
import { variantMiniIdForRawVariant } from './variants.js';

type BotPlayOption = {
  gameSpecId: string;
  engineId: string;
  playable: boolean;
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

const LADDER_BOT_ID_PREFIX = 'fairy-stockfish-level-';

export async function mountBots(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page', 'bots-route');

  const shell = document.createElement('main');
  shell.className = 'site-section community-shell bots-shell';

  const header = document.createElement('section');
  header.className = 'bots-directory-header';
  const headerCopy = document.createElement('div');
  headerCopy.className = 'bots-directory-header-copy';

  const eyebrow = document.createElement('span');
  eyebrow.className = 'account-eyebrow';
  eyebrow.textContent = 'Play against the computer';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = 'Choose your opponent';

  const sub = document.createElement('p');
  sub.className = 'bots-sub';
  sub.textContent =
    'Meet every engine, compare strength, or jump straight into a game. Every bot has a full public profile.';

  const meta = document.createElement('div');
  meta.className = 'bots-directory-meta';
  meta.append(
    buildDirectoryMeta('Public profiles'),
    buildDirectoryMeta('One-click play'),
    buildDirectoryMeta('Eight strength levels'),
  );
  headerCopy.append(eyebrow, heading, sub, meta);

  const markers = document.createElement('div');
  markers.className = 'bots-directory-markers';
  markers.setAttribute('aria-hidden', 'true');
  for (const [gameSpecId, size] of [
    ['dark-chess', 48],
    ['xiangqi', 64],
    ['banqi', 44],
  ] as const) {
    const marker = variantThumb(gameSpecId, size, 'bots-directory-marker');
    if (marker) markers.append(marker);
  }
  header.append(headerCopy, markers);

  const body = document.createElement('section');
  body.className = 'bots-directory';
  body.append(statusLine('Loading bots...'));

  const content = document.createElement('div');
  content.className = 'bots-main';
  content.append(header, body);

  shell.append(buildCommunityLayout('/bots', content));
  root.append(buildNav(), shell);

  let bots: BotProfile[];
  try {
    bots = await fetchBots();
  } catch {
    body.replaceChildren(buildNotice('Bots unavailable', 'The bot directory could not load.'));
    return;
  }

  if (bots.length === 0) {
    body.replaceChildren(statusLine('No bots available.'));
    return;
  }

  body.replaceChildren(...buildBotDirectorySections(bots));
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
      document.title = 'Bot not found · Mistboard';
      shell.append(buildNotice('Bot not found', 'This bot profile is not public.'));
      return;
    }
    shell.append(buildNotice('Bots unavailable', 'This bot profile could not load.'));
    return;
  }

  document.title = `${bot.displayName} · Bot · Mistboard`;

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
      label: 'Recent games',
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

function buildBotDirectorySections(bots: BotProfile[]): HTMLElement[] {
  const system = bots.filter((bot) => bot.ownerType === 'system');
  const ladder = system
    .filter((bot) => bot.id.startsWith(LADDER_BOT_ID_PREFIX))
    .sort((a, b) => ladderLevel(a) - ladderLevel(b));
  const featured = system.filter((bot) => !bot.id.startsWith(LADDER_BOT_ID_PREFIX));
  const community = bots.filter((bot) => bot.ownerType === 'user');

  const groups: BotRosterGroup[] = [
    {
      title: 'Featured opponents',
      intro: 'Distinct engines with their own styles and variant specialties.',
      rows: featured.map(buildBotSummaryCard),
    },
    {
      title: 'Fairy-Stockfish ladder',
      intro: 'Pick a level that feels competitive, then move up when you are ready.',
      rows: ladder.map(buildBotSummaryCard),
    },
    {
      title: 'Community bots',
      intro: 'Engines shared by the Mistboard community.',
      rows: community.map(buildBotSummaryCard),
    },
  ];
  return groups.filter((group) => group.rows.length > 0).map(buildRosterSection);
}

type BotRosterGroup = {
  title: string;
  intro: string;
  rows: HTMLElement[];
};

function ladderLevel(bot: BotProfile): number {
  const level = Number.parseInt(bot.id.slice(LADDER_BOT_ID_PREFIX.length), 10);
  return Number.isFinite(level) ? level : Number.MAX_SAFE_INTEGER;
}

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
  count.textContent = `${group.rows.length} ${group.rows.length === 1 ? 'bot' : 'bots'}`;

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
  return buildProfileOverviewShell({
    identity: buildBotIdentity(bot, gameSpecId),
    actions: option ? buildBotPlayAction(bot, option) : null,
    primary: buildBotRatingSpotlight(bot, gameSpecId),
    side: buildBotSideInfo(bot, gameSpecId),
  });
}

function buildBotIdentity(bot: BotProfile, gameSpecId: string): HTMLElement {
  const identity = document.createElement('div');
  identity.className = 'profile-identity';

  const heading = document.createElement('h1');
  heading.className = 'profile-identity-handle';
  heading.textContent = bot.displayName;
  identity.append(heading);

  const meta = document.createElement('p');
  meta.className = 'profile-header-meta';
  const badge = document.createElement('span');
  badge.className = 'profile-role-badge profile-role-bot';
  badge.textContent = 'BOT';
  const owner = document.createElement('span');
  owner.className = 'profile-role-badge profile-role-owner';
  owner.textContent = bot.ownerType === 'system' ? 'First-party' : 'Community';
  meta.append(badge, document.createTextNode(' · '), owner);
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
    buildBotCount(new Intl.NumberFormat().format(record.games), 'Games here'),
    buildBotCount(recordLabel(record), 'Record here'),
    buildBotCount(String(playOptionsFor(bot).length), 'Variants'),
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
  button.textContent = option.playable ? `Play ${gameSpecLabel(option.gameSpecId)}` : 'Unavailable';
  if (option.playable) {
    bindBotPlayControl(
      button,
      () => ({ botId: bot.id, gameSpecId: option.gameSpecId, preferredColor: 'random' }),
      { pendingLabel: 'Starting...', errorLabel: 'Try again' },
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
    detail.textContent = 'No published rating yet';
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
    ? `Play against ${bot.displayName}`
    : 'Currently offline';
  const clock = document.createElement('span');
  clock.className = 'bot-rating-spotlight-clock';
  clock.textContent = option?.playable
    ? `${timeControlLabel(bot.play.timeControl)} · random side`
    : 'Not available right now';
  playCopy.append(playTitle, clock);
  play.append(playCopy);
  section.append(head, play);
  return section;
}

function buildBotSideInfo(bot: BotProfile, gameSpecId: string): HTMLElement {
  const side = document.createElement('aside');
  side.className = 'profile-overview-side';

  if (bot.bio.trim().length > 0) {
    const bio = document.createElement('p');
    bio.className = 'profile-side-line profile-side-bio';
    bio.textContent = bot.bio;
    side.append(bio);
  }

  const rating = botRatings(bot).find((candidate) => candidate.gameSpecId === gameSpecId);
  if (rating) side.append(buildBotSideStat('Published rating', ratingLabel(rating)));
  // Sits directly under "Published rating", which is an engine-ladder number.
  // Same disambiguation as the header counts: say which population this counts.
  side.append(buildBotSideStat('Record here', recordLabel(botRecordFor(bot, gameSpecId))));

  const engineId = playOptionsFor(bot).find(
    (candidate) => candidate.gameSpecId === gameSpecId,
  )?.engineId;
  if (engineId) side.append(buildBotSideStat('Engine', engineId));
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
  heading.textContent = 'Ratings';
  section.append(heading);

  const options = playOptionsFor(bot);
  if (options.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'profile-ratings-empty';
    empty.textContent = 'No published rating yet.';
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
      ? 'Unrated'
      : 'Unavailable';

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
    empty.textContent = `No completed ${variantDisplayLabel(gameSpecId)} games yet.`;
    section.append(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'profile-game-list profile-activity';
  for (const game of games) list.append(buildProfileGameRow(game));
  section.append(list);
  return section;
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
  return `${Math.round(timeControl.initialMs / 1_000)}s + ${Math.round(
    timeControl.incrementMs / 1_000,
  )}s`;
}

function recordLabel(record: BotRecord): string {
  return `${record.wins}-${record.losses}-${record.draws}`;
}

function ratingLabel(rating: BotRatingSnapshot): string {
  return `${new Intl.NumberFormat().format(rating.rating)}${rating.provisional ? '?' : ''}`;
}

function timeClassLabel(timeClass: BotRatingSnapshot['timeClass']): string {
  return timeClass[0].toUpperCase() + timeClass.slice(1);
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
  const plural = rating.games === 1 ? 'game' : 'games';
  const spotlight = opts.style === 'spotlight';
  if (rating.source === 'eve-anchor') {
    // The rail row is a narrow fixed-width cell beside the number, so it takes
    // the bare sample; "Elo from ..." overflowed it into an ellipsis. The
    // spotlight has the room to say what the number is.
    return spotlight
      ? `Elo from ${rating.games} engine ${plural}`
      : `${rating.games} engine ${plural}`;
  }
  const suffix = spotlight ? ` · ${timeClassLabel(rating.timeClass)}` : '';
  return `${rating.games} rated ${plural}${suffix}`;
}
