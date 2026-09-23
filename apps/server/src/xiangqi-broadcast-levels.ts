// The grade of each relayed event, for the coverage gate on player pages
// (docs-private/players/players-surface-spec.md, Brian 2026-09-21: "coverage -
// any A-level event"). A name seen in an A-level tour gets a page; a name seen
// only in a student, amateur or youth open does not.
//
// Kept in code rather than on the tour record because the grade is the
// broadcast calendar's judgment (docs-private/broadcast-calendar.md), it does
// not change, and the seed scripts are run by hand: a map here is reviewed in
// the same diff as the tour it grades. A tour missing from the map is ungraded
// and does not qualify anyone, which is the safe default for a page that
// exists because games exist.
export type XiangqiBroadcastTourLevel = 'A' | 'B' | 'C';

export const XIANGQI_BROADCAST_TOUR_LEVELS: Readonly<Record<string, XiangqiBroadcastTourLevel>> = {
  // 象甲 (the national men's league) and its own qualifier: the league is the
  // professional circuit's spine.
  '2026-xiangqi-league': 'A',
  '2026-league-qualifier': 'A',
  // 女甲 (the national women's league), dpxq 12776, stage one 09-23..27 in
  // 绥芬河: the women's side of the same circuit. Graded before it is seeded
  // so the import lands with player pages on.
  '2026-womens-xiangqi-league': 'A',
  // 上海杯: marquee open, >¥1M prize, 48 seats by invitation and qualification.
  '2026-shanghai-cup': 'A',
  // 全国象棋团体赛 (July 2026): the national team championship, professional.
  '2026-ewwox2': 'A',
  // The M0 fixture pack (packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample),
  // graded so the persistence tests can exercise the gate; it never reaches prod.
  '2025-wxc-sample': 'A',
};

export function xiangqiBroadcastTourLevel(slug: string): XiangqiBroadcastTourLevel | null {
  return XIANGQI_BROADCAST_TOUR_LEVELS[slug] ?? null;
}
