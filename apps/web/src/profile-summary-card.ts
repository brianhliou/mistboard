// Compact player/bot profile summary shared by inline directory cards and the
// singleton hover popover. Subject-specific identity and actions fork inside
// one renderer contract; sizing/positioning belong to the host.

import './profile-summary-card.css';
import { maybeGameSpecForId, type RatingVariant } from '@mistboard/game';
import { bindBotPlayControl } from './bot-play.js';
import { openChallengeDialog } from './challenge-dialog.js';
import { correspondenceEnabled } from './feature-flags.js';
import { buildFlairIconIfSet } from './flair.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { buildTitleBadge } from './player-titles.js';
import { renderVariantMarker } from './variant-markers.js';
import {
  ratingVariantLabel,
  variantMiniIdForRating,
  variantMiniIdForRawVariant,
} from './variants.js';

type ProfileBucketRating = {
  variant: RatingVariant;
  timeClass: 'bullet' | 'blitz' | 'rapid';
  eloRating: number | null;
  ratedGamesPlayed: number;
  totalGamesPlayed: number;
  provisional: boolean;
};

type UserCardRelation = { following: boolean; blocked: boolean };

// The subset of GET /api/users/:handle/profile the card renders.
export type UserCardProfile = {
  isViewer?: boolean;
  relation?: UserCardRelation | null;
  user: {
    handle: string;
    displayName: string;
    accountRole: 'player' | 'admin';
    // Verified title key ('xgm', 'gm', ...); absent/null = untitled. Unknown
    // values render no badge (fail-closed in player-titles.ts).
    title?: string | null;
    flair?: string | null;
    createdAt: string;
  };
  ratings: ProfileBucketRating[];
  gamesTotal: number;
};

// Liveness the card can't learn from the profile fetch (presence lives in the
// online lists), so the caller passes what it knows.
export type UserCardLiveness = { online?: boolean; playing?: boolean };

export type BotSummaryPlayOption = {
  gameSpecId: string;
  engineId: string;
  playable: boolean;
};

export type BotSummaryRating = {
  gameSpecId: string;
  timeClass: 'bullet' | 'blitz' | 'rapid';
  rating: number;
  games: number;
  provisional: boolean;
};

export type BotSummaryProfile = {
  id: string;
  displayName: string;
  bio: string;
  ownerType: 'system' | 'user';
  defaultGameSpecId: string;
  activeEngineId: string;
  supportedGameSpecIds: string[];
  playOptions?: BotSummaryPlayOption[];
  gamesTotal: number;
  record: { games: number; wins: number; losses: number; draws: number };
  rating?: BotSummaryRating | null;
  ratings?: BotSummaryRating[];
};

// How many rated variants the compact grid shows before it stops (a hover card
// should not grow into a full ratings rail). Highest-rated first.
const MAX_RATING_TILES = 6;
const GAME_SPEC_LABEL_KEYS: Record<string, I18nKey> = {
  'dark-chess': 'variant.darkChess.name',
  jieqi: 'variant.jieqi.name',
  banqi: 'variant.banqi.name',
  'fortress-xiangqi': 'variant.fortressXiangqi.name',
};

// ── card body ───────────────────────────────────────────────────────────────

export function buildUserCard(
  profile: UserCardProfile,
  live: UserCardLiveness = {},
  locale: Locale = currentLocale(),
): HTMLElement {
  const card = buildCardShell('user');

  card.append(buildHeader(profile, live, locale));

  const grid = buildRatingGrid(profile.ratings);
  if (grid) card.append(grid);

  if (!profile.isViewer && profile.relation) {
    card.append(buildActions(profile.user.handle, profile.relation, locale));
  }

  card.append(buildFooter(profile, locale));
  return card;
}

export function buildBotSummaryCard(profile: BotSummaryProfile): HTMLElement {
  const card = buildCardShell('bot');
  card.dataset.botId = profile.id;
  card.append(buildBotHeader(profile));

  if (profile.bio.trim()) {
    const bio = document.createElement('p');
    bio.className = 'profile-summary-card-bio';
    bio.textContent = profile.bio;
    card.append(bio);
  }

  const ratings = buildBotRatingGrid(profile);
  if (ratings) card.append(ratings);

  const actions = buildBotActions(profile);
  if (actions) card.append(actions);
  card.append(buildBotFooter(profile));
  return card;
}

