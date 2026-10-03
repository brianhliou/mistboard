import { afterEach, describe, expect, it } from 'vitest';
import { autosizeEmbedFrame } from './embed-autosize.js';
import { EMBED_HEIGHT_MESSAGE } from './embed-card.js';

// The host half of the embed height message: an article frame starts on its
// block's aspect ratio and takes the height the card inside reports, so no
// hand-set aspect leaves empty space under the card.

function frame(aspect = '702 / 780'): HTMLIFrameElement {
  const el = document.createElement('iframe');
  el.src = '/embed/study/abc/def';
  el.style.aspectRatio = aspect;
  document.body.append(el);
  autosizeEmbedFrame(el);
  return el;
}

function post(from: Window | null, height: number | null, origin = window.location.origin): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: EMBED_HEIGHT_MESSAGE, height },
      origin,
      source: from,
    }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('autosizeEmbedFrame', () => {
  it('sizes the frame to the height its embed reports', () => {
    const el = frame();
    post(el.contentWindow, 661.4);
    expect(el.style.height).toBe('662px');
    expect(el.style.aspectRatio).toBe('auto');
  });

  it("hands the height back to the host's CSS when the embed reports none", () => {
    const el = frame();
    post(el.contentWindow, 661);
    post(el.contentWindow, null);
    expect(el.style.height).toBe('');
    expect(el.style.aspectRatio).toBe('702 / 780');
  });

  it('sizes only the frame the message came from', () => {
    const a = frame();
    const b = frame('702 / 600');
    post(b.contentWindow, 500);
    expect(a.style.height).toBe('');
    expect(b.style.height).toBe('500px');
  });

  it("ignores a message from another origin than the frame's page", () => {
    const el = frame();
    post(el.contentWindow, 400, 'https://elsewhere.example');
    expect(el.style.height).toBe('');
  });
});
