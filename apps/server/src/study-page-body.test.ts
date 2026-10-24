import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { StudyChapterRecord, StudyWithChapters } from './persistence-studies.js';
import { SEO_TITLE_MIN, seoMetaLengthProblems, seoTextLength } from './seo-meta-length.js';
import {
  chapterPageMeta,
  renderStudyBody,
  studyDescriptionMeetsFloor,
  studyPageMeta,
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
  const longEn =
    'Red moves first and draws: the seven pieces converge on the palace and every capture is forced, so the line runs to the end.';
  const ch = chapter({
    name: '七星聚會',
    i18n: { en: { name: 'Seven Stars' } },
    root: mainline(61, [{ text: '紅先和', i18n: { en: longEn } }]),
  });
  const s = study({
    name: '排局',
    i18n: { en: { name: 'Compositions' } },
    chapters: [ch],
  });
  const en = chapterPageMeta({ study: s, chapter: ch, locale: 'en' });
  assert.equal(en.title, 'Seven Stars · Compositions | Mistboard');
  // At or above the floor: served exactly as written.
  assert.equal(en.description, longEn);

  const zh = chapterPageMeta({ study: s, chapter: ch, locale: 'zh-Hant' });
  assert.equal(zh.title, '七星聚會 · 排局 | Mistboard');
  // Under the floor: the chapter's own prose leads, then facts the page shows.
  assert.ok(zh.description.startsWith('紅先和。'), zh.description);
  assert.deepEqual(seoMetaLengthProblems('zh chapter', zh), []);
});

test('a chapter with no comment falls back to study name and length, at the floor', () => {
  const ch = chapter({ name: 'Untitled', root: mainline(9) });
  const meta = chapterPageMeta({ study: study({ chapters: [ch] }), chapter: ch, locale: 'en' });
  assert.equal(
    meta.description,
    'Chapter 1 of 1 in A study, a xiangqi study, 9 moves long. Open it on an interactive board and step forward and back through every move.',
  );
  assert.deepEqual(seoMetaLengthProblems('en chapter', meta), []);
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

// ── Page meta floors (Bing, 2026-10) ─────────────────────────────────────────
// The three pages the crawl named: a 22-character zh blurb, a one-chapter study
// with a 21-character title, and a chapter whose fallback read "<study>. 58 moves.".

const HORSE_ZH = '马走得慢，还会被蹩腿。用马取胜，考的是时机。';

function horseEndgames(): StudyWithChapters {
  return study({
    name: 'Horse endgames',
    description:
      'The horse is slow and its leg can be blocked. Converting with one is a question of timing.',
    i18n: { 'zh-Hans': { name: '马类残局', description: HORSE_ZH } },
    chapters: [
      chapter({
        id: 'a',
        ordinal: 0,
        name: 'Horse vs advisor',
        i18n: { 'zh-Hans': { name: '马胜单士' } },
        root: mainline(23),
      }),
      chapter({
        id: 'b',
        ordinal: 1,
        name: 'Horse vs elephant',
        i18n: { 'zh-Hans': { name: '马胜单象' } },
        root: mainline(31),
      }),
    ],
  });
}

test('a zh study blurb under the floor is extended to meet it, keeping its own text first', () => {
  const meta = studyPageMeta({ study: horseEndgames(), locale: 'zh-Hans' });
  assert.ok(meta.description.startsWith(HORSE_ZH), meta.description);
  assert.deepEqual(seoMetaLengthProblems('zh study', meta), []);
  assert.ok([...meta.description].length <= 160, meta.description);
  assert.match(meta.description, /象棋研习，共 2 章、54 手/);
  assert.doesNotMatch(meta.description, /[A-Za-z]{3,}/, 'zh page, zh scaffolding');
});

test('a study description at or above the floor is served unchanged', () => {
  const long =
    'Twelve classical horse endgames from the Ming manuals, each with the winning method explained move by move and the common defensive tries refuted.';
  const meta = studyPageMeta({ study: study({ description: long }), locale: 'en' });
  assert.equal(meta.description, long);
  assert.ok(studyDescriptionMeetsFloor(long));
});

test('a study with no description gets a localized one, not English on a zh page', () => {
  const s = study({ name: '王子耿', description: '', chapters: [chapter({ root: mainline(40) })] });
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const meta = studyPageMeta({ study: s, locale });
    assert.deepEqual(seoMetaLengthProblems(locale, meta), [], locale);
  }
  assert.doesNotMatch(studyPageMeta({ study: s, locale: 'zh-Hant' }).description, /study/);
});

test('a short study title gets a variant suffix, stays under 65 and ends in Mistboard', () => {
  const s = study({ name: '王子耿', description: '', chapters: [chapter()] });
  const en = studyPageMeta({ study: s, locale: 'en' });
  assert.equal(en.title, '王子耿 · Xiangqi study | Mistboard');
  assert.equal(
    studyPageMeta({ study: s, locale: 'zh-Hans' }).title,
    '王子耿 · 象棋研习 | Mistboard',
  );
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const { title } = studyPageMeta({ study: s, locale });
    assert.ok(seoTextLength(title) >= SEO_TITLE_MIN, title);
    assert.ok([...title].length <= 65, title);
    assert.ok(title.endsWith('| Mistboard'), title);
  }
  // A title already long enough keeps its old form.
  assert.equal(
    studyPageMeta({ study: horseEndgames(), locale: 'en' }).title,
    'Horse endgames | Mistboard study',
  );
});

