// The build flag remains a kill switch after public launch. Until then only
// admins see the playtest. The server independently enforces admission.
import { FFQ_BANQI_SPEC_ID, isPublicGameSpec } from '@mistboard/game';
import { ffqBanqiEnabled } from './feature-flags.js';
import { notifyRuntimeEngineRostersChanged, sameRuntimeRoster } from './runtime-engine-rosters.js';
import { isLikelyAdmin } from './signed-in-state.js';
import type { WebTenantEngineOption } from './variant-tenant/registry.js';

let runtimeEngines: readonly WebTenantEngineOption[] = [];
export const ffqBanqiOffered = (): boolean =>
  ffqBanqiEnabled() && (isPublicGameSpec(FFQ_BANQI_SPEC_ID) || isLikelyAdmin());
export function setFFQBanqiEngineOptions(engines: readonly WebTenantEngineOption[]): void {
  const changed = !sameRuntimeRoster(runtimeEngines, engines);
  runtimeEngines = engines;
  if (changed) notifyRuntimeEngineRostersChanged();
}
export function ffqBanqiEngineOptions(): readonly WebTenantEngineOption[] | undefined {
  return ffqBanqiOffered() && runtimeEngines.length > 0 ? runtimeEngines : undefined;
}
