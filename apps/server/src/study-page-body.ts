// Server-rendered body for a public study page (/study/:id).
//
// Why this exists: `serveStudyPage` already resolves the study from Postgres and
// injects per-study <title>/description/hreflang, but it shipped the empty SPA
// shell as the document body. A crawler therefore saw a title and nothing else —
// measured 2026-08-08 on prod, /study/<id> served 12 words. The classical-manual
// library is the deepest content on the site and it was entirely non-indexable.
//
// The pattern mirrors the build-time article prerender (apps/web/scripts/
// prerender-articles.mjs): bake real content into #app so crawlers and first
// paint get prose, then the client SPA `replaceChildren()`s it on takeover
// (study.ts::mountStudy clears the root before it renders). The difference is
// that a study is DB-backed, so this renders per request instead of at build.
//
// Deliberately text-only: no board SVG, no scripts, no styles. This markup is
// discarded milliseconds after the client boots, so its only jobs are to be
// crawlable, to be honest about what the study contains, and to be small.

import { maybeGameSpecForId } from '@mistboard/game';
import type { StudyChapterRecord, StudyRecord, StudyWithChapters } from './persistence-studies.js';
import { variantName } from './player-email.js';
import { SEO_TITLE_MIN, seoMetaLengthProblems, seoTextLength } from './seo-meta-length.js';

export type StudyPageLocale = 'en' | 'zh-Hans' | 'zh-Hant';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Pick a localized string off a `115_study_i18n` overlay, falling back to the
 *  base column. Mirrors study-i18n.ts on the client; kept here rather than
 *  importing web code into the server.
 *
 *  NOTE: `en` is a real overlay locale, not a synonym for the base column. The
 *  classical manuals are authored Chinese-first (the base holds what the
 *  woodblock prints, English is the overlay), so short-circuiting on 'en' would
 *  serve Chinese titles to English readers. */
export function localizedField(
  base: string,
  i18n: Record<string, unknown> | null | undefined,
  locale: StudyPageLocale,
  field: 'name' | 'description',
): string {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) return base;
  const entry = (i18n as Record<string, unknown>)[locale];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return base;
  const value = (entry as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() ? value : base;
}

// Per-locale scaffolding. The zh locales carry the site's organic search
// footprint, so the server-rendered body must not fall back to English chrome
// around Chinese content.
const LABELS: Record<
  StudyPageLocale,
  { chapters: (n: number) => string; moves: (n: number) => string }
> = {
  en: {
    chapters: (n) => `${n} ${n === 1 ? 'chapter' : 'chapters'}`,
    moves: (n) => `${n} ${n === 1 ? 'move' : 'moves'}`,
  },
  'zh-Hans': { chapters: (n) => `${n} 章`, moves: (n) => `${n} 手` },
  'zh-Hant': { chapters: (n) => `${n} 章`, moves: (n) => `${n} 手` },
};

// Bounds. A study is uncapped in principle (卷三 holds 66 chapters, and the
// classical canon runs to hundreds of compositions), but the served document
// must stay small. These caps keep a worst-case body in the tens of kilobytes
// while still giving every chapter its own line and link.
const MAX_CHAPTERS = 250;
const MAX_COMMENTS_PER_CHAPTER = 2;
const MAX_COMMENT_CHARS = 280;

type SerializedNodeish = {
  uci?: unknown;
  annotations?: { comments?: unknown } | undefined;
  children?: unknown;
};

function nodeChildren(node: SerializedNodeish): SerializedNodeish[] {
  return Array.isArray(node.children) ? (node.children as SerializedNodeish[]) : [];
}

/** The serialized tree stores UCIs only; positions rebuild by replay. Walking
 *  children[0] therefore counts mainline plies without needing the game kernel. */
function treeRoot(root: unknown): SerializedNodeish | null {
  if (!root || typeof root !== 'object') return null;
  const inner = (root as { root?: unknown }).root;
  return inner && typeof inner === 'object' ? (inner as SerializedNodeish) : null;
}

function mainlinePlies(root: unknown): number {
  let node = treeRoot(root);
  let plies = 0;
  while (node) {
    const next = nodeChildren(node)[0];
    if (!next || typeof next.uci !== 'string') break;
    plies += 1;
    node = next;
  }
  return plies;
}

