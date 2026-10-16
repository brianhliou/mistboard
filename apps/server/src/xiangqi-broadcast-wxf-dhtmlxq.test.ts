import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { replayXiangqiBroadcastBoard } from '@mistboard/game';
import {
  convertWxfDhtmlXqPageToSnapshot,
  extractArticleTitle,
} from './xiangqi-broadcast-wxf-dhtmlxq.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('../fixtures/wxf-dhtmlxq/2019-wxc-men-r1a-mini.html', import.meta.url),
);

function fixtureHtml(): string {
  return readFileSync(FIXTURE_PATH, 'utf-8');
}

test('WXF DhtmlXQ page fixture converts to a broadcast source snapshot', () => {
  const result = convertWxfDhtmlXqPageToSnapshot(fixtureHtml(), {
    tourSlug: '2019-wxc-men',
    tourName: '2019 World Xiangqi Championship Men',
    roundId: '2019-wxc-men-r01a',
    roundName: 'Men Round 1 Page 1a',
    sourceUrl:
      'https://www.wxf-xiangqi.org/index.php?option=com_content&view=article&id=261:2019-wxc-men-round-01a&catid=158&Itemid=378&lang=cn',
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.issues, []);
  assert.equal(result.snapshot.tour.slug, '2019-wxc-men');
  assert.equal(result.snapshot.rounds[0]?.id, '2019-wxc-men-r01a');
  assert.equal(result.snapshot.boards.length, 2);

  const board1 = result.snapshot.boards[0]!;
  assert.equal(board1.sourceBoardId, 'mr1t02');
  assert.equal(board1.boardNumber, 2);
  assert.equal(board1.red.name, '黎英豪');
  assert.equal(board1.black.name, '福贵多');
  assert.equal(board1.result, '1-0');
  assert.deepEqual(board1.moves.slice(0, 4), [
    { from: 'c4', to: 'c5' },
    { from: 'c10', to: 'e8' },
    { from: 'b1', to: 'c3' },
    { from: 'b10', to: 'c8' },
  ]);

  for (const board of result.snapshot.boards) {
    assert.equal(replayXiangqiBroadcastBoard(board).ok, true, `${board.id} should replay`);
  }
});

test('WXF DhtmlXQ parser returns typed sanitized issues for bad frames', () => {
  const html = `
    <iframe name='NoFile_
      [DhtmlXQiFrame]
      [DhtmlXQ_title]mr1t99 Broken Board[/DhtmlXQ_title]
      [DhtmlXQ_red]Red[/DhtmlXQ_red]
      [DhtmlXQ_black]Black[/DhtmlXQ_black]
      [DhtmlXQ_binit]0919293949596979891777062646668600102030405060708012720323436383[/DhtmlXQ_binit]
      [DhtmlXQ_movelist]262[/DhtmlXQ_movelist]
      [/DhtmlXQiFrame]'>
    </iframe>`;

  const result = convertWxfDhtmlXqPageToSnapshot(html, {
    tourSlug: 'broken',
    roundId: 'broken-r1',
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.issues, [
    {
      kind: 'malformed_movelist',
      message: 'DhtmlXQ movelist must be non-empty digits grouped as four digits per ply',
      sourceBoardId: 'mr1t99',
    },
  ]);
});

// A table number parsed out of the source id is the source's own claim about
// which board this is, so it outranks a number supplied by the caller. This
// fixture carries two boards on one page (mr1t02, mr1t06), which is the shape
// an explicit boardNumber must not disturb.
test('a table number in the source id outranks an explicit boardNumber', () => {
  const result = convertWxfDhtmlXqPageToSnapshot(fixtureHtml(), {
    tourSlug: '2019-wxc-men',
    roundId: '2019-wxc-men-r01a',
    boardNumber: 99,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.snapshot.boards.map((board) => board.boardNumber),
    [2, 6],
  );
});

// From 2024 WXF round pages wrap nothing but the site name in <title>
// ("World Xiangqi Federation 世界象棋联合会 (WXF) - World Xiangqi Federation
// 世界象棋联合会 (WXF)"). Stripping only the tail made the site name the tour
// name and slug of every unpinned import (world-xiangqi-federation-wxf-…).
test('a 2025 WXF round page is named by its own title, not the site name', () => {
  const html = readFileSync(
    fileURLToPath(
      new URL('../fixtures/wxf-dhtmlxq/2025-wxc-men/article-1844.html', import.meta.url),
    ),
    'utf-8',
  );
  assert.equal(extractArticleTitle(html), '2025 世界象棋锦标赛 赛谱 男子组 第1轮');

  const result = convertWxfDhtmlXqPageToSnapshot(html);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.snapshot.tour.name, '2025 世界象棋锦标赛 赛谱 男子组 第1轮');
  assert.doesNotMatch(result.snapshot.tour.slug, /world-xiangqi-federation/);

  // With no og:title either, the frames' event tag names the tour.
  const bare = html.replace(/<meta property="og:title"[^>]*>/, '');
  assert.equal(extractArticleTitle(bare), undefined);
  const fromEvent = convertWxfDhtmlXqPageToSnapshot(bare);
  assert.equal(fromEvent.ok, true);
  if (!fromEvent.ok) return;
  assert.equal(fromEvent.snapshot.tour.name, '第19届世界象棋锦标赛＆第5届世青赛');
  assert.doesNotMatch(fromEvent.snapshot.tour.slug, /world-xiangqi-federation/);
});

test('a 2019 WXF title keeps its article name', () => {
  assert.equal(extractArticleTitle(fixtureHtml()), '2019 World Xiangqi Championship Men Round 01a');
});
