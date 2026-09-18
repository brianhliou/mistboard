import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { looksLikeDpxqPage, normalizeDpxqPageToFrameHtml } from './xiangqi-broadcast-dpxq.js';
import { interpretXiangqiBroadcastSourceBody } from './xiangqi-broadcast-poller.js';
import { translateXiangqiBroadcastSnapshot } from './xiangqi-broadcast-translate.js';
import { convertWxfDhtmlXqPageToSnapshot } from './xiangqi-broadcast-wxf-dhtmlxq.js';

// Real dpxq.com archive page (view_m_11637, 2004 将军杯 甲级联赛, 王斌 和 陶汉明),
// transcoded gb2312 -> utf-8. The movelist lives inside a JS var, players/result
// only in the <title>.
const ARCHIVE_HTML = readFileSync(
  fileURLToPath(new URL('../fixtures/dpxq/view_m_11637-archive.html', import.meta.url)),
  'utf-8',
);

// The full legal 89-ply movelist of that game; live fixtures slice prefixes of it
// so each in-progress board still replays legally.
const FULL_MOVELIST =
  '77477062796780708979727666651242192710222625001009191016273576663554707967792241191863645442204265644264186816176866171479670304665641335655644255356254474330413555546243631464677564666947664655516270517146767583768683628666636533253948254462746676656776776766403071704456485777577073563749483745663657777333304074534553335377765333232429077646333460823433';

// A dpxq live-room per-board feed (view.asp): full [DhtmlXQ_*] tag block inline,
// no [DhtmlXQiFrame] wrapper, empty binit = standard start. `plies` slices the
// shared movelist; empty result = game in progress.
function liveBoardPage(input: {
  red: string;
  black: string;
  plies: number;
  result?: string;
  event?: string;
  round?: string;
}): string {
  const movelist = FULL_MOVELIST.slice(0, input.plies * 4);
  return [
    '<html><head><title>象棋直播室</title></head><body>',
    '[DhtmlXQ_ver]www_dpxq_com[/DhtmlXQ_ver]<br>',
    '[DhtmlXQ_binit][/DhtmlXQ_binit]<br>',
    `[DhtmlXQ_event]${input.event ?? '测试联赛'}[/DhtmlXQ_event]<br>`,
    `[DhtmlXQ_round]${input.round ?? '第01轮'}[/DhtmlXQ_round]<br>`,
    `[DhtmlXQ_result]${input.result ?? ''}[/DhtmlXQ_result]<br>`,
    `[DhtmlXQ_red]${input.red}[/DhtmlXQ_red]<br>`,
    `[DhtmlXQ_black]${input.black}[/DhtmlXQ_black]<br>`,
    `[DhtmlXQ_movelist]${movelist}[/DhtmlXQ_movelist]<br>`,
    '</body></html>',
  ].join('');
}

function tourSlugFor(event: string): string {
  const page = liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 8, event });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  return converted.ok ? converted.snapshot.tour.slug : '';
}

function boardFor(input: { red: string; black: string; event: string; round: string }) {
  const page = liveBoardPage({ ...input, plies: 8 });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  if (!converted.ok) throw new Error('dpxq conversion failed');
  return converted.snapshot.boards[0]!;
}

test('independent same-event games compose into distinct boards grouped by round', () => {
  // Regression: single-game dpxq pages once all collapsed to (tour, default
  // round, board-1) and clobbered each other with incompatible_update.
  const EVENT = '2026年全国象棋团体赛';
  const r3a = boardFor({ red: '曹岩磊', black: '李小龙', event: EVENT, round: '第03轮' });
  const r3b = boardFor({ red: '唐丹', black: '董毓男', event: EVENT, round: '第03轮' });
  const r4 = boardFor({ red: '孟辰', black: '李彦阳', event: EVENT, round: '第04轮' });

  // One tour for the whole event.
  assert.equal(r3a.tourSlug, r3b.tourSlug);
  assert.equal(r3a.tourSlug, r4.tourSlug);

  // Three distinct boards (the bug made all three identical).
  assert.equal(new Set([r3a.id, r3b.id, r4.id]).size, 3);

  // Same 轮 groups; different 轮 separates.
  assert.equal(r3a.roundId, r3b.roundId);
  assert.notEqual(r3a.roundId, r4.roundId);
  assert.match(r3a.roundId, /r03$/);
  assert.match(r4.roundId, /r04$/);

  // Stable across re-polls: same game -> same board id (updates, not dupes).
  assert.equal(
    boardFor({ red: '曹岩磊', black: '李小龙', event: EVENT, round: '第03轮' }).id,
    r3a.id,
  );
});

