// Phone chrome for the standalone analysis board (#576, mobile pass). Below
// 600px the analysis page drops the icon-only arrow strip and the engine
// switch card for three pieces built here:
//   - an engine bar above the board (eval, best line, depth) while the engine
//     is on;
//   - an info row under the board (variant, side to move, Edit position);
//   - a labelled bottom bar: Tools, Engine, Flip, Back, Next.
// Tools opens a sheet with the review menu's items (study, clear, explorer,
// board editor, ...) and the FEN + moves import block.
//
// Nothing here runs the engine or owns its state. The engine bar (engine-bar.ts,
// shared with the phone game review) is a view of the engine panel
// (engine-panel.ts), which keeps rendering in the DOM where the desktop layout
// and the ceval smoke read it; the Engine button calls the panel's own setOn. Above 600px every piece here is display: none
// (analysis-phone-bar.css), so tablet and desktop are unchanged.

import './analysis-phone-bar.css';
import { t } from '../i18n/catalog.js';
import { createEngineBar } from './engine-bar.js';
import type { ReviewMenuItem } from './review-controls.js';

/** The slice of the engine panel the bar drives and mirrors. */
export interface AnalysisPhoneEngine {
  el: HTMLElement;
  supported: boolean;
  setOn(next: boolean): void;
}

export interface AnalysisPhoneBarOptions {
  signal: AbortSignal;
  /** Null when the variant has no in-browser engine at all. */
  engine: AnalysisPhoneEngine | null;
  /** Shown first in the info row ("Xiangqi"). */
  variantName: string;
  onFlip(): void;
  onBack(): void;
  onNext(): void;
  /** The review menu's items, read each time the sheet opens (the explorer
   *  item is spliced in after the controls are built). */
  toolsItems(): readonly ReviewMenuItem[];
  /** The FEN + moves import block. It lives under the board on wider screens
   *  and is lent to the sheet while the sheet is open. */
  importPanel: HTMLElement | null;
  /** The rail's top card (the variant switcher on /analysis), lent to the
   *  sheet the same way, so nothing under the move strip scrolls the page. */
  metaCard?: HTMLElement | null;
}

export interface AnalysisPhoneState {
  /** "Red", "Black"; null when no side is to move (game over, unbound seat). */
  sideToMove: string | null;
  atStart: boolean;
  atEnd: boolean;
  /** Board editor link for the current node, null when there is none. */
  editorHref: string | null;
}

export interface AnalysisPhoneBar {
  bar: HTMLElement;
  engineBar: HTMLElement;
  info: HTMLElement;
  sheet: HTMLElement;
  /** Per navigation: side to move, step bounds, editor link. */
  sync(state: AnalysisPhoneState): void;
  /** The engine was switched (the panel's onToggle). */
  setEngineOn(on: boolean): void;
  /** Re-read the engine panel's readout into the engine bar. */
  syncEngine(): void;
  /** Keep the current move in view when the move list scrolls sideways. */
  revealCurrentMove(movesRoot: HTMLElement): void;
  isToolsOpen(): boolean;
  closeTools(): void;
}

/** Scrolls a one-row move strip so the current move is in view. A no-op where
 *  the rows don't scroll sideways (tablet and desktop). */
export function revealCurrentMove(movesRoot: HTMLElement): void {
  const rows = movesRoot.querySelector<HTMLElement>('.review-move-list__rows');
  const current = movesRoot.querySelector<HTMLElement>('.review-move-list__move--current');
  if (!rows) return;
  if (!/(auto|scroll)/.test(getComputedStyle(rows).overflowX)) return;
  if (!current) {
    rows.scrollLeft = 0;
    return;
  }
  const box = rows.getBoundingClientRect();
  const target = current.getBoundingClientRect();
  if (target.left < box.left) rows.scrollLeft -= box.left - target.left + 8;
  else if (target.right > box.right) rows.scrollLeft += target.right - box.right + 8;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 24-unit stroke icons, the mock's set. */
const ICONS = {
  tools: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  engine: ['M4 17a8 8 0 1 1 16 0', 'm12 17 4-5'],
  flip: ['M7 4v16', 'M7 4 4 7', 'M7 4l3 3', 'M17 20V4', 'M17 20l-3-3', 'M17 20l3-3'],
  back: ['m15 5-7 7 7 7'],
  next: ['m9 5 7 7-7 7'],
} as const;

function icon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'analysis-phone-bar__icon');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

