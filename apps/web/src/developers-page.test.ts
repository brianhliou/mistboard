import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_DEFAULT_WIDTH,
  EMBED_MAX_WIDTH,
  EMBED_MIN_WIDTH,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  analysisSnippet,
  embedSnippet,
  exampleEmbedUrl,
  exampleStudyUrl,
  gameSnippet,
  lineSnippet,
  mountDevelopers,
  oembedRequestUrl,
  puzzleSnippet,
  tvSnippet,
} from './developers-page.js';
import { embedRouteFromPath, embedStudyRouteFromPath } from './embed/embed-route.js';

const ORIGIN = 'https://mistboard.com';

// A docs page is a promise about behaviour, and the usual way it goes wrong is
// that the behaviour moves and the prose does not. The numbers cannot drift
// because both sides import them from @mistboard/game, so what is left to check
// is the part that is still hand-written: the URLs in the snippet.
describe('the developers page documents something real', () => {
  it('writes a snippet whose src the embed router actually accepts', () => {
    const snippet = embedSnippet(ORIGIN);
    const src = /src="([^"]+)"/.exec(snippet)?.[1];
    expect(src, 'snippet has no src').toBeTruthy();
    const path = new URL(src as string).pathname;
    // The real matcher from the real route, not a copy of its regex.
    expect(embedStudyRouteFromPath(path), `${path} is not an embed route`).not.toBeNull();
  });

  it('writes one snippet per embed kind, each with a src the router accepts', () => {
    const expected: Array<[string, string]> = [
      [gameSnippet(ORIGIN), 'game'],
      [tvSnippet(ORIGIN), 'tv'],
      [tvSnippet(ORIGIN, 'xiangqi'), 'tv'],
      [puzzleSnippet(ORIGIN), 'puzzle'],
      [analysisSnippet(ORIGIN), 'analysis'],
      [lineSnippet(ORIGIN), 'line'],
    ];
    for (const [snippet, kind] of expected) {
      const src = /src="([^"]+)"/.exec(snippet)?.[1];
      expect(src, `${kind} snippet has no src`).toBeTruthy();
      const url = new URL(src as string);
      expect(embedRouteFromPath(url.pathname)?.kind, url.pathname).toBe(kind);
      expect(snippet).toContain('loading="lazy"');
    }
    expect(
      new URL(/src="([^"]+)"/.exec(tvSnippet(ORIGIN, 'xiangqi'))?.[1] as string).searchParams.get(
        'channel',
      ),
    ).toBe('xiangqi');
  });

  it('points the oEmbed example at a URL the provider pattern matches', () => {
    const target = new URL(oembedRequestUrl(ORIGIN)).searchParams.get('url');
    expect(target).toBe(exampleStudyUrl(ORIGIN));
    // The provider accepts the permalink AND the embed path; both resolve to
    // the same chapter, which is the property the page claims.
    const permalink = new URL(exampleStudyUrl(ORIGIN)).pathname;
    const embed = new URL(exampleEmbedUrl(ORIGIN)).pathname;
    const ids = /\/study\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(permalink);
    expect(embed).toBe(`/embed/study/${ids?.[1]}/${ids?.[2]}`);
  });

  it('sizes the snippet at the contract default', () => {
    const snippet = embedSnippet(ORIGIN);
    expect(snippet).toContain(`width="${EMBED_DEFAULT_WIDTH}"`);
    expect(snippet).toContain(`height="${EMBED_DEFAULT_HEIGHT}"`);
    // max-width is what keeps a fixed-width iframe from overflowing a phone,
    // and the page tells people to keep it, so it had better be in there.
    expect(snippet).toContain('max-width:100%');
  });

  it('renders the live example as a real frame, and states the real limits', () => {
    const root = document.createElement('div');
    mountDevelopers(root);

    const frame = root.querySelector<HTMLIFrameElement>('.developers-example iframe');
    expect(frame, 'no live example on the page').not.toBeNull();
    expect(embedStudyRouteFromPath(frame?.getAttribute('src') ?? '')).not.toBeNull();
    // Every embed kind is proven by a real frame on the page, not just described.
    const kinds = [...root.querySelectorAll<HTMLIFrameElement>('.developers-example iframe')].map(
      (el) => embedRouteFromPath(new URL(el.getAttribute('src') ?? '', ORIGIN).pathname)?.kind,
    );
    expect(kinds).toEqual(['study', 'game', 'tv', 'puzzle', 'analysis', 'line']);

    const text = root.textContent ?? '';
    expect(text).toContain(String(EMBED_MIN_WIDTH));
    expect(text).toContain(String(EMBED_MAX_WIDTH));
    // Every frameable surface has a section, and the API reference is linked.
    for (const heading of [
      'Embed a game',
      'Embed Mistboard TV',
      'Embed the daily puzzle',
      'Embed the analysis board',
      'HTTP API',
    ]) {
      expect(text).toContain(heading);
    }
    expect(root.querySelector('a[href="/api-docs"]')).not.toBeNull();
  });

  it('offers a copy button for every code block', () => {
    const root = document.createElement('div');
    mountDevelopers(root);
    const blocks = root.querySelectorAll('.developers-code');
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    for (const block of blocks) {
      expect(
        block.querySelector('.developers-copy'),
        'code block without a copy button',
      ).not.toBeNull();
    }
  });
});
