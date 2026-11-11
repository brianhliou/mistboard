// The two charts in the Gomoku title match post, drawn from the post's record
// (content/gomoku-title-decisive.json) so the marks and the prose cannot disagree:
//   - how long the decisive games ran, in bins of ten moves, with the draws
//     (every one a full board) as one bar of their own at the end;
//   - Rapfi's own win chance as the stones go down, one line per result.
// Same build as the 10,000 games chart: a narrow viewBox so labels stay near
// 10px on a phone, a max-width so they do not grow on a desktop, and each mark
// keeps its exact value in a native tooltip.

const FONT = 'font-family="system-ui, sans-serif"';
const BAR_FILL = 'rgba(21, 120, 91, 0.75)';
const DRAW_FILL = 'rgba(121, 118, 111, 0.55)';
const WIDTH = 440;
const svgOpen = (height: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" style="display:block;width:100%;max-width:560px;margin:0 auto" role="img" aria-label="${label}">`;
const text = (x: number, y: number, body: string, attrs = '') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${FONT} font-size="12" fill="currentColor" ${attrs}>${body}</text>`;

export type LengthRecord = {
  decisive: number;
  decisiveMedian: number;
  draws: number;
  drawMoves: number;
  binMoves: number;
  bins: ReadonlyArray<{ from: number; games: number }>;
};

/** Decisive games by length, bins from the shortest to the longest, then the draws. */
export function gameLengthChartSvg(rec: LengthRecord): string {
  const H = 200;
  const LEFT = 8;
  const RIGHT = 8;
  const TOP = 30;
  const AXIS = 164;
  const GAP = 3;
  const first = rec.bins[0]?.from ?? 0;
  const last = rec.bins.at(-1)?.from ?? 0;
  // Every bin in the range, empty ones included, so the axis is even.
  const bins: { from: number; games: number }[] = [];
  for (let from = first; from <= last; from += rec.binMoves) {
    bins.push({ from, games: rec.bins.find((b) => b.from === from)?.games ?? 0 });
  }
  const peak = Math.max(rec.draws, ...bins.map((b) => b.games), 1);
  // The draws bar sits after a gap the width of one bar.
  const slots = bins.length + 2;
  const barW = (WIDTH - LEFT - RIGHT - GAP * (slots - 1)) / slots;
  const xAt = (slot: number) => LEFT + slot * (barW + GAP);
  const bar = (slot: number, games: number, fill: string, title: string) => {
    const h = games ? Math.max((games / peak) * (AXIS - TOP), 1) : 0;
    const x = xAt(slot);
    return `<rect x="${x.toFixed(1)}" y="${(AXIS - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${fill}"><title>${title}</title></rect>`;
  };
  const parts = [
    svgOpen(
      H,
      `${rec.decisive} decisive games by length, from ${first} to ${last + rec.binMoves - 1} moves, median ${rec.decisiveMedian}; the ${rec.draws} draws all run ${rec.drawMoves} moves`,
    ),
  ];
  bins.forEach((b, i) => {
    parts.push(
      bar(i, b.games, BAR_FILL, `${b.from} to ${b.from + rec.binMoves - 1} moves: ${b.games} games`),
    );
    if (b.from % 50 === 0 || i === 0) {
      parts.push(text(xAt(i), AXIS + 16, String(b.from), 'opacity="0.7"'));
    }
  });
  const drawSlot = bins.length + 1;
  parts.push(bar(drawSlot, rec.draws, DRAW_FILL, `Draws: ${rec.draws} games, ${rec.drawMoves} moves each`));
  parts.push(
    text(xAt(drawSlot) + barW, AXIS + 16, 'draws', 'text-anchor="end" opacity="0.7"'),
    text(xAt(drawSlot) + barW, AXIS - (rec.draws / peak) * (AXIS - TOP) - 6, String(rec.draws), 'text-anchor="end" font-weight="700"'),
  );
  // The median as a tick above the bars.
  const medianSlot = (rec.decisiveMedian - first) / rec.binMoves;
  const mx = xAt(0) + medianSlot * (barW + GAP);
  parts.push(
    `<line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${TOP - 6}" y2="${AXIS}" stroke="currentColor" stroke-dasharray="3 3" opacity="0.45"/>`,
    text(mx + 4, TOP - 10, `median ${rec.decisiveMedian} moves`, 'opacity="0.8"'),
    `<line x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${AXIS}" y2="${AXIS}" stroke="currentColor" opacity="0.25"/>`,
    text(WIDTH / 2, H - 6, 'moves after the opening', 'text-anchor="middle" opacity="0.7"'),
    '</svg>',
  );
  return parts.join('');
}