// #416: the 2026 Shanghai Cup semi 陈绍博–杨世哲 went eight games in one round,
// four with each colour ordering; keyed on pairing + round, Mistboard kept one
// per ordering and rejected the other six. The page URL names the game.
test('a tiebreak with the same pairing and colours in one round is its own board', () => {
  const EVENT = '2026年第六届“上海杯”象棋大师公开赛';
  const semi = { red: '陈绍博', black: '杨世哲', event: EVENT, round: '第04轮' };
  const convert = (sourceUrl: string | undefined) => {
    const normalized = normalizeDpxqPageToFrameHtml(liveBoardPage({ ...semi, plies: 8 }));
    const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '', {
      ...(sourceUrl ? { sourceUrl } : {}),
    });
    if (!converted.ok) throw new Error('dpxq conversion failed');
    return converted.snapshot.boards[0]!;
  };

  const classical = convert('http://www.dpxq.com/hldcg/search/view_m_143679.html');
  const tiebreak = convert('http://www.dpxq.com/hldcg/search/view_m_143681.html');
  assert.notEqual(classical.id, tiebreak.id);
  assert.equal(classical.roundId, tiebreak.roundId);
  assert.match(classical.sourceBoardId, /^b[0-9a-z]+$/);

  // Re-polling the same record keeps its id.
  assert.equal(convert('http://www.dpxq.com/hldcg/search/view_m_143679.html').id, classical.id);

  // A page that names no game still keys on the pairing, as before.
  assert.equal(convert(undefined).id, convert(undefined).id);
  assert.notEqual(convert(undefined).id, classical.id);
});

test('looksLikeDpxqPage flags raw dpxq pages, not framed WXF or JSON', () => {
  assert.equal(looksLikeDpxqPage(ARCHIVE_HTML), true);
  assert.equal(looksLikeDpxqPage(liveBoardPage({ red: 'A', black: 'B', plies: 4 })), true);
  // An already-normalized WXF page carries the frame wrapper; do not re-normalize.
  assert.equal(
    looksLikeDpxqPage('[DhtmlXQiFrame][DhtmlXQ_movelist]7747[/DhtmlXQ_movelist][/DhtmlXQiFrame]'),
    false,
  );
  assert.equal(looksLikeDpxqPage('{"rounds":[],"boards":[]}'), false);
});

test('dpxq archive page normalizes and replays as the full real game', () => {
  const normalized = normalizeDpxqPageToFrameHtml(ARCHIVE_HTML);
  assert.equal(normalized.ok, true);
  assert.ok(normalized.ok && normalized.html.includes('[DhtmlXQiFrame]'));

  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const board = converted.snapshot.boards[0]!;
  assert.equal(board.moves.length, 89);
  assert.equal(board.red.name, '王斌');
  assert.equal(board.black.name, '陶汉明');
  assert.equal(board.result, '1/2-1/2');
  assert.equal(board.status, 'complete');
});

test('interpret routes a raw dpxq page through the dpxq adapter', () => {
  const body = interpretXiangqiBroadcastSourceBody(ARCHIVE_HTML);
  assert.equal(body.kind, 'wxf-dhtmlxq');
});

test('dpxq live board reads names from tags and marks an in-progress game live', () => {
  const page = liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 12 });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  assert.equal(normalized.ok, true);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const board = converted.snapshot.boards[0]!;
  assert.equal(board.red.name, '王天一');
  assert.equal(board.black.name, '郑惟桐');
  assert.equal(board.moves.length, 12);
  assert.equal(board.status, 'live');
  assert.equal(board.result, '*');
});

test('dpxq live board across a growing poll sequence: plies grow, result flips to complete', () => {
  const snapshots = [
    liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 0 }),
    liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 12 }),
    liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 40 }),
    liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 89, result: '和' }),
  ];

  let previousPlies = -1;
  const boards = snapshots.map((page, index) => {
    const normalized = normalizeDpxqPageToFrameHtml(page);
    assert.equal(normalized.ok, true, `snapshot ${index} normalizes`);
    const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
    // A 0-ply board has no moves to replay; the converter yields no board for it,
    // which the live update path treats as still-scheduled.
    if (index === 0) return null;
    assert.equal(converted.ok, true, `snapshot ${index} converts`);
    return converted.ok ? converted.snapshot.boards[0]! : null;
  });

  for (const board of boards.slice(1)) {
    assert.ok(board);
    if (!board) continue;
    assert.ok(board.moves.length > previousPlies, 'ply count grows monotonically');
    previousPlies = board.moves.length;
  }
  const finalBoard = boards.at(-1)!;
  assert.equal(finalBoard.status, 'complete');
  assert.equal(finalBoard.result, '1/2-1/2');
});

test('same-year Chinese event names do not collide on one tour slug', () => {
  // Both slugify to the bare ASCII fragment "2004"; without a title hash they
  // would merge two unrelated events (the board-update key is (tour_slug,
  // source_board_id)).
  const a = tourSlugFor('2004年将军杯全国象棋甲级联赛');
  const b = tourSlugFor('2004年全国象棋个人赛');
  assert.ok(a.startsWith('2004-'), `keeps the readable fragment: ${a}`);
  assert.ok(b.startsWith('2004-'), `keeps the readable fragment: ${b}`);
  assert.notEqual(a, b, 'distinct events get distinct slugs');
  // Deterministic: the same title always resolves to the same slug across polls.
  assert.equal(tourSlugFor('2004年将军杯全国象棋甲级联赛'), a);
});

