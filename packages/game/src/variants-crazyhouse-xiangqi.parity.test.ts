// Crazyhouse Xiangqi against its engine.
//
// fixtures/crazyhouse-xiangqi-parity.json is Fairy-Stockfish's answer, loaded
// with apps/server/src/crazyhouse-xiangqi.ini, at several hundred positions of
// real games: the legal moves (`go perft 1`) and the perft-2 node count.
// Regenerate it with scripts/generate-crazyhouse-xiangqi-parity-fixture.mjs.
// A mismatch here is a kernel bug, not a fixture to edit: the engine is what
// the bot plays and what review analyses, so the site's rules must be its.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiPosition,
  crazyhouseXiangqiFen,
  crazyhouseXiangqiLegalMovesOn,
  crazyhouseXiangqiMoveFromUci,
  crazyhouseXiangqiMoveToUci,
  crazyhouseXiangqiPerft,
  crazyhouseXiangqiPositionAfter,
  createInitialCrazyhouseXiangqiState,
  parseCrazyhouseXiangqiFen,
} from './variants-crazyhouse-xiangqi.js';

type FixturePosition = {
  game: number;
  ply: number;
  why: string;
  fen: string;
  checkers?: string;
  moves: string;
  /** Legal drops that give check: the engine refuses each one under `dropChecks = false`. */
  checkingDrops?: string;
  /** Advisor and elephant moves and drops the engine allows only with their regions widened to the whole board. */
  riverBlocked?: string;
  perft2: number;
};
type Fixture = {
  engine: string;
  games: { id: string; result: { winner: string; reason: string }; moves: string }[];
  positions: FixturePosition[];
};

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/crazyhouse-xiangqi-parity.json', import.meta.url), 'utf8'),
) as Fixture;

function positionOf(fen: string): CrazyhouseXiangqiPosition {
  const parsed = parseCrazyhouseXiangqiFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error}`);
  const { board, hands, status } = parsed.state;
  assert.equal(status.type, 'playing');
  return { board, hands, turn: status.type === 'playing' ? status.turn : 'red' };
}

function uciList(position: CrazyhouseXiangqiPosition): string[] {
  return crazyhouseXiangqiLegalMovesOn(position).map(crazyhouseXiangqiMoveToUci).sort();
}

/** Placement, pocket letters sorted per side, side to move: the FEN fields both sides must agree on. */
function comparableFen(fen: string): string {
  const [board = '', turn = ''] = fen.split(' ');
  const bracket = board.indexOf('[');
  const placement = bracket < 0 ? board : board.slice(0, bracket);
  const pocket = bracket < 0 ? '' : board.slice(bracket + 1, -1);
  const red = [...pocket]
    .filter((c) => c === c.toUpperCase())
    .sort()
    .join('');
  const black = [...pocket]
    .filter((c) => c !== c.toUpperCase())
    .sort()
    .join('');
  return `${placement}[${red}${black}] ${turn}`;
}

test('the fixture covers what it claims to', () => {
  assert.ok(fixture.positions.length >= 300, `${fixture.positions.length} positions`);
  const turnHands = (p: FixturePosition) => {
    const [board = '', turn] = p.fen.split(' ');
    const pocket = /\[([^\]]*)\]/.exec(board)?.[1] ?? '';
    return [...pocket].filter((c) => (c === c.toUpperCase()) === (turn === 'w'));
  };
  for (const letter of ['R', 'N', 'B', 'A', 'C', 'P']) {
    const count = fixture.positions.filter((p) =>
      turnHands(p).some((c) => c.toUpperCase() === letter),
    ).length;
    assert.ok(count >= 20, `only ${count} positions with ${letter} in the mover's hand`);
  }
  assert.ok(fixture.positions.filter((p) => p.checkers).length >= 20);
  assert.ok(fixture.positions.filter((p) => p.checkingDrops).length >= 20);
  assert.ok(
    fixture.positions.filter((p) => p.riverBlocked?.split(' ').some((m) => !m.includes('@')))
      .length >= 20,
    'advisor/elephant board moves the river forbids',
  );
});

