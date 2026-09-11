// The review board's local-engine widget (fills mountReviewLayout's `enginePanel`
// slot). Owns a ceval handle, a lichess-style head (on/off switch, headline eval,
// engine name + status), and up to MultiPV principal-variation lines. Position is
// pushed in via setPosition() from the postgame's ply navigation; scores are
// normalised to Red's POV so the eval reads the same regardless of whose turn it is.
// Before a flip game binds ink ownership, the same seat is labelled P1 instead.
import { t } from '../../i18n/catalog.js';
import { gearIconSvg } from '../../theme.js';
import {
  type CevalEffort,
  type CevalHandle,
  type CevalLine,
  type CevalUpdate,
  type CevalVariant,
  cevalEngineName,
  cevalSupported,
  cevalSupportsInfinite,
  createCeval,
} from './ceval.js';
import './engine-panel.css';
import type { EvalBar } from './eval-bar.js';
import { formatEval, formatMistyEval } from './eval-format.js';
import { isMistyCevalVariant } from './misty-ceval.js';

export interface EnginePanel {
  el: HTMLElement;
  /** Push the current position. Without `initialFen` the moves replay from the
   *  standard start position; pass `initialFen` to analyse a mid-game base
   *  position (e.g. a puzzle) with `movesUci` applied on top. `searchable`
   *  is false for a terminal position whose engine has no move to search. */
  setPosition(movesUci: string[], initialFen?: string, searchable?: boolean): void;
  /** Drive the arrow toggle from outside the popover (the `a` shortcut), keeping
   *  the checkbox in sync. Fires onShowArrowsChange like a click would. */
  setShowArrows(next: boolean): void;
  /** Switch the engine on or off from outside the head (retro mode needs a
   *  search to grade a try). Fires onToggle like a click would; a no-op when
   *  the engine is unsupported in this browser or already in that state. */
  setOn(next: boolean): void;
  /** Whether this browser can run the local engine at all (Safari cannot). */
  supported: boolean;
  dispose(): void;
}

export interface EnginePanelOptions {
  /** Whether this variant's board can paint engine action indicators. Defaults true for
   *  direct consumers; generic review surfaces pass their explicit capability. */
  arrowsSupported?: boolean;
  variant: CevalVariant;
  multiPv?: number;
  maxDepth?: number;
  /** Prettify a PV move for display; defaults to the raw engine UCI. */
  formatPvMove?: (uci: string) => string;
  /** Optional on-board eval bar to drive in lockstep with the panel. */
  evalBar?: EvalBar;
  /** Fires with the latest MultiPV lines on every engine update, and with null
   *  whenever the output clears — toggle off, or a position change before new
   *  results arrive. Drives the on-board PV arrows. */
  onLines?: (lines: CevalLine[] | null) => void;
  /** Initial state of the "Best move indicators" toggle in the settings popover.
   *  The panel renders the control; the OWNER holds the flag and decides what it
   *  gates (the review surface also hides its whole-game best-move arrow). */
  showArrows?: boolean;
  /** Fires when the toggle changes, by click or via setShowArrows(). */
  onShowArrowsChange?: (enabled: boolean) => void;
  /** Fires when the local engine is switched on or off. The review surface pairs
   *  its whole-game analysis arrow WITH the local engine: the server's best-move
   *  arrow shows only while the engine is on, so a board with the engine off
   *  carries no derived ink at all. */
  onToggle?: (on: boolean) => void;
}

type Side = 'red' | 'black';
type ScorePerspective = 'bound' | 'first-player';

const DEBOUNCE_MS = 150;

