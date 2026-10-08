import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  DAYS_PER_MOVE_OPTIONS,
  type GameSpecId,
  MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  type LandingRoomSetup,
  roomCreationGameSpecId,
  roomCreationRequestBody,
} from './landing-play.js';
import { panelPersonPaces } from './landing-play-panel.js';
import { buildReviewMeta } from './review/game-review-meta.js';
import { webVariantTenants } from './variant-tenant/registry.js';
import { roomMarkerId } from './variant-tenant/room-chrome.js';
import { variantMiniIdForGameSpec } from './variants.js';

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

// Variant identity markers (2026-10-08). The duck room's meta card showed a 🦆
// emoji, and the Atomic and Crazyhouse rooms the plain xiangqi marker, because
// each tenant and postgame page hand-picked its icon (a free-text glyph or a
// marker id) while every other surface derived it from the spec. Both cards now
// take only the spec and look the marker up in variants.ts; these pin that.
describe('variant marker conformance', () => {
  // Mahjong is behind a flag and never shown as a variant: no marker, no icon.
  const markedTenants = webVariantTenants().filter(
    (tenant) => tenant.gameSpecId !== MAHJONG_SPEC_ID,
  );

  it('every tenant room resolves its OWN spec marker', () => {
    expect(markedTenants.length).toBeGreaterThan(0);
    for (const tenant of markedTenants) {
      const expected = variantMiniIdForGameSpec(tenant.gameSpecId);
      expect(expected, `${tenant.gameSpecId}: no variant marker`).not.toBeNull();
      expect(roomMarkerId(tenant.gameSpecId), tenant.gameSpecId).toBe(expected);
    }
  });

  it('every tenant review card draws its spec marker and no text glyph', () => {
    for (const tenant of markedTenants) {
      const { metaCard } = buildReviewMeta({
        gameSpecId: tenant.gameSpecId as GameSpecId,
        variantName: tenant.gameSpecId,
        status: '',
        game: { roomId: 'test_room' },
      });
      const icon = metaCard.querySelector('.game-meta-card__icon');
      const marker = icon?.querySelector('[data-variant-marker-id]');
      expect(marker?.getAttribute('data-variant-marker-id'), tenant.gameSpecId).toBe(
        variantMiniIdForGameSpec(tenant.gameSpecId),
      );
      expect(icon?.textContent, `${tenant.gameSpecId}: glyph text in the icon box`).toBe('');
    }
  });

  it('no meta-card caller hands in a free-text glyph or a hand-picked marker', () => {
    // The types already refuse `glyph`/`metaGlyph`/`metaMarkerId`; this catches a
    // cast or a spread that brings one back, and any emoji on those keys.
    const srcDir = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const source = readFileSync(path, 'utf8');
        if (/\bmeta(Glyph|MarkerId)\??\s*:/.test(source))
          offenders.push(`${path}: metaGlyph/metaMarkerId`);
        for (const match of source.matchAll(
          /\b(?:buildReviewMeta|createGameMetaCard)\(\{([\s\S]*?)\n\s*\}\)/g,
        )) {
          const body = match[1] ?? '';
          if (/^\s*glyph\s*:/m.test(body)) offenders.push(`${path}: glyph on a meta card`);
          if (/\p{Extended_Pictographic}/u.test(body))
            offenders.push(`${path}: emoji in a meta card`);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
