// Achievements on the profile and their own page, /@/<handle>/achievements.
//
// Brian, 2026-10-14, on a row of pills under the identity block: "not
// scalable… cluttered. What about a page and they are cards? What if for
// badges we reserve for more important achievements?" So the profile carries
// one quiet "N achievements" link, plus at most three badge-tier achievements
// when the holder has any; everything else lives on the page as cards, earned
// and locked, grouped by category.
//
// Definitions come from @mistboard/game (achievements.ts); the server sends
// only which ids an account holds and when. Ids this client does not define
// (a newer server) are skipped rather than shown raw.

import {
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementDefinition,
  getAchievementDefinition,
} from '@mistboard/game';
import './account-profile.css';
import './profile-achievements.css';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { buildNav, buildNotice } from './site-shell.js';
import { buildUiIcon } from './ui-icon.js';

export type ProfileAchievement = { id: string; awardedAt: string };

// Badges shown on the profile, most recent first.
export const PROFILE_BADGE_LIMIT = 3;

const CATEGORY_LABEL: Record<AchievementCategory, I18nKey> = {
  play: 'profile.achievementCategoryPlay',
  puzzles: 'profile.achievementCategoryPuzzles',
  community: 'profile.achievementCategoryCommunity',
};

export function profileAchievementsHref(handle: string): string {
  return `/@/${encodeURIComponent(handle)}/achievements`;
}

type Earned = { definition: AchievementDefinition; awardedAt: string };

function knownEarned(earned: readonly ProfileAchievement[] | undefined): Earned[] {
  if (!Array.isArray(earned)) return [];
  const out: Earned[] = [];
  const seen = new Set<string>();
  for (const award of earned) {
    const definition = getAchievementDefinition(award?.id ?? '');
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    out.push({ definition, awardedAt: award.awardedAt });
  }
  return out;
}

function formatAchievementDate(value: string, locale: Locale): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE_META[locale].dateLocale, { dateStyle: 'medium' }).format(
    date,
  );
}

function label(key: string, locale: Locale): string {
  return t(key as I18nKey, {}, locale);
}

// The profile's line under the counts: badge-tier achievements (at most three,
// newest first) and a link to the page. Null when the account holds none.
export function buildProfileAchievementsSummary(
  handle: string,
  earned: readonly ProfileAchievement[] | undefined,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  const held = knownEarned(earned);
  if (held.length === 0) return null;
  const line = document.createElement('div');
  line.className = 'profile-achievements';

  const badges = held
    .filter((award) => award.definition.tier === 'badge')
    .sort((a, b) => Date.parse(b.awardedAt) - Date.parse(a.awardedAt))
    .slice(0, PROFILE_BADGE_LIMIT);
  if (badges.length > 0) {
    const list = document.createElement('ul');
    list.className = 'profile-achievement-badges';
    for (const { definition, awardedAt } of badges) {
      const item = document.createElement('li');
      item.className = 'profile-achievement-badge';
      item.dataset.achievementId = definition.id;
      const date = formatAchievementDate(awardedAt, locale);
      item.title = [
        label(definition.descriptionKey, locale),
        date ? t('profile.achievementEarned', { date }, locale) : '',
      ]
        .filter(Boolean)
        .join(' ');
      item.append(
        buildUiIcon(`achievement-${definition.icon}`, 'profile-achievement-icon'),
        document.createTextNode(label(definition.titleKey, locale)),
      );
      list.append(item);
    }
    line.append(list);
  }

  const link = document.createElement('a');
  link.className = 'profile-achievements-link';
  link.href = profileAchievementsHref(handle);
  link.textContent = t(
    held.length === 1 ? 'profile.achievementsCountOne' : 'profile.achievementsCountMany',
    { count: held.length },
    locale,
  );
  line.append(link);
  return line;
}

function buildAchievementCard(
  definition: AchievementDefinition,
  awardedAt: string | null,
  locale: Locale,
): HTMLElement {
  const card = document.createElement('article');
  const earned = awardedAt !== null;
  card.className = `achievement-card ${earned ? 'achievement-card-earned' : 'achievement-card-locked'}`;
  if (definition.tier === 'badge') card.classList.add('achievement-card-badge');
  card.dataset.achievementId = definition.id;
  card.dataset.state = earned ? 'earned' : 'locked';

  const icon = document.createElement('span');
  icon.className = 'achievement-card-icon';
  icon.append(buildUiIcon(`achievement-${definition.icon}`));

  const body = document.createElement('div');
  body.className = 'achievement-card-body';
  const title = document.createElement('h3');
  title.className = 'achievement-card-title';
  title.textContent = label(definition.titleKey, locale);
  if (definition.tier === 'badge') {
    const tag = document.createElement('span');
    tag.className = 'achievement-card-tag';
    tag.textContent = t('profile.achievementBadge', {}, locale);
    title.append(tag);
  }
  const description = document.createElement('p');
  description.className = 'achievement-card-text';
  description.textContent = label(earned ? definition.descriptionKey : definition.hintKey, locale);
  const status = document.createElement('p');
  status.className = 'achievement-card-status';
  const date = earned ? formatAchievementDate(awardedAt, locale) : null;
  status.textContent = earned
    ? date
      ? t('profile.achievementEarned', { date }, locale)
      : ''
    : t('profile.achievementLocked', {}, locale);
  body.append(title, description);
  if (status.textContent) body.append(status);

  card.append(icon, body);
  return card;
}