function buildCardShell(kind: 'user' | 'bot'): HTMLElement {
  const card = document.createElement('div');
  card.className = 'profile-summary-card';
  card.dataset.subjectKind = kind;
  return card;
}

function buildHeader(
  profile: UserCardProfile,
  live: UserCardLiveness,
  locale: Locale,
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'profile-summary-card-header';

  if (live.online) {
    const dot = document.createElement('span');
    dot.className = 'profile-summary-card-dot';
    dot.setAttribute('aria-hidden', 'true');
    header.append(dot);
  }

  // Verified title flair: gold abbreviation ahead of the name, full name in
  // the tooltip (same treatment as the profile header h1).
  const titleBadge = buildTitleBadge(profile.user.title, locale);
  if (titleBadge) header.append(titleBadge);

  const name = document.createElement('a');
  name.className = 'profile-summary-card-name';
  name.href = `/@/${encodeURIComponent(profile.user.handle)}`;
  name.textContent = profile.user.displayName;
  header.append(name);

  const flair = buildFlairIconIfSet(profile.user.flair, { locale });
  if (flair) header.append(flair);

  if (profile.user.accountRole === 'admin') {
    const badge = document.createElement('span');
    badge.className = 'profile-summary-card-badge';
    badge.textContent = t('profile.admin', {}, locale);
    header.append(badge);
  }

  if (live.playing) {
    const mark = document.createElement('span');
    mark.className = 'profile-summary-card-playing';
    // Text-presentation crossed swords, so platforms don't swap in emoji.
    mark.textContent = '⚔︎';
    mark.title = t('profile.playingNow', {}, locale);
    mark.setAttribute('aria-label', t('profile.playingNow', {}, locale));
    header.append(mark);
  }

  return header;
}

function buildBotHeader(profile: BotSummaryProfile): HTMLElement {
  const header = document.createElement('div');
  header.className = 'profile-summary-card-header';

  const miniId = variantMiniIdForRawVariant(profile.defaultGameSpecId);
  if (miniId) {
    const marker = document.createElement('span');
    marker.className = 'profile-summary-card-avatar';
    marker.setAttribute('aria-hidden', 'true');
    marker.innerHTML = renderVariantMarker(miniId, {
      size: 34,
      label: gameSpecLabel(profile.defaultGameSpecId),
    });
    header.append(marker);
  }

  const identity = document.createElement('span');
  identity.className = 'profile-summary-card-identity';
  const name = document.createElement('a');
  name.className = 'profile-summary-card-name';
  name.href = `/bot/${encodeURIComponent(profile.id)}`;
  name.textContent = profile.displayName;
  const owner = document.createElement('span');
  owner.className = 'profile-summary-card-subtitle';
  owner.textContent = profile.ownerType === 'system' ? 'First-party bot' : 'Community bot';
  identity.append(name, owner);

  const badge = document.createElement('span');
  badge.className = 'profile-summary-card-badge';
  badge.textContent = 'BOT';
  header.append(identity, badge);
  return header;
}

const TIME_CLASS_LABELS: Record<'bullet' | 'blitz' | 'rapid', string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
};

// Compact rating grid: rated variants only (a "?"-provisional or settled Elo),
// highest first, each a variant marker beside its value. Returns null when the
// player has no rated variant so the card collapses cleanly instead of showing
// a dead grid.
function buildRatingGrid(ratings: ProfileBucketRating[]): HTMLElement | null {
  const rated = ratings
    .filter((r) => r.eloRating != null && r.ratedGamesPlayed > 0)
    .sort((a, b) => (b.eloRating ?? 0) - (a.eloRating ?? 0))
    .slice(0, MAX_RATING_TILES);
  if (rated.length === 0) return null;

  const grid = document.createElement('div');
  grid.className = 'profile-summary-card-ratings';

  for (const bucket of rated) {
    const tile = document.createElement('div');
    tile.className = 'profile-summary-card-rating';

    const miniId = variantMiniIdForRating(bucket.variant);
    const label = variantLabel(bucket.variant);
    if (miniId) {
      const icon = document.createElement('span');
      icon.className = 'profile-summary-card-rating-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = renderVariantMarker(miniId, { size: 20, label });
      tile.append(icon);
    }

    const value = document.createElement('span');
    value.className = 'profile-summary-card-rating-value';
    value.textContent = `${bucket.eloRating}${bucket.provisional ? '?' : ''}`;
    // A player can hold a rating in the same variant at more than one pace, so
    // the tooltip carries the pace: two tiles with the same marker are
    // otherwise indistinguishable.
    tile.title = `${label} · ${TIME_CLASS_LABELS[bucket.timeClass]}`;
    tile.append(value);

    grid.append(tile);
  }

  return grid;
}

