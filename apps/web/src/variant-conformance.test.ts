import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  DAYS_PER_MOVE_OPTIONS,
  GAME_SPECS,
  type GameSpecId,
  isPublicGameSpec,
  isRetiredGameSpec,
  MAHJONG_SPEC_ID,
  RETIRED_GAME_SPEC_IDS,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_VARIANTS } from './analysis-catalog.js';
import { articles } from './articles-data.js';
import { EDITOR_VARIANT_IDS } from './editor/editor-catalog.js';
import { LANDING_BOT_GAME_SPEC_IDS } from './landing-bot-policy.js';
import {
  type LandingRoomSetup,
  roomCreationGameSpecId,
  roomCreationRequestBody,
} from './landing-play.js';
import { panelPersonPaces } from './landing-play-panel.js';
import { buildReviewMeta } from './review/game-review-meta.js';
import { embedRendererKindForVariant } from './showcase-dispatch.js';
import { STUDY_VARIANTS } from './study-catalog.js';
import { gameSpecIdFromRulesSlug, rulesSlugForGameSpec } from './variant-public-surfaces.js';
import {
  finishedGameHref,
  legacyGameRouteForRoomId,
  webVariantTenants,
} from './variant-tenant/registry.js';
import { roomMarkerId } from './variant-tenant/room-chrome.js';
import {
  leaderboardVariants,
  profileRatingVariants,
  VARIANTS,
  variantMiniIdForGameSpec,
} from './variants.js';
import { WATCH_CHANNEL_MINI_IDS } from './watch-channel-markers.js';

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

