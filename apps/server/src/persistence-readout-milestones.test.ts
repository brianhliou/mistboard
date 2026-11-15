import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import { collectReadoutMilestones } from './persistence-readout-milestones.js';

test('a failed milestone metric leaves other collectors available without rejecting generation', async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes('g.rated')) throw new Error('rated collector unavailable');
      if (sql.includes('SELECT name, created_at')) return { rows: [] };
      return { rows: [{ total: 100, last30Days: 10 }] };
    },
  } as unknown as pg.Pool;
  const facts = await collectReadoutMilestones(db, new Date('2026-11-14T17:23:00Z'));
  assert.equal(facts.ratedGames, null);
  assert.deepEqual(facts.pvpGames, { total: 100, last30Days: 10 });
  assert.deepEqual(facts.accounts, { total: 100, last30Days: 10 });
  assert.deepEqual(facts.broadcasts, { total: 0, last30Days: 0 });
  assert.ok(facts.articles && facts.articles.total > 0);
  assert.equal(Object.keys(facts).length, 10);
});

test('broadcast milestones count event groups and duplicate imports once at their first publication', async () => {
  const db = {
    async query(sql: string) {
      if (sql.includes('SELECT name, created_at'))
        return {
          rows: [
            { name: '2026世界象棋公开赛', created_at: new Date('2026-09-01T00:00Z') },
            { name: '2026世界象棋公开赛男子组', created_at: new Date('2026-11-10T00:00Z') },
            { name: '2026世界象棋公开赛女子组', created_at: new Date('2026-11-11T00:00Z') },
            { name: '2026世界象棋公开赛', created_at: new Date('2026-11-12T00:00Z') },
            { name: '2026亚洲象棋锦标赛', created_at: new Date('2026-11-01T00:00Z') },
          ],
        };
      return { rows: [{ total: 0, last30Days: 0 }] };
    },
  } as unknown as pg.Pool;
  assert.deepEqual((await collectReadoutMilestones(db, new Date('2026-11-14T00:00Z'))).broadcasts, {
    total: 2,
    last30Days: 1,
  });
});