function buildBotRatingGrid(profile: BotSummaryProfile): HTMLElement | null {
  const ratings = botRatings(profile).slice(0, MAX_RATING_TILES);
  if (ratings.length === 0) return null;

  const grid = document.createElement('div');
  grid.className = 'profile-summary-card-ratings';
  for (const rating of ratings) {
    const tile = document.createElement('div');
    tile.className = 'profile-summary-card-rating';
    const label = gameSpecLabel(rating.gameSpecId);
    const miniId = variantMiniIdForRawVariant(rating.gameSpecId);
    if (miniId) {
      const icon = document.createElement('span');
      icon.className = 'profile-summary-card-rating-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = renderVariantMarker(miniId, { size: 20, label });
      tile.append(icon);
    }
    const value = document.createElement('span');
    value.className = 'profile-summary-card-rating-value';
    value.textContent = `${new Intl.NumberFormat().format(rating.rating)}${rating.provisional ? '?' : ''}`;
    tile.title = `${label} ${timeClassLabel(rating.timeClass)}`;
    tile.append(value);
    grid.append(tile);
  }
  return grid;
}

function buildBotActions(profile: BotSummaryProfile): HTMLElement | null {
  const options = botPlayOptions(profile);
  if (options.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'profile-summary-card-actions profile-summary-card-bot-actions';
  for (const option of options) row.append(buildBotPlayControl(profile, option));
  return row;
}

function buildBotPlayControl(
  profile: BotSummaryProfile,
  option: BotSummaryPlayOption,
): HTMLElement {
  const label = gameSpecLabel(option.gameSpecId);
  if (!option.playable) {
    const control = document.createElement('span');
    control.className = 'profile-summary-card-action profile-summary-card-action-unavailable';
    control.textContent = label;
    control.title = 'Not available right now';
    return control;
  }

  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'profile-summary-card-action';
  control.textContent = label;
  bindBotPlayControl(
    control,
    () => ({ botId: profile.id, gameSpecId: option.gameSpecId, preferredColor: 'random' }),
    {
      onStateChange: (state) => {
        control.textContent =
          state === 'pending' ? 'Starting...' : state === 'error' ? 'Try again' : label;
      },
    },
  );
  return control;
}

// Minimal action row: Message + Follow/Unfollow. A blocked profile shows
// nothing actionable here (the full profile page owns block/unblock); the card
// is a lightweight surface, so it stays to the two common actions.
function buildActions(handle: string, relation: UserCardRelation, locale: Locale): HTMLElement {
  const row = document.createElement('div');
  row.className = 'profile-summary-card-actions';
  renderActions(row, handle, relation, locale);
  return row;
}

function renderActions(
  row: HTMLElement,
  handle: string,
  relation: UserCardRelation,
  locale: Locale,
): void {
  row.replaceChildren();
  if (relation.blocked) return;

  const message = document.createElement('a');
  message.className = 'profile-summary-card-action';
  message.href = `/inbox/${encodeURIComponent(handle)}`;
  message.textContent = t('profile.message', {}, locale);
  row.append(message);

  if (correspondenceEnabled()) {
    const challenge = document.createElement('button');
    challenge.type = 'button';
    challenge.className = 'profile-summary-card-action';
    challenge.textContent = t('challenge.button', {}, locale);
    challenge.addEventListener('click', () => openChallengeDialog({ handle, locale }));
    row.append(challenge);
  }

  const follow = document.createElement('button');
  follow.type = 'button';
  follow.className = relation.following
    ? 'profile-summary-card-action profile-summary-card-action-active'
    : 'profile-summary-card-action';
  follow.textContent = relation.following
    ? t('profile.unfollow', {}, locale)
    : t('profile.follow', {}, locale);
  follow.addEventListener('click', async () => {
    follow.disabled = true;
    try {
      const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, {
        method: relation.following ? 'DELETE' : 'POST',
      });
      if (!resp.ok) throw new Error(`follow toggle failed: ${resp.status}`);
      const data = (await resp.json()) as { relation: UserCardRelation };
      // Keep the shared cache in step so a re-hover reflects the new edge.
      const cached = userProfileCache.get(handle.toLowerCase());
      if (cached) {
        void cached.then((p) => {
          if (p) p.relation = data.relation;
        });
      }
      renderActions(row, handle, data.relation, locale);
    } catch (err) {
      console.warn(err);
      follow.disabled = false;
    }
  });
  row.append(follow);
}

