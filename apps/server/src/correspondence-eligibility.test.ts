/**
 * Registry-driven conformance for correspondence eligibility.
 *
 * CORRESPONDENCE_ELIGIBLE_SPECS is a hand-coded product decision (see the comment on it),
 * so nothing type-checks its members against the registrations that have to back them. That
 * gap is real: a spec admitted WITHOUT a sweepDueDeadline yields correspondence games that
 * never time out and hang forever, and one without createCorrespondenceGameForSeek fails
 * only when a player actually accepts a seek. These tests are the pairing's only enforcement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_VARIANT_ORDER,
  CHESS_SPEC_ID,
  correspondenceTimeControl,
  GAME_SPECS,
  isCorrespondenceRatedSpec,
  isOfficialTimeControl,
  MAHJONG_SPEC_ID,
  XIANGQI_MAHJONG_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { isAllowlistedGameSpec } from './persistence-variant-access.js';
import {
  CORRESPONDENCE_ALLOWLISTED_SPECS,
  CORRESPONDENCE_ELIGIBLE_SPECS,
} from './routes/correspondence-rooms.js';
// Side-effect import: registers every tenant, so this sees the set the server boots with.
import './variant-tenant/register-tenants.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';

test('every correspondence-eligible spec can create AND time out a game', () => {
  assert.ok(CORRESPONDENCE_ELIGIBLE_SPECS.size > 0);
  for (const specId of CORRESPONDENCE_ELIGIBLE_SPECS) {
    const tenant = correspondenceTenantForSpecId(specId);
    assert.ok(tenant, `${specId} is correspondence-eligible but has no registration`);
    assert.equal(
      typeof tenant.createCorrespondenceGameForSeek,
      'function',
      `${specId} is correspondence-eligible but cannot create a game for a seek`,
    );
    assert.equal(
      typeof tenant.sweepDueDeadline,
      'function',
      // The failure this catches is silent and unbounded: no sweeper means no deadline
      // enforcement, so a game sits open forever rather than timing out.
      `${specId} is correspondence-eligible but has no deadline sweeper`,
    );
  }
});

test('every correspondence-eligible spec is a real game spec', () => {
  for (const specId of CORRESPONDENCE_ELIGIBLE_SPECS) {
    assert.ok(
      GAME_SPECS.some((spec) => spec.id === specId),
      `${specId} is correspondence-eligible but is not a known game spec`,
    );
  }
});

test('every variant on the public shelf is eligible, and nothing else (2026-10-02)', () => {
  // Brian: "all of them should support it". The shelf is CANONICAL_VARIANT_ORDER,
  // the one list every picker reads; mahjong and study-only chess are not on it.
  // A variant added to the shelf without correspondence fails here, not in a
  // player's start panel.
  assert.deepEqual([...CORRESPONDENCE_ELIGIBLE_SPECS].sort(), [...CANONICAL_VARIANT_ORDER].sort());
  assert.ok(!CORRESPONDENCE_ELIGIBLE_SPECS.has(MAHJONG_SPEC_ID));
  assert.ok(!CORRESPONDENCE_ELIGIBLE_SPECS.has(CHESS_SPEC_ID));
});

test('standard xiangqi is eligible — the 2026-07-04 fork-6 partial reversal', () => {
  // Pins the product decision itself, not just the plumbing: perfect-information
  // correspondence is allowed. Xiangqi is visibility 'open', so this is exactly the case
  // the original hidden-info-only rule excluded.
  assert.ok(CORRESPONDENCE_ELIGIBLE_SPECS.has(XIANGQI_SPEC_ID));
  const xiangqi = GAME_SPECS.find((spec) => spec.id === XIANGQI_SPEC_ID);
  assert.equal(xiangqi?.visibility, 'open');
});

test('correspondence never becomes a LIVE rated pace — it rates only in its own pool', () => {
  // 2026-10-02: rated correspondence exists, but in a separate 'correspondence' pool per
  // variant (rating-buckets.ts). The live allowlist must still never admit a
  // days-per-move allowance, or a correspondence game could land on a live ladder.
  for (const daysPerMove of [1, 3, 7]) {
    assert.equal(
      isOfficialTimeControl({ initialMs: daysPerMove * 86_400_000, incrementMs: 0, daysPerMove }),
      false,
      `${daysPerMove}-day correspondence must never be a live ratable time control`,
    );
  }
});

test('every rated-correspondence spec has a seek factory that honours `rated`', async () => {
  // isCorrespondenceRatedSpec is derived (eligible AND a rating pool), so a spec another
  // change makes correspondence-eligible becomes rateable on its own. This is what makes
  // that safe: its factory must actually create a rated room when asked, and a casual
  // one otherwise, and report which. A factory that drops `rated` fails here instead of
  // quietly seating rated seeks in casual games.
  // Every variant's server flag on, as in prod, so each factory actually builds a room.
  const flags = VARIANT_FLAGS;
  const prior = new Map(flags.map((flag) => [flag, process.env[flag]]));
  for (const flag of flags) process.env[flag] = 'true';
  try {
    const ratedSpecs = [...CORRESPONDENCE_ELIGIBLE_SPECS].filter(isCorrespondenceRatedSpec);
    // Every launched variant is correspondence-eligible and has a rating pool, so the
    // whole set is rateable by correspondence (mahjong and chess are not eligible).
    assert.deepEqual([...ratedSpecs].sort(), [...CORRESPONDENCE_ELIGIBLE_SPECS].sort());
    for (const specId of ratedSpecs) {
      const tenant = correspondenceTenantForSpecId(specId);
      const create = tenant?.createCorrespondenceGameForSeek;
      assert.ok(create, `${specId} is rated-eligible but has no seek factory`);
      for (const rated of [true, false]) {
        const created = await create({
          timeControl: correspondenceTimeControl(3),
          first: { userId: `first-${specId}` },
          second: { userId: `second-${specId}` },
          rated,
        });
        assert.ok(created.ok, `${specId} factory failed (${rated ? 'rated' : 'casual'})`);
        assert.equal(created.room.rated, rated, `${specId} factory ignored rated=${rated}`);
      }
      tenant?.clearRooms();
    }
  } finally {
    for (const [flag, value] of prior) {
      if (value === undefined) delete process.env[flag];
      else process.env[flag] = value;
    }
  }
});

const VARIANT_FLAGS = [
  'MISTBOARD_XIANGQI_ENABLED',
  'MISTBOARD_FORTRESS_XIANGQI_ENABLED',
  'MISTBOARD_BANQI_ENABLED',
  'MISTBOARD_JUNGLE_ENABLED',
  'MISTBOARD_JUNGLE_FLIP_ENABLED',
  'MISTBOARD_JIEQI_ENABLED',
  'MISTBOARD_DARK_XIANGQI_ENABLED',
  'MISTBOARD_DUCK_XIANGQI_ENABLED',
  'MISTBOARD_ATOMIC_XIANGQI_ENABLED',
  'MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED',
  'MISTBOARD_CORRESPONDENCE_ENABLED',
];

test('held by default: with the correspondence-rated flag off no eligible spec takes a rated seek', async () => {
  // The factory test above proves the plumbing for the day the flag goes on; this pins
  // that, until then, the route's one gate refuses rated for the whole eligible set.
  const { ratedSeekError } = await import('./routes/correspondence-seeks.js');
  for (const specId of CORRESPONDENCE_ELIGIBLE_SPECS) {
    assert.equal(
      ratedSeekError(specId, correspondenceTimeControl(3), false),
      'rated_disabled',
      specId,
    );
  }
});

// ---- Allowlisted playtest specs (xiangqi mahjong) ----------------------------------

test('an allowlisted spec is off the public eligible list, backed by a factory and a sweeper, and never rated', async () => {
  assert.ok(CORRESPONDENCE_ALLOWLISTED_SPECS.size > 0);
  for (const specId of CORRESPONDENCE_ALLOWLISTED_SPECS) {
    // Disjoint: the eligible list is public (copy, pickers, rated eligibility).
    assert.ok(!CORRESPONDENCE_ELIGIBLE_SPECS.has(specId), `${specId} is on the public list`);
    assert.ok(isAllowlistedGameSpec(specId), `${specId} is not behind the per-account grant`);
    assert.equal(isCorrespondenceRatedSpec(specId), false, `${specId} would rate`);
    const { ratedSeekError } = await import('./routes/correspondence-seeks.js');
    assert.equal(
      ratedSeekError(specId, correspondenceTimeControl(3), true),
      'rated_unsupported_spec',
      `${specId}: a rated seek is refused even with the rated flag on`,
    );
    const tenant = correspondenceTenantForSpecId(specId);
    assert.equal(typeof tenant?.createCorrespondenceGameForSeek, 'function', specId);
    assert.equal(typeof tenant?.sweepDueDeadline, 'function', specId);
  }
});

test('a seek on an allowlisted spec is listed only to a reader holding the grant', async () => {
  const { seeksVisibleTo } = await import('./routes/correspondence-seeks.js');
  const seeks = [{ gameSpecId: XIANGQI_SPEC_ID }, { gameSpecId: XIANGQI_MAHJONG_SPEC_ID }];
  const reader = { id: 'u1' } as NonNullable<Parameters<typeof seeksVisibleTo>[1]>;
  const granted = async () => [XIANGQI_MAHJONG_SPEC_ID];
  const ungranted = async () => [];
  assert.deepEqual(await seeksVisibleTo(seeks, reader, granted), seeks);
  assert.deepEqual(await seeksVisibleTo(seeks, reader, ungranted), [seeks[0]]);
  assert.deepEqual(await seeksVisibleTo(seeks, null, granted), [seeks[0]], 'anonymous sees none');
  // A list with no allowlisted seek costs no lookup.
  let looked = false;
  await seeksVisibleTo([seeks[0]!], reader, async () => {
    looked = true;
    return [];
  });
  assert.equal(looked, false);
});
