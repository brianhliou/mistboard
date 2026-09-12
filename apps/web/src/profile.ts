// Profile + leaderboard pages — extracted from landing.ts.

import { FORTRESS_XIANGQI_SPEC_ID, JUNGLE_SPEC_ID, type RatingVariant } from '@mistboard/game';
import './account-profile.css';
import { openChallengeDialog } from './challenge-dialog.js';
import { buildCommunityLayout } from './community-rail.js';
import { correspondenceEnabled } from './feature-flags.js';
import { buildFlairIconIfSet } from './flair.js';
import type { FeaturedGame } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale, localizedHref } from './i18n/locale.js';
import {
  buildTitleBadge,
  isPlayerTitle,
  prependTitleBadge,
  titleFullName,
} from './player-titles.js';
import {
  buildProfileDashboard,
  buildProfileGameRow,
  buildProfileOverviewShell,
  buildProfileTabsShell,
  profileGameSpecLabel,
  profileResultTone,
} from './profile-ui.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { attachUserCard } from './user-card.js';
import { renderVariantMarker } from './variant-markers.js';
import type { VariantMiniId } from './variant-mini-boards.js';
import {
  leaderboardVariants,
  profileRatingVariants,
  type RatingVariantId,
  variantMiniIdForRating,
} from './variants.js';

type ProfileRatingVariant = RatingVariant;
type ProfileRatingTimeClass = 'bullet' | 'blitz' | 'rapid';
// The pace a rating surface opens on when the URL/user has not picked one.
// Mirrors the server's PUBLIC_RATING_TIME_CLASS.
const DEFAULT_LEADERBOARD_TIME_CLASS: ProfileRatingTimeClass = 'blitz';
type ProfileBucketRating = {
  variant: ProfileRatingVariant;
  timeClass: ProfileRatingTimeClass;
  eloRating: number | null;
  ratedGamesPlayed: number;
  totalGamesPlayed: number;
  provisional: boolean;
};

type ProfileRatingHistoryPoint = {
  roomId: string;
  endedAt: string;
  ratingBefore: number;
  ratingAfter: number;
};

type ProfileRatingHistory = {
  variant: ProfileRatingVariant;
  timeClass: ProfileRatingTimeClass;
  points: ProfileRatingHistoryPoint[];
};

type ProfilePuzzleRating = {
  variant: string;
  rating: number;
  provisional: boolean;
  solved: number;
  attempts: number;
};

type ProfileRelation = { following: boolean; blocked: boolean };

type UserProfile = {
  isViewer?: boolean;
  // The signed-in viewer's edge toward this profile; null/absent for anonymous
  // viewers and on your own profile (no buttons in either case).
  relation?: ProfileRelation | null;
  user: {
    handle: string;
    displayName: string;
    bio?: string;
    location?: string;
    profileLinks?: string[];
    profileVisibility: 'private' | 'unlisted' | 'public';
    accountRole: 'player' | 'admin';
    // Verified title key ('xgm', 'gm', ...). Absent/null = untitled. Granted
    // only through the /verify-title pipeline (see routes/titles.ts); unknown
    // values render no badge (fail-closed in player-titles.ts).
    title?: string | null;
    flair?: string | null;
    // Set while a donation is active; drives the cosmetic Patron badge. Absent
    // /null = not a patron. Server-derived (see routes/patron.ts).
    patronSince?: string | null;
    createdAt: string;
  };
  ratings: ProfileBucketRating[];
  // Per-variant puzzle ratings; absent/empty when the user has solved no puzzles.
  puzzleRatings?: ProfilePuzzleRating[];
  games: FeaturedGame[];
  gamesTotal: number;
};

// First page is delivered with the profile; "Load more" pulls subsequent pages.
const PROFILE_GAMES_PAGE = 15;
const FAVORITE_GAMES_PAGE = 15;

type LeaderboardEntry = {
  rank: number;
  handle: string;
  displayName: string;
  title?: string | null;
  eloRating: number;
  gamesPlayed: number;
  provisional: boolean;
};

type LeaderboardSummaryLadder = { variant: string; leaderboard: LeaderboardEntry[] };

type ActivePlayerEntry = {
  rank: number;
  handle: string;
  displayName: string;
  title?: string | null;
  gamesPlayed: number;
};

type LeaderboardSummary = {
  ladders: LeaderboardSummaryLadder[];
  activePlayers?: ActivePlayerEntry[];
} | null;

type LeaderboardResult = {
  leaderboard: LeaderboardEntry[];
  bucket: { variant: string; timeClass: string };
} | null;

type OnlinePlayerEntry = {
  handle: string;
  displayName: string;
  title?: string | null;
  rating: { variant: string; eloRating: number; provisional: boolean } | null;
  playing?: boolean;
};

type OnlinePlayersResult = {
  players: OnlinePlayerEntry[];
  count: number;
  anonymousOnline?: number;
} | null;

// One row of a compact ladder table: the value column is a rating for variant
// ladders and a games count for the active-players ladder.
type LeaderboardTableRow = {
  rank: number;
  handle: string;
  displayName: string;
  title?: string | null;
  value: number;
  provisional: boolean;
};

type RatingHistogramBin = { min: number; max: number; count: number };

const LEADERBOARD_BUCKETS: {
  variant: ProfileRatingVariant;
  miniId: VariantMiniId;
}[] = leaderboardVariants.map((v) => ({
  variant: v.id,
  miniId: v.miniId,
}));

const PROFILE_VARIANT_LABEL_KEY: Record<ProfileRatingVariant, I18nKey> = {
  fog: 'variant.darkChess.name',
  fog_draft960: 'variant.darkDraft960.name',
  dark_xiangqi: 'variant.darkXiangqi.name',
  dark_crazyhouse: 'variant.darkCrazyhouse.name',
  kriegspiel: 'variant.kriegspiel.name',
  jieqi: 'variant.jieqi.name',
  banqi: 'variant.banqi.name',
  reveal_chess: 'variant.revealChess.name',
  jungle: 'variant.jungle.name',
  jungle_flip: 'variant.jungleFlip.name',
  fortress_xiangqi: 'variant.fortressXiangqi.name',
  duck_xiangqi: 'variant.duckXiangqi.name',
  xiangqi: 'variant.xiangqi.name',
};

// Profile rating grid is subject-scoped and follows the baseline rating variant
// registry.
const PROFILE_VARIANT_ORDER: ProfileRatingVariant[] = profileRatingVariants.map((v) => v.id);

class ProfileNotFound extends Error {}

export async function mountProfile(root: HTMLElement, handle: string): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'profile-route');
  root.append(buildNav(locale), buildLoadingState(t('profile.loading', {}, locale)));

  const shell = document.createElement('main');
  shell.className = 'profile-shell';
  root.replaceChildren(buildNav(locale), shell);

  let profile: UserProfile;
  try {
    profile = await fetchUserProfile(handle);
  } catch (err) {
    console.warn(err);
    if (!(err instanceof ProfileNotFound)) {
      document.title = `${t('profile.loadFailedTitle', {}, locale)} · Mistboard`;
      shell.append(
        buildNotice(
          t('profile.loadFailedTitle', {}, locale),
          t('profile.loadFailedBody', {}, locale),
        ),
      );
      return;
    }
    document.title = `${t('profile.notFoundTitle', {}, locale)} · Mistboard`;
    shell.append(
      buildNotice(t('profile.notFoundTitle', {}, locale), t('profile.notFoundBody', {}, locale)),
    );
    return;
  }

  const selectedVariant = defaultSelectedProfileVariant(profile.ratings);
  const selectedTimeClass =
    preferredBucketForVariant(profile.ratings, selectedVariant)?.timeClass ??
    DEFAULT_LEADERBOARD_TIME_CLASS;
  let spotlight = buildProfileRatingSpotlight(
    profile.ratings,
    selectedVariant,
    locale,
    selectedTimeClass,
  );
  void hydrateProfileRatingSpotlight(
    spotlight,
    profile.user.handle,
    selectedVariant,
    locale,
    selectedTimeClass,
  );

  // The overview merges the identity banner and the rating graph into one card
  // (lichess parity): identity + actions across the top, the graph on the left
  // two-thirds, and the stat readouts on the right third.
  const overview = buildProfileOverview(profile, spotlight, locale);
  void hydrateProfilePresence(overview, profile.user.handle, locale);

  const tabs = buildProfileTabs(profile, locale);
  const ratings = buildProfileRatings(profile.ratings, locale, {
    selectedVariant,
    onSelect: (variant, timeClass) => {
      const next = buildProfileRatingSpotlight(profile.ratings, variant, locale, timeClass);
      spotlight.replaceWith(next);
      spotlight = next;
      void hydrateProfileRatingSpotlight(
        spotlight,
        profile.user.handle,
        variant,
        locale,
        timeClass,
      );
      syncSelectedRating(ratings, variant);
      // Picking a variant scopes the games list to it as well; the spotlight
      // alone used to move while the list kept showing every variant.
      tabs.setGamesVariant(variant);
    },
  });
  appendProfilePuzzleRatings(ratings, profile.puzzleRatings ?? [], locale);

  shell.append(buildProfileDashboard(ratings, overview, tabs.el));
}

// Static frame of the players page: community rail, twin headings (Online
// players | Leaderboard), online column, and one loading panel per ladder.
// Everything derives from the build-time variant registry, so both the client
// mount and the build-time prerender can render it without data.
// Each rated pace has its own ladder, so the players page is a grid per pace.
// English labels match the lobby's speed chips, which are English-for-now.
const LEADERBOARD_TIME_CLASSES: readonly { id: ProfileRatingTimeClass; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
];

function buildLeaderboardFrame(locale: Locale): {
  shell: HTMLElement;
  onlineBody: HTMLElement;
  grid: HTMLElement;
  paceTabs: HTMLElement;
  ladderPanels: {
    bucket: (typeof LEADERBOARD_BUCKETS)[number];
    shell: { panel: HTMLElement; body: HTMLElement };
  }[];
} {
  const onlineHeading = document.createElement('h2');
  onlineHeading.className = 'site-section-heading leaderboard-online-heading';
  onlineHeading.textContent = t('profile.onlinePlayers', {}, locale);

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading leaderboard-heading';
  heading.textContent = t('profile.leaderboard', {}, locale);

  const sub = document.createElement('p');
  sub.className = 'leaderboard-sub';
  sub.textContent = t('profile.leaderboardIntro', {}, locale);

  const onlineBody = document.createElement('div');
  onlineBody.className = 'leaderboard-online-body';

  const grid = document.createElement('div');
  grid.className = 'leaderboard-grid';
  const ladderPanels = LEADERBOARD_BUCKETS.map((bucket) => ({
    bucket,
    shell: buildLeaderboardPanelShell(
      profileVariantLabel(bucket.variant, locale),
      bucket.miniId,
      locale,
    ),
  }));
  grid.append(...ladderPanels.map((p) => p.shell.panel));

  const paceTabs = document.createElement('div');
  paceTabs.className = 'leaderboard-paces';
  paceTabs.setAttribute('role', 'tablist');
  paceTabs.setAttribute('aria-label', t('profile.leaderboard', {}, locale));
  for (const pace of LEADERBOARD_TIME_CLASSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'leaderboard-pace';
    button.dataset.timeClass = pace.id;
    button.textContent = pace.label;
    button.setAttribute('role', 'tab');
    const selected = pace.id === DEFAULT_LEADERBOARD_TIME_CLASS;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    paceTabs.append(button);
  }

  const body = document.createElement('div');
  body.className = 'leaderboard-body';
  body.append(onlineHeading, heading, sub, onlineBody, paceTabs, grid);

  const shell = document.createElement('main');
  shell.className = 'site-section community-shell leaderboard-shell';
  shell.append(buildCommunityLayout('/player', body, locale));
  return { shell, onlineBody, grid, paceTabs, ladderPanels };
}

