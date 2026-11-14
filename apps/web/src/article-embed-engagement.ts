// A reveal inside an article's own frame counts as board use in the existing
// article readout. Loading or scrolling past the frame does not.
import { track } from './analytics.js';
import { EMBED_ENGAGEMENT_MESSAGE } from './embed/embed-card.js';

const frames = new WeakSet<HTMLIFrameElement>();
let listening = false;

function onMessage(event: MessageEvent): void {
  if (
    event.origin !== window.location.origin ||
    !event.source ||
    !event.data ||
    event.data.type !== EMBED_ENGAGEMENT_MESSAGE ||
    event.data.action !== 'solution-revealed'
  )
    return;
  for (const frame of document.querySelectorAll('iframe')) {
    if (!frames.has(frame)) continue;
    if (frame.contentWindow !== event.source) continue;
    const article = frame.closest('[data-article-slug]');
    if (!article) return;
    frames.delete(frame);
    track('article_replay_engaged', {
      slug: article.getAttribute('data-article-slug') ?? '',
      event: frame.title,
      kind: 'decision',
      action: 'solution-revealed',
      annotated: false,
    });
    return;
  }
}

export function trackArticleDecisionFrame(frame: HTMLIFrameElement): void {
  if (new URL(frame.src, window.location.href).origin !== window.location.origin) return;
  frames.add(frame);
  if (listening) return;
  listening = true;
  window.addEventListener('message', onMessage);
}
