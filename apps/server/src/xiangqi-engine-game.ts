// Standard-xiangqi EvE game: a named wrapper over the shared variant loop
// (variant-eve.ts) so the runner and the existing tests keep their red/black
// vocabulary. The loop itself, including the random opening prefix and the
// random-mover floor, lives in variant-eve.ts and is shared with the fortress
// and duck ladders.

import type { XiangqiMove } from '@mistboard/game';
import {
  playVariantEngineGame,
  type VariantEveGameResult,
  type VariantEveMoveProvider,
  type VariantEveMoveRequest,
} from './variant-eve.js';
import { xiangqiEveAdapter } from './xiangqi-eve-adapter.js';
import type { XiangqiEvent } from './xiangqi-runtime.js';

export { legalMoveForUci } from './server-xiangqi-engine.js';

export type XiangqiGameMoveRequest = VariantEveMoveRequest<XiangqiMove>;

export type XiangqiGameMoveProvider = VariantEveMoveProvider<XiangqiMove>;

export type XiangqiEngineGameResult = VariantEveGameResult<
  'red' | 'black',
  XiangqiMove,
  'xiangqi'
> & {
  events: XiangqiEvent[];
};

export function playXiangqiEngineGame(input: {
  blackEngineId: string;
  maxPlies: number;
  moveProvider?: XiangqiGameMoveProvider;
  onEvent?: (event: XiangqiEvent, seq: number) => Promise<void>;
  openingPolicy?: Record<string, unknown>;
  redEngineId: string;
  roomId: string;
  startedAt?: number;
}): Promise<XiangqiEngineGameResult> {
  return playVariantEngineGame(xiangqiEveAdapter, {
    firstEngineId: input.redEngineId,
    secondEngineId: input.blackEngineId,
    maxPlies: input.maxPlies,
    moveProvider: input.moveProvider,
    onEvent: input.onEvent,
    openingPolicy: input.openingPolicy,
    roomId: input.roomId,
    startedAt: input.startedAt,
  });
}
