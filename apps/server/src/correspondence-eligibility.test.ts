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
  GAME_SPECS,
  isOfficialTimeControl,
  MAHJONG_SPEC_ID,
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

test('correspondence can never be rated — the guardrail the reversal rests on', () => {
  // The reversal trades anti-cheat enforcement for casual-only containment, so this is the
  // load-bearing assertion of the whole feature, not a detail: a correspondence allowance
  // is never an official (ratable) time control, so it cannot reach a rating bucket.
  for (const daysPerMove of [1, 3, 7]) {
    assert.equal(
      isOfficialTimeControl({ initialMs: daysPerMove * 86_400_000, incrementMs: 0, daysPerMove }),
      false,
      `${daysPerMove}-day correspondence must never be a ratable time control`,
    );
  }
});
