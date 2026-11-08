import assert from 'node:assert/strict';
import test from 'node:test';
import { crawlerFixtureSources } from './crawler-content-fixtures.js';
import type { PublicStudySummary } from './persistence.js';

test('crawler study summaries keep legacy chapter names aligned with localized previews', async () => {
  const studies = await crawlerFixtureSources().listPublicStudies!();
  assert.ok(studies.length > 0);
  const assertChapterNames = (study: {
    chapterNames?: string[];
    chapterPreview: PublicStudySummary['chapterPreview'];
  }) =>
    assert.deepEqual(
      study.chapterNames,
      study.chapterPreview.map((chapter) => chapter.name),
    );
  for (const study of studies) assertChapterNames(study);

  // Planted regressions: the missing field that broke the build, and stale names.
  const { chapterPreview } = studies[0]!;
  assert.throws(() => assertChapterNames({ chapterPreview }), assert.AssertionError);
  assert.throws(
    () => assertChapterNames({ chapterPreview, chapterNames: ['Stale chapter'] }),
    assert.AssertionError,
  );
});