const JQE_STUDY = 'jqe vs AB-JChess 0.2d: 300 games at 4 s a move';
const JQE_CHAPTER = 'Pair 5b: jqe it014 (red) vs AB-JChess 0.2d, 0-1, checkmate';

function jqeStudy(root = mainline(58)): { s: StudyWithChapters; ch: StudyChapterRecord } {
  const ch = chapter({ id: 'N4moIgkd', ordinal: 9, name: JQE_CHAPTER, variant: 'jieqi', root });
  const others = Array.from({ length: 11 }, (_, i) =>
    chapter({ id: `c${i}`, ordinal: i < 9 ? i : i + 1, name: `Pair ${i}`, variant: 'jieqi' }),
  );
  return { s: study({ name: JQE_STUDY, chapters: [...others, ch] }), ch };
}

test('a chapter title keeps the chapter whole, cuts the study, and ends in Mistboard', () => {
  // A chapter name too long to share the cap with any of the study: served whole.
  const { s, ch } = jqeStudy();
  assert.equal(
    chapterPageMeta({ study: s, chapter: ch, locale: 'en' }).title,
    `${JQE_CHAPTER} | Mistboard`,
  );
  // Room for a stub of the study: the study is cut, the chapter is not.
  for (const name of ['Pair 1a', 'Pair 5b: jqe it014 (red) vs AB-JChess']) {
    const c = chapter({ id: 'x', name, variant: 'jieqi' });
    const { title } = chapterPageMeta({
      study: study({ name: JQE_STUDY, chapters: [c] }),
      chapter: c,
      locale: 'en',
    });
    assert.ok(title.startsWith(`${name} · jqe vs`), title);
    assert.ok(title.endsWith('… | Mistboard'), title);
    assert.ok([...title].length <= 65, title);
  }
  // Too short for the floor: the variant study label joins it.
  const tiny = chapter({ id: 't', name: '1', variant: 'jieqi' });
  const { title } = chapterPageMeta({
    study: study({ name: 'Jq', chapters: [tiny] }),
    chapter: tiny,
    locale: 'en',
  });
  assert.equal(title, '1 · Jq · Jieqi study | Mistboard');
});

test('a chapter fallback names its place in the study and meets the floor in every locale', () => {
  const { s, ch } = jqeStudy();
  const en = chapterPageMeta({ study: s, chapter: ch, locale: 'en' });
  assert.match(
    en.description,
    /^Chapter 10 of 12 in jqe vs AB-JChess 0\.2d.*a jieqi study, 58 moves long\./,
  );
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const meta = chapterPageMeta({ study: s, chapter: ch, locale });
    assert.deepEqual(seoMetaLengthProblems(locale, meta), [], locale);
    assert.ok([...meta.description].length <= 160, meta.description);
  }
});

// Hidden information: the meta is built from counts and names only. Two jieqi
// chapters with the same length but different moves (different reveals) must
// produce identical meta, so nothing about the hidden pieces can reach it.
test('a hidden-information study meta does not depend on the moves themselves', () => {
  const swapped = (n: number) => {
    const tree = mainline(n) as { version: number; root: { children: Record<string, unknown>[] } };
    let node = tree.root.children[0];
    while (node && typeof node.uci === 'string') {
      node.uci = `${String(node.uci)}x`;
      node = (node.children as Record<string, unknown>[])[0];
    }
    return tree;
  };
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const a = jqeStudy(mainline(58));
    const b = jqeStudy(swapped(58));
    assert.deepEqual(
      chapterPageMeta({ study: a.s, chapter: a.ch, locale }),
      chapterPageMeta({ study: b.s, chapter: b.ch, locale }),
    );
    assert.deepEqual(studyPageMeta({ study: a.s, locale }), studyPageMeta({ study: b.s, locale }));
  }
});