test('legal moves match Fairy-Stockfish at every fixture position', () => {
  const mismatches: string[] = [];
  for (const p of fixture.positions) {
    const ours = uciList(positionOf(p.fen));
    const theirs = p.moves ? p.moves.split(' ') : [];
    const ourSet = new Set(ours);
    const theirSet = new Set(theirs);
    const extra = ours.filter((m) => !theirSet.has(m));
    const missing = theirs.filter((m) => !ourSet.has(m));
    if (extra.length || missing.length) {
      mismatches.push(
        `${p.fen} (${fixture.games[p.game]?.id} ply ${p.ply}): extra [${extra.join(' ')}] missing [${missing.join(' ')}]`,
      );
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `${mismatches.length} positions disagree:\n${mismatches.slice(0, 10).join('\n')}`,
  );
});

test('every drop that gives check is offered', () => {
  for (const p of fixture.positions) {
    if (!p.checkingDrops) continue;
    const ours = new Set(uciList(positionOf(p.fen)));
    for (const drop of p.checkingDrops.split(' ')) {
      assert.ok(ours.has(drop), `${drop} gives check, legally, at ${p.fen}`);
    }
  }
});

test('no advisor or elephant crosses the river, by move or by drop', () => {
  for (const p of fixture.positions) {
    if (!p.riverBlocked) continue;
    const ours = new Set(uciList(positionOf(p.fen)));
    for (const move of p.riverBlocked.split(' ')) {
      assert.ok(!ours.has(move), `${move} crosses the river at ${p.fen}`);
    }
  }
});

test('perft 2 matches Fairy-Stockfish at every fixture position', () => {
  const mismatches: string[] = [];
  for (const p of fixture.positions) {
    const nodes = crazyhouseXiangqiPerft(positionOf(p.fen), 2);
    if (nodes !== p.perft2) mismatches.push(`${p.fen}: ours ${nodes}, engine ${p.perft2}`);
  }
  assert.deepEqual(
    mismatches,
    [],
    `${mismatches.length} positions disagree:\n${mismatches.slice(0, 10).join('\n')}`,
  );
});

test('replaying the games reaches the engine FEN at every fixture position', () => {
  const byGame = new Map<number, FixturePosition[]>();
  for (const p of fixture.positions) byGame.set(p.game, [...(byGame.get(p.game) ?? []), p]);
  for (const [gameIndex, game] of fixture.games.entries()) {
    const moves = game.moves.split(' ');
    const wanted = new Map((byGame.get(gameIndex) ?? []).map((p) => [p.ply, p.fen]));
    const start = createInitialCrazyhouseXiangqiState('t');
    let position: CrazyhouseXiangqiPosition = {
      board: start.board,
      hands: start.hands,
      turn: 'red',
    };
    for (let ply = 0; ply <= moves.length; ply += 1) {
      const fen = wanted.get(ply);
      if (fen) {
        const state: CrazyhouseXiangqiGameState = {
          ...createInitialCrazyhouseXiangqiState('t'),
          board: position.board,
          hands: position.hands,
          status: { type: 'playing', turn: position.turn },
        };
        assert.equal(
          comparableFen(crazyhouseXiangqiFen(state)),
          comparableFen(fen),
          `${game.id} ply ${ply}`,
        );
      }
      if (ply === moves.length) break;
      const uci = moves[ply]!;
      assert.ok(uciList(position).includes(uci), `${game.id} ply ${ply + 1}: ${uci} is not legal`);
      position = crazyhouseXiangqiPositionAfter(position, crazyhouseXiangqiMoveFromUci(uci)!);
    }
  }
});

test('every game plays out through the production apply and ends as the lab scored it', () => {
  for (const game of fixture.games) {
    let state = createInitialCrazyhouseXiangqiState(game.id);
    const moves = game.moves.split(' ');
    for (const [i, uci] of moves.entries()) {
      assert.equal(state.status.type, 'playing', `${game.id} ended early at ply ${i}`);
      state = applyCrazyhouseXiangqiMove(state, crazyhouseXiangqiMoveFromUci(uci)!);
    }
    assert.ok(state.status.type === 'finished', `${game.id} did not finish`);
    // The lab scored checkmate and three-fold repetition (a draw); nothing else.
    assert.deepEqual(
      { winner: state.status.winner, reason: state.status.reason },
      {
        winner: game.result.winner === 'draw' ? null : game.result.winner,
        reason: game.result.reason,
      },
      game.id,
    );
  }
});