function buildFooter(profile: UserCardProfile, locale: Locale): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'profile-summary-card-footer';

  const games = document.createElement('span');
  games.textContent = `${profile.gamesTotal} ${t(
    profile.gamesTotal === 1 ? 'profile.gameSingular' : 'profile.gamePlural',
    {},
    locale,
  )}`;
  footer.append(games);

  const joined = formatJoined(profile.user.createdAt, locale);
  if (joined) {
    const joinedEl = document.createElement('span');
    joinedEl.textContent = `${t('profile.memberSince', {}, locale)} ${joined}`;
    footer.append(joinedEl);
  }

  return footer;
}

function buildBotFooter(profile: BotSummaryProfile): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'profile-summary-card-footer';
  const games = document.createElement('span');
  games.textContent = gameCountLabel(profile.gamesTotal);
  const record = document.createElement('span');
  record.textContent = `${profile.record.wins}-${profile.record.losses}-${profile.record.draws}`;
  record.title = 'Wins, losses, draws';
  footer.append(games, record);
  return footer;
}

// ── hover attach ──────────────────────────────────────────────────────────

// One shared popover element + subject key, so every player and bot link reuses
// one node instead of leaking one per anchor.
let popover: HTMLElement | null = null;
let popoverSubjectKey: string | null = null;
let pendingSubjectKey: string | null = null;
let showTimer: number | null = null;
let hideTimer: number | null = null;
let pointerInCard = false;
let pointerInAnchor = false;

// Per-page cache of profile fetches, keyed by lowercased handle. A card can
// mutate a cached profile's relation in place (see renderActions) so a re-hover
// reflects follow state without a refetch.
const userProfileCache = new Map<string, Promise<UserCardProfile | null>>();
const botProfileCache = new Map<string, Promise<BotSummaryProfile | null>>();

const SHOW_DELAY_MS = 220;
const HIDE_DELAY_MS = 160;

