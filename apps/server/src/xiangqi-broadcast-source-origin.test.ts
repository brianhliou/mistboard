import assert from 'node:assert/strict';
import test from 'node:test';
import { isDpxqBroadcastBoard, isDpxqSourceUrl } from './xiangqi-broadcast-source-origin.js';

test('a dpxq page or the dpxq discovery provider is a dpxq source', () => {
  for (const url of [
    'http://www.dpxq.com/hldcg/search/view_m_123456.html',
    'https://dpxq.com/',
    'HTTP://WWW.DPXQ.COM/x',
    'mistboard-discover://dpxq-tour?tour=12461',
  ]) {
    assert.equal(isDpxqSourceUrl(url), true, url);
  }
});

test('other sites, look-alike hosts and missing URLs are not dpxq', () => {
  for (const url of [
    'https://vietnamchess.vn/databank/xqbase-vietnamchess?view=game&id=1640',
    'https://www.iqipu.com/live/1',
    'https://notdpxq.com/x',
    'https://dpxq.com.example.org/x',
    'https://example.org/?from=dpxq.com',
    'mistboard-discover://wxf-tour?tour=1',
    'not a url',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isDpxqSourceUrl(url), false, String(url));
  }
});

test('a board is dpxq by its own source, else by its tour', () => {
  assert.equal(
    isDpxqBroadcastBoard({ sourceUrl: 'http://www.dpxq.com/a' }, { sourceUrl: null }),
    true,
  );
  assert.equal(
    isDpxqBroadcastBoard({}, { sourceUrl: 'mistboard-discover://dpxq-tour?tour=1' }),
    true,
  );
  assert.equal(
    isDpxqBroadcastBoard(
      { sourceUrl: 'https://vietnamchess.vn/g' },
      { sourceUrl: 'https://vietnamchess.vn/t' },
    ),
    false,
  );
  assert.equal(isDpxqBroadcastBoard(null, null), false);
});
