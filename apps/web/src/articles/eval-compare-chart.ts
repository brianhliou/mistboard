// One game, two engines: each engine's expected score for one side, ply by ply,
// the gap between them shaded, the ply where each settled above a threshold for
// good, and marks over the moves the stronger engine faulted. Built for the
// KataGo post (data from katago-jungle-analysis.ts).
// Every <text> without translate="no" is a dictionary key on the zh pages
// (articles.ts localizeSvgMarkup), so labels are whole phrases, numbers apart.

const FONT = 'Roboto, system-ui, sans-serif';
const INK = 'var(--site-text, #4d4a47)';
const MUTED = 'var(--site-muted, #79766f)';
const RULE = 'var(--site-border, #d8d5cf)';
const RULE_SOFT = 'var(--site-border-soft, #e4e1dc)';
const PANEL = 'var(--site-panel, #fff)';
export const ENGINE_A_COLOR = 'var(--eval-compare-a, #1f7a8c)';
export const ENGINE_B_COLOR = 'var(--eval-compare-b, #d9822b)';
const GAP_FILL = 'var(--eval-compare-gap, rgba(217, 130, 43, 0.16))';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * Position `i` (after `i` plies) as the move just played, numbered the way the
 * study embeds number it: red and black share a move number, and black's move
 * carries an ellipsis ("29" is red's 29th, "36…" black's 36th).
 */
export function moveLabel(i: number): string {
  if (i === 0) return '0';
  return i % 2 === 1 ? `${(i + 1) / 2}` : `${i / 2}…`;
}

export type EvalCompareSpec = {
  id: string;
  ariaLabel: string;
  heading: string;
  /** Legend names, e.g. "KataGo" and "Misty". */
  nameA: string;
  nameB: string;
  /** Expected score for the charted side at positions 0..n-1, in [0, 1]. */
  a: readonly number[];
  b: readonly number[];
  /** Dashed reference level, e.g. 0.8, with the plies each series settled above it. */
  threshold?: { level: number; settledA: number | null; settledB: number | null };
  /** Marks along the top: a move (ply played = index + 1) with its glyph. */
  marks?: ReadonlyArray<{ ply: number; glyph: string }>;
  /** Axis title under the plot. */
  xLabel: string;
  /**
   * What the x axis counts. 'ply' (the default) labels positions by index;
   * 'move' labels them as moves (moveLabel), so the ticks, the settle labels and
   * the hover readout match the move numbers in a study embed beside the chart.
   */
  axis?: 'ply' | 'move';
  /** Gridline levels above 0%; default 25/50/75/100%. */
  yTicks?: readonly number[];
  /**
   * Name each series on the plot, beside its line at position `at`, in place of
   * the legend: a reader matches a word to a line without a key.
   */
  lineLabels?: { at: number; a: string; b: string };
  /**
   * Notes pinned to one line: a dot at position `ply` on series `on`, and the
   * text beside it (`side`) with its first line at height `level`. The first
   * line is the headline, the rest a quieter gloss. Placement is by hand, per
   * game, so a note never sits on a line.
   */
  callouts?: ReadonlyArray<{
    ply: number;
    on: 'a' | 'b';
    lines: readonly string[];
    side: 'left' | 'right';
    level: number;
  }>;
};

const W = 640;
const H = 270;

