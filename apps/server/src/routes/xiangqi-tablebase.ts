// Xiangqi tablebase read API (the analysis board's tablebase panel).
//
//   GET /api/xiangqi/tablebase?fen=<standard xiangqi FEN>
//
// Answers `{ status: 'exact', result, dtm, moves }` when chessdb.cn holds an
// exact result for every legal move, and `{ status: 'none' }` for everything
// else: not endgame material, not in the database, chessdb slow or down, or
// this client asking too fast. "None" is never an error: the panel simply does
// not show, so the caller never needs an error path. Only an unreadable FEN is
// a 400, because that is the caller's bug, not the database's silence.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseStandardXiangqiFen } from '@mistboard/game';
import { clientIpForRateLimit, createAuthRateLimiter } from '../auth-rate-limit.js';
import { sharedXiangqiTablebase, type XiangqiTablebase } from '../xiangqi-tablebase.js';
import { requireMethod, writeJson } from './lib.js';

/** Lookups per client per minute. A reader stepping through an endgame line
 *  asks once per position; past this the answer degrades to `none` (the panel
 *  hides) rather than a 429 the page would have to handle. */
export const TABLEBASE_CLIENT_LIMIT = 90;
const clientLimiter = createAuthRateLimiter(TABLEBASE_CLIENT_LIMIT, 60_000);

let tablebase: () => XiangqiTablebase = sharedXiangqiTablebase;
/** Test seam: swap the lookup for one with a fake chessdb behind it. */
export function setXiangqiTablebaseForTests(instance: XiangqiTablebase | null): void {
  tablebase = instance ? () => instance : sharedXiangqiTablebase;
}

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname !== '/api/xiangqi/tablebase') return false;
  if (!requireMethod(request, response, 'GET')) return true;

  const fen = parsedUrl.searchParams.get('fen')?.trim() ?? '';
  const parsed = fen && fen.length <= 120 ? parseStandardXiangqiFen(fen) : null;
  if (!parsed?.ok) {
    writeJson(response, 400, { error: 'invalid_position' });
    return true;
  }

  if (!clientLimiter.check(clientIpForRateLimit(request))) {
    writeJson(response, 200, { status: 'none' }, { 'cache-control': 'no-store' });
    return true;
  }

  const result = await tablebase().lookup(parsed.state);
  writeJson(response, 200, result, {
    // An exact result is a fact about the position: let the browser keep it.
    // "None" may be a passing outage, so it is only held briefly.
    'cache-control': result.status === 'exact' ? 'public, max-age=86400' : 'public, max-age=60',
  });
  return true;
}
