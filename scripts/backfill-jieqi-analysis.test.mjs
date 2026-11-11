import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Run the actual regrade entry point without loading dist/, engines or a database.
// Assert the SQL/parameter contract at the pool boundary: both the legacy join
// and the room-level NOT EXISTS must recognize every current cache-key form.
const source = readFileSync(new URL('./backfill-jieqi-analysis.mjs', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const pikafishId = 'pikafish-jieqi-decisions@test+ref+d6-public';
const abjchessId = 'ab-jchess-jieqi-decisions@test+ref+net+nodes500+rank100+d6-public';
const depth = 6;
const exited = Symbol('exit');

async function regrade(query, { dryRun = true, onlyRoom = null, resolve = () => {} } = {}) {
  const logs = [];
  let ended = false;
  const context = {
    JIEQI_DECISIONS_ENGINE_ID: pikafishId,
    ABJCHESS_JIEQI_DECISIONS_ENGINE_ID: abjchessId,
    JIEQI_DECISION_DEPTH: depth,
    pool: {
      query,
      end: async () => {
        ended = true;
      },
    },
    onlyRoom,
    limit: null,
    dryRun,
    concurrency: 1,
    console: { log: (line) => logs.push(line), error: assert.fail },
    process: {
      exit: (code) => {
        assert.equal(code, 0);
        throw exited;
      },
    },
    loadFinishedJieqiGameInputs: async () => ({ moves: [], deal: {} }),
    resolveJieqiDecisions: resolve,
  };
  const execute = new AsyncFunction(
    ...Object.keys(context),
    `${source.slice(source.indexOf('async function runRegrade()'))}\nawait runRegrade();`,
  );
  await assert.rejects(execute(...Object.values(context)), (error) => error === exited);
  assert.equal(ended, true);
  return logs.join('\n');
}

test('regrade excludes both full and grade-only current ids from legacy rows and rooms', async () => {
  const logs = await regrade(async (sql, params) => {
    assert.match(sql, /a\.engine_id <> ALL\(\$3::text\[\]\)/);
    assert.match(sql, /c\.engine_id = ANY\(\$3::text\[\]\)/);
    assert.deepEqual(params.slice(0, 2), [depth, '%-jieqi-decisions@%']);
    const currentIds = params[2];
    for (const id of [pikafishId, abjchessId]) {
      assert.ok(currentIds.includes(id), `full row is current: ${id}`);
      assert.ok(currentIds.includes(`${id}+no-luck1`), `grade-only row is current: ${id}`);
      assert.ok(!currentIds.includes(id.replace('d6-public', 'd5')));
      assert.ok(!currentIds.includes(`${id.replace('d6-public', 'd5')}+no-luck1`));
    }
    return { rows: [] };
  });
  assert.match(logs, /0 jieqi game\(s\) with only legacy decisions rows/);
  assert.doesNotMatch(logs, /legacy no-luck1/);
});

test('regrade still applies a genuine legacy row with previous-algorithm cache reuse disabled', async () => {
  let computed = 0;
  const legacyId = pikafishId.replace('d6-public', 'd5');
  const logs = await regrade(
    async (sql, params) => {
      assert.match(sql, /g\.room_id = \$4/);
      assert.equal(params[3], 'legacy-room');
      assert.ok(!params[2].includes(legacyId));
      return {
        rows: [{ room_id: 'legacy-room', ply_count: 8, result: '1-0', legacy_ids: [legacyId] }],
      };
    },
    {
      dryRun: false,
      onlyRoom: 'legacy-room',
      resolve: async (...args) => {
        computed++;
        assert.equal(args[0], 'legacy-room');
        assert.equal(args[5], true);
        assert.deepEqual(args[7], { servePreviousAlgorithms: false, rules: undefined });
        return { engineId: pikafishId, decisions: [] };
      },
    },
  );
  assert.equal(computed, 1);
  assert.match(logs, /legacy d5/);
  assert.match(logs, /1 regraded, 0 failed/);
});