export function evalCompareChartSvg(spec: EvalCompareSpec): string {
  const n = spec.a.length;
  if (n < 2 || spec.b.length !== n) throw new Error(`eval-compare ${spec.id}: bad series`);
  // No legend row when the lines carry their own names.
  const PLOT = { left: 40, right: W - 14, top: spec.lineLabels ? 36 : 48, bottom: H - 42 };
  const x = (i: number): number => PLOT.left + (i / (n - 1)) * (PLOT.right - PLOT.left);
  const y = (v: number): number => PLOT.bottom - v * (PLOT.bottom - PLOT.top);
  const path = (s: readonly number[]): string =>
    s.map((v, i) => `${i === 0 ? 'M' : 'L'}${r1(x(i))} ${r1(y(v))}`).join('');

  const out: string[] = [
    `<svg class="eval-compare-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${spec.id}-title">`,
    `<title id="${spec.id}-title">${spec.ariaLabel}</title>`,
    `<text x="${PLOT.left}" y="18" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${INK}">${spec.heading}</text>`,
  ];
  // Legend under the heading.
  const legend = (lx: number, color: string, name: string): string =>
    `<path d="M${lx} 33h18" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/><text x="${lx + 24}" y="37" font-family="${FONT}" font-size="11.5" fill="${INK}" translate="no">${name}</text>`;
  if (!spec.lineLabels)
    out.push(
      legend(PLOT.left, ENGINE_A_COLOR, spec.nameA),
      legend(PLOT.left + 110, ENGINE_B_COLOR, spec.nameB),
    );

  for (const v of spec.yTicks ?? [0.25, 0.5, 0.75, 1]) {
    out.push(
      `<path d="M${PLOT.left} ${r1(y(v))}H${PLOT.right}" stroke="${RULE_SOFT}" stroke-width="1"/>`,
      `<text x="${PLOT.left - 6}" y="${r1(y(v) + 4)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}" translate="no">${pct(v)}</text>`,
    );
  }
  out.push(
    `<path d="M${PLOT.left} ${PLOT.bottom}H${PLOT.right}" stroke="${RULE}" stroke-width="1"/>`,
    `<text x="${PLOT.left - 6}" y="${PLOT.bottom + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}" translate="no">0%</text>`,
  );
  const byMove = spec.axis === 'move';
  const label = byMove ? moveLabel : (i: number): string => `${i}`;
  // Every 10 plies, or every 10 moves (a move tick sits on red's move, the
  // position after ply 2m - 1).
  const step = byMove || n > 120 ? 20 : 10;
  for (let p = step; p < n; p += step) {
    const at = byMove ? p - 1 : p;
    out.push(
      `<text x="${r1(x(at))}" y="${PLOT.bottom + 16}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}" translate="no">${byMove ? p / 2 : p}</text>`,
    );
  }
  out.push(
    `<text x="${PLOT.right}" y="${H - 8}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${spec.xLabel}</text>`,
  );

  // The gap: the area between the two lines.
  const back = spec.b
    .map((v, i) => [i, v] as const)
    .reverse()
    .map(([i, v]) => `L${r1(x(i))} ${r1(y(v))}`)
    .join('');
  out.push(`<path d="${path(spec.a)}${back}Z" fill="${GAP_FILL}" stroke="none"/>`);

  if (spec.threshold) {
    const t = spec.threshold;
    out.push(
      `<path d="M${PLOT.left} ${r1(y(t.level))}H${PLOT.right}" stroke="${MUTED}" stroke-width="1" stroke-dasharray="4 4"/>`,
    );
    // A's label sits left of its line and B's right of its own, so two close
    // settle points never print on top of each other.
    for (const [ply, color, side] of [
      [t.settledA, ENGINE_A_COLOR, 'end'],
      [t.settledB, ENGINE_B_COLOR, 'start'],
    ] as const) {
      if (ply === null) continue;
      const lx = x(ply) + (side === 'end' ? -3 : 3);
      out.push(
        `<path d="M${r1(x(ply))} ${PLOT.top}V${PLOT.bottom}" stroke="${color}" stroke-width="1.2" stroke-dasharray="2 3"/>`,
        `<text x="${r1(lx)}" y="${PLOT.bottom - 5}" text-anchor="${side}" font-family="${FONT}" font-size="11" font-weight="700" fill="${color}" translate="no">${label(ply)}</text>`,
      );
    }
  }

  out.push(
    `<path d="${path(spec.b)}" fill="none" stroke="${ENGINE_B_COLOR}" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="${path(spec.a)}" fill="none" stroke="${ENGINE_A_COLOR}" stroke-width="2.2" stroke-linejoin="round"/>`,
  );

  if (spec.lineLabels) {
    // Each name on the outer side of its line, so the two never touch.
    const { at, a, b } = spec.lineLabels;
    const aHigh = spec.a[at]! >= spec.b[at]!;
    for (const [v, color, name, above] of [
      [spec.a[at]!, ENGINE_A_COLOR, a, aHigh],
      [spec.b[at]!, ENGINE_B_COLOR, b, !aHigh],
    ] as const) {
      out.push(
        `<text x="${r1(x(at))}" y="${r1(y(v) + (above ? -7 : 15))}" font-family="${FONT}" font-size="12" font-weight="700" fill="${color}">${name}</text>`,
      );
    }
  }

  for (const c of spec.callouts ?? []) {
    const cx = x(c.ply);
    const cy = y((c.on === 'a' ? spec.a : spec.b)[c.ply]!);
    const ty = y(c.level);
    const tx = cx + (c.side === 'left' ? -6 : 6);
    const lastY = ty + 14 * (c.lines.length - 1);
    out.push(
      `<path d="M${r1(cx)} ${r1(Math.min(cy, ty - 12))}V${r1(Math.max(cy, lastY + 4))}" stroke="${MUTED}" stroke-width="1"/>`,
      `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="4" fill="${c.on === 'a' ? ENGINE_A_COLOR : ENGINE_B_COLOR}" stroke="${PANEL}" stroke-width="1.5"/>`,
    );
    c.lines.forEach((line, k) =>
      out.push(
        `<text x="${r1(tx)}" y="${r1(ty + 14 * k)}" text-anchor="${c.side === 'left' ? 'end' : 'start'}" font-family="${FONT}" font-size="${k ? 11 : 12}" font-weight="${k ? 400 : 700}" fill="${k ? MUTED : INK}">${line}</text>`,
      ),
    );
  }

  for (const m of spec.marks ?? []) {
    const i = Math.min(n - 1, m.ply);
    out.push(
      `<text x="${r1(x(i))}" y="${PLOT.top - 2}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="700" fill="var(--judgment-mistake, #eb7500)" translate="no">${m.glyph}</text>`,
    );
  }

  // Hover: one column per position, a language-neutral readout.
  const slot = (PLOT.right - PLOT.left) / (n - 1);
  for (let i = 0; i < n; i += 1) {
    out.push(
      `<rect x="${r1(x(i) - slot / 2)}" y="${PLOT.top}" width="${r1(slot)}" height="${PLOT.bottom - PLOT.top}" fill="transparent"><title translate="no">${label(i)} · ${spec.nameA} ${pct(spec.a[i]!)} · ${spec.nameB} ${pct(spec.b[i]!)}</title></rect>`,
    );
  }
  out.push('</svg>');
  return out.join('');
}
