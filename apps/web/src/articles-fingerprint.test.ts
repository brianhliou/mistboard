import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARTICLE_FINGERPRINT_COMMAND,
  ARTICLE_FINGERPRINT_FILE,
  articleContentHash,
  checkFingerprints,
  type FingerprintRecords,
  renderFingerprints,
  silentEditMessage,
  updateFingerprints,
} from './article-fingerprint.js';
import { type Article, articles } from './articles-data.js';

// `npm run articles:fingerprint [-- --minor <slug> ...]` runs this file with
// UPDATE_ARTICLE_FINGERPRINTS=1 (scripts/article-fingerprints.mjs).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fingerprintPath = resolve(repoRoot, ARTICLE_FINGERPRINT_FILE);

function readRecords(): FingerprintRecords {
  return existsSync(fingerprintPath)
    ? (JSON.parse(readFileSync(fingerprintPath, 'utf-8')) as FingerprintRecords)
    : {};
}

describe('article content fingerprints', () => {
  it('reader text changes come with an updatedAt bump or a recorded minor edit', () => {
    if (process.env.UPDATE_ARTICLE_FINGERPRINTS === '1') {
      const minor = new Set(
        (process.env.ARTICLE_FINGERPRINT_MINOR ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      const update = updateFingerprints(articles, readRecords(), minor);
      writeFileSync(fingerprintPath, renderFingerprints(update.records));
      expect(update.unusedMinor, '--minor named a slug with no silent edit to accept').toEqual([]);
      expect(update.refused, silentEditMessage(update.refused)).toEqual([]);
    }
    const check = checkFingerprints(articles, readRecords());
    expect(check.silentEdits, silentEditMessage(check.silentEdits)).toEqual([]);
    expect(
      check.unrecorded,
      `${ARTICLE_FINGERPRINT_FILE} is behind: run \`${ARTICLE_FINGERPRINT_COMMAND}\` and commit the result`,
    ).toEqual([]);
  });
});

// The planted failures: a fixture article edited three ways, each of which the
// guard must classify correctly, or the check above could pass while blind.
describe('article fingerprint guard (planted failures)', () => {
  const base: Article = {
    kind: 'article',
    publisher: 'mistboard',
    slug: 'fixture-post',
    title: 'Fixture post',
    summary: 'A post that exists to be edited.',
    status: 'published',
    audience: 'Tests.',
    publishedAt: '2026-09-01',
    updatedAt: '2026-09-10',
    updateNote: 'Added a table.',
    sections: [
      {
        heading: 'Results',
        blocks: [
          { kind: 'paragraph', text: 'Red scores 0.52 over 200 games.' },
          { kind: 'table', headers: ['Run', 'Score'], rows: [['A', '0.52']] } as never,
          { kind: 'raw-svg', svg: '<svg><text>0.52</text></svg>', caption: 'The run.' } as never,
        ],
      },
    ],
  } as Article;
  const recorded: FingerprintRecords = {
    'fixture-post': { hash: articleContentHash(base), updatedAt: '2026-09-10' },
  };
  const withSections = (sections: Article['sections'], extra: Partial<Article> = {}): Article =>
    ({ ...base, ...extra, sections }) as Article;

  it('passes the article as recorded', () => {
    expect(checkFingerprints([base], recorded)).toEqual({ silentEdits: [], unrecorded: [] });
  });

  it('catches a prose change without a date bump', () => {
    const edited = withSections([
      {
        heading: 'Results',
        blocks: [
          { kind: 'paragraph', text: 'Red scores 0.55 over 200 games.' },
          ...(base.sections[0].blocks ?? []).slice(1),
        ],
      },
    ]);
    expect(checkFingerprints([edited], recorded).silentEdits).toEqual(['fixture-post']);
    const update = updateFingerprints([edited], recorded, new Set());
    expect(update.refused).toEqual(['fixture-post']);
    expect(update.records['fixture-post']).toEqual(recorded['fixture-post']);
  });

  it('catches a number changed only in a table cell', () => {
    const blocks = base.sections[0].blocks ?? [];
    const edited = withSections([
      {
        heading: 'Results',
        blocks: [
          blocks[0],
          { kind: 'table', headers: ['Run', 'Score'], rows: [['A', '0.48']] } as never,
          blocks[2],
        ],
      },
    ]);
    expect(checkFingerprints([edited], recorded).silentEdits).toEqual(['fixture-post']);
  });

  it('a date bump is not a silent edit, and the update records it without --minor', () => {
    const edited = withSections(
      [{ heading: 'Results and a correction', blocks: base.sections[0].blocks }],
      { updatedAt: '2026-10-01', updateNote: 'Corrected the heading.' },
    );
    const check = checkFingerprints([edited], recorded);
    expect(check.silentEdits).toEqual([]);
    const update = updateFingerprints([edited], recorded, new Set());
    expect(update.refused).toEqual([]);
    expect(update.records['fixture-post']).toEqual({
      hash: articleContentHash(edited),
      updatedAt: '2026-10-01',
    });
  });

  it('--minor accepts a silent edit and nothing else', () => {
    const edited = withSections([{ heading: 'Results.', blocks: base.sections[0].blocks }]);
    const update = updateFingerprints([edited], recorded, new Set(['fixture-post', 'other']));
    expect(update.refused).toEqual([]);
    expect(update.unusedMinor).toEqual(['other']);
    expect(update.records['fixture-post'].hash).toBe(articleContentHash(edited));
    expect(checkFingerprints([edited], update.records)).toEqual({
      silentEdits: [],
      unrecorded: [],
    });
  });

  it('whitespace and the update note do not move the hash', () => {
    const reflowed = withSections(
      [
        {
          heading: 'Results',
          blocks: [
            { kind: 'paragraph', text: 'Red scores 0.52\n  over 200 games. ' },
            ...(base.sections[0].blocks ?? []).slice(1),
          ],
        },
      ],
      { updateNote: 'A different note.' },
    );
    expect(articleContentHash(reflowed)).toBe(articleContentHash(base));
  });

  // Known blind spot, pinned so it is a decision and not a surprise: a change
  // inside an SVG diagram (here its label) leaves the reader-text hash alone.
  it('does not see a diagram-only change (blind spot)', () => {
    const blocks = base.sections[0].blocks ?? [];
    const edited = withSections([
      {
        heading: 'Results',
        blocks: [
          blocks[0],
          blocks[1],
          { kind: 'raw-svg', svg: '<svg><text>0.61</text></svg>', caption: 'The run.' } as never,
        ],
      },
    ]);
    expect(articleContentHash(edited)).toBe(articleContentHash(base));
  });

  it('lets a page edit itself freely until it goes live', () => {
    const queued = {
      ...base,
      publishedAt: '2099-01-06',
      updatedAt: undefined,
      updateNote: undefined,
    } as Article;
    const queuedRecord: FingerprintRecords = {
      'fixture-post': { hash: articleContentHash(queued), updatedAt: null },
    };
    const edited = { ...queued, title: 'Fixture post, retitled' } as Article;
    const check = checkFingerprints([edited], queuedRecord);
    expect(check.silentEdits).toEqual([]);
    expect(check.unrecorded).toEqual(['fixture-post: edited before it went live']);
    const update = updateFingerprints([edited], queuedRecord, new Set());
    expect(update.refused).toEqual([]);
    // The same edit once the page is live is a silent edit again.
    const live = Date.parse('2099-01-07T00:00:00Z');
    expect(checkFingerprints([edited], queuedRecord, live).silentEdits).toEqual(['fixture-post']);
  });

  it('reports a new page and a dropped page as unrecorded, not as silent edits', () => {
    const fresh = { ...base, slug: 'fresh-post' } as Article;
    const check = checkFingerprints([fresh], recorded);
    expect(check.silentEdits).toEqual([]);
    expect(check.unrecorded).toEqual([
      'fresh-post: no fingerprint recorded',
      'fixture-post: recorded but no longer a published page',
    ]);
  });
});
