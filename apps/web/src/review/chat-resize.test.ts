import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachChatResize, chatResizeStorageKey } from './chat-resize.js';

describe('chat vertical resize', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('supports keyboard sizing, persistence, and restoring automatic height', async () => {
    const { panel, separator } = mountedChat();
    await flushMicrotasks();

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(manualHeight(panel)).toBe('324px');
    expect(panel.classList).toContain('review-spectator-chat--manual-height');
    expect(window.localStorage.getItem(chatResizeStorageKey)).toBe('324');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(manualHeight(panel)).toBe('528px');
    expect(separator.getAttribute('aria-valuemax')).toBe('528');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(manualHeight(panel)).toBe('180px');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(manualHeight(panel)).toBe('');
    expect(panel.classList).not.toContain('review-spectator-chat--manual-height');
    expect(window.localStorage.getItem(chatResizeStorageKey)).toBeNull();
  });

  it('clamps a saved preference to the rail and restores it when space returns', async () => {
    window.localStorage.setItem(chatResizeStorageKey, '620');
    let parentHeight = 700;
    const { panel } = mountedChat(() => parentHeight);
    await flushMicrotasks();

    expect(manualHeight(panel)).toBe('528px');
    expect(window.localStorage.getItem(chatResizeStorageKey)).toBe('620');

    parentHeight = 800;
    window.dispatchEvent(new Event('resize'));
    expect(manualHeight(panel)).toBe('620px');
  });

  it('re-clamps when the rail shrinks under it without a viewport resize', async () => {
    // The board refits on a timer after mount, so the rail settles shorter than
    // the panel measured. Nothing dispatches a window resize for that, and the
    // rail clips its overflow: a stale height puts the composer below the cut.
    const resizes = observeResizes();
    window.localStorage.setItem(chatResizeStorageKey, '620');
    let parentHeight = 700;
    const { panel } = mountedChat(() => parentHeight);
    await flushMicrotasks();
    expect(manualHeight(panel)).toBe('528px');

    parentHeight = 420;
    resizes.trigger();
    expect(manualHeight(panel)).toBe('248px');
    expect(window.localStorage.getItem(chatResizeStorageKey)).toBe('620');
  });

  it('resets to automatic height on double-click', async () => {
    window.localStorage.setItem(chatResizeStorageKey, '400');
    const { panel, separator } = mountedChat();
    await flushMicrotasks();
    expect(manualHeight(panel)).toBe('400px');

    separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(manualHeight(panel)).toBe('');
    expect(window.localStorage.getItem(chatResizeStorageKey)).toBeNull();
  });

  it('can grow back after shrinking when the parent content-sizes around it (#298)', async () => {
    // Banqi-rail shape: the chat is alone in a group with no height of its own,
    // and that group sits in a rail that does have one. The group's leftover is
    // always the panel's own height, so a shrink must not become the new max.
    window.localStorage.setItem(chatResizeStorageKey, '340');
    const { panel, separator } = mountedContentSizedChat();
    await flushMicrotasks();
    expect(manualHeight(panel)).toBe('340px');
    expect(separator.getAttribute('aria-valuemax')).toBe('528');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(manualHeight(panel)).toBe('180px');
    expect(separator.getAttribute('aria-valuemax')).toBe('528');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(manualHeight(panel)).toBe('204px');

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(manualHeight(panel)).toBe('528px');
    expect(panel.classList).toContain('review-spectator-chat--manual-height');
  });

  it('leaves the probe invisible when the panel is on automatic height', async () => {
    const { panel, separator } = mountedContentSizedChat();
    await flushMicrotasks();
    expect(separator.getAttribute('aria-valuemax')).toBe('528');
    expect(manualHeight(panel)).toBe('');
    expect(panel.classList).not.toContain('review-spectator-chat--manual-height');
  });

  it('keeps the parent as the ceiling when the panel flex-fills a definite parent', async () => {
    // Same leftover-equals-height reading, opposite meaning: the parent has its
    // own height and the panel fills it. Growing past it would push the
    // composer under the rail's overflow clip.
    const parent = document.createElement('div');
    const panel = document.createElement('section');
    parent.append(panel);
    document.body.append(parent);
    vi.spyOn(parent, 'getBoundingClientRect').mockImplementation(() => rect(400));
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() =>
      rect(Math.min(Number.parseFloat(manualHeight(panel)) || 400, 400)),
    );
    const separator = attachChatResize(panel);
    await flushMicrotasks();

    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(manualHeight(panel)).toBe('400px');
    expect(separator.getAttribute('aria-valuemax')).toBe('400');
  });
});

function mountedChat(parentHeight: () => number = () => 700): {
  panel: HTMLElement;
  separator: HTMLElement;
} {
  const parent = document.createElement('div');
  parent.style.gap = '12px';
  const sibling = document.createElement('section');
  const panel = document.createElement('section');
  parent.append(sibling, panel);
  document.body.append(parent);

  vi.spyOn(parent, 'getBoundingClientRect').mockImplementation(() => rect(parentHeight()));
  vi.spyOn(sibling, 'getBoundingClientRect').mockImplementation(() => rect(160));
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
    return rect(Number.parseFloat(manualHeight(panel)) || 300);
  });

  const separator = attachChatResize(panel);
  return { panel, separator };
}

// A rail with a definite height holding a fixed card and a group that has no
// height of its own: the group is exactly as tall as the chat inside it.
function mountedContentSizedChat(): { panel: HTMLElement; separator: HTMLElement } {
  const rail = document.createElement('div');
  rail.style.gap = '12px';
  const card = document.createElement('section');
  const group = document.createElement('div');
  const panel = document.createElement('section');
  group.append(panel);
  rail.append(card, group);
  document.body.append(rail);

  const panelHeight = (): number => Number.parseFloat(manualHeight(panel)) || 300;
  vi.spyOn(rail, 'getBoundingClientRect').mockImplementation(() => rect(700));
  vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => rect(160));
  vi.spyOn(group, 'getBoundingClientRect').mockImplementation(() => rect(panelHeight()));
  vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => rect(panelHeight()));

  const separator = attachChatResize(panel);
  return { panel, separator };
}

// jsdom has no ResizeObserver, so the panel skips the observer entirely unless a
// test installs one. trigger() stands in for the parent's box changing.
function observeResizes(): { trigger: () => void } {
  const callbacks: ResizeObserverCallback[] = [];
  class StubResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  return {
    trigger: () => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
    },
  };
}

function manualHeight(panel: HTMLElement): string {
  return panel.style.getPropertyValue('--review-chat-manual-height');
}

function rect(height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: 300,
    top: 0,
    width: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}