export type TrajectoryPoint = { stones: number; games: number; chance: number };
export type TrajectoryRecord = {
  binStones: number;
  wins: readonly TrajectoryPoint[];
  draws: readonly TrajectoryPoint[];
  losses: readonly TrajectoryPoint[];
};

const LINES = [
  { key: 'wins', name: 'Rapfi won', color: 'var(--eval-compare-a, #1f7a8c)' },
  { key: 'draws', name: 'drawn', color: 'var(--site-muted, #79766f)' },
  { key: 'losses', name: 'Rapfi lost', color: 'var(--eval-compare-b, #d9822b)' },
] as const;

/** Rapfi's mean win chance by stones on the board, a line per final result. */
export function resultLinesChartSvg(rec: TrajectoryRecord): string {
  const H = 230;
  const LEFT = 42;
  const RIGHT = 74;
  const TOP = 12;
  const BOTTOM = 196;
  const all = LINES.flatMap((l) => rec[l.key]);
  const lo = Math.min(...all.map((p) => p.stones));
  const hi = Math.max(...all.map((p) => p.stones));
  const x = (s: number) => LEFT + ((s - lo) / (hi - lo)) * (WIDTH - LEFT - RIGHT);
  const y = (c: number) => BOTTOM - c * (BOTTOM - TOP);
  const parts = [
    svgOpen(
      H,
      "Rapfi's win chance by stones on the board, one line for the games it won, drew and lost: the lines part early",
    ),
  ];
  for (const level of [0, 0.25, 0.5, 0.75, 1]) {
    parts.push(
      `<line x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${y(level).toFixed(1)}" y2="${y(level).toFixed(1)}" stroke="currentColor" opacity="${level === 0.5 ? 0.3 : 0.12}"/>`,
      text(LEFT - 6, y(level) + 4, `${level * 100}%`, 'text-anchor="end" opacity="0.7"'),
    );
  }
  for (let s = Math.ceil(lo / 20) * 20; s <= hi; s += 20) {
    parts.push(text(x(s), BOTTOM + 16, String(s), 'text-anchor="middle" opacity="0.7"'));
  }
  for (const line of LINES) {
    const pts = rec[line.key];
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.stones).toFixed(1)} ${y(p.chance).toFixed(1)}`).join('');
    parts.push(`<path d="${d}" fill="none" stroke="${line.color}" stroke-width="2.5" stroke-linejoin="round"/>`);
    for (const p of pts) {
      parts.push(
        `<circle cx="${x(p.stones).toFixed(1)}" cy="${y(p.chance).toFixed(1)}" r="5" fill="transparent"><title>${line.name}, ${p.stones} to ${p.stones + rec.binStones - 1} stones: ${Math.round(p.chance * 100)}% over ${p.games} games</title></circle>`,
      );
    }
    const end = pts.at(-1);
    if (end) {
      parts.push(text(x(end.stones) + 6, y(end.chance) + 4, line.name, `fill="${line.color}" font-weight="700"`));
    }
  }
  parts.push(
    text((LEFT + WIDTH - RIGHT) / 2, H - 6, 'stones on the board, the five dealt included', 'text-anchor="middle" opacity="0.7"'),
    '</svg>',
  );
  return parts.join('');
}
