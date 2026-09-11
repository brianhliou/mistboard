export type ClientMessage = {
  type: string;
  startId?: number;
  color?: string;
  drop?: string;
  from?: string;
  to?: string;
  promotion?: string;
  // Tile-game moves have no squares. `action` names what is being done
  // ('discard', 'pung', 'chow', 'kong', 'win', 'pass') and `tiles` carries the
  // tiles it is done with, in the package's standard notation ('5p', '1z').
  // Added for mahjong; from/to/drop describe a board and there is not one.
  //
  // Nothing here is validated on parse - parseClientMessage casts, as it always
  // has. A tenant's moveFromMessage is the validator and must return null for
  // anything it does not recognise.
  action?: string;
  tiles?: string[];
  setup?: unknown;
  token?: string;
  at?: number;
  rttMs?: number;
};

// Known client->server message types. Anything outside this set increments
// ws_unknown_messages in index.ts and emits a `kind: 'ws_unknown_message'` log.
// The snapshot->delta migration introduced `snapshot:request`; future
// wire-format additions should land here too.
const knownClientMessageTypes = new Set([
  'ping',
  'latency-sample',
  'admin-debug-auth',
  'snapshot:request',
  'select-start',
  'setup:submit',
  'move',
  'resign',
  'abort',
  'rematch:offer',
  'rematch:cancel',
  'rematch:decline',
]);

export function isKnownClientMessageType(type: string): boolean {
  return knownClientMessageTypes.has(type);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === 'object' && value !== null && 'type' in value) {
      return value as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}