// The page body: heading, "N of M earned", then the cards, grouped by category
// when the catalog spans more than one.
export function buildProfileAchievementsPage(
  handle: string,
  earned: readonly ProfileAchievement[],
  locale: Locale = currentLocale(),
): HTMLElement {
  const held = new Map(knownEarned(earned).map((award) => [award.definition.id, award.awardedAt]));
  const page = document.createElement('section');
  page.className = 'achievements-page';

  const header = document.createElement('header');
  header.className = 'achievements-page-header';
  const back = document.createElement('a');
  back.className = 'achievements-page-handle';
  back.href = `/@/${encodeURIComponent(handle)}`;
  back.textContent = `@${handle}`;
  const heading = document.createElement('h1');
  heading.textContent = t('profile.achievements', {}, locale);
  const summary = document.createElement('p');
  summary.className = 'achievements-page-summary';
  summary.textContent = t(
    'profile.achievementsEarnedOf',
    { earned: held.size, total: ACHIEVEMENTS.length },
    locale,
  );
  header.append(back, heading, summary);
  page.append(header);

  const categories: AchievementCategory[] = [];
  for (const definition of ACHIEVEMENTS) {
    if (!categories.includes(definition.category)) categories.push(definition.category);
  }
  for (const category of categories) {
    const group = document.createElement('section');
    group.className = 'achievements-group';
    group.dataset.category = category;
    if (categories.length > 1) {
      const groupHeading = document.createElement('h2');
      groupHeading.className = 'achievements-group-heading';
      groupHeading.textContent = t(CATEGORY_LABEL[category], {}, locale);
      group.append(groupHeading);
    }
    const grid = document.createElement('div');
    grid.className = 'achievements-grid';
    // Earned first within a group, catalog order otherwise.
    const definitions = ACHIEVEMENTS.filter((definition) => definition.category === category);
    const ordered = [
      ...definitions.filter((definition) => held.has(definition.id)),
      ...definitions.filter((definition) => !held.has(definition.id)),
    ];
    for (const definition of ordered) {
      grid.append(buildAchievementCard(definition, held.get(definition.id) ?? null, locale));
    }
    group.append(grid);
    page.append(group);
  }
  return page;
}

class AchievementsNotFound extends Error {}

async function fetchUserAchievements(handle: string): Promise<ProfileAchievement[]> {
  const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/achievements`);
  if (resp.status === 404) throw new AchievementsNotFound();
  if (!resp.ok) throw new Error(`failed to load achievements: ${resp.status}`);
  const data = (await resp.json()) as { achievements?: ProfileAchievement[] };
  return Array.isArray(data.achievements) ? data.achievements : [];
}

// A private profile answers 404 to anyone but its owner, the same gate as the
// profile itself, so the page shows the profile's not-found notice.
export async function mountProfileAchievements(root: HTMLElement, handle: string): Promise<void> {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'profile-route');
  const shell = document.createElement('main');
  shell.className = 'profile-shell achievements-shell';
  root.replaceChildren(buildNav(locale), shell);

  let earned: ProfileAchievement[];
  try {
    earned = await fetchUserAchievements(handle);
  } catch (err) {
    console.warn(err);
    const notFound = err instanceof AchievementsNotFound;
    const titleKey: I18nKey = notFound ? 'profile.notFoundTitle' : 'profile.loadFailedTitle';
    const bodyKey: I18nKey = notFound ? 'profile.notFoundBody' : 'profile.loadFailedBody';
    document.title = `${t(titleKey, {}, locale)} · Mistboard`;
    shell.append(buildNotice(t(titleKey, {}, locale), t(bodyKey, {}, locale)));
    return;
  }
  document.title = `${t('profile.achievements', {}, locale)} · @${handle} · Mistboard`;
  shell.append(buildProfileAchievementsPage(handle, earned, locale));
}