// Switch-knob glyphs (✕ off / ✓ on), inline so the head renders without
// icon-font or asset dependencies. Lucide paths (MIT). The settings gear is the
// site-wide canonical gear (theme.ts gearIconSvg), not a one-off.
const KNOB_OFF_ICON =
  '<svg class="engine-panel__knob-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const KNOB_ON_ICON =
  '<svg class="engine-panel__knob-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export function createEnginePanel(opts: EnginePanelOptions): EnginePanel {
  const supported = cevalSupported(opts.variant);
  const engineName = cevalEngineName(opts.variant);
  // Mutable so the settings popover can retune them live.
  let multiPv = opts.multiPv ?? 3;
  const effortOptions: readonly CevalEffort[] = cevalSupportsInfinite(opts.variant)
    ? ['quick', 'standard', 'deep', 'max', 'infinite']
    : ['quick', 'standard', 'deep', 'max'];
  let effort: CevalEffort = effortForInitialDepth(opts.maxDepth);
  const formatMove = opts.formatPvMove ?? ((uci: string) => uci);

  const el = document.createElement('section');
  el.className = 'engine-panel';
  el.dataset.engineSupported = supported ? 'true' : 'false';

  // Lichess ceval head anatomy: [switch] [big eval] [name / status] … [gear].
  const head = document.createElement('div');
  head.className = 'engine-panel__head';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'engine-panel__switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', 'false');
  toggle.setAttribute('aria-label', t('engine.toggleLocal'));
  const knob = document.createElement('span');
  knob.className = 'engine-panel__switch-knob';
  knob.innerHTML = KNOB_OFF_ICON + KNOB_ON_ICON;
  toggle.append(knob);
  const evalLabel = document.createElement('strong');
  evalLabel.className = 'engine-panel__eval';
  evalLabel.textContent = '–';
  const id = document.createElement('div');
  id.className = 'engine-panel__id';
  const nameLabel = document.createElement('div');
  nameLabel.className = 'engine-panel__name';
  nameLabel.textContent = engineName;
  const sub = document.createElement('div');
  sub.className = 'engine-panel__sub';
  id.append(nameLabel, sub);
  const gear = document.createElement('button');
  gear.type = 'button';
  gear.className = 'engine-panel__gear';
  gear.setAttribute('aria-label', t('engine.settings'));
  gear.setAttribute('aria-expanded', 'false');
  gear.innerHTML = gearIconSvg(16);
  head.append(toggle, evalLabel, id, gear);

  // Settings dropdown (lichess ceval menu): labelled slider rows for MultiPV and
  // search depth, plus the on-board arrow toggle. Out of flow, so it overlays
  // the PV lines / move list below the head instead of pushing them down.
  // Retuning re-runs the current search if the engine is on.
  //
  // The arrow toggle lives HERE rather than in the board's settings menu because
  // it is the same concern as "Multiple lines" one row above: how many lines to
  // search, and whether to draw them. lichess splits them (ceval menu vs
  // analysis settings dialog) only because its arrow setting also governs
  // server-analysis and variation arrows, which we do not draw.
  const showArrowsToggle = document.createElement('input');
  const settings = document.createElement('div');
  settings.className = 'engine-panel__settings';
  settings.hidden = true;
  if (opts.arrowsSupported !== false) {
    settings.append(
      checkboxRow(
        t('engine.bestMoveIndicators'),
        showArrowsToggle,
        opts.showArrows ?? true,
        (enabled) => {
          opts.onShowArrowsChange?.(enabled);
        },
      ),
    );
  } else {
    showArrowsToggle.checked = opts.showArrows ?? true;
  }
  settings.append(
    sliderRow(
      t('engine.multipleLines'),
      { min: 1, max: 5, step: 1, value: multiPv },
      (value) => `${value} / 5`,
      (value) => {
        multiPv = value;
        if (on) evaluateNow();
      },
    ),
    sliderRow(
      t('engine.searchEffort'),
      {
        min: 0,
        max: effortOptions.length - 1,
        step: 1,
        value: effortOptions.indexOf(effort),
      },
      (value) => effortLabel(effortOptions[value] ?? 'standard'),
      (value) => {
        effort = effortOptions[value] ?? 'standard';
        if (on) evaluateNow();
      },
    ),
  );
  gear.addEventListener('click', () => {
    settings.hidden = !settings.hidden;
    gear.setAttribute('aria-expanded', settings.hidden ? 'false' : 'true');
  });

  const lines = document.createElement('ol');
  lines.className = 'engine-panel__lines';

  // Block wrapper so the absolutely-positioned settings dropdown anchors to the
  // head's bottom edge (as a direct flex child its static position would be the
  // panel's top, covering the head).
  const top = document.createElement('div');
  top.className = 'engine-panel__top';
  top.append(head, settings);
  el.append(top, lines);

  let handle: CevalHandle | null = null;
  let on = false;
  let currentMoves: string[] = [];
  let currentFen: string | undefined;
  let currentSearchable = true;
  // Side to move at the base position: startpos is Red, but an initialFen (a
  // mid-game puzzle position) may hand the engine a Black-to-move base. Read it
  // from the FEN's turn token so the eval normalises scores to the right POV.
  // A '-' token is the unbound first-player seat in Banqi and Flip Jungle.
  let currentBaseSide: Side = 'red';
  let currentPerspective: ScorePerspective = 'bound';
  let debounceId: ReturnType<typeof setTimeout> | undefined;

  function sideToMove(moves: string[]): Side {
    const flipped = moves.length % 2 === 1;
    if (!flipped) return currentBaseSide;
    return currentBaseSide === 'red' ? 'black' : 'red';
  }

  function syncToggle(): void {
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    toggle.classList.toggle('engine-panel__switch--on', on);
    el.classList.toggle('engine-panel--on', on);
    // Off-state status line, lichess-style: where the engine would run.
    if (supported && !on) sub.textContent = t('engine.inLocalBrowser');
  }

  function clearOutput(): void {
    evalLabel.textContent = '–';
    evalLabel.removeAttribute('title');
    lines.replaceChildren();
    opts.evalBar?.reset();
    opts.onLines?.(null);
  }

  function render(update: CevalUpdate, side: Side): void {
    const firstPlayer = currentPerspective === 'first-player';
    const best = update.lines[0];
    if (best) {
      const { cp, mate } = redPov(best, side);
      const display = formatScore(opts.variant, cp, mate);
      evalLabel.textContent = firstPlayer ? `P1 ${display}` : display;
      if (firstPlayer) evalLabel.title = t('engine.firstPlayerPerspective');
      else evalLabel.removeAttribute('title');
      opts.evalBar?.setEval(cp, mate);
    }
    const status = update.depth
      ? `Depth ${update.depth}${update.nps ? ` · ${formatKnps(update.nps)}` : ''}`
      : 'thinking…';
    const activeStatus = effort === 'infinite' ? `${status} · analyzing` : status;
    sub.textContent = topFlipsTied(update.lines)
      ? `${activeStatus} · Top flips tied`
      : activeStatus;
    lines.replaceChildren(
      ...update.lines.map((line) => renderLine(line, side, formatMove, opts.variant, firstPlayer)),
    );
    opts.onLines?.(update.lines);
  }

  function evaluateNow(): void {
    if (!on || !supported || !currentSearchable) return;
    if (!handle) handle = createCeval(opts.variant);
    const moves = currentMoves;
    const side = sideToMove(moves);
    sub.textContent = 'loading…';
    opts.evalBar?.setLoading();
    void handle!
      .evaluate({
        movesUci: moves,
        initialFen: currentFen,
        multiPv,
        effort,
        onUpdate: (update) => render(update, side),
      })
      .catch((err: unknown) => {
        sub.textContent = `Engine error: ${(err as Error).message ?? 'failed'}`;
      });
  }

  function setPosition(movesUci: string[], initialFen?: string, searchable: boolean = true): void {
    currentMoves = movesUci;
    currentFen = initialFen;
    currentSearchable = searchable;
    currentBaseSide = initialFen?.split(' ')[1] === 'b' ? 'black' : 'red';
    currentPerspective = isUnboundFlipPosition(opts.variant, initialFen) ? 'first-player' : 'bound';
    opts.evalBar?.setNeutral(currentPerspective === 'first-player');
    if (!on || !supported) return;
    // The panel keeps its last PV text until fresh results stream in, but
    // on-board arrows for a position we already left would be misleading —
    // clear them immediately and let the next update redraw.
    opts.onLines?.(null);
    clearTimeout(debounceId);
    if (!currentSearchable) {
      handle?.stop();
      clearOutput();
      opts.evalBar?.setIdle(true);
      sub.textContent = t('engine.gameOver');
      return;
    }
    opts.evalBar?.setIdle(false);
    debounceId = setTimeout(evaluateNow, DEBOUNCE_MS);
  }

  function turnOn(): void {
    if (!handle) handle = createCeval(opts.variant);
    on = true;
    opts.onToggle?.(true);
    syncToggle();
    if (!currentSearchable) {
      clearOutput();
      opts.evalBar?.setIdle(true);
      sub.textContent = t('engine.gameOver');
      return;
    }
    opts.evalBar?.setIdle(false);
    sub.textContent = 'loading…';
    void handle
      .preload()
      .then(() => {
        if (on) evaluateNow();
      })
      .catch((err: unknown) => {
        sub.textContent = `Engine unavailable: ${(err as Error).message ?? 'failed'}`;
      });
  }

  function turnOff(): void {
    on = false;
    opts.onToggle?.(false);
    syncToggle();
    handle?.stop();
    clearOutput();
    opts.evalBar?.setIdle(true);
  }

  function onVisibilityChange(): void {
    if (!on || effort !== 'infinite') return;
    if (document.hidden) {
      handle?.stop();
      sub.textContent = t('engine.pausedInactive');
      return;
    }
    evaluateNow();
  }

  if (!supported) {
    toggle.disabled = true;
    // Do NOT promise a reload. The threaded engine needs cross-origin isolation,
    // which these routes request with COEP: credentialless; Safari/WebKit does
    // not implement credentialless, so it never isolates and no number of
    // reloads changes that. Measured 2026-08-01, along with why switching to
    // require-corp is not the fix (memory: engine_safari_coep_wall). Cases where
    // a reload genuinely helps (a stale header-less cached document) are rare
    // next to the browsers that simply cannot, so name the limitation.
    sub.textContent = 'Local engine is unavailable in this browser. Safari cannot run it yet.';
  } else {
    toggle.addEventListener('click', () => (on ? turnOff() : turnOn()));
  }
  syncToggle();
  clearOutput();
  // The panel starts engine-off; the eval bar reads inactive until turnOn.
  opts.evalBar?.setIdle(true);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    el,
    setPosition,
    setShowArrows(next: boolean) {
      if (opts.arrowsSupported === false) return;
      if (showArrowsToggle.checked === next) return;
      showArrowsToggle.checked = next;
      opts.onShowArrowsChange?.(next);
    },
    setOn(next: boolean) {
      if (!supported || on === next) return;
      if (next) turnOn();
      else turnOff();
    },
    supported,
    dispose() {
      clearTimeout(debounceId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      handle?.dispose();
    },
  };
}