async function fetchProfile(handle: string): Promise<UserCardProfile | null> {
  const key = handle.toLowerCase();
  const existing = userProfileCache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/profile`).catch(() => null);
    if (!resp?.ok) return null;
    const data = (await resp.json()) as { profile: UserCardProfile };
    return data.profile;
  })().catch(() => null);
  userProfileCache.set(key, pending);
  const resolved = await pending;
  // Don't cache a failed fetch: let a later hover retry.
  if (!resolved) userProfileCache.delete(key);
  return resolved;
}

async function fetchBotProfile(botId: string): Promise<BotSummaryProfile | null> {
  const key = botId.toLowerCase();
  const existing = botProfileCache.get(key);
  if (existing) return existing;
  const pending = (async () => {
    const resp = await fetch(`/api/bots/${encodeURIComponent(botId)}`).catch(() => null);
    if (!resp?.ok) return null;
    const data = (await resp.json()) as { bot: BotSummaryProfile };
    return data.bot;
  })().catch(() => null);
  botProfileCache.set(key, pending);
  const resolved = await pending;
  if (!resolved) botProfileCache.delete(key);
  return resolved;
}

function ensurePopover(): HTMLElement {
  if (popover) return popover;
  const el = document.createElement('div');
  el.className = 'profile-summary-card-popover';
  el.hidden = true;
  el.addEventListener('mouseenter', () => {
    pointerInCard = true;
    cancelHide();
  });
  el.addEventListener('mouseleave', () => {
    pointerInCard = false;
    scheduleHide();
  });
  document.body.append(el);
  popover = el;
  return el;
}

function positionPopover(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  el.hidden = false;
  const cardW = el.offsetWidth;
  const cardH = el.offsetHeight;
  const gap = 8;
  const margin = 8;
  // Prefer the anchor's right; fall back to its left when the card would clip
  // the right edge.
  let left = rect.right + gap;
  if (left + cardW > window.innerWidth - margin) left = rect.left - gap - cardW;
  if (left < margin) left = margin;
  // Vertically align to the anchor top, clamped into the viewport.
  let top = rect.top;
  if (top + cardH > window.innerHeight - margin) top = window.innerHeight - margin - cardH;
  if (top < margin) top = margin;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function cancelShow(): void {
  if (showTimer != null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function cancelHide(): void {
  if (hideTimer != null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  cancelHide();
  hideTimer = window.setTimeout(() => {
    if (pointerInCard || pointerInAnchor) return;
    if (popover) popover.hidden = true;
    popoverSubjectKey = null;
  }, HIDE_DELAY_MS);
}

function attachProfileSummaryCard<T>(
  anchor: HTMLElement,
  subjectKey: string,
  load: () => Promise<T | null>,
  render: (profile: T) => HTMLElement,
): () => void {
  const onEnter = () => {
    pointerInAnchor = true;
    pendingSubjectKey = subjectKey;
    cancelHide();
    cancelShow();
    showTimer = window.setTimeout(async () => {
      const profile = await load();
      if (!profile) return;
      // The pointer may have left during the fetch; only show if we're still
      // meant to, and never let a slower previous fetch replace the card for
      // the anchor the pointer moved to in the meantime.
      if (pendingSubjectKey !== subjectKey || (!pointerInAnchor && !pointerInCard)) return;
      const el = ensurePopover();
      el.replaceChildren(render(profile));
      popoverSubjectKey = subjectKey;
      positionPopover(el, anchor);
    }, SHOW_DELAY_MS);
  };
  const onLeave = () => {
    pointerInAnchor = false;
    if (pendingSubjectKey === subjectKey) pendingSubjectKey = null;
    cancelShow();
    scheduleHide();
  };
  anchor.addEventListener('mouseenter', onEnter);
  anchor.addEventListener('mouseleave', onLeave);
  return () => {
    anchor.removeEventListener('mouseenter', onEnter);
    anchor.removeEventListener('mouseleave', onLeave);
    if (popoverSubjectKey === subjectKey) scheduleHide();
  };
}

// Attach a player hover card. Liveness comes from the calling surface because
// the profile endpoint intentionally does not claim presence.
export function attachUserCard(
  anchor: HTMLElement,
  handle: string,
  live: UserCardLiveness = {},
): () => void {
  return attachProfileSummaryCard(
    anchor,
    `user:${handle.toLowerCase()}`,
    () => fetchProfile(handle),
    (profile) => buildUserCard(profile, live),
  );
}

export function attachBotCard(anchor: HTMLElement, botId: string): () => void {
  return attachProfileSummaryCard(
    anchor,
    `bot:${botId.toLowerCase()}`,
    () => fetchBotProfile(botId),
    buildBotSummaryCard,
  );
}

// ── helpers ───────────────────────────────────────────────────────────────

function botPlayOptions(profile: BotSummaryProfile): BotSummaryPlayOption[] {
  const options =
    profile.playOptions && profile.playOptions.length > 0
      ? profile.playOptions
      : (profile.supportedGameSpecIds.length > 0
          ? profile.supportedGameSpecIds
          : [profile.defaultGameSpecId]
        ).map((gameSpecId) => ({
          gameSpecId,
          engineId: profile.activeEngineId,
          playable: true,
        }));
  return options;
}

function botRatings(profile: BotSummaryProfile): BotSummaryRating[] {
  return profile.ratings && profile.ratings.length > 0
    ? profile.ratings
    : profile.rating
      ? [profile.rating]
      : [];
}

function gameSpecLabel(gameSpecId: string): string {
  const key = GAME_SPEC_LABEL_KEYS[gameSpecId];
  if (key) return t(key);
  return maybeGameSpecForId(gameSpecId)?.publicName ?? gameSpecId;
}

function timeClassLabel(timeClass: BotSummaryRating['timeClass']): string {
  return `${timeClass.charAt(0).toUpperCase()}${timeClass.slice(1)}`;
}

function gameCountLabel(games: number): string {
  return `${new Intl.NumberFormat().format(games)} ${games === 1 ? 'game' : 'games'}`;
}

function variantLabel(variant: RatingVariant): string {
  return ratingVariantLabel(variant) ?? variant;
}

function formatJoined(value: string | undefined, locale: Locale): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, {
    month: 'long',
    year: 'numeric',
  }).format(date);
}