test('readable Latin event names keep a clean slug with no hash suffix', () => {
  // Nothing meaningful is dropped, so no disambiguating hash is appended.
  assert.equal(tourSlugFor('2019 World Xiangqi Championship'), '2019-world-xiangqi-championship');
});

test('translated dpxq snapshot caches English names on tour, round, and players', () => {
  // The same normalize -> convert path the poller takes; the persistence layer
  // applies exactly this translation before every write.
  const page = liveBoardPage({
    red: '徐腾飞',
    black: '唐丹',
    plies: 8,
    event: '2026全国象棋团体赛',
    round: '第3轮',
  });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  assert.equal(normalized.ok, true);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;

  const translated = translateXiangqiBroadcastSnapshot(converted.snapshot);
  assert.equal(translated.tour.name, '2026全国象棋团体赛');
  assert.equal(translated.tour.nameEn, '2026 National Xiangqi Team Championship');
  assert.equal(translated.rounds[0]!.name, '第3轮');
  assert.equal(translated.rounds[0]!.nameEn, 'Round 3');
  const board = translated.boards[0]!;
  assert.equal(board.red.name, '徐腾飞');
  assert.equal(board.red.nameEn, 'Xu Tengfei');
  assert.equal(board.black.name, '唐丹');
  assert.equal(board.black.nameEn, 'Tang Dan');
});

// Board numbering. dpxq serves one game per page, so every conversion runs at
// index 0 and the index+1 fallback numbers every board in a round "Board 1".
// Prod showed exactly that: three boards on 2026-ewwox2 round 3, all Board 1.
test('dpxq single-game pages all collapse to board 1 without an explicit number', () => {
  const numbers = [
    { red: '王天一', black: '郑惟桐' },
    { red: '徐腾飞', black: '周开芹' },
    { red: '崔革', black: '孟繁睿' },
  ].map((pairing) => {
    const normalized = normalizeDpxqPageToFrameHtml(liveBoardPage({ ...pairing, plies: 8 }));
    assert.equal(normalized.ok, true);
    const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
    assert.equal(converted.ok, true);
    return converted.ok ? converted.snapshot.boards[0].boardNumber : -1;
  });
  assert.deepEqual(numbers, [1, 1, 1]);
});

test('an explicit boardNumber numbers one-game-per-page sources in order', () => {
  const numbers = [
    { red: '王天一', black: '郑惟桐' },
    { red: '徐腾飞', black: '周开芹' },
    { red: '崔革', black: '孟繁睿' },
  ].map((pairing, index) => {
    const normalized = normalizeDpxqPageToFrameHtml(liveBoardPage({ ...pairing, plies: 8 }));
    const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '', {
      boardNumber: index + 1,
    });
    assert.equal(converted.ok, true);
    return converted.ok ? converted.snapshot.boards[0].boardNumber : -1;
  });
  assert.deepEqual(numbers, [1, 2, 3]);
});

test('team events keep the team beside the player', () => {
  // The archive fixture is a 甲级联赛 game, so its title carries both sides'
  // teams: "江苏体彩 王斌 和 吉林天兴棋牌 陶汉明". Dropping them turned a team
  // league into a list of anonymous pairings.
  const normalized = normalizeDpxqPageToFrameHtml(ARCHIVE_HTML);
  assert.equal(normalized.ok, true);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const board = converted.snapshot.boards[0]!;
  assert.equal(board.red.name, '王斌');
  assert.equal(board.black.name, '陶汉明');
  assert.equal(board.red.federation, '江苏体彩');
  assert.equal(board.black.federation, '吉林天兴棋牌');
});

test('a live board takes the team from the combined red/black tag', () => {
  const page = liveBoardPage({
    red: '浙江民泰银行象棋队 王家瑞',
    black: '杭州市棋类协会 戴晨',
    plies: 8,
  });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  assert.equal(normalized.ok, true);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const board = converted.snapshot.boards[0]!;
  assert.equal(board.red.name, '王家瑞');
  assert.equal(board.red.federation, '浙江民泰银行象棋队');
  assert.equal(board.black.name, '戴晨');
  assert.equal(board.black.federation, '杭州市棋类协会');
});

test('an individual game gets no invented affiliation', () => {
  const page = liveBoardPage({ red: '王天一', black: '郑惟桐', plies: 8 });
  const normalized = normalizeDpxqPageToFrameHtml(page);
  const converted = convertWxfDhtmlXqPageToSnapshot(normalized.ok ? normalized.html : '');
  assert.equal(converted.ok, true);
  if (!converted.ok) return;
  const board = converted.snapshot.boards[0]!;
  assert.equal(board.red.name, '王天一');
  assert.equal(board.red.federation, undefined);
  assert.equal(board.black.federation, undefined);
});
