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
  correspondenceTimeControl,
  GAME_SPECS,
  isCorrespondenceRatedSpec,
  isOfficialTimeControl,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { CORRESPONDENCE_ELIGIBLE_SPECS } from './routes/correspondence-rooms.js';
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
  const prior = process.env.MISTBOARD_XIANGQI_ENABLED;
  process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
  try {
    const ratedSpecs = [...CORRESPONDENCE_ELIGIBLE_SPECS].filter(isCorrespondenceRatedSpec);
    assert.ok(ratedSpecs.length > 0);
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
    if (prior === undefined) delete process.env.MISTBOARD_XIANGQI_ENABLED;
    else process.env.MISTBOARD_XIANGQI_ENABLED = prior;
  }
});
