import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiMove } from '@mistboard/game';
import {
  BROADCAST_FALLBACK_IMAGE_PATH,
  broadcastEventFallbackMeta,
  broadcastFinalFen,
  broadcastOutcome,
  eventDateRange,
} from './og-broadcast.js';

const OPENING = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

test('the card position is the last one that replays, from the opening', () => {
  assert.ok(broadcastFinalFen([]).startsWith(OPENING));
  // 炮二平五: the cannon on the centre file, Black to move.
  const after = broadcastFinalFen([{ from: 'h3', to: 'e3' } as XiangqiMove]);
  assert.ok(after.startsWith('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b'));
  // A move the rules refuse stops the replay rather than inventing a board.
  const stuck = broadcastFinalFen([
    { from: 'h3', to: 'e3' } as XiangqiMove,
    { from: 'a1', to: 'a9' } as XiangqiMove,
  ]);
  assert.equal(stuck, after);
});

test('the description names the winner and the length in moves', () => {
  const board = (result: string, plies: number) => ({
    red: { name: '曹岩磊', nameEn: 'Cao Yanlei' },
    black: { name: '赖理兄', nameEn: 'Lai Lixiong' },
    result,
    moves: Array.from({ length: plies }),
  });
  assert.equal(broadcastOutcome(board('1-0', 65)), 'Cao Yanlei won with Red in 33 moves');
  assert.equal(broadcastOutcome(board('0-1', 2)), 'Lai Lixiong won with Black in 1 move');
  assert.equal(broadcastOutcome(board('1/2-1/2', 111)), 'Drawn in 56 moves');
  assert.equal(broadcastOutcome(board('*', 10)), 'In play, 5 moves so far');
});

test('a result with no published moves says who won, not how long it took', () => {
  const board = (result: string) => ({
    red: { name: '郑彦隆', nameEn: 'Zheng Yanlong' },
    black: { name: '吴宗翰', nameEn: 'Wu Zonghan' },
    result,
    moves: [],
  });
  assert.equal(broadcastOutcome(board('1-0')), 'Zheng Yanlong beat Wu Zonghan with Red');
  assert.equal(broadcastOutcome(board('0-1')), 'Wu Zonghan beat Zheng Yanlong with Black');
  assert.equal(broadcastOutcome(board('1/2-1/2')), 'Drawn');
  assert.equal(broadcastOutcome(board('*')), 'Not played yet');
});

test("event dates read in the event's own calendar", () => {
  // Midnight in Manila is still the previous day in UTC; the card must not say so.
  assert.equal(
    eventDateRange('2026-10-02T00:00:00+08:00', '2026-10-08T23:59:59+08:00'),
    '2-8 Oct 2026',
  );
  assert.equal(
    eventDateRange('2026-09-30T00:00:00+08:00', '2026-10-02T00:00:00+08:00'),
    '30 Sep - 2 Oct 2026',
  );
  assert.equal(eventDateRange('2026-10-02T00:00:00+08:00'), '2 Oct 2026');
  assert.equal(eventDateRange(undefined, '2026-10-02'), null);
});

test('an event with no game yet previews as itself, not as the homepage', () => {
  const tour = {
    name: '2026年第21届亚洲象棋个人锦标赛 男子组',
    nameEn: '2026 21st Asian Xiangqi Individual Championship Men',
    location: 'Philippines',
    startsAt: '2026-10-02T00:00:00+08:00',
    endsAt: '2026-10-08T23:59:59+08:00',
  };
  const meta = broadcastEventFallbackMeta(tour, '/broadcast/xiangqi/2026-asian-individual-men');
  assert.equal(
    meta.title,
    '2026 21st Asian Xiangqi Individual Championship Men | Mistboard broadcast',
  );
  assert.equal(
    meta.description,
    '2026 21st Asian Xiangqi Individual Championship Men, 2-8 Oct 2026, Philippines. Follow every round in English with results, standings and engine evals, on Mistboard.',
  );
  assert.equal(meta.urlPath, '/broadcast/xiangqi/2026-asian-individual-men');
  assert.equal(meta.imagePath, BROADCAST_FALLBACK_IMAGE_PATH);

  const round = broadcastEventFallbackMeta(
    { name: '亚洲个人赛' },
    '/broadcast/xiangqi/x/round/x-r01',
    { name: '第01轮', nameEn: 'Round 1' },
  );
  assert.equal(round.title, 'Round 1 · 亚洲个人赛 | Mistboard');
  assert.match(round.description, /^亚洲个人赛\. Follow every round/);
});
