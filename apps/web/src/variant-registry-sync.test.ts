import { describe, expect, it } from 'vitest';
// The server cannot import the web bundle, so two of its dispatch surfaces
// hand-maintain per-variant entries that must mirror the web tenant registry:
// the SPA fallback allowlist (server-policy.ts isClientRoute) and the tenant
// registry populated by register-tenants.ts. These tests import the server
// source directly (same pattern as articles-meta-sync.test.ts) so a new
// variant that misses either surface fails here instead of shipping 404s on
// postgame refreshes or create requests that silently fall through to the
// chess stack. When this test landed it caught five tenants whose game routes
// were missing from isClientRoute (fortress-xiangqi and four since-deleted
// tenants).
import { isClientRoute } from '../../server/src/server-policy.js';
// Side-effect import: populates the server tenant registry exactly like
// apps/server/src/index.ts (and registry.test.ts) do.
import '../../server/src/variant-tenant/register-tenants.js';
import {
  ENGINE_PINNED_GAME_SPEC_IDS,
  engineTimeControlPin,
  VARIANT_DEFAULT_GAME_SPEC_IDS,
  variantDefaultTimeControl,
} from '@mistboard/game';
import { JIEQI_DEFAULT_ENGINE_ID } from '../../server/src/jieqi-engine.js';
import { registeredVariantTenants } from '../../server/src/variant-tenant/registry.js';
import {
  XIANGQI_DEFAULT_ENGINE_ID,
  XIANGQI_PUBLIC_ENGINES,
} from '../../server/src/xiangqi-engine-catalog.js';
import { landingBotOffer } from './landing-bot-policy.js';
import { defaultTimePresetForSpec, webVariantTenants } from './variant-tenant/registry.js';

const SAMPLE_ROOM_SUFFIX = 'abc123';

describe('web tenant routes <-> server SPA fallback allowlist', () => {
  it('every tenant postgame route serves the SPA shell on direct hits', () => {
    for (const tenant of webVariantTenants()) {
      // Tenants without a postgame surface (dark-chess correspondence) review
      // finished games at the legacy /game/:id, asserted below.
      if (!tenant.gameRouteBase) continue;
      const url = `${tenant.gameRouteBase}/${tenant.roomIdPrefix}${SAMPLE_ROOM_SUFFIX}`;
      expect(
        isClientRoute(url),
        `${tenant.gameSpecId}: ${url} is missing from isClientRoute() (apps/server/src/server-policy.ts), so direct hits and refreshes 404 in production`,
      ).toBe(true);
    }
  });

  it('every tenant review route serves the SPA shell on direct hits', () => {
    for (const tenant of webVariantTenants()) {
      // Tenants without their own reviewRouteBase keep the legacy /game/:id
      // link that shared surfaces (game-meta) always produced.
      const base = tenant.reviewRouteBase ?? '/game';
      const url = `${base}/${tenant.roomIdPrefix}${SAMPLE_ROOM_SUFFIX}`;
      expect(
        isClientRoute(url),
        `${tenant.gameSpecId}: review link ${url} is missing from isClientRoute() (apps/server/src/server-policy.ts)`,
      ).toBe(true);
    }
  });
});

