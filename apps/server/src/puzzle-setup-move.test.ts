import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiMove,
} from '@mistboard/game';
import { positionPuzzleFixture } from './fixtures/xiangqi-position-packet.js';
import {
  englishSourcePlayerName,
  isOnlinePlatformEvent,
  type PuzzleSourceGameRow,
  puzzleDetailSourceFields,
  resetPuzzleSetupMoveCacheForTests,
} from './puzzle-setup-move.js';

test('position-only credit never loads a source game or reconstructs history', async () => {
  let calls = 0;
  const fields = await puzzleDetailSourceFields(positionPuzzleFixture(), async () => {
    calls++;
    throw new Error('PRIVATE_SOURCE_MUST_NOT_BE_LOADED');
  });
  assert.equal(calls, 0);
  assert.equal(fields.credit?.name, 'DPXQ');
  const text = JSON.stringify(fields);
  for (const key of ['sourceGame', 'setupMove', 'history', 'PRIVATE_SOURCE'])
    assert.ok(!text.includes(key));
});

// A short legal game. A puzzle starting at ply N has GAME[N-1] as its setup
// move; GAME[N..] is the game's continuation, which the detail never carries.
const GAME: XiangqiMove[] = [
  { from: 'h3', to: 'e3' },
  { from: 'h10', to: 'g8' },
  { from: 'h1', to: 'g3' },
  { from: 'i10', to: 'h10' },
  { from: 'i1', to: 'h1' },
  { from: 'b10', to: 'c8' },
  { from: 'h1', to: 'h7' },
];

function puzzle(id: string, ply = 4, names?: { redName: string; blackName: string }) {
  let initial = createInitialXiangqiState(id);
  for (const move of GAME.slice(0, ply)) initial = applyStandardXiangqiMove(initial, move);
  return { id, initial, sourceGame: { gameId: 'hxq_src', ply, event: 'Club', ...names } };
}

function row(overrides: Partial<PuzzleSourceGameRow> = {}): PuzzleSourceGameRow {
  return {
    moves: GAME,
    redNameRaw: 'NewRed',
    blackNameRaw: 'NewBlack',
    visibility: 'public',
    ...overrides,
  };
}

test('detail carries the setup move and the game history up to the start ply, cached', async () => {
  resetPuzzleSetupMoveCacheForTests();
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return row();
  };
  const fields = await puzzleDetailSourceFields(puzzle('xq_a'), loader);
  assert.deepEqual(fields.setupMove, { from: 'i10', to: 'h10', captured: null });
  // The three moves before the setup move, and nothing from ply 4 on.
  assert.deepEqual(fields.history, GAME.slice(0, 3));
  await puzzleDetailSourceFields(puzzle('xq_a'), loader);
  assert.equal(loads, 1);
});

test('history never reaches the setup move or the continuation, at any start ply', async () => {
  for (let ply = 1; ply <= GAME.length; ply += 1) {
    resetPuzzleSetupMoveCacheForTests();
    const fields = await puzzleDetailSourceFields(puzzle(`xq_p${ply}`, ply), async () => row());
    assert.deepEqual(
      fields.setupMove && { from: fields.setupMove.from, to: fields.setupMove.to },
      GAME[ply - 1],
    );
    // A puzzle at the game's first ply has nothing before it: no field at all.
    assert.deepEqual(fields.history ?? [], GAME.slice(0, ply - 1), `ply ${ply}`);
    const wire = JSON.stringify(fields.history ?? []);
    for (const later of GAME.slice(ply - 1)) {
      assert.ok(!wire.includes(JSON.stringify(later)), `ply ${ply} leaks ${JSON.stringify(later)}`);
    }
  }
});

test('the row player names replace the stale ones stored on the puzzle and mark it hosted', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const fields = await puzzleDetailSourceFields(
    puzzle('xq_n', 4, { redName: 'OldRed', blackName: 'OldBlack' }),
    async () => row(),
  );
  assert.deepEqual(fields.sourceGame, {
    gameId: 'hxq_src',
    ply: 4,
    event: 'Club',
    redName: 'NewRed',
    blackName: 'NewBlack',
    hosted: true,
  });
});

test('a missing game row leaves the puzzle as before: stored attribution, no history', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const stored = puzzle('xq_m', 4, { redName: 'OldRed', blackName: 'OldBlack' });
  const fields = await puzzleDetailSourceFields(stored, async () => null);
  assert.deepEqual(fields, { sourceGame: stored.sourceGame });
});

