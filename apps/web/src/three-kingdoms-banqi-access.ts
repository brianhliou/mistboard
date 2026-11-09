// Three Kingdoms Banqi play admission hint. The build flag admits everyone;
// admins can enter with it off. The server independently checks admission.
// Search and public content follow the shared publicSurface launch switch.
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import { isLikelyAdmin } from './signed-in-state.js';
import type { WebTenantEngineOption } from './variant-tenant/registry.js';

// A build flag cannot know which assets the running server has. Start closed
// and replace this roster from /api/engines/playable; never persist it.
let runtimeEngines: readonly WebTenantEngineOption[] = [];

export function setThreeKingdomsBanqiEngineOptions(
  engines: readonly WebTenantEngineOption[],
): void {
  runtimeEngines = engines;
}

export function threeKingdomsBanqiEngineOptions(): readonly WebTenantEngineOption[] | undefined {
  return threeKingdomsBanqiEngineOffered() ? runtimeEngines : undefined;
}

export function threeKingdomsBanqiOffered(): boolean {
  return threeKingdomsBanqiEnabled() || isLikelyAdmin();
}

// The bot rides the same door; the server's playable roster, not a build flag,
// says whether a tier is there.
export function threeKingdomsBanqiEngineOffered(): boolean {
  return threeKingdomsBanqiOffered() && runtimeEngines.length > 0;
}
