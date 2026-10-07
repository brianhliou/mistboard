import { describe, expect, it, vi } from 'vitest';
import { createEnginePanel } from './engine-panel.js';
import { createEvalBar } from './eval-bar.js';

// happy-dom is not cross-origin isolated, so cevalSupported() is false here:
// the panel mounts disabled and never touches the WASM engine. That still pins
// the arrow-feed contract on the clear path — onLines(null) fires whenever the
// output clears, starting with the initial clearOutput() at construction.

describe('createEnginePanel onLines', () => {
  it('fires null on construction (cleared output = no arrows)', () => {
    const onLines = vi.fn();
    const panel = createEnginePanel({ variant: 'xiangqi', onLines });
    expect(onLines).toHaveBeenCalledWith(null);
    expect(onLines).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it('does not tell an unsupported browser to reload', () => {
    // happy-dom is not cross-origin isolated, so this exercises the unsupported
    // branch. The old copy ("needs a cross-origin-isolated reload") was a dead
    // end on Safari, which does not implement COEP: credentialless and so never
    // isolates on these routes however many times you reload.
    const panel = createEnginePanel({ variant: 'xiangqi' });
    const text = panel.el.textContent ?? '';
    expect(text).toContain('unavailable in this browser');
    expect(text.toLowerCase()).not.toContain('reload');
    panel.dispose();
  });

  it('does not feed arrows from setPosition while the engine is unsupported/off', () => {
    const onLines = vi.fn();
    const panel = createEnginePanel({ variant: 'xiangqi', onLines });
    onLines.mockClear();
    panel.setPosition(['h3e3']);
    expect(onLines).not.toHaveBeenCalled();
    panel.dispose();
  });

  it('shows terminal Misty positions as game over and resumes after stepping back', async () => {
    vi.useFakeTimers();
    class FakeWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: { type: string; id?: number }): void {
        const data =
          message.type === 'init'
            ? { type: 'ready' }
            : {
                type: 'result',
                id: message.id,
                json: JSON.stringify({
                  lines: [{ uci: 'a0a0', cp: 1000, depth: 24 }],
                }),
              };
        queueMicrotask(() => {
          const event = new MessageEvent('message', { data });
          this.onmessage?.(event);
          this.dispatchEvent(event);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);

    try {
      const panel = createEnginePanel({ variant: 'banqi' });
      panel.setPosition([], 'terminal w - - 0 1', false);
      panel.el.querySelector<HTMLButtonElement>('.engine-panel__switch')?.click();

      expect(panel.el.querySelector('.engine-panel__sub')?.textContent).toBe('Game over');
      expect(panel.el.querySelector('.engine-panel__eval')?.textContent).toBe('–');
      expect(panel.el.querySelectorAll('.engine-panel__line')).toHaveLength(0);

      panel.setPosition([], 'playable w - - 0 1', true);
      await vi.advanceTimersByTimeAsync(151);

      expect(panel.el.querySelector('.engine-panel__sub')?.textContent).toBe('Depth 24');
      expect(panel.el.querySelector('.engine-panel__eval')?.textContent).toBe('+1.00');
      expect(panel.el.querySelectorAll('.engine-panel__line')).toHaveLength(1);
      panel.dispose();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('createEnginePanel flip-game opening scores', () => {
  it('uses a neutral first-player label, Misty scale, and tied-flip note before binding', async () => {
    vi.useFakeTimers();
    class FakeWorker extends EventTarget {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: { type: string; id?: number }): void {
        const data =
          message.type === 'init'
            ? { type: 'ready' }
            : {
                type: 'result',
                id: message.id,
                json: JSON.stringify({
                  lines: [
                    { uci: 'a0a0', cp: -201, depth: 2 },
                    { uci: 'b0b0', cp: -201, depth: 2 },
                    { uci: 'c0c0', cp: -201, depth: 2 },
                  ],
                }),
              };
        queueMicrotask(() => {
          const event = new MessageEvent('message', { data });
          this.onmessage?.(event);
          this.dispatchEvent(event);
        });
      }

      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);

    try {
      const evalBar = createEvalBar();
      const panel = createEnginePanel({ variant: 'jungleflip', evalBar });
      panel.setPosition([], 'XXXX/XXXX/XXXX/XXXX - RCDWPTLErcdwptle 0 1');
      panel.el.querySelector<HTMLButtonElement>('.engine-panel__switch')?.click();
      await vi.advanceTimersByTimeAsync(1);

      expect(panel.el.querySelector('.engine-panel__eval')?.textContent).toBe('P1 -0.20');
      expect(panel.el.querySelector('.engine-panel__eval')?.getAttribute('title')).toBe(
        'First player perspective',
      );
      expect(panel.el.querySelector('.engine-panel__sub')?.textContent).toBe(
        'Depth 2 · Top flips tied',
      );
      expect(
        [...panel.el.querySelectorAll('.engine-panel__line-eval')].map((node) => ({
          text: node.textContent,
          tone: node.classList.contains('is-even'),
        })),
      ).toEqual([
        { text: '-0.20', tone: true },
        { text: '-0.20', tone: true },
        { text: '-0.20', tone: true },
      ]);
      expect(evalBar.el.classList.contains('review-eval-bar--neutral')).toBe(true);
      expect(evalBar.el.querySelector('.review-eval-bar__label')).toBeNull();

      panel.setPosition([], 'XXXX/XXXX/XXXX/XXXX r RCDWPTLErcdwptle 0 2');
      await vi.advanceTimersByTimeAsync(151);

      expect(panel.el.querySelector('.engine-panel__eval')?.textContent).toBe('-0.20');
      expect(panel.el.querySelector('.engine-panel__eval')?.hasAttribute('title')).toBe(false);
      expect(evalBar.el.classList.contains('review-eval-bar--neutral')).toBe(false);
      panel.dispose();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('createEnginePanel engine name', () => {
  it('links Pikafish to its home page where xiangqi analyses on its net', () => {
    const panel = createEnginePanel({ variant: 'xiangqi' });
    const link = panel.el.querySelector<HTMLAnchorElement>('.engine-panel__name a');
    expect(link?.textContent).toBe('Pikafish');
    expect(link?.getAttribute('href')).toBe('https://pikafish.com/');
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toContain('noopener');
    panel.dispose();
  });

  it('keeps a plain label for engines other than Pikafish', () => {
    const panel = createEnginePanel({ variant: 'fortressxiangqi' });
    const name = panel.el.querySelector('.engine-panel__name');
    expect(name?.querySelector('a')).toBeNull();
    expect(name?.textContent).not.toBe('Pikafish');
    panel.dispose();
  });
});

describe('createEnginePanel arrow toggle', () => {
  const checkbox = (panel: { el: HTMLElement }): HTMLInputElement =>
    panel.el.querySelector('.engine-panel__setting-checkbox') as HTMLInputElement;

  it('renders the toggle in the settings popover, defaulting on', () => {
    const panel = createEnginePanel({ variant: 'xiangqi' });
    expect(checkbox(panel)).not.toBeNull();
    expect(checkbox(panel).checked).toBe(true);
    expect(panel.el.textContent).toContain('Best move indicators');
    const key = panel.el.querySelector('kbd.engine-panel__setting-key') as HTMLElement;
    expect(key.textContent).toBe('a');
    expect(key.title).toBe('Keyboard shortcut: press a to toggle');
    panel.dispose();
  });

  it('hides the toggle when the board has no arrow overlay capability', () => {
    const panel = createEnginePanel({ variant: 'banqi', arrowsSupported: false });
    expect(checkbox(panel)).toBeNull();
    expect(panel.el.textContent).not.toContain('Best move indicators');
    panel.dispose();
  });

  it('honours an initially-off preference', () => {
    const panel = createEnginePanel({ variant: 'xiangqi', showArrows: false });
    expect(checkbox(panel).checked).toBe(false);
    panel.dispose();
  });

  it('reports a click on the checkbox', () => {
    const onShowArrowsChange = vi.fn();
    const panel = createEnginePanel({ variant: 'xiangqi', onShowArrowsChange });
    const box = checkbox(panel);
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(onShowArrowsChange).toHaveBeenCalledWith(false);
    panel.dispose();
  });

  it('setShowArrows drives the checkbox and reports, so `a` and a click agree', () => {
    const onShowArrowsChange = vi.fn();
    const panel = createEnginePanel({ variant: 'xiangqi', onShowArrowsChange });
    panel.setShowArrows(false);
    expect(checkbox(panel).checked).toBe(false);
    expect(onShowArrowsChange).toHaveBeenCalledWith(false);
    panel.dispose();
  });

  it('setShowArrows is a no-op when already in that state', () => {
    const onShowArrowsChange = vi.fn();
    const panel = createEnginePanel({ variant: 'xiangqi', onShowArrowsChange });
    panel.setShowArrows(true);
    expect(onShowArrowsChange).not.toHaveBeenCalled();
    panel.dispose();
  });
});

describe('createEnginePanel search effort', () => {
  const effortRow = (panel: { el: HTMLElement }): HTMLElement =>
    [...panel.el.querySelectorAll<HTMLElement>('.engine-panel__setting')].find((row) =>
      row.textContent?.includes('Search effort'),
    )!;

  it('shows truthful effort labels and continuous analysis where supported', () => {
    const panel = createEnginePanel({ variant: 'jungleflip' });
    const row = effortRow(panel);
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(row.textContent).toContain('Standard');
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
    expect(row.textContent).toContain('∞');
    expect(row.textContent).not.toContain('Depth');
    panel.dispose();
  });

  it.each(['banqi', 'jungle'] as const)('offers the same continuous endpoint for %s', (variant) => {
    const panel = createEnginePanel({ variant });
    const row = effortRow(panel);
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.value = slider.max;
    slider.dispatchEvent(new Event('input'));
    expect(row.textContent).toContain('∞');
    expect(slider.max).toBe('4');
    panel.dispose();
  });

  it('preserves an explicit fixed-depth maximum before the continuous endpoint', () => {
    const panel = createEnginePanel({ variant: 'xiangqi', maxDepth: 26 });
    const row = effortRow(panel);
    expect(row.textContent).toContain('Max');
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.value).toBe('3');
    expect(slider.max).toBe('4');
    panel.dispose();
  });
});
