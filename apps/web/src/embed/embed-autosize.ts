// Host side of the embed height message: a page that frames one of our embeds
// (an article, a forum post) lets the card inside say how tall the frame should
// be, instead of guessing with an aspect ratio per block.
//
// Each embed block used to carry a hand-set aspect ([702, 780] and the like).
// The card inside sizes its board from the frame's width and the variant's
// board shape, so a guess that fit one variant at one width left empty space
// under the card at another (Brian, 2026-10-03: "big vertical space after the
// embeds ... I thought we solved it scalably across surfaces"). The card now
// posts the height that fits its width (EMBED_HEIGHT_MESSAGE, embed-card.ts);
// the frame keeps its aspect ratio only until that message arrives, and gets it
// back when the card hands the height to the host's CSS (null, the stacked
// phone layout).

import { EMBED_HEIGHT_MESSAGE } from './embed-card.js';

const frames = new Set<HTMLIFrameElement>();
let listening = false;

function frameOrigin(frame: HTMLIFrameElement): string | null {
  try {
    return new URL(frame.src, window.location.href).origin;
  } catch {
    return null;
  }
}

function onMessage(event: MessageEvent): void {
  const data = event.data as { type?: unknown; height?: unknown } | null;
  if (!data || typeof data !== 'object' || data.type !== EMBED_HEIGHT_MESSAGE) return;
  for (const frame of frames) {
    if (!frame.isConnected) {
      frames.delete(frame);
      continue;
    }
    if (frame.contentWindow !== event.source) continue;
    // Only the frame's own page may size it.
    if (frameOrigin(frame) !== event.origin) return;
    const height = data.height;
    if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
      frame.style.aspectRatio = 'auto';
      frame.style.height = `${Math.ceil(height)}px`;
    } else {
      frame.style.height = '';
      frame.style.aspectRatio = frame.dataset.aspect ?? '';
    }
    return;
  }
}

/** Let the embed inside `frame` set its height. The frame's inline aspect
 *  ratio, if any, is the placeholder until the embed reports. */
export function autosizeEmbedFrame(frame: HTMLIFrameElement): void {
  if (frame.style.aspectRatio) frame.dataset.aspect = frame.style.aspectRatio;
  frames.add(frame);
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('message', onMessage);
}
