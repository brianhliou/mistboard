import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_PARTY_BOT_PROFILES, persistedSeatDisplayName } from './first-party-bots.js';
import { tenantParticipant } from './variant-tenant/events.js';
import { tenantSeatDisplayNames } from './variant-tenant/runtime.js';
import type { TenantRuntimeRoom, VariantTenant } from './variant-tenant/tenant.js';

// A bot seat is named once, by botSeatName. The live room wire
// (tenantSeatDisplayNames), the participant row written at game end
// (tenantParticipant) and the finished-game read (persistedSeatDisplayName)
// must agree for every bot and every engine it fronts or ever fronted. They
// drifted once: a jieqi Level 8 seat read "Pikafish Level 8" live and
// "Pikafish" on the review page, /watch and the homepage TV once it finished.

type AnyTenant = VariantTenant<string, string, unknown, never, unknown, string>;
type AnyRoom = TenantRuntimeRoom<string, string, unknown, never, string>;

function fakeTenant(engineId: string): AnyTenant {
  return {
    colors: ['red', 'black'],
    engine: {
      isEngineClientId: (clientId: string) => clientId === engineId,
      displayName: (clientId: string) => `engine name ${clientId}`,
    },
  } as unknown as AnyTenant;
}

function fakeRoom(engineId: string, pveBotId: string | null): AnyRoom {
  return {
    projection: { seats: { red: 'human-client', black: engineId } },
    pveBotId,
    seatTokens: {},
  } as unknown as AnyRoom;
}

function seatPairs(): { botId: string; engineId: string; pveBotIds: (string | null)[] }[] {
  const pairs = [];
  for (const bot of FIRST_PARTY_BOT_PROFILES) {
    const engineIds = new Set([
      ...Object.values(bot.engines),
      ...Object.keys(bot.seatNamesByEngineId ?? {}),
      ...(bot.attributionEngineIds ?? []),
    ]);
    for (const engineId of engineIds) {
      pairs.push({
        botId: bot.id,
        engineId,
        pveBotIds: [null, bot.id, ...(bot.legacyBotIds ?? [])],
      });
    }
  }
  return pairs;
}

test('every bot seat keeps one name live, in the stored participant and on finished-game reads', () => {
  for (const { botId, engineId, pveBotIds } of seatPairs()) {
    for (const pveBotId of pveBotIds) {
      const where = `${botId} / ${engineId} / pveBotId=${pveBotId}`;
      const tenant = fakeTenant(engineId);
      const room = fakeRoom(engineId, pveBotId);
      const live = tenantSeatDisplayNames(tenant, room).black;
      const stored = tenantParticipant(tenant, 'black', room, 'public');
      assert.equal(stored.subjectType, 'bot', where);
      assert.equal(stored.displayName, live, where);
      assert.equal(persistedSeatDisplayName(stored), live, where);
    }
  }
});

test('every rung label in seatNamesByEngineId is the name the seat shows, live and stored', () => {
  let labels = 0;
  for (const bot of FIRST_PARTY_BOT_PROFILES) {
    for (const [engineId, label] of Object.entries(bot.seatNamesByEngineId ?? {})) {
      labels += 1;
      const tenant = fakeTenant(engineId);
      const room = fakeRoom(engineId, bot.id);
      assert.equal(tenantSeatDisplayNames(tenant, room).black, label, engineId);
      assert.equal(tenantParticipant(tenant, 'black', room, 'public').displayName, label, engineId);
    }
  }
  // Jieqi Level 8 plus the eight xiangqi Pikafish rungs.
  assert.ok(labels >= 9, `expected at least 9 rung labels, found ${labels}`);
});

test('xiangqi and jieqi Pikafish seats name their level like the jieqi ladder bots', () => {
  for (const engineId of ['pikafish-jieqi-strongest', 'pikafish-xiangqi-level-8']) {
    const tenant = fakeTenant(engineId);
    for (const pveBotId of ['pikafish', null]) {
      const room = fakeRoom(engineId, pveBotId);
      assert.equal(tenantSeatDisplayNames(tenant, room).black, 'Pikafish Level 8');
      assert.equal(
        tenantParticipant(tenant, 'black', room, 'public').displayName,
        'Pikafish Level 8',
      );
    }
  }
  const retiredRung = fakeTenant('pikafish-xiangqi-level-3');
  assert.equal(
    tenantSeatDisplayNames(retiredRung, fakeRoom('pikafish-xiangqi-level-3', null)).black,
    'Pikafish Level 3',
  );
});
