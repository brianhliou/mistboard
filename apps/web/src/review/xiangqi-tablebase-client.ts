// Browser side of the xiangqi tablebase lookup: ask OUR server (never chessdb
// directly) and turn every failure into "no data".
//
// Shared by the analysis board's tablebase panel and the practice grader. The
// one contract both rely on: this never throws and never invents a verdict. A
// network error, a 4xx/5xx, a body that is not the expected shape: all of it is
// `{ status: 'none' }`, the same as "the database has no row".

import {
  isXiangqiTablebaseCandidate,
  standardXiangqiFen,
  type XiangqiGameState,
  type XiangqiTablebaseResponse,
} from '@mistboard/game';

const NONE: XiangqiTablebaseResponse = { status: 'none' };

/** Per-page memo, so stepping back and forth through a line asks once per
 *  position. Exact answers only: a "none" may be a passing outage. */
const memo = new Map<string, XiangqiTablebaseResponse>();
const MEMO_ENTRIES = 300;

function isResponse(value: unknown): value is XiangqiTablebaseResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as { status?: unknown; moves?: unknown; result?: unknown };
  if (v.status === 'none') return true;
  return (
    v.status === 'exact' &&
    (v.result === 'win' || v.result === 'draw' || v.result === 'loss') &&
    Array.isArray(v.moves) &&
    v.moves.length > 0 &&
    v.moves.every(
      (m: { from?: unknown; to?: unknown; result?: unknown }) =>
        typeof m?.from === 'string' &&
        typeof m.to === 'string' &&
        (m.result === 'win' || m.result === 'draw' || m.result === 'loss'),
    )
  );
}

/** Look a position up. Resolves `none` for anything but an exact answer. */
export async function fetchXiangqiTablebase(
  state: XiangqiGameState,
  signal?: AbortSignal,
): Promise<XiangqiTablebaseResponse> {
  if (!isXiangqiTablebaseCandidate(state)) return NONE;
  const fen = standardXiangqiFen(state);
  const key = fen.split(' ').slice(0, 2).join(' ');
  const cached = memo.get(key);
  if (cached) return cached;
  try {
    const response = await fetch(`/api/xiangqi/tablebase?fen=${encodeURIComponent(fen)}`, {
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return NONE;
    const body: unknown = await response.json();
    if (!isResponse(body) || body.status !== 'exact') return NONE;
    memo.set(key, body);
    while (memo.size > MEMO_ENTRIES) {
      const oldest = memo.keys().next().value;
      if (oldest === undefined) break;
      memo.delete(oldest);
    }
    return body;
  } catch {
    return NONE;
  }
}

/** Test seam: forget memoised answers. */
export function clearXiangqiTablebaseMemo(): void {
  memo.clear();
}
