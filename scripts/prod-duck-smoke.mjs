// Duck Xiangqi PvE smoke: config entry over the shared variant runner.
// See scripts/lib/variant-smoke.mjs for the flow and output contract.
import { runVariantSmoke } from './lib/variant-smoke.mjs';
import { VARIANT_SMOKE_CONFIGS } from './lib/variant-smoke-configs.mjs';

await runVariantSmoke(VARIANT_SMOKE_CONFIGS.duck);
