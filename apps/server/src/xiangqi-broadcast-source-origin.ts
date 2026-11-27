// Which relayed boards came from dpxq.com. Their game pages stay open by link,
// but they are kept out of the games search and out of search engines.
//
// The board's own source URL is the precise signal: every board imported from
// dpxq records the dpxq page it was read from. The tour's source URL is the
// fallback, for a board stored without one: either a dpxq page or the
// discovery provider that reads dpxq (`mistboard-discover://dpxq-tour?...`).

function isDpxqHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'dpxq.com' || host.endsWith('.dpxq.com');
}

export function isDpxqSourceUrl(sourceUrl: string | null | undefined): boolean {
  if (!sourceUrl) return false;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return isDpxqHost(url.hostname);
  if (url.protocol === 'mistboard-discover:') return /^dpxq(-|$)/.test(url.hostname);
  return false;
}

export function isDpxqBroadcastBoard(
  board: { sourceUrl?: string | null } | null | undefined,
  tour: { sourceUrl?: string | null } | null | undefined,
): boolean {
  return isDpxqSourceUrl(board?.sourceUrl) || isDpxqSourceUrl(tour?.sourceUrl);
}

// The same test in SQL, for a query that joins `boards` and `tours`. COALESCE
// keeps a board with no source URL in the result: NOT (NULL) would drop it.
const HTTP_DPXQ = String.raw`'^https?://([a-z0-9-]+\.)*dpxq\.com(:[0-9]+)?([/?#]|$)'`;
const DISCOVER_DPXQ = `'^mistboard-discover://dpxq(-|[/?#]|$)'`;

export const DPXQ_BROADCAST_BOARD_SQL = `COALESCE(
      boards.source_url ~* ${HTTP_DPXQ}
      OR tours.source_url ~* ${HTTP_DPXQ}
      OR tours.source_url ~* ${DISCOVER_DPXQ},
      false)`;