// The puzzle card named the platform and printed its pseudonyms
// ("ElephantChess:cqM1Apb2GWRD"). The whole payload is checked, not the
// rendered card, so no later field brings them back.
test('an online platform game goes out as an online game, its date and a link, nothing else', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const base = puzzle('xq_ec', 4, {
    redName: 'ElephantChess:cqM1Apb2GWRD',
    blackName: 'ElephantChess:H8Zr42oigB9S',
  });
  const stored = {
    ...base,
    sourceGame: {
      ...base.sourceGame,
      event: 'ElephantChess PvP',
      playedOn: '2026-03-14',
      result: '1-0',
    },
  };
  const expected = { gameId: 'hxq_src', ply: 4, playedOn: '2026-03-14', online: true };
  // The stored row is listed, so the card links to the game's review page.
  const linked = await puzzleDetailSourceFields(stored, async () =>
    row({ redNameRaw: 'ElephantChess:cqM1Apb2GWRD', blackNameRaw: 'ElephantChess:H8Zr42oigB9S' }),
  );
  assert.deepEqual(linked.sourceGame, { ...expected, hosted: true });
  // The moves before the puzzle still go out: they name no one.
  assert.deepEqual(linked.history, GAME.slice(0, 3));
  assert.doesNotMatch(JSON.stringify(linked), /ElephantChess/);
  resetPuzzleSetupMoveCacheForTests();
  assert.deepEqual(await puzzleDetailSourceFields(stored, null), { sourceGame: expected });
  // A private row: no link.
  resetPuzzleSetupMoveCacheForTests();
  const hidden = await puzzleDetailSourceFields(stored, async () => row({ visibility: 'private' }));
  assert.deepEqual(hidden.sourceGame, expected);
});

test('persistence off sends the stored attribution unlinked', async () => {
  const stored = puzzle('xq_off');
  assert.deepEqual(await puzzleDetailSourceFields(stored, null), { sourceGame: stored.sourceGame });
});

test('a private row keeps the setup move but sends no history, names or link', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const stored = puzzle('xq_priv', 4, { redName: 'OldRed', blackName: 'OldBlack' });
  const fields = await puzzleDetailSourceFields(stored, async () => row({ visibility: 'private' }));
  assert.ok(fields.setupMove);
  assert.equal(fields.history, undefined);
  assert.deepEqual(fields.sourceGame, stored.sourceGame);
});

test('a row that disagrees with the puzzle gives no setup move and no history', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const fields = await puzzleDetailSourceFields(puzzle('xq_c'), async () =>
    row({ moves: [{ from: 'b3', to: 'e3' }] }),
  );
  assert.equal(fields.setupMove, undefined);
  assert.equal(fields.history, undefined);
  // The row still exists and is public, so its names and link stand.
  assert.equal(fields.sourceGame?.hosted, true);
  const { sourceGame: _drop, ...noSource } = puzzle('xq_d');
  assert.deepEqual(await puzzleDetailSourceFields(noSource, async () => row()), {});
});

test('a loader error fails soft and is retried on the next request', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const failed = await puzzleDetailSourceFields(puzzle('xq_e'), async () => {
    throw new Error('pool down');
  });
  assert.equal(failed.setupMove, undefined);
  assert.equal(failed.history, undefined);
  const retried = await puzzleDetailSourceFields(puzzle('xq_e'), async () => row());
  assert.ok(retried.setupMove);
  assert.equal(retried.history?.length, 3);
});

test('Chinese event and names get English forms beside the originals', async () => {
  resetPuzzleSetupMoveCacheForTests();
  const stored = puzzle('xq_zh', 4);
  stored.sourceGame.event = '2026年全国象棋团体赛';
  const fields = await puzzleDetailSourceFields(stored, async () =>
    row({ redNameRaw: '山东省棋牌运动管理中心 黄蕾蕾', blackNameRaw: '金州 Son X Nguyen' }),
  );
  const source = fields.sourceGame;
  assert.equal(source?.event, '2026年全国象棋团体赛');
  assert.equal(source?.eventEn, '2026 National Xiangqi Team Championship');
  assert.equal(source?.redName, '山东省棋牌运动管理中心 黄蕾蕾');
  assert.equal(source?.redNameEn, 'Huang Leilei (Shandong Board Games Centre)');
  assert.equal(source?.blackNameEn, 'Son X Nguyen (Golden State)');
  // Persistence off translates the stored attribution too.
  const off = await puzzleDetailSourceFields(
    { ...stored, sourceGame: { ...stored.sourceGame, redName: '许银川' } },
    null,
  );
  assert.equal(off.sourceGame?.redNameEn, 'Xu Yinchuan');
});

test('an English name needs no English form', () => {
  assert.equal(englishSourcePlayerName('HTown David Nguyen'), undefined);
  assert.equal(englishSourcePlayerName('越南 阮成保'), 'Nguyễn Thành Bảo (Vietnam)');
});

test('only the online platform event marks a game as an online platform game', () => {
  assert.equal(isOnlinePlatformEvent('ElephantChess PvP'), true);
  assert.equal(isOnlinePlatformEvent('Wuyang Cup'), false);
  assert.equal(isOnlinePlatformEvent(null), false);
  assert.equal(isOnlinePlatformEvent(undefined), false);
});
