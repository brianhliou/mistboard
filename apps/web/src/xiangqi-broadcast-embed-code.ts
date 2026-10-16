// The iframe code a creator pastes to put one broadcast game on their own page
// (#454). The snippet itself is embed-code.ts's, shared with the game embeds.

import { embedBroadcastBoardPath } from '@mistboard/game';
import { embedIframeCode } from './embed-code.js';

export function broadcastEmbedCode(boardId: string, title: string, origin: string): string {
  return embedIframeCode(embedBroadcastBoardPath(encodeURIComponent(boardId)), title, origin);
}
