// Server side of the xiangqi tablebase panel: ask chessdb.cn for the exact
// result of a position, cache it, and never let the database's speed or
// availability reach a reader.
//
// Browsers call /api/xiangqi/tablebase, never chessdb directly: one polite
// client (one request at a time, spaced, with a User-Agent that names us)
// instead of every reader's browser, and one cache in front of it.
//
// Cache: an in-memory LRU, not Postgres. An exact result is a fact about a
// position that does not change, small (a dozen rows), and recomputable for
// free by asking again; a reader scrubbing an endgame hits the same few
// positions repeatedly within minutes. A table would cost a migration and a
// write on every miss to save a request after a deploy. Bounded entries keep
// the RAM flat (rules/infra.md: memory is the bill).
//
// Failure modes all answer `{ status: 'none' }`, the same shape as "the
// database has no row": the panel hides and the engine carries on.
//   - not a candidate (middlegame material)  -> no request at all
//   - chessdb slow                           -> aborted at TIMEOUT_MS
//   - chessdb down, 5xx, or "rate limit"     -> cooldown: no requests for a while
//   - our own queue too deep                 -> answered without asking

import {
  isXiangqiTablebaseCandidate,
  parseChessdbQueryAll,
  standardXiangqiEngineFen,
  type XiangqiGameState,
  type XiangqiTablebaseResponse,
} from '@mistboard/game';

export const CHESSDB_ENDPOINT = 'https://www.chessdb.cn/chessdb.php';
const USER_AGENT = 'Mistboard/1.0 (+https://mistboard.com; xiangqi analysis tablebase panel)';

export interface XiangqiTablebaseOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  endpoint?: string;
  /** Abort a chessdb request after this long. The panel is optional; a slow
   *  answer is worth less than no answer. */
  timeoutMs?: number;
  /** Minimum gap between two requests to chessdb, process-wide. */
  minIntervalMs?: number;
  /** A lookup that would wait longer than this for its slot answers `none`
   *  instead of queueing: the reader has moved on by then. */
  maxQueueMs?: number;
  /** After a failure or a rate-limit answer, send nothing for this long. */
  cooldownMs?: number;
  cacheEntries?: number;
  /** How long an exact answer stays cached. */
  exactTtlMs?: number;
  /** How long "the database has no exact row" stays cached. Shorter: chessdb
   *  keeps growing, and a position it lacks today may be solved next week. */
  noneTtlMs?: number;
}

export interface XiangqiTablebase {
  lookup(state: XiangqiGameState): Promise<XiangqiTablebaseResponse>;
  stats(): { entries: number; hits: number; misses: number; requests: number; failures: number };
}

const NONE: XiangqiTablebaseResponse = { status: 'none' };

interface CacheEntry {
  value: XiangqiTablebaseResponse;
  expiresAt: number;
}

/** The cache key and the board chessdb is asked about: placement and side to
 *  move only. Clocks must not split one position into many cache rows. */
export function xiangqiTablebaseKey(state: XiangqiGameState): string {
  const [placement, turn] = standardXiangqiEngineFen(state).split(' ');
  return `${placement} ${turn}`;
}

export function createXiangqiTablebase(options: XiangqiTablebaseOptions = {}): XiangqiTablebase {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const endpoint = options.endpoint ?? CHESSDB_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const minIntervalMs = options.minIntervalMs ?? 400;
  const maxQueueMs = options.maxQueueMs ?? 1_500;
  const cooldownMs = options.cooldownMs ?? 60_000;
  const cacheEntries = options.cacheEntries ?? 5_000;
  const exactTtlMs = options.exactTtlMs ?? 7 * 24 * 60 * 60_000;
  const noneTtlMs = options.noneTtlMs ?? 30 * 60_000;

  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<XiangqiTablebaseResponse>>();
  let nextSlotAt = 0;
  let coolUntil = 0;
  const counters = { hits: 0, misses: 0, requests: 0, failures: 0 };

  function cacheGet(key: string): XiangqiTablebaseResponse | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry); // most recently used at the end
    return entry.value;
  }

  function cacheSet(key: string, value: XiangqiTablebaseResponse): void {
    cache.delete(key);
    cache.set(key, {
      value,
      expiresAt: now() + (value.status === 'exact' ? exactTtlMs : noneTtlMs),
    });
    while (cache.size > cacheEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function failed(): XiangqiTablebaseResponse {
    counters.failures += 1;
    coolUntil = now() + cooldownMs;
    return NONE;
  }

  async function ask(key: string, state: XiangqiGameState): Promise<XiangqiTablebaseResponse> {
    const at = now();
    if (at < coolUntil) return NONE;
    const slot = Math.max(at, nextSlotAt);
    if (slot - at > maxQueueMs) return NONE;
    nextSlotAt = slot + minIntervalMs;
    if (slot > at) await sleep(slot - at);
    // Re-check after the wait: a request ahead of this one may have tripped it.
    if (now() < coolUntil) return NONE;

    counters.requests += 1;
    let text: string;
    try {
      const response = await fetchImpl(
        `${endpoint}?action=queryall&board=${encodeURIComponent(key)}`,
        { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) return failed();
      text = (await response.text()).trim();
    } catch {
      // Timeout, DNS, connection refused: chessdb is unavailable, so stop
      // asking for a while rather than paying the timeout on every move.
      return failed();
    }
    if (/rate limit/i.test(text)) return failed();

    const exact = parseChessdbQueryAll(text, state);
    const value = exact ?? NONE;
    // A real answer (exact, or "I have no exact row") is cached; a failure above
    // never is, so the next lookup after the cooldown asks again.
    cacheSet(key, value);
    return value;
  }

  return {
    async lookup(state) {
      if (!isXiangqiTablebaseCandidate(state)) return NONE;
      const key = xiangqiTablebaseKey(state);
      const cached = cacheGet(key);
      if (cached) {
        counters.hits += 1;
        return cached;
      }
      counters.misses += 1;
      // Two readers on one position share one request.
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = ask(key, state).finally(() => inflight.delete(key));
      inflight.set(key, request);
      return request;
    },
    stats: () => ({ entries: cache.size, ...counters }),
  };
}

/** The process-wide instance the route uses. */
let shared: XiangqiTablebase | null = null;
export function sharedXiangqiTablebase(): XiangqiTablebase {
  shared ??= createXiangqiTablebase();
  return shared;
}
