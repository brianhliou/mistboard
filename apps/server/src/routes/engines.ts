import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from '../account-session.js';
import { BANQI_PLAYABLE_ENGINES, banqiEngineAvailable } from '../banqi-engine.js';
import { playableLiveEngines } from './../engine-registry.js';
import {
  isJungleFlipEngineClientId,
  JUNGLE_FLIP_PLAYABLE_ENGINES,
  jungleFlipEngineAvailable,
} from '../jungle-flip-engine.js';
import { threeKingdomsBanqiAdmits } from '../three-kingdoms-banqi-access.js';
import {
  isThreeKingdomsBanqiEngineClientId,
  THREE_KINGDOMS_BANQI_PLAYABLE_ENGINES,
  threeKingdomsBanqiEngineAvailable,
  threeKingdomsBanqiEngineDisplayName,
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
    .filter(
      (engine) => !isJungleFlipEngineClientId(engine.id) || jungleFlipEngineAvailable(engine.id),
    )
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
          name: threeKingdomsBanqiEngineDisplayName(tier.id),
          familyName: 'Misty',
          kind: tier.evaluation === 'random' ? 'builtin' : 'container',
        }))
    : undefined;
  const jungleFlipEngines = [...JUNGLE_FLIP_PLAYABLE_ENGINES]
    .filter((tier) => jungleFlipEngineAvailable(tier.id))
    .reverse()
    .map((tier) => ({
      id: tier.id,
      name: `Misty Level ${tier.level}`,
      familyName: 'Misty',
      kind: 'container',
    }));
  const banqiEngines = [...BANQI_PLAYABLE_ENGINES]
    .filter((tier) => banqiEngineAvailable(tier.id))
    .reverse()
    .map((tier) => ({
      id: tier.id,
      name: `Misty Level ${tier.level}`,
      familyName: 'Misty',
      kind: 'container',
    }));
  writeJson(
    response,
    200,
    {
      engines,
      banqiEngines,
      jungleFlipEngines,
      ...(threeKingdomsBanqiEngines ? { threeKingdomsBanqiEngines } : {}),
    },
    { 'cache-control': 'private, no-store' },
  );
  return true;
}