/** Mainline comment text, locale-resolved, in move order. These carry the actual
 *  scholarship (vol 1 alone holds 698 annotated nodes) and are the only prose a
 *  study has, so they are what makes the page worth indexing. */
// NOTE: a first chapter's root comment sometimes restates the study blurb (the
// volume preface lives on both). A prefix-match dedupe was tried and reverted:
// the two strings are edited independently and diverge within ~40 characters, so
// catching it needs a threshold loose enough to also drop legitimately distinct
// chapter prose. This track was burned in July by silent content loss that every
// gate approved; a little duplication is the cheaper error.
function mainlineComments(root: unknown, locale: StudyPageLocale, limit: number): string[] {
  const out: string[] = [];
  let node = treeRoot(root);
  while (node && out.length < limit) {
    const comments = node.annotations?.comments;
    if (Array.isArray(comments)) {
      for (const raw of comments) {
        if (out.length >= limit) break;
        const text = commentText(raw, locale);
        if (text) out.push(text);
      }
    }
    node = nodeChildren(node)[0];
  }
  return out;
}

function commentText(raw: unknown, locale: StudyPageLocale): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const comment = raw as { text?: unknown; i18n?: unknown };
  let text = typeof comment.text === 'string' ? comment.text : '';
  // `en` is an overlay like any other: these bodies are Chinese-first.
  if (comment.i18n && typeof comment.i18n === 'object') {
    const localized = (comment.i18n as Record<string, unknown>)[locale];
    if (typeof localized === 'string' && localized.trim()) text = localized;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_COMMENT_CHARS
    ? `${trimmed.slice(0, MAX_COMMENT_CHARS).trimEnd()}…`
    : trimmed;
}

function chapterListItem(
  chapter: StudyChapterRecord,
  params: { studyId: string; localePath: string; locale: StudyPageLocale },
): string {
  const { locale, localePath, studyId } = params;
  const name = localizedField(chapter.name, chapter.i18n, locale, 'name');
  const href = `${localePath}/study/${encodeURIComponent(studyId)}/${encodeURIComponent(chapter.id)}`;
  const plies = mainlinePlies(chapter.root);
  const parts = [`<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`];
  if (plies > 0) parts.push(`<span>${escapeHtml(LABELS[locale].moves(plies))}</span>`);
  for (const comment of mainlineComments(chapter.root, locale, MAX_COMMENTS_PER_CHAPTER)) {
    parts.push(`<p>${escapeHtml(comment)}</p>`);
  }
  return `<li>${parts.join('')}</li>`;
}

// ── Page meta ────────────────────────────────────────────────────────────────
//
// Bing's 2026-10 scan flagged study pages for short titles ("王子耿 | Mistboard
// study", 21 characters) and short descriptions: a zh study blurb of 22
// characters, and ~11k chapter permalinks whose fallback read "<study>. 58
// moves.". A description under the repo floor (seo-meta-length.ts) is extended
// with facts the page already shows (the variant chip, the chapter count, the
// per-chapter move counts, the chapter names) and one sentence of what the page
// offers; one at or above it is served unchanged. Nothing here is new to a
// visitor: hidden-information variants only ever expose counts and names that
// the server-rendered body already lists. Stored data is never rewritten.

/** Cap for an extended description, in characters (Bing counts characters). */
const DESCRIPTION_MAX_CHARS = 160;
/** Cap for a chapter title, in characters. */
const TITLE_MAX_CHARS = 65;
/** The shortest study-name stub worth keeping in a truncated chapter title. */
const MIN_STUDY_STUB_CHARS = 8;
const SITE_SUFFIX = ' | Mistboard';
/** A study name quoted inside a chapter description is cut to this. */
const STUDY_NAME_IN_DESCRIPTION_MAX_CHARS = 60;

