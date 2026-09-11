import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPlayableEnginesOnce,
  loadPlayableEnginesWithRetry,
  renderLandingShellForPrerender,
  shouldUseBundledShowcaseDemos,
  watchHrefForTvGame,
} from './landing.js';

const ROSTER = [
  { id: 'python-v2-v1.0', name: 'Misty 1.0', familyName: 'Misty', kind: 'container' },
];

describe('playable engines loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns null on an empty roster (never the placeholder)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ engines: [] })),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns null when the fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect(await fetchPlayableEnginesOnce()).toBeNull();
  });

  it('returns the roster on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ engines: ROSTER })),
    );
    expect(await fetchPlayableEnginesOnce()).toEqual(ROSTER);
  });

  it('retries transient failures and resolves once the roster is available', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValue(jsonResponse({ engines: ROSTER }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();

    const promise = loadPlayableEnginesWithRetry();
    await vi.runAllTimersAsync();

    expect(await promise).toEqual(ROSTER);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchSpy = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.useFakeTimers();

    const promise = loadPlayableEnginesWithRetry();
    await vi.runAllTimersAsync();

    expect(await promise).toBeNull();
    // initial attempt + one per backoff delay (4 delays) = 5 fetches
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});

describe('homepage TV widget link', () => {
  // Regression (2026-08-14): the widget's href was baked once as
  // /watch?channel=top, so clicking the board landed the visitor on whatever
  // game the channel's own head happened to be — a different game than the one
  // they had just been looking at.
  it('hands /watch the exact room a frozen or aired board is showing', () => {
    expect(watchHrefForTvGame('frozen', 'xq_a16ddaaa')).toBe('/watch?channel=top&game=xq_a16ddaaa');
    expect(watchHrefForTvGame('replay', 'jgf_1234')).toBe('/watch?channel=top&game=jgf_1234');
  });

  it('links a LIVE board to the bare channel so /watch re-elects the live game', () => {
    // ?game= resolves against the COMPLETED feed only; a still-running room is
    // not in it, and /watch runs the same top-election poll anyway.
    expect(watchHrefForTvGame('live', 'xq_live')).toBe('/watch?channel=top');
  });

  it('escapes the room id', () => {
    expect(watchHrefForTvGame('frozen', 'a b&c')).toBe('/watch?channel=top&game=a%20b%26c');
  });
});

describe('landing shell', () => {
  it('uses bundled showcase games only when a demo is explicitly requested', () => {
    expect(shouldUseBundledShowcaseDemos('')).toBe(false);
    expect(shouldUseBundledShowcaseDemos('?only=xiangqi')).toBe(false);
    expect(shouldUseBundledShowcaseDemos('?demo=engine-v2-g0000')).toBe(true);
  });

  it('keeps the grid-area hooks the homepage band CSS keys on', () => {
    // landing.css places the bands via these class names (grid-areas
    // left/panel/play, puzzle/forum/chat, news/blogs+videos/studies); renaming
    // them in the DOM without updating landing.css would silently break the
    // layout.
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const demo = wrap.querySelector('.landing-demo');
    expect(demo).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-left-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-lobby-panel')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-play-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-puzzle-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-forum-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-chat-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-articles-row')).not.toBeNull();
    // Bands 3-4 side rails: News (left) and Top studies (right) span both rows.
    expect(demo?.querySelector(':scope > .landing-news-column')).not.toBeNull();
    expect(demo?.querySelector(':scope > .landing-studies-column')).not.toBeNull();
    // Band 4: the video strip sits in its own grid-area beneath the blog row.
    const videoRow = demo?.querySelector(':scope > .landing-videos-row');
    expect(videoRow).not.toBeNull();
    expect(videoRow?.querySelectorAll('.landing-video-card').length).toBeGreaterThan(0);
    expect(demo?.querySelector('.landing-left-column .landing-board-column')).not.toBeNull();
    // The support/store pair left the homepage (patronage stays in the nav).
    expect(demo?.querySelector('.landing-support-row')).toBeNull();
  });

  it('leads the left rail with the event-banner slot over the viewer, News below', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const leftColumn = wrap.querySelector('.landing-left-column');
    // The event-banner slot mounts first (it collapses via CSS when empty),
    // the game viewer below it.
    expect(leftColumn?.firstElementChild?.classList.contains('landing-event-banners')).toBe(true);
    expect(leftColumn?.querySelector('.landing-viewer-column')).not.toBeNull();
    // The News feed is back on the homepage, in the bands-3/4 left rail (not
    // band 1); chat left the play rail for the band-2 right slot.
    expect(wrap.querySelector('.landing-left-column .landing-announcements')).toBeNull();
    expect(wrap.querySelector('.landing-news-column .landing-announcements')).not.toBeNull();
    expect(wrap.querySelector('.landing-play-column .landing-chat-mount')).toBeNull();
    expect(wrap.querySelector('.landing-chat-column .landing-chat-mount')).not.toBeNull();
  });

  it('mounts the band-2 widgets and the single unified Play button', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    expect(wrap.querySelector('.landing-forum-column .landing-forum')).not.toBeNull();
    // Top studies moved down to the bands-3/4 right rail; chat took its band-2 slot.
    expect(wrap.querySelector('.landing-studies-column .landing-study-widget')).not.toBeNull();
    // One play action only, and it is the primary unified entry.
    const actions = wrap.querySelectorAll('.landing-play-column .landing-play-action');
    expect(actions.length).toBe(1);
    expect(actions[0]?.classList.contains('landing-play-action-primary')).toBe(true);
  });

  it('links only the About Mistboard tagline tail', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderLandingShellForPrerender();

    const about = wrap.querySelector('.landing-about');
    const link = about?.querySelector<HTMLAnchorElement>('a[href="/about"]');

    expect(about?.textContent).toBe(
      'Strategy games including Xiangqi (Chinese chess), Banqi, Jieqi, Jungle Chess and more. Free in your browser. About Mistboard...',
    );
    expect(link?.textContent).toBe('About Mistboard...');
    expect(about?.childNodes[0]?.textContent).toBe(
      'Strategy games including Xiangqi (Chinese chess), Banqi, Jieqi, Jungle Chess and more. Free in your browser. ',
    );
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}
