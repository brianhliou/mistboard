import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  DAYS_PER_MOVE_OPTIONS,
  MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  type LandingRoomSetup,
  roomCreationGameSpecId,
  roomCreationRequestBody,
} from './landing-play.js';
import { panelPersonPaces } from './landing-play-panel.js';
import { webVariantTenants } from './variant-tenant/registry.js';

// Variant-wiring conformance. Adding a variant touches ~12 scattered sites; the
// create-request builders are the ones that fail SILENTLY when missed —
// roomCreationGameSpecId defaults any spec it does not list to dark chess, so a
// variant added to the picker but not the builders creates a dark-chess game
// (the invite-friend regression). This guards every present + future variant
// that the picker can offer.
//
// Every tenant currently offered in normal play-menu entry points must
// round-trip through both builders to itself.

const pickerTenants = webVariantTenants().filter((tenant) => tenant.landing?.offerInMenu());

function setupFor(gameSpecId: LandingRoomSetup['gameSpecId']): LandingRoomSetup {
  return {
    gameSpecId,
    rated: false,
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    preferredColor: 'random',
  };
}

describe('variant create-request conformance', () => {
  it('has at least one selectable picker variant to check', () => {
    expect(pickerTenants.length).toBeGreaterThan(0);
  });

  it('every picker variant resolves to its OWN gameSpecId (no dark-chess fallthrough)', () => {
    for (const tenant of pickerTenants) {
      const resolved = roomCreationGameSpecId(setupFor(tenant.gameSpecId as never));
      expect(
        resolved,
        `${tenant.gameSpecId}: roomCreationGameSpecId fell through to a different spec`,
      ).toBe(tenant.gameSpecId);
    }
  });

  it('every picker variant POSTs a body carrying its own gameSpecId', () => {
    for (const tenant of pickerTenants) {
      const body = roomCreationRequestBody('pvp', setupFor(tenant.gameSpecId as never));
      expect(
        body.gameSpecId,
        `${tenant.gameSpecId}: roomCreationRequestBody dropped/changed the spec`,
      ).toBe(tenant.gameSpecId);
    }
  });
});

// Correspondence on every variant (2026-10-02). The picker offers a variant's
// days-per-move paces only when it is on the shared eligible list, so a variant
// added to the menu without joining that list silently gets real time only.
// Mahjong (four seats) is the deliberate exception.
describe('variant correspondence conformance', () => {
  it('every picker variant offers every days-per-move pace, casual', () => {
    for (const tenant of pickerTenants) {
      if (tenant.gameSpecId === MAHJONG_SPEC_ID) continue;
      expect(CORRESPONDENCE_ELIGIBLE_SPEC_IDS, tenant.gameSpecId).toContain(tenant.gameSpecId);
      const days = panelPersonPaces(tenant.gameSpecId as never, 'casual').filter(
        (pace) => pace.kind === 'days',
      );
      expect(days.length, `${tenant.gameSpecId}: days-per-move paces`).toBe(
        DAYS_PER_MOVE_OPTIONS.length,
      );
    }
  });

  it('every eligible variant has a web tenant or is Fog Chess on the chess shell', () => {
    const webSpecs = new Set(webVariantTenants().map((tenant) => tenant.gameSpecId));
    for (const specId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      expect(webSpecs.has(specId), `${specId}: no web tenant draws its room`).toBe(true);
    }
  });
});