// Stands in for the whole ladder grid while no ladder has a rated game. Points
// at the thing a visitor can actually do about it instead of restating the
// absence eight times.
function buildLeaderboardAwaitingRatedGames(locale: Locale): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'leaderboard-awaiting';
  empty.append(t('profile.leaderboardAwaiting', {}, locale), ' ');
  const link = document.createElement('a');
  link.href = localizedHref('/play', locale);
  link.textContent = t('profile.leaderboardAwaitingCta', {}, locale);
  empty.append(link);
  return empty;
}

// Build-time static render of the players page frame (nav + rail + headings +
// loading panels), baked by the prerender so first paint gets the full layout
// instead of the empty SPA shell. Live data (ladder rows, online list) stays a
// client fetch. Returns the inner HTML for `#app`.
export function renderLeaderboardShellForPrerender(): string {
  const nav = buildNav();
  const frame = buildLeaderboardFrame(currentLocale());
  return `${nav.outerHTML}${frame.shell.outerHTML}`;
}

export async function mountLeaderboard(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page');

  // Playstrategy-style players page: the frame renders immediately from the
  // build-time variant registry; the two fetches below only fill in rows, so
  // no layout waits on the network.
  const { shell, onlineBody, grid, paceTabs, ladderPanels } = buildLeaderboardFrame(locale);
  root.append(buildNav(locale), shell);

  const [summary, onlinePlayers] = await Promise.all([
    fetchLeaderboardSummary(DEFAULT_LEADERBOARD_TIME_CLASS),
    fetchOnlinePlayers(),
  ]);

  // Presence circles on every ladder row cross-reference the online set.
  const onlineHandles = new Set(
    (onlinePlayers?.players ?? []).map((player) => player.handle.toLowerCase()),
  );

  // Render every ladder in the shared canonical variant order (issue #137). The
  // panels are already appended to the grid in registry order by
  // buildLeaderboardFrame, and CANONICAL_VARIANT_ORDER is what the picker,
  // profile grid, and watch rail all key off — so the leaderboard must not
  // reorder by which ladders happen to have rated games yet.
  const renderLadders = (ladderSummary: LeaderboardSummary): void => {
    const ladders = new Map(
      (ladderSummary?.ladders ?? []).map((ladder) => [ladder.variant, ladder.leaderboard]),
    );
    // Before rated liquidity exists, every panel renders the same "no rated
    // games yet" line, so the page reads as eight repetitions of "nobody is
    // here". Collapse that whole state to one sentence: the grid only earns its
    // space once at least one ladder has a player. Partial emptiness keeps the
    // full grid, because the canonical order is what makes a missing ladder
    // legible against the ones that have rows.
    if (ladderSummary && !ladderSummary.ladders.some((l) => l.leaderboard.length > 0)) {
      grid.replaceChildren(buildLeaderboardAwaitingRatedGames(locale));
      return;
    }
    // A pace switch can arrive after the empty-state collapsed the grid, so put
    // the panels back before filling them.
    grid.replaceChildren(...ladderPanels.map((panel) => panel.shell.panel));
    for (const { bucket, shell: panelShell } of ladderPanels) {
      // A ladder missing from the summary just has no rated games yet; a null
      // summary means the fetch itself failed.
      const entries = ladderSummary ? (ladders.get(bucket.variant) ?? []) : null;
      const rows: LeaderboardTableRow[] | null = entries
        ? entries.map((entry) => ({
            rank: entry.rank,
            handle: entry.handle,
            displayName: entry.displayName,
            title: entry.title,
            value: entry.eloRating,
            provisional: entry.provisional,
          }))
        : null;
      renderLeaderboardPanelBody(
        panelShell.body,
        rows,
        onlineHandles,
        'profile.noRatedGames',
        locale,
      );
    }
  };

  // Pace tabs refetch rather than filter: the summary endpoint returns one
  // time class at a time, and the ladders are independent Glicko pools.
  let selectedTimeClass: ProfileRatingTimeClass = DEFAULT_LEADERBOARD_TIME_CLASS;
  paceTabs.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('.leaderboard-pace');
    const timeClass = button?.dataset.timeClass as ProfileRatingTimeClass | undefined;
    if (!timeClass || timeClass === selectedTimeClass) return;
    selectedTimeClass = timeClass;
    for (const tab of paceTabs.querySelectorAll<HTMLElement>('.leaderboard-pace')) {
      const selected = tab.dataset.timeClass === timeClass;
      tab.classList.toggle('selected', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    void (async () => {
      const next = await fetchLeaderboardSummary(timeClass);
      // Drop a slow response the user has already navigated past.
      if (selectedTimeClass !== timeClass) return;
      renderLadders(next);
    })();
  });

  renderLadders(summary);
  renderOnlinePlayers(onlineBody, onlinePlayers, locale);
}

export async function mountRatingStats(root: HTMLElement): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page');

  const body = document.createElement('div');
  body.className = 'rating-stats-body';

  const title = document.createElement('h1');
  title.className = 'site-section-heading rating-stats-heading';
  title.append(t('profile.ratingStatsPeriod', {}, locale), ' ');

  const select = document.createElement('select');
  select.className = 'rating-stats-select';
  select.setAttribute('aria-label', t('profile.ratingStatsVariant', {}, locale));
  for (const bucket of LEADERBOARD_BUCKETS) {
    const option = document.createElement('option');
    option.value = bucket.variant;
    option.textContent = profileVariantLabel(bucket.variant, locale);
    select.append(option);
  }
  if (LEADERBOARD_BUCKETS.some((bucket) => bucket.variant === 'fog')) {
    select.value = 'fog';
  }
  title.append(select, ` ${t('profile.ratingStatsSuffix', {}, locale)}`);

  const chartShell = document.createElement('section');
  chartShell.className = 'rating-stats-chart-shell';
  chartShell.setAttribute('aria-live', 'polite');

  body.append(title, chartShell);

  const shell = document.createElement('main');
  shell.className = 'site-section community-shell leaderboard-shell';
  shell.append(buildCommunityLayout('/player/rating-stats', body, locale));
  root.append(buildNav(locale), shell);

  const renderSelected = async () => {
    const variant = select.value as ProfileRatingVariant;
    chartShell.replaceChildren(buildRatingStatsLoading(locale));
    const result = await fetchLeaderboard(variant);
    renderRatingStatsChart(chartShell, result, variant, locale);
  };

  select.addEventListener('change', () => {
    void renderSelected();
  });
  await renderSelected();
}

