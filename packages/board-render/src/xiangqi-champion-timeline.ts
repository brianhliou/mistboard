// The national-championship record, held once and rendered twice: as the
// timeline figure and as the table beneath it. Both read from CHAMPIONS below,
// so a correction lands in both or neither. A hand-maintained second copy is
// how a table and its chart start disagreeing.

export type ChampionRecord = {
  /** English name, as used in the article headings. */
  name: string;
  /**
   * The player's name in Chinese, shown in the table and the section heading
   * (the figure has no room for it).
   *
   * Stored in Simplified, because the record is the key the translation
   * dictionaries read. A name follows the page's script, so a Traditional page
   * gets its form from the dictionary.
   */
  zh: string;
  /** Every edition this player won outright. */
  years: number[];
  /** Editions shared with another player (1962 is the only one). */
  shared?: number[];
  /** A published Chinese Xiangqi Association ruling, quoted verbatim in the table. */
  sanction?: string;
};

/** Every edition actually played. The gaps are the story; see EDITION_GAPS. */
export const EDITIONS: readonly number[] = [
  1956,
  1957,
  1958,
  1959,
  1960,
  1962,
  1964,
  1965,
  1966,
  1974,
  1975,
  1977,
  1978,
  1979,
  ...Array.from({ length: 41 }, (_, i) => 1980 + i),
  2023,
  2025,
];

/**
 * Years inside the span with no championship, and why. `label` is drawn on the
 * figure; only the wide gaps have room for one, so `reason` carries the rest
 * for the caption, which names all six.
 */
export const EDITION_GAPS: ReadonlyArray<{
  from: number;
  to: number;
  label?: string;
  reason: string;
}> = [
  { from: 1961, to: 1961, reason: 'the famine' },
  { from: 1963, to: 1963, reason: 'the famine' },
  { from: 1967, to: 1973, label: 'Cultural Revolution', reason: 'the Cultural Revolution' },
  { from: 1976, to: 1976, reason: "Mao's death" },
  { from: 2021, to: 2022, reason: 'the pandemic' },
  { from: 2024, to: 2024, reason: 'want of a sponsor' },
];

