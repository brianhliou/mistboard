import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { GameEvent, Move } from '@mistboard/game';
import { resolveStockfishPath } from './engine-paths.js';
import {
  buildMistyLossReport,
  type MistyLossGame,
  renderMistyLossReport,
  withMistyStockfishGrader,
} from './misty-loss-report.js';
import { countedHumanGame, seatWonGame } from './persistence-counted-games.js';
import { loadMistyLosses, type MistyLossQuery } from './persistence-misty-losses.js';

const move = (uci: string): Move => ({
  from: uci.slice(0, 2) as Move['from'],
  to: uci.slice(2, 4) as Move['to'],
});

// A complete, kernel-replayable Fog loss. White ignores ...Qh4 and loses its
// king. The planted g4 blunder is graded before the later non-chess positions.
function plantedLoss(gameId = 'planted-loss'): MistyLossGame {
  const moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4', 'a2a3', 'h4e1'];
  const events: GameEvent[] = [
    { type: 'room-created', roomId: gameId, at: 0, variant: 'dark-chess' },
    ...moves.map(
      (uci, index): GameEvent => ({
        type: 'move-played',
        roomId: gameId,
        at: index + 1,
        color: index % 2 ? 'black' : 'white',
        move: move(uci),
      }),
    ),
  ];
  return {
    gameId,
    engineColor: 'white',
    events,
    decisions: [
      // A decoy at the MOVE ply catches the old context-ply confusion.
      { ply: 3, engineColor: 'white', payload: { move: move('g2g4') } },
      {
        ply: 2,
        engineColor: 'white',
        payload: {
          move: move('g2g4'),
          engine_diagnostics: {
            beliefSize: 128,
            moveRanking: [
              ['b1c3', 0.8],
              ['g2g4', 0.1],
            ],
            commitGuardChangedMove: true,
          },
        },
      },
    ],
  };
}

test('finds the planted blunder in a lost game, with truth FEN and its stored decision', async () => {
  const calls: Array<{ fen: string; played: string }> = [];
  const report = await buildMistyLossReport([plantedLoss()], async (fen, played) => {
    calls.push({ fen, played });
    return {
      bestMove: played === 'g2g4' ? 'b1c3' : played,
      bestCp: 50,
      playedCp: played === 'g2g4' ? -500 : 50,
      bestMate: null,
      playedMate: null,
    };
  });
  assert.equal(report.gamesAnalyzed, 1);
  assert.equal(report.ranked.length, 1);
  assert.deepEqual(report.ranked[0], {
    gameId: 'planted-loss',
    gameUrl: 'https://mistboard.com/game/planted-loss',
    ply: 3,
    engineColor: 'white',
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2',
    playedMove: 'g2g4',
    bestMove: 'b1c3',
    dropPawns: 5.5,
    bestCp: 50,
    playedCp: -500,
    bestMate: null,
    playedMate: null,
    beliefSize: 128,
    bestMoveVisible: true,
    bestMoveLegal: true,
    bestMoveRank: 1,
    commitGuardChangedMove: true,
    rankingTopDiffersFromPlayed: true,
    decisionStatus: 'matched',
  });
  assert.deepEqual(
    calls.map((c) => c.played),
    ['f2f3', 'g2g4', 'a2a3'],
  );
  assert.ok(calls[1].fen.includes('rnbqkbnr')); // truth includes the hidden army
});

test('ranks one worst move per game, deterministically, including Black mover scores', async () => {
  const black = plantedLoss('black');
  black.engineColor = 'black';
  black.events = black.events.slice(0, 3);
  black.events.push({ type: 'seat-resigned', roomId: 'black', at: 9, color: 'black' });
  const a = plantedLoss('a');
  const z = plantedLoss('z');
  const grade = async (_fen: string, played: string) => ({
    bestMove: 'b1c3',
    bestCp: 100,
    playedCp: played === 'e7e5' ? -700 : -450,
    bestMate: null,
    playedMate: null,
  });
  const report = await buildMistyLossReport([z, a, black], grade);
  assert.deepEqual(
    report.ranked.map((r) => [r.gameId, r.ply, r.dropPawns]),
    [
      ['black', 2, 8],
      ['a', 1, 5.5],
      ['z', 1, 5.5],
    ],
  );
  assert.deepEqual(await buildMistyLossReport([black, a, z], grade), report);
});

