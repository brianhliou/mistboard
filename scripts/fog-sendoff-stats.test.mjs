import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  analysisMetrics,
  collectReport,
  FOG_MISTY_BOT_SEAT,
  rankCandidates,
  shapeVariantReport,
} from './fog-sendoff-stats.mjs';

const date = '2026-10-01T12:00:00.000Z';
const outcome = { overall: true, total: '3', wins: '1', draws: '1', losses: '1' };
const emptyOutcome = { overall: true, total: '0', wins: '0', draws: '0', losses: '0' };
const emptySummary = { first_game_at: null, last_game_at: null, total: '0', pve: '0', pvp: '0' };
const emptyRows = () => ({
  summary: emptySummary,
  months: [],
  players: { players: '0', accounts: '0' },
  outcomes: [emptyOutcome],
  winners: [],
  active: [],
  wins: [],
});

function win(roomId, cp = [0, -100, 100], options = {}) {
  const color = options.color ?? 'white';
  return {
    room_id: roomId,
    ended_at: date,
    ply_count: cp.length - 1,
    human_color: color,
    analysis_engine_id: 'misty-analysis@fixture',
    analysis_depth: 18,
    analysis: {
      plies: cp.map((value, ply) => ({ ply, cp: value, mate: null })),
      seats: {
        [color]: { budget: { mistakes: options.mistakes ?? 1 } },
        [color === 'white' ? 'black' : 'white']: { budget: { mistakes: 99 } },
      },
    },
  };
}

