// The analysis board's phone chrome (#576): a labelled bottom bar, an engine
// bar that mirrors the engine panel while it runs, and a Tools sheet that
// carries the menu and the FEN/moves import block.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AnalysisPhoneBar,
  type AnalysisPhoneEngine,
  createAnalysisPhoneBar,
} from './analysis-phone-bar.js';
import type { ReviewMenuItem } from './review-controls.js';

/** A stand-in for engine-panel.ts: the DOM the bar reads, and setOn firing the
 *  panel's onToggle the way the real one does. */
function fakeEngine(supported = true): AnalysisPhoneEngine & { bind(bar: AnalysisPhoneBar): void } {
  const el = document.createElement('section');
  el.className = 'engine-panel';
  el.innerHTML =
    '<span class="engine-panel__eval">–</span><span class="engine-panel__sub">in local browser</span><ol class="engine-panel__lines"></ol>';
  let bar: AnalysisPhoneBar | null = null;
  return {
    el,
    supported,
    setOn: vi.fn((next: boolean) => {
      el.classList.toggle('engine-panel--on', next);
      bar?.setEngineOn(next);
    }),
    bind(b) {
      bar = b;
    },
  };
}

function importBlock(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'review-import';
  const fen = document.createElement('input');
  fen.className = 'review-import__field';
  fen.id = 'review-import-fen';
  fen.value = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
  el.append(fen);
  return el;
}

const controllers: AbortController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.abort();
  document.body.replaceChildren();
});

function mount(
  opts: {
    engine?: ReturnType<typeof fakeEngine> | null;
    items?: ReviewMenuItem[];
    importPanel?: HTMLElement | null;
    metaCard?: HTMLElement | null;
  } = {},
) {
  const controller = new AbortController();
  controllers.push(controller);
  const engine = opts.engine === undefined ? fakeEngine() : opts.engine;
  const home = document.createElement('div');
  const importPanel = opts.importPanel === undefined ? importBlock() : opts.importPanel;
  if (importPanel) home.append(importPanel);
  document.body.append(home);
  const onFlip = vi.fn();
  const onBack = vi.fn();
  const onNext = vi.fn();
  const phone = createAnalysisPhoneBar({
    signal: controller.signal,
    engine,
    variantName: 'Xiangqi',
    onFlip,
    onBack,
    onNext,
    toolsItems: () => opts.items ?? [],
    importPanel,
    metaCard: opts.metaCard ?? null,
  });
  engine?.bind(phone);
  document.body.append(phone.engineBar, phone.info, phone.bar, phone.sheet);
  const button = (action: string) =>
    phone.bar.querySelector<HTMLButtonElement>(`[data-analysis-bar="${action}"]`)!;
  return { phone, engine, home, importPanel, onFlip, onBack, onNext, button };
}

