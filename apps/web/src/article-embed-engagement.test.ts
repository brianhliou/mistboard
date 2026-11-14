import { afterEach, describe, expect, it } from 'vitest';
import { setPostHogInstance } from './analytics.js';
import { trackArticleDecisionFrame } from './article-embed-engagement.js';
import { EMBED_ENGAGEMENT_MESSAGE } from './embed/embed-card.js';

afterEach(() => document.body.replaceChildren());

function fixture() {
  const events: Array<{ name: string; props?: Record<string, unknown> }> = [];
  setPostHogInstance({
    capture: (name: string, props?: Record<string, unknown>) => events.push({ name, props }),
  } as never);
  const article = document.createElement('article');
  article.dataset.articleSlug = 'test-player';
  const frame = document.createElement('iframe');
  frame.src = '/embed/line/xiangqi?solution=hidden';
  frame.srcdoc = '';
  frame.title = 'Find the reply';
  article.append(frame);
  document.body.append(article);
  expect(frame.contentWindow).not.toBeNull();
  trackArticleDecisionFrame(frame);
  const reveal = (overrides: MessageEventInit = {}) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { type: EMBED_ENGAGEMENT_MESSAGE, action: 'solution-revealed' },
        ...overrides,
      }),
    );
  return { article, frame, reveal, events };
}

describe('article decision engagement', () => {
  it('counts an actual reveal once with the parent article slug', () => {
    const f = fixture();
    expect(f.events).toHaveLength(0);
    f.reveal();
    f.reveal();
    expect(f.events.filter((event) => event.name === 'article_replay_engaged')).toEqual([
      {
        name: 'article_replay_engaged',
        props: expect.objectContaining({
          slug: 'test-player',
          kind: 'decision',
          action: 'solution-revealed',
        }),
      },
    ]);
  });

  it('rejects another origin, another frame, and unrelated frame messages', () => {
    const f = fixture();
    const unrelated = document.createElement('iframe');
    unrelated.srcdoc = '';
    document.body.append(unrelated);
    f.reveal({ origin: 'https://unrelated.example' });
    f.reveal({ source: null });
    f.reveal({ source: unrelated.contentWindow });
    f.reveal({ data: { type: EMBED_ENGAGEMENT_MESSAGE, action: 'loaded' } });
    f.reveal({ data: { type: 'mistboard-embed-height', height: 500 } });
    expect(f.events).toHaveLength(0);
    f.reveal();
    expect(f.events).toHaveLength(1);
  });

  it('does not count a removed article or an external embed', () => {
    const f = fixture();
    f.article.remove();
    f.reveal();
    expect(f.events).toHaveLength(0);
    f.frame.src = 'https://unrelated.example/embed';
    document.body.append(f.article);
    // A new external frame is not registered by the article bridge.
    const external = document.createElement('iframe');
    external.src = f.frame.src;
    external.srcdoc = '';
    f.article.append(external);
    trackArticleDecisionFrame(external);
    f.reveal({ source: external.contentWindow });
    expect(f.events).toHaveLength(0);
  });
});
