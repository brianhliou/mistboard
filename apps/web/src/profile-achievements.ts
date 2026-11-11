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
// only which ids an account holds and when, plus each leveling family's
// progress. Ids this client does not define (a newer server) are skipped
// rather than shown raw.
//
// Leveling families (wins at 10 / 50 / 100 / 500) are one card each: the title
// names the highest tier held, pips count the tiers, a thin bar shows the
// count toward the next one, and the band takes the tier's metal. On the
// profile and in "N of M" a family counts once, earned from its first tier.

import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENTS,
  type AchievementCategory,
  type AchievementDefinition,
  type AchievementFamilyDefinition,
  type AchievementFamilyProgress,
  achievementFamilyProgress,
  achievementLevelId,
  getAchievementDefinition,
  getAchievementFamily,
  getAchievementLevel,
} from '@mistboard/game';
import './account-profile.css';
import './profile-achievements.css';
import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, LOCALE_META, type Locale } from './i18n/locale.js';
import { buildNav, buildNotice } from './site-shell.js';
import './seat-disc-ink.css';
import { buildUiIcon, type UiIconName } from './ui-icon.js';

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

// Family levels held, as award id -> date; unknown or malformed ids skipped.
function knownLevels(earned: readonly ProfileAchievement[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(earned)) return out;
  for (const award of earned) {
    const id = award?.id ?? '';
    if (getAchievementLevel(id) && !out.has(id)) out.set(id, award.awardedAt);
  }
  return out;
}

// Families with at least their first tier held.
function earnedFamilyCount(levels: ReadonlyMap<string, string>): number {
  return ACHIEVEMENT_FAMILIES.filter((family) =>
    levels.has(achievementLevelId(family.id, family.levels[0]?.threshold ?? 0)),
  ).length;
}

// Every card on the page: the singles and one per family.
export const ACHIEVEMENT_CARD_TOTAL = ACHIEVEMENTS.length + ACHIEVEMENT_FAMILIES.length;

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
  const count = held.length + earnedFamilyCount(knownLevels(earned));
  if (count === 0) return null;
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
    count === 1 ? 'profile.achievementsCountOne' : 'profile.achievementsCountMany',
    { count },
    locale,
  );
  line.append(link);
  return line;
}

type CardDefinition = {
  id: string;
  category: AchievementCategory;
  icon: UiIconName;
  tier: AchievementDefinition['tier'];
  titleKey: string;
  descriptionKey: string;
  hintKey: string;
};

function cardDefinition(definition: AchievementDefinition): CardDefinition {
  return {
    id: definition.id,
    category: definition.category,
    icon: `achievement-${definition.icon}` as UiIconName,
    tier: definition.tier,
    titleKey: definition.titleKey,
    descriptionKey: definition.descriptionKey,
    hintKey: definition.hintKey,
  };
}

function buildCardShell(
  id: string,
  category: AchievementCategory,
  icon: UiIconName,
  earned: boolean,
): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement('article');
  card.className = `achievement-card ${earned ? 'achievement-card-earned' : 'achievement-card-locked'}`;
  card.dataset.achievementId = id;
  card.dataset.state = earned ? 'earned' : 'locked';
  card.dataset.category = category;

  const band = document.createElement('div');
  band.className = 'achievement-card-band';
  band.setAttribute('aria-hidden', 'true');
  const iconWrap = document.createElement('span');
  iconWrap.className = 'achievement-card-icon';
  iconWrap.append(buildUiIcon(icon));
  const body = document.createElement('div');
  body.className = 'achievement-card-body';
  card.append(band, iconWrap, body);
  return { card, body };
}

function buildStatus(awardedAt: string | null, locale: Locale): HTMLElement | null {
  const status = document.createElement('p');
  status.className = 'achievement-card-status';
  if (awardedAt !== null) {
    const date = formatAchievementDate(awardedAt, locale);
    if (date) status.textContent = t('profile.achievementEarned', { date }, locale);
  } else {
    status.append(
      buildUiIcon('achievement-lock', 'achievement-card-lock'),
      document.createTextNode(t('profile.achievementLocked', {}, locale)),
    );
  }
  return status.childNodes.length > 0 ? status : null;
}

