// Games per week for the 10,000 games post, drawn from the post's record so the
// bars and the prose cannot disagree. One series, so no legend: the caption names
// it. Month labels and the peak's value and dates carry the reading; each bar keeps its
// exact count in a native tooltip. The narrow viewBox keeps the labels near 10px
// on a phone; the max-width stops them growing on a desktop.

type Week = { weekStart: string; games: number };

const WIDTH = 440;
const HEIGHT = 190;
const LEFT = 8;
const RIGHT = 8;
const TOP = 46;
const AXIS_Y = 164;
const GAP = 2;
const BAR_FILL = 'rgba(21, 120, 91, 0.75)';
const FONT = 'font-family="system-ui, sans-serif"';

const monthOf = (day: string, length: 'short' | 'long') =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: length, timeZone: 'UTC' });

const shortDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Oct 26 to Nov 1" for the Monday-to-Sunday week starting `weekStart`. */
export function weekRange(weekStart: string): string {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  return `${shortDay(start)} to ${shortDay(start + 6 * 86_400_000)}`;
}

export function weeklyGamesChartSvg(weeks: Week[]): string {
  const peak = Math.max(...weeks.map((w) => w.games), 1);
  const barW = (WIDTH - LEFT - RIGHT - GAP * (weeks.length - 1)) / weeks.length;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" style="display:block;width:100%;max-width:560px;margin:0 auto" role="img" aria-label="Finished games per week, rising from a handful in June to a peak of ${peak.toLocaleString('en-US')}">`,
  ];
  let lastMonth = '';
  weeks.forEach((week, i) => {
    const x = LEFT + i * (barW + GAP);
    const height = Math.max((week.games / peak) * (AXIS_Y - TOP), 1);
    const y = AXIS_Y - height;
    const r = Math.min(4, barW / 2, height);
    parts.push(
      `<path d="M${x.toFixed(1)} ${AXIS_Y}V${(y + r).toFixed(1)}q0 ${-r} ${r} ${-r}h${(barW - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}V${AXIS_Y}z" fill="${BAR_FILL}"><title>Week of ${week.weekStart}: ${week.games.toLocaleString('en-US')} games</title></path>`,
    );
    if (week.games === peak) {
      // Anchored to the bar's right edge near the end of the axis, so the label
      // never runs off the chart.
      const nearEnd = x + barW / 2 > WIDTH - 70;
      const anchor = nearEnd ? 'end' : 'middle';
      const labelX = (nearEnd ? x + barW : x + barW / 2).toFixed(1);
      parts.push(
        `<text x="${labelX}" y="${(y - 23).toFixed(1)}" text-anchor="${anchor}" ${FONT} font-size="14" font-weight="700" fill="currentColor">${week.games.toLocaleString('en-US')}</text>`,
        `<text x="${labelX}" y="${(y - 7).toFixed(1)}" text-anchor="${anchor}" ${FONT} font-size="12" fill="currentColor" opacity="0.7">${weekRange(week.weekStart)}</text>`,
      );
    }
    const month = monthOf(week.weekStart, 'short');
    if (month !== lastMonth) {
      lastMonth = month;
      parts.push(
        `<text x="${x.toFixed(1)}" y="${AXIS_Y + 18}" ${FONT} font-size="13" fill="currentColor" opacity="0.7">${month}</text>`,
      );
    }
  });
  parts.push(`<line x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${AXIS_Y}" y2="${AXIS_Y}" stroke="currentColor" opacity="0.25"/>`);
  parts.push('</svg>');
  return parts.join('');
}
