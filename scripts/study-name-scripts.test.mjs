import assert from 'node:assert/strict';
import test from 'node:test';
import { backfillStudyNames } from './backfill-study-name-scripts.mjs';
import { repairStudyNameOverlays, studyPersonTag } from './lib/study-name-scripts.mjs';

const fixture = () => ({
  id: 'chapter',
  variant: 'xiangqi',
  version: 4,
  tags: { red: 'Yu Youhua', black: 'Sun Yongzheng', result: '1-0', event: 'Source event' },
  i18n: {
    'zh-Hans': {
      name: '于幼華對孫勇征',
      tags: { red: '於幼華', black: '孫勇徵', event: 'source event' },
      description: '党斐',
    },
    'zh-Hant': {
      name: '于幼华对孙勇征',
      tags: { red: '於幼華', black: '孫勇徵' },
      custom: 'unrelated',
    },
    vi: { name: 'Yu Youhua' },
  },
  root: {
    version: 1,
    root: {
      annotations: {
        glyphs: [1],
        comments: [
          {
            text: 'verbatim source',
            i18n: {
              'zh-Hant':
                '杨官璘（紅）對赵国荣（黑）· 全国象棋个人赛 · 1956-12-01 · 杨官璘勝。引擎註解为 Pikafish，每步一百万節點，与複盤頁所用相同。',
              'zh-Hans': '楊官璘对趙奕帆、黨斐、於幼華、孫勇徵',
              en: 'original',
            },
          },
        ],
      },
      children: [
        {
          uci: 'a0a1',
          annotations: { arrows: ['a0a1'], comments: [{ text: 'untouched' }] },
          children: [],
        },
      ],
    },
  },
});

test('repair changes only Chinese name overlays and generated provenance, idempotently', () => {
  const source = fixture();
  const before = structuredClone(source);
  const { next, changes } = repairStudyNameOverlays(source);
  assert.deepEqual(source, before);
  assert.ok(changes.length > 0);
  assert.deepEqual(next.tags, source.tags);
  assert.deepEqual(next.root.root.children, source.root.root.children);
  assert.deepEqual(next.i18n.vi, source.i18n.vi);
  assert.equal(next.i18n['zh-Hant'].custom, 'unrelated');
  assert.equal(next.i18n['zh-Hans'].tags.red, '于幼华');
  assert.equal(next.i18n['zh-Hant'].tags.red, '于幼華');
  assert.equal(next.i18n['zh-Hant'].tags.black, '孫勇征');
  const c = next.root.root.annotations.comments[0];
  assert.equal(c.text, 'verbatim source');
  assert.equal(c.i18n.en, 'original');
  assert.equal(c.i18n['zh-Hans'], '杨官璘对赵奕帆、党斐、于幼华、孙勇征');
  assert.match(c.i18n['zh-Hant'], /楊官璘（紅）對趙國榮/);
  assert.match(c.i18n['zh-Hant'], /全國象棋個人賽/);
  assert.match(c.i18n['zh-Hant'], /為 Pikafish，每步一百萬節點，與/);
  assert.deepEqual(repairStudyNameOverlays(next).changes, []);
  assert.equal(studyPersonTag('Wu Guilin', '吳貴臨', 'zh-Hans'), '吴贵临');
});

function fakeDatabase(chapters = [fixture()]) {
  const study = {
    id: 'study',
    name: 'Every Xiangqi Champion',
    description: 'Companion to /blog/xiangqi-champions.',
    account_role: 'admin',
    i18n: { 'zh-Hant': { description: '杨官璘' } },
  };
  const queries = [];
  return {
    study,
    chapters,
    queries,
    async query(sql, params) {
      queries.push(sql);
      if (sql.startsWith('SELECT s.id')) return { rows: [study] };
      if (sql.startsWith('SELECT id, variant')) return { rows: chapters };
      if (sql.startsWith('UPDATE studies')) study.i18n = JSON.parse(params[1]);
      if (sql.startsWith('UPDATE study_chapters')) {
        const c = chapters.find((x) => x.id === params[1]);
        c.i18n = JSON.parse(params[2]);
        c.root = JSON.parse(params[3]);
        c.version += 1;
      }
      return { rows: [] };
    },
  };
}
test('operator dry-run never updates rows; apply preserves data and a repeat has zero diff', async () => {
  const db = fakeDatabase();
  const before = JSON.stringify([db.study, db.chapters]);
  const dry = await backfillStudyNames(db, { study: 'study' });
  assert.equal(JSON.stringify([db.study, db.chapters]), before);
  assert.equal(
    db.queries.some((q) => q.startsWith('UPDATE')),
    false,
  );
  assert.equal(db.queries.at(-1), 'ROLLBACK');
  const applied = await backfillStudyNames(db, { study: 'study', apply: true });
  assert.deepEqual(applied.changes, dry.changes);
  assert.equal(db.queries.at(-1), 'COMMIT');
  assert.deepEqual((await backfillStudyNames(db, { study: 'study', apply: true })).changes, []);
  assert.equal(db.chapters[0].version, 5);
});
test('operator rejects other studies and never reads or reports hidden-variant trees', async () => {
  const db = fakeDatabase([{ id: 'hidden', variant: 'jieqi', root: null }]);
  const out = await backfillStudyNames(db, { study: 'study' });
  assert.equal(
    out.changes.some((c) => c.chapter),
    false,
  );
  db.study.account_role = 'user';
  await assert.rejects(backfillStudyNames(db, { study: 'study', apply: true }), /first-party/);
  assert.equal(db.queries.at(-1), 'ROLLBACK');
});
