import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialJungleState,
  createThreeKingdomsBanqiSetup,
  getJungleLegalMoves,
  jieqiHomeSquares,
  jungleMoveToEngineUci,
  STANDARD_BANQI_DEAL,
  STANDARD_JIEQI_DEAL,
  STANDARD_JUNGLE_FLIP_DEAL,
} from '@mistboard/game';
import { fairPlayMovesFromEvents } from './fair-play-game-inputs.js';
import { summarizeFairPlayAccount } from './fair-play-summary.js';

const roomId = 'fp_game';
function events(variant: string, move: unknown, setup?: unknown, color = 'red') {
  return [
    { type: 'room-created', roomId, at: 1, gameSpecId: variant, ...(setup ? { setup } : {}) },
    { type: 'move-played', roomId, at: 2, color, move },
    { type: 'seat-resigned', roomId, at: 3, color: color === 'red' ? 'black' : 'white' },
  ];
}

test('finished variant replays use each stored engine dialect and the kernel legal set', () => {
  const jungleMove = getJungleLegalMoves(createInitialJungleState(roomId))[0]!;
  const cases = [
    { variant: 'xiangqi', move: { from: 'h3', to: 'e3' }, uci: 'h2e2' },
    { variant: 'jieqi', move: { from: 'b3', to: 'b10' }, setup: STANDARD_JIEQI_DEAL, uci: 'b2b9' },
    { variant: 'banqi', move: { from: 'a1', to: 'a1' }, setup: STANDARD_BANQI_DEAL, uci: 'a0a0' },
    {
      variant: 'jungle-flip',
      move: { from: 'a1', to: 'a1' },
      setup: STANDARD_JUNGLE_FLIP_DEAL,
      uci: 'a0a0',
    },
    { variant: 'jungle', move: jungleMove, uci: jungleMoveToEngineUci(jungleMove) },
    { variant: 'fortress-xiangqi', move: { from: 'a2', to: 'a3' }, uci: 'a2a3' },
    { variant: 'atomic-xiangqi', move: { from: 'h3', to: 'e3' }, uci: 'h3e3' },
    {
      variant: 'three-kingdoms-banqi',
      move: { from: 'a1', to: 'a1' },
      setup: createThreeKingdomsBanqiSetup(() => 0.42),
      uci: 'a1a1',
    },
    { variant: 'gomoku', move: { to: 'a1' }, color: 'black', uci: 'a1' },
  ];
  for (const c of cases) {
    const moves = fairPlayMovesFromEvents(
      c.variant,
      events(c.variant, c.move, c.setup, c.color),
      roomId,
    );
    assert.ok(moves, c.variant);
    assert.equal(moves.length, 1, c.variant);
    assert.equal(moves[0]!.uci, c.uci, c.variant);
    assert.ok(moves[0]!.legalMoves.includes(c.uci), c.variant);
    assert.ok(moves[0]!.legalMoves.length > 1, c.variant);
  }
});

test('legacy and tenant fog logs use the same White/Black move dialect', () => {
  for (const created of [{ variant: 'dark-chess' }, { gameSpecId: 'dark-chess' }]) {
    const log = [
      { type: 'room-created', roomId, at: 1, ...created },
      { type: 'move-played', roomId, at: 2, color: 'white', move: { from: 'e2', to: 'e4' } },
      { type: 'seat-resigned', roomId, at: 3, color: 'black' },
    ];
    const moves = fairPlayMovesFromEvents('dark-chess', log, roomId);
    assert.ok(moves);
    assert.equal(moves[0]!.uci, 'e2e4');
    assert.equal(moves[0]!.color, 'white');
  }
});

test('live, invalid, missing-deal, wrong-variant and unsupported logs cannot become samples', () => {
  const log = events('xiangqi', { from: 'h3', to: 'e3' });
  assert.equal(fairPlayMovesFromEvents('xiangqi', log.slice(0, -1), roomId), null);
  assert.equal(
    fairPlayMovesFromEvents('xiangqi', events('xiangqi', { from: 'e1', to: 'e10' }), roomId),
    null,
  );
  assert.equal(
    fairPlayMovesFromEvents('banqi', events('banqi', { from: 'a1', to: 'a1' }), roomId),
    null,
  );
  assert.equal(fairPlayMovesFromEvents('jungle', log, roomId), null);
  assert.equal(fairPlayMovesFromEvents('dark-xiangqi', [], roomId), null);
  assert.throws(() => fairPlayMovesFromEvents('unknown', log, roomId), /unknown game spec/);
});

test('Jieqi dark-captured and never-revealed identities cannot affect the entire summary payload', () => {
  const black = [...STANDARD_JIEQI_DEAL.black];
  const home = jieqiHomeSquares('black');
  const a = home.indexOf('b10');
  const b = home.indexOf('c10');
  [black[a], black[b]] = [black[b]!, black[a]!];
  const payloads = [STANDARD_JIEQI_DEAL, { red: [...STANDARD_JIEQI_DEAL.red], black }].map(
    (setup) => {
      const log = [
        { type: 'room-created', roomId, at: 1, gameSpecId: 'jieqi', setup },
        { type: 'move-played', roomId, at: 2, color: 'red', move: { from: 'b3', to: 'b10' } },
        { type: 'move-played', roomId, at: 3, color: 'black', move: { from: 'a10', to: 'b10' } },
        { type: 'seat-resigned', roomId, at: 4, color: 'red' },
      ];
      const before = JSON.stringify(log);
      const moves = fairPlayMovesFromEvents('jieqi', log, roomId);
      assert.ok(moves);
      assert.equal(JSON.stringify(log), before);
      return JSON.stringify(
        summarizeFairPlayAccount('user', [
          {
            roomId,
            variant: 'jieqi',
            timeClass: 'blitz',
            rating: 1500,
            playerColor: 'red',
            endedAt: new Date(4).toISOString(),
            engineId: 'fixture-analysis@1',
            depth: 16,
            moves,
            analysis: [0, 1, 2].map((ply) => ({ ply, cp: 0, mate: null, best: null })),
          },
        ]),
      );
    },
  );
  assert.equal(payloads[0], payloads[1]);
  assert.doesNotMatch(
    payloads[0]!,
    /"(?:deal|setup|board|moves|legalMoves|pv|best)":|horse|elephant/,
  );
});
