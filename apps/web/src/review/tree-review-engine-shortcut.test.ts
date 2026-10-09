import { STANDARD_BANQI_DEAL } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBanqiReview } from './banqi-review.js';

class FakeBanqiWorker extends EventTarget {
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
              // MistyBanqi uses 0-indexed ranks. This must become board move a1a1.
              lines: [{ uci: 'a0a0', cp: 100, depth: 2 }],
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

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  const handle = mountBanqiReview(
    root,
    'shortcut-test',
    { deal: STANDARD_BANQI_DEAL, rules: {} },
    {
      reviewSurface: 'analysis',
      ariaLabel: 'Banqi analysis',
      title: 'Banqi',
      summary: '',
      moves: [],
      initialPosition: 'start',
      analysis: null,
    },
  );
  return { root, handle };
}

function pressSpace(target: HTMLElement = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('tree review local-engine Space shortcut', () => {
  it('plays the fresh top engine move through the variant decoder', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeBanqiWorker);
    const { root, handle } = mount();

    root.querySelector<HTMLButtonElement>('.engine-panel__switch')?.click();
    await vi.advanceTimersByTimeAsync(1);
    expect(root.querySelector('.engine-panel__line')?.textContent).toContain('a1');

    const event = pressSpace();

    expect(event.defaultPrevented).toBe(true);
    expect(handle.serialize().root.children[0]?.uci).toBe('a1a1');
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('a1');
  });

  it('leaves Space alone while the local engine is off', () => {
    vi.stubGlobal('Worker', FakeBanqiWorker);
    const { handle } = mount();

    const event = pressSpace();

    expect(event.defaultPrevented).toBe(false);
    expect(handle.serialize().root.children).toHaveLength(0);
  });
});
