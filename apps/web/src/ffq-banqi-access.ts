// The build flag remains a kill switch after public launch. Until then only
// admins see the playtest. The server independently enforces admission.
import { FFQ_BANQI_SPEC_ID, isPublicGameSpec } from '@mistboard/game';
import { ffqBanqiEnabled } from './feature-flags.js';
import { notifyRuntimeEngineRostersChanged, sameRuntimeRoster } from './runtime-engine-rosters.js';
import { isLikelyAdmin } from './signed-in-state.js';
import type { WebTenantEngineOption } from './variant-tenant/registry.js';

let runtimeEngines: readonly WebTenantEngineOption[] = [];
let rosterLoad: Promise<void> | null = null;
export const ffqBanqiOffered = (): boolean =>
  ffqBanqiEnabled() && (isPublicGameSpec(FFQ_BANQI_SPEC_ID) || isLikelyAdmin());
export function setFFQBanqiEngineOptions(engines: readonly WebTenantEngineOption[]): void {
  const changed = !sameRuntimeRoster(runtimeEngines, engines);
  runtimeEngines = engines;
  rosterLoad = null;
  if (changed) notifyRuntimeEngineRostersChanged();
}
export function ffqBanqiEngineOptions(): readonly WebTenantEngineOption[] | undefined {
  return ffqBanqiOffered() && runtimeEngines.length > 0 ? runtimeEngines : undefined;
}

/** One fetch of the server's Fanfanqi roster for pages the landing never loaded
 *  (a rules page opened from search). Resolves without throwing; on failure the
 *  roster stays empty and no bot is offered. */
export function loadFFQBanqiEngineOptions(): Promise<void> {
  rosterLoad ??= fetch('/api/engines/playable')
    .then(async (resp) => {
      if (!resp.ok) return;
      const data = (await resp.json()) as { ffqBanqiEngines?: WebTenantEngineOption[] };
      if (runtimeEngines.length > 0) return;
      runtimeEngines = data.ffqBanqiEngines ?? [];
      if (runtimeEngines.length > 0) notifyRuntimeEngineRostersChanged();
    })
    .catch(() => {});
  return rosterLoad;
}
