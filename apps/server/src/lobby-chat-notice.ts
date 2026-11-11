// Site notice riding on the lobby chat read (#651, first slice of #579).
//
// Transient by construction: it is derived from the drain controller's live
// state on every GET /api/chat/lobby and never written to chat_lines. So a
// cancelled or lapsed drain takes it away on the next poll, a repeated
// activation (or a hundred polls) cannot post it twice, and a restart leaves
// nothing behind in the room. The id is stable for one drain window, which is
// what lets the client keep one row and update it in place when the phase
// moves from pending to restarting.

import type { DrainPhase } from './server-drain.js';

export type LobbyChatNotice = {
  id: string;
  kind: 'server_restart';
  phase: DrainPhase;
  restartAt: number;
};

export type LobbyChatNoticeSource = {
  drainDeadlineMs?(): number | null;
  restartPhase?(): DrainPhase | null;
};

export function lobbyDrainNotice(source: LobbyChatNoticeSource): LobbyChatNotice | null {
  const restartAt = source.drainDeadlineMs?.() ?? null;
  const phase = source.restartPhase?.() ?? null;
  if (restartAt === null || phase === null) return null;
  return { id: `drain-${restartAt}`, kind: 'server_restart', phase, restartAt };
}
