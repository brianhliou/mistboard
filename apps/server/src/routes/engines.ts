import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from '../account-session.js';
import { playableLiveEngines } from './../engine-registry.js';
import { threeKingdomsBanqiAdmits } from '../three-kingdoms-banqi-access.js';
import {
  isThreeKingdomsBanqiEngineClientId,
  THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES,
  threeKingdomsBanqiEngineAvailable,
} from '../three-kingdoms-banqi-engine.js';
import { requireMethod, writeJson } from './lib.js';

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname !== '/api/engines/playable') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  const admitsTk = threeKingdomsBanqiAdmits(await currentAccountUser(request));
  // The ordinary roster is public. Keep TK in its own gated field, including
  // when a local operator adds a TK id to EXTRA_PLAYABLE_ENGINES.
  const engines = playableLiveEngines()
    .filter((engine) => !isThreeKingdomsBanqiEngineClientId(engine.id))
    .map((engine) => ({
      id: engine.id,
      name: engine.name,
      familyName: engine.engineName,
      kind: engine.kind,
    }));
  const threeKingdomsBanqiEngines = admitsTk
    ? THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES.filter((tier) =>
        threeKingdomsBanqiEngineAvailable(tier.id),
      )
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
        .map((tier) => ({
          id: tier.id,
          name: `Misty level ${tier.level}`,
          familyName: 'Misty',
          kind: tier.evaluation === 'random' ? 'builtin' : 'container',
        }))
    : undefined;
  writeJson(
    response,
    200,
    { engines, ...(threeKingdomsBanqiEngines ? { threeKingdomsBanqiEngines } : {}) },
    { 'cache-control': 'private, no-store' },
  );
  return true;
}
