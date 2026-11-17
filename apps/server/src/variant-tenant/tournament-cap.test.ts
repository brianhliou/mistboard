import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type DuckXiangqiTurn,
  getFortressXiangqiLegalMoves,
  getStandardXiangqiLegalMoves,
} from '@mistboard/game';
import { darkChessTenant } from '../dark-chess-tenant.js';
import { duckXiangqiTenant } from '../duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from '../fortress-xiangqi-tenant.js';
import { isKnownClientMessageType } from '../server-ws-messages.js';
import { xiangqiTenant } from '../xiangqi-tenant.js';
import { buildTenantGameSummary } from './events.js';
import {
  appendTenantRuntimeEvent,
  applyTenantEvent,
  createTenantClock,
  createTenantRuntimeRoomFromEvents,
  freezeTenantClock,
  isTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './runtime.js';
import type { TenantGameStateLike, TenantRoomEvent, VariantTenant } from './tenant.js';

type Color = 'red' | 'black';

function capTests<
  Kind extends string,
  Move,
  State extends TenantGameStateLike<Color>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, Color, Move, State, View, Spec>,
  firstLegalMove: (state: State) => Move,
): void {
  type Event = TenantRoomEvent<Color, Move, Spec>;
  const roomId = `${tenant.roomIdPrefix}tournament_cap`;
  const cap: Event = { type: 'game-tournament-capped', at: 5_000, roomId };

  function opening(): Event[] {
    const events: Event[] = [
      {
        type: 'room-created',
        at: 1_000,
        roomId,
        gameSpecId: tenant.gameSpecId,
        setup: tenant.rules.createSetup?.(),
      },
      { type: 'seat-assigned', at: 1_100, roomId, seat: 'red', clientId: 'red-client' },
      { type: 'seat-assigned', at: 1_200, roomId, seat: 'black', clientId: 'black-client' },
      {
        type: 'clock-started',
        at: 1_300,
        roomId,
        clock: createTenantClock(tenant, 60_000, 1_000),
      },
    ];
    for (const [index, color] of (['red', 'black'] as const).entries()) {
      const state = replayTenantEvents(tenant, events).state;
      const move = firstLegalMove(state);
      assert.ok(tenant.rules.isLegalMove(state, move));
      events.push({ type: 'move-played', at: 2_000 + index * 1_000, roomId, color, move });
    }
    assert.equal(replayTenantEvents(tenant, events).state.status.type, 'playing');
    return events;
  }

  test(`${tenant.kind}: validates a server-authored cap event and its stored log`, () => {
    assert.ok(isTenantEvent(tenant, cap, roomId));
    assert.ok(isTenantEventLog(tenant, [...opening(), cap], roomId));
    assert.equal(isKnownClientMessageType(cap.type), false);
    for (const malformed of [
      { ...cap, at: undefined },
      { ...cap, at: '5000' },
      { ...cap, at: Number.NaN },
      { ...cap, at: Number.POSITIVE_INFINITY },
      { ...cap, roomId: undefined },
      { ...cap, roomId: 'another-room' },
    ]) {
      assert.equal(isTenantEvent(tenant, malformed, roomId), false);
      assert.equal(isTenantEventLog(tenant, [...opening(), malformed], roomId), false);
    }
  });

  test(`${tenant.kind}: cap append, JSON replay and hydration agree on a truncated draw`, () => {
    const events = opening();
    const before = replayTenantEvents(tenant, events);
    assert.equal(before.clock?.activeColor, 'red');
    const hydrated = createTenantRuntimeRoomFromEvents(tenant, events);
    assert.ok(hydrated.ok);
    assert.equal(appendTenantRuntimeEvent(tenant, hydrated.room, cap), events.length);
    const final = hydrated.room.projection;
    assert.deepEqual(final.state, {
      ...before.state,
      status: { type: 'finished', winner: null, reason: 'tournament-cap' },
    });
    assert.deepEqual(final.clock, {
      ...before.clock,
      activeColor: null,
      runningSince: null,
      remainingMs: { red: 59_000, black: 61_000 },
    });
    const stored: unknown[] = JSON.parse(JSON.stringify(hydrated.room.events));
    assert.ok(isTenantEventLog(tenant, stored, roomId));
    assert.deepEqual(replayTenantEvents(tenant, stored), final);
    const reloaded = createTenantRuntimeRoomFromEvents(tenant, stored);
    assert.ok(reloaded.ok);
    assert.deepEqual(reloaded.room.projection, final);
    const summary = buildTenantGameSummary(tenant, reloaded.room);
    assert.ok(summary);
    assert.equal(summary.result, 'draw');
    assert.equal(summary.termination, 'truncated');
    assert.equal(summary.plyCount, 2);
    assert.equal(appendTenantRuntimeEvent(tenant, hydrated.room, cap), -1);
    assert.equal(hydrated.room.events.length, events.length + 1);
  });

  test(`${tenant.kind}: tenants without a cap callback reject it at every boundary`, () => {
    const unsupported = {
      ...tenant,
      rules: { ...tenant.rules, finishTournamentCap: undefined },
    };
    const events = opening();
    assert.equal(isTenantEvent(unsupported, cap, roomId), false);
    assert.equal(isTenantEventLog(unsupported, [...events, cap], roomId), false);
    assert.deepEqual(createTenantRuntimeRoomFromEvents(unsupported, [...events, cap]), {
      ok: false,
      error: 'invalid_event_log',
    });
    const hydrated = createTenantRuntimeRoomFromEvents(unsupported, events);
    assert.ok(hydrated.ok);
    const before = hydrated.room.projection;
    assert.strictEqual(applyTenantEvent(unsupported, before, cap), before);
    assert.equal(appendTenantRuntimeEvent(unsupported, hydrated.room, cap), -1);
    assert.equal(hydrated.room.events.length, events.length);
  });

  test(`${tenant.kind}: a late cap preserves finished wins, draws and aborts`, () => {
    const events = opening();
    const endings: Event[][] = [
      [{ type: 'seat-resigned', at: 4_000, roomId, color: 'red' }],
      [
        { type: 'draw-offered', at: 3_500, roomId, color: 'red' },
        { type: 'draw-agreed', at: 4_000, roomId, color: 'black' },
      ],
    ];
    for (const ending of endings) {
      const finalEvents = [...events, ...ending];
      const before = replayTenantEvents(tenant, finalEvents);
      assert.equal(before.state.status.type, 'finished');
      assert.strictEqual(applyTenantEvent(tenant, before, cap), before);
      assert.deepEqual(replayTenantEvents(tenant, [...finalEvents, cap]), before);
      const hydrated = createTenantRuntimeRoomFromEvents(tenant, finalEvents);
      assert.ok(hydrated.ok);
      assert.equal(appendTenantRuntimeEvent(tenant, hydrated.room, cap), -1);
    }
    const aborted: Event[] = [
      events[0]!,
      { type: 'game-aborted', at: 1_500, roomId, reason: 'user-abort' },
    ];
    const before = replayTenantEvents(tenant, aborted);
    assert.equal(before.state.status.type, 'aborted');
    assert.strictEqual(applyTenantEvent(tenant, before, cap), before);
    assert.deepEqual(replayTenantEvents(tenant, [...aborted, cap]), before);
  });

  test(`${tenant.kind}: cap ends a paused game and clears outstanding draw bookkeeping`, () => {
    const before = replayTenantEvents(tenant, opening());
    const paused = applyTenantEvent(tenant, before, {
      type: 'clock-paused',
      at: 4_000,
      roomId,
      reason: 'shutdown',
      activeColor: 'red',
      clock: freezeTenantClock(before.clock, 4_000)!,
    });
    const final = applyTenantEvent(
      tenant,
      {
        ...paused,
        drawOffer: { from: 'red' },
        drawCooldown: { black: 2 },
      },
      cap,
    );
    assert.deepEqual(final.state.status, {
      type: 'finished',
      winner: null,
      reason: 'tournament-cap',
    });
    assert.equal(final.paused, undefined);
    assert.equal(final.drawOffer, undefined);
    assert.equal(final.drawCooldown, undefined);
    assert.deepEqual(final.clock, paused.clock);
  });
}

capTests(xiangqiTenant, (state) => getStandardXiangqiLegalMoves(state)[0]!);
capTests(fortressXiangqiTenant, (state) => getFortressXiangqiLegalMoves(state)[0]!);
capTests(
  duckXiangqiTenant,
  (state): DuckXiangqiTurn =>
    state.status.type === 'playing' && state.status.turn === 'red'
      ? { from: 'h3', to: 'e3', duckTo: 'e5' }
      : { from: 'h8', to: 'e8', duckTo: 'd5' },
);

test('other registered tenants do not acquire tournament-cap support', () => {
  assert.equal(
    isTenantEvent(darkChessTenant, {
      type: 'game-tournament-capped',
      at: 5_000,
      roomId: 'unsupported-dark-chess',
    }),
    false,
  );
});
