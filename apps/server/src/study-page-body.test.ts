import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { StudyChapterRecord, StudyWithChapters } from './persistence-studies.js';
import {
  chapterHasMoveCommentary,
  chapterIsSubstantial,
  chapterPageMeta,
  renderStudyBody,
} from './study-page-body.js';

const NOW = new Date('2026-08-08T00:00:00Z');

function chapter(overrides: Partial<StudyChapterRecord> = {}): StudyChapterRecord {
  return {
    id: 'ch1',
    studyId: 'S1',
    ordinal: 0,
    name: 'Chapter one',
    i18n: {},
    variant: 'xiangqi',
    orientation: 'red',
    root: { version: 1, root: { children: [] } },
    tags: {},
    denorm: {},
    version: 0,
    gamebook: false,
    practice: false,
    practiceGoal: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function study(overrides: Partial<StudyWithChapters> = {}): StudyWithChapters {
  return {
    id: 'S1',
    ownerId: 'u1',
    slug: null,
    name: 'A study',
    description: 'About the study.',
    i18n: {},
    visibility: 'public',
    featuredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    chapters: [chapter()],
    ...overrides,
  };
}

/** A mainline of `n` plies, optionally hanging comments off the first move. */
function mainline(n: number, comments?: { text: string; i18n?: Record<string, string> }[]) {
  let node: Record<string, unknown> = { children: [] };
  for (let i = n; i >= 1; i -= 1) {
    const next: Record<string, unknown> = { uci: `a${i}a${i}`, children: [node] };
    if (i === 1 && comments) next.annotations = { comments };
    node = next;
  }
  return { version: 1, root: { children: n > 0 ? [node] : [] } };
}

test('renders the study heading, description and chapter count', () => {
  const html = renderStudyBody({ study: study(), locale: 'en', localePath: '' });
  assert.match(html, /<h1>A study<\/h1>/);
  assert.match(html, /<p>About the study\.<\/p>/);
  assert.match(html, /<p>1 chapter<\/p>/);
});

test('each chapter links to its own permalink under the active locale', () => {
  const html = renderStudyBody({
    study: study({ chapters: [chapter({ id: 'cAA', name: 'Seven Stars' })] }),
    locale: 'zh-Hant',
    localePath: '/zh-hant',
  });
  assert.match(html, /<a href="\/zh-hant\/study\/S1\/cAA">Seven Stars<\/a>/);
});

// The classical manuals are authored Chinese-first: the base column holds what
// the woodblock prints and English is an OVERLAY. Treating 'en' as a synonym for
// the base column would serve Chinese titles to English readers.
test('the en overlay wins over a Chinese base column', () => {
  const s = study({
    name: '橘中秘 卷一',
    description: '得先',
    i18n: { en: { name: 'Secret in the Tangerine, Vol. 1', description: 'Games at odds' } },
    chapters: [chapter({ name: '大列手砲局', i18n: { en: { name: 'Great Cannon Duel' } } })],
  });
  const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.match(html, /Secret in the Tangerine, Vol\. 1/);
  assert.match(html, /Games at odds/);
  assert.match(html, /Great Cannon Duel/);
  assert.doesNotMatch(html, /橘中秘/);
});

test('a zh locale falls back to the base column and uses zh scaffolding', () => {
  const s = study({
    name: '橘中秘 卷一',
    description: '',
    i18n: { en: { name: 'Secret in the Tangerine, Vol. 1' } },
    chapters: [chapter({ name: '大列手砲局' })],
  });
  const html = renderStudyBody({ study: s, locale: 'zh-Hant', localePath: '/zh-hant' });
  assert.match(html, /<h1>橘中秘 卷一<\/h1>/);
  assert.match(html, /1 章/);
  assert.doesNotMatch(html, /chapter/);
});

test('counts mainline plies and surfaces mainline comments', () => {
  const s = study({
    chapters: [
      chapter({
        root: mainline(13, [{ text: '紅先勝', i18n: { en: 'Red moves first and wins' } }]),
      }),
    ],
  });
  const en = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.match(en, /13 moves/);
  assert.match(en, /Red moves first and wins/);

  const zh = renderStudyBody({ study: s, locale: 'zh-Hant', localePath: '/zh-hant' });
  assert.match(zh, /13 手/);
  assert.match(zh, /紅先勝/);
});

test('a one-ply chapter reads as one move, not zero', () => {
  const s = study({ chapters: [chapter({ root: mainline(1) })] });
  const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.match(html, /1 move</);
});

test('a chapter with no moves omits the move count rather than printing zero', () => {
  const html = renderStudyBody({ study: study(), locale: 'en', localePath: '' });
  assert.doesNotMatch(html, /0 moves/);
});

test('chapters render in ordinal order regardless of array order', () => {
  const s = study({
    chapters: [
      chapter({ id: 'c3', ordinal: 2, name: 'Third' }),
      chapter({ id: 'c1', ordinal: 0, name: 'First' }),
      chapter({ id: 'c2', ordinal: 1, name: 'Second' }),
    ],
  });
  const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.ok(html.indexOf('First') < html.indexOf('Second'));
  assert.ok(html.indexOf('Second') < html.indexOf('Third'));
});

test('author-supplied text is escaped', () => {
  const s = study({
    name: '<script>alert(1)</script>',
    description: 'a & b "quoted"',
    chapters: [chapter({ name: '<img src=x>' })],
  });
  const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b &quot;quoted&quot;/);
});

// The tree blob is `unknown` at the type level and old/corrupt blobs exist in
// the wild; a study page must degrade rather than 500.
test('a malformed or missing tree blob degrades instead of throwing', () => {
  for (const root of [null, undefined, 'nonsense', {}, { version: 1 }, { root: 42 }]) {
    const s = study({ chapters: [chapter({ root })] });
    const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
    assert.match(html, /Chapter one/);
  }
});

// --- chapter permalinks -------------------------------------------------------

test('a chapter permalink renders the chapter, not the study listing', () => {
  const ch = chapter({
    id: 'cX',
    name: 'Seven Stars',
    root: mainline(61, [{ text: 'Red to play and draw.' }]),
  });
  const s = study({ name: 'Endgames', chapters: [ch, chapter({ id: 'cY', name: 'Other' })] });
  const html = renderStudyBody({ study: s, chapter: ch, locale: 'en', localePath: '' });
  assert.match(html, /<h1>Seven Stars<\/h1>/);
  assert.match(html, /61 moves/);
  assert.match(html, /Red to play and draw\./);
  // Links back to the hub, and does not re-list its sibling chapters.
  assert.match(html, /<a href="\/study\/S1">Endgames<\/a>/);
  assert.doesNotMatch(html, /Other/);
});

test('chapter meta is the chapter title and its own prose', () => {
  const ch = chapter({
    name: '七星聚會',
    i18n: { en: { name: 'Seven Stars' } },
    root: mainline(61, [{ text: '紅先和', i18n: { en: 'Red moves first and draws.' } }]),
  });
  const s = study({
    name: '排局',
    i18n: { en: { name: 'Compositions' } },
    chapters: [ch],
  });
  const en = chapterPageMeta({ study: s, chapter: ch, locale: 'en' });
  assert.equal(en.title, 'Seven Stars | Compositions');
  assert.equal(en.description, 'Red moves first and draws.');

  const zh = chapterPageMeta({ study: s, chapter: ch, locale: 'zh-Hant' });
  assert.equal(zh.title, '七星聚會 | 排局');
  assert.equal(zh.description, '紅先和');
});

test('a chapter with no comment falls back to study name and length', () => {
  const ch = chapter({ name: 'Untitled', root: mainline(9) });
  const meta = chapterPageMeta({ study: study({ chapters: [ch] }), chapter: ch, locale: 'en' });
  assert.equal(meta.description, 'A study. 9 moves.');
});

// The sitemap gate. A one-ply chapter with no commentary is the shape the
// defective endgame volumes shipped in; advertising those as indexable pages
// would be claiming work that has not been done.
test('chapter substance gates on plies or commentary, not on existing', () => {
  assert.equal(chapterIsSubstantial(chapter({ root: mainline(20) })), true);
  assert.equal(chapterIsSubstantial(chapter({ root: mainline(4) })), true);
  assert.equal(chapterIsSubstantial(chapter({ root: mainline(1) })), false);
  assert.equal(chapterIsSubstantial(chapter({ root: mainline(0) })), false);
  // A short entry that carries real commentary is still worth a URL.
  assert.equal(
    chapterIsSubstantial(chapter({ root: mainline(1, [{ text: 'A genuine one-move entry.' }]) })),
    true,
  );
});

// An imported chapter's root comment is its title and source line; only a
// comment on a move is commentary a reader came for.
test('move commentary means a comment on a move, not on the root', () => {
  assert.equal(chapterHasMoveCommentary(chapter({ root: mainline(20) })), false);
  assert.equal(
    chapterHasMoveCommentary(chapter({ root: mainline(6, [{ text: 'The key sacrifice.' }]) })),
    true,
  );
  const rootOnly = {
    version: 1,
    root: {
      annotations: { comments: [{ text: 'Problem 198. Transcribed from dpxq.' }] },
      children: mainline(6).root.children,
    },
  };
  assert.equal(chapterHasMoveCommentary(chapter({ root: rootOnly })), false);
  assert.equal(chapterHasMoveCommentary(chapter({ root: mainline(3, [{ text: '  ' }]) })), false);
});

// serveStudyPage injects the body by string-replacing this exact anchor in the
// shell. If the markup drifts (an added class, a self-closing form, a different
// id) the replace becomes a silent no-op and every study page quietly reverts to
// serving a title and nothing else. Fail here instead, at the source of truth.
test('the SPA shell still carries the exact anchor the body is injected into', async () => {
  const shell = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'index.html');
  const html = await readFile(shell, 'utf-8');
  assert.ok(
    html.includes('<div id="app"></div>'),
    'apps/web/index.html no longer contains `<div id="app"></div>`; update the injection in serveStudyPage',
  );
});

test('a long comment is truncated', () => {
  const long = 'x'.repeat(500);
  const s = study({ chapters: [chapter({ root: mainline(2, [{ text: long }]) })] });
  const html = renderStudyBody({ study: s, locale: 'en', localePath: '' });
  assert.doesNotMatch(html, /x{400}/);
  assert.match(html, /…/);
});
