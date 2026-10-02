// What each of one side's moves cost it, by an analysing engine's count: one
// bar per move, the chances it gave away. Built for the AB-JChess post, where
// AB-JChess grades Pikafish's moves; the numbers and marks are the review
// page's own (the stored server analysis), so the chart and the linked review
// agree. Bars carry the review's judgment colours, so a ?? here is a ?? there.

export type MoveCostMark = '??' | '?' | '?!' | null;

export type MoveCost = {
  /** Full move number (1-based) of the move. */
  moveNo: number;
  /** Chances the mover gave away, 0..1. */
  loss: number;
  mark: MoveCostMark;
};

export type MoveCostSpec = {
  id: string;
  /** Read for screen readers; a dictionary key on the zh pages. */
  ariaLabel: string;
  /** Heading over the plot; a dictionary key on the zh pages. */
  heading: string;
  /** Last full move on the x axis. */
  lastMove: number;
  moves: ReadonlyArray<MoveCost>;
  /** Labels one bar, the move the paragraph above is about. */
  callout?: { moveNo: number; label: string };
};

const W = 640;
const H = 230;
const PLOT = { left: 40, right: W - 14, top: 40, bottom: H - 40 };
const FONT = 'Roboto, system-ui, sans-serif';
const INK = 'var(--site-text, #4d4a47)';
const MUTED = 'var(--site-muted, #79766f)';
const RULE = 'var(--site-border, #d8d5cf)';
const RULE_SOFT = 'var(--site-border-soft, #e4e1dc)';
// The review's judgment palette (review CSS --judgment-*); unmarked moves are
// neutral so only the marked ones carry colour.
const MARK_COLOR: Record<Exclude<MoveCostMark, null>, string> = {
  '??': 'var(--judgment-blunder, #e5222c)',
  '?': 'var(--judgment-mistake, #eb7500)',
  '?!': 'var(--judgment-inaccuracy, #c29100)',
};
const QUIET = 'var(--move-cost-quiet, #b9b5ad)';

const r1 = (n: number): string => (Math.round(n * 10) / 10).toString();

export function moveCostChartSvg(spec: MoveCostSpec): string {
  const { lastMove, moves } = spec;
  if (moves.length === 0) throw new Error(`move-cost ${spec.id}: no moves`);
  const maxLoss = Math.max(...moves.map((m) => m.loss));
  // y top: the next 20% step over the worst move, at least 40%.
  const yMax = Math.max(0.4, Math.ceil((maxLoss + 0.0001) / 0.2) * 0.2);
  const slot = (PLOT.right - PLOT.left) / lastMove;
  const barW = Math.max(2, Math.min(18, slot * 0.62));
  const cx = (moveNo: number): number => PLOT.left + (moveNo - 0.5) * slot;
  const y = (loss: number): number =>
    PLOT.bottom - (Math.min(loss, yMax) / yMax) * (PLOT.bottom - PLOT.top);

  const out: string[] = [
    `<svg class="move-cost-chart" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${spec.id}-title">`,
    `<title id="${spec.id}-title">${spec.ariaLabel}</title>`,
    `<text x="${PLOT.left}" y="18" font-family="${FONT}" font-size="12.5" font-weight="700" fill="${INK}">${spec.heading}</text>`,
  ];

  // Grid every 20 points, labelled; 0 is the baseline rule.
  for (let p = 0.2; p <= yMax + 1e-9; p += 0.2) {
    out.push(
      `<path d="M${PLOT.left} ${r1(y(p))}H${PLOT.right}" stroke="${RULE_SOFT}" stroke-width="1"/>`,
      `<text x="${PLOT.left - 6}" y="${r1(y(p) + 4)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">${Math.round(p * 100)}%</text>`,
    );
  }
  out.push(
    `<path d="M${PLOT.left} ${PLOT.bottom}H${PLOT.right}" stroke="${RULE}" stroke-width="1"/>`,
    `<text x="${PLOT.left - 6}" y="${PLOT.bottom + 4}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">0</text>`,
  );

  const step = lastMove > 40 ? 10 : 5;
  for (let m = step; m <= lastMove; m += step) {
    out.push(
      `<text x="${r1(cx(m))}" y="${PLOT.bottom + 17}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${MUTED}">${m}</text>`,
    );
  }
  out.push(
    `<text x="${PLOT.right}" y="${H - 6}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${MUTED}">Move</text>`,
  );

  for (const m of moves) {
    // A move that cost (next to) nothing still gets a mark, so every move
    // the side played is visible and a gap never reads as a missing move.
    if (m.loss < 0.01 && !m.mark) {
      out.push(
        `<circle cx="${r1(cx(m.moveNo))}" cy="${PLOT.bottom - 3}" r="2.5" fill="${QUIET}"/>`,
      );
      continue;
    }
    const h = Math.max(3, PLOT.bottom - y(m.loss));
    const x = cx(m.moveNo) - barW / 2;
    const fill = m.mark ? MARK_COLOR[m.mark] : QUIET;
    const top = PLOT.bottom - h;
    // Rounded at the data end only.
    const rad = Math.min(3, barW / 2, h);
    out.push(
      `<path d="M${r1(x)} ${PLOT.bottom}V${r1(top + rad)}Q${r1(x)} ${r1(top)} ${r1(x + rad)} ${r1(top)}H${r1(x + barW - rad)}Q${r1(x + barW)} ${r1(top)} ${r1(x + barW)} ${r1(top + rad)}V${PLOT.bottom}Z" fill="${fill}"/>`,
    );
    if (m.mark) {
      out.push(
        `<text x="${r1(cx(m.moveNo))}" y="${r1(top - 5)}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${INK}" translate="no">${m.mark}</text>`,
      );
    }
  }

  if (spec.callout) {
    const m = moves.find((v) => v.moveNo === spec.callout?.moveNo);
    if (!m) throw new Error(`move-cost ${spec.id}: callout move ${spec.callout.moveNo} not charted`);
    const x = cx(m.moveNo);
    const anchor = x > PLOT.right - 90 ? 'end' : x < PLOT.left + 90 ? 'start' : 'middle';
    const labelY = y(m.loss) - (m.mark ? 20 : 6);
    out.push(
      `<text x="${r1(x + (anchor === 'end' ? 6 : anchor === 'start' ? -6 : 0))}" y="${r1(Math.max(PLOT.top - 8, labelY))}" text-anchor="${anchor}" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${INK}">${spec.callout.label}</text>`,
    );
  }

  // Hover: one column per move, a language-neutral readout.
  for (const m of moves) {
    out.push(
      `<rect x="${r1(cx(m.moveNo) - slot / 2)}" y="${PLOT.top}" width="${r1(slot)}" height="${PLOT.bottom - PLOT.top}" fill="transparent"><title translate="no">${m.moveNo} · −${Math.round(m.loss * 100)}%${m.mark ? ` ${m.mark}` : ''}</title></rect>`,
    );
  }

  out.push('</svg>');
  return out.join('');
}
