// Jieqi jqe (the top jieqi bot once MISTBOARD_JQE_ENABLED is on) PvE smoke: config
// entry over the shared variant runner. See scripts/lib/variant-smoke.mjs.
import { runVariantSmoke } from './lib/variant-smoke.mjs';
import { VARIANT_SMOKE_CONFIGS } from './lib/variant-smoke-configs.mjs';

await runVariantSmoke(VARIANT_SMOKE_CONFIGS['jieqi-jqe']);