type MetaCopy = {
  /** The variant study label in a title ("Xiangqi study"); null variant = mixed or unknown. */
  titleLabel: (variant: string | null) => string;
  /** `name` is set when the study has no stored description to lead with. */
  studyFacts: (p: {
    name: string | null;
    variant: string | null;
    chapters: number;
    plies: number;
  }) => string;
  chapterNames: (names: string[], complete: boolean) => string;
  chapterFacts: (p: {
    variant: string | null;
    studyName: string;
    ordinal: number;
    chapters: number;
    plies: number;
  }) => string;
  offer: string;
  /** The same offer, shorter, for when the long one would pass the cap. */
  offerShort: string;
  /** Joins two sentences: a space in English, nothing in Chinese. */
  join: string;
  period: string;
};

function article(phrase: string): 'a' | 'an' {
  return /^[aeiou]/i.test(phrase) ? 'an' : 'a';
}

function withArticle(phrase: string): string {
  return `${article(phrase) === 'an' ? 'An' : 'A'} ${phrase}`;
}

/** "jieqi study", or "study" when the variant is unknown. */
function variantStudy(variant: string | null): string {
  return variant ? `${variant} study` : 'study';
}

function englishList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const META_COPY: Record<StudyPageLocale, MetaCopy> = {
  en: {
    titleLabel: (v) => (v ? `${v} study` : 'Study'),
    studyFacts: ({ name, variant, chapters, plies }) =>
      `${name ? `${name} is ${article(variantStudy(variant))} ${variantStudy(variant)}` : withArticle(variantStudy(variant))}` +
      ` with ${LABELS.en.chapters(chapters)}` +
      `${plies > 0 ? ` and ${LABELS.en.moves(plies)}` : ''}.`,
    chapterNames: (names, complete) =>
      names.length === 1 && complete
        ? `Chapter: ${names[0]}.`
        : `Chapters${complete ? ':' : ' include'} ${englishList(names)}.`,
    chapterFacts: ({ variant, studyName, ordinal, chapters, plies }) =>
      `Chapter ${ordinal} of ${chapters} in ${studyName}, ${article(variantStudy(variant))} ` +
      `${variantStudy(variant)}${plies > 0 ? `, ${LABELS.en.moves(plies)} long` : ''}.`,
    offer: 'Open it on an interactive board and step forward and back through every move.',
    offerShort: 'Step through every move on an interactive board.',
    join: ' ',
    period: '.',
  },
  'zh-Hans': {
    titleLabel: (v) => `${v ?? ''}研习`,
    studyFacts: ({ name, variant, chapters, plies }) =>
      `${name ? `《${name}》是` : '这是'}一份${variant ?? ''}研习，共 ${chapters} 章${plies > 0 ? `、${plies} 手` : ''}。`,
    chapterNames: (names, complete) => `章节${complete ? '' : '包括'}：${names.join('、')}。`,
    chapterFacts: ({ variant, studyName, ordinal, chapters, plies }) =>
      `本章是${variant ?? ''}研习《${studyName}》的第 ${ordinal} 章（共 ${chapters} 章）${plies > 0 ? `，共 ${plies} 手` : ''}。`,
    offer: '可在互动棋盘上打开研习，逐手前进或后退，查看每一步之后的局面。',
    offerShort: '可在互动棋盘上逐手查看。',
    join: '',
    period: '。',
  },
  'zh-Hant': {
    titleLabel: (v) => `${v ?? ''}研習`,
    studyFacts: ({ name, variant, chapters, plies }) =>
      `${name ? `《${name}》是` : '這是'}一份${variant ?? ''}研習，共 ${chapters} 章${plies > 0 ? `、${plies} 手` : ''}。`,
    chapterNames: (names, complete) => `章節${complete ? '' : '包括'}：${names.join('、')}。`,
    chapterFacts: ({ variant, studyName, ordinal, chapters, plies }) =>
      `本章是${variant ?? ''}研習《${studyName}》的第 ${ordinal} 章（共 ${chapters} 章）${plies > 0 ? `，共 ${plies} 手` : ''}。`,
    offer: '可在互動棋盤上打開研習，逐手前進或後退，查看每一步之後的局面。',
    offerShort: '可在互動棋盤上逐手查看。',
    join: '',
    period: '。',
  },
};

/** A long enough title, so only the description is judged. */
const TITLE_PROBE = 'x'.repeat(SEO_TITLE_MIN);

/** The repo floor for a meta description (width, plus the zh character floor). */
export function studyDescriptionMeetsFloor(text: string): boolean {
  return seoMetaLengthProblems('', { title: TITLE_PROBE, description: text }).length === 0;
}

