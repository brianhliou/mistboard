// The phone game review's Engine analysis row in the ☰ menu (#619 round 3,
// replacing the gauge button in the arrow bar): it switches the review's
// engine panel through the panel's own setOn, shows pressed while the engine
// runs, and the bar above the board follows the panel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewControls } from './review-controls.js';
import { createReviewEngineToggle, type ReviewEngineSource } from './review-engine-toggle.js';

/** A stand-in for engine-panel.ts: the DOM the bar reads, and a setOn that
 *  reports back through onToggle the way the real panel does. */
function fakeEngine(onToggle: (on: boolean) => void): ReviewEngineSource & {
  setOn: ReturnType<typeof vi.fn>;
} {
  const el = document.createElement('div');
  el.className = 'engine-panel';
  el.innerHTML =
    '<span class="engine-panel__eval">+0.4</span>' +
    '<span class="engine-panel__sub">Depth 18 · in local browser</span>' +
    '<ol class="engine-panel__lines"><li><span class="engine-panel__line-pv">h2-e2 h9-g7</span></li></ol>';
  return { el, supported: true, setOn: vi.fn((on: boolean) => onToggle(on)) };
}

describe('review Engine analysis row', () => {
  afterEach(() => document.body.replaceChildren());

  it('switches the engine panel on and off through its own setOn', () => {
    const abort = new AbortController();
    let toggle: ReturnType<typeof createReviewEngineToggle> | null = null;
    const engine = fakeEngine((on) => toggle?.setOn(on));
    toggle = createReviewEngineToggle({ signal: abort.signal, engine });
    document.body.append(toggle.bar);

    expect(toggle.menuItem.label).toBe('Engine analysis');
    expect(toggle.menuItem.dataset).toEqual({ reviewEngine: '' });
    expect(toggle.menuItem.pressed?.()).toBe(false);
    expect(toggle.bar.hidden).toBe(true);

    toggle.menuItem.onClick?.();
    expect(engine.setOn).toHaveBeenLastCalledWith(true);
    expect(toggle.menuItem.pressed?.()).toBe(true);
    // The bar above the board shows the panel's eval, line and depth.
    expect(toggle.bar.hidden).toBe(false);
    expect(toggle.bar.querySelector('.analysis-engine-bar__eval')?.textContent).toBe('+0.4');
    expect(toggle.bar.querySelector('.analysis-engine-bar__pv')?.textContent).toBe('h2-e2 h9-g7');
    expect(toggle.bar.querySelector('.analysis-engine-bar__depth')?.textContent).toContain('18');

    toggle.menuItem.onClick?.();
    expect(engine.setOn).toHaveBeenLastCalledWith(false);
    expect(toggle.menuItem.pressed?.()).toBe(false);
    expect(toggle.bar.hidden).toBe(true);
    abort.abort();
  });

  it('follows the panel when it is switched from its own card', () => {
    const abort = new AbortController();
    const engine = fakeEngine(() => {});
    const toggle = createReviewEngineToggle({ signal: abort.signal, engine });
    toggle.setOn(true);
    expect(toggle.menuItem.pressed?.()).toBe(true);
    expect(toggle.bar.hidden).toBe(false);
    // The next click switches it off, not on again.
    toggle.menuItem.onClick?.();
    expect(engine.setOn).toHaveBeenLastCalledWith(false);
    abort.abort();
  });

  it('is a pressed toggle row in the ☰ menu, and the arrow bar has no gauge', () => {
    const abort = new AbortController();
    let toggle: ReturnType<typeof createReviewEngineToggle> | null = null;
    const engine = fakeEngine((on) => toggle?.setOn(on));
    toggle = createReviewEngineToggle({ signal: abort.signal, engine });
    const controls = createReviewControls({
      signal: abort.signal,
      onFirst() {},
      onPrevious() {},
      onNext() {},
      onLast() {},
      menuItems: [toggle.menuItem],
    });
    document.body.append(controls.el);

    // First, previous, next, last and ☰: the gauge is gone from the bar.
    expect(controls.el.querySelectorAll(':scope > button')).toHaveLength(5);
    expect(controls.el.querySelector('.review-engine-button')).toBeNull();
    expect(controls.el.querySelector(':scope > [data-review-engine]')).toBeNull();

    const menu = controls.el.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button');
    menu?.click();
    const row = () =>
      controls.el.querySelector<HTMLElement>('.move-nav-menu__item[data-review-engine]');
    expect(row()?.textContent).toContain('Engine analysis');
    expect(row()?.getAttribute('aria-pressed')).toBe('false');
    row()?.click();
    expect(engine.setOn).toHaveBeenLastCalledWith(true);
    menu?.click();
    expect(row()?.getAttribute('aria-pressed')).toBe('true');
    expect(row()?.classList.contains('move-nav-menu__item--on')).toBe(true);
    abort.abort();
  });
});