test('missing, mismatched and duplicate decision records stay unknown', async () => {
  for (const kind of ['missing', 'mismatched', 'duplicate', 'no-fields'] as const) {
    const game = plantedLoss();
    const record = game.decisions[1];
    game.decisions = kind === 'missing' ? [] : kind === 'duplicate' ? [record, record] : [record];
    if (kind === 'mismatched') record.payload.move = move('e2e4');
    if (kind === 'no-fields') record.payload.engine_diagnostics = {};
    const report = await buildMistyLossReport([game], async (_fen, played) => ({
      bestMove: 'b1c3',
      bestCp: 0,
      playedCp: played === 'g2g4' ? -550 : 0,
      bestMate: null,
      playedMate: null,
    }));
    assert.equal(report.ranked[0].beliefSize, null);
    assert.equal(report.ranked[0].bestMoveRank, null);
    assert.equal(report.ranked[0].commitGuardChangedMove, null);
    assert.equal(report.ranked[0].decisionStatus, kind === 'no-fields' ? 'matched' : kind);
  }
});

test('rejects live, won, foreign, duplicate and corrupt event logs before grading', async () => {
  const grade = async () => {
    throw new Error('must not grade');
  };
  const live = plantedLoss();
  live.events = live.events.slice(0, 3);
  const won = plantedLoss();
  won.engineColor = 'black';
  const foreign = plantedLoss();
  foreign.events[2] = { ...foreign.events[2], roomId: 'another-room' };
  const corrupt = plantedLoss();
  corrupt.events[1] = { ...corrupt.events[1], color: 'black' } as GameEvent;
  for (const game of [live, won, foreign, corrupt]) {
    await assert.rejects(buildMistyLossReport([game], grade), /invalid finished Fog loss/);
  }
  await assert.rejects(buildMistyLossReport([plantedLoss(), plantedLoss()], grade), /duplicate/);
});

test('does not fabricate drops for missing scores or ungradable Fog moves', async () => {
  const report = await buildMistyLossReport([plantedLoss()], async () => null);
  assert.deepEqual(report.ranked, []);
  assert.equal(report.skipped.length, 3);
  assert.ok(report.skipped.every((s) => s.reason === 'stockfish-incompatible'));
});

test('does not blame a played best move or a score improvement', async () => {
  for (const best of [true, false]) {
    const report = await buildMistyLossReport([plantedLoss()], async (_fen, played) => ({
      bestMove: best ? played : 'b1c3',
      bestCp: 0,
      playedCp: best ? -550 : 50,
      bestMate: null,
      playedMate: null,
    }));
    assert.deepEqual(report.ranked, []);
  }
});

test('best visibility and legality are checked against the reconstructed Misty view', async () => {
  const report = await buildMistyLossReport([plantedLoss()], async () => ({
    bestMove: 'a8a7',
    bestCp: 0,
    playedCp: -550,
    bestMate: null,
    playedMate: null,
  }));
  assert.equal(report.ranked[0].bestMoveVisible, false);
  assert.equal(report.ranked[0].bestMoveLegal, false);
});