// Retired variants (Fortress and Atomic Xiangqi, 2026-10-11) leave the picker
// and the correspondence list, but a stale request for one must still carry its
// own id, so the server answers 410 retired_game_spec instead of the builder
// quietly turning it into a dark-chess game.
describe('retired variant conformance', () => {
  it('no picker variant and no correspondence variant is retired', () => {
    for (const tenant of pickerTenants) {
      expect(isRetiredGameSpec(tenant.gameSpecId), tenant.gameSpecId).toBe(false);
    }
    for (const id of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
      expect(isRetiredGameSpec(id), id).toBe(false);
    }
  });

  it('a retired spec still resolves to itself, never to dark chess', () => {
    for (const id of RETIRED_GAME_SPEC_IDS) {
      expect(roomCreationGameSpecId(setupFor(id as never)), id).toBe(id);
      expect(roomCreationRequestBody('pvp', setupFor(id as never)).gameSpecId, id).toBe(id);
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
      if (tenant.gameSpecId === XIANGQI_MAHJONG_SPEC_ID) continue;
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
  // HK mahjong is behind a flag and never shown as a variant: no marker, no icon.
  // Nor is Three Kingdoms banqi, a hidden playtest (#628, #684) only an admin
  // reaches on prod.
  const markedTenants = webVariantTenants().filter(
    (tenant) =>
      tenant.gameSpecId !== MAHJONG_SPEC_ID && tenant.gameSpecId !== THREE_KINGDOMS_BANQI_SPEC_ID,
  );

  it('marks Xiangqi Mahjong with its own tile marker', () => {
    expect(markedTenants.map((tenant) => tenant.gameSpecId)).toContain(XIANGQI_MAHJONG_SPEC_ID);
    expect(variantMiniIdForGameSpec(XIANGQI_MAHJONG_SPEC_ID)).toBe('xiangqi-mahjong');
  });

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

// Finished-game links (2026-10-15, Xiangqi Mahjong launch prep). Profile rows,
// the bell, the database and featured cards all link a finished game. The
// legacy /game/:id page reads only the chess-shell event log, so a tenant with
// its own room client linked there is a dead page: Xiangqi Mahjong has no
// postgame route and fell through to it. A tenant links its room when it says
// its finished room is the page (the server suite pins what that shows a
// visitor; Xiangqi Mahjong's room then offers its review page), else its
// postgame route, else /game/:id. Hong Kong mahjong still has no finished-game
// page, and the server marks its rows unavailable.
describe('finished-game link conformance', () => {
  it('every tenant links a finished game to a page that mounts it', () => {
    for (const tenant of webVariantTenants()) {
      const roomId = `${tenant.roomIdPrefix}finished1`;
      const routeBase = tenant.gameRouteBase ?? tenant.reviewRouteBase;
      const expected = tenant.finishedGameOpensRoom
        ? `/room/${roomId}`
        : routeBase
          ? `${routeBase}/${roomId}`
          : `/game/${roomId}`;
      expect(finishedGameHref(roomId, tenant.gameSpecId), tenant.gameSpecId).toBe(expected);
      if (tenant.finishedGameOpensRoom) {
        expect(tenant.loadLiveRoomClient, `${tenant.gameSpecId}: no room client`).toBeDefined();
      }
    }
    expect(finishedGameHref('xmj_finished1', XIANGQI_MAHJONG_SPEC_ID)).toBe('/room/xmj_finished1');
  });
});

// The legacy /game/:id route (2026-10-16). It is the chess shell, which 403s
// on a tenant's event log ("Page failed to load"). A hand-typed /game/xmj_...
// mounted it because the redirect only knew postgame routes. Every tenant id
// now goes to its finished-game page or reads as not found; only the chess
// stack mounts the shell.
describe('legacy /game/:id route conformance', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never mounts the chess shell for a tenant game', () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'true');
    vi.stubEnv('VITE_MAHJONG_ENABLED', 'true');
    for (const tenant of webVariantTenants()) {
      const roomId = `${tenant.roomIdPrefix}finished1`;
      const route = legacyGameRouteForRoomId(roomId);
      if (tenant.gameSpecId === 'dark-chess') {
        expect(route, tenant.gameSpecId).toEqual({ kind: 'chess' });
        continue;
      }
      expect(route.kind, tenant.gameSpecId).not.toBe('chess');
      if (route.kind === 'redirect' && tenant.enabled()) {
        expect(route.href, tenant.gameSpecId).toBe(finishedGameHref(roomId, tenant.gameSpecId));
      }
    }
    expect(legacyGameRouteForRoomId('xmj_finished1')).toEqual({
      kind: 'redirect',
      href: '/room/xmj_finished1',
    });
    // Hong Kong mahjong has no finished-game page at all.
    expect(legacyGameRouteForRoomId('mj_finished1')).toEqual({ kind: 'not-found' });
    // A bare Fog Chess room id is what the route is for.
    expect(legacyGameRouteForRoomId('abc123')).toEqual({ kind: 'chess' });
  });

  it('reads a flagged-off tenant as not found rather than the chess shell', () => {
    vi.stubEnv('VITE_XIANGQI_MAHJONG_ENABLED', 'false');
    expect(legacyGameRouteForRoomId('xmj_finished1')).toEqual({ kind: 'not-found' });
  });
});

describe('rules link conformance', () => {
  // A meta card, a review page and a rules page's play button all link a variant
  // to rulesHrefForGameSpec. A variant whose rules page has a different slug
  // must say so (RULES_GAME_SPEC_BY_SLUG), or the link 404s the day it goes
  // public. `chess` is study-only: /rules/chess is the primer, not its page.
  it('every live variant links to a rules page that exists and points back', () => {
    const rulesSlugs = new Set(articles.filter((a) => a.kind === 'rules').map((a) => a.slug));
    for (const spec of GAME_SPECS) {
      if (isRetiredGameSpec(spec.id) || spec.id === 'chess') continue;
      const slug = rulesSlugForGameSpec(spec.id);
      expect(rulesSlugs.has(slug), `${spec.id}: no /rules/${slug}`).toBe(true);
      expect(gameSpecIdFromRulesSlug(slug), slug).toBe(spec.id);
    }
    expect(rulesSlugForGameSpec(XIANGQI_MAHJONG_SPEC_ID)).toBe('xiangqi-mahjong-32');
  });
});

// Launch-playbook rule 3: a surface a variant is left off is left off on
// purpose and pinned, so it fails closed. Xiangqi Mahjong has no position an
// analysis board, editor or study can hold (hands are concealed tiles, not a
// board). Its TV channel exists (spectators see only the public table; server
// xiangqi-mahjong-spectate.test.ts) but is listed only once the spec is public
// (server xiangqi-mahjong-listing.test.ts). Adding it to any of these is a
// product decision: change the pin with it. Its homepage bot (Misty) and its web rating-grid row are in, each behind
// the same gate as the variant itself; pinned below.
describe('Xiangqi Mahjong deliberate exclusions', () => {
  const XMJ = 'xiangqi-mahjong';

  it('is not an analysis, editor or study variant', () => {
    expect(ANALYSIS_VARIANTS.map((variant) => variant.id)).not.toContain(XMJ);
    expect(EDITOR_VARIANT_IDS as readonly string[]).not.toContain(XMJ);
    expect(STUDY_VARIANTS.map((variant) => variant.id)).not.toContain(XMJ);
  });

  // The review page (2026-10-16) replays a FINISHED match with every tile face
  // up; it is a replay only, so analysis, editor and study stay out above. The
  // room stays the finished game's link, and its Review button opens this page;
  // the server refuses the page's API for a live match (hidden-info test in
  // apps/server/src/routes/xiangqi-mahjong-games.test.ts).
  it('has a review page for a finished match, reached from its room', () => {
    const tenant = webVariantTenants().find((each) => each.gameSpecId === XMJ);
    expect(tenant?.gameRouteBase).toBe('/xiangqi-mahjong/game');
    expect(tenant?.mountPostgame).toBeDefined();
    expect(tenant?.finishedGameOpensRoom).toBe(true);
    expect(finishedGameHref('xmj_done', XMJ)).toBe('/room/xmj_done');
  });

  it('has a watch channel marker, and no game embed', () => {
    expect(WATCH_CHANNEL_MINI_IDS[XMJ]).toBe(XMJ);
    expect(embedRendererKindForVariant(XMJ)).toBeNull();
  });

  // The shelf lists it, but the Lobby rows, Quick Pairing chip and play panel
  // only draw a variant the play menu offers (landingSeedVariantOffered), which
  // is the allowlist until launch; the server refuses the room the same way.
  it('is on the homepage bot shelf, played by Misty', () => {
    expect(LANDING_BOT_GAME_SPEC_IDS as readonly string[]).toContain(XMJ);
  });

  // The rating-grid row follows the launch switch (XMJ's publicSurface in
  // packages/game/src/game-specs.ts), not the web flag: the flag is on for the
  // allowlisted playtest, while the server keeps the pool off every grid until
  // launch. The pin follows the switch, so launch needs no edit here
  // (launch-switch.test.ts checks every other list against the same switch).
  it('has a VARIANTS row, on the rating grids exactly when the switch is on', () => {
    const launched = isPublicGameSpec(XMJ);
    const row = VARIANTS.find((variant) => variant.gameSpecId === XMJ);
    expect(row?.miniId).toBe('xiangqi-mahjong');
    expect(leaderboardVariants.map((variant) => variant.gameSpecId).includes(XMJ)).toBe(launched);
    expect(profileRatingVariants.map((variant) => variant.gameSpecId).includes(XMJ)).toBe(launched);
  });
});