/** One sentence naming every gap, for the figure caption. */
export function editionGapSentence(): string {
  const byReason = new Map<string, string[]>();
  for (const gap of EDITION_GAPS) {
    const span = gap.from === gap.to ? String(gap.from) : `${gap.from}-${gap.to}`;
    byReason.set(gap.reason, [...(byReason.get(gap.reason) ?? []), span]);
  }
  const parts = [...byReason].map(([reason, spans]) => {
    const list =
      spans.length > 1 ? `${spans.slice(0, -1).join(', ')} and ${spans.at(-1)}` : spans[0];
    return `${list} to ${reason}`;
  });
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

/** Ordered by first title, matching the order of the article's sections. */
export const CHAMPIONS: readonly ChampionRecord[] = [
  { name: 'Yang Guanlin', zh: '杨官璘', years: [1956, 1957, 1959], shared: [1962] },
  { name: 'Li Yiting', zh: '李义庭', years: [1958] },
  {
    name: 'Hu Ronghua',
    zh: '胡荣华',
    years: [1960, 1964, 1965, 1966, 1974, 1975, 1977, 1978, 1979, 1983, 1985, 1997, 2000],
    shared: [1962],
  },
  { name: 'Liu Dahua', zh: '柳大华', years: [1980, 1981] },
  { name: 'Li Laiqun', zh: '李来群', years: [1982, 1984, 1987, 1991] },
  { name: 'Lü Qin', zh: '吕钦', years: [1986, 1988, 1999, 2003, 2004] },
  { name: 'Xu Tianhong', zh: '徐天红', years: [1989] },
  { name: 'Zhao Guorong', zh: '赵国荣', years: [1990, 1992, 1995, 2008] },
  { name: 'Xu Yinchuan', zh: '许银川', years: [1993, 1996, 1998, 2001, 2006, 2009] },
  { name: 'Tao Hanming', zh: '陶汉明', years: [1994] },
  { name: 'Yu Youhua', zh: '于幼华', years: [2002] },
  { name: 'Hong Zhi', zh: '洪智', years: [2005], sanction: 'banned for life, 2026' },
  { name: 'Zhao Xinxin', zh: '赵鑫鑫', years: [2007], sanction: 'banned for life, 2025' },
  { name: 'Jiang Chuan', zh: '蒋川', years: [2010], sanction: 'five-year ban, 2026' },
  {
    name: 'Sun Yongzheng',
    zh: '孙勇征',
    years: [2011],
    sanction: 'banned four years three months, 2025',
  },
  {
    name: 'Wang Tianyi',
    zh: '王天一',
    years: [2012, 2016, 2019, 2023],
    sanction: 'convicted, banned',
  },
  { name: 'Xie Jing', zh: '谢靖', years: [2013], sanction: 'banned for life, 2026' },
  { name: 'Zheng Weitong', zh: '郑惟桐', years: [2014, 2015], sanction: 'banned for life, 2025' },
  { name: 'Xu Chao', zh: '徐超', years: [2017], sanction: 'banned for life, 2026' },
  { name: 'Wang Yang', zh: '汪洋', years: [2018], sanction: 'banned for life, 2025' },
  { name: 'Wang Kuo', zh: '王廓', years: [2020], sanction: 'banned seven years six months, 2025' },
  { name: 'Wang Yubo', zh: '王禹博', years: [2025] },
];

export const FIRST_YEAR = 1956;
export const LAST_YEAR = 2025;

/**
 * Collapse a champion's title years into a compact list, merging only genuinely
 * consecutive calendar years. This deliberately does NOT use the figure's
 * bar-merging rule: a bar may close over a cancelled year because the shape is
 * the point, but "1974-1979" written out would claim a 1976 title that was
 * never played for.
 */
function yearList(champ: ChampionRecord, editions: readonly number[] = EDITIONS): string {
  const all = [...champ.years, ...(champ.shared ?? [])].sort((a, b) => a - b);
  const shared = new Set(champ.shared ?? []);
  const spans: Array<{ from: number; to: number }> = [];
  for (const y of all) {
    const last = spans.at(-1);
    // A shared year is called out on its own, so it never joins a span.
    if (last && last.to === y - 1 && !shared.has(y) && !shared.has(last.to)) last.to = y;
    else spans.push({ from: y, to: y });
  }
  return spans
    .map((s) => {
      const label = s.from === s.to ? String(s.from) : `${s.from}-${s.to}`;
      // An asterisk rather than the word: the table sets nowrap, and spelling
      // it out twice pushed Hu Ronghua's row wide enough to scroll the table.
      return shared.has(s.from) ? `${label}*` : label;
    })
    .join(', ');
}

/**
 * Table rows, generated so the table and the figure cannot disagree. One row
 * per champion rather than one per edition: at 57 rows the year-by-year version
 * ran longer than the rest of the section put together, and the figure above
 * already answers "who held it when" faster than a list can.
 */
export function championTableRows(
  records: readonly ChampionRecord[] = CHAMPIONS,
  editions: readonly number[] = EDITIONS,
): string[][] {
  return records.map((c) => [
    `${c.name} ${c.zh}`,
    String(c.years.length + (c.shared?.length ?? 0)),
    yearList(c, editions),
    c.sanction ?? '',
  ]);
}

/**
 * Merge a player's title years into bars. A bar closes over a single missing
 * year, so Hu Ronghua's 1974-1979 stays unbroken across the 1976 cancellation,
 * but breaks at any longer interruption: drawing one bar through the seven
 * blank Cultural Revolution years would show him holding a title that was not
 * being contested. The gap band has to stay visible through the row.
 */
const MAX_BRIDGED_GAP = 1;

function runs(
  years: number[],
  editions: readonly number[] = EDITIONS,
): Array<{ from: number; to: number }> {
  const held = editions.filter((y) => years.includes(y));
  const out: Array<{ from: number; to: number }> = [];
  for (const y of held) {
    const last = out.at(-1);
    const index = editions.indexOf(y);
    // `prevEdition` is undefined for the first edition; compare only when there
    // is a bar to extend, or `undefined === undefined` reads as a match.
    const prevEdition = index > 0 ? editions[index - 1] : undefined;
    const bridges =
      last !== undefined &&
      prevEdition !== undefined &&
      last.to === prevEdition &&
      y - last.to - 1 <= MAX_BRIDGED_GAP;
    if (last && bridges) last.to = y;
    else out.push({ from: y, to: y });
  }
  return out;
}

/** Layout the figure is drawn on. Exported so tests read it rather than
 *  restating it: a duplicated PAD_L broke two assertions when it moved. */
export const CHART_LAYOUT = { width: 920, padLeft: 224, padRight: 14 } as const;

const PAD_L_FULL = CHART_LAYOUT.padLeft;
const PAD_R = CHART_LAYOUT.padRight;
const WIDTH = CHART_LAYOUT.width;
const DEFAULT_ROW_H = 21;
const BAR_H = 12;
const AXIS_H = 40;
const LEGEND_H = 34;
// PLOT_W, CELL and PLOT_H all depend on the options, so they are computed per
// render rather than at module scope.

const HATCH_ID = 'xq-champ-nohold';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Colours for a context with no stylesheet. The article omits this and styles by
 * class, so the figure follows the reader's theme; the share card is rasterised
 * on the server where no CSS exists, so it passes literals.
 */
export type ChampionTimelinePalette = {
  bar: string;
  barBanned: string;
  text: string;
  muted: string;
  border: string;
};

export type ChampionTimelineOptions = {
  palette?: ChampionTimelinePalette;
  /**
   * The record to draw. Defaults to the national championship, which is what
   * this module was written for; the world title passes its own so the two
   * charts are one implementation rather than a copy that drifts.
   */
  records?: readonly ChampionRecord[];
  /** Editions actually held, which is what makes the gaps hatched. */
  editions?: readonly number[];
  /** Gap bands to shade and label, e.g. the Cultural Revolution. */
  gaps?: ReadonlyArray<{ from: number; to: number; label?: string }>;
  /** Row labels off for small renditions, where 22 names cannot be read. */
  labels?: boolean;
  /** Omitted on the share card, which carries the article title instead. */
  legend?: boolean;
  credit?: boolean;
  /**
   * Row pitch. Rows only need to clear their label text, so a rendition without
   * labels packs tighter; at the default the share card was letterboxed by its
   * own height and used two thirds of the width available to it.
   */
  rowHeight?: number;
};

export function xiangqiChampionTimelineSvg(options: ChampionTimelineOptions = {}): string {
  const { palette, labels = true, legend = true, credit = true } = options;
  const records = options.records ?? CHAMPIONS;
  const editions = options.editions ?? EDITIONS;
  const gaps = options.gaps ?? EDITION_GAPS;
  // The span comes from the data, not from a constant: a second record with a
  // different first and last edition would otherwise be drawn on the national
  // championship's axis and silently misplace every bar.
  const first = editions[0] ?? FIRST_YEAR;
  const last = editions[editions.length - 1] ?? LAST_YEAR;
  const ROW_H = options.rowHeight ?? (labels ? DEFAULT_ROW_H : 15);
  const PLOT_H = records.length * ROW_H;
  // Without row labels the plot takes the column they occupied.
  const PAD_L = labels ? PAD_L_FULL : 24;
  const PLOT_W = WIDTH - PAD_L - PAD_R;
  const CELL = PLOT_W / (last - first + 1);
  const HEIGHT = AXIS_H + PLOT_H + (legend ? LEGEND_H : 14);
  const x = (year: number) => PAD_L + (year - first) * CELL;
  // With a palette every mark carries its own fill; without one it carries a
  // class and the stylesheet decides.
  const paint = (cls: string, fill: string | undefined) =>
    palette && fill ? `fill="${fill}"` : `class="${cls}"`;
  const parts: string[] = [];

  parts.push(
    `<svg class="xq-champ-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" ` +
      `aria-label="Every Chinese national xiangqi champion from 1956 to 2025, one row per player, ` +
      `a bar over the years they held the title." ` +
      `xmlns="http://www.w3.org/2000/svg" font-family="inherit">`,
  );

  // A year with no championship is hatched, not tinted. The previous version
  // drew it as a faint fill of the same colour as a banned champion's bar, and
  // at one year wide a band and a bar are the same rectangle: the two states
  // were indistinguishable. Hatching says "nothing here" in a way no bar does.
  parts.push(
    `<defs><pattern id="${HATCH_ID}" width="7" height="7" patternUnits="userSpaceOnUse" ` +
      `patternTransform="rotate(45)">` +
      `<rect width="7" height="7" ${paint('xq-champ-void-bg', palette?.muted)} opacity="0.05"/>` +
      `<line x1="0" y1="0" x2="0" y2="7" ${palette ? `stroke="${palette.muted}"` : 'class="xq-champ-void-line"'} stroke-width="1.7" opacity="0.3"/>` +
      `</pattern></defs>`,
  );

  // Years with no championship, drawn first so bars and rules sit over them.
  for (const gap of gaps) {
    const gx = x(gap.from);
    const gw = (gap.to - gap.from + 1) * CELL;
    parts.push(
      `<rect x="${gx.toFixed(1)}" y="${AXIS_H - 8}" width="${gw.toFixed(1)}" height="${PLOT_H + 8}" ` +
        `fill="url(#${HATCH_ID})"/>`,
    );
    if (gap.label) {
      parts.push(
        `<text x="${(gx + gw / 2).toFixed(1)}" y="${AXIS_H - 14}" text-anchor="middle" ` +
          `font-size="10" letter-spacing="0.04em" ${paint('xq-champ-gap-label', palette?.muted)}>${esc(gap.label)}</text>`,
      );
    }
  }

  // Half-decade rules, a tier fainter than the decades. With 22 rows and a
  // seventy-year span, reading a bar back to a year across a ten-year gap is
  // guesswork; a five-year grid halves the distance without adding a label.
  // First mid-decade inside the span: 1965 for a 1956 start, 1995 for 1990.
  // Parameterising this as a decade boundary instead put it exactly on the
  // decade rules below, which is the one place it must not be.
  for (let year = Math.ceil((first - 5) / 10) * 10 + 5; year <= last; year += 10) {
    parts.push(
      `<line x1="${x(year).toFixed(1)}" y1="${AXIS_H - 8}" x2="${x(year).toFixed(1)}" ` +
        `y2="${AXIS_H + PLOT_H}" ${palette ? `stroke="${palette.border}"` : 'stroke="var(--site-border)"'} stroke-width="1" opacity="0.22"/>`,
    );
  }

  if (credit)
    // Credit inside the artwork, not just on an exported file: the figure travels
    // as a screenshot far more often than as a download, and a screenshot carries
    // whatever is drawn in it and nothing else. Top right, clear of the legend
    // row it used to crowd.
    parts.push(
      `<text x="${WIDTH - PAD_R}" y="16" text-anchor="end" font-size="11" ` +
        `${paint('xq-champ-credit', palette?.muted)} opacity="0.75">mistboard.com</text>`,
    );

  // Decade rules + axis labels, bounded by the span rather than by the national
  // championship's dates. A label is skipped when it lands on an endpoint, which
  // already carries one: a chart starting in 1990 printed 1990 twice, on top of
  // itself, and three more decades off its own left edge.
  for (let year = Math.ceil(first / 10) * 10; year <= last; year += 10) {
    parts.push(
      `<line x1="${x(year).toFixed(1)}" y1="${AXIS_H - 8}" x2="${x(year).toFixed(1)}" ` +
        `y2="${AXIS_H + PLOT_H}" ${palette ? `stroke="${palette.border}"` : 'stroke="var(--site-border)"'} stroke-width="1" opacity="0.5"/>`,
    );
    if (year === first || year === last) continue;
    parts.push(
      `<text x="${x(year).toFixed(1)}" y="${AXIS_H + PLOT_H + 16}" text-anchor="middle" ` +
        `font-size="11" ${palette ? `fill="${palette.muted}"` : 'fill="var(--site-muted)"'}>${year}</text>`,
    );
  }
  for (const [year, anchor] of [
    [first, 'start'],
    [last, 'end'],
  ] as const) {
    const px = year === first ? x(year) : x(year) + CELL;
    parts.push(
      `<text x="${px.toFixed(1)}" y="${AXIS_H + PLOT_H + 16}" text-anchor="${anchor}" ` +
        `font-size="11" ${palette ? `fill="${palette.text}"` : 'fill="var(--site-heading)"'}>${year}</text>`,
    );
  }

  records.forEach((champ, i) => {
    const rowY = AXIS_H + i * ROW_H;
    const midY = rowY + ROW_H / 2;
    const total = champ.years.length + (champ.shared?.length ?? 0);

    // Baseline: the span this player was active in the record, kept faint so a
    // one-title row still reads as a row.
    parts.push(
      `<line x1="${PAD_L}" y1="${midY.toFixed(1)}" x2="${(WIDTH - PAD_R).toFixed(1)}" ` +
        `y2="${midY.toFixed(1)}" ${palette ? `stroke="${palette.border}"` : 'stroke="var(--site-border)"'} stroke-width="1" opacity="0.35"/>`,
    );

    // English then Chinese, right-aligned as one run so the count column stays
    // put. The Chinese sits in a quieter fill: it identifies the player for a
    // reader who wants it without competing with the name most of this page's
    // readers can actually parse.
    if (labels)
      parts.push(
        `<text x="${PAD_L - 34}" y="${(midY + 4).toFixed(1)}" text-anchor="end" font-size="12.5" ` +
          `${paint('xq-champ-name', palette?.text)}>${esc(champ.name)} ` +
          `<tspan ${paint('xq-champ-zh', palette?.muted)}>${esc(champ.zh)}</tspan></text>`,
      );
    if (labels)
      parts.push(
        `<text x="${PAD_L - 12}" y="${(midY + 4).toFixed(1)}" text-anchor="end" font-size="11.5" ` +
          `${palette ? `fill="${palette.muted}"` : 'fill="var(--site-muted)"'} font-variant-numeric="tabular-nums">${total}</text>`,
      );

    // Banned is a different hue, not a paler version of the same one. Encoding
    // it as "the accent, but fainter" put it on the same axis as the hatched
    // no-championship background and neither could be read off the figure.
    const barClass = champ.sanction ? 'xq-champ-bar xq-champ-bar--banned' : 'xq-champ-bar';
    const barPaint = palette
      ? `fill="${champ.sanction ? palette.barBanned : palette.bar}"`
      : `class="${barClass}"`;
    for (const run of runs(champ.years, editions)) {
      const rx = x(run.from) + 0.75;
      const rw = Math.max(CELL - 1.5, 3.5) + (run.to - run.from) * CELL;
      parts.push(
        `<rect x="${rx.toFixed(1)}" y="${(midY - BAR_H / 2).toFixed(1)}" width="${rw.toFixed(1)}" ` +
          `height="${BAR_H}" rx="2" ${barPaint}/>`,
      );
    }
    for (const year of champ.shared ?? []) {
      parts.push(
        `<rect x="${(x(year) + 0.75).toFixed(1)}" y="${(midY - BAR_H / 2).toFixed(1)}" ` +
          `width="${Math.max(CELL - 1.5, 3.5).toFixed(1)}" height="${BAR_H}" rx="2" ` +
          `${palette ? `fill="none" stroke="${palette.bar}" stroke-width="1.5"` : 'class="xq-champ-bar-shared"'}/>`,
      );
    }
  });

  // Legend. Two groups, because the two encodings answer different questions:
  // the first three are what a bar means, the last is what the background means.
  const ly = AXIS_H + PLOT_H + 30;
  const items: Array<{ style: 'solid' | 'banned' | 'outline' | 'void'; label: string }> = [
    { style: 'solid', label: 'title' },
    ...(records.some((r) => (r.shared?.length ?? 0) > 0)
      ? [{ style: 'outline' as const, label: 'shared title' }]
      : []),
    { style: 'banned', label: 'title, champion later banned' },
    { style: 'void', label: 'no championship held' },
  ];
  // Measured first, then centred under the plot. It used to start hard against
  // the label column and trail off with the credit hanging on the end.
  const SWATCH_W = 16;
  const SWATCH_GAP = 6;
  const ITEM_GAP = 22;
  const CHAR_W = 5.6;
  const legendWidth =
    items.reduce((sum, item) => sum + SWATCH_W + SWATCH_GAP + item.label.length * CHAR_W, 0) +
    ITEM_GAP * (items.length - 1);
  let lx = PAD_L + Math.max(0, (PLOT_W - legendWidth) / 2);
  if (legend)
    for (const item of items) {
      const cls =
        item.style === 'solid'
          ? 'xq-champ-bar'
          : item.style === 'banned'
            ? 'xq-champ-bar xq-champ-bar--banned'
            : item.style === 'outline'
              ? 'xq-champ-bar-shared'
              : '';
      if (item.style === 'void') {
        parts.push(
          `<rect x="${lx}" y="${ly - 9}" width="16" height="12" fill="url(#${HATCH_ID})"/>`,
        );
      } else {
        // The swatches take the palette the same way the bars do. They used to
        // carry a class unconditionally, so a palette rendition (the only kind
        // that leaves this stylesheet behind) drew three black boxes.
        const swatchPaint = palette
          ? item.style === 'outline'
            ? `fill="none" stroke="${palette.bar}" stroke-width="1.5"`
            : `fill="${item.style === 'banned' ? palette.barBanned : palette.bar}"`
          : `class="${cls}"`;
        parts.push(`<rect x="${lx}" y="${ly - 8}" width="16" height="10" rx="2" ${swatchPaint}/>`);
      }
      parts.push(
        `<text x="${(lx + SWATCH_W + SWATCH_GAP).toFixed(1)}" y="${ly + 1}" font-size="11" ` +
          `${paint('xq-champ-legend', palette?.muted)}>${esc(item.label)}</text>`,
      );
      lx += SWATCH_W + SWATCH_GAP + item.label.length * CHAR_W + ITEM_GAP;
    }

  parts.push('</svg>');
  return parts.join('');
}