function buildAchievementCard(
  definition: CardDefinition,
  awardedAt: string | null,
  locale: Locale,
): HTMLElement {
  const earned = awardedAt !== null;
  const { card, body } = buildCardShell(
    definition.id,
    definition.category,
    definition.icon,
    earned,
  );
  if (definition.tier === 'badge') card.classList.add('achievement-card-badge');

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
  body.append(title, description);

  const status = buildStatus(awardedAt, locale);
  if (status) card.append(status);
  return card;
}

type FamilyCardOptions = {
  // The date the highest held tier was earned; null hides the status line
  // (the preview examples).
  awardedAt: string | null;
  preview?: boolean;
};

// One card per family. `progress.level` is the tiers held (0 = locked); the
// title names the highest tier held, or the first tier while locked.
export function buildAchievementFamilyCard(
  family: AchievementFamilyDefinition,
  progress: AchievementFamilyProgress,
  locale: Locale,
  options: FamilyCardOptions = { awardedAt: null },
): HTMLElement {
  const levels = family.levels;
  const level = Math.max(0, Math.min(progress.level, levels.length));
  const earned = level > 0;
  const reached = earned ? levels[level - 1] : undefined;
  const { card, body } = buildCardShell(
    family.id,
    family.category,
    `achievement-${family.icon}` as UiIconName,
    earned,
  );
  card.classList.add('achievement-card-family');
  card.dataset.level = String(level);
  card.dataset.metal = reached?.metal ?? 'none';
  if (options.preview) card.dataset.preview = 'true';

  const titleCount = reached?.threshold ?? levels[0]?.threshold ?? 0;
  const title = document.createElement('h3');
  title.className = 'achievement-card-title';
  title.textContent = t(family.titleKey as I18nKey, { count: titleCount }, locale);

  const pips = document.createElement('div');
  pips.className = 'achievement-card-pips';
  pips.setAttribute('role', 'img');
  pips.setAttribute(
    'aria-label',
    t('profile.achievementTierOf', { level, total: levels.length }, locale),
  );
  levels.forEach((entry, index) => {
    const pip = document.createElement('span');
    pip.className = 'achievement-card-pip';
    pip.dataset.metal = entry.metal;
    pip.dataset.filled = index < level ? 'true' : 'false';
    pips.append(pip);
  });

  const next = progress.nextThreshold;
  const description = document.createElement('p');
  description.className = 'achievement-card-text';
  description.textContent = earned
    ? t(family.descriptionKey as I18nKey, { count: titleCount }, locale)
    : t(family.hintKey as I18nKey, { count: next ?? titleCount }, locale);
  body.append(title, pips, description);

  const progressRow = document.createElement('div');
  progressRow.className = 'achievement-card-progress';
  if (next === null) {
    const max = document.createElement('span');
    max.className = 'achievement-card-max';
    max.textContent = t('profile.achievementMaxTier', {}, locale);
    progressRow.append(max);
  } else {
    const count = Math.max(0, progress.count);
    const text = `${count} / ${next}`;
    const bar = document.createElement('div');
    bar.className = 'achievement-card-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(next));
    bar.setAttribute('aria-valuenow', String(Math.min(count, next)));
    bar.setAttribute('aria-valuetext', text);
    const fill = document.createElement('span');
    fill.className = 'achievement-card-bar-fill';
    fill.style.width = `${Math.min(100, Math.round((count / next) * 100))}%`;
    bar.append(fill);
    const value = document.createElement('span');
    value.className = 'achievement-card-count';
    value.textContent = text;
    progressRow.append(bar, value);
  }
  card.append(progressRow);

  if (!options.preview) {
    const status = buildStatus(earned ? options.awardedAt : null, locale);
    if (status) card.append(status);
  }
  return card;
}