describe('web tenant registry <-> server tenant registry parity', () => {
  const webTenants = webVariantTenants();
  const serverTenants = registeredVariantTenants();

  it('web and server registries cover the same game spec ids', () => {
    // Chess itself is deliberately in NEITHER registry (a registry miss IS the
    // chess fallback; see the header comments of both registry files), and the
    // dark-chess correspondence tenant (dchx_) is registered on BOTH sides, so
    // the spec-id sets must match exactly with no exception list.
    const webSpecs = new Set<string>(webTenants.map((tenant) => tenant.gameSpecId));
    const serverSpecs = new Set(serverTenants.map((registration) => registration.gameSpecId));
    const missingOnServer = [...webSpecs].filter((id) => !serverSpecs.has(id)).sort();
    const missingOnWeb = [...serverSpecs].filter((id) => !webSpecs.has(id)).sort();
    expect(
      { missingOnServer, missingOnWeb },
      `tenant registries drifted: [${missingOnServer.join(', ')}] need a side-effect import in apps/server/src/variant-tenant/register-tenants.ts; [${missingOnWeb.join(', ')}] need a WEB_VARIANT_TENANTS entry in apps/web/src/variant-tenant/registry.ts`,
    ).toEqual({ missingOnServer: [], missingOnWeb: [] });
  });

  it('web and server tenants agree on roomIdPrefix per spec', () => {
    for (const tenant of webTenants) {
      const serverPrefixes = serverTenants
        .filter((registration) => registration.gameSpecId === tenant.gameSpecId)
        .map((registration) => registration.roomIdPrefix);
      expect(
        serverPrefixes,
        `${tenant.gameSpecId}: web roomIdPrefix '${tenant.roomIdPrefix}' has no matching server registration prefix`,
      ).toContain(tenant.roomIdPrefix);
    }
  });

  it('xiangqi picker engine options mirror the server engine catalog', () => {
    // The web engineOptions list is a hand-maintained mirror of the server's
    // XIANGQI_PUBLIC_ENGINES (apps/server/src/xiangqi-engine-catalog.ts): the
    // ids ride the create payload straight into the server's engine-id gate, so
    // drift means a picker entry that cannot seat an engine. The picker orders
    // strongest-first; the server table orders weakest-first.
    const tenant = webTenants.find((candidate) => candidate.gameSpecId === 'xiangqi');
    expect(tenant?.landing?.engineOptions, 'xiangqi tenant must expose engineOptions').toBeTruthy();
    const options = tenant?.landing?.engineOptions ?? [];
    expect(options.map((option) => ({ id: option.id, name: option.name }))).toEqual(
      [...XIANGQI_PUBLIC_ENGINES].reverse().map((tier) => ({ id: tier.id, name: tier.name })),
    );
    expect(tenant?.landing?.defaultEngineId).toBe(XIANGQI_DEFAULT_ENGINE_ID);
  });

  it('the jieqi picker offers the tier the server actually serves', () => {
    // Jieqi exposes ONE engine option, so the picker id IS the served tier. It
    // pointed at the depth-capped middle rung while the uncapped tier sat
    // unreachable (2026-08-23) — every jieqi PvE game was played at depth 10.
    const tenant = webTenants.find((candidate) => candidate.gameSpecId === 'jieqi');
    expect(tenant?.landing?.engineOptions, 'jieqi tenant must expose engineOptions').toBeTruthy();
    expect((tenant?.landing?.engineOptions ?? []).map((option) => option.id)).toEqual([
      JIEQI_DEFAULT_ENGINE_ID,
    ]);
    expect(tenant?.landing?.defaultEngineId).toBe(JIEQI_DEFAULT_ENGINE_ID);
  });

  it('web tenant roomIdPrefixes are unique', () => {
    // Server-side uniqueness is enforced at registration time
    // (registerVariantTenant throws on a cross-kind prefix collision; covered
    // by apps/server/src/variant-tenant/registry.test.ts). WEB_VARIANT_TENANTS
    // is a plain array with no such guard, so assert it here.
    const claimedBy = new Map<string, string>();
    for (const tenant of webTenants) {
      const existing = claimedBy.get(tenant.roomIdPrefix);
      expect(
        existing,
        `roomIdPrefix '${tenant.roomIdPrefix}' claimed by both '${existing}' and '${tenant.gameSpecId}'`,
      ).toBeUndefined();
      claimedBy.set(tenant.roomIdPrefix, tenant.gameSpecId);
    }
  });

  it('every engine-pinned variant offers the pace it is pinned to', () => {
    // A pin narrows the PvE picker to a single preset and the create route to a
    // single pace (#283). If the variant's own allowlist does not contain that
    // preset, the picker narrows to nothing while the route rejects everything,
    // which strands bot play on that variant entirely.
    for (const gameSpecId of ENGINE_PINNED_GAME_SPEC_IDS) {
      const pin = engineTimeControlPin(gameSpecId);
      expect(pin, `${gameSpecId} is listed as pinned but resolves to no time control`).toBeTruthy();
      const tenantLanding = webVariantTenants().find(
        (tenant) => tenant.gameSpecId === gameSpecId,
      )?.landing;
      // Variants with no tenant landing config (fog chess) fall back
      // to all three official controls in the picker, so any pin is offered.
      if (!tenantLanding) continue;
      expect(
        tenantLanding.timePresetIds,
        `${gameSpecId} is pinned to ${pin?.id} but its landing config does not offer it`,
      ).toContain(pin?.id);
    }
  });

  it('every variant default pace is one that variant actually offers', () => {
    // A default only preselects a chip; it does not widen timePresetIds. Naming
    // a pace the picker does not render would preselect an invisible control,
    // and the player would have no way to see or change the pace their game is
    // about to start at. The table now lives in @mistboard/game (the server
    // reads it too), so this is the check that it still agrees with the web
    // tenants' own offers.
    for (const gameSpecId of VARIANT_DEFAULT_GAME_SPEC_IDS) {
      const landing = webVariantTenants().find(
        (tenant) => tenant.gameSpecId === gameSpecId,
      )?.landing;
      // Specs with no tenant landing config fall back to the picker's own set,
      // which holds every official pace, so any default is offered.
      if (!landing) continue;
      expect(
        landing.timePresetIds,
        `${gameSpecId} defaults to ${variantDefaultTimeControl(gameSpecId).id} but does not offer it`,
      ).toContain(variantDefaultTimeControl(gameSpecId).id);
    }
  });

  it('a bot offer advertises the pace its own picker will preselect', () => {
    // The Lobby row and Quick Pairing chip print a clock beside the bot's name;
    // landing-play then opens the setup dialog on the variant's default. Those
    // are computed in two places (landing-bot-policy offerPace, registry
    // defaultTimePresetForSpec), so nothing but this test stops them drifting
    // into advertising one pace and starting another.
    for (const tenant of webVariantTenants()) {
      const offer = landingBotOffer(tenant.gameSpecId);
      if (!offer) continue;
      const pin = engineTimeControlPin(tenant.gameSpecId)?.id;
      expect(
        offer.timeControlId,
        `${tenant.gameSpecId} advertises ${offer.timeControlId} for ${offer.botName}`,
      ).toBe(pin ?? defaultTimePresetForSpec(tenant.gameSpecId));
    }
  });
});

// A variant's play deep link must be gated on its OWN feature flag. Two were
// not: fog xiangqi's `acceptsDeepLink` pointed at darkMiniXiangqiEnabled and
// jieqi's at the drop-mini flag, both flags for unrelated mini-xiangqi
// variants that are off in production. Neither variant's own flag was even
// imported here, so the entries fell back to whatever was already in scope and
// typechecked cleanly. The effect was invisible: /?play=computer&gameSpecId=…
// silently dropped the visitor on the homepage, so every shared play link for
// two live variants went nowhere and nothing failed.
describe('play deep links are gated on their own variant', () => {
  it('enables a deep link exactly when the variant itself is enabled', () => {
    const mismatched: string[] = [];
    for (const tenant of webVariantTenants()) {
      const landing = tenant.landing;
      if (!landing) continue;
      const deepLink = landing.acceptsDeepLink();
      const offered = landing.offerInMenu();
      // A variant offered in the play menu must also accept its deep link:
      // the menu and the link are the same affordance reached two ways.
      if (offered && !deepLink) {
        mismatched.push(`${tenant.gameSpecId}: offered in menu but refuses deep links`);
      }
    }
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });
});
