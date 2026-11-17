import { afterEach, describe, expect, it } from 'vitest';
import { autosizeEmbedFrame } from './embed-autosize.js';
import { EMBED_HEIGHT_MESSAGE } from './embed-card.js';

// The host half of the embed height message: an article frame starts on its
// block's aspect ratio and takes the height the card inside reports, so no
// hand-set aspect leaves empty space under the card.

function frame(aspect = '702 / 780'): HTMLIFrameElement {
  const el = document.createElement('iframe');
  el.src = '/embed/study/abc/def';
  // Create a distinct browsing context without loading the embed over HTTP.
  // happy-dom 21 leaves contentWindow null when iframe page loading is disabled.
  el.srcdoc = '';
  el.style.aspectRatio = aspect;
  document.body.append(el);
  expect(el.contentWindow).not.toBeNull();
  autosizeEmbedFrame(el);
  return el;
}

function post(
  from: Window | null,
  height: number | null,
  origin = window.location.origin,
  fullReadingHeight?: boolean,
): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: EMBED_HEIGHT_MESSAGE, height, fullReadingHeight },
      origin,
      source: from,
    }),
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('autosizeEmbedFrame', () => {
  it('uncaps only the study frame reporting a full reading height', () => {
    const study = frame();
    const game = frame();
    post(study.contentWindow, 926, window.location.origin, true);
    post(game.contentWindow, 926);
    expect(study.classList.contains('embed-full-reading-height')).toBe(true);
    expect(game.classList.contains('embed-full-reading-height')).toBe(false);
    expect(study.style.height).toBe('926px');
    expect(game.style.height).toBe('926px');
  });

  it('restores the cap when the frame stops reporting a full reading height', () => {
    const el = frame();
    post(el.contentWindow, 926, window.location.origin, true);
    // Apply the cap change even when the one-pixel oscillation guard keeps the height.
    post(el.contentWindow, 925);
    expect(el.style.height).toBe('926px');
    expect(el.classList.contains('embed-full-reading-height')).toBe(false);
    post(el.contentWindow, 926, window.location.origin, true);
    post(el.contentWindow, null);
    expect(el.classList.contains('embed-full-reading-height')).toBe(false);
  });

  it('does not uncap a frame for a full reading height message from another origin', () => {
    const el = frame();
    post(el.contentWindow, 926, 'https://elsewhere.example', true);
    expect(el.classList.contains('embed-full-reading-height')).toBe(false);
  });

  it('sizes the frame to the height its embed reports', () => {
    const el = frame();
    post(el.contentWindow, 661.4);
    expect(el.style.height).toBe('662px');
    expect(el.style.aspectRatio).toBe('auto');
  });

  it('settles on the taller of two heights a card flips between, and still shrinks for real', () => {
    const el = frame();
    post(el.contentWindow, 662);
    post(el.contentWindow, 663);
    post(el.contentWindow, 662);
    post(el.contentWindow, 663);
    post(el.contentWindow, 662);
    expect(el.style.height).toBe('663px');
    post(el.contentWindow, 640);
    expect(el.style.height).toBe('640px');
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
