// Text equivalents of the data pages, from their existing public API reads.
// The shell puts these inside crawlerCopyRoot; the client replaces that root.
import { CANONICAL_VARIANT_ORDER, isRetiredGameSpec, maybeGameSpecForId } from '@mistboard/game';
import type { BoardLocale } from './board-text-copy.js';
import { DATA_PAGE_COPY } from './data-page-copy.js';
import type { DataFileEntry, DataListing, DataMonth } from './game-data-files.js';
import * as persistence from './persistence.js';
import type { CoachListing } from './persistence-coaches.js';
import { listPublishedCoaches } from './persistence-coaches.js';
import type { ForumCategory } from './persistence-forum.js';
import type { LeaderboardEntry } from './persistence-leaderboards.js';
import { getCachedPublicStats } from './public-stats-cache.js';
import {
  DEFAULT_RATING_BUCKET,
  PUBLIC_RATING_TIME_CLASS,
  visibleRatingTimeClasses,
} from './rating-buckets.js';
import { loadDataListing } from './routes/data.js';
import { escapeHtml } from './study-page-body.js';

type CopyKey = keyof typeof DATA_PAGE_COPY.en;
export function dataCopy(
  locale: BoardLocale,
  key: CopyKey,
  params: Record<string, string | number> = {},
): string {
  return DATA_PAGE_COPY[locale][key].replace(/\{(\w+)\}/g, (match, key: string) =>
    String(params[key] ?? match),
  );
}
const p = (text: string) => `<p>${escapeHtml(text)}</p>`;
const h = (text: string) => `<h2>${escapeHtml(text)}</h2>`;
const main = (title: string, body: string) => `<main><h1>${escapeHtml(title)}</h1>${body}</main>`;
const number = (value: number, locale: BoardLocale) => new Intl.NumberFormat(locale).format(value);
const table = (headers: string[], rows: string[][]) =>
  `<table><thead><tr>${headers.map((s) => `<th scope="col">${escapeHtml(s)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell, i) => (i === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`)).join('')}</tr>`).join('')}</tbody></table>`;
const textRows = (rows: Array<Array<string | number>>) =>
  rows.map((row) => row.map((cell) => escapeHtml(String(cell))));

const VARIANT_KEYS: Record<string, CopyKey> = {
  xiangqi: 'variant.xiangqi.name',
  jieqi: 'variant.jieqi.name',
  banqi: 'variant.banqi.name',
  jungle: 'variant.jungle.name',
  'jungle-flip': 'variant.jungleFlip.name',
  fog: 'variant.darkChess.name',
  'dark-chess': 'variant.darkChess.name',
  'dark-xiangqi': 'variant.darkXiangqi.name',
  'fortress-xiangqi': 'variant.fortressXiangqi.name',
  'crazyhouse-xiangqi': 'variant.crazyhouseXiangqi.name',
  'duck-xiangqi': 'variant.duckXiangqi.name',
  'atomic-xiangqi': 'variant.atomicXiangqi.name',
  chess: 'variant.chess.name',
  gomoku: 'variant.gomoku.name',
  'xiangqi-mahjong': 'variant.xiangqiMahjong.name',
  'three-kingdoms-banqi': 'variant.threeKingdomsBanqi.name',
};
export function dataVariantName(variant: string, locale: BoardLocale): string {
  const key = VARIANT_KEYS[variant];
  return key ? dataCopy(locale, key) : (maybeGameSpecForId(variant)?.publicName ?? variant);
}

export function statsPageBody(
  stats: persistence.PublicSiteStats,
  locale: BoardLocale = 'en',
): string {
  const t = (key: CopyKey, params = {}) => dataCopy(locale, key, params);
  let body =
    p(t('stats.lede')) +
    h(t('stats.gamesPlayed')) +
    p(number(stats.totalCompletedGames, locale)) +
    p(t('stats.gamesThisMonth', { count: number(stats.last30dCompletedGames, locale) }));
  if (typeof stats.accounts === 'number')
    body += h(t('stats.accounts')) + p(number(stats.accounts, locale));
  const weeks = stats.weeklyCompletedGames ?? [];
  // The last point is the partial current week, which the SVG shows separately.
  const completed = weeks.length > 1 ? weeks.slice(0, -1) : weeks;
  if (weeks.length) {
    body +=
      h(t('stats.gamesPerWeek')) +
      table(
        [t('stats.gamesPerWeek'), t('stats.gamesPerWeekSeries')],
        textRows(completed.map((w) => [w.weekStart, number(w.completedGames, locale)])),
      );
    if (weeks.length > 1)
      body += p(t('stats.thisWeekSoFar', { count: number(weeks.at(-1)!.completedGames, locale) }));
  }
  const variants = stats.variantTotals.filter((v) =>
    CANONICAL_VARIANT_ORDER.some((id) => id === v.variant && !isRetiredGameSpec(id)),
  );
  body +=
    h(t('stats.byVariant')) +
    table(
      [t('stats.byVariant'), t('data.colGames')],
      textRows(variants.map((v) => [dataVariantName(v.variant, locale), number(v.count, locale)])),
    );
  body +=
    h(t('stats.byMode')) +
    table(
      [t('stats.byMode'), t('data.colGames')],
      textRows(
        (['pvp', 'pve'] as const)
          .filter((mode) => stats.modeTotals[mode] > 0)
          .map((mode) => [
            t(mode === 'pvp' ? 'about.modePvp' : 'about.modePve'),
            number(stats.modeTotals[mode], locale),
          ]),
      ),
    );
  return main(t('stats.heading'), body);
}

function formatBytes(bytes: number, locale: BoardLocale): string {
  for (const [size, unit] of [
    [1024 ** 3, 'gigabyte'],
    [1024 ** 2, 'megabyte'],
    [1024, 'kilobyte'],
  ] as const) {
    if (bytes >= size)
      return new Intl.NumberFormat(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'short',
        maximumFractionDigits: bytes / size < 10 ? 1 : 0,
      }).format(bytes / size);
  }
  return `${number(bytes, locale)} B`;
}
function formatMonth(month: string, locale: BoardLocale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}
function download(file: DataFileEntry, locale: BoardLocale): string {
  return `<a href="${escapeHtml(file.path)}" download="${escapeHtml(file.fileName)}">${file.format.toUpperCase()}${file.built ? ` ${escapeHtml(formatBytes(file.built.bytes, locale))}` : ''}</a>`;
}
export function dataPageBody(
  listing: DataListing,
  locale: BoardLocale = 'en',
  search = '',
  now = new Date(),
): string {
  const t = (key: CopyKey, params = {}) => dataCopy(locale, key, params);
  const raw = new URLSearchParams(search).get('variant');
  const variant = raw && listing.variants.includes(raw) ? raw : 'all';
  const totals = new Map<string, number>();
  for (const month of listing.months)
    for (const v of month.variants) totals.set(v.variant, (totals.get(v.variant) ?? 0) + v.games);
  let body = `${p(t('data.subtitle'))}<p><a href="/data/about">${escapeHtml(t('data.aboutLink'))}</a></p>`;
  body += `<ul>${['all', ...listing.variants].map((v) => `<li><a href="/data${v === 'all' ? '' : `?variant=${encodeURIComponent(v)}`}">${escapeHtml(v === 'all' ? t('data.allVariants') : dataVariantName(v, locale))}</a> ${number(v === 'all' ? [...totals.values()].reduce((a, b) => a + b, 0) : (totals.get(v) ?? 0), locale)}</li>`).join('')}</ul>`;
  const rows = (months: DataMonth[]) =>
    months.flatMap((month) => {
      const row = variant === 'all' ? month : month.variants.find((v) => v.variant === variant);
      return row
        ? [
            [
              escapeHtml(formatMonth(month.month, locale)),
              number(row.games, locale),
              row.files.map((f) => download(f, locale)).join(' '),
              row.files
                .filter((f) => f.built)
                .map(
                  (f) =>
                    `${row.files.length > 1 ? `${f.format.toUpperCase()} ` : ''}${escapeHtml(f.built!.sha256.slice(0, 7))} ${escapeHtml(t('data.copy'))}`,
                )
                .join(' ') || '-',
            ],
          ]
        : [];
    });
  const headers = ['data.colMonth', 'data.colGames', 'data.colDownload', 'data.colHash'].map(
    (key) => t(key as CopyKey),
  );
  body += h(variant === 'all' ? t('data.allVariants') : dataVariantName(variant, locale));
  if (variant === 'all') body += p(t('data.allVariantsNote'));
  const humanRows = rows(listing.months);
  body += humanRows.length ? table(headers, humanRows) : p(t('data.noMonths'));
  body +=
    p(t('data.builtNote')) +
    p(t('data.currentMonthNote', { month: formatMonth(now.toISOString().slice(0, 7), locale) }));
  const engineRows = rows(listing.engineMonths ?? []);
  if (engineRows.length)
    body += h(t('data.engineHeading')) + p(t('data.engineNote')) + table(headers, engineRows);
  // builtAt is not shown by the app; collections are linked from studies only.
  body +=
    p(t('data.licensePrefix') + t('privacy.ccByLink') + t('data.licenseSuffix')) +
    p(t('data.citation')) +
    p(t('data.copy'));
  return main(t('data.heading'), body);
}

export function coachesPageBody(
  coaches: readonly CoachListing[],
  locale: BoardLocale = 'en',
): string {
  const t = (key: CopyKey) => dataCopy(locale, key);
  const rows = coaches.map(
    (c) =>
      `<li><a href="/coach/${encodeURIComponent(c.handle)}">${escapeHtml(c.title)} ${escapeHtml(c.displayName)}</a>${p(c.headline)}${c.languages ? p(`${t('coach.languagesLabel')}: ${c.languages}`) : ''}${c.rate ? p(`${t('coach.rateLabel')}: ${c.rate}`) : ''}${p(t(c.acceptingStudents ? 'coach.accepting' : 'coach.notAccepting'))}</li>`,
  );
  return main(
    t('coach.heading'),
    p(t('coach.intro')) +
      `<p><a href="/verify-title">${escapeHtml(t('coach.verifyToCoach'))}</a> <a href="/blog/titled-players">${escapeHtml(t('verifyTitle.whatYouGet'))}</a></p>` +
      (rows.length ? `<ul>${rows.join('')}</ul>` : p(t('coach.empty'))),
  );
}

function localized(
  base: string,
  i18n: Record<string, unknown>,
  locale: BoardLocale,
  field: string,
): string {
  const overlay = i18n[locale];
  const value =
    overlay && typeof overlay === 'object' ? (overlay as Record<string, unknown>)[field] : null;
  return typeof value === 'string' && value.trim() ? value : base;
}
export function forumPageBody(
  categories: readonly ForumCategory[],
  locale: BoardLocale = 'en',
): string {
  const t = (key: CopyKey) => dataCopy(locale, key);
  return main(
    t('forum.mistboardForum'),
    table(
      [
        t('forum.mistboardForum'),
        t('forum.topicsColumn'),
        t('forum.postsColumn'),
        t('forum.lastPostColumn'),
      ],
      categories.map((c) => [
        `<a href="/forum/${encodeURIComponent(c.slug)}">${escapeHtml(localized(c.name, c.i18n, locale, 'name'))}</a>${p(localized(c.description, c.i18n, locale, 'description'))}`,
        number(c.topicCount, locale),
        number(c.postCount, locale),
        c.latestPost
          ? `<a href="/forum/t/${encodeURIComponent(c.latestPost.topic.id)}/${encodeURIComponent(c.latestPost.topic.slug)}">${escapeHtml(c.latestPost.topic.title)}</a>`
          : escapeHtml(t('forum.noPostsYet')),
      ]),
    ),
  );
}

export function ratingStatsPageBody(
  entries: readonly LeaderboardEntry[],
  variant: string,
  locale: BoardLocale = 'en',
): string {
  const ratings = entries.map((entry) => entry.eloRating).filter(Number.isFinite);
  const name = dataVariantName(variant, locale);
  let body = '';
  if (!ratings.length) body = p(dataCopy(locale, 'profile.ratingStatsEmptyPool'));
  else {
    body = p(
      dataCopy(locale, 'profile.ratingStatsSummary', {
        count: ratings.length,
        variant: name,
        average: Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length),
      }),
    );
    const rows: Array<Array<string | number>> = [];
    for (
      let start = Math.floor(Math.min(...ratings) / 100) * 100;
      start <= Math.ceil(Math.max(...ratings) / 100) * 100;
      start += 100
    )
      rows.push([
        `${start}-${start + 99}`,
        ratings.filter((r) => r >= start && r < start + 100).length,
      ]);
    body += table(
      [dataCopy(locale, 'profile.currentRating'), dataCopy(locale, 'profile.ratingStatsSuffix')],
      textRows(rows),
    );
  }
  return main(
    `${dataCopy(locale, 'profile.ratingStatsPeriod')} ${name} ${dataCopy(locale, 'profile.ratingStatsSuffix')}`,
    body,
  );
}

export type DataPageSources = {
  stats: typeof getCachedPublicStats;
  data: typeof loadDataListing;
  coaches: typeof listPublishedCoaches;
  categories: typeof persistence.listForumCategories;
  leaderboard: typeof persistence.getLeaderboard;
};
const sources: DataPageSources = {
  stats: getCachedPublicStats,
  data: loadDataListing,
  coaches: listPublishedCoaches,
  categories: persistence.listForumCategories,
  leaderboard: persistence.getLeaderboard,
};

export async function dataRouteBody(
  pathname: string,
  locale: BoardLocale,
  search = '',
  overrides?: DataPageSources,
): Promise<string | null> {
  if (!overrides && !persistence.isInitialized()) return null;
  const load = overrides ?? sources;
  switch (pathname.replace(/\/+$/, '')) {
    case '/stats': {
      const stats = await load.stats();
      return stats ? statsPageBody(stats, locale) : null;
    }
    case '/data':
      return dataPageBody(await load.data(), locale, search);
    case '/coach':
      return coachesPageBody(await load.coaches(), locale);
    case '/forum':
      return forumPageBody(await load.categories(), locale);
    case '/player/rating-stats': {
      // The client chooses the most populated visible pace, preferring blitz on ties.
      const paces = visibleRatingTimeClasses();
      const results = await Promise.all(
        paces.map((timeClass) =>
          load.leaderboard({ variant: DEFAULT_RATING_BUCKET.variant, timeClass, limit: 500 }),
        ),
      );
      const selected = results.reduce(
        (best, entries, i) =>
          entries.length > results[best]!.length ||
          (entries.length === results[best]!.length && paces[i] === PUBLIC_RATING_TIME_CLASS)
            ? i
            : best,
        0,
      );
      return ratingStatsPageBody(results[selected] ?? [], DEFAULT_RATING_BUCKET.variant, locale);
    }
    default:
      return null;
  }
}