test('the only mirrored SQL predicate stays identical to persistence-misty-losses', () => {
  const source = readFileSync(
    new URL('../apps/server/src/persistence-misty-losses.ts', import.meta.url),
    'utf8',
  );
  const predicate = source.match(/AND (\(\(b\.subject_type = 'bot'[\s\S]+?)\s+AND g\.ended_at/);
  assert.ok(predicate, 'locate the canonical fog Misty bot-seat predicate');
  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  assert.equal(normalize(FOG_MISTY_BOT_SEAT), normalize(predicate[1]));
});

test('shaping converts pg bigint strings/dates and allowlists public fields', () => {
  const secret = 'DO-NOT-EXPORT-IDENTIFIERS';
  const rows = {
    ...emptyRows(),
    summary: {
      first_game_at: new Date(date),
      last_game_at: date,
      total: '5',
      pve: '3',
      pvp: '2',
      email: secret,
    },
    months: [{ month: '2026-10', total: '5', pve: '3', pvp: '2', subject_id: secret }],
    players: { players: '7', accounts: '4', device_id: secret },
    outcomes: [
      outcome,
      { ...outcome, overall: false, engine_version: null },
      { ...emptyOutcome, overall: false, engine_version: 'v2' },
    ],
    winners: [
      {
        handle: 'player',
        display_name: 'Player',
        wins: '1',
        first_win_at: new Date(date),
        email: secret,
        subject_id: secret,
      },
    ],
    active: [{ handle: 'player', games: '4', display_name: secret }],
    wins: [{ ...win('public-room'), email: secret, human_id: secret, subject_id: secret }],
  };
  const report = shapeVariantReport('dark-chess', rows);
  assert.equal(report.firstGameAt, date);
  assert.deepEqual(report.countedHumanGames, { total: 5, pve: 3, pvp: 2 });
  assert.deepEqual(report.gamesPerMonth, [{ month: '2026-10', total: 5, pve: 3, pvp: 2 }]);
  assert.equal(report.distinctPlayers, 7);
  assert.equal(report.distinctAccounts, 4);
  assert.deepEqual(report.botResults, {
    total: 3,
    wins: 1,
    draws: 1,
    losses: 1,
    unclassified: 0,
    byEngineVersion: [
      { engineVersion: null, total: 3, wins: 1, draws: 1, losses: 1, unclassified: 0 },
      { engineVersion: 'v2', total: 0, wins: 0, draws: 0, losses: 0, unclassified: 0 },
    ],
  });
  assert.deepEqual(report.accountsWhoBeatBot, [
    { handle: 'player', displayName: 'Player', wins: 1, firstWinAt: date },
  ]);
  assert.deepEqual(report.mostActiveAccounts, [{ handle: 'player', games: 4 }]);
  assert.ok(!JSON.stringify(report).includes(secret));
});

test('empty variants produce zero counts and null dates, not missing fields', () => {
  const report = shapeVariantReport('dark-xiangqi', emptyRows());
  assert.equal(report.firstGameAt, null);
  assert.equal(report.lastGameAt, null);
  assert.deepEqual(report.countedHumanGames, { total: 0, pve: 0, pvp: 0 });
  assert.deepEqual(report.botResults, {
    total: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    unclassified: 0,
    byEngineVersion: [],
  });
  assert.deepEqual(report.bestGameCandidates, []);
});

test('analysis uses the human seat, temporal recovery and the correct eval POV', () => {
  assert.equal(analysisMetrics(win('white', [50, -400, 300], { mistakes: 2 })).comebackCp, 700);
  const black = analysisMetrics(win('black', [-50, 400, -300], { color: 'black', mistakes: 0 }));
  assert.equal(black.comebackCp, 700);
  assert.equal(black.mistakes, 0);
  assert.equal(analysisMetrics(win('decline', [500, 100, -500])).comebackCp, 0);
  assert.equal(analysisMetrics(win('growing-lead', [0, 100, 500])).comebackCp, 0);
  assert.equal(analysisMetrics(win('mate-gap', [-500, null, 200])).comebackCp, 0);
  const mate = win('mate', [-500, 200, 0]);
  mate.analysis.plies[1].mate = 1;
  assert.equal(analysisMetrics(mate).comebackCp, 0);
});

test('missing, incomplete, duplicate and unknown analysis cannot look like zero mistakes', () => {
  assert.equal(analysisMetrics({ ...win('none'), analysis: null }), null);
  const partial = win('partial');
  partial.analysis.plies.pop();
  assert.equal(analysisMetrics(partial), null);
  const duplicate = win('duplicate');
  duplicate.analysis.plies[2].ply = 1;
  assert.equal(analysisMetrics(duplicate), null);
  assert.equal(analysisMetrics(win('vacuous', [null, null, null])), null);
  const noBudget = win('unknown');
  delete noBudget.analysis.seats.white.budget.mistakes;
  assert.equal(analysisMetrics(noBudget).mistakes, null);
});

test('Fog Chess balances categories, deduplicates reasons, caps at 12 and preserves input', () => {
  const clean = win('clean', [0, -10, 0], { mistakes: 0 });
  const comeback = win('comeback', [0, -900, 300], { mistakes: 5 });
  const long = { ...win('long'), ply_count: 100, analysis: null };
  const others = Array.from({ length: 20 }, (_, i) =>
    win(`win-${String(i).padStart(2, '0')}`, [0, -100, i + 1], { mistakes: 2 }),
  );
  const input = [long, comeback, ...others, clean];
  const before = structuredClone(input);
  const ranked = rankCandidates('dark-chess', input);
  assert.deepEqual(
    ranked.slice(0, 3).map((r) => r.roomId),
    ['clean', 'comeback', 'long'],
  );
  assert.equal(ranked.length, 12);
  assert.equal(new Set(ranked.map((r) => r.roomId)).size, 12);
  assert.ok(ranked[0].reasons.some((r) => r.includes('mistakes: 0')));
  assert.ok(ranked[1].reasons.some((r) => r.includes('1200 cp')));
  assert.deepEqual(input, before);
  assert.deepEqual(rankCandidates('dark-chess', [...input].reverse()), ranked);
  assert.equal(rankCandidates('dark-chess', [clean])[0].reasons.length, 3);
});

test('Fog Xiangqi preserves the first ever win alongside the 11 longest wins', () => {
  const early = { ...win('first'), ended_at: '2026-06-02T00:00:00Z', analysis: null };
  const others = Array.from({ length: 20 }, (_, i) => ({
    ...win(`room-${i}`),
    ply_count: i + 10,
    analysis: null,
  }));
  const candidates = rankCandidates('dark-xiangqi', [...others, early]);
  assert.equal(candidates.length, 12);
  assert.equal(candidates[0].roomId, 'first');
  assert.ok(candidates[0].reasons.some((r) => r.includes('First counted')));
  assert.deepEqual(
    candidates.slice(1).map((r) => r.plyCount),
    Array.from({ length: 11 }, (_, i) => 29 - i),
  );
  assert.equal(rankCandidates('dark-xiangqi', [early])[0].reasons.length, 2);
  assert.deepEqual(rankCandidates('dark-xiangqi', []), []);
  assert.throws(() => rankCandidates('unknown', []), /unsupported/);
});

test('all queries share a repeatable read-only transaction and reuse canonical filters', async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql === 'SELECT CURRENT_TIMESTAMP AS as_of') return { rows: [{ as_of: new Date(date) }] };
      if (sql.includes('AS first_game_at')) return { rows: [emptySummary] };
      if (sql.includes('AS players')) return { rows: [{ players: '0', accounts: '0' }] };
      if (sql.includes('GROUPING SETS')) return { rows: [emptyOutcome] };
      return { rows: [] };
    },
  };
  const report = await collectReport(client);
  assert.equal(report.asOf, date);
  assert.equal(report.variants.length, 2);
  assert.equal(queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  const { countedHumanGame, countedPlayerSeat, countedAccountSeat, seatWonGame } = await import(
    '../apps/server/src/persistence-counted-games.ts'
  );
  const reads = queries.filter((q) => q.values);
  assert.equal(reads.length, 14);
  for (const { sql, values } of reads) {
    assert.ok(sql.startsWith('WITH counted AS MATERIALIZED'));
    assert.ok(sql.includes(countedHumanGame('g')));
    assert.ok(['dark-chess', 'dark-xiangqi'].includes(values[0]));
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|COPY)\b/i);
    if (sql.includes('AS players')) assert.ok(sql.includes(countedPlayerSeat('p')));
    if (sql.includes('JOIN users u')) assert.ok(sql.includes(countedAccountSeat('p')));
    if (sql.includes('bot_games AS')) {
      assert.ok(sql.includes(FOG_MISTY_BOT_SEAT));
      assert.ok(sql.includes(seatWonGame('h', 'g')));
      assert.ok(sql.includes(seatWonGame('b', 'g')));
    }
  }
});

test('a failed read rolls back and propagates failure instead of partial JSON', async () => {
  const statements = [];
  await assert.rejects(
    collectReport({
      async query(sql) {
        statements.push(sql);
        if (sql.startsWith('SELECT')) throw new Error('fixture database failure');
        return { rows: [] };
      },
    }),
    /fixture database failure/,
  );
  assert.equal(statements.at(-1), 'ROLLBACK');
});

test('CLI help needs no database and write/dry-run flags are refused', () => {
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/fog-sendoff-stats.mjs', ...args], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: { PATH: process.env.PATH },
    });
  const help = run('--help');
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Read-only JSON report/);
  for (const args of [[], ['--dry-run'], ['--apply']]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Fog send-off report failed/);
  }
});
