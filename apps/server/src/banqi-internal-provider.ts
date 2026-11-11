import { checkedBanqiProviderEndpoint, createBanqiHttpProvider } from './banqi-provider.js';
import { banqiProviderForLive } from './banqi-provider-live.js';
import { BanqiProviderError } from './banqi-provider-protocol.js';
import {
  INTERNAL_BANQI_ENGINE_ID,
  type InternalEngineTest,
  isInternalEngineTest,
} from './internal-engine-test.js';
import type { BanqiEngineMoveProvider } from './server-banqi-engine.js';

/** Operator environment only. The public opponent and bot registry never read it. */
export function internalBanqiConfiguration(ownerUserId: string): InternalEngineTest | null {
  if (process.env.MISTBOARD_BANQI_TEST_PROVIDER_ENABLED !== 'true') return null;
  const endpoint = process.env.MISTBOARD_BANQI_TEST_PROVIDER_URL;
  const token = process.env.MISTBOARD_BANQI_PROVIDER_TOKEN;
  if (!endpoint || !token || /[\r\n]/.test(token)) return null;
  try {
    if (
      checkedBanqiProviderEndpoint(
        endpoint,
        process.env.NODE_ENV !== 'production' &&
          process.env.MISTBOARD_BANQI_TEST_ALLOW_LOOPBACK === 'true',
      ).pathname !== '/turn'
    )
      return null;
  } catch {
    return null;
  }
  const descriptor: InternalEngineTest = {
    kind: 'banqi-provider',
    ownerUserId,
    engineId: INTERNAL_BANQI_ENGINE_ID,
    engineVersion: process.env.MISTBOARD_BANQI_TEST_PROVIDER_VERSION ?? '',
    displayName: process.env.MISTBOARD_BANQI_TEST_PROVIDER_NAME ?? 'Private Banqi worker',
    nodes: Number(process.env.MISTBOARD_BANQI_TEST_PROVIDER_NODES ?? 32000),
    budgetMs: Number(process.env.MISTBOARD_BANQI_TEST_PROVIDER_BUDGET_MS ?? 3000),
  };
  return isInternalEngineTest(descriptor) ? descriptor : null;
}

let cached:
  | { endpoint: string; token: string; provider: BanqiEngineMoveProvider; version: string }
  | undefined;
export function internalBanqiMoveProvider(stamp: InternalEngineTest): BanqiEngineMoveProvider {
  const config = internalBanqiConfiguration(stamp.ownerUserId);
  const endpoint = process.env.MISTBOARD_BANQI_TEST_PROVIDER_URL;
  const token = process.env.MISTBOARD_BANQI_PROVIDER_TOKEN;
  const unavailable = banqiProviderForLive(
    {
      turn: async () => {
        throw new BanqiProviderError('transport');
      },
    },
    stamp.engineVersion,
  );
  if (
    !config ||
    !endpoint ||
    !token ||
    Object.keys(config).some(
      (key) => config[key as keyof InternalEngineTest] !== stamp[key as keyof InternalEngineTest],
    )
  )
    return unavailable;
  if (
    cached?.endpoint === endpoint &&
    cached.token === token &&
    cached.version === stamp.engineVersion
  )
    return cached.provider;
  try {
    const provider = banqiProviderForLive(
      createBanqiHttpProvider({
        endpoint,
        token,
        allowLocalhostHttp:
          process.env.NODE_ENV !== 'production' &&
          process.env.MISTBOARD_BANQI_TEST_ALLOW_LOOPBACK === 'true',
        concurrency: 1,
        expectedVersion: stamp.engineVersion,
      }),
      stamp.engineVersion,
    );
    cached = { endpoint, token, provider, version: stamp.engineVersion };
    return provider;
  } catch {
    return unavailable;
  }
}

export function internalBanqiStampMatches(stamp: InternalEngineTest): boolean {
  const config = internalBanqiConfiguration(stamp.ownerUserId);
  return (
    config !== null &&
    Object.keys(config).every(
      (key) => config[key as keyof InternalEngineTest] === stamp[key as keyof InternalEngineTest],
    )
  );
}
