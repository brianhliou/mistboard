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

import type { StudyChapterRecord, StudyWithChapters } from './persistence-studies.js';

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

/** How much prose a chapter must carry before its permalink is worth advertising
 *  in the sitemap. A one-ply chapter with no comment is a thin near-duplicate of
 *  its siblings, and a sitemap full of those reads as low quality. This is also
 *  the honest gate: the defective endgame volumes are exactly the chapters that
 *  fail it, so the indexable set grows as the restoration lands rather than
 *  advertising work that is not done. */
export function chapterIsSubstantial(chapter: StudyChapterRecord): boolean {
  if (mainlinePlies(chapter.root) >= MIN_INDEXABLE_PLIES) return true;
  return mainlineComments(chapter.root, 'en', 1).length > 0;
}

/** Whether any move on the mainline carries a comment: annotation a reader came
 *  for, as opposed to the root comment, which on an imported chapter is its
 *  title, problem number and source line. Sampled 2026-09-25, 74 of 80 listed
 *  chapters had nothing but that root line, so the page was a title, a move
 *  count and a citation. */
export function chapterHasMoveCommentary(chapter: StudyChapterRecord): boolean {
  const root = treeRoot(chapter.root);
  let node = root ? nodeChildren(root)[0] : undefined;
  while (node && typeof node.uci === 'string') {
    const comments = node.annotations?.comments;
    if (Array.isArray(comments) && comments.some((raw) => commentText(raw, 'en'))) return true;
    node = nodeChildren(node)[0];
  }
  return false;
}

const MIN_INDEXABLE_PLIES = 4;

/** Per-chapter page meta for a chapter permalink. Without this every chapter of
 *  a 66-composition study serves the study's own title and description, which is
 *  a set of near-identical pages. */
export function chapterPageMeta(params: {
  study: StudyWithChapters;
  chapter: StudyChapterRecord;
  locale: StudyPageLocale;
}): { title: string; description: string } {
  const { chapter, locale, study } = params;
  const chapterName = localizedField(chapter.name, chapter.i18n, locale, 'name');
  const studyName = localizedField(study.name, study.i18n, locale, 'name');
  const comment = mainlineComments(chapter.root, locale, 1)[0];
  const plies = mainlinePlies(chapter.root);
  const fallback = plies > 0 ? `${studyName}. ${LABELS[locale].moves(plies)}.` : studyName;
  return {
    title: `${chapterName} | ${studyName}`,
    description: comment ?? fallback,
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
