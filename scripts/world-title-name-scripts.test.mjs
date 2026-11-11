import assert from 'node:assert/strict';
import test from 'node:test';
import { tsImport } from 'tsx/esm/api';

const { chapterI18n, tagsI18nFor, zhName } = await tsImport(
  './world-title-study.mjs',
  import.meta.url,
);

test('world-title chapters and both seats follow page script without changing source specs', () => {
  const spec = { red: 'Lü Qin', black: 'Wu Guilin', event: '1990 2nd World Xiangqi Championship' };
  const before = JSON.stringify(spec);
  const chapter = chapterI18n({ year: 1990, champion: 'Lü Qin', spec });
  assert.equal(chapter['zh-Hans'].name, '1990 · 吕钦');
  assert.equal(chapter['zh-Hant'].name, '1990 · 呂欽');
  assert.equal(chapter['zh-Hans'].tags.black, '吴贵临');
  assert.equal(chapter['zh-Hant'].tags.black, '吳貴臨');
  assert.equal(chapter['zh-Hant'].tags.red, '呂欽');
  assert.equal(chapter['zh-Hant'].tags.event, '1990年第二屆世界象棋錦標賽');
  assert.equal(JSON.stringify(spec), before);
  assert.equal(zhName('Zhao Guorong', 'hant'), '趙國榮');
  assert.deepEqual(tagsI18nFor({ red: 'Unknown', black: 'Unknown' }), {});
});
