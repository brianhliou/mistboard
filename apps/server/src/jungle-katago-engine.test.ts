import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KATAGO_JUNGLE_ENGINE_ID,
  KATAGO_JUNGLE_TIER_LIST,
  katagoJungleConfigPath,
  katagoJungleTierFor,
  katagoMoveCommands,
  katagoMoveFromReplies,
  katagoStageSeconds,
} from './jungle-katago-engine.js';

test('the move is the last two vertex replies, mirrored back into our coordinates', () => {
  // A real transcript: two parameter acknowledgements and a setfen, all empty,
  // then the piece and the square. G5 -> D5 there is a5 -> d5 here, the sideways
  // tiger jump from match game 67.
  assert.equal(katagoMoveFromReplies(['= ', '= ', '= ', '= G5', '= D5']), 'a5d5');
  assert.equal(katagoMoveFromReplies(['= ', '= A1', '= B1']), 'g1f1');
});

test('a pass, a resignation or an error is no move rather than a guess', () => {
  // The engine answers "pass" or "resign" at a terminal, and "?" on a refusal.
  // Half a move is the dangerous case: one vertex and one word would become a
  // plausible-looking move if the parser took whatever it could find.
  for (const replies of [
    ['= ', '= pass'],
    ['= ', '= resign', '= resign'],
    ['? illegal move'],
    ['= ', '= G5'],
    // Stage two answered "pass": in this engine that forfeits the move, and the
    // earlier vertex must not be paired with an older one to make a move.
    ['= ', '= C3', '= D3', '= ', '= G1', '= pass', '= '],
    ['= ', '= G1', '? illegal move'],
    [],
  ]) {
    assert.equal(katagoMoveFromReplies(replies), null, JSON.stringify(replies));
  }
});

test('an out-of-board vertex is refused, not wrapped around', () => {
  // The board is 7 wide; H and rank 0 do not exist. A lenient parse would map
  // them onto a real square and hand the guard a legal-looking wrong move.
  assert.equal(katagoMoveFromReplies(['= H1', '= A1']), null);
  assert.equal(katagoMoveFromReplies(['= A0', '= A1']), null);
});

test('the shipped tier is the measured one, and it is the only one a room can take', () => {
  // 150 visits scored 0.690 against MistyJungle over 50 games; 6 s is the ceiling
  // the prod box needs for it (see the file header). If either moves, the bot is
  // not the engine the challenge was settled against.
  const tier = katagoJungleTierFor(KATAGO_JUNGLE_ENGINE_ID);
  assert.ok(tier);
  assert.equal(tier.visits, 150);
  assert.equal(tier.movetimeCapMs, 6_000);
  assert.equal(KATAGO_JUNGLE_TIER_LIST.length, 1);
  assert.equal(KATAGO_JUNGLE_ENGINE_ID, 'katago-jungle');
  assert.equal(katagoJungleTierFor('katago-jungle-level-1'), null);
  assert.equal(katagoJungleTierFor(undefined), null);
});

test('the move budget is split across the two stages after the startup reserve', () => {
  // 6 s ceiling: 1 s to start and load the net, 2.5 s per stage.
  assert.equal(katagoStageSeconds(6_000), 2.5);
  assert.equal(katagoStageSeconds(4_000), 1.5);
  // Under clock pressure each stage still gets enough search to answer with a
  // square: a handful of visits can answer "pass", which forfeits.
  assert.equal(katagoStageSeconds(50), 0.3);
  assert.equal(katagoStageSeconds(1_200), 0.3);
});

test('one move is budget, position, two genmoves and quit, in KataGo terms', () => {
  // Our start position, red to move: the mirrored board, side 'w' for setfen and
  // 'b' for genmove (jungle-katago-gtp.ts explains the asymmetry).
  const start = 't5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1';
  assert.deepEqual(katagoMoveCommands(start, 'red', { visits: 150, movetimeCapMs: 6_000 }), [
    'kata-set-param maxVisits 150',
    'kata-set-param maxTime 2.500',
    'setfen l5t/1d3c1/r1j1w1e/7/7/7/E1W1J1R/1C3D1/T5L w',
    'genmove b',
    'genmove b',
    'quit',
  ]);
  assert.equal(
    katagoMoveCommands(start.replace(' r ', ' b '), 'black', {
      visits: 150,
      movetimeCapMs: 6_000,
    })[3],
    'genmove w',
  );
});

test('the seat config keeps the rules and search the challenge was played under', () => {
  // The kernel governs repetition and the 200-ply rule only if KataGo does not
  // adjudicate first; the search keys are the ones both matches ran (#434).
  const cfg = readFileSync(katagoJungleConfigPath(), 'utf8');
  const value = (key: string) => new RegExp(`^${key}\\s*=\\s*(\\S+)`, 'm').exec(cfg)?.[1];
  assert.equal(value('loopRule'), 'NONE');
  assert.equal(value('drawJudgeRule'), 'DRAW');
  assert.equal(value('scoringRule'), '0');
  assert.equal(value('cpuctExploration'), '0.5');
  assert.equal(value('useGraphSearch'), 'true');
  assert.equal(value('allowResignation'), 'false');
  assert.equal(value('ponderingEnabled'), 'false');
  assert.equal(value('maxVisits'), String(katagoJungleTierFor(KATAGO_JUNGLE_ENGINE_ID)?.visits));
  // One process per move: a log directory would collect one file per move.
  assert.equal(value('logDir'), undefined);
  assert.equal(value('logFile'), undefined);
});
