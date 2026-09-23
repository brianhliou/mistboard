// Per-player accuracy summary for the review board's analysisSummary slot (P3.5),
// matching lichess's analyse ACC block anatomy: a centered player row, then two
// columns — judgment counts + ACPL on the left, Accuracy plus per-phase accuracy
// (Opening / Middlegame / Endgame) on the right, tone-coloured by value. Anonymous
// games have no names, so sides are labelled Red / Black.
//
// The judgment counts are LIVE (lichess roundTraining): hovering "4 Inaccuracies"
// lights those plies on the advantage chart, clicking jumps to the next one after
// the current position and cycles. Between the two players sits the "Learn from
// your mistakes" button (retro mode) when the surface offers it.
import '../seat-disc-ink.css';
import './analysis-summary.css';
import type { MoveJudgment } from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import {
  type GameAnalysis,
  type GamePhases,
  type PhaseAccuracies,
  type PlayerAnalysis,
  playerPhaseAccuracies,
} from './game-analysis.js';
import { type ReviewInk, type ReviewSeatColors, reviewColorForSeat } from './review-seat-colors.js';

/** Optional real player names; fall back to the side colors for anonymous games. */
export type AnalysisSummaryLabels = { red?: string; black?: string };

export type SummaryJudgment = Exclude<MoveJudgment, null>;

export type AnalysisSummaryOptions = {
  /** Hide the ACPL row. Chance/hidden-info variants (jieqi) set this: centipawn loss can't be
   *  luck-stripped, so it reads as noise next to the luck-free accuracy + counts. */
  hideAcpl?: boolean;
  /** Visual ink for each analysis seat. Stats and labels remain seat-keyed. */
  seatColors?: ReviewSeatColors;
  /** Phase boundaries → per-phase accuracy rows in the right column (lichess
   *  "96% Opening"). Omitted = the right column shows only the headline accuracy. */
  phases?: GamePhases;
  /** Live judgment rows. `hover` fires with the row under the pointer and with
   *  null on leave; `jump` fires on click. Rows with a zero count stay inert. */
  onJudgment?: {
    hover(side: 'red' | 'black', judgment: SummaryJudgment | null): void;
    jump(side: 'red' | 'black', judgment: SummaryJudgment): void;
  };
  /** "Learn from your mistakes" button between the two players (lichess). Omitted =
   *  no button (a variant with no retro mode, or a study). */
  onLearn?: () => void;
  /** Whether retro mode is currently open: the button renders pressed. */
  learnActive?: boolean;
};

export function createAnalysisSummary(
  analysis: GameAnalysis,
  labels?: AnalysisSummaryLabels,
  options?: AnalysisSummaryOptions,
): HTMLElement {
  const el = document.createElement('section');
  el.className = 'analysis-summary';
  const hideAcpl = options?.hideAcpl ?? false;
  const firstColor = reviewColorForSeat('red', options?.seatColors);
  const secondColor = reviewColorForSeat('black', options?.seatColors);
  const phasesFor = (mover: 'red' | 'black'): PhaseAccuracies =>
    options?.phases ? playerPhaseAccuracies(analysis, options.phases, mover) : {};
  el.append(
    playerBlock(
      labels?.red || colorLabel(firstColor),
      firstColor,
      'red',
      analysis.red,
      hideAcpl,
      phasesFor('red'),
      options?.onJudgment,
    ),
  );
  if (options?.onLearn) el.append(learnButton(options.onLearn, options.learnActive ?? false));
  el.append(
    playerBlock(
      labels?.black || colorLabel(secondColor),
      secondColor,
      'black',
      analysis.black,
      hideAcpl,
      phasesFor('black'),
      options?.onJudgment,
    ),
  );
  return el;
}

function colorLabel(color: ReviewInk): string {
  if (color === 'white') return t('summary.white');
  return color === 'red' ? t('summary.red') : t('summary.black');
}

function learnButton(onLearn: () => void, active: boolean): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'analysis-summary__learn';
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
  const icon = document.createElement('span');
  icon.className = 'analysis-summary__learn-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const label = document.createElement('span');
  label.textContent = t('summary.learnFromMistakes');
  button.append(icon, label);
  button.addEventListener('click', onLearn);
  return button;
}

