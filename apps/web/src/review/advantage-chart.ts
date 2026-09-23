// Advantage chart for the review board's underboard slot (P3.5). A win%-per-ply
// curve over a red/black split field: above the midline Red is favoured, below it
// Black. The advantage area is filled in the leading side's colour (the curve
// clipped against each half), lichess-style. Click anywhere to jump to that ply;
// a cursor marks the current ply. Win% (bounded, mate-aware) is used instead of
// raw cp so mates don't spike the axis.
import { winPercent } from '@mistboard/game';
import '../seat-disc-ink.css';
import './advantage-chart.css';
import { formatEval } from './engine/eval-format.js';
import type { GamePhases, PlyEval } from './game-analysis.js';
import { type ReviewSeatColors, reviewColorForSeat } from './review-seat-colors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 300;
const VIEW_H = 100;
/** Vertical breathing room, in view units, kept outside the plotted band at both
 *  ends. A forced mate is win% 0 or 100, which without this lands exactly ON the
 *  frame edge and gets half its stroke clipped — the one eval you most want to
 *  see reads as a cut-off line. lichess reserves the same margin by plotting
 *  into +/-1 on a +/-1.05 axis. */
const PAD_Y = 4;
/** Half a hairline in view units at the width this chart actually renders, so the
 *  cursor at ply 0 or at the final ply draws inside the frame instead of losing
 *  half its stroke to the edge. */
const EDGE_INSET = 0.6;

/** Unique clip-path ids per mounted chart (re-mounts must not collide). */
let chartInstance = 0;

export interface AdvantageChart {
  el: HTMLElement;
  setPly(ply: number): void;
  /** Overlay the decision-vs-luck "ghost" line (chance variants only). `redLuckByPly` is the
   *  per-ply luck in RED-POV win points (a reveal by black flips sign). Draws a dashed "if
   *  reveals ran average" line = realized minus cumulative luck, plus a shaded band whose gap is
   *  the cumulative luck, plus a legend. Safe to call once decisions load. */
  setLuckOverlay(redLuckByPly: ReadonlyMap<number, number>): void;
  /** Ring the plies of one judgment class ON the curve (lichess: hovering "4
   *  Inaccuracies" lights those four points in the inaccuracy colour). An empty
   *  list clears the marks. The marks are transient hover ink, so they sit above
   *  the curve and never persist past the hover that asked for them. */
  setMarks(marks: readonly AdvantageChartMark[]): void;
}

