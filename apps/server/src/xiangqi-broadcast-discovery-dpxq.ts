// dpxq live-board discovery.
//
// dpxq publishes no index of live games. /hldcg/chess/ is a viewer *builder*
// (type comma-separated game numbers, get live.htm?id=A-B-C).
//
// A tour that HAS uploaded records links them from movelist_<tour>.html, which
// the dpxq-tour provider reads and which is the better source when it is
// populated (stated rounds, clean tags). This provider covers the case that one
// cannot: a board being watched live before any record exists.
//
// The join is /hldcg/search/s_online.asp, the online-user list, which shows the
// board each logged-in viewer is sitting on. Counting board ids there ranks
// boards by live viewership, and during a tournament the crowd concentrates on
// the tournament boards. It is a proxy, not a feed, so callers filter the
// result by event tag before importing anything.

import {
  type DiscoveredBoard,
  type DiscoveryProvider,
  type DiscoveryProviderInput,
  registerXiangqiBroadcastDiscoveryProvider,
} from './xiangqi-broadcast-discovery.js';
import { dpxqTourDiscoveryProvider } from './xiangqi-broadcast-discovery-dpxq-tour.js';
import { wxfCategoryDiscoveryProvider } from './xiangqi-broadcast-discovery-wxf.js';

const DPXQ_ORIGIN = 'http://www.dpxq.com';
const ONLINE_PATH = '/hldcg/search/s_online.asp';
const BOARD_ID_PATTERN = /view\.asp\?[^"'\s]*\bid=(\d+)/gi;

export function boardUrlForDpxqId(id: string, origin = DPXQ_ORIGIN): string {
  return `${origin}/hldcg/search/view.asp?owner=u&id=${id}`;
}

/** Rank board ids by how many online viewers are sitting on each. */
export function rankDpxqOnlineBoards(html: string): Array<{ id: string; viewers: number }> {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(BOARD_ID_PATTERN)) {
    const id = match[1];
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, viewers]) => ({ id, viewers }))
    .sort((a, b) => b.viewers - a.viewers || Number(b.id) - Number(a.id));
}

export function dhtmlxqTag(text: string, tag: string): string {
  return new RegExp(`\\[DhtmlXQ_${tag}\\]([^\\[]*)`, 'i').exec(text)?.[1]?.trim() ?? '';
}

// dpxq board pages carry a duplicate empty [DhtmlXQ_movelist] placeholder ahead
// of the real one, so first-non-empty wins. This must agree with the adapter's
// own rule: a board counted as started here but read as empty there would be
// imported as a phantom.
export function dpxqPlyCount(text: string): number {
  for (const match of text.matchAll(/\[DhtmlXQ_movelist\]([^[]*)/gi)) {
    const moves = match[1]?.trim() ?? '';
    if (moves.length > 0) return Math.floor(moves.length / 4);
  }
  return 0;
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

export const dpxqLiveDiscoveryProvider: DiscoveryProvider = {
  name: 'dpxq-live',
  async discover(input) {
    const origin = input.config.get('origin')?.trim() || DPXQ_ORIGIN;
    const minViewers = Number(input.config.get('minViewers') ?? '1');
    const maxCandidates = Number(input.config.get('maxCandidates') ?? '64');

    const online = await fetchText(input, `${origin}${ONLINE_PATH}`);
    if (!online.ok) return { ok: false, message: `online list unreachable: ${online.message}` };

    const ranked = rankDpxqOnlineBoards(online.text).filter(
      (board) => board.viewers >= (Number.isFinite(minViewers) ? minViewers : 1),
    );

    const boards: DiscoveredBoard[] = [];
    for (const candidate of ranked.slice(0, Number.isFinite(maxCandidates) ? maxCandidates : 64)) {
      const url = boardUrlForDpxqId(candidate.id, origin);
      const page = await fetchText(input, url);
      // One unreachable candidate is normal (a board can close between the
      // listing and the read); it should not fail the whole discovery pass.
      if (!page.ok) continue;
      boards.push({
        url,
        event: dhtmlxqTag(page.text, 'event'),
        red: dhtmlxqTag(page.text, 'red'),
        black: dhtmlxqTag(page.text, 'black'),
        plies: dpxqPlyCount(page.text),
      });
    }
    return { ok: true, boards };
  },
};

/**
 * Register the providers the server ships with.
 *
 * Called once at poller module load rather than from main.ts, so the CLI
 * poller and the in-server scheduler both get the same registry without either
 * having to remember to do it.
 */
export function registerDefaultXiangqiBroadcastDiscoveryProviders(): void {
  registerXiangqiBroadcastDiscoveryProvider(dpxqLiveDiscoveryProvider);
  registerXiangqiBroadcastDiscoveryProvider(dpxqTourDiscoveryProvider);
  registerXiangqiBroadcastDiscoveryProvider(wxfCategoryDiscoveryProvider);
}