function charLength(text: string): number {
  return [...text].length;
}

function truncateChars(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, Math.max(0, max - 1))
    .join('')
    .replace(/[\s,.;:，、。；：·|-]+$/u, '')}…`;
}

/** A study is single-variant (routes/studies.ts refuses a mismatched chapter),
 *  so the first chapter's variant is the study's; it is the chip on the page.
 *  `prose` lowercases common-noun names for English running text. */
function studyVariantName(
  study: StudyWithChapters,
  locale: StudyPageLocale,
  prose: boolean,
): string | null {
  const variants = new Set(study.chapters.map((c) => c.variant));
  if (variants.size !== 1) return null;
  const [id] = variants;
  if (!id || !maybeGameSpecForId(id)) return null;
  return variantName(id, locale, prose);
}

/** Close a stored sentence so a fact can follow it. */
function closeSentence(text: string, copy: MetaCopy): string {
  return /[.!?…。！？:：)）"”」』]$/u.test(text) ? text : `${text}${copy.period}`;
}

/** Append whole segments, in order, until the description meets the floor; a
 *  segment that would pass the cap is skipped, never cut. A segment given as a
 *  list is alternatives, longest first: the first that fits is used. */
function extendDescription(
  base: string,
  segments: readonly (string | readonly string[])[],
  copy: MetaCopy,
): string {
  let out = base ? closeSentence(base, copy) : '';
  for (const segment of segments) {
    if (out && studyDescriptionMeetsFloor(out)) break;
    for (const option of typeof segment === 'string' ? [segment] : segment) {
      const next = out ? `${out}${copy.join}${option}` : option;
      if (charLength(next) <= DESCRIPTION_MAX_CHARS) {
        out = next;
        break;
      }
    }
  }
  return out;
}

function sortedChapters(study: StudyWithChapters): StudyChapterRecord[] {
  return [...study.chapters].sort((a, b) => a.ordinal - b.ordinal);
}

/** The chapter-names sentence with as many of the first three names as fit. */
function chapterNamesSegment(
  chapters: StudyChapterRecord[],
  locale: StudyPageLocale,
  room: number,
): string | null {
  const names = chapters
    .slice(0, 3)
    .map((c) => localizedField(c.name, c.i18n, locale, 'name').trim())
    .filter(Boolean);
  for (let n = names.length; n > 0; n -= 1) {
    const segment = META_COPY[locale].chapterNames(names.slice(0, n), n === chapters.length);
    if (charLength(segment) <= room) return segment;
  }
  return null;
}

/** Title and description for a study root (/study/:id). */
export function studyPageMeta(params: { study: StudyWithChapters; locale: StudyPageLocale }): {
  title: string;
  description: string;
} {
  const { locale, study } = params;
  const copy = META_COPY[locale];
  const name = localizedField(study.name, study.i18n, locale, 'name').trim();
  const chapters = sortedChapters(study);
  const plies = chapters.reduce((sum, c) => sum + mainlinePlies(c.root), 0);
  const titleVariant = studyVariantName(study, locale, false);

  let title = `${name} | Mistboard study`;
  if (seoTextLength(title) < SEO_TITLE_MIN) {
    title = `${name} · ${copy.titleLabel(titleVariant)}${SITE_SUFFIX}`;
    if (seoTextLength(title) < SEO_TITLE_MIN) {
      title = `${name} · ${copy.titleLabel(titleVariant)} · ${LABELS[locale].chapters(chapters.length)}${SITE_SUFFIX}`;
    }
  }

  const stored = localizedField(study.description, study.i18n, locale, 'description').trim();
  if (stored && studyDescriptionMeetsFloor(stored)) return { title, description: stored };
  const facts = copy.studyFacts({
    name: stored ? null : name,
    variant: studyVariantName(study, locale, true),
    chapters: chapters.length,
    plies,
  });
  const head = extendDescription(stored, [facts], copy);
  const names = chapterNamesSegment(
    chapters,
    locale,
    DESCRIPTION_MAX_CHARS - charLength(head) - charLength(copy.join) - charLength(copy.offer),
  );
  const description = extendDescription(
    head,
    [[copy.offer, copy.offerShort], ...(names ? [names] : [])],
    copy,
  );
  return { title, description };
}

/** `${chapter} · ${study} | Mistboard`, at most TITLE_MAX_CHARS: the study name
 *  is cut first, then dropped. The chapter is never cut: it is what tells one
 *  chapter of a 300-game study from the next, so a chapter name that alone
 *  passes the cap serves whole as `${chapter} | Mistboard`. */
function chapterTitle(chapterName: string, studyName: string, label: string): string {
  const full = `${chapterName} · ${studyName}${SITE_SUFFIX}`;
  let title = full;
  if (charLength(full) > TITLE_MAX_CHARS) {
    const room = TITLE_MAX_CHARS - charLength(`${chapterName} · ${SITE_SUFFIX}`);
    title =
      room >= MIN_STUDY_STUB_CHARS
        ? `${chapterName} · ${truncateChars(studyName, room)}${SITE_SUFFIX}`
        : `${chapterName}${SITE_SUFFIX}`;
  }
  if (seoTextLength(title) < SEO_TITLE_MIN) {
    const labelled = `${title.slice(0, -SITE_SUFFIX.length)} · ${label}${SITE_SUFFIX}`;
    if (charLength(labelled) <= TITLE_MAX_CHARS) title = labelled;
  }
  return title;
}

/** Per-chapter page meta for a chapter permalink. Without this every chapter of
 *  a 66-composition study serves the study's own title and description, which is
 *  a set of near-identical pages. */
export function chapterPageMeta(params: {
  study: StudyWithChapters;
  chapter: StudyChapterRecord;
  locale: StudyPageLocale;
}): { title: string; description: string } {
  const { chapter, locale, study } = params;
  const copy = META_COPY[locale];
  const chapterName = localizedField(chapter.name, chapter.i18n, locale, 'name').trim();
  const studyName = localizedField(study.name, study.i18n, locale, 'name').trim();
  const comment = mainlineComments(chapter.root, locale, 1)[0];
  const plies = mainlinePlies(chapter.root);
  const chapters = sortedChapters(study);
  const title = chapterTitle(
    chapterName,
    studyName,
    copy.titleLabel(studyVariantName(study, locale, false)),
  );
  if (comment && studyDescriptionMeetsFloor(comment)) return { title, description: comment };
  const facts = copy.chapterFacts({
    variant: studyVariantName(study, locale, true),
    // Cut so the sentence always fits the cap; the title carries the full name.
    studyName: truncateChars(studyName, STUDY_NAME_IN_DESCRIPTION_MAX_CHARS),
    ordinal: chapters.findIndex((c) => c.id === chapter.id) + 1,
    chapters: chapters.length,
    plies,
  });
  return {
    title,
    description: extendDescription(comment ?? '', [facts, [copy.offer, copy.offerShort]], copy),
  };
}

/** Render the crawlable body for a public study, or for one chapter of it when
 *  `chapter` is given. Returns markup destined for `<div id="app">`; the client
 *  replaces it wholesale on boot. */
export function renderStudyBody(params: {
  study: StudyWithChapters;
  chapter?: StudyChapterRecord;
  locale: StudyPageLocale;
  /** '' for en, '/zh-hans' or '/zh-hant' otherwise. */
  localePath: string;
}): string {
  if (params.chapter) {
    return renderChapterBody({
      study: params.study,
      chapter: params.chapter,
      locale: params.locale,
      localePath: params.localePath,
    });
  }
  const { locale, localePath, study } = params;
  const name = localizedField(study.name, study.i18n, locale, 'name');
  const description = localizedField(study.description, study.i18n, locale, 'description');
  const chapters = [...study.chapters].sort((a, b) => a.ordinal - b.ordinal);

  const parts = [`<h1>${escapeHtml(name)}</h1>`];
  if (description.trim()) parts.push(`<p>${escapeHtml(description.trim())}</p>`);
  parts.push(`<p>${escapeHtml(LABELS[locale].chapters(chapters.length))}</p>`);
  if (chapters.length > 0) {
    const shown = chapters.slice(0, MAX_CHAPTERS);
    const items = shown.map((chapter) =>
      chapterListItem(chapter, { studyId: study.id, localePath, locale }),
    );
    parts.push(`<ol>${items.join('')}</ol>`);
  }
  return `<main>${parts.join('')}</main>`;
}

// A chapter permalink gets the chapter's own heading and its own prose, plus a
// link back to the study so the hub still collects the internal links. Comments
// run deeper here than in the study listing: this page exists to carry ONE
// composition's commentary, which is the only unique text it has.
const MAX_CHAPTER_PAGE_COMMENTS = 12;

function renderChapterBody(params: {
  study: StudyWithChapters;
  chapter: StudyChapterRecord;
  locale: StudyPageLocale;
  localePath: string;
}): string {
  const { chapter, locale, localePath, study } = params;
  const chapterName = localizedField(chapter.name, chapter.i18n, locale, 'name');
  const studyName = localizedField(study.name, study.i18n, locale, 'name');
  const studyHref = `${localePath}/study/${encodeURIComponent(study.id)}`;
  const plies = mainlinePlies(chapter.root);

  const parts = [
    `<h1>${escapeHtml(chapterName)}</h1>`,
    `<p><a href="${escapeHtml(studyHref)}">${escapeHtml(studyName)}</a></p>`,
  ];
  if (plies > 0) parts.push(`<p>${escapeHtml(LABELS[locale].moves(plies))}</p>`);
  for (const comment of mainlineComments(chapter.root, locale, MAX_CHAPTER_PAGE_COMMENTS)) {
    parts.push(`<p>${escapeHtml(comment)}</p>`);
  }
  return `<main>${parts.join('')}</main>`;
}

// The study list (/study, /zh-hans/study, /zh-hant/study). Until 2026-10-17 it
// served the empty shell with no canonical, so the one page that links every
// study gave a crawler nothing to follow, and the Chinese lists did not exist.
// This lists the same studies sitemap-studies.xml does, each with its title in
// the page's locale and its chapter count, linking the same-locale study page;
// the client's mountStudyIndex() clears the root before it draws the tabs and
// cards.
export type StudyIndexEntry = Pick<StudyRecord, 'id' | 'name' | 'i18n'> & { chapterCount: number };

/** The three study list URLs, each with the locale it renders in. */
export const STUDY_INDEX_PAGES: Readonly<
  Record<string, { locale: StudyPageLocale; localePath: string }>
> = {
  '/study': { locale: 'en', localePath: '' },
  '/zh-hans/study': { locale: 'zh-Hans', localePath: '/zh-hans' },
  '/zh-hant/study': { locale: 'zh-Hant', localePath: '/zh-hant' },
};

const STUDY_INDEX_COPY: Record<StudyPageLocale, { heading: string; intro: string }> = {
  en: {
    heading: 'Studies',
    intro:
      'Public studies on Mistboard: annotated games of xiangqi and its variants, classical endgame compositions, opening lines and puzzles, each on an interactive board with its moves and commentary.',
  },
  'zh-Hans': {
    heading: '研习',
    intro:
      'Mistboard 上的公开研习：象棋及其变体的带注解对局、古典残局排局、开局变着和题目，每一项都在互动棋盘上呈现，附着法和讲解。',
  },
  'zh-Hant': {
    heading: '研習',
    intro:
      'Mistboard 上的公開研習：象棋及其變體的帶註解對局、古典殘局排局、開局變著和題目，每一項都在互動棋盤上呈現，附著法和講解。',
  },
};

export function renderStudyIndexBody(
  studies: readonly StudyIndexEntry[],
  page: { locale: StudyPageLocale; localePath: string } = { locale: 'en', localePath: '' },
): string {
  const { locale, localePath } = page;
  const copy = STUDY_INDEX_COPY[locale];
  const items = studies.map((study) => {
    const name = localizedField(study.name, study.i18n, locale, 'name');
    const href = `${localePath}/study/${encodeURIComponent(study.id)}`;
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a> · ${escapeHtml(LABELS[locale].chapters(study.chapterCount))}</li>`;
  });
  return (
    `<main><h1>${escapeHtml(copy.heading)}</h1><p>${escapeHtml(copy.intro)}</p>` +
    (items.length > 0 ? `<ul>${items.join('')}</ul>` : '') +
    '</main>'
  );
}
