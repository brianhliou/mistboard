import type { BanqiTurnProvider } from './banqi-provider.js';
import {
  BanqiProviderError,
  type BanqiProviderResponse,
  parseBanqiProviderResponse,
} from './banqi-provider-protocol.js';
import type { BanqiEngineMoveProvider } from './server-banqi-engine.js';

/** Operator-selected injection only: this neither creates an engine identity
 * nor registers a bot. The live caller supplies a fresh, kernel-built request. */
export function banqiProviderForLive(
  provider: BanqiTurnProvider,
  engineVersion: string,
): BanqiEngineMoveProvider {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,119}$/.test(engineVersion))
    throw new BanqiProviderError('invalid-request');
  const moveProvider: BanqiEngineMoveProvider = async (_engineId, _fen, _options, request) => {
    if (!request) throw new BanqiProviderError('invalid-request');
    let result: BanqiProviderResponse;
    try {
      result = parseBanqiProviderResponse(await provider.turn(request), request);
      if (Date.now() >= request.limits.deadlineUnixMs) throw new BanqiProviderError('deadline');
    } catch (error) {
      throw error instanceof BanqiProviderError ? error : new BanqiProviderError('transport');
    }
    const score = result.analysis?.score;
    return {
      best: result.move,
      cp: score?.type === 'cp' ? score.value : null,
      mate: score?.type === 'mate' ? score.value : null,
      // A move-only provider never fabricates an evaluation. Probability/WDL
      // metadata is transported but not converted into the current cp grader.
      depth: result.analysis?.depth ?? 0,
      ...(result.analysis?.nodes !== undefined ? { nodes: result.analysis.nodes } : {}),
      ...(result.analysis?.pv ? { pv: result.analysis.pv } : {}),
    };
  };
  return Object.assign(moveProvider, { failurePolicy: 'fail-closed' as const, engineVersion });
}
