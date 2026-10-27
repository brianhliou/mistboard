import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LIBRARY,
  harvestMode,
  hasTarget,
  idRows,
  isLoginWall,
  parseArgs,
  parseRows,
  parseTourRows,
} from './lib/dpxq-harvest-args.mjs';

const argv = (...rest) => ['node', 'dpxq-archive-harvest.mjs', ...rest];

test('parseArgs keeps the search defaults when no flag is given', () => {
  const args = parseArgs(argv());
  assert.equal(args.library, DEFAULT_LIBRARY);
  assert.equal(args.pages, 1);
  assert.equal(args.tour, '');
  assert.deepEqual(args.ids, []);
  assert.equal(hasTarget(args), false);
});

test('--tour with --player reads one tour, filtered to the player', () => {
  const args = parseArgs(argv('--tour', '12286', '--player', '唐丹', '--out', './games'));
  assert.equal(args.tour, '12286');
  assert.equal(args.player, '唐丹');
  assert.equal(args.out, './games');
  assert.equal(hasTarget(args), true);
  assert.equal(harvestMode(args), 'tour');
});

test('--tour alone is a target: the whole tour', () => {
  const args = parseArgs(argv('--tour', '12776'));
  assert.equal(hasTarget(args), true);
  assert.equal(harvestMode(args), 'tour');
});

test('--ids splits on commas, trims and drops empties', () => {
  const args = parseArgs(argv('--ids', ' m_138545, m_138533,,145115 '));
  assert.deepEqual(args.ids, ['m_138545', 'm_138533', '145115']);
  assert.equal(hasTarget(args), true);
  assert.equal(harvestMode(args), 'ids');
});

test('--ids wins over --tour, and --tour over the search', () => {
  assert.equal(harvestMode(parseArgs(argv('--tour', '1', '--ids', 'm_2'))), 'ids');
  assert.equal(harvestMode(parseArgs(argv('--player', '唐丹', '--tour', '1'))), 'tour');
  assert.equal(harvestMode(parseArgs(argv('--player', '唐丹'))), 'search');
});

test('--ids with no value is an empty list, not a target', () => {
  const args = parseArgs(argv('--ids'));
  assert.deepEqual(args.ids, []);
  assert.equal(hasTarget(args), false);
});

test('an unknown flag throws, naming it', () => {
  assert.throws(() => parseArgs(argv('--tours', '1')), /unknown flag: --tours/);
});

test('idRows defaults the owner to m and rejects a malformed key', () => {
  assert.deepEqual(idRows(['m_138545', '145115', 'x_9']), [
    { owner: 'm', id: '138545', title: 'm_138545' },
    { owner: 'm', id: '145115', title: '145115' },
    { owner: 'x', id: '9', title: 'x_9' },
  ]);
  assert.throws(() => idRows(['m-138545']), /bad id: m-138545/);
});

test('parseTourRows keeps only rows naming the player, both seats', () => {
  const html = `
    <table>
      <tr><td>第7轮</td><td><a href="search/view_m_138545.html">唐丹 先胜 左文静</a></td></tr>
      <tr><td>第7轮</td><td><a href="search/view_m_138533.html">左文静 先和 唐丹</a></td></tr>
      <tr><td>第7轮</td><td><a href="search/view_m_138540.html">刘欢 先负 董毓男</a></td></tr>
    </table>`;
  const rows = parseTourRows(html, '唐丹');
  assert.deepEqual(
    rows.map((row) => `${row.owner}_${row.id}`),
    ['m_138545', 'm_138533'],
  );
  assert.equal(rows[0].title, '第7轮 唐丹 先胜 左文静');
  assert.equal(parseTourRows(html, '').length, 3);
});

test('the login wall is detected only when it comes with no rows', () => {
  const wall = '<html>AI爬虫机器人太多了,请先登陆</html>';
  const row = `<a onclick="view('owner=m&id=138545#f=0')" >唐丹 先胜 左文静</a>`;
  assert.equal(isLoginWall(wall), true);
  assert.equal(isLoginWall(`${wall}${row}`), false);
  assert.equal(isLoginWall('<html>no rows</html>'), false);
  assert.deepEqual(parseRows(row), [{ owner: 'm', id: '138545', title: '唐丹 先胜 左文静' }]);
});
