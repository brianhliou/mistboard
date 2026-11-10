import '../../server/src/variant-tenant/register-tenants.js';
import { describe, expect, it } from 'vitest';
import {
  knownEngineIds,
  loadEngine,
  playableLiveEngines,
} from '../../server/src/engine-registry.js';
import {
  FIRST_PARTY_BOT_PROFILES,
  liveSeatEngineName,
  persistedSeatDisplayName,
} from '../../server/src/first-party-bots.js';
import { registeredVariantTenants } from '../../server/src/variant-tenant/registry.js';
import { cardSeatName } from './current-games-model.js';
import { webVariantTenants } from './variant-tenant/registry.js';

// Measured with the real components/CSS and loaded Noto Sans on the local pair,
// 2026-11-10. Name space (not whole row width):
//   viewport       /games live (BOT + 10:00)    finished     meta (BOT + score 1)
//   360 x 800      173.94px                    113.50px     214.31px
//   1440 x 900     >=106.94px (250px card min)  139.66px     197.19px
// The live grid can shrink to a 250px card between column breakpoints. Its
// 106.94px at 13.6px is tighter than the phone's finished row at 12.48px.
// Guard the measured minimum, rounded DOWN. Proportional glyphs mean there is
// no honest universal character limit: e.g. 12 W's overflow, 12 i's fit.
const NAME_BUDGET_PX = 106;

// Printable ASCII advance widths, canvas.measureText, 600 13.6px Noto Sans.
// Use the largest card font for all surfaces, conservatively. Unknown glyphs
// cost one em. This follows home-card-titles.test.ts without a browser in CI.
const ADVANCES = [
  3.536, 3.7669, 6.1483, 8.7856, 7.7792, 11.9063, 10.1077, 3.4063, 4.4104, 4.4104, 7.4212, 7.7792,
  3.7888, 4.3585, 3.7533, 5.421, 7.7792, 7.7792, 7.7792, 7.7792, 7.7792, 7.7792, 7.7792, 7.7792,
  7.7792, 7.7792, 3.7533, 3.7888, 7.7792, 7.7792, 7.7792, 6.2693, 12.2161, 9.14, 8.964, 8.683,
  9.9487, 7.5955, 7.3126, 9.8669, 10.2809, 5.034, 4.2042, 8.7997, 7.4261, 12.6402, 10.785, 10.7043,
  8.3675, 10.7043, 8.7434, 7.4833, 7.7425, 10.1534, 8.5836, 12.9615, 8.6776, 8.2041, 7.8385, 4.4913,
  5.421, 4.4913, 7.7792, 5.7588, 4.5296, 7.95, 8.5087, 6.8329, 8.5087, 7.9495, 5.0427, 8.5087,
  8.6735, 3.8551, 3.8499, 7.991, 3.8447, 13.0519, 8.6735, 8.3934, 8.5087, 8.5087, 5.9062, 6.7108,
  5.5281, 8.6735, 7.4411, 11.2827, 7.6095, 7.4528, 6.5832, 5.2866, 7.4936, 5.2866, 7.7792,
];

function width(name: string): number {
  return [...name].reduce((sum, ch) => sum + (ADVANCES[ch.charCodeAt(0) - 32] ?? 13.6), 0);
}

type Seat = { engineId: string; name: string; family: string };

function seats(): Seat[] {
  const registryIds = new Set<string>(knownEngineIds());
  const webOptions = new Map(
    webVariantTenants().flatMap((tenant) =>
      (tenant.landing?.engineOptions ?? []).map((option) => [option.id, option] as const),
    ),
  );
  const ids = new Set([
    ...registryIds,
    ...FIRST_PARTY_BOT_PROFILES.flatMap((bot) => [
      ...Object.values(bot.engines),
      ...Object.keys(bot.seatNamesByEngineId ?? {}),
      ...(bot.attributionEngineIds ?? []),
    ]),
    ...webOptions.keys(),
  ]);
  const liveIds = new Set<string>(playableLiveEngines().map((engine) => engine.id));
  const tenants = registeredVariantTenants();
  return [...ids].flatMap((engineId) => {
    const engine = registryIds.has(engineId) ? loadEngine(engineId) : null;
    const tenant = tenants.find((entry) => entry.isEngineClientId?.(engineId));
    const webOption = webOptions.get(engineId);
    const profileName = liveSeatEngineName(engineId, null, () => '');
    // Archived/local-only registry descriptions are not supported seat tiers.
    // Every supported tier is discovered by its runtime predicate, including
    // historical IDs still accepted by reconnect, irrespective of prod flags.
    if (!tenant && !liveIds.has(engineId) && !profileName && !webOption) return [];
    // Some aggregate bots (Mahjong) seat generated client IDs rather than the
    // picker's engine ID. Still guard their registry label; do not skip them.
    const fallback = tenant?.engineDisplayName?.(engineId) ?? engine?.name ?? webOption?.name;
    const name = liveSeatEngineName(engineId, null, () => fallback ?? engineId);
    expect(name, `unresolved seat ${engineId}`).not.toBe(engineId);
    return [{ engineId, name, family: engine?.engineName ?? webOption?.familyName ?? name }];
  });
}

// These engines keep their own names, even when they exceed the card budget.
// Use the engine family too: General Blunder runs Fairy-Stockfish.
const THIRD_PARTY = /^(?:Fairy-Stockfish|Pikafish|AB-JChess|jqe|Rapfi|KataGo)(?:\b|$)/;

function overruns(rows: Seat[]): Seat[] {
  return rows.filter(
    ({ name, family }) =>
      !THIRD_PARTY.test(family) &&
      !THIRD_PARTY.test(name) &&
      width(cardSeatName(name)) > NAME_BUDGET_PX,
  );
}

describe('bot seat names fit game cards', () => {
  it('enumerates every supported variant and tier from the registries', () => {
    const rows = seats();
    expect(rows.length).toBeGreaterThan(80);
    expect(overruns(rows)).toEqual([]);
  });

  it('catches a planted overlong name through the same guard, even at a known tier', () => {
    const rows = seats();
    const planted = rows.map((row) =>
      row.engineId === 'misty-three-kingdoms-banqi-level-7'
        ? { ...row, name: 'MistyThreeKingdomsBanqi level 7' }
        : row,
    );
    expect(overruns(planted)).toContainEqual(
      expect.objectContaining({
        engineId: 'misty-three-kingdoms-banqi-level-7',
        name: 'MistyThreeKingdomsBanqi level 7',
      }),
    );
    expect(width('WWWWWWWWWWWW')).toBeGreaterThan(NAME_BUDGET_PX);
    expect(width('iiiiiiiiiiii')).toBeLessThan(NAME_BUDGET_PX);
  });

  it('keeps the recorded name of old Three Kingdoms engine-version participants', () => {
    expect(
      persistedSeatDisplayName({
        displayName: 'MistyThreeKingdomsBanqi level 7',
        subjectType: 'engine-version',
        subjectId: 'misty-three-kingdoms-banqi-level-7',
      }),
    ).toBe('MistyThreeKingdomsBanqi level 7');
  });
});