type BarAction = 'tools' | 'engine' | 'flip' | 'back' | 'next';

function barButton(
  action: BarAction,
  label: string,
): {
  button: HTMLButtonElement;
  text: HTMLSpanElement;
} {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'analysis-phone-bar__button';
  button.dataset.analysisBar = action;
  const text = document.createElement('span');
  text.className = 'analysis-phone-bar__label';
  text.textContent = label;
  button.append(icon(ICONS[action]), text);
  return { button, text };
}

export function createAnalysisPhoneBar(opts: AnalysisPhoneBarOptions): AnalysisPhoneBar {
  const { signal, engine } = opts;
  const engineUsable = Boolean(engine?.supported);
  let engineOn = false;

  // ── Bottom bar ──
  const bar = document.createElement('nav');
  bar.className = 'analysis-phone-bar';
  bar.setAttribute('aria-label', t('review.analysisBoard'));

  const tools = barButton('tools', t('analysis.barTools'));
  tools.button.setAttribute('aria-haspopup', 'dialog');
  tools.button.setAttribute('aria-expanded', 'false');
  const engineBtn = barButton('engine', t('analysis.barEngineOff'));
  // A stable name with the state in aria-pressed; the visible label adds on/off.
  engineBtn.button.setAttribute('aria-label', t('analysis.barEngine'));
  engineBtn.button.setAttribute('aria-pressed', 'false');
  // Where the browser cannot run the engine the panel hides its whole row
  // (engine-panel.ts, #576); the button follows it rather than offer a
  // control that can never work.
  engineBtn.button.hidden = !engineUsable;
  const flip = barButton('flip', t('analysis.barFlip'));
  const back = barButton('back', t('analysis.barBack'));
  // Named like every other move control, so a screen reader says what Back
  // steps through.
  back.button.setAttribute('aria-label', t('watch.previousMove'));
  back.button.setAttribute('aria-keyshortcuts', 'ArrowLeft');
  const next = barButton('next', t('replay.next'));
  next.button.setAttribute('aria-label', t('watch.nextMove'));
  next.button.setAttribute('aria-keyshortcuts', 'ArrowRight');
  bar.append(tools.button, engineBtn.button, flip.button, back.button, next.button);

  engineBtn.button.addEventListener(
    'click',
    () => {
      if (!engine || !engineUsable) return;
      engine.setOn(!engineOn);
    },
    { signal },
  );
  flip.button.addEventListener('click', () => opts.onFlip(), { signal });
  back.button.addEventListener('click', () => opts.onBack(), { signal });
  next.button.addEventListener('click', () => opts.onNext(), { signal });

  // ── Engine bar (above the board), shared with the phone game review ──
  const engineBar = createEngineBar({ signal, engine });
  const syncEngine = (): void => engineBar.sync();

  function setEngineOn(on: boolean): void {
    engineOn = on;
    engineBtn.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    engineBtn.button.classList.toggle('is-on', on);
    engineBtn.text.textContent = on ? t('analysis.barEngineOn') : t('analysis.barEngineOff');
    engineBar.setOn(on);
  }

  // ── Info row (under the board) ──
  const info = document.createElement('div');
  info.className = 'analysis-phone-info';
  const infoText = document.createElement('span');
  infoText.className = 'analysis-phone-info__text';
  const editLink = document.createElement('a');
  editLink.className = 'analysis-phone-info__edit';
  editLink.textContent = t('analysis.editPosition');
  editLink.hidden = true;
  info.append(infoText, editLink);

  // ── Tools sheet ──
  const sheet = document.createElement('div');
  sheet.className = 'analysis-tools-sheet';
  sheet.hidden = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'analysis-tools-sheet__backdrop';
  const panel = document.createElement('section');
  panel.className = 'analysis-tools-sheet__panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const headingId = 'analysis-tools-sheet-title';
  panel.setAttribute('aria-labelledby', headingId);
  const head = document.createElement('div');
  head.className = 'analysis-tools-sheet__head';
  const heading = document.createElement('h2');
  heading.className = 'analysis-tools-sheet__title';
  heading.id = headingId;
  heading.textContent = t('analysis.barTools');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'analysis-tools-sheet__close';
  close.textContent = t('analysis.closeTools');
  head.append(heading, close);
  const list = document.createElement('ul');
  list.className = 'analysis-tools-sheet__items';
  const importSlot = document.createElement('div');
  importSlot.className = 'analysis-tools-sheet__import';
  const metaSlot = document.createElement('div');
  metaSlot.className = 'analysis-tools-sheet__meta';
  panel.append(head, list, metaSlot, importSlot);
  sheet.append(backdrop, panel);

  // Where the import block goes back to when the sheet closes.
  // Where each lent block came from, to put it back on close.
  let homes: { el: HTMLElement; parent: ParentNode; next: Node | null }[] = [];
  function lend(el: HTMLElement | null | undefined, slot: HTMLElement): void {
    slot.hidden = !el;
    if (!el) return;
    if (el.parentNode) homes.push({ el, parent: el.parentNode, next: el.nextSibling });
    slot.append(el);
  }

  function renderItems(): void {
    list.replaceChildren(
      ...opts
        .toolsItems()
        .filter((item) => !item.hidden)
        .map((item) => {
          const li = document.createElement('li');
          const label = typeof item.label === 'function' ? item.label() : item.label;
          const row = item.href
            ? Object.assign(document.createElement('a'), { href: item.href })
            : Object.assign(document.createElement('button'), { type: 'button' });
          row.className = 'analysis-tools-sheet__item';
          for (const [key, value] of Object.entries(item.dataset ?? {})) row.dataset[key] = value;
          if (item.pressed) row.setAttribute('aria-pressed', item.pressed() ? 'true' : 'false');
          const glyph = document.createElement('span');
          glyph.className = 'analysis-tools-sheet__item-icon';
          glyph.setAttribute('aria-hidden', 'true');
          glyph.innerHTML = item.icon;
          const text = document.createElement('span');
          text.textContent = label;
          row.append(glyph, text);
          row.addEventListener('click', () => {
            closeTools();
            item.onClick?.();
          });
          li.append(row);
          return li;
        }),
    );
  }

  function openTools(): void {
    renderItems();
    homes = [];
    lend(opts.metaCard, metaSlot);
    lend(opts.importPanel, importSlot);
    sheet.hidden = false;
    tools.button.setAttribute('aria-expanded', 'true');
    document.body.classList.add('analysis-tools-open');
    close.focus();
  }

  function closeTools(): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    tools.button.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('analysis-tools-open');
    // Last lent goes back first, so a sibling it was placed before is home.
    for (const { el, parent, next } of homes.reverse()) parent.insertBefore(el, next);
    homes = [];
    if (sheet.contains(document.activeElement) || document.activeElement === document.body) {
      tools.button.focus();
    }
  }

  tools.button.addEventListener('click', () => (sheet.hidden ? openTools() : closeTools()), {
    signal,
  });
  close.addEventListener('click', () => closeTools(), { signal });
  backdrop.addEventListener('click', () => closeTools(), { signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && !sheet.hidden) {
        event.preventDefault();
        closeTools();
      }
    },
    { signal },
  );
  signal.addEventListener('abort', () => document.body.classList.remove('analysis-tools-open'), {
    once: true,
  });

  return {
    bar,
    engineBar: engineBar.el,
    info,
    sheet,
    sync(state) {
      const parts = [opts.variantName];
      if (state.sideToMove) parts.push(t('analysis.sideToMove', { side: state.sideToMove }));
      infoText.textContent = parts.join(' · ');
      if (state.editorHref) editLink.href = state.editorHref;
      editLink.hidden = !state.editorHref;
      back.button.disabled = state.atStart;
      next.button.disabled = state.atEnd;
    },
    setEngineOn,
    syncEngine,
    revealCurrentMove,
    isToolsOpen: () => !sheet.hidden,
    closeTools,
  };
}
