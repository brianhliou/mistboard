export type ClientMessage = {
  type: string;
  startId?: number;
  color?: string;
  drop?: string;
  from?: string;
  to?: string;
  /** Duck Xiangqi: where the shared duck lands, second half of one turn. */
  duckTo?: string;
  promotion?: string;
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
