import { runVariantSmoke } from './lib/variant-smoke.mjs';
import { VARIANT_SMOKE_CONFIGS } from './lib/variant-smoke-configs.mjs';

await runVariantSmoke(VARIANT_SMOKE_CONFIGS.gomoku);