async function fetchLeaderboardSummary(
  timeClass: ProfileRatingTimeClass = DEFAULT_LEADERBOARD_TIME_CLASS,
): Promise<LeaderboardSummary> {
  try {
    const resp = await fetch(
      `/api/leaderboard/summary?limit=10&timeClass=${encodeURIComponent(timeClass)}`,
    );
    if (!resp.ok) throw new Error(`leaderboard summary failed: ${resp.status}`);
    return (await resp.json()) as NonNullable<LeaderboardSummary>;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

async function fetchLeaderboard(variant: ProfileRatingVariant): Promise<LeaderboardResult> {
  try {
    const resp = await fetch(`/api/leaderboard?variant=${encodeURIComponent(variant)}&limit=500`);
    if (!resp.ok) throw new Error(`leaderboard failed: ${resp.status}`);
    return (await resp.json()) as NonNullable<LeaderboardResult>;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

function buildRatingStatsLoading(locale: Locale): HTMLElement {
  const loading = document.createElement('p');
  loading.className = 'rating-stats-empty';
  loading.textContent = t('profile.loadingRatings', {}, locale);
  return loading;
}

function renderRatingStatsChart(
  shell: HTMLElement,
  result: LeaderboardResult,
  variant: ProfileRatingVariant,
  locale: Locale,
): void {
  if (!result) {
    const msg = document.createElement('p');
    msg.className = 'rating-stats-empty';
    msg.textContent = t('profile.ratingsLoadFailed', {}, locale);
    shell.replaceChildren(msg);
    return;
  }

  const ratings = result.leaderboard.map((entry) => entry.eloRating).filter(Number.isFinite);
  if (ratings.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'rating-stats-empty';
    msg.textContent = t('profile.noRatedGames', {}, locale);
    shell.replaceChildren(msg);
    return;
  }

  const bins = ratingHistogram(ratings);
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  const chart = document.createElement('div');
  chart.className = 'rating-stats-chart';
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    t('profile.ratingStatsChartLabel', { variant: profileVariantLabel(variant, locale) }, locale),
  );

  const average = Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
  const intro = document.createElement('p');
  intro.className = 'rating-stats-summary';
  intro.textContent = t(
    'profile.ratingStatsSummary',
    { count: String(ratings.length), variant: profileVariantLabel(variant, locale), average },
    locale,
  );

  for (const bin of bins) {
    const bar = document.createElement('div');
    bar.className = 'rating-stats-bar';
    bar.style.height = `${Math.max(4, (bin.count / maxCount) * 100)}%`;
    bar.title = `${bin.min}-${bin.max}: ${bin.count}`;
    const label = document.createElement('span');
    label.className = 'rating-stats-bar-label';
    label.textContent = String(bin.min);
    bar.append(label);
    chart.append(bar);
  }

  shell.replaceChildren(intro, chart);
}

function ratingHistogram(ratings: number[]): RatingHistogramBin[] {
  const step = 100;
  const min = Math.floor(Math.min(...ratings) / step) * step;
  const max = Math.ceil(Math.max(...ratings) / step) * step;
  const bins: RatingHistogramBin[] = [];
  for (let start = min; start <= max; start += step) {
    bins.push({ min: start, max: start + step - 1, count: 0 });
  }
  for (const rating of ratings) {
    const index = Math.min(Math.floor((rating - min) / step), bins.length - 1);
    bins[index]!.count += 1;
  }
  return bins;
}

async function fetchOnlinePlayers(): Promise<OnlinePlayersResult> {
  try {
    const resp = await fetch('/api/players/online');
    if (!resp.ok) throw new Error(`online players failed: ${resp.status}`);
    return (await resp.json()) as NonNullable<OnlinePlayersResult>;
  } catch (err) {
    console.warn(err);
    return null;
  }
}

function renderOnlinePlayers(body: HTMLElement, result: OnlinePlayersResult, locale: Locale): void {
  const parts: HTMLElement[] = [];
  // A failed fetch degrades to the empty state: the list is a soft signal,
  // not worth an error banner.
  if (!result || result.players.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'leaderboard-online-empty';
    empty.textContent = t('profile.noPlayersOnline', {}, locale);
    parts.push(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'leaderboard-online-list';
    for (const player of result.players) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/@/${encodeURIComponent(player.handle)}`;
      const dot = document.createElement('span');
      dot.className = 'leaderboard-presence leaderboard-presence-online';
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'leaderboard-online-name';
      name.textContent = player.displayName;
      link.append(dot);
      prependTitleBadge(link, player.title, locale);
      link.append(name);
      if (player.playing) {
        const playingMark = document.createElement('span');
        playingMark.className = 'leaderboard-online-playing';
        // Text-presentation crossed swords, so platforms don't swap in emoji.
        playingMark.textContent = '⚔︎';
        playingMark.title = t('profile.playingNow', {}, locale);
        playingMark.setAttribute('aria-label', t('profile.playingNow', {}, locale));
        link.append(playingMark);
      }
      if (player.rating) {
        // One representative figure: the player's best blitz pool. A small board
        // marker leads it (the variant name still rides on the title attribute).
        const rating = document.createElement('span');
        rating.className = 'leaderboard-online-rating';
        const variantLabel = maybeVariantLabel(player.rating.variant, locale);
        const miniId = variantMiniIdForRating(player.rating.variant as RatingVariantId);
        if (miniId) {
          rating.append(
            buildVariantThumb(miniId, 16, 'leaderboard-online-rating-thumb', variantLabel ?? ''),
          );
        }
        const value = document.createElement('span');
        value.className = 'leaderboard-online-rating-value';
        value.textContent = `${player.rating.eloRating}${player.rating.provisional ? '?' : ''}`;
        rating.append(value);
        if (variantLabel) rating.title = variantLabel;
        link.append(rating);
      }
      // Same reusable hover card the friends-online widget uses — the online
      // list is the second surface it serves.
      attachUserCard(link, player.handle, { online: true, playing: player.playing });
      item.append(link);
      list.append(item);
    }
    parts.push(list);
  }
  if (result && (result.anonymousOnline ?? 0) > 0) {
    const anon = document.createElement('p');
    anon.className = 'leaderboard-online-anon';
    anon.textContent = t(
      'profile.anonymousOnline',
      { count: String(result.anonymousOnline) },
      locale,
    );
    parts.push(anon);
  }
  body.replaceChildren(...parts);
}

// Label for a rating-pool name coming off the wire, or null if the client
// does not know the pool (fail soft: an unknown pool just loses its tooltip).
function maybeVariantLabel(variant: string, locale: Locale): string | null {
  if (!(variant in PROFILE_VARIANT_LABEL_KEY)) return null;
  return profileVariantLabel(variant as ProfileRatingVariant, locale);
}

// Decorative variant marker (the same one-colour art as the picker/articles).
// aria-hidden because every call site already renders the variant name in text.
function buildVariantThumb(
  miniId: VariantMiniId,
  px: number,
  className: string,
  label: string,
): HTMLElement {
  const thumb = document.createElement('span');
  thumb.className = className;
  thumb.setAttribute('aria-hidden', 'true');
  thumb.innerHTML = renderVariantMarker(miniId, { size: px, label });
  return thumb;
}

// Panel shell shared by the active-players ladder (no board thumb) and the
// per-variant ladders. The body starts in a loading state and is filled by
// renderLeaderboardPanelBody once the summary lands.
function buildLeaderboardPanelShell(
  title: string,
  miniId: VariantMiniId | null,
  locale: Locale = currentLocale(),
): { panel: HTMLElement; body: HTMLElement } {
  const header = document.createElement('header');
  header.className = 'leaderboard-panel-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'leaderboard-panel-title';
  titleEl.textContent = title;

  if (miniId) {
    header.append(
      buildVariantThumb(
        miniId,
        22,
        'leaderboard-panel-thumb',
        t('profile.variantBoard', { variant: title }, locale),
      ),
    );
  }
  header.append(titleEl);

  const body = document.createElement('div');
  body.className = 'leaderboard-panel-body';
  const loading = document.createElement('p');
  loading.className = 'leaderboard-panel-empty';
  loading.textContent = t('profile.loadingRatings', {}, locale);
  body.append(loading);

  const panel = document.createElement('section');
  panel.className = 'leaderboard-panel';
  panel.append(header, body);
  return { panel, body };
}

function renderLeaderboardPanelBody(
  body: HTMLElement,
  rows: LeaderboardTableRow[] | null,
  onlineHandles: Set<string>,
  emptyKey: 'profile.noRatedGames' | 'profile.noGamesYet',
  locale: Locale = currentLocale(),
): void {
  if (rows && rows.length > 0) {
    body.replaceChildren(renderLeaderboardTable(rows, onlineHandles, locale));
    return;
  }
  const msg = document.createElement('p');
  msg.className = 'leaderboard-panel-empty';
  msg.textContent = rows ? t(emptyKey, {}, locale) : t('profile.ratingsLoadFailed', {}, locale);
  body.replaceChildren(msg);
}

function renderLeaderboardTable(
  rows: LeaderboardTableRow[],
  onlineHandles: Set<string>,
  locale: Locale = currentLocale(),
): HTMLTableElement {
  // Compact, header-less list in the lichess/playstrategy idiom: rank, player,
  // value only — no column headings. Every row carries a presence circle
  // (filled = online now), so the whole wall doubles as a who's-online surface.
  const table = document.createElement('table');
  table.className = 'leaderboard-table';

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');

    const rankTd = document.createElement('td');
    rankTd.className = 'leaderboard-rank';
    rankTd.textContent = String(row.rank);

    const nameTd = document.createElement('td');
    nameTd.className = 'leaderboard-player';
    const link = document.createElement('a');
    link.href = `/@/${encodeURIComponent(row.handle)}`;
    const presence = document.createElement('span');
    presence.className = 'leaderboard-presence';
    if (onlineHandles.has(row.handle.toLowerCase())) {
      presence.classList.add('leaderboard-presence-online');
    }
    presence.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'leaderboard-player-name';
    name.textContent = row.displayName;
    link.append(presence);
    prependTitleBadge(link, row.title, locale);
    link.append(name);
    nameTd.append(link);

    const valueTd = document.createElement('td');
    valueTd.className = 'leaderboard-rating';
    valueTd.textContent = String(row.value);
    if (row.provisional) {
      // "?" marks a provisional rating (RD still high) — shown so the board isn't
      // empty at low liquidity, but flagged as not yet settled.
      valueTd.classList.add('leaderboard-rating-provisional');
      const q = document.createElement('span');
      q.className = 'leaderboard-rating-q';
      q.textContent = '?';
      valueTd.append(q);
    }

    tr.append(rankTd, nameTd, valueTd);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

async function fetchUserProfile(handle: string): Promise<UserProfile> {
  const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/profile`);
  if (resp.status === 404) throw new ProfileNotFound();
  if (!resp.ok) throw new Error(`failed to load profile: ${resp.status}`);
  const data = (await resp.json()) as { profile: UserProfile };
  return data.profile;
}

async function fetchUserRatingHistory(
  handle: string,
  variant: ProfileRatingVariant,
  timeClass: ProfileRatingTimeClass = DEFAULT_LEADERBOARD_TIME_CLASS,
): Promise<ProfileRatingHistory | null> {
  const resp = await fetch(
    `/api/users/${encodeURIComponent(handle)}/rating-history?variant=${encodeURIComponent(
      variant,
    )}&timeClass=${encodeURIComponent(timeClass)}`,
  );
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`rating history failed: ${resp.status}`);
  const data = (await resp.json()) as { history: ProfileRatingHistory };
  return data.history;
}

// The merged overview card (lichess parity): identity + actions run across the
// top, then the body splits into the rating graph (left two-thirds) and the
// stat readouts (right third). The `spotlight` slot is the graph column; it is
// swapped in place when the viewer picks a different variant in the rail.
export function buildProfileOverview(
  profile: UserProfile,
  spotlight: HTMLElement,
  locale: Locale = currentLocale(),
): HTMLElement {
  const actions = buildProfileActions(profile, locale);
  return buildProfileOverviewShell({
    identity: buildProfileIdentity(profile, locale),
    actions,
    primary: spotlight,
    side: buildProfileSideInfo(profile, locale),
  });
}

// Identity block for the overview top strip: the handle heading (presence dot +
// gold title abbreviation + @handle) over a dot-separated meta line (join date,
// full title, role/patron badges).
export function buildProfileIdentity(
  profile: UserProfile,
  locale: Locale = currentLocale(),
): HTMLElement {
  const identity = document.createElement('div');
  identity.className = 'profile-identity';

  // Presence dot ahead of the handle (lichess online line-icon). Rendered
  // offline-first with a fixed footprint; hydrateProfilePresence fills it once
  // the online-players fetch lands, so nothing shifts.
  const presence = document.createElement('span');
  presence.className = 'profile-presence';
  presence.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('h1');
  heading.className = 'profile-identity-handle';
  heading.append(presence);
  const titleBadge = buildTitleBadge(profile.user.title, locale);
  if (titleBadge) heading.append(titleBadge);
  heading.append(document.createTextNode(`@${profile.user.handle}`));
  // Flair trails the handle (title badges lead it): an earned title qualifies
  // the name, a self-chosen flair decorates it, and the order keeps the two
  // from reading as the same kind of claim.
  const flair = buildFlairIconIfSet(profile.user.flair, { locale });
  if (flair) heading.append(flair);
  identity.append(heading);

  // Badge line: verified title, admin, and patron badges (the join date now
  // lives in the side column, lichess-style).
  const metaParts: HTMLElement[] = [];
  if (isPlayerTitle(profile.user.title)) {
    const titleFull = document.createElement('span');
    titleFull.className = 'profile-role-badge profile-title-full';
    titleFull.textContent = titleFullName(profile.user.title, locale);
    metaParts.push(titleFull);
  }
  const roleBadge = buildRoleBadge(profile.user.accountRole, locale);
  if (roleBadge) metaParts.push(roleBadge);
  const patronBadge = buildPatronBadge(profile.user.patronSince, locale);
  if (patronBadge) metaParts.push(patronBadge);

  if (metaParts.length > 0) {
    const meta = document.createElement('p');
    meta.className = 'profile-header-meta';
    metaParts.forEach((part, index) => {
      if (index > 0) meta.append(document.createTextNode(' · '));
      meta.append(part);
    });
    identity.append(meta);
  }

  // Counts strip under the name (lichess user-infos row): compact activity
  // figures, not the descriptive text (which sits in the side column).
  identity.append(buildProfileCounts(profile, locale));

  return identity;
}

// The top-strip action row: Follow/Challenge/Message for someone else's profile,
// Edit profile (+ coach) on your own, nothing for an anonymous viewer.
function buildProfileActions(
  profile: UserProfile,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  if (profile.relation) {
    return buildRelationActions(profile.user.handle, profile.relation, locale);
  }
  if (profile.isViewer) return buildOwnerActions(locale, profile.user.title);
  return null;
}

// Your own profile offers its editor; someone else's profile offers the social
// actions assembled above.
function buildOwnerActions(locale: Locale = currentLocale(), title?: unknown): HTMLElement {
  const row = document.createElement('div');
  row.className = 'profile-relation-actions profile-owner-actions';
  const edit = document.createElement('a');
  edit.className = 'landing-setup-back';
  edit.href = localizedHref('/account/settings', locale);
  edit.textContent = t('profile.editProfile', {}, locale);
  row.append(edit);
  // A held title unlocks the coach directory: offer the editor entry point.
  if (isPlayerTitle(title)) {
    const coach = document.createElement('a');
    coach.className = 'landing-setup-back';
    coach.href = '/coach/edit';
    coach.textContent = t('profile.coachProfile', {}, locale);
    row.append(coach);
  }
  return row;
}

// Fills the header presence dot from the same /api/players/online set the
// leaderboard uses. Fail-soft: on any fetch/shape problem the dot stays in its
// neutral offline state (we never claim "offline" from a soft signal).
async function hydrateProfilePresence(
  header: HTMLElement,
  handle: string,
  locale: Locale,
): Promise<void> {
  const dot = header.querySelector<HTMLElement>('.profile-presence');
  if (!dot) return;
  const result = await fetchOnlinePlayers();
  const players = Array.isArray(result?.players) ? result.players : [];
  const me = players.find((player) => player.handle.toLowerCase() === handle.toLowerCase());
  if (!me) return;
  dot.classList.add('profile-presence-online');
  const label = me.playing ? t('profile.playingNow', {}, locale) : t('profile.online', {}, locale);
  dot.removeAttribute('aria-hidden');
  dot.setAttribute('role', 'img');
  dot.setAttribute('aria-label', label);
  dot.title = label;
}

// Follow/block controls for a signed-in viewer on someone else's profile.
// Mutations return the fresh relation, so the row re-renders from the server's
// answer rather than an optimistic local flip.
function buildRelationActions(
  handle: string,
  relation: ProfileRelation,
  locale: Locale = currentLocale(),
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'profile-relation-actions';
  renderRelationActions(row, handle, relation, locale);
  return row;
}

function renderRelationActions(
  row: HTMLElement,
  handle: string,
  relation: ProfileRelation,
  locale: Locale,
): void {
  row.replaceChildren();

  // A blocked profile only offers Unblock; hiding Follow and Message avoids
  // the confusing follow-your-own-block overwrite.
  if (!relation.blocked) {
    const message = document.createElement('a');
    message.className = 'landing-setup-start';
    message.href = `/inbox/${encodeURIComponent(handle)}`;
    message.textContent = t('profile.message', {}, locale);
    row.append(message);

    // Directed correspondence challenge (async-loop). Gated on the correspondence
    // flag so it only appears where the challenge system is live.
    if (correspondenceEnabled()) {
      const challenge = document.createElement('button');
      challenge.type = 'button';
      challenge.className = 'landing-setup-start';
      challenge.textContent = t('challenge.button', {}, locale);
      challenge.addEventListener('click', () => openChallengeDialog({ handle, locale }));
      row.append(challenge);
    }

    const follow = document.createElement('button');
    follow.type = 'button';
    follow.className = relation.following ? 'landing-setup-back' : 'landing-setup-start';
    follow.textContent = relation.following
      ? t('profile.unfollow', {}, locale)
      : t('profile.follow', {}, locale);
    follow.addEventListener('click', () =>
      mutateRelation(row, handle, 'follow', relation.following ? 'DELETE' : 'POST', locale, follow),
    );
    row.append(follow);
  }

  const block = document.createElement('button');
  block.type = 'button';
  block.className = 'landing-setup-back profile-relation-block';
  block.textContent = relation.blocked
    ? t('profile.unblock', {}, locale)
    : t('profile.block', {}, locale);
  block.addEventListener('click', () =>
    mutateRelation(row, handle, 'block', relation.blocked ? 'DELETE' : 'POST', locale, block),
  );
  row.append(block);
}

async function mutateRelation(
  row: HTMLElement,
  handle: string,
  kind: 'follow' | 'block',
  method: 'POST' | 'DELETE',
  locale: Locale,
  trigger: HTMLButtonElement,
): Promise<void> {
  trigger.disabled = true;
  try {
    const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/${kind}`, { method });
    if (!resp.ok) throw new Error(`relation ${kind} failed: ${resp.status}`);
    const data = (await resp.json()) as { relation: ProfileRelation };
    renderRelationActions(row, handle, data.relation, locale);
  } catch (err) {
    console.warn(err);
    trigger.disabled = false;
  }
}

// Header counts strip (the lichess social-bar analog): neutral/positive figures
// only — no win/loss record (which just accumulates losses). Everything derives
// from data the profile already loads, so nothing here needs a server aggregate.
// The join date lives on the identity meta line, not here.
function buildProfileCounts(profile: UserProfile, locale: Locale = currentLocale()): HTMLElement {
  const strip = document.createElement('div');
  strip.className = 'profile-counts';

  const items: Array<{ value: string; label: string }> = [
    {
      value: String(profile.gamesTotal),
      label:
        profile.gamesTotal === 1
          ? t('profile.gameSingular', {}, locale)
          : t('profile.gamePlural', {}, locale),
    },
  ];

  const rated = profile.ratings.reduce((sum, bucket) => sum + bucket.ratedGamesPlayed, 0);
  if (rated > 0) {
    items.push({ value: String(rated), label: t('profile.ratedGames', {}, locale) });
  }

  const best = bestRating(profile.ratings);
  if (best != null) items.push({ value: String(best), label: t('profile.bestRating', {}, locale) });

  for (const { value, label } of items) {
    const item = document.createElement('div');
    item.className = 'profile-count';
    const valueEl = document.createElement('span');
    valueEl.className = 'profile-count-value';
    valueEl.textContent = value;
    const labelEl = document.createElement('span');
    labelEl.className = 'profile-count-label';
    labelEl.textContent = label;
    item.append(valueEl, labelEl);
    strip.append(item);
  }
  return strip;
}

// The descriptive "user profile text" column (lichess right third): display
// name (when it differs from the handle), the full join date, and the player's
// most-played variant. Kept to what the profile payload already carries.
function buildProfileSideInfo(profile: UserProfile, locale: Locale = currentLocale()): HTMLElement {
  const side = document.createElement('aside');
  side.className = 'profile-overview-side';

  const displayName = profile.user.displayName?.trim();
  if (displayName && displayName.toLowerCase() !== profile.user.handle.toLowerCase()) {
    const name = document.createElement('p');
    name.className = 'profile-side-name';
    name.textContent = displayName;
    side.append(name);
  }

  const bio = profile.user.bio?.trim();
  if (bio) {
    const el = document.createElement('p');
    el.className = 'profile-side-line profile-side-bio';
    el.textContent = bio;
    side.append(el);
  }

  const location = profile.user.location?.trim();
  if (location) {
    const el = document.createElement('p');
    el.className = 'profile-side-line';
    el.textContent = location;
    side.append(el);
  }

  const links = profile.user.profileLinks ?? [];
  if (links.length > 0) {
    const list = document.createElement('ul');
    list.className = 'profile-side-links';
    for (const href of links) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = href;
      link.rel = 'nofollow noopener noreferrer';
      link.target = '_blank';
      link.textContent = profileLinkLabel(href);
      item.append(link);
      list.append(item);
    }
    side.append(list);
  }

  const joined = formatJoinedFull(profile.user.createdAt, locale);
  if (joined) {
    const el = document.createElement('p');
    el.className = 'profile-side-line';
    el.textContent = `${t('profile.memberSince', {}, locale)} ${joined}`;
    side.append(el);
  }

  const top = topVariantStat(profile.ratings, locale);
  if (top) {
    const block = document.createElement('div');
    block.className = 'profile-side-stat';
    const label = document.createElement('span');
    label.className = 'profile-side-stat-label';
    label.textContent = t('profile.topVariant', {}, locale);
    const value = document.createElement('span');
    value.className = 'profile-side-stat-value';
    if (top.miniId)
      value.append(buildVariantThumb(top.miniId, 18, 'profile-side-thumb', top.label));
    value.append(document.createTextNode(top.label));
    block.append(label, value);
    side.append(block);
  }

  return side;
}

function profileLinkLabel(href: string): string {
  try {
    const url = new URL(href);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return href;
  }
}

function defaultSelectedProfileVariant(ratings: ProfileBucketRating[]): ProfileRatingVariant {
  const best = ratings
    .filter((rating) => rating.eloRating != null && rating.ratedGamesPlayed > 0)
    .sort((a, b) => (b.eloRating ?? 0) - (a.eloRating ?? 0))[0];
  if (best) return best.variant;

  const active = ratings
    .filter((rating) => rating.totalGamesPlayed > 0)
    .sort((a, b) => b.totalGamesPlayed - a.totalGamesPlayed)[0];
  if (active) return active.variant;

  return PROFILE_VARIANT_ORDER[0] ?? 'fog';
}

// Range presets for the rating graph (lichess/playstrategy parity). ALL is the
// default so a sparse history still shows every point on first paint.
type ChartRange = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';
const CHART_RANGES: ChartRange[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

// Full (unfiltered) history for each live spotlight, so a range change re-filters
// without another fetch. Keyed on the section element; the WeakMap lets a swapped
// out spotlight (variant change) get collected.
const spotlightHistory = new WeakMap<HTMLElement, ProfileRatingHistoryPoint[]>();
let chartGradientSeq = 0;

function buildProfileRatingSpotlight(
  ratings: ProfileBucketRating[],
  variant: ProfileRatingVariant,
  locale: Locale = currentLocale(),
  timeClass: ProfileRatingTimeClass = DEFAULT_LEADERBOARD_TIME_CLASS,
): HTMLElement {
  // Fall back to the variant's preferred pace so a caller that only knows the
  // variant still lands on a ladder the player has actually played.
  const bucket =
    ratings.find((rating) => rating.variant === variant && rating.timeClass === timeClass) ??
    preferredBucketForVariant(ratings, variant);
  const shownTimeClass = bucket?.timeClass ?? timeClass;
  const section = document.createElement('section');
  section.className = 'profile-rating-spotlight';
  section.dataset.chartRange = 'ALL';
  section.dataset.chartStart = '0';

  const head = document.createElement('header');
  head.className = 'profile-chart-head';

  const headline = document.createElement('div');
  headline.className = 'profile-chart-headline';

  const name = document.createElement('span');
  name.className = 'profile-chart-variant';
  name.textContent = profileVariantLabel(variant, locale);
  if (bucket && bucket.ratedGamesPlayed > 0 && shownTimeClass !== DEFAULT_LEADERBOARD_TIME_CLASS) {
    const pace = document.createElement('span');
    pace.className = 'profile-chart-pace';
    pace.textContent = timeClassLabel(shownTimeClass);
    name.append(' ', pace);
  }

  const value = document.createElement('span');
  value.className = 'profile-chart-value';

  const detail = document.createElement('span');
  detail.className = 'profile-chart-detail';

  if (bucket?.eloRating != null && bucket.ratedGamesPlayed > 0) {
    value.textContent = String(bucket.eloRating);
    if (bucket.provisional) {
      const q = document.createElement('span');
      q.className = 'profile-rating-q';
      q.textContent = '?';
      value.append(q);
    }
    detail.textContent = t(
      bucket.ratedGamesPlayed === 1 ? 'profile.ratedGameOne' : 'profile.ratedGameMany',
      { count: bucket.ratedGamesPlayed },
      locale,
    );
  } else if (bucket && bucket.totalGamesPlayed > 0) {
    value.textContent = t('profile.unrated', {}, locale);
    value.classList.add('profile-chart-value-unrated');
    detail.textContent = `${bucket.totalGamesPlayed} ${t(
      bucket.totalGamesPlayed === 1 ? 'profile.gameSingular' : 'profile.gamePlural',
      {},
      locale,
    ).toLowerCase()}`;
  } else {
    value.textContent = '—';
    value.classList.add('profile-chart-value-empty');
    detail.textContent = t('profile.noGamesYet', {}, locale);
  }
  headline.append(name, value, detail);

  const ranges = document.createElement('div');
  ranges.className = 'profile-chart-ranges';
  ranges.setAttribute('role', 'group');
  ranges.setAttribute('aria-label', t('profile.ratingHistory', {}, locale));
  for (const range of CHART_RANGES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-chart-range';
    button.dataset.range = range;
    button.textContent = range;
    const active = range === 'ALL';
    button.classList.toggle('profile-chart-range-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      section.dataset.chartRange = range;
      renderSpotlightChart(section, locale, true);
    });
    ranges.append(button);
  }

  head.append(headline, ranges);

  // Continuous range slider under the chart (lichess navigator): the handle
  // sets the window's start as a fraction of the full history span; the preset
  // buttons snap it. Year labels bracket the span.
  const slider = document.createElement('div');
  slider.className = 'profile-chart-slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = '0';
  input.step = '1';
  input.className = 'profile-chart-slider-input';
  input.setAttribute('aria-label', t('profile.ratingHistory', {}, locale));
  input.addEventListener('input', () => {
    section.dataset.chartStart = input.value;
    section.dataset.chartRange = '';
    renderSpotlightChart(section, locale, false);
  });
  const axis = document.createElement('div');
  axis.className = 'profile-chart-slider-axis';
  axis.setAttribute('aria-hidden', 'true');
  slider.append(input, axis);

  section.append(head, buildRatingChartFrame(locale), slider);
  return section;
}

async function hydrateProfileRatingSpotlight(
  section: HTMLElement,
  handle: string,
  variant: ProfileRatingVariant,
  locale: Locale,
  timeClass: ProfileRatingTimeClass = DEFAULT_LEADERBOARD_TIME_CLASS,
): Promise<void> {
  const chart = section.querySelector<HTMLElement>('.profile-rating-chart');
  if (!chart) return;
  try {
    const history = await fetchUserRatingHistory(handle, variant, timeClass);
    spotlightHistory.set(section, history?.points ?? []);
  } catch (err) {
    console.warn(err);
    spotlightHistory.set(section, []);
  }
  renderSpotlightChart(section, locale, true);
}

// Render the chart from the section's stored history for its current window. The
// window start is a fraction of the full span; a preset click derives that
// fraction and snaps the slider, a slider drag sets it directly.
function renderSpotlightChart(section: HTMLElement, locale: Locale, fromPreset: boolean): void {
  const points = spotlightHistory.get(section) ?? [];
  const input = section.querySelector<HTMLInputElement>('.profile-chart-slider-input');

  let fraction: number;
  if (fromPreset) {
    const range = (section.dataset.chartRange as ChartRange) || 'ALL';
    fraction = fractionForRange(points, range);
    section.dataset.chartStart = String(fraction);
    if (input) input.value = String(fraction);
  } else {
    fraction = Number(section.dataset.chartStart ?? '0');
  }

  const chart = section.querySelector<HTMLElement>('.profile-rating-chart');
  if (chart) renderRatingChartFrame(chart, filterPointsByStartFraction(points, fraction), locale);

  // A preset stays highlighted only until the slider moves off it.
  const activeRange = section.dataset.chartRange ?? '';
  for (const button of section.querySelectorAll<HTMLElement>('.profile-chart-range')) {
    const active = activeRange !== '' && button.dataset.range === activeRange;
    button.classList.toggle('profile-chart-range-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  // The slider is only meaningful with a span to scrub; hide it otherwise.
  const times = pointTimes(points);
  section.classList.toggle('profile-chart-no-slider', times.length < 2);
  renderSliderAxis(section, times, locale);
}

// Sorted epoch-ms timestamps of the history points (unparseable dates dropped).
function pointTimes(points: ProfileRatingHistoryPoint[]): number[] {
  return points
    .map((point) => new Date(point.endedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

// Epoch-ms cutoff for a range preset, or null for ALL (no lower bound).
function chartRangeCutoff(range: ChartRange): number | null {
  if (range === 'ALL') return null;
  const now = new Date();
  if (range === 'YTD') return new Date(now.getFullYear(), 0, 1).getTime();
  const cutoff = new Date(now);
  if (range === '1M') cutoff.setMonth(cutoff.getMonth() - 1);
  else if (range === '3M') cutoff.setMonth(cutoff.getMonth() - 3);
  else if (range === '6M') cutoff.setMonth(cutoff.getMonth() - 6);
  else if (range === '1Y') cutoff.setFullYear(cutoff.getFullYear() - 1);
  return cutoff.getTime();
}

// Map a range preset onto a start fraction [0,100] of the history span, so the
// slider and the presets share one coordinate.
function fractionForRange(points: ProfileRatingHistoryPoint[], range: ChartRange): number {
  const cutoff = chartRangeCutoff(range);
  if (cutoff == null) return 0;
  const times = pointTimes(points);
  if (times.length < 2) return 0;
  const t0 = times[0]!;
  const span = times[times.length - 1]! - t0 || 1;
  return Math.max(0, Math.min(100, ((cutoff - t0) / span) * 100));
}

function filterPointsByStartFraction(
  points: ProfileRatingHistoryPoint[],
  fraction: number,
): ProfileRatingHistoryPoint[] {
  if (fraction <= 0) return points;
  const times = pointTimes(points);
  if (times.length < 2) return points;
  const t0 = times[0]!;
  const span = times[times.length - 1]! - t0 || 1;
  const start = t0 + span * (fraction / 100);
  return points.filter((point) => {
    const time = new Date(point.endedAt).getTime();
    // A point with an unparseable date keeps its place rather than vanishing.
    return Number.isFinite(time) ? time >= start : true;
  });
}

// Year labels bracketing the slider (empty when there is no span to scrub).
function renderSliderAxis(section: HTMLElement, times: number[], locale: Locale): void {
  const axis = section.querySelector<HTMLElement>('.profile-chart-slider-axis');
  if (!axis) return;
  if (times.length < 2) {
    axis.replaceChildren();
    return;
  }
  const fmt = new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, { year: 'numeric' });
  const start = document.createElement('span');
  start.textContent = fmt.format(new Date(times[0]!));
  const end = document.createElement('span');
  end.textContent = fmt.format(new Date(times[times.length - 1]!));
  axis.replaceChildren(start, end);
}

function buildRatingChartFrame(locale: Locale = currentLocale()): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'profile-rating-chart';

  renderRatingChartFrame(frame, [], locale);
  return frame;
}

// SVG viewBox geometry for the rating graph. The plot area leaves room on the
// right for y-axis rating labels and a strip at the bottom for date labels.
const CHART_W = 600;
const CHART_H = 232;
const CHART_X0 = 14;
const CHART_X1 = 556;
const CHART_Y0 = 18;
const CHART_Y1 = 194;

function renderRatingChartFrame(
  frame: HTMLElement,
  points: ProfileRatingHistoryPoint[],
  locale: Locale = currentLocale(),
): void {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', `0 0 ${CHART_W} ${CHART_H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('profile.ratingHistory', {}, locale));

  // Five evenly spaced horizontal gridlines span the plot rows.
  const gridRows = 4;
  for (let i = 0; i <= gridRows; i += 1) {
    const y = CHART_Y0 + ((CHART_Y1 - CHART_Y0) * i) / gridRows;
    const line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', String(CHART_X0));
    line.setAttribute('x2', String(CHART_X1));
    line.setAttribute('y1', y.toFixed(1));
    line.setAttribute('y2', y.toFixed(1));
    line.setAttribute('class', 'profile-rating-chart-grid');
    svg.append(line);
  }

  if (points.length > 0) {
    const samples = [
      { rating: points[0]!.ratingBefore, endedAt: points[0]!.endedAt },
      ...points.map((point) => ({ rating: point.ratingAfter, endedAt: point.endedAt })),
    ];
    const ratings = samples.map((sample) => sample.rating);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const padding = Math.max(16, Math.round((maxRating - minRating) * 0.2));
    const yMin = minRating - padding;
    const yMax = maxRating + padding;
    const denominator = Math.max(1, samples.length - 1);
    const yRange = Math.max(1, yMax - yMin);
    const coords = samples.map((sample, index) => ({
      x: CHART_X0 + ((CHART_X1 - CHART_X0) * index) / denominator,
      y: CHART_Y1 - ((sample.rating - yMin) / yRange) * (CHART_Y1 - CHART_Y0),
    }));

    const pointsAttr = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

    // Gradient area fill under the line (a unique id per render so multiple
    // charts never collide on the same def).
    chartGradientSeq += 1;
    const gradientId = `profile-chart-fill-${chartGradientSeq}`;
    const defs = document.createElementNS(svgNs, 'defs');
    const gradient = document.createElementNS(svgNs, 'linearGradient');
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '0');
    gradient.setAttribute('y2', '1');
    for (const [offset, cls] of [
      ['0', 'profile-rating-chart-fill-top'],
      ['1', 'profile-rating-chart-fill-bottom'],
    ] as const) {
      const stop = document.createElementNS(svgNs, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('class', cls);
      gradient.append(stop);
    }
    defs.append(gradient);
    svg.append(defs);

    const area = document.createElementNS(svgNs, 'polygon');
    area.setAttribute('class', 'profile-rating-chart-area');
    area.setAttribute('fill', `url(#${gradientId})`);
    area.setAttribute('points', `${CHART_X0},${CHART_Y1} ${pointsAttr} ${CHART_X1},${CHART_Y1}`);
    svg.append(area);

    const ratingLine = document.createElementNS(svgNs, 'polyline');
    ratingLine.setAttribute('class', 'profile-rating-chart-line');
    ratingLine.setAttribute('points', pointsAttr);
    svg.append(ratingLine);

    // Dots on every sample when the series is short; only the latest when long,
    // so a busy history stays a clean line.
    const showAllDots = coords.length <= 16;
    coords.forEach((coord, index) => {
      if (!showAllDots && index !== coords.length - 1) return;
      const dot = document.createElementNS(svgNs, 'circle');
      dot.setAttribute('class', 'profile-rating-chart-dot');
      dot.setAttribute('cx', coord.x.toFixed(1));
      dot.setAttribute('cy', coord.y.toFixed(1));
      dot.setAttribute('r', index === coords.length - 1 ? '4' : '3');
      svg.append(dot);
    });

    // Right-edge rating labels at top / middle / bottom of the plotted range.
    for (const [rating, y] of [
      [maxRating, CHART_Y0],
      [Math.round((maxRating + minRating) / 2), (CHART_Y0 + CHART_Y1) / 2],
      [minRating, CHART_Y1],
    ] as const) {
      const tick = document.createElementNS(svgNs, 'text');
      tick.setAttribute('class', 'profile-rating-chart-label');
      tick.setAttribute('x', String(CHART_X1 + 6));
      tick.setAttribute('y', (y + 4).toFixed(1));
      tick.textContent = String(rating);
      svg.append(tick);
    }

    // First and last dates along the bottom axis.
    const first = chartAxisDate(samples[0]!.endedAt, locale);
    const last = chartAxisDate(samples[samples.length - 1]!.endedAt, locale);
    if (first) svg.append(chartDateLabel(svgNs, CHART_X0, first, 'start'));
    if (last && samples.length > 1) {
      svg.append(chartDateLabel(svgNs, CHART_X1, last, 'end'));
    }
  }

  const empty = document.createElement('span');
  empty.className = 'profile-rating-chart-empty';
  empty.textContent = t('profile.noRatingHistory', {}, locale);

  frame.replaceChildren(svg, ...(points.length === 0 ? [empty] : []));
}

function chartAxisDate(value: string | undefined, locale: Locale): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function chartDateLabel(
  svgNs: string,
  x: number,
  label: string,
  anchor: 'start' | 'end',
): SVGTextElement {
  const text = document.createElementNS(svgNs, 'text') as SVGTextElement;
  text.setAttribute('class', 'profile-rating-chart-axis');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(CHART_H - 8));
  text.setAttribute('text-anchor', anchor);
  text.textContent = label;
  return text;
}

// Activity and Games are the primary profile tabs. A profile owner gets a
// second-level Games / Saved switch inside Games, mirroring the way Lichess
// keeps bookmarks under its games area instead of making them a peer of
// Activity.
// The profile's tab block, plus a handle to re-scope the Games panel.
//
// `setGamesVariant` exists because the rating rail lives OUTSIDE this block: the
// tabs used to be built once inline and dropped, so nothing could re-render them
// and picking a variant left the games list showing every variant.
type ProfileTabsHandle = { el: HTMLElement; setGamesVariant(variant: ProfileRatingVariant): void };

function buildProfileTabs(
  profile: UserProfile,
  locale: Locale = currentLocale(),
): ProfileTabsHandle {
  const activityPanel = buildProfileActivity(profile, locale);
  let gamesVariant: ProfileRatingVariant | null = null;
  let gamesPanel = buildProfileGames(profile, locale, null);
  const saved = profile.isViewer ? buildSavedGamesPanel(locale) : null;
  const gamesGroup = document.createElement('section');
  gamesGroup.className = 'profile-games-group';
  activityPanel.id = `profile-activity-${profile.user.handle}`;
  gamesGroup.id = `profile-games-${profile.user.handle}`;
  gamesPanel.id = `profile-games-all-${profile.user.handle}`;
  if (saved) saved.panel.id = `profile-saved-${profile.user.handle}`;
  if (saved) saved.panel.hidden = true;

  let loadSaved: (() => void) | null = null;
  // Set when the viewer's own profile renders the All-games / Saved sub-tabs.
  let setAllGamesCount: (total: number) => void = () => {};
  if (saved) {
    const gameSubtabs = document.createElement('div');
    gameSubtabs.className = 'profile-games-subtab-list';
    gameSubtabs.setAttribute('role', 'tablist');
    gameSubtabs.setAttribute('aria-label', t('profile.games', {}, locale));
    const allGamesSubtab = buildProfileGamesSubtab(
      t('profile.games', {}, locale),
      gamesPanel.id,
      true,
      profile.gamesTotal,
    );
    const savedSubtab = buildProfileGamesSubtab(
      t('profile.savedGames', {}, locale),
      saved.panel.id,
      false,
    );
    const activateGamesSubtab = (button: HTMLButtonElement, panel: HTMLElement) => {
      for (const subtab of [allGamesSubtab, savedSubtab]) {
        subtab.setAttribute('aria-selected', String(subtab === button));
      }
      gamesPanel.hidden = panel !== gamesPanel;
      saved.panel.hidden = panel !== saved.panel;
    };
    setAllGamesCount = (total) => setProfileGamesSubtabCount(allGamesSubtab, total);
    allGamesSubtab.addEventListener('click', () => activateGamesSubtab(allGamesSubtab, gamesPanel));
    savedSubtab.addEventListener('click', () => activateGamesSubtab(savedSubtab, saved.panel));
    gameSubtabs.append(allGamesSubtab, savedSubtab);
    gamesGroup.append(gameSubtabs, gamesPanel, saved.panel);
    loadSaved = () => {
      void saved.load((total) => setProfileGamesSubtabCount(savedSubtab, total));
    };
  } else {
    gamesGroup.append(gamesPanel);
  }

  // A visible, clearable chip. Without it the list would silently be a subset --
  // the same "is this filtered or broken?" ambiguity this change is fixing.
  const filterBar = document.createElement('div');
  filterBar.className = 'profile-games-filter';
  filterBar.hidden = true;
  const filterLabel = document.createElement('span');
  filterLabel.className = 'profile-games-filter-label';
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'profile-games-filter-clear';
  clearButton.textContent = t('profile.showAllGames', {}, locale);
  filterBar.append(filterLabel, clearButton);

  const renderGames = (variant: ProfileRatingVariant | null) => {
    gamesVariant = variant;
    const next = buildProfileGames(profile, locale, variant, setAllGamesCount);
    next.id = gamesPanel.id;
    next.hidden = gamesPanel.hidden;
    gamesPanel.replaceWith(next);
    gamesPanel = next;
    filterBar.hidden = variant === null;
    if (variant) filterLabel.textContent = profileVariantLabel(variant, locale);
  };
  clearButton.addEventListener('click', () => {
    renderGames(null);
    setAllGamesCount(profile.gamesTotal);
  });
  gamesGroup.prepend(filterBar);

  const shellEl = buildProfileTabsShell([
    { label: t('profile.activity', {}, locale), panel: activityPanel },
    {
      // The badge stays the LIFETIME total: it labels the tab ("you have N
      // games"), while the chip above the list says what is currently shown.
      label: t('profile.games', {}, locale),
      panel: gamesGroup,
      count: profile.gamesTotal > 0 ? profile.gamesTotal : undefined,
      onActivate: () => loadSaved?.(),
    },
  ]);

  return {
    el: shellEl,
    setGamesVariant: (variant) => {
      if (variant !== gamesVariant) renderGames(variant);
    },
  };
}

function setProfileGamesSubtabCount(button: HTMLButtonElement, count: number): void {
  const existing = button.querySelector<HTMLElement>('.profile-games-subtab-count');
  if (existing) {
    existing.textContent = String(count);
    return;
  }
  const badge = document.createElement('span');
  badge.className = 'profile-games-subtab-count';
  badge.textContent = String(count);
  button.prepend(badge, document.createTextNode(' '));
}

function buildSavedGamesPanel(locale: Locale): {
  panel: HTMLElement;
  load(onTotal: (total: number) => void): Promise<void>;
} {
  const panel = document.createElement('section');
  panel.className = 'profile-games profile-saved-games';
  const status = document.createElement('p');
  status.className = 'landing-games-empty';
  status.textContent = t('profile.loading', {}, locale);
  panel.append(status);

  let loaded = false;
  const load = async (onTotal: (total: number) => void): Promise<void> => {
    if (loaded) return;
    loaded = true;
    let firstPage: { games: FeaturedGame[]; total: number };
    try {
      firstPage = await fetchFavoriteGamesPage(0, FAVORITE_GAMES_PAGE);
    } catch {
      loaded = false;
      status.textContent = t('profile.loadFailedBody', {}, locale);
      return;
    }
    onTotal(firstPage.total);
    if (firstPage.games.length === 0) {
      status.textContent = t('profile.noSavedGames', {}, locale);
      return;
    }

    const list = document.createElement('ol');
    list.className = 'profile-game-list';
    const appendGames = (games: FeaturedGame[]): void => {
      for (const game of games) list.append(buildProfileGameRow(game, { locale, neutral: true }));
    };
    appendGames(firstPage.games);
    panel.replaceChildren(list);

    let rendered = firstPage.games.length;
    if (rendered >= firstPage.total) return;
    const moreWrap = document.createElement('div');
    moreWrap.className = 'profile-games-more';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-games-more-btn';
    button.textContent = t('profile.loadMore', {}, locale);
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = t('profile.loadingMore', {}, locale);
      try {
        const page = await fetchFavoriteGamesPage(rendered, FAVORITE_GAMES_PAGE);
        appendGames(page.games);
        rendered += page.games.length;
        onTotal(page.total);
        if (rendered >= page.total || page.games.length === 0) {
          moreWrap.remove();
        } else {
          button.disabled = false;
          button.textContent = t('profile.loadMore', {}, locale);
        }
      } catch {
        button.disabled = false;
        button.textContent = t('profile.loadMore', {}, locale);
      }
    });
    moreWrap.append(button);
    panel.append(moreWrap);
  };
  return { panel, load };
}

async function fetchFavoriteGamesPage(
  offset: number,
  limit: number,
): Promise<{ games: FeaturedGame[]; total: number }> {
  const response = await fetch(`/api/games/favorites?offset=${offset}&limit=${limit}`);
  if (!response.ok) throw new Error(`failed to load saved games: ${response.status}`);
  return (await response.json()) as { games: FeaturedGame[]; total: number };
}

function buildProfileGamesSubtab(
  label: string,
  controls: string,
  selected: boolean,
  count?: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'profile-games-subtab';
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-controls', controls);
  button.setAttribute('aria-selected', String(selected));
  if (count != null) {
    const badge = document.createElement('span');
    badge.className = 'profile-games-subtab-count';
    badge.textContent = String(count);
    button.append(badge, document.createTextNode(' '));
  }
  const text = document.createElement('span');
  text.className = 'profile-games-subtab-label';
  text.textContent = label;
  button.append(text);
  return button;
}

type ProfileActivitySummary = {
  key: string;
  day: string;
  variant: string;
  count: number;
  wins: number;
  losses: number;
  draws: number;
};

function buildProfileActivity(profile: UserProfile, locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-activity-panel';
  // No heading: the Activity tab is this panel's label.

  if (profile.games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'landing-games-empty';
    empty.textContent = t('profile.noAccountGames', {}, locale);
    section.append(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'profile-activity-summary-list';
  for (const summary of profileActivitySummaries(profile.games, locale)) {
    list.append(buildProfileActivitySummaryRow(summary, locale));
  }
  section.append(list);
  return section;
}

function profileActivitySummaries(
  games: FeaturedGame[],
  locale: Locale = currentLocale(),
): ProfileActivitySummary[] {
  const summaries = new Map<string, ProfileActivitySummary>();
  for (const game of games) {
    const day = dayLabel(game.endedAt, locale);
    const variant = profileGameSpecLabel(game, locale);
    const key = `${day}\0${variant}`;
    let summary = summaries.get(key);
    if (!summary) {
      summary = { key, day, variant, count: 0, wins: 0, losses: 0, draws: 0 };
      summaries.set(key, summary);
    }
    summary.count += 1;
    const tone = profileResultTone(game);
    if (tone === 'win') summary.wins += 1;
    else if (tone === 'loss') summary.losses += 1;
    else summary.draws += 1;
  }
  return [...summaries.values()];
}

function buildProfileActivitySummaryRow(
  summary: ProfileActivitySummary,
  locale: Locale = currentLocale(),
): HTMLElement {
  const item = document.createElement('li');
  item.className = 'profile-activity-summary-row';

  const marker = document.createElement('span');
  marker.className = 'profile-activity-summary-marker';
  marker.setAttribute('aria-hidden', 'true');

  const body = document.createElement('span');
  body.className = 'profile-activity-summary-body';

  const day = document.createElement('span');
  day.className = 'profile-activity-summary-day';
  day.textContent = summary.day;

  const title = document.createElement('span');
  title.className = 'profile-activity-summary-title';
  title.textContent = t(
    summary.count === 1 ? 'profile.activityPlayedOne' : 'profile.activityPlayedMany',
    { count: summary.count, variant: summary.variant },
    locale,
  );
  body.append(day, title);

  const record = document.createElement('span');
  record.className = 'profile-activity-record';
  if (summary.wins > 0)
    record.append(buildProfileRecordPill(summary.wins, t('result.win', {}, locale), 'win'));
  if (summary.draws > 0) {
    record.append(buildProfileRecordPill(summary.draws, t('result.draw', {}, locale), 'draw'));
  }
  if (summary.losses > 0) {
    record.append(buildProfileRecordPill(summary.losses, t('result.loss', {}, locale), 'loss'));
  }

  item.append(marker, body, record);
  return item;
}

function buildProfileRecordPill(
  count: number,
  label: string,
  tone: 'win' | 'loss' | 'draw',
): HTMLElement {
  const pill = document.createElement('span');
  pill.className = `profile-record-pill profile-record-pill-${tone}`;
  pill.textContent = `${count} ${label.toLowerCase()}`;
  return pill;
}

// Most-played variant (rated or casual) by total completed games, with its
// variant marker for the stat tile.
function topVariantStat(
  ratings: ProfileBucketRating[],
  locale: Locale = currentLocale(),
): { label: string; miniId: VariantMiniId | null } | null {
  let top: ProfileBucketRating | null = null;
  for (const r of ratings) {
    if (r.totalGamesPlayed <= 0) continue;
    if (!top || r.totalGamesPlayed > top.totalGamesPlayed) top = r;
  }
  if (!top) return null;
  return {
    label: profileVariantLabel(top.variant, locale),
    miniId: variantMiniIdForRating(top.variant),
  };
}

// Highest current rating across rated variants, or null if none are rated.
function bestRating(ratings: ProfileBucketRating[]): number | null {
  let best: number | null = null;
  for (const r of ratings) {
    if (r.eloRating == null || r.ratedGamesPlayed <= 0) continue;
    if (best == null || r.eloRating > best) best = r.eloRating;
  }
  return best;
}

function buildRoleBadge(
  role: UserProfile['user']['accountRole'],
  locale: Locale = currentLocale(),
): HTMLElement | null {
  if (role === 'admin') {
    const badge = document.createElement('span');
    badge.className = 'profile-role-badge profile-role-admin';
    badge.textContent = t('profile.admin', {}, locale);
    return badge;
  }
  return null;
}

// Cosmetic Patron badge (the mist-heart icon): shown when the account has an active
// donation. Purely a thank-you; carries no gameplay meaning. Links to /patron.
function buildPatronBadge(
  patronSince: string | null | undefined,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  if (!patronSince) return null;
  const badge = document.createElement('a');
  badge.className = 'profile-role-badge profile-role-patron';
  badge.href = '/patron';
  badge.title = t('profile.patronTitle', {}, locale);
  const icon = document.createElement('span');
  icon.className = 'profile-patron-icon';
  icon.setAttribute('aria-hidden', 'true');
  badge.append(icon, document.createTextNode(t('profile.patron', {}, locale)));
  return badge;
}

// Full join date for the side column (lichess "Member since May 28, 2023").
function formatJoinedFull(
  value: string | undefined,
  locale: Locale = currentLocale(),
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

// Local calendar day used to group activity rows under one header.
function dayKey(value: string | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string | undefined, locale: Locale = currentLocale()): string {
  if (!value) return t('profile.earlier', {}, locale);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('profile.earlier', {}, locale);
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, { dateStyle: 'medium' }).format(
    date,
  );
}

export function buildProfileRatings(
  ratings: ProfileBucketRating[],
  locale: Locale = currentLocale(),
  opts: {
    selectedVariant?: ProfileRatingVariant;
    onSelect?: (variant: ProfileRatingVariant, timeClass: ProfileRatingTimeClass) => void;
  } = {},
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-ratings';

  // The rail carries no visible heading (lichess parity: the rows read as the
  // whole rail). A visually-hidden heading keeps the landmark labelled.
  const heading = document.createElement('h2');
  heading.className = 'profile-ratings-heading';
  heading.textContent = t('profile.ratings', {}, locale);
  section.append(heading);

  const variantsShown = orderedProfileVariants(ratings);

  if (variantsShown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'profile-ratings-empty';
    empty.textContent = t('profile.noRatedGames', {}, locale);
    section.append(empty);
    return section;
  }

  const rail = document.createElement('div');
  rail.className = 'profile-ratings-rail';

  for (const variant of variantsShown) {
    rail.append(buildRatingRailRow(ratings, variant, locale, opts));
  }

  section.append(rail);
  return section;
}

function timeClassLabel(timeClass: ProfileRatingTimeClass): string {
  return LEADERBOARD_TIME_CLASSES.find((pace) => pace.id === timeClass)?.label ?? timeClass;
}

// The pace a variant's rating surfaces default to for this player: the default
// ladder when they have played it, otherwise whichever rated pace they have
// played most, otherwise the activity row (casual/correspondence games, which
// belong to no ladder). Deterministic tie-break so the rail and the graph agree.
function preferredBucketForVariant(
  ratings: ProfileBucketRating[],
  variant: ProfileRatingVariant,
): ProfileBucketRating | undefined {
  const forVariant = ratings.filter((rating) => rating.variant === variant);
  const rated = forVariant.filter(
    (rating) => rating.eloRating != null && rating.ratedGamesPlayed > 0,
  );
  const preferred = rated.find((rating) => rating.timeClass === DEFAULT_LEADERBOARD_TIME_CLASS);
  if (preferred) return preferred;
  const mostPlayed = [...rated].sort(
    (a, b) =>
      b.ratedGamesPlayed - a.ratedGamesPlayed ||
      LEADERBOARD_TIME_CLASSES.findIndex((pace) => pace.id === a.timeClass) -
        LEADERBOARD_TIME_CLASSES.findIndex((pace) => pace.id === b.timeClass),
  )[0];
  return mostPlayed ?? forVariant[0];
}

// Rail order: the shared canonical registry order (xiangqi first), same as the
// leaderboard and picker. The earlier per-subject activity ordering (#137,
// played-most-first) was reverted 2026-07-10: every rating surface reads in
// one order, and played rows already stand out because never-played rows dim.
function orderedProfileVariants(_ratings: ProfileBucketRating[]): ProfileRatingVariant[] {
  return [...PROFILE_VARIANT_ORDER];
}

// Puzzle-variant display names (the values are GameSpecIds from the puzzle pool,
// which are not the game RatingVariant keys, so they get their own small map).
const PUZZLE_VARIANT_LABELS: Record<string, string> = {
  xiangqi: 'Xiangqi',
  'fortress-xiangqi': 'Fortress Xiangqi',
  jungle: 'Jungle',
  'mini-xiangqi': 'Mini Xiangqi',
};

const HIDDEN_PROFILE_PUZZLE_VARIANTS: ReadonlySet<string> = new Set([
  FORTRESS_XIANGQI_SPEC_ID,
  JUNGLE_SPEC_ID,
]);

function puzzleVariantLabel(variant: string): string {
  return (
    PUZZLE_VARIANT_LABELS[variant] ??
    variant
      .split('-')
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(' ')
  );
}

// Append a "Puzzles" block to the ratings column: one row per variant the user
// has attempted, showing the Glicko rating (with a "?" while provisional) and
// the solved count. No-op when the user has no puzzle history, so the block only
// appears once there is something to show.
function appendProfilePuzzleRatings(
  section: HTMLElement,
  puzzleRatings: ProfilePuzzleRating[],
  locale: Locale,
): void {
  const visibleRatings = puzzleRatings.filter(
    (entry) => !HIDDEN_PROFILE_PUZZLE_VARIANTS.has(entry.variant),
  );
  if (visibleRatings.length === 0) return;

  const block = document.createElement('div');
  block.className = 'profile-puzzle-ratings';

  const heading = document.createElement('h2');
  heading.textContent = t('nav.puzzles', {}, locale);
  block.append(heading);

  const rail = document.createElement('div');
  rail.className = 'profile-puzzle-rail';

  for (const entry of visibleRatings) {
    const row = document.createElement('div');
    row.className = 'profile-puzzle-row';

    const name = document.createElement('span');
    name.className = 'profile-puzzle-name';
    name.textContent = puzzleVariantLabel(entry.variant);

    const value = document.createElement('span');
    value.className = 'profile-puzzle-value';
    value.textContent = String(entry.rating);
    if (entry.provisional) {
      const q = document.createElement('span');
      q.className = 'profile-rating-q';
      q.textContent = '?';
      value.append(q);
    }

    const solved = document.createElement('span');
    solved.className = 'profile-puzzle-games';
    solved.textContent = t('profile.puzzleSolved', { count: entry.solved }, locale);

    row.append(name, value, solved);
    rail.append(row);
  }

  block.append(rail);
  section.append(block);
}

// One variant row in the ratings rail: compact mini-board beside its name,
// rating, and games count.
// Never-played / unrated variants dim back so the rail reads as intentional.
function buildRatingRailRow(
  ratings: ProfileBucketRating[],
  variant: ProfileRatingVariant,
  locale: Locale = currentLocale(),
  opts: {
    selectedVariant?: ProfileRatingVariant;
    onSelect?: (variant: ProfileRatingVariant, timeClass: ProfileRatingTimeClass) => void;
  } = {},
): HTMLButtonElement {
  // One row per variant, not per (variant, pace): 17 variants times three
  // paces would bury the rail. The row shows the player's primary pace for
  // that variant and names it when it is not the default one.
  const bucket = preferredBucketForVariant(ratings, variant);
  const timeClass = bucket?.timeClass ?? DEFAULT_LEADERBOARD_TIME_CLASS;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'profile-rating-row';
  row.dataset.variant = variant;
  row.dataset.timeClass = timeClass;
  row.setAttribute('aria-pressed', String(opts.selectedVariant === variant));
  if (opts.selectedVariant === variant) row.classList.add('profile-rating-row-selected');
  row.addEventListener('click', () => opts.onSelect?.(variant, timeClass));

  // "Rated" hinges on the rating itself, not the total games count: a rated
  // player always has rated games, so this is the correct (and demo-safe) gate.
  const isRated = bucket != null && bucket.eloRating != null && bucket.ratedGamesPlayed > 0;
  // Only never-played variants dim back: casual activity is still a record, and
  // activity ordering floats played rows to the top of the rail.
  const isPlayed = bucket != null && bucket.totalGamesPlayed > 0;
  if (!isRated && !isPlayed) row.classList.add('profile-rating-row-empty');

  const miniId = variantMiniIdForRating(variant);
  if (miniId) {
    row.append(
      buildVariantThumb(
        miniId,
        32,
        'profile-rating-thumb',
        t('profile.variantBoard', { variant: profileVariantLabel(variant, locale) }, locale),
      ),
    );
  }

  const meta = document.createElement('div');
  meta.className = 'profile-rating-meta';

  const name = document.createElement('span');
  name.className = 'profile-rating-name';
  name.textContent = profileVariantLabel(variant, locale);
  // Naming the pace only when it is not the default keeps the common row
  // unchanged while making a bullet-only or rapid-only rating legible.
  if (bucket && bucket.ratedGamesPlayed > 0 && timeClass !== DEFAULT_LEADERBOARD_TIME_CLASS) {
    const pace = document.createElement('span');
    pace.className = 'profile-rating-pace';
    pace.textContent = timeClassLabel(timeClass);
    name.append(' ', pace);
  }
  meta.append(name);

  // Rating and games count share one line (lichess rail idiom).
  const figures = document.createElement('span');
  figures.className = 'profile-rating-figures';

  const value = document.createElement('span');
  value.className = 'profile-rating-value';

  if (bucket != null && bucket.eloRating != null && bucket.ratedGamesPlayed > 0) {
    value.textContent = String(bucket.eloRating);
    if (bucket.provisional) {
      // "?" marks a provisional rating (still settling). RD itself is not shown.
      const q = document.createElement('span');
      q.className = 'profile-rating-q';
      q.textContent = '?';
      value.append(q);
    }
    figures.append(value);

    const count = document.createElement('span');
    count.className = 'profile-rating-games';
    count.textContent = t(
      bucket.ratedGamesPlayed === 1 ? 'profile.ratedGameOne' : 'profile.ratedGameMany',
      { count: bucket.ratedGamesPlayed },
      locale,
    );
    figures.append(count);
  } else if (bucket != null && bucket.totalGamesPlayed > 0) {
    value.textContent = t('profile.unrated', {}, locale);
    value.classList.add('profile-rating-value-unrated');
    figures.append(value);

    // Casual activity still counts as a record: show the total games figure the
    // same way rated rows show their rated-games figure.
    const count = document.createElement('span');
    count.className = 'profile-rating-games';
    count.textContent = `${bucket.totalGamesPlayed} ${t(
      bucket.totalGamesPlayed === 1 ? 'profile.gameSingular' : 'profile.gamePlural',
      {},
      locale,
    ).toLowerCase()}`;
    figures.append(count);
  } else {
    value.textContent = '—';
    value.classList.add('profile-rating-value-empty');
    figures.append(value);
  }

  meta.append(figures);
  row.append(meta);

  // Trailing chevron (lichess rail affordance: the row opens that variant's
  // graph in the overview).
  const chevron = document.createElement('span');
  chevron.className = 'profile-rating-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  row.append(chevron);

  return row;
}

function syncSelectedRating(section: HTMLElement, variant: ProfileRatingVariant): void {
  for (const row of section.querySelectorAll<HTMLElement>('.profile-rating-row')) {
    const selected = row.dataset.variant === variant;
    row.classList.toggle('profile-rating-row-selected', selected);
    row.setAttribute('aria-pressed', String(selected));
  }
}

// Day-grouped game rows appended into `list`. The day cursor lives with the
// closure so an appended "Load more" page that continues the same day does not
// repeat its header.
function profileGameAppender(list: HTMLElement, locale: Locale): (games: FeaturedGame[]) => void {
  let lastDay = '';
  return (games: FeaturedGame[]) => {
    for (const game of games) {
      const day = dayKey(game.endedAt);
      if (day !== lastDay) {
        lastDay = day;
        const header = document.createElement('li');
        header.className = 'profile-activity-day';
        header.textContent = dayLabel(game.endedAt, locale);
        list.append(header);
      }
      list.append(buildProfileGameRow(game, { timeOnly: true, locale }));
    }
  };
}

// A "Load more" control for a games list, wired to one page fetch. Shared so the
// filtered and unfiltered panels page identically -- including the exhaustion
// rule, which reads the FILTERED total the server returns.
function profileGamesMore(
  handle: string,
  locale: Locale,
  variant: ProfileRatingVariant | null,
  startRendered: number,
  appendGames: (games: FeaturedGame[]) => void,
): HTMLElement {
  let rendered = startRendered;
  const moreWrap = document.createElement('div');
  moreWrap.className = 'profile-games-more';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'profile-games-more-btn';
  button.textContent = t('profile.loadMore', {}, locale);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = t('profile.loadingMore', {}, locale);
    const page = await fetchUserGamesPage(handle, rendered, PROFILE_GAMES_PAGE, variant).catch(
      (err) => {
        console.warn(err);
        return null;
      },
    );
    if (!page) {
      button.disabled = false;
      button.textContent = t('profile.loadMore', {}, locale);
      return;
    }
    appendGames(page.games);
    rendered += page.games.length;
    if (rendered >= page.total || page.games.length === 0) {
      moreWrap.remove();
    } else {
      button.disabled = false;
      button.textContent = t('profile.loadMore', {}, locale);
    }
  });
  moreWrap.append(button);
  return moreWrap;
}

// The Games panel scoped to one pool. Renders immediately with a placeholder so
// the click feels instant, then fills in from the server-filtered first page.
function buildFilteredProfileGames(
  profile: UserProfile,
  locale: Locale,
  variant: ProfileRatingVariant,
  // Reports the FILTERED total once it lands, so counts rendered outside this
  // panel (the All-games sub-tab) follow the list instead of sitting on the
  // lifetime figure above a shorter list.
  onTotal?: (total: number) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'profile-games';

  const body = document.createElement('div');
  const loading = document.createElement('p');
  loading.className = 'landing-games-empty';
  loading.textContent = t('profile.loadingMore', {}, locale);
  body.append(loading);
  section.append(body);

  void (async () => {
    const page = await fetchUserGamesPage(
      profile.user.handle,
      0,
      PROFILE_GAMES_PAGE,
      variant,
    ).catch((err) => {
      console.warn(err);
      return null;
    });
    body.replaceChildren();
    onTotal?.(page?.total ?? 0);
    if (!page || page.games.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'landing-games-empty';
      // Names the variant: a bare "no games" under a variant selector reads as
      // "this player has never played", which is a different claim.
      empty.textContent = t(
        'profile.noVariantGames',
        { variant: profileVariantLabel(variant, locale) },
        locale,
      );
      body.append(empty);
      return;
    }
    const list = document.createElement('ol');
    list.className = 'profile-game-list profile-activity';
    const appendGames = profileGameAppender(list, locale);
    appendGames(page.games);
    body.append(list);
    if (page.games.length < page.total) {
      body.append(
        profileGamesMore(profile.user.handle, locale, variant, page.games.length, appendGames),
      );
    }
  })();

  return section;
}

// The Games panel, optionally scoped to one rating pool.
//
// `variant` null renders the profile's own first page with no fetch (the common
// case, and what the initial mount does). A pool renders a placeholder and then
// swaps in the server-filtered first page: the list is paginated, so the filter
// has to be a query, not a client-side narrowing of a page that may not contain
// the pool's games at all.
function buildProfileGames(
  profile: UserProfile,
  locale: Locale = currentLocale(),
  variant: ProfileRatingVariant | null = null,
  onTotal?: (total: number) => void,
): HTMLElement {
  if (variant) return buildFilteredProfileGames(profile, locale, variant, onTotal);
  const section = document.createElement('section');
  section.className = 'profile-games';
  // No heading: the Games tab (with its count) is this panel's label.

  if (profile.gamesTotal === 0) {
    const empty = document.createElement('p');
    empty.className = 'landing-games-empty';
    empty.textContent = t('profile.noAccountGames', {}, locale);
    section.append(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'profile-game-list profile-activity';
  const appendGames = profileGameAppender(list, locale);
  appendGames(profile.games);
  section.append(list);

  if (profile.games.length >= profile.gamesTotal) return section;
  section.append(
    profileGamesMore(profile.user.handle, locale, null, profile.games.length, appendGames),
  );
  return section;
}

function profileVariantLabel(
  variant: ProfileRatingVariant,
  locale: Locale = currentLocale(),
): string {
  return t(PROFILE_VARIANT_LABEL_KEY[variant], {}, locale);
}

async function fetchUserGamesPage(
  handle: string,
  offset: number,
  limit: number,
  variant: ProfileRatingVariant | null = null,
): Promise<{ games: FeaturedGame[]; total: number } | null> {
  // `total` comes back scoped to the same filter, so callers can page a filtered
  // list without tracking two different totals.
  const query = variant ? `&variant=${encodeURIComponent(variant)}` : '';
  const resp = await fetch(
    `/api/users/${encodeURIComponent(handle)}/games?offset=${offset}&limit=${limit}${query}`,
  );
  if (!resp.ok) throw new Error(`failed to load games: ${resp.status}`);
  return (await resp.json()) as { games: FeaturedGame[]; total: number };
}