function effortForInitialDepth(maxDepth?: number): CevalEffort {
  if (maxDepth === undefined || maxDepth === 18) return 'standard';
  if (maxDepth <= 14) return 'quick';
  if (maxDepth <= 22) return 'deep';
  return 'max';
}

function effortLabel(effort: CevalEffort): string {
  switch (effort) {
    case 'quick':
      return t('engine.effortQuick');
    case 'standard':
      return t('engine.effortStandard');
    case 'deep':
      return t('engine.effortDeep');
    case 'max':
      return 'Max';
    case 'infinite':
      return '∞';
  }
}

// One settings row: label · range slider · live value readout. The readout
// tracks every drag tick ('input'); the engine only retunes on commit
// ('change') so a drag doesn't restart the search per notch.
/** A labelled checkbox row, matching sliderRow's shape so the popover reads as
 *  one list. The caller owns the input element so it can be driven from a
 *  keyboard shortcut without re-querying the DOM. */
function checkboxRow(
  label: string,
  input: HTMLInputElement,
  initial: boolean,
  onChange: (enabled: boolean) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'engine-panel__setting engine-panel__setting--checkbox';
  const name = document.createElement('span');
  name.className = 'engine-panel__setting-label';
  name.textContent = label;
  input.type = 'checkbox';
  input.checked = initial;
  input.className = 'engine-panel__setting-checkbox';
  // The `a` key toggles this row (review-layout.ts installReviewKeyboard).
  // A bare "a" in a box read as a mystery glyph, so it is a real <kbd> keycap
  // with a tooltip that says what the key does.
  const shortcut = document.createElement('kbd');
  shortcut.className = 'engine-panel__setting-key';
  shortcut.textContent = 'a';
  shortcut.title = t('engine.shortcutHint', { key: 'a' });
  shortcut.setAttribute('aria-label', shortcut.title);
  input.addEventListener('change', () => onChange(input.checked));
  row.append(name, input, shortcut);
  return row;
}