function playerBlock(
  label: string,
  // The INK the dot paints (chess's first seat is White) ...
  color: ReviewInk,
  // ... and the analysis SLOT the stats and judgment callbacks are keyed by.
  side: 'red' | 'black',
  player: PlayerAnalysis,
  hideAcpl: boolean,
  phases: PhaseAccuracies,
  onJudgment: AnalysisSummaryOptions['onJudgment'],
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'analysis-summary__player';

  const head = document.createElement('div');
  head.className = 'analysis-summary__head';
  const dot = document.createElement('span');
  dot.className = `analysis-summary__dot analysis-summary__dot--${color}`;
  const name = document.createElement('span');
  name.className = 'analysis-summary__name';
  name.textContent = label;
  head.append(dot, name);

  // Left column: judgment counts + ACPL (lichess order).
  const stats = document.createElement('div');
  stats.className = 'analysis-summary__stats';
  const judgmentRow = (
    count: number,
    judgment: SummaryJudgment,
    one: string,
    many: string,
  ): HTMLElement => {
    const live = count > 0 && onJudgment ? { side, judgment, ...onJudgment } : null;
    return statRow(String(count), plural(count, one, many), count > 0 ? judgment : null, live);
  };
  stats.append(
    judgmentRow(
      player.inaccuracies,
      'inaccuracy',
      t('summary.inaccuracyOne'),
      t('summary.inaccuracyMany'),
    ),
    judgmentRow(player.mistakes, 'mistake', t('summary.mistakeOne'), t('summary.mistakeMany')),
    judgmentRow(player.blunders, 'blunder', t('summary.blunderOne'), t('summary.blunderMany')),
  );
  if (!hideAcpl) {
    stats.append(statRow(String(player.acpl), t('summary.acpl'), null, null));
  }

  // Right column: headline accuracy over the per-phase accuracies.
  const acc = document.createElement('div');
  acc.className = 'analysis-summary__phases';
  acc.append(phaseRow(player.accuracy, t('summary.accuracy'), true));
  const phaseEntries: Array<[number | undefined, string]> = [
    [phases.opening, t('summary.opening')],
    [phases.middlegame, t('summary.middlegame')],
    [phases.endgame, t('summary.endgame')],
  ];
  for (const [value, phaseLabel] of phaseEntries) {
    if (value !== undefined) acc.append(phaseRow(value, phaseLabel, false));
  }

  const cols = document.createElement('div');
  cols.className = 'analysis-summary__cols';
  cols.append(stats, acc);
  block.append(head, cols);
  return block;
}

type LiveRow = {
  side: 'red' | 'black';
  judgment: SummaryJudgment;
  hover(side: 'red' | 'black', judgment: SummaryJudgment | null): void;
  jump(side: 'red' | 'black', judgment: SummaryJudgment): void;
};

function statRow(
  value: string,
  label: string,
  judgment: string | null,
  live: LiveRow | null,
): HTMLElement {
  // A live row is a real button (keyboard reachable, announces as a control);
  // an inert row stays a plain div so a "0 Blunders" line is not a dead control.
  const row = document.createElement(live ? 'button' : 'div');
  row.className = 'analysis-summary__stat';
  if (judgment) row.classList.add(`analysis-summary__stat--${judgment}`);
  if (live && row instanceof HTMLButtonElement) {
    row.type = 'button';
    row.classList.add('analysis-summary__stat--live');
    row.dataset.side = live.side;
    row.dataset.judgment = live.judgment;
    row.title = t('summary.judgmentRowHint');
    row.addEventListener('mouseenter', () => live.hover(live.side, live.judgment));
    row.addEventListener('mouseleave', () => live.hover(live.side, null));
    row.addEventListener('focus', () => live.hover(live.side, live.judgment));
    row.addEventListener('blur', () => live.hover(live.side, null));
    row.addEventListener('click', () => live.jump(live.side, live.judgment));
  }
  const num = document.createElement('strong');
  num.className = 'analysis-summary__stat-value';
  num.textContent = value;
  const text = document.createElement('span');
  text.className = 'analysis-summary__stat-label';
  text.textContent = label;
  row.append(num, text);
  return row;
}

function phaseRow(value: number, label: string, headline: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'analysis-summary__phase';
  if (headline) row.classList.add('analysis-summary__phase--headline');
  else row.classList.add(`analysis-summary__phase--${accuracyTone(value)}`);
  const num = document.createElement('strong');
  num.className = 'analysis-summary__phase-value';
  num.textContent = `${Math.round(value)}%`;
  const text = document.createElement('span');
  text.className = 'analysis-summary__phase-label';
  text.textContent = label;
  row.append(num, text);
  return row;
}

/** Tone bucket for a phase accuracy (lichess colours its phase rows by value). */
function accuracyTone(value: number): 'high' | 'mid' | 'low' | 'poor' {
  if (value >= 90) return 'high';
  if (value >= 75) return 'mid';
  if (value >= 50) return 'low';
  return 'poor';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
