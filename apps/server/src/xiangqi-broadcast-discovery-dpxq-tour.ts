// dpxq tour discovery: read a tournament's own game list.
//
// The sibling `dpxq-live` provider ranks boards by how many people are watching
// them, which is a proxy: a busy board is not necessarily a tournament board,
// and the online list's boards frequently carry no event tag at all, so round 1
// needs a human to say which ids are the event.
//
// A tour that has game records publishes them at /hldcg/movelist_<tour>.html,
// one row per game, each row labelled 第NN轮 and linking view_m_<id>.html. That
// is a feed rather than a proxy: the round arrives stated instead of inferred,
// and the per-game pages carry clean event/round/table/team tags. Prefer this
// provider whenever the tour has a 棋谱 link on /hldcg/; fall back to dpxq-live
// for an event being relayed live before any records are uploaded.
//
// Answered by the 2026 Shanghai Cup (tour 12524, 09-09 to 09-13): ids appear
// only when the operator uploads them afterwards, on no fixed delay (his own
// words: 赛后, 不固定), and one game was listed by the event's last day. So this
// feed is a recap, not a relay, and the provider declares `statesRounds` so the
// poller files boards by the round each row states instead of by the clock:
// a schedule window would have closed long before any record arrived.

import type {
  DiscoveredBoard,
  DiscoveryProvider,
  DiscoveryProviderInput,
} from './xiangqi-broadcast-discovery.js';

const DPXQ_ORIGIN = 'http://www.dpxq.com';

export function tourGameListUrl(tour: string, origin = DPXQ_ORIGIN): string {
  return `${origin}/hldcg/movelist_${tour}.html`;
}

export function archiveBoardUrl(id: string, origin = DPXQ_ORIGIN): string {
  return `${origin}/hldcg/search/view_m_${id}.html`;
}

export type DpxqTourGame = { id: string; roundNumber?: number };

/**
 * Pull (round, game id) out of a tour's game list.
 *
 * Only the round label and the record link are read. The players and the result
 * are on the row too, but the game page states them in tagged fields, and a
 * team event writes the two sides in mirrored order ("team player" for red,
 * "player team" for black), so parsing them here would add a second, more
 * fragile source of the same facts.
 */
export function parseDpxqTourGameList(html: string): DpxqTourGame[] {
  const games: DpxqTourGame[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const body = row[1] ?? '';
    const id = body.match(/view_m_(\d+)\.html/i)?.[1];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const text = body.replace(/<[^>]+>/g, ' ');
    const round = Number(text.match(/第\s*(\d+)\s*轮/)?.[1]);
    games.push({
      id,
      ...(Number.isInteger(round) && round > 0 ? { roundNumber: round } : {}),
    });
  }
  return games;
}

async function fetchText(
  input: DiscoveryProviderInput,
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `${url} responded ${response.status}` };
    return { ok: true, text: await response.text() };
  } catch (error) {
    return {
      ok: false,
      message: `${url}: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const dpxqTourDiscoveryProvider: DiscoveryProvider = {
  name: 'dpxq-tour',
  statesRounds: true,
  async discover(input) {
    const origin = input.config.get('origin')?.trim() || DPXQ_ORIGIN;
    const tour = input.config.get('tour')?.trim();
    if (!tour || !/^\d+$/.test(tour)) {
      return { ok: false, message: 'dpxq-tour discovery needs a numeric tour id (tour=12683)' };
    }

    const listUrl = tourGameListUrl(tour, origin);
    const list = await fetchText(input, listUrl);
    if (!list.ok) return { ok: false, message: `tour game list unreachable: ${list.message}` };

    const games = parseDpxqTourGameList(list.text);
    if (games.length === 0) {
      // Normal before a tour has any uploaded records; the caller's backoff
      // widens the gap rather than treating it as a fault.
      return { ok: false, message: `tour ${tour} lists no game records yet` };
    }

    // One page per game is not fetched here: the round is already stated by the
    // list, and the leaf fetch downstream reads each page once anyway. Fetching
    // them twice would double the load we put on dpxq every poll.
    const boards: DiscoveredBoard[] = games.map((game) => ({
      url: archiveBoardUrl(game.id, origin),
      ...(game.roundNumber !== undefined ? { roundNumber: game.roundNumber } : {}),
    }));
    return { ok: true, boards };
  },
};
