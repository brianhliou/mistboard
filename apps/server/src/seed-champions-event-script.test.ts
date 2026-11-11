import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterFor, traditionalEvent } from './seed-xiangqi-champions-study.js';

// Events and person names have separate checked display vocabularies.
test('an event name converts to Taiwan characters', () => {
  assert.equal(traditionalEvent('1956年全国象棋个人赛'), '1956年全國象棋個人賽');
  assert.equal(traditionalEvent('1990年第2届世界象棋锦标赛'), '1990年第2屆世界象棋錦標賽');
  assert.equal(traditionalEvent('全国象棋团体赛'), '全國象棋團體賽');
  // Sponsors and places convert: they are organizations, not people.
  assert.equal(traditionalEvent('1996年华能杯全国象棋个人赛'), '1996年華能杯全國象棋個人賽');
  assert.equal(traditionalEvent('1995年吴县市杯全国象棋个人赛'), '1995年吳縣市杯全國象棋個人賽');
  assert.equal(
    traditionalEvent('2025年民生实业杯全国象棋个人赛'),
    '2025年民生實業杯全國象棋個人賽',
  );
});

test('generated champion chapter names, tags and provenance follow the page script', () => {
  for (const [red, black, hantRed, hantBlack] of [
    ['于幼华', '孙勇征', '于幼華', '孫勇征'],
    ['党斐', '赵奕帆', '党斐', '趙奕帆'],
    ['杨官璘', '赵国荣', '楊官璘', '趙國榮'],
  ]) {
    const game = {
      key: 'm_8975',
      title: 'source',
      event: '全国象棋个人赛',
      date: '2002-01-01',
      red: red!,
      black: black!,
      result: '1-0',
      moves: [],
    };
    const before = JSON.stringify(game);
    const chapter = chapterFor(
      game,
      { accuracy: { first: 90, second: 80 }, rows: [] },
      { key: 'm_8975', name: 'Base chapter', blurb: 'Source blurb', orientation: 'red' },
    );
    assert.equal(chapter.i18n['zh-Hans'].tags.red, red);
    assert.equal(chapter.i18n['zh-Hans'].tags.black, black);
    assert.equal(chapter.i18n['zh-Hant'].tags.red, hantRed);
    assert.equal(chapter.i18n['zh-Hant'].tags.black, hantBlack);
    assert.match(chapter.i18n['zh-Hant'].name!, /于幼華/);
    const text = chapter.root.root.annotations!.comments![0]!.i18n!;
    assert.ok(text['zh-Hans']!.includes(`${red}（红）对${black}（黑）`));
    assert.ok(text['zh-Hant']!.includes(`${hantRed}（紅）對${hantBlack}（黑）`));
    assert.ok(!/黨斐|於幼華|孫勇徵/.test(text['zh-Hant']!));
    assert.equal(JSON.stringify(game), before);
  }
});
