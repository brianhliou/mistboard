import assert from 'node:assert/strict';
import test from 'node:test';
import {
  backfillOptions,
  backfillReportLines,
  parseBackfillCliArgs,
} from './backfill-xiangqi-broadcast-translations.js';

test('translate-backfill command line is a dry run unless --apply is passed', () => {
  assert.deepEqual(backfillOptions(parseBackfillCliArgs([])), { dryRun: true });
  assert.deepEqual(backfillOptions(parseBackfillCliArgs(['--dry-run'])), { dryRun: true });
  assert.deepEqual(backfillOptions(parseBackfillCliArgs(['--apply'])), { dryRun: false });
  assert.deepEqual(
    backfillOptions(parseBackfillCliArgs(['--tour', '2026-north-american-championship'])),
    { dryRun: true, tourSlug: '2026-north-american-championship' },
  );
  assert.throws(() => parseBackfillCliArgs(['--apply', '--dry-run']), /contradict/);
  assert.throws(() => parseBackfillCliArgs(['--tour', ' ']), /needs a slug/);
  assert.throws(() => parseBackfillCliArgs(['--write']));
});

test('translate-backfill report prints each field old -> new', () => {
  const lines = backfillReportLines({
    dryRun: true,
    toursSeen: 1,
    roundsSeen: 2,
    boardsSeen: 3,
    changes: [
      {
        kind: 'board',
        id: 'b-1',
        fields: {
          'red.nameEn': { before: 'Fan Zhi', after: 'Fan Chi' },
          'details.matchEn': { before: null, after: 'Beijing-Jiangsu' },
        },
      },
    ],
  });
  assert.deepEqual(lines, [
    '  board=b-1 red.nameEn: Fan Zhi -> Fan Chi',
    '  board=b-1 details.matchEn: (none) -> Beijing-Jiangsu',
    'translate-backfill dry-run tours=1 rounds=2 boards=3 changed=1',
    'nothing written; re-run with --apply to write these changes',
  ]);
});