function sliderRow(
  label: string,
  range: { min: number; max: number; step: number; value: number },
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'engine-panel__setting';
  const name = document.createElement('span');
  name.className = 'engine-panel__setting-label';
  name.textContent = label;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = String(range.step);
  slider.value = String(range.value);
  const value = document.createElement('span');
  value.className = 'engine-panel__setting-value';
  value.textContent = format(range.value);
  slider.addEventListener('input', () => {
    value.textContent = format(Number(slider.value));
  });
  slider.addEventListener('change', () => onChange(Number(slider.value)));
  row.append(name, slider, value);
  return row;
}

function renderLine(
  line: CevalLine,
  side: Side,
  formatMove: (uci: string) => string,
  variant: CevalVariant,
  neutral: boolean,
): HTMLElement {
  const li = document.createElement('li');
  li.className = 'engine-panel__line';
  const { cp, mate } = redPov(line, side);
  const score = document.createElement('span');
  score.className = `engine-panel__line-eval ${neutral ? 'is-even' : evalTone(cp, mate, variant)}`;
  score.textContent = formatScore(variant, cp, mate);
  const pv = document.createElement('span');
  pv.className = 'engine-panel__line-pv';
  pv.textContent = line.pvUci.slice(0, 8).map(formatMove).join(' ');
  li.append(score, pv);
  return li;
}