describe('analysis phone bar', () => {
  it('renders five labelled buttons: Tools, Engine, Flip, Back, Next', () => {
    const { phone } = mount();
    const buttons = [...phone.bar.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((b) => b.dataset.analysisBar)).toEqual([
      'tools',
      'engine',
      'flip',
      'back',
      'next',
    ]);
    // Every button carries visible text, not just an icon.
    expect(buttons.map((b) => b.querySelector('.analysis-phone-bar__label')?.textContent)).toEqual([
      'Tools',
      'Engine off',
      'Flip',
      'Back',
      'Next',
    ]);
    expect(buttons.every((b) => !b.hidden)).toBe(true);
  });

  it("names Back and Next as move controls, like the site's other move arrows", () => {
    const { phone } = mount();
    const label = (action: string) =>
      phone.bar.querySelector(`[data-analysis-bar="${action}"]`)?.getAttribute('aria-label');
    expect(label('back')).toBe('Previous move');
    expect(label('next')).toBe('Next move');
  });

  it('Engine toggles the engine and reports it in aria-pressed', () => {
    const { button, engine } = mount();
    const engineButton = button('engine');
    expect(engineButton.getAttribute('aria-pressed')).toBe('false');
    engineButton.click();
    expect(engine?.setOn).toHaveBeenLastCalledWith(true);
    expect(engineButton.getAttribute('aria-pressed')).toBe('true');
    expect(engineButton.textContent).toContain('Engine on');
    engineButton.click();
    expect(engine?.setOn).toHaveBeenLastCalledWith(false);
    expect(engineButton.getAttribute('aria-pressed')).toBe('false');
    expect(engineButton.textContent).toContain('Engine off');
  });

  it('shows the engine bar only while the engine is on, mirroring the panel', () => {
    const { phone, engine, button } = mount();
    expect(phone.engineBar.hidden).toBe(true);
    button('engine').click();
    expect(phone.engineBar.hidden).toBe(false);
    // The panel renders a line; the bar reads eval, best line and depth from it.
    const panel = engine!.el;
    panel.querySelector('.engine-panel__eval')!.textContent = '+0.4';
    panel.querySelector('.engine-panel__sub')!.textContent = 'Depth 18 · 450k nps';
    panel.querySelector('.engine-panel__lines')!.innerHTML =
      '<li class="engine-panel__line"><span class="engine-panel__line-eval">+0.4</span><span class="engine-panel__line-pv">h3-e3 h10-g8 h1-g3</span></li>';
    phone.syncEngine();
    expect(phone.engineBar.querySelector('.analysis-engine-bar__eval')?.textContent).toBe('+0.4');
    expect(phone.engineBar.querySelector('.analysis-engine-bar__pv')?.textContent).toBe(
      'h3-e3 h10-g8 h1-g3',
    );
    expect(phone.engineBar.querySelector('.analysis-engine-bar__depth')?.textContent).toBe(
      'depth 18',
    );
    button('engine').click();
    expect(phone.engineBar.hidden).toBe(true);
  });

  it('hides the Engine button where the browser cannot run the engine', () => {
    const { button, phone } = mount({ engine: fakeEngine(false) });
    expect(button('engine').hidden).toBe(true);
    button('engine').click();
    expect(phone.engineBar.hidden).toBe(true);
  });

  it('hides the Engine button for a variant with no browser engine', () => {
    const { button } = mount({ engine: null });
    expect(button('engine').hidden).toBe(true);
  });

  it('Tools opens a sheet that carries the FEN box and the menu items, and gives the FEN box back on close', () => {
    const onStudy = vi.fn();
    const { phone, button, home, importPanel } = mount({
      items: [{ label: 'Study', icon: '<svg></svg>', onClick: onStudy }],
    });
    expect(phone.sheet.hidden).toBe(true);
    button('tools').click();
    expect(phone.sheet.hidden).toBe(false);
    expect(button('tools').getAttribute('aria-expanded')).toBe('true');
    const fen = phone.sheet.querySelector<HTMLInputElement>('#review-import-fen');
    expect(fen?.value).toMatch(/^rnbakabnr/);
    const study = [...phone.sheet.querySelectorAll('.analysis-tools-sheet__item')].find(
      (row) => row.textContent === 'Study',
    ) as HTMLButtonElement;
    study.click();
    expect(onStudy).toHaveBeenCalledOnce();
    // Choosing an item closes the sheet and returns the import block home.
    expect(phone.sheet.hidden).toBe(true);
    expect(importPanel?.parentElement).toBe(home);
  });

  it('lends the variant card to the sheet and puts both blocks back in order', () => {
    const card = document.createElement('label');
    card.className = 'analysis-variant-picker';
    const rail = document.createElement('div');
    const after = document.createElement('span');
    rail.append(card, after);
    document.body.append(rail);
    const { phone, button, home, importPanel } = mount({ metaCard: card });
    button('tools').click();
    expect(phone.sheet.querySelector('.analysis-tools-sheet__meta')?.firstChild).toBe(card);
    expect(phone.sheet.contains(importPanel)).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(card.parentElement).toBe(rail);
    expect(card.nextSibling).toBe(after);
    expect(importPanel?.parentElement).toBe(home);
  });

  it('closes the Tools sheet on Escape', () => {
    const { phone, button } = mount();
    button('tools').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(phone.sheet.hidden).toBe(true);
  });

  it('Flip, Back and Next call through; Back and Next follow the bounds', () => {
    const { phone, button, onFlip, onBack, onNext } = mount();
    button('flip').click();
    button('back').click();
    button('next').click();
    expect([onFlip, onBack, onNext].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
    phone.sync({ sideToMove: 'Red', atStart: true, atEnd: false, editorHref: '/editor/xiangqi' });
    expect(button('back').disabled).toBe(true);
    expect(button('next').disabled).toBe(false);
    expect(phone.info.textContent).toContain('Xiangqi · Red to move');
    expect(phone.info.querySelector('a')?.getAttribute('href')).toBe('/editor/xiangqi');
  });
});

describe('analysis phone bar CSS', () => {
  const css = readFileSync('src/review/analysis-phone-bar.css', 'utf8').replace(/\s+/g, ' ');

  it('shows nothing above 600px: every piece is display none outside the media query', () => {
    const outside = css.slice(0, css.indexOf('@media (max-width: 600px)'));
    expect(outside).toContain(
      '.analysis-phone-bar, .analysis-phone-info, .analysis-tools-sheet { display: none; }',
    );
    // The engine bar is shared with the phone game review and has its own sheet.
    const engineCss = readFileSync('src/review/engine-bar.css', 'utf8').replace(/\s+/g, ' ');
    const engineOutside = engineCss.slice(0, engineCss.indexOf('@media (max-width: 600px)'));
    expect(engineOutside).toContain('.analysis-engine-bar { display: none; }');
    expect(engineCss).toContain('.analysis-engine-bar[hidden] { display: none; }');
  });

  it('keeps the phone page to one screen: the variant card and import form are hidden inline', () => {
    expect(css).toContain(
      '.has-analysis-phone-bar .review-shell--analysis .review-rail-group, .has-analysis-phone-bar .review-shell--analysis .review-import,',
    );
  });

  it('keeps the hidden attribute winning over its own display rules', () => {
    for (const selector of [
      '.analysis-tools-sheet[hidden]',
      '.analysis-phone-bar__button[hidden]',
    ]) {
      expect(css).toContain(`${selector} { display: none; }`);
    }
  });
});