// Example family cards for `?preview=1`: every state a wins card can be in,
// page-only. They never reach the API or any count.
export const PREVIEW_FAMILY_STATES: ReadonlyArray<{ level: number; count: number }> = [
  { level: 0, count: 3 },
  { level: 1, count: 23 },
  { level: 2, count: 78 },
  { level: 3, count: 143 },
  { level: 4, count: 612 },
];

function previewProgress(
  family: AchievementFamilyDefinition,
  level: number,
  count: number,
): AchievementFamilyProgress {
  const held = new Set(
    family.levels.slice(0, level).map((entry) => achievementLevelId(family.id, entry.threshold)),
  );
  return achievementFamilyProgress(family, held, count);
}

// Without the API's progress (an older server), a family still shows the
// tiers its ledger rows prove, with the count floored at the highest of them.
function fallbackProgress(
  family: AchievementFamilyDefinition,
  levels: ReadonlyMap<string, string>,
): AchievementFamilyProgress {
  const held = new Set(
    family.levels
      .map((entry) => achievementLevelId(family.id, entry.threshold))
      .filter((id) => levels.has(id)),
  );
  const top = [...family.levels]
    .reverse()
    .find((entry) => held.has(achievementLevelId(family.id, entry.threshold)));
  return achievementFamilyProgress(family, held, top?.threshold ?? 0);
}

function buildPageHeader(
  handle: string,
  earnedCount: number,
  total: number,
  locale: Locale,
): HTMLElement {
  const header = document.createElement('header');
  header.className = 'achievements-page-header';
  const profileHref = `/@/${encodeURIComponent(handle)}`;

  // Whose page this is: a monogram and the handle, both back to the profile.
  const owner = document.createElement('a');
  owner.className = 'achievements-owner';
  owner.href = profileHref;
  owner.title = t('profile.achievementsBackToProfile', {}, locale);
  const monogram = document.createElement('span');
  monogram.className = 'achievements-owner-monogram';
  monogram.setAttribute('aria-hidden', 'true');
  monogram.textContent = (Array.from(handle)[0] ?? '?').toUpperCase();
  owner.append(monogram);

  const titles = document.createElement('div');
  titles.className = 'achievements-page-titles';
  const back = document.createElement('a');
  back.className = 'achievements-page-handle';
  back.href = profileHref;
  back.textContent = `@${handle}`;
  const heading = document.createElement('h1');
  heading.textContent = t('profile.achievements', {}, locale);
  const summary = document.createElement('p');
  summary.className = 'achievements-page-summary';
  summary.textContent = t('profile.achievementsEarnedOf', { earned: earnedCount, total }, locale);
  titles.append(back, heading, summary);
  header.append(owner, titles);
  return header;
}

export type AchievementsPageOptions = {
  // Per family, from the API; missing (an older server) falls back to the
  // tiers the ledger rows prove.
  families?: readonly AchievementFamilyProgress[];
  // `?preview=1`: an Examples group of family cards in every state.
  preview?: boolean;
};

type PageCard = { category: AchievementCategory; earned: boolean; build: () => HTMLElement };

function buildGroup(
  key: string,
  heading: string | null,
  cards: readonly HTMLElement[],
): HTMLElement {
  const group = document.createElement('section');
  group.className = 'achievements-group';
  group.dataset.category = key;
  if (heading) {
    const groupHeading = document.createElement('h2');
    groupHeading.className = 'achievements-group-heading';
    groupHeading.textContent = heading;
    group.append(groupHeading);
  }
  const grid = document.createElement('div');
  grid.className = 'achievements-grid';
  grid.append(...cards);
  group.append(grid);
  return group;
}