// Chip tone by who's ahead (Red POV), matching the on-board eval bar's palette:
// Red-ahead reads light, Black-ahead dark, near-even neutral.
function evalTone(cp: number | null, mate: number | null, variant: CevalVariant): string {
  const scale = isMistyCevalVariant(variant) ? 1000 : 100;
  const value = mate != null ? (mate > 0 ? 1 : -1) : (cp ?? 0) / scale;
  if (value > 0.15) return 'is-red';
  if (value < -0.15) return 'is-black';
  return 'is-even';
}

function formatScore(variant: CevalVariant, cp: number | null, mate: number | null): string {
  return isMistyCevalVariant(variant) ? formatMistyEval(cp, mate) : formatEval(cp, mate);
}

function isUnboundFlipPosition(variant: CevalVariant, fen?: string): boolean {
  if (variant !== 'banqi' && variant !== 'jungleflip') return false;
  return fen?.trim().split(/\s+/)[1] === '-';
}

function topFlipsTied(lines: readonly CevalLine[]): boolean {
  if (lines.length < 2) return false;
  const first = lines[0];
  if (!first || !isFlip(first.pvUci[0])) return false;
  return lines.every(
    (line) => isFlip(line.pvUci[0]) && line.scoreCp === first.scoreCp && line.mate === first.mate,
  );
}

function isFlip(uci?: string): boolean {
  return uci != null && uci.length >= 4 && uci.slice(0, 2) === uci.slice(2, 4);
}

function redPov(line: CevalLine, side: Side): { cp: number | null; mate: number | null } {
  const sign = side === 'red' ? 1 : -1;
  return {
    cp: line.scoreCp == null ? null : line.scoreCp * sign,
    mate: line.mate == null ? null : line.mate * sign,
  };
}

function formatKnps(nps: number): string {
  return nps >= 1000 ? `${Math.round(nps / 1000)}k nps` : `${nps} nps`;
}