test('loads only counted Misty Fog PvE losses to people within a bounded window', async () => {
  const game = plantedLoss();
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query: MistyLossQuery = async <T>(sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    const rows =
      calls.length === 1
        ? [{ game_id: game.gameId, engine_color: game.engineColor }]
        : calls.length === 2
          ? game.events.map((payload) => ({ payload }))
          : game.decisions.map((d) => ({
              ply: d.ply,
              engine_color: d.engineColor,
              payload: d.payload,
            }));
    return { rows: rows as T[] };
  };
  const since = new Date('2026-10-19T00:00:00Z');
  const until = new Date('2026-10-26T00:00:00Z');
  assert.deepEqual(await loadMistyLosses(since, until, 'ef172100', query), [game]);
  assert.ok(calls[0].sql.includes(countedHumanGame('g')));
  assert.ok(calls[0].sql.includes(seatWonGame('h', 'g')));
  assert.match(calls[0].sql, /g.variant = 'dark-chess' AND g.mode = 'pve'/);
  assert.match(calls[0].sql, /h.subject_type IN \('user', 'guest'\)/);
  assert.match(calls[0].sql, /b.subject_id IN \('misty', 'misty-dark-chess'\)/);
  assert.match(calls[0].sql, /b.subject_type = 'engine-version'/);
  assert.match(calls[0].sql, /g.ended_at >= \$1 AND g.ended_at < \$2/);
  assert.deepEqual(calls[0].values, [since, until, 'ef172100']);
  assert.match(calls[1].sql, /ORDER BY seq ASC/);
  assert.deepEqual(calls[2].values, [game.gameId, 'live-engine-decision', 'white']);
  assert.match(calls[2].sql, /ORDER BY ply, id/);
  for (const [start, end, prefix] of [
    [until, since, null],
    [since, until, "bad'prefix"],
  ] as const) {
    await assert.rejects(loadMistyLosses(start, end, prefix, query));
  }
});

test('markdown includes review context and explicit ungradable coverage', async () => {
  const report = await buildMistyLossReport([plantedLoss()], async (_fen, played) =>
    played === 'a2a3'
      ? null
      : { bestMove: 'b1c3', bestCp: 0, playedCp: -550, bestMate: null, playedMate: null },
  );
  const markdown = renderMistyLossReport(report);
  assert.match(markdown, /https:\/\/mistboard.com\/game\/planted-loss/);
  assert.match(markdown, /FEN:/);
  assert.match(markdown, /best move visible: yes/);
  assert.match(markdown, /Commit guard changed move: unknown/);
  assert.match(markdown, /Ungradable: planted-loss, ply 5/);
});

test('CLI help and invalid arguments need no network, database or engine', () => {
  const script = new URL('../../../scripts/misty-loss-report.mjs', import.meta.url);
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', script.pathname, ...args], {
      encoding: 'utf8',
    });
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--out <private-file>/);
  const invalid = run(['--depth', '0']);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Misty loss report failed/);
});

const stockfish = resolveStockfishPath();
test('rejects bounded-only Stockfish scores instead of calling a bound a measured drop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'misty-loss-uci-'));
  const bin = join(dir, 'bounded.mjs');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line === 'uci') process.stdout.write('option name Threads type spin default 1 min 1 max 1\\noption name Hash type spin default 64 min 1 max 64\\noption name MultiPV type spin default 1 min 1 max 1\\nuciok\\n');
  if (line === 'isready') process.stdout.write('readyok\\n');
  if (line.startsWith('go')) process.stdout.write('info depth 18 score cp 550 lowerbound pv b1c3\\nbestmove b1c3\\n');
});
`,
    { mode: 0o700 },
  );
  await assert.rejects(
    withMistyStockfishGrader((grade) => buildMistyLossReport([plantedLoss()], grade), {
      bin,
      depth: 18,
    }),
    /Stockfish.*score/,
  );
});

test('Stockfish accepts kernel castling aliases and underpromotion UCI', {
  skip: !stockfish,
}, async () => {
  await withMistyStockfishGrader(
    async (grade) => {
      const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
      const alias = await grade(fen, 'e1h1');
      assert.ok(alias);
      assert.deepEqual(alias, await grade(fen, 'e1g1'));
      assert.ok(await grade('7k/P7/8/8/8/8/8/7K w - - 0 1', 'a7a8n'));
    },
    { bin: stockfish, depth: 2 },
  );
});

test('Stockfish catches the planted g4 blunder and skips the later Fog-only move', {
  skip: !stockfish,
}, async () => {
  const run = () =>
    withMistyStockfishGrader((grade) => buildMistyLossReport([plantedLoss()], grade), {
      bin: stockfish,
      depth: 4,
    });
  const report = await run();
  assert.equal(report.ranked[0].ply, 3);
  assert.equal(report.ranked[0].playedMove, 'g2g4');
  assert.ok(report.ranked[0].dropPawns > 5);
  assert.deepEqual(report.skipped, [
    { gameId: 'planted-loss', ply: 5, reason: 'stockfish-incompatible' },
  ]);
  assert.deepEqual(await run(), report);
});