// The page body: whose it is, "N of M earned", then the cards, grouped by
// category when the catalog spans more than one.
export function buildProfileAchievementsPage(
  handle: string,
  earned: readonly ProfileAchievement[],
  locale: Locale = currentLocale(),
  options: AchievementsPageOptions = {},
): HTMLElement {
  const held = new Map(knownEarned(earned).map((award) => [award.definition.id, award.awardedAt]));
  const levels = knownLevels(earned);
  const progressById = new Map(
    (Array.isArray(options.families) ? options.families : [])
      .filter((entry) => entry && getAchievementFamily(entry.id))
      .map((entry) => [entry.id, entry]),
  );

  const cards: PageCard[] = [];
  for (const definition of ACHIEVEMENTS) {
    const awardedAt = held.get(definition.id) ?? null;
    cards.push({
      category: definition.category,
      earned: awardedAt !== null,
      build: () => buildAchievementCard(cardDefinition(definition), awardedAt, locale),
    });
  }
  for (const family of ACHIEVEMENT_FAMILIES) {
    const progress = progressById.get(family.id) ?? fallbackProgress(family, levels);
    const top = family.levels[progress.level - 1];
    const awardedAt = top
      ? (levels.get(achievementLevelId(family.id, top.threshold)) ?? null)
      : null;
    cards.push({
      category: family.category,
      earned: progress.level > 0,
      build: () => buildAchievementFamilyCard(family, progress, locale, { awardedAt }),
    });
  }

  const earnedCount = cards.filter((card) => card.earned).length;
  const page = document.createElement('section');
  page.className = 'achievements-page';
  page.append(buildPageHeader(handle, earnedCount, cards.length, locale));

  const categories: AchievementCategory[] = [];
  for (const card of cards) {
    if (!categories.includes(card.category)) categories.push(card.category);
  }
  for (const category of categories) {
    // Earned first within a group, catalog order otherwise.
    const inGroup = cards.filter((card) => card.category === category);
    const ordered = [
      ...inGroup.filter((card) => card.earned),
      ...inGroup.filter((card) => !card.earned),
    ];
    page.append(
      buildGroup(
        category,
        categories.length > 1 ? t(CATEGORY_LABEL[category], {}, locale) : null,
        ordered.map((card) => card.build()),
      ),
    );
  }

  if (options.preview) {
    const examples: HTMLElement[] = [];
    for (const family of ACHIEVEMENT_FAMILIES) {
      for (const state of PREVIEW_FAMILY_STATES) {
        if (state.level > family.levels.length) continue;
        examples.push(
          buildAchievementFamilyCard(
            family,
            previewProgress(family, state.level, state.count),
            locale,
            {
              awardedAt: null,
              preview: true,
            },
          ),
        );
      }
    }
    const group = buildGroup('examples', t('profile.achievementExamples', {}, locale), examples);
    group.dataset.preview = 'true';
    page.append(group);
  }
  return page;
}

class AchievementsNotFound extends Error {}

type UserAchievementsResponse = {
  achievements: ProfileAchievement[];
  families: AchievementFamilyProgress[] | undefined;
};

async function fetchUserAchievements(handle: string): Promise<UserAchievementsResponse> {
  const resp = await fetch(`/api/users/${encodeURIComponent(handle)}/achievements`);
  if (resp.status === 404) throw new AchievementsNotFound();
  if (!resp.ok) throw new Error(`failed to load achievements: ${resp.status}`);
  const data = (await resp.json()) as {
    achievements?: ProfileAchievement[];
    families?: AchievementFamilyProgress[];
  };
  return {
    achievements: Array.isArray(data.achievements) ? data.achievements : [],
    families: Array.isArray(data.families) ? data.families : undefined,
  };
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

  let loaded: UserAchievementsResponse;
  try {
    loaded = await fetchUserAchievements(handle);
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
  const search = typeof location === 'undefined' ? '' : location.search;
  shell.append(
    buildProfileAchievementsPage(handle, loaded.achievements, locale, {
      families: loaded.families,
      preview: new URLSearchParams(search).get('preview') === '1',
    }),
  );
}
