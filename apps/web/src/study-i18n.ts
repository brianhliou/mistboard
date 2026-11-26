// Localized study text.
//
// Model: a study keeps ONE structural source of truth (its name, description,
// chapter names, and the move tree with its comments). Translations are an
// overlay keyed by locale, exactly like the article dictionaries in
// article-i18n.ts — never a duplicated study per language, which would fork the
// move tree and split likes and comments across copies.
//
// Every lookup falls back to the base text, so a partially translated study
// degrades one string at a time rather than stranding a reader on a page that is
// half in a language they do not read. That matters here: the curated classical
// studies are authored Chinese-first (the woodblock prints 順砲橫車…), and the
// English is the translation, so "base" is not a synonym for "English".

import { currentLocale, type Locale } from './i18n/locale.js';

/** Per-locale overrides for one record's authored strings. Keys are Locale
 *  codes; unknown keys are ignored rather than rejected, so a blob written by a
 *  newer client cannot break an older one. */
export type StudyI18n = Partial<
  Record<Locale, { name?: string; description?: string; tags?: StudyTagI18n }>
>;

/** Per-locale overrides for a chapter's game tags. Only the tags that carry
 *  language: a player's name and the event's name. A date is a date and a
 *  result is `1-0` in every locale, so neither is translatable and neither is
 *  accepted here. */
export type StudyTagI18n = { red?: string; black?: string; event?: string };

/** Per-locale text for a single tree comment (stored inside the chapter blob). */
export type CommentI18n = Partial<Record<Locale, string>>;

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Parse an untrusted `i18n` value (from the API or a stored blob) into the
 *  overlay shape, dropping anything malformed. Never throws: a corrupt overlay
 *  must degrade to "no translations", not break the page. */
export function parseStudyI18n(raw: unknown): StudyI18n {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: StudyI18n = {};
  for (const [locale, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const name = isNonEmpty(entry.name) ? entry.name : undefined;
    const description = isNonEmpty(entry.description) ? entry.description : undefined;
    const tags = parseTagI18n(entry.tags);
    if (name === undefined && description === undefined && tags === undefined) continue;
    out[locale as Locale] = {
      ...(name && { name }),
      ...(description && { description }),
      ...(tags && { tags }),
    };
  }
  return out;
}

function parseTagI18n(raw: unknown): StudyTagI18n | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entry = raw as Record<string, unknown>;
  const out: StudyTagI18n = {};
  for (const key of ['red', 'black', 'event'] as const) {
    if (isNonEmpty(entry[key])) out[key] = entry[key] as string;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * A chapter's game tags for a locale, each falling back to the base value.
 *
 * The players' names and the event sit beside a Chinese board and under Chinese
 * prose, and until this existed they were the last English left on a localized
 * study page: the chapter list, the description and the labels all translated
 * around two names that did not.
 */
export function localizedChapterTags<T extends Record<string, string | undefined>>(
  base: T,
  i18n: unknown,
  locale: Locale = currentLocale(),
): T {
  const overlay = parseStudyI18n(i18n)[locale]?.tags;
  if (!overlay) return base;
  return {
    ...base,
    ...(overlay.red && base.red ? { red: overlay.red } : {}),
    ...(overlay.black && base.black ? { black: overlay.black } : {}),
    ...(overlay.event && base.event ? { event: overlay.event } : {}),
  };
}

/** The study/chapter name for a locale, falling back to the base name. */
export function localizedStudyName(
  base: string,
  i18n: unknown,
  locale: Locale = currentLocale(),
): string {
  const parsed = parseStudyI18n(i18n);
  return parsed[locale]?.name ?? base;
}

/** The study description for a locale, falling back to the base description. */
export function localizedStudyDescription(
  base: string,
  i18n: unknown,
  locale: Locale = currentLocale(),
): string {
  const parsed = parseStudyI18n(i18n);
  return parsed[locale]?.description ?? base;
}

/** The text of one authored comment for a locale, falling back to its base text.
 *  `i18n` rides on the comment itself inside the serialized tree. */
export function localizedCommentText(
  base: string,
  i18n: unknown,
  locale: Locale = currentLocale(),
): string {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return base;
  const value = (i18n as Record<string, unknown>)[locale];
  return isNonEmpty(value) ? value : base;
}

/** A lesson node's hint or wrong-move text for a locale, falling back to the
 *  base text. A translation never shows where the base field is empty, so a
 *  cleared hint stays cleared in every language. READ paths only. */
export function displayGamebookText(
  gamebook:
    | {
        hint?: string;
        deviation?: string;
        i18n?: Record<string, { hint?: string; deviation?: string }>;
      }
    | undefined,
  field: 'hint' | 'deviation',
  locale: Locale = currentLocale(),
): string | undefined {
  const base = gamebook?.[field];
  if (!isNonEmpty(base)) return undefined;
  const overlay = gamebook?.i18n;
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return base;
  const entry = (overlay as Record<string, unknown>)[locale];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return base;
  const value = (entry as Record<string, unknown>)[field];
  return isNonEmpty(value) ? value : base;
}

/** Resolve a tree node's first comment for display. Returns undefined when the
 *  node carries no comment, so callers keep their existing "no comment" branch.
 *  READ paths only: the annotations editor writes the base text and must keep
 *  showing it, or an owner editing in one locale would overwrite it with a
 *  translation. */
export function displayComment(
  comment: { text?: string; i18n?: Record<string, string> } | undefined,
  locale: Locale = currentLocale(),
): string | undefined {
  if (!comment || !isNonEmpty(comment.text)) return undefined;
  return localizedCommentText(comment.text, comment.i18n, locale);
}
