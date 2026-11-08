// Content fingerprints keep `updatedAt` honest. Each published English article's
// reader text is hashed and the hash is committed beside the `updatedAt` it was
// recorded under (articles/content-fingerprints.json). A later edit to that text
// must either bump `updatedAt` (and write an `updateNote`) or be recorded as
// minor on purpose (`npm run articles:fingerprint -- --minor <slug>`), so a
// page can no longer change under a reader while its date says it did not.
//
// What counts as reader text: everything articleProse reads (title, summary,
// TL;DR, method box, intro, headings, paragraphs, captions, stepper narratives,
// FAQ pairs, CTA labels, table cells with words) plus the numeric table cells
// articleProse leaves out because they need no translation. A changed number
// in a table is exactly the edit a returning reader cares about.
//
// Blind spots, on purpose: SVG diagrams and their labels, board positions and
// replay move lists, move-notation step narratives, thumbnails, links' targets
// outside the text (embed paths, image src), seoTitle, and every translation.
// A diagram-only correction does not move the hash (articles-fingerprint.test.ts
// pins that), so a session fixing a diagram still has to bump the date itself.
//
// A page dated into the future (queued for its Tuesday or Friday) has had no
// reader yet, so an edit to it is never silent: the update records it without
// --minor, and the check only asks for the file to be re-recorded.

import { createHash } from 'node:crypto';
import { articleProse } from './article-prose.js';
import { articleIsLive } from './articles/publish-time.js';
import type { Article, ArticleBlock } from './articles-data.js';

export const ARTICLE_FINGERPRINT_FILE = 'apps/web/src/articles/content-fingerprints.json';
export const ARTICLE_FINGERPRINT_COMMAND = 'npm run articles:fingerprint';

export type FingerprintRecord = { hash: string; updatedAt: string | null };
export type FingerprintRecords = Record<string, FingerprintRecord>;

function numericTableCells(blocks: readonly ArticleBlock[] | undefined): string[] {
  const out: string[] = [];
  for (const block of blocks ?? []) {
    if (block.kind !== 'table') continue;
    const table = block as { headers?: string[]; rows?: string[][] };
    for (const cell of [...(table.headers ?? []), ...(table.rows ?? []).flat()]) {
      if (!/\p{Script=Latin}/u.test(cell)) out.push(cell);
    }
  }
  return out;
}

/** The text a reader sees, whitespace-normalized, one string per field. */
export function articleReaderText(article: Article): string {
  const lines = articleProse(article).map((p) => p.text);
  lines.push(...numericTableCells(article.intro));
  for (const section of article.sections) lines.push(...numericTableCells(section.blocks));
  return lines.map((line) => line.replace(/\s+/g, ' ').trim()).join('\n');
}

export function articleContentHash(article: Article): string {
  return createHash('sha256').update(articleReaderText(article)).digest('hex').slice(0, 16);
}

/** Pages the guard covers: published English originals (rules and articles). */
export function fingerprintedArticles(all: readonly Article[]): Article[] {
  return all.filter((a) => a.status === 'published' && !a.sourceLang);
}

export type FingerprintCheck = {
  /** Reader text changed while `updatedAt` stayed what was recorded. */
  silentEdits: string[];
  /** The file is behind: a new page, a bumped date, or a page no longer covered. */
  unrecorded: string[];
};

export function checkFingerprints(
  all: readonly Article[],
  recorded: FingerprintRecords,
  now: number = Date.now(),
): FingerprintCheck {
  const silentEdits: string[] = [];
  const unrecorded: string[] = [];
  const covered = fingerprintedArticles(all);
  for (const article of covered) {
    const record = recorded[article.slug];
    const updatedAt = article.updatedAt ?? null;
    if (!record) {
      unrecorded.push(`${article.slug}: no fingerprint recorded`);
      continue;
    }
    const hash = articleContentHash(article);
    if (hash !== record.hash && updatedAt === record.updatedAt && articleIsLive(article, now)) {
      silentEdits.push(article.slug);
    } else if (hash !== record.hash || updatedAt !== record.updatedAt) {
      unrecorded.push(
        updatedAt === record.updatedAt
          ? `${article.slug}: edited before it went live`
          : `${article.slug}: updatedAt ${record.updatedAt ?? 'unset'} -> ${updatedAt ?? 'unset'}`,
      );
    }
  }
  const slugs = new Set(covered.map((a) => a.slug));
  for (const slug of Object.keys(recorded)) {
    if (!slugs.has(slug)) unrecorded.push(`${slug}: recorded but no longer a published page`);
  }
  return { silentEdits, unrecorded };
}

export type FingerprintUpdate = {
  records: FingerprintRecords;
  /** Silent edits not named in `minor`: their old record is kept. */
  refused: string[];
  /** `minor` slugs that had no silent edit to accept. */
  unusedMinor: string[];
};

/**
 * The records to commit. A date bump is recorded on its own; a text change
 * under an unchanged date is recorded only when its slug is in `minor`.
 */
export function updateFingerprints(
  all: readonly Article[],
  recorded: FingerprintRecords,
  minor: ReadonlySet<string>,
  now: number = Date.now(),
): FingerprintUpdate {
  const records: FingerprintRecords = {};
  const refused: string[] = [];
  const accepted = new Set<string>();
  const covered = [...fingerprintedArticles(all)].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const article of covered) {
    const hash = articleContentHash(article);
    const updatedAt = article.updatedAt ?? null;
    const record = recorded[article.slug];
    if (
      record &&
      hash !== record.hash &&
      updatedAt === record.updatedAt &&
      articleIsLive(article, now)
    ) {
      if (minor.has(article.slug)) {
        accepted.add(article.slug);
      } else {
        refused.push(article.slug);
        records[article.slug] = record;
        continue;
      }
    }
    records[article.slug] = { hash, updatedAt };
  }
  const unusedMinor = [...minor].filter((slug) => !accepted.has(slug));
  return { records, refused, unusedMinor };
}

export function renderFingerprints(records: FingerprintRecords): string {
  const sorted = Object.fromEntries(
    Object.keys(records)
      .sort((a, b) => a.localeCompare(b))
      .map((slug) => [slug, records[slug]]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function silentEditMessage(slugs: readonly string[]): string {
  return [
    `Reader text changed but updatedAt did not: ${slugs.join(', ')}.`,
    'Bump `updatedAt` and write an `updateNote` saying what changed,',
    `or record the edit as minor with \`${ARTICLE_FINGERPRINT_COMMAND} -- --minor <slug>\`.`,
  ].join('\n');
}
