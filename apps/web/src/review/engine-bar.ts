// The phone engine bar above the board (eval, best line, depth): one view, two
// pages. The analysis board's phone chrome (analysis-phone-bar.ts, #576) and
// the phone game review (#619) both show it while the engine runs.
//
// Nothing here runs the engine or owns its state. The bar is a view of the
// engine panel (engine-panel.ts), which keeps rendering in the DOM where the
// desktop layout and the ceval smoke read it: the bar copies the panel's eval,
// first line and depth, and follows its status text as it streams. Above 600px
// it is display: none (engine-bar.css).

import './engine-bar.css';
import { t } from '../i18n/catalog.js';

/** The slice of the engine panel the bar reads. */
export interface EngineBarSource {
  el: HTMLElement;
  supported: boolean;
}

export interface EngineBar {
  el: HTMLElement;
  /** The engine was switched (the panel's onToggle). */
  setOn(on: boolean): void;
  /** Re-read the engine panel's readout. */
  sync(): void;
}

export function createEngineBar(opts: {
  signal: AbortSignal;
  /** Null when the variant has no in-browser engine at all. */
  engine: EngineBarSource | null;
}): EngineBar {
  const { engine, signal } = opts;
  const usable = Boolean(engine?.supported);
  let on = false;

  const el = document.createElement('div');
  el.className = 'analysis-engine-bar';
  el.hidden = true;
  el.setAttribute('aria-live', 'off');
  const evalChip = document.createElement('span');
  evalChip.className = 'analysis-engine-bar__eval';
  const pv = document.createElement('span');
  pv.className = 'analysis-engine-bar__pv';
  const depth = document.createElement('span');
  depth.className = 'analysis-engine-bar__depth';
  el.append(evalChip, pv, depth);

  function sync(): void {
    el.hidden = !(usable && on);
    if (el.hidden || !engine) return;
    const panel = engine.el;
    const evalText = panel.querySelector('.engine-panel__eval')?.textContent?.trim() ?? '';
    const lineText = panel.querySelector('.engine-panel__line-pv')?.textContent?.trim() ?? '';
    const subText = panel.querySelector('.engine-panel__sub')?.textContent?.trim() ?? '';
    const depthMatch = /Depth (\d+)/.exec(subText);
    evalChip.textContent = evalText || '–';
    // Before the first line lands the PV slot carries the panel's status
    // ("loading…", the net download progress), so the bar never sits blank.
    pv.textContent = lineText || subText;
    depth.textContent = depthMatch ? t('analysis.barDepth', { depth: depthMatch[1]! }) : '';
  }

  // The panel streams progress text (net download, depth) between line
  // updates; follow it so the bar's status matches the panel's.
  if (engine && usable && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => sync());
    observer.observe(engine.el, { subtree: true, childList: true, characterData: true });
    signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  }

  return {
    el,
    setOn(next) {
      on = next;
      sync();
    },
    sync,
  };
}
