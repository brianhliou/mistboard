import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHistoricalGame } from './import-historical-xiangqi.js';

const DPXQ_GAME = [
  '[DhtmlXQ]',
  '[DhtmlXQ_title]Test game[/DhtmlXQ_title]',
  '[DhtmlXQ_red]Red player[/DhtmlXQ_red]',
  '[DhtmlXQ_black]Black player[/DhtmlXQ_black]',
  '[DhtmlXQ_result]红胜[/DhtmlXQ_result]',
  '[DhtmlXQ_source_url]http://www.dpxq.com/hldcg/search/view_m_140041.html[/DhtmlXQ_source_url]',
  '[DhtmlXQ_movelist]77477062[/DhtmlXQ_movelist]',
  '[/DhtmlXQ]',
].join('\n');

test('import keeps each game its own source link, the page a DPXQ credit points at (#712)', () => {
  const plan = parseHistoricalGame('view_m_140041.dhtmlxq', DPXQ_GAME);
  assert.ok(plan.ok, plan.ok ? '' : plan.reason);
  assert.equal(plan.game.sourceGameId, 'view_m_140041');
  assert.equal(plan.game.sourceUrl, 'http://www.dpxq.com/hldcg/search/view_m_140041.html');
});

test('import leaves the source link empty when the file has none', () => {
  const plan = parseHistoricalGame(
    'plain.dhtmlxq',
    DPXQ_GAME.replace(/\[DhtmlXQ_source_url\][^\n]*\n/, ''),
  );
  assert.ok(plan.ok);
  assert.equal(plan.game.sourceUrl, null);
});