/** One highlighted ply and the judgment tone that colours it. */
export type AdvantageChartMark = { ply: number; tone: 'inaccuracy' | 'mistake' | 'blunder' };

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function createAdvantageChart(
  evals: PlyEval[],
  opts: {
    onJump: (ply: number) => void;
    seatColors?: ReviewSeatColors;
    /** Phase boundaries → vertical dividers + rotated Opening/Middlegame/Endgame
     *  labels (lichess). Omitted or empty = no phase chrome. */
    phases?: GamePhases;
    /** Move text for the position at `ply` (e.g. "12... h10-i10"), shown in the
     *  hover readout above the eval. Omitted = the readout shows the eval alone. */
    moveLabel?: (ply: number) => string | null;
  },
): AdvantageChart {
  const maxPly = Math.max(1, evals.length - 1);
  const xOf = (ply: number) => (ply / maxPly) * VIEW_W;
  const yFor = (win: number) => PAD_Y + (1 - win / 100) * (VIEW_H - 2 * PAD_Y);
  const yOf = (e: PlyEval) => yFor(winPercent(e.cp, e.mate));

  const el = document.createElement('section');
  el.className = 'advantage-chart';
  // The plot area is its own positioning context. The phase labels and the hover
  // readout are placed against the FRAME, not against the component, and the
  // component also carries the luck legend below it — anchoring to `el` would put
  // a bottom-aligned readout on top of that legend.
  const plot = document.createElement('div');
  plot.className = 'advantage-chart__plot';
  el.append(plot);
  const firstColor = reviewColorForSeat('red', opts.seatColors);
  const secondColor = reviewColorForSeat('black', opts.seatColors);
  // The two halves are inked independently, and on the dark theme each ink is
  // lifted on its own so it does not vanish against the panel. For the chess
  // pairing both lifts land on cream and the halves become indistinguishable
  // (measured 1.28:1 on a live game). Mark the pairing so the CSS can separate
  // them without guessing at a sibling.
  if (firstColor === 'white' && secondColor === 'black') {
    el.classList.add('advantage-chart--white-black');
  }

  const chart = svg('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: 'none',
    class: 'advantage-chart__svg',
  });

  // One clip rect per half: the SAME advantage polygon renders twice, clipped to
  // the red (top) and black (bottom) halves, so each side's advantage fills in
  // that side's colour.
  chartInstance += 1;
  const redClipId = `advantage-chart-red-${chartInstance}`;
  const blackClipId = `advantage-chart-black-${chartInstance}`;
  const defs = svg('defs', {});
  const redClip = svg('clipPath', { id: redClipId });
  redClip.append(svg('rect', { x: '0', y: '0', width: `${VIEW_W}`, height: `${VIEW_H / 2}` }));
  const blackClip = svg('clipPath', { id: blackClipId });
  blackClip.append(
    svg('rect', { x: '0', y: `${VIEW_H / 2}`, width: `${VIEW_W}`, height: `${VIEW_H / 2}` }),
  );
  // Each half's ground fades OUT from the midline rather than filling flat. Flat
  // per-half tints turned the chart into two stacked blocks with a hard seam at
  // the midline, which is the shape the eye reads first and it is not the data;
  // fading from the axis leaves one continuous field while still saying which
  // half belongs to whom before either side is ahead. lichess can skip the cue
  // entirely (white is always on top); our flip variants bind seats at runtime,
  // so we keep it and spend almost no ink on it.
  const redZoneId = `advantage-chart-zone-red-${chartInstance}`;
  const blackZoneId = `advantage-chart-zone-black-${chartInstance}`;
  const zoneGradient = (id: string, fromMidUp: boolean): SVGElement => {
    const grad = svg('linearGradient', {
      id,
      gradientUnits: 'userSpaceOnUse',
      x1: '0',
      y1: `${VIEW_H / 2}`,
      x2: '0',
      y2: fromMidUp ? '0' : `${VIEW_H}`,
    });
    grad.append(
      svg('stop', { offset: '0', class: 'advantage-chart__zone-stop--near' }),
      svg('stop', { offset: '1', class: 'advantage-chart__zone-stop--far' }),
    );
    return grad;
  };
  const redZone = zoneGradient(redZoneId, true);
  const blackZone = zoneGradient(blackZoneId, false);
  redZone.classList.add('advantage-chart__zone', `advantage-chart__zone--${firstColor}`);
  blackZone.classList.add('advantage-chart__zone', `advantage-chart__zone--${secondColor}`);
  defs.append(redClip, blackClip, redZone, blackZone);

  chart.append(
    defs,
    svg('rect', {
      x: '0',
      y: '0',
      width: `${VIEW_W}`,
      height: `${VIEW_H / 2}`,
      fill: `url(#${redZoneId})`,
    }),
    svg('rect', {
      x: '0',
      y: `${VIEW_H / 2}`,
      width: `${VIEW_W}`,
      height: `${VIEW_H / 2}`,
      fill: `url(#${blackZoneId})`,
    }),
  );

  // The axis and the phase dividers draw ABOVE the advantage fills. The fills are
  // opaque, so anything under them is simply gone — which is what happened to the
  // zero line and the Opening/Middlegame/Endgame dividers the moment they became
  // solid. Appended further down, after the fills.
  const axis = svg('g', { class: 'advantage-chart__axis' });
  axis.append(
    svg('line', {
      x1: '0',
      y1: `${VIEW_H / 2}`,
      x2: `${VIEW_W}`,
      y2: `${VIEW_H / 2}`,
      class: 'advantage-chart__mid',
    }),
  );

  // Game-phase dividers + rotated segment labels (lichess). Divider lines live in
  // the SVG (under the curve); labels are HTML overlays — the SVG is stretched
  // non-uniformly (preserveAspectRatio none), so rotated SVG text would distort.
  // A game with no detected middlegame gets no phase chrome at all.
  if (opts.phases?.middle && opts.phases.middle <= maxPly) {
    const marks: { ply: number; label: string }[] = [{ ply: 0, label: 'Opening' }];
    marks.push({ ply: opts.phases.middle, label: 'Middlegame' });
    if (opts.phases.end && opts.phases.end <= maxPly) {
      marks.push({ ply: opts.phases.end, label: 'Endgame' });
    }
    for (const mark of marks) {
      if (mark.ply > 0) {
        axis.append(
          svg('line', {
            x1: `${xOf(mark.ply).toFixed(1)}`,
            y1: '0',
            x2: `${xOf(mark.ply).toFixed(1)}`,
            y2: `${VIEW_H}`,
            class: 'advantage-chart__phase',
          }),
        );
      }
      const label = document.createElement('span');
      label.className = 'advantage-chart__phase-label';
      label.style.left = `${((mark.ply / maxPly) * 100).toFixed(2)}%`;
      label.textContent = mark.label;
      plot.append(label);
    }
  }

  // Filled area between the curve and the midline (once per colour half), then
  // the curve on top.
  const points = evals.map((e) => `${xOf(e.ply).toFixed(1)},${yOf(e).toFixed(1)}`);
  const areaPoints = `0,${VIEW_H / 2} ${points.join(' ')} ${VIEW_W},${VIEW_H / 2}`;
  const areaRed = svg('polygon', {
    points: areaPoints,
    'clip-path': `url(#${redClipId})`,
    class: `advantage-chart__area advantage-chart__area--${firstColor}`,
  });
  const areaBlack = svg('polygon', {
    points: areaPoints,
    'clip-path': `url(#${blackClipId})`,
    class: `advantage-chart__area advantage-chart__area--${secondColor}`,
  });
  const line = svg('polyline', { points: points.join(' '), class: 'advantage-chart__line' });
  const cursor = svg('line', {
    x1: '0',
    y1: '0',
    x2: '0',
    y2: `${VIEW_H}`,
    class: 'advantage-chart__cursor',
  });
  // Luck overlay layers (populated by setLuckOverlay when decisions load). The band sits UNDER
  // the realized line/cursor; the ghost line sits just under the cursor so the real line reads as
  // primary. Kept as stable nodes so a re-call just rewrites their points.
  // Marks the hovered ply ON the curve, so the readout is anchored to a point
  // rather than floating over the field.
  const dot = svg('circle', { r: '2.6', cx: '0', cy: '0', class: 'advantage-chart__dot' });
  const luckBand = svg('polygon', { points: '', class: 'advantage-chart__luck-band' });
  const ghostLine = svg('polyline', { points: '', class: 'advantage-chart__ghost' });
  // Judgment marks (summary hover): a group of rings rewritten by setMarks.
  const marks = svg('g', { class: 'advantage-chart__marks' });
  // The luck band sits OVER the fills for the same reason the axis does: it is a
  // translucent overlay meant to be read against them, and opaque fills would
  // swallow it where it matters most (jieqi, where the reveal swings are large).
  chart.append(areaRed, areaBlack, luckBand, axis, ghostLine, line, cursor, marks, dot);
  plot.append(chart);

  // Hover readout (lichess: the chart scrubs under the pointer and names the move
  // it is over, so you can read the game's shape without clicking through it).
  const tip = document.createElement('div');
  tip.className = 'advantage-chart__tip';
  tip.hidden = true;
  plot.append(tip);

  // Legend (hidden until the luck overlay is set): explains solid vs dashed.
  const legend = document.createElement('div');
  legend.className = 'advantage-chart__legend';
  legend.hidden = true;
  legend.innerHTML =
    '<span class="advantage-chart__legend-item"><span class="advantage-chart__legend-swatch advantage-chart__legend-swatch--real"></span>Your line</span>' +
    '<span class="advantage-chart__legend-item"><span class="advantage-chart__legend-swatch advantage-chart__legend-swatch--ghost"></span>If reveals ran average</span>';
  el.append(legend);

  /** Nearest ply under a client x, or null when the chart has no layout yet
   *  (offscreen, or a jsdom test). */
  function plyAtClientX(clientX: number): number | null {
    const box = chart.getBoundingClientRect();
    if (box.width === 0) return null;
    const frac = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return Math.round(frac * maxPly);
  }

  el.addEventListener('click', (event) => {
    const ply = plyAtClientX(event.clientX);
    if (ply != null) opts.onJump(ply);
  });

  /** `selectedPly` is where the board actually is; the cursor borrows it while a
   *  pointer is over the chart and gets it back on the way out. Without the
   *  split, a hover would silently redefine "current ply" and the cursor would
   *  come to rest wherever the pointer happened to leave. */
  chart.addEventListener('pointermove', (event) => {
    const ply = plyAtClientX(event.clientX);
    if (ply == null) return;
    moveCursor(ply);
    showTip(ply);
  });
  chart.addEventListener('pointerleave', () => {
    moveCursor(selectedPly);
    tip.hidden = true;
    dot.classList.remove('advantage-chart__dot--on');
  });

  function showTip(ply: number): void {
    const point = evals[ply];
    if (!point) return;
    dot.setAttribute('cx', xOf(point.ply).toFixed(2));
    dot.setAttribute('cy', yOf(point).toFixed(2));
    dot.classList.add('advantage-chart__dot--on');

    // Same formatter as the move list's eval column right beside the chart: two
    // readings of one number must not disagree about its scale.
    const score = formatEval(point.cp, point.mate);
    const move = opts.moveLabel?.(ply) ?? null;
    tip.replaceChildren();
    if (move) {
      const label = document.createElement('span');
      label.className = 'advantage-chart__tip-move';
      label.textContent = move;
      tip.append(label);
    }
    const value = document.createElement('span');
    value.className = 'advantage-chart__tip-eval';
    value.textContent = score;
    tip.append(value);
    tip.hidden = false;
    // Anchor to the cursor, and slide the box back over itself as it approaches
    // the right edge so it stays inside the frame without a measure-and-clamp.
    const bias = ply / maxPly;
    tip.style.left = `${(bias * 100).toFixed(3)}%`;
    tip.style.transform = `translateX(${(-bias * 100).toFixed(1)}%)`;
    // Sit in the half the curve is NOT in. Pinned to the top, the readout covered
    // the very peaks it was there to explain.
    tip.classList.toggle('advantage-chart__tip--low', yOf(point) < VIEW_H / 2);
  }

  let selectedPly = 0;

  function moveCursor(ply: number): void {
    const raw = xOf(Math.max(0, Math.min(maxPly, ply)));
    const x = `${Math.max(EDGE_INSET, Math.min(VIEW_W - EDGE_INSET, raw)).toFixed(2)}`;
    cursor.setAttribute('x1', x);
    cursor.setAttribute('x2', x);
  }

  function setPly(ply: number): void {
    selectedPly = ply;
    moveCursor(ply);
  }

  function setLuckOverlay(redLuckByPly: ReadonlyMap<number, number>): void {
    // Ghost = realized win% MINUS the cumulative red-POV luck up to each ply — i.e. the
    // trajectory if every reveal had come out at its average. The per-ply luck is added at the
    // ply the reveal lands on (that ply's realized win% already includes it). Additive-in-win%
    // is an approximation (win% is non-linear), but it's the standard, legible luck-adjusted
    // curve. If no reveal ever moved the needle, skip the overlay entirely.
    if (![...redLuckByPly.values()].some((v) => Math.abs(v) > 0.05)) return;
    let cumulative = 0;
    const ghostPoints: string[] = [];
    for (const e of evals) {
      cumulative += redLuckByPly.get(e.ply) ?? 0;
      const ghostWin = Math.max(0, Math.min(100, winPercent(e.cp, e.mate) - cumulative));
      ghostPoints.push(`${xOf(e.ply).toFixed(1)},${yFor(ghostWin).toFixed(1)}`);
    }
    ghostLine.setAttribute('points', ghostPoints.join(' '));
    // Band between the realized line and the ghost line: realized forward, ghost back.
    luckBand.setAttribute('points', `${points.join(' ')} ${[...ghostPoints].reverse().join(' ')}`);
    legend.hidden = false;
  }

  function setMarks(next: readonly AdvantageChartMark[]): void {
    marks.replaceChildren();
    for (const mark of next) {
      const point = evals[mark.ply];
      if (!point) continue;
      marks.append(
        svg('circle', {
          r: '2.4',
          cx: xOf(point.ply).toFixed(2),
          cy: yOf(point).toFixed(2),
          class: `advantage-chart__mark advantage-chart__mark--${mark.tone}`,
        }),
      );
    }
    el.classList.toggle('advantage-chart--marked', next.length > 0);
  }

  return { el, setPly, setLuckOverlay, setMarks };
}
