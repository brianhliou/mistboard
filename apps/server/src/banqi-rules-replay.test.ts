/**
 * Banqi games replay under the rules they were played with.
 *
 * The 長捉 (perpetual chase) limit shipped in 2026-10. Every room created since
 * records `chaseLimit` in its room-created setup; every room before it stored the
 * bare deal array, and replays with the limit off. Without the stamp an old game
 * replays under the new rule: a chase-cycle repetition draw replays as still
 * playing (chase positions no longer count), and a stored 8th chase move is
 * refused, so the rest of the log replays onto the wrong board.
 *
 * Both fixtures are real games from prod (deal + move list only):
 *   REPETITION_DRAW  bot chases until threefold, drawn at ply 34.
 *   LONG_HUMAN_CHASE the human's general chases a cannon 8 times running at ply
 *                    148, in a game drawn by the 40-ply clock at ply 172.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BANQI_CHASE_LIMIT,
  BANQI_SPEC_ID,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiSeat,
  type BanqiSquare,
  banqiRulesFromView,
  createBanqiStateFromSetup,
  getBanqiForbiddenChaseMoves,
  getBanqiPlayerView,
  readBanqiSetup,
} from '@mistboard/game';
import { analyzeBanqiPostgame } from './banqi-analysis.js';
import { banqiTenant } from './banqi-tenant.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

process.env.MISTBOARD_BANQI_ENABLED = 'true';

const ROLE: Record<string, BanqiPieceRole> = {
  G: 'general',
  A: 'advisor',
  E: 'elephant',
  R: 'chariot',
  H: 'horse',
  C: 'cannon',
  S: 'soldier',
};

function deal(text: string): BanqiDeal {
  return text.split(' ').map((token) => ({
    color: token[0] === 'r' ? 'red' : 'black',
    role: ROLE[token[1]!]!,
  }));
}

function moves(text: string): BanqiMove[] {
  return text.split(' ').map((token) => ({
    from: token.slice(0, 2) as BanqiSquare,
    to: token.slice(2, 4) as BanqiSquare,
  }));
}

const REPETITION_DRAW = {
  deal: deal(
    'rE bS bR bS bR rS rS rC bA bC bS bH rG rS rC bG rA bE bC rH rH bS rA rS rE bE rR bS rS bH rR bA',
  ),
  moves: moves(
    'b2b2 b3b3 d2d2 b1b1 e2e2 a2a2 e1e1 a4a4 a3a3 a3a2 b3a3 a4a3 f2f2 a2b2 e3e3 b2b1 d1d1 b1b2 ' +
      'f1f1 c1c1 e1f1 b2b1 d1e1 e2d2 e1d1 d2e2 d1d2 e2e1 d2d1 e1e2 d1d2 e2e1 d2d1 e1e2',
  ),
};

const LONG_HUMAN_CHASE = {
  deal: deal(
    'bE rR rG bA rS rS bR bS rE rA bS rA bH bR rH rC rC bH rS rR bS bC bS bS rS bE bG rS rE rH bA bC',
  ),
  moves: moves(
    'e1e1 e3e3 d2d2 b2b2 c2c2 f3f3 d2c2 f1f1 c2d2 f3f1 e2e2 e2e1 d2e2 f4f4 e2e1 f1f4 e1e2 d4d4 ' +
      'e2e3 b4b4 e4e4 c4c4 d4c4 f4c4 d3d3 c1c1 b2c2 d1d1 c1d1 c4c2 d3d2 c2b2 d2c2 b3b3 c2b2 c3c3 ' +
      'c3d3 a3a3 b2b3 b4b3 d1c1 b3a3 c1c2 b1b1 c2b2 a4a4 b2b3 a3a4 d3d2 g1g1 e3e2 g2g2 e2e1 g1g2 ' +
      'e1f1 a2a2 d2e2 h3h3 f1g1 f2f2 e2e3 g3g3 g1g2 f2f1 g2g3 h1h1 g3h3 h1g1 h3g3 f1e1 g3g2 g1h1 ' +
      'g2g1 h2h2 e3f3 h4h4 e4e3 g4g4 g1h1 h4h1 h2g2 g4g3 g2g1 e1f1 b3b2 g3f3 b1c1 f1g1 b2b1 f3e3 ' +
      'b1b2 h1h2 c1d1 h2h3 b2c2 g1g2 c2d2 h3h2 d2d3 e3e2 d3e3 e2d2 e3f3 d2d1 f3g3 h2a2 g3g2 d1d2 ' +
      'g2g3 a2a3 g3f3 d2d3 f3f2 d3d4 f2e2 a4b4 e2e3 b4b3 e3e4 d4d3 e4d4 b3c3 d4c4 c3b3 c4b4 b3b2 ' +
      'b4b3 a3a4 b3b2 d3e3 b2b3 a1a1 b3b4 a4a3 b4a4 a3b3 a4a3 b3c3 a3b3 c3c2 b3c3 c2c1 c3c2 c1d1 ' +
      'c2d2 d1c1 d2c2 c1d1 c2c1 d1e1 c1d1 e1f1 d1e1 f1g1 e1e2 e3d3 e2f2 g1h1 f2g2 a1b1 g2g1 h1h2 ' +
      'g1f1 b1c1 f1e1 h2g2 e1d1 c1b1 d1d2 d3e3 d2e2 b1c1',
  ),
};

type BanqiEvent = TenantRoomEvent<BanqiSeat, BanqiMove, typeof BANQI_SPEC_ID>;

function eventLog(roomId: string, setup: unknown, played: readonly BanqiMove[]): BanqiEvent[] {
  const events: BanqiEvent[] = [
    { type: 'room-created', at: 1, roomId, gameSpecId: BANQI_SPEC_ID, setup },
    { type: 'seat-assigned', at: 2, roomId, clientId: 'a', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId, clientId: 'b', seat: 'black' },
  ];
  played.forEach((move, i) => {
    events.push({
      type: 'move-played',
      at: 10 + i,
      roomId,
      color: i % 2 === 0 ? 'red' : 'black',
      move,
    });
  });
  return events;
}

const NEW_RULES = (d: BanqiDeal) => ({ deal: d, chaseLimit: BANQI_CHASE_LIMIT });

test('a stored setup without a stamp reads as the old rules; a new setup carries its limit', () => {
  assert.deepEqual(readBanqiSetup(REPETITION_DRAW.deal).rules, { chaseLimit: null });
  assert.deepEqual(readBanqiSetup(NEW_RULES(REPETITION_DRAW.deal)).rules, {
    chaseLimit: BANQI_CHASE_LIMIT,
  });
  // Fail closed: a setup object with a missing or malformed limit is old rules too.
  assert.deepEqual(readBanqiSetup({ deal: REPETITION_DRAW.deal }).rules, { chaseLimit: null });
  assert.deepEqual(readBanqiSetup({ deal: REPETITION_DRAW.deal, chaseLimit: 'x' }).rules, {
    chaseLimit: null,
  });
  // No stored setup at all (the runtime's seed projection) gets the current rules.
  assert.deepEqual(readBanqiSetup(undefined).rules, {});
});

test('an old repetition draw replays to its stored draw; under the limit it would still be playing', () => {
  const legacy = replayTenantEvents(
    banqiTenant,
    eventLog('bq_legacy_rep', REPETITION_DRAW.deal, REPETITION_DRAW.moves),
  );
  assert.equal(legacy.state.ply, 34);
  assert.deepEqual(legacy.state.status, {
    type: 'finished',
    winner: null,
    reason: 'repetition',
  });

  // The same log stamped with the limit: the chase cycle's positions do not count
  // toward threefold, so the game goes on. This is the rewrite the stamp prevents.
  const stamped = replayTenantEvents(
    banqiTenant,
    eventLog('bq_new_rep', NEW_RULES(REPETITION_DRAW.deal), REPETITION_DRAW.moves),
  );
  assert.equal(stamped.state.ply, 34);
  assert.equal(stamped.state.status.type, 'playing');
});

test('an old game with an 8-move chase replays every stored move; under the limit the 8th is refused', () => {
  const legacy = replayTenantEvents(
    banqiTenant,
    eventLog('bq_legacy_chase', LONG_HUMAN_CHASE.deal, LONG_HUMAN_CHASE.moves),
  );
  assert.equal(legacy.state.ply, 172);
  assert.deepEqual(legacy.state.status, {
    type: 'finished',
    winner: null,
    reason: 'no-progress',
  });

  // Under the limit, ply 148 (the general's 8th chase of the cannon) is forbidden,
  // along with the other step that would keep the chase going.
  let state: BanqiGameState = createBanqiStateFromSetup(
    'bq_probe',
    NEW_RULES(LONG_HUMAN_CHASE.deal),
  );
  for (const move of LONG_HUMAN_CHASE.moves.slice(0, 148)) {
    state = banqiTenant.rules.applyMove(state, move);
  }
  assert.equal(state.ply, 148);
  assert.deepEqual(getBanqiForbiddenChaseMoves(state), [
    { from: 'c2', to: 'd2' },
    { from: 'c2', to: 'c1' },
  ]);
  const stamped = replayTenantEvents(
    banqiTenant,
    eventLog('bq_new_chase', NEW_RULES(LONG_HUMAN_CHASE.deal), LONG_HUMAN_CHASE.moves),
  );
  assert.equal(stamped.state.ply, 148, 'the refused move stops the replay where it was played');
});

test('a new room applies the limit: its state and every view carry it', () => {
  const events = eventLog(
    'bq_new',
    NEW_RULES(REPETITION_DRAW.deal),
    REPETITION_DRAW.moves.slice(0, 4),
  );
  const projection = replayTenantEvents(banqiTenant, events);
  assert.equal(projection.state.chaseLimit, BANQI_CHASE_LIMIT);
  const view = banqiTenant.visibility.viewForClient(
    projection.state,
    { id: 'a', seat: 'red', solo: false },
    events,
  );
  assert.equal(view.chaseLimit, BANQI_CHASE_LIMIT);
  assert.deepEqual(banqiRulesFromView(view), { chaseLimit: BANQI_CHASE_LIMIT });
  const truth = banqiTenant.visibility.truthView?.(projection.state, events);
  assert.equal(truth?.chaseLimit, BANQI_CHASE_LIMIT);
});

test("an old room's views carry no limit, so a client replays it with the limit off", () => {
  const projection = replayTenantEvents(
    banqiTenant,
    eventLog('bq_old', REPETITION_DRAW.deal, REPETITION_DRAW.moves),
  );
  const view = getBanqiPlayerView(projection.state, 'red');
  assert.ok(!('chaseLimit' in view), 'no chaseLimit key on a legacy view');
  assert.ok(!('chases' in view), 'the chase bookkeeping never reaches a view');
  assert.deepEqual(banqiRulesFromView(view), { chaseLimit: null });
});

test('postgame analysis replays the stored setup under its own rules', async () => {
  const evaluated: number[] = [];
  const evaluate = async (s: BanqiGameState) => {
    evaluated.push(s.ply);
    return { cp: 0, mate: null, best: null };
  };
  // Legacy: the sweep reaches the stored draw at ply 34 (terminal, not evaluated).
  const legacy = await analyzeBanqiPostgame(REPETITION_DRAW.moves, REPETITION_DRAW.deal, evaluate);
  assert.equal(legacy.plies.length, 35);
  assert.equal(evaluated.includes(34), false, 'ply 34 is the stored repetition draw');
  // The long chase replays all 172 moves under the old rules.
  evaluated.length = 0;
  const chase = await analyzeBanqiPostgame(LONG_HUMAN_CHASE.moves, LONG_HUMAN_CHASE.deal, evaluate);
  assert.equal(chase.plies.length, 173);
  assert.equal(evaluated.includes(171), true);
});
