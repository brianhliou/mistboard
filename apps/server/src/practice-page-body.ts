// The anonymous practice shelf, from the same single resolving read as /api/practice.
import { PRACTICE_SECTIONS, practiceCatalogSlugs } from '@mistboard/game';
import type { BoardLocale } from './board-text-copy.js';
import { dataCopy } from './data-page-body.js';
import * as persistence from './persistence.js';
import type { PracticeStudySummary } from './persistence-studies.js';
import { escapeHtml } from './study-page-body.js';

const LOCALES: Record<string, BoardLocale> = {
  '/practice': 'en',
  '/zh-hans/practice': 'zh-Hans',
  '/zh-hant/practice': 'zh-Hant',
};
const SUBTITLES = {
  'endgames-soldier': 'practice.card.soldier',
  'endgames-chariot': 'practice.card.chariot',
  'endgames-horse': 'practice.card.horse',
  'endgames-cannon': 'practice.card.cannon',
  'endgames-insufficient': 'practice.card.insufficient',
} as const;

export function practicePageBody(
  studies: readonly PracticeStudySummary[],
  locale: BoardLocale,
): string {
  const bySlug = new Map(studies.map((study) => [study.slug, study]));
  let total = 0;
  let first = true;
  const sections = PRACTICE_SECTIONS.flatMap((section) => {
    const cards = section.cards.flatMap((card) => {
      const study = bySlug.get(card.slug);
      if (!study) return [];
      total += study.exerciseCount;
      const overlay = study.i18n[locale] as { name?: unknown } | undefined;
      const name =
        typeof overlay?.name === 'string' && overlay.name.trim()
          ? overlay.name
          : study.name || card.title;
      const key = SUBTITLES[card.slug as keyof typeof SUBTITLES];
      const subtitle = key ? dataCopy(locale, key) : card.blurb;
      const ribbon = first
        ? dataCopy(locale, 'practice.ribbon.play')
        : `0 / ${study.exerciseCount}`;
      first = false;
      return [
        `<li><a href="/study/${encodeURIComponent(study.id)}">${escapeHtml(name)}</a><p>${escapeHtml(subtitle)}</p>${escapeHtml(ribbon)}</li>`,
      ];
    });
    if (!cards.length) return [];
    const title =
      section.id === 'endgames' ? dataCopy(locale, 'practice.section.endgames') : section.title;
    return [`<section><h2>${escapeHtml(title)}</h2><ul>${cards.join('')}</ul></section>`];
  });
  const progress =
    total > 0
      ? `<p>${escapeHtml(dataCopy(locale, 'practice.progress', { pct: 0 }))}</p><p>${escapeHtml(dataCopy(locale, 'practice.solvedOfTotal', { solved: 0, total }))}</p>`
      : '';
  return `<main><h1>${escapeHtml(dataCopy(locale, 'practice.title'))}</h1><p>${escapeHtml(dataCopy(locale, 'practice.subtitle'))}</p>${progress}${sections.join('') || `<p>${escapeHtml(dataCopy(locale, 'practice.empty'))}</p>`}</main>`;
}

export async function practiceRouteBody(
  pathname: string,
  load: typeof persistence.getPracticeStudiesBySlug = persistence.getPracticeStudiesBySlug,
): Promise<string | null> {
  const locale = LOCALES[pathname.replace(/\/+$/, '')];
  if (!locale) return null;
  // No cache, just like /api/practice. No progress/private reader query.
  return practicePageBody(await load(practiceCatalogSlugs()), locale);
}
