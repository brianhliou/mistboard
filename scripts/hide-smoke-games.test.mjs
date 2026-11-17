import assert from 'node:assert/strict';
import test from 'node:test';
import { CANDIDATES_SQL, hideSmokeGames, selectSmokeGames } from './hide-smoke-games.mjs';

const smoke = {
  room_id: 'gmk_smoke',
  variant: 'gomoku',
  mode: 'pve',
  status: 'completed',
  ply_count: 2,
  ended_at: '2026-11-16T00:00:00Z',
  has_account_seat: false,
  participants: [
    { color: 'black', subjectType: 'guest', clientIds: ['prod-gomoku-smoke-1794874000000'] },
    { color: 'white', subjectType: 'bot', clientIds: ['rapfi-level-1'] },
  ],
};
const guest = (clientIds) => [{ ...smoke.participants[0], clientIds }, smoke.participants[1]];
const fixtures = [
  smoke,
  { ...smoke, room_id: 'real-long-a1', ply_count: 4, participants: guest(['real-device']) },
  { ...smoke, room_id: 'real-two-ply-a1', participants: guest(['real-device']) },
  {
    ...smoke,
    room_id: 'signed-in',
    participants: [{ subjectType: 'user' }, smoke.participants[1]],
  },
  { ...smoke, room_id: 'long-forged-id', ply_count: 3 },
  { ...smoke, room_id: 'account-token', has_account_seat: true },
  { ...smoke, room_id: 'missing-identity', participants: guest([]) },
  {
    ...smoke,
    room_id: 'mixed-identities',
    participants: guest(['prod-gomoku-smoke-1794874000000', 'real-player']),
  },
  { ...smoke, room_id: 'pvp', mode: 'pvp' },
];

test('only proven smoke is selected; accounts, longer and ordinary a1 guest games are untouched', () => {
  assert.deepEqual(
    selectSmokeGames(fixtures).map((row) => row.room_id),
    ['gmk_smoke'],
  );
  for (const fragment of [
    'room_seat_tokens',
    "e.type = 'seat-assigned'",
    't.user_id IS NOT NULL',
    'g.ply_count BETWEEN 0 AND 2',
  ])
    assert.ok(CANDIDATES_SQL.includes(fragment));
});

function database() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: sql.includes('SELECT g.room_id') ? fixtures : [] };
    },
  };
}

test('default is read-only dry run; --yes updates both visibility and stats marker only for selected ids', async () => {
  for (const yes of [false, true]) {
    const client = database();
    const output = [];
    assert.deepEqual(await hideSmokeGames(client, { yes, print: (line) => output.push(line) }), [
      'gmk_smoke',
    ]);
    assert.equal(client.calls[0].sql, yes ? 'BEGIN' : 'BEGIN READ ONLY');
    const updates = client.calls.filter(({ sql }) => sql.startsWith('UPDATE'));
    assert.equal(updates.length, yes ? 2 : 0);
    if (yes) {
      assert.deepEqual(updates[0].params, [['gmk_smoke'], 'release-smoke']);
      assert.deepEqual(updates[1].params, [['gmk_smoke']]);
      assert.match(client.calls[1].sql, /FOR UPDATE OF g$/);
    }
    assert.equal(client.calls.at(-1).sql, 'COMMIT');
    assert.match(output[0], /gmk_smoke/);
  }
});

test('a failed write rolls back the whole maintenance transaction', async () => {
  const client = database();
  const query = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql.startsWith('UPDATE game_participants')) throw new Error('write failed');
    return query(sql, params);
  };
  await assert.rejects(hideSmokeGames(client, { yes: true, print() {} }), /write failed/);
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});
