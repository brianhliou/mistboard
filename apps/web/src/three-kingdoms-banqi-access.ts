// Three Kingdoms Banqi play admission hint. The build flag admits everyone;
// admins can enter with it off. The server independently checks admission.
// Search and public content follow the shared publicSurface launch switch.
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import { isLikelyAdmin } from './signed-in-state.js';
import type { WebTenantEngineOption } from './variant-tenant/registry.js';

// A build flag cannot know which assets the running server has. Start closed
// and replace this roster from /api/engines/playable; never persist it.
let runtimeEngines: readonly WebTenantEngineOption[] = [];
let rosterLoad: Promise<void> | null = null;

export function setThreeKingdomsBanqiEngineOptions(
  engines: readonly WebTenantEngineOption[],
): void {
  runtimeEngines = engines;
  rosterLoad = null;
}

export function threeKingdomsBanqiEngineOptions(): readonly WebTenantEngineOption[] | undefined {
  return threeKingdomsBanqiEngineOffered() ? runtimeEngines : undefined;
}

/** One fetch of the server's TK roster for pages the landing never loaded
 *  (a rules page opened from search). Resolves without throwing; on failure
 *  the roster stays empty and no bot is offered. */
export function loadThreeKingdomsBanqiEngineOptions(): Promise<void> {
  rosterLoad ??= fetch('/api/engines/playable')
    .then(async (resp) => {
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        threeKingdomsBanqiEngines?: WebTenantEngineOption[];
      };
      if (runtimeEngines.length === 0) runtimeEngines = data.threeKingdomsBanqiEngines ?? [];
    })
    .catch(() => {});
  return rosterLoad;
}

export function threeKingdomsBanqiOffered(): boolean {
  return threeKingdomsBanqiEnabled() || isLikelyAdmin();
}

// The bot rides the same door; the server's playable roster, not a build flag,
// says whether a tier is there.
export function threeKingdomsBanqiEngineOffered(): boolean {
  return threeKingdomsBanqiOffered() && runtimeEngines.length > 0;
}
