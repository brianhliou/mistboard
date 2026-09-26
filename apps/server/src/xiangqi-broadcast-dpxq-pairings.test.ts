import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateXiangqiBroadcastBoard } from '@mistboard/game';
import {
  dpxqPairingBoard,
  pairingSourceBoardId,
  parseDpxqRoundPage,
  resultFromDpxqScore,
  roundPageUrl,
} from './xiangqi-broadcast-dpxq-pairings.js';

// Real round pages of the 2024 Asian individual championship (dpxq tours 9503
// men, 9509 women), converted to UTF-8 and trimmed to the pairings table.
function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../fixtures/dpxq/${name}`, import.meta.url)), 'utf-8');
}

test('round page URLs: the bare page is the latest round, _n is round n', () => {
  assert.equal(roundPageUrl('9503'), 'http://www.dpxq.com/hldcg/round_9503.html');
  assert.equal(roundPageUrl('9503', 3), 'http://www.dpxq.com/hldcg/round_9503_3.html');
});

test('a round page yields every table with players, federations and result', () => {
  const page = parseDpxqRoundPage(fixture('round_9503_1-asian-2024-men-r01.html'));
  assert.ok(page);
  assert.equal(page.roundNumber, 1);
  // The page names how many rounds are paired (最新对阵(7)).
  assert.equal(page.roundCount, 7);
  assert.equal(page.pairings.length, 15);
  assert.deepEqual(
    page.pairings.map((pairing) => pairing.table),
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
  assert.deepEqual(page.pairings[0], {
    roundNumber: 1,
    table: 1,
    red: { name: '黎德志', federation: '西马' },
    black: { name: '庄宏明', federation: '菲律宾' },
    result: '0-1',
    recordIds: [],
  });
  assert.equal(page.pairings[1]!.result, '1/2-1/2');
  // Non-Chinese names come through as written.
  assert.equal(page.pairings[2]!.black.name, 'Wajono Jong');
});

test('a table that played a slow game and a playoff yields both games, not the aggregate', () => {
  const page = parseDpxqRoundPage(fixture('round_9503-asian-2024-men-r07.html'));
  assert.ok(page);
  assert.equal(page.roundNumber, 7);
  // 15 tables, the final's aggregate row replaced by its two games.
  assert.equal(page.pairings.length, 16);
  const [slow, rapid, next] = page.pairings;
  assert.deepEqual(slow, {
    roundNumber: 7,
    table: 1,
    game: 1,
    kind: 'standard',
    red: { name: '黄学谦', federation: '中国香港' },
    black: { name: '刘柏宏', federation: '中国' },
    result: '1/2-1/2',
    recordIds: ['128342'],
  });
  assert.equal(rapid!.game, 2);
  assert.equal(rapid!.kind, 'rapid');
  assert.equal(rapid!.red.name, '刘柏宏');
  assert.equal(rapid!.result, '1-0');
  assert.deepEqual(rapid!.recordIds, ['128343']);
  assert.equal(next!.table, 2);
  assert.equal(next!.game, undefined);
});

test("the women's round page reads the same way", () => {
  const page = parseDpxqRoundPage(fixture('round_9509-asian-2024-women-r07.html'));
  assert.ok(page);
  assert.equal(page.pairings.length, 6);
  assert.equal(page.pairings[1]!.red.name, 'Ni Kadek Sugianingsih');
  assert.equal(page.pairings[1]!.result, '0-1');
});

test('a page with nothing paired yet, or a team layout, is no pairings', () => {
  // dpxq's page for a tour before round 1: 第00轮 and no table.
  assert.equal(
    parseDpxqRoundPage(
      '<title>2026年第21届亚洲象棋个人锦标赛男子组第00轮对阵</title><div id="tourTitle"></div>',
    ),
    null,
  );
  assert.equal(parseDpxqRoundPage('<title>第03轮</title><table id="table_tuanti"></table>'), null);
});

test('scores read as results; an unplayed row stays open', () => {
  assert.equal(resultFromDpxqScore('2 + 0'), '1-0');
  assert.equal(resultFromDpxqScore('0 - 2'), '0-1');
  assert.equal(resultFromDpxqScore('1 = 1'), '1/2-1/2');
  assert.equal(resultFromDpxqScore(''), '*');
  assert.equal(resultFromDpxqScore('VS'), '*');
});

test('a bye row is not a board', () => {
  const html = `<title>第02轮</title><table id="table_geren">
    <tr class="th"><td>台次</td><td>团体</td><td>姓名</td><td>结果</td><td>姓名</td><td>团体</td><td>棋谱</td></tr>
    <tr><td>1</td><td>中国</td><td>甲</td><td>2 + 0</td><td>乙</td><td>越南</td><td></td></tr>
    <tr><td>2</td><td>中国</td><td>丙</td><td></td><td>轮空</td><td></td><td></td></tr>
  </table>`;
  const page = parseDpxqRoundPage(html);
  assert.equal(page?.pairings.length, 1);
});

test('a pairing becomes a valid board with no moves, keyed by round and table', () => {
  const page = parseDpxqRoundPage(fixture('round_9503-asian-2024-men-r07.html'));
  assert.ok(page);
  assert.equal(pairingSourceBoardId(page.pairings[0]!), 'r07t01g1');
  assert.equal(pairingSourceBoardId(page.pairings[2]!), 'r07t02');
  const board = dpxqPairingBoard({
    tourSlug: 'asian-2024-men',
    roundId: 'asian-2024-men-r07',
    pairing: page.pairings[2]!,
    sourceUrl: roundPageUrl('9503', 7),
  });
  assert.equal(board.id, 'asian-2024-men-asian-2024-men-r07-r07t02');
  assert.equal(board.boardNumber, 2);
  assert.equal(board.status, 'complete');
  assert.deepEqual(board.moves, []);
  assert.deepEqual(board.details, { table: 2 });
  assert.equal(validateXiangqiBroadcastBoard(board).ok, true);

  const unplayed = dpxqPairingBoard({
    tourSlug: 'asian-2024-men',
    roundId: 'asian-2024-men-r07',
    pairing: { ...page.pairings[2]!, result: '*' },
    sourceUrl: roundPageUrl('9503', 7),
  });
  assert.equal(unplayed.status, 'scheduled');
  assert.equal(validateXiangqiBroadcastBoard(unplayed).ok, true);
});
