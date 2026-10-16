import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitLink,
  currentMonth,
  insertChangelogEntries,
  parseChangelogArg,
  previewInsertion,
} from './lib/changelog-entry.mjs';

const HASH = 'abc12345';
const LINK = commitLink(HASH);

const FILE = `# Changelog

Preamble with a ## 2026-01 mention that is not a heading.

## 2026-09

### Playing

- Old playing line ([11111111](https://github.com/brianhliou/mistboard/commit/11111111))

### Fixed

- Old fix ([22222222](https://github.com/brianhliou/mistboard/commit/22222222))

## 2026-08

### Site

- August line ([33333333](https://github.com/brianhliou/mistboard/commit/33333333))
`;

const insert = (entries, month = '2026-09') =>
  insertChangelogEntries(FILE, { month, entries, shortHash: HASH });

test('parseChangelogArg splits on the first colon and canonicalises the heading', () => {
  assert.deepEqual(parseChangelogArg('learning and puzzles: Puzzles: now with hints'), {
    heading: 'Learning and puzzles',
    text: 'Puzzles: now with hints',
  });
});

test('parseChangelogArg rejects an unknown heading, an em dash, a period and a link', () => {
  assert.throws(() => parseChangelogArg('Features: x'), /not one of: Playing/);
  assert.throws(() => parseChangelogArg('no colon here'), /expects "<Heading>: <line>"/);
  assert.throws(() => parseChangelogArg('Site: a — b'), /em dash/);
  assert.throws(() => parseChangelogArg('Site: ends in a period.'), /trailing period/);
  assert.throws(() => parseChangelogArg('Site: '), /empty/);
  assert.throws(
    () => parseChangelogArg('Site: x ([abc1234](https://github.com/a/b/commit/abc1234))'),
    /leave out the commit link/,
  );
});

test('a line goes at the top of an existing heading, with the commit link appended', () => {
  const out = insert([{ heading: 'Playing', text: 'New thing' }]);
  assert.ok(out.includes(`### Playing\n\n- New thing ${LINK}\n- Old playing line`));
  assert.equal(LINK, `([${HASH}](https://github.com/brianhliou/mistboard/commit/${HASH}))`);
  assert.ok(out.indexOf('- New thing') < out.indexOf('- Old playing line'));
  assert.ok(out.endsWith('\n'));
});

test('several lines keep their given order and group under their headings', () => {
  const out = insert([
    { heading: 'Fixed', text: 'Fix one' },
    { heading: 'Playing', text: 'Play one' },
    { heading: 'Fixed', text: 'Fix two' },
  ]);
  const fixed = out.slice(out.indexOf('### Fixed'));
  assert.ok(fixed.indexOf('- Fix one') < fixed.indexOf('- Fix two'));
  assert.ok(fixed.indexOf('- Fix two') < fixed.indexOf('- Old fix'));
  assert.ok(out.indexOf('- Play one') < out.indexOf('### Fixed'));
});

test('a missing heading is created in canonical order inside the month', () => {
  const out = insert([
    { heading: 'Technical', text: 'Tech' },
    { heading: 'Watching and review', text: 'Watch' },
  ]);
  const sep = out.slice(out.indexOf('## 2026-09'), out.indexOf('## 2026-08'));
  const headings = [...sep.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, ['Playing', 'Watching and review', 'Fixed', 'Technical']);
  assert.match(sep, /### Watching and review\n\n- Watch .+\n\n### Fixed/);
  assert.match(sep, /### Technical\n\n- Tech .+\n\n$/);
  // August is untouched.
  assert.ok(out.endsWith(FILE.slice(FILE.indexOf('## 2026-08'))));
});

test('a missing month is created above the newest older month', () => {
  const out = insert([{ heading: 'Site', text: 'October line' }], '2026-10');
  assert.match(out, /\n## 2026-10\n\n### Site\n\n- October line .+\n\n## 2026-09\n/);
  assert.ok(out.startsWith(FILE.slice(0, FILE.indexOf('## 2026-09'))));
});

test('a month heading mentioned inline in the preamble is not mistaken for one', () => {
  const out = insert([{ heading: 'Site', text: 'x' }], '2026-10');
  assert.ok(out.indexOf('## 2026-10') > out.indexOf('Preamble'));
});

test('the only insertions are the new lines (nothing removed or rewritten)', () => {
  const out = insert([{ heading: 'Removed', text: 'Gone' }]);
  const before = FILE.split('\n');
  const after = out.split('\n');
  let cursor = 0;
  for (const line of after) if (line === before[cursor]) cursor += 1;
  assert.equal(cursor, before.length);
});

test('previewInsertion shows the added lines with a little context', () => {
  const out = insert([{ heading: 'Playing', text: 'New thing' }]);
  const preview = previewInsertion(FILE, out);
  assert.match(preview, /^ {2}### Playing\n {2}\n\+ - New thing/m);
});

test('currentMonth formats local year and month', () => {
  assert.equal(currentMonth(new Date(2026, 8, 30)), '2026-09');
  assert.equal(currentMonth(new Date(2026, 11, 1)), '2026-12');
});
