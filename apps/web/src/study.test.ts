import { afterEach, describe, expect, it, vi } from 'vitest';
import { chapterIdFromStudyPath, mountStudy, studyChapterPath } from './study.js';
import { studyDraftKey } from './study-autosave.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
});

// mountStudy resolves once the code-split board stack has mounted, so these
// tests await it rather than polling. A vi.waitFor around that mount raced the
// lazy import against a fixed deadline and failed under release load (#299).

describe('study creator workspace', () => {
  it('renders navigation-first owner controls and an under-board authoring dock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === '/api/studies/uXnuObfx') {
          return jsonResponse({
            study: {
              id: 'uXnuObfx',
              name: 'Cannon manual',
              description: 'Attacking patterns on the central file.',
              visibility: 'private',
              isOwner: true,
              likeCount: 0,
              likedByViewer: false,
            },
            chapters: [
              {
                id: 'chapter1',
                name: 'Central cannon',
                variant: 'xiangqi',
                orientation: 'red',
                root: { version: 1, root: { children: [] } },
                version: 1,
                gamebook: false,
              },
            ],
          });
        }
        if (url === '/api/chat/study/uXnuObfx') return jsonResponse({ lines: [] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const root = document.createElement('div');
    document.body.append(root);

    await mountStudy(root, 'uXnuObfx');
    expect(root.querySelector('.review-shell--study')).not.toBeNull();

    expect(
      root.querySelector<HTMLImageElement>('.study-page__thumbnail img')?.getAttribute('src'),
    ).toBe('/study-thumbnails/seven-stars.webp');
    expect(root.querySelector('.study-chapters__head')?.textContent).toContain('1 Chapter');
    expect(root.querySelector('.study-chapters__settings')).not.toBeNull();
    expect(root.querySelector('.study-chapters__chapter-settings')).not.toBeNull();
    expect(root.querySelector('.study-chapters__add')).not.toBeNull();
    expect(root.querySelector('.study-actions__name')).toBeNull();
    expect(root.querySelector('.review-rail-main .annotation-editor')).toBeNull();
    expect(root.querySelector<HTMLElement>('.study-actions__status')?.textContent).toBe('Saved');

    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.review-underboard-tab')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'About',
      'Comment',
      'Glyphs',
      'Lesson',
      'Share & export',
    ]);

    // The description reads in full under the board, outside every tab, and
    // the rail keeps only the title: no clamped copy and no Show more.
    const description = root.querySelector<HTMLElement>(
      '.review-underboard-stack .study-description',
    );
    expect(description?.textContent).toBe('Attacking patterns on the central file.');
    expect(description?.closest('.review-underboard-panel')).toBeNull();
    expect(root.querySelector('.study-page__title-copy .review-info-card__summary')).toBeNull();
    expect(root.querySelector('.review-info-card__summary')).toBeNull();
    expect(root.querySelector('.study-page__summary-toggle')).toBeNull();
    expect(
      root.querySelector('.study-page__title-copy .review-info-card__title')?.textContent,
    ).toBe('Cannon manual');

    root.querySelector<HTMLButtonElement>('.study-chapters__settings')?.click();
    const studyDialog = document.querySelector<HTMLDialogElement>(
      'dialog[data-study-dialog="study-settings"]',
    );
    expect(studyDialog).not.toBeNull();
    expect(studyDialog?.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(
      'Cannon manual',
    );
    expect(studyDialog?.querySelector('textarea')?.value).toBe(
      'Attacking patterns on the central file.',
    );
    studyDialog?.close();

    root.querySelector<HTMLButtonElement>('.study-chapters__chapter-settings')?.click();
    const chapterDialog = document.querySelector<HTMLDialogElement>(
      'dialog[data-study-dialog="chapter-settings"]',
    );
    expect(chapterDialog).not.toBeNull();
    expect(chapterDialog?.textContent).toContain('Duplicate chapter');
    expect(chapterDialog?.textContent).not.toContain('Delete chapter');
  });

  it('lets an admin add a public study to Staff picks without owner controls', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/studies/study1') {
        return jsonResponse({
          study: {
            id: 'study1',
            name: 'Archive study',
            description: '',
            visibility: 'public',
            isOwner: false,
            featuredAt: null,
            canFeature: true,
            likeCount: 0,
            likedByViewer: false,
          },
          chapters: [
            {
              id: 'chapter1',
              name: 'First',
              variant: 'xiangqi',
              orientation: 'red',
              root: { version: 1, root: { children: [] } },
              version: 1,
              gamebook: false,
            },
          ],
        });
      }
      if (url === '/api/chat/study/study1') return jsonResponse({ lines: [] });
      if (url === '/api/admin/studies/study1/featured' && init?.method === 'PUT') {
        expect(JSON.parse(String(init.body))).toEqual({ featured: true });
        return jsonResponse({ featuredAt: '2026-07-24T04:00:00.000Z' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);

    await mountStudy(root, 'study1');
    expect(root.querySelector('.review-shell--study')).not.toBeNull();

    expect(root.querySelector('.study-chapters__settings')).toBeNull();
    // An admin sees both the heart and the star; the tooltips say they differ:
    // the heart is the reader's own like (their Favorites), the star curates.
    const like = root.querySelector<HTMLButtonElement>('.study-actions__like');
    expect(like?.title).toBe('Like this study and save it to your Favorites');
    expect(like?.getAttribute('aria-label')).toBe(like?.title);
    const feature = root.querySelector<HTMLButtonElement>('.study-chapters__featured');
    expect(feature?.getAttribute('aria-label')).toBe('Feature in Staff picks (admins only)');
    expect(root.querySelector('.study-description')).toBeNull();
    feature?.click();

    await vi.waitFor(() => expect(feature?.getAttribute('aria-pressed')).toBe('true'));
    expect(feature?.getAttribute('aria-label')).toBe('Remove from Staff picks (admins only)');
    const railStatus = root.querySelector<HTMLElement>('.study-chapters__status');
    expect(railStatus?.textContent).toBe('Featured');
    // The admin's readout opens as the hidden viewer one; curating must reveal it.
    expect(railStatus?.hidden).toBe(false);
  });

  it('tells a signed-in non-owner their moves are not saved to the study', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/studies/study1') {
        return jsonResponse({
          study: {
            id: 'study1',
            name: 'Someone else\u2019s study',
            description: '',
            visibility: 'public',
            isOwner: false,
            featuredAt: null,
            canFeature: false,
            likeCount: 0,
            likedByViewer: false,
          },
          chapters: [
            {
              id: 'chapter1',
              name: 'First',
              variant: 'xiangqi',
              orientation: 'red',
              root: { version: 1, root: { children: [] } },
              version: 1,
              gamebook: false,
            },
          ],
        });
      }
      if (url === '/api/chat/study/study1') return jsonResponse({ lines: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);

    await mountStudy(root, 'study1');
    expect(root.querySelector('.review-shell--study')).not.toBeNull();

    // The board takes moves (it is an analysis board) and nothing used to say
    // where they went, so a non-owner read their scratch line as stored on
    // someone else's study. Quiet until they touch it...
    const status = root.querySelector<HTMLElement>('.study-actions__status');
    expect(status).not.toBeNull();
    expect(status?.hidden).toBe(true);

    // ...then the truth, on the first move they play.
    clickSquare(root, 'h3');
    clickSquare(root, 'e3');

    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe('Not saved');
    expect(status?.dataset.state).toBe('viewer');
    expect(status?.title).toContain('not saved to it');
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
});

describe('study chapter permalinks', () => {
  const chapterSwitchFixture = (
    opts: { scores?: 'first' | 'both' | 'stale'; owner?: boolean } = {},
  ) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/studies/study1') {
        return jsonResponse({
          study: {
            id: 'study1',
            name: 'Two chapters',
            description: '',
            visibility: 'public',
            isOwner: opts.owner ?? false,
            likeCount: 0,
            likedByViewer: false,
          },
          chapters: ['chapter1', 'chapter2'].map((id, index) => ({
            id,
            name: index === 0 ? 'First' : 'Second',
            variant: 'xiangqi',
            orientation: 'red',
            root: {
              version: 1,
              root: { children: [{ uci: 'h3e3', children: [] }] },
            },
            version: 1,
            gamebook: false,
            ...(opts.scores && (index === 0 || opts.scores === 'both')
              ? {
                  scoreSeries: {
                    side: 'red',
                    series: [
                      {
                        name: `Engine A${index + 1}`,
                        color: 'a',
                        values: opts.scores === 'stale' ? [0.5, 0.6, 0.7] : [0.5, 0.6],
                      },
                      { name: 'Engine B', color: 'b', values: [0.5, 0.4] },
                    ],
                  },
                }
              : {}),
          })),
        });
      }
      if (url === '/api/chat/study/study1') return jsonResponse({ lines: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);
    return { root, fetcher };
  };

  it('keeps the chapter rail and nav mounted when switching chapters', async () => {
    const { root, fetcher } = chapterSwitchFixture();
    await mountStudy(root, 'study1');
    const rail = root.querySelector('.study-chapters');
    const nav = root.querySelector('.site-nav');
    const aside = root.querySelector('.review-shell__left');
    const chat = root.querySelector('.review-spectator-chat');
    const board = root.querySelector('.review-shell__center');
    const rows = [...root.querySelectorAll('.study-chapters__row')];
    const links = [...root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')];
    expect(rail).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(chat).not.toBeNull();
    expect(root.querySelector('.embed-score-chart')).toBeNull();
    expect(links[0]?.getAttribute('aria-current')).toBe('page');

    links[1]!.click();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/study/study1/chapter2'));
    await vi.waitFor(() => expect(root.querySelector('.review-shell__center')).not.toBe(board));
    expect(root.querySelector('.study-chapters')).toBe(rail);
    expect(root.querySelector('.site-nav')).toBe(nav);
    expect(root.querySelector('.review-shell__left')).toBe(aside);
    expect(root.querySelector('.review-spectator-chat')).toBe(chat);
    expect(rows[0]?.classList.contains('is-active')).toBe(false);
    expect(rows[1]?.classList.contains('is-active')).toBe(true);
    expect(links[0]?.hasAttribute('aria-current')).toBe(false);
    expect(links[1]?.getAttribute('aria-current')).toBe('page');
    expect(fetcher.mock.calls.filter(([url]) => url === '/api/chat/study/study1')).toHaveLength(1);
  });

  it('draws scoreSeries in the active Computer analysis tab without stored analysis', async () => {
    const { root } = chapterSwitchFixture({ scores: 'first' });
    await mountStudy(root, 'study1');
    expect(root.querySelector<HTMLButtonElement>('[data-replay="next"]')?.disabled).toBe(false);
    const chart = root.querySelector<HTMLElement>('.review-underboard .embed-score-chart');
    expect(chart).not.toBeNull();
    const body = chart?.closest<HTMLElement>('.review-underboard-panel__body');
    expect(body?.parentElement?.className).toBe('review-underboard-bodies');
    expect(body?.hidden).toBe(false);
    expect(root.querySelector('.review-underboard-tabs')?.nextElementSibling).toBe(
      body?.parentElement,
    );
    expect(root.querySelector('.review-underboard-tab--active')?.getAttribute('data-tab')).toBe(
      'analysis',
    );
    expect(root.querySelector('[data-tab="analysis"]')?.textContent).toBe('Computer analysis');
    expect(chart?.querySelectorAll('.embed-score-chart__line')).toHaveLength(2);
    const plot = chart!.querySelector<HTMLElement>('.embed-score-chart__plot')!;
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    plot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 100 }));
    expect(root.querySelector<HTMLButtonElement>('[data-replay="next"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('[data-replay="prev"]')?.disabled).toBe(false);
    expect(chart?.dataset.ply).toBe('1');
    root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
    expect(chart?.dataset.ply).toBe('0');

    root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')[1]!.click();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/study/study1/chapter2'));
    await vi.waitFor(() => expect(root.querySelector('.embed-score-chart')).toBeNull());
    expect(root.querySelector('.review-shell__center')).not.toBeNull();
    expect(root.querySelector('[data-tab="analysis"]')).toBeNull();
    root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')[0]!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('.embed-score-chart')).toHaveLength(1));
  });

  it('replaces a scored chapter chart when reusing the shell', async () => {
    const { root } = chapterSwitchFixture({ scores: 'both' });
    await mountStudy(root, 'study1');
    const shell = root.querySelector('.study-review');
    const firstChart = root.querySelector('.embed-score-chart');
    root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')[1]!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.embed-score-chart__legend')?.textContent).toContain('Engine A2'),
    );
    expect(root.querySelector('.study-review')).toBe(shell);
    expect(firstChart?.isConnected).toBe(false);
    expect(root.querySelectorAll('.embed-score-chart')).toHaveLength(1);
    expect(root.querySelector('.review-underboard-panel__body .embed-score-chart')).not.toBeNull();
    expect(root.querySelector('.review-underboard-tab--active')?.getAttribute('data-tab')).toBe(
      'analysis',
    );
  });

  it('opens a scored chapter on Computer analysis for its owner', async () => {
    const { root } = chapterSwitchFixture({ scores: 'first', owner: true });
    await mountStudy(root, 'study1');
    expect(root.querySelector('.review-underboard-tab--active')?.getAttribute('data-tab')).toBe(
      'analysis',
    );
  });

  it('omits a stale scoreSeries and its Computer analysis tab', async () => {
    const { root } = chapterSwitchFixture({ scores: 'stale' });
    await mountStudy(root, 'study1');
    expect(root.querySelector('.embed-score-chart')).toBeNull();
    expect(root.querySelector('[data-tab="analysis"]')).toBeNull();
  });

  it('preserves locale prefixes and rejects another study chapter path', () => {
    expect(studyChapterPath('study1', 'chapter2', '/zh-hans/study/study1')).toBe(
      '/zh-hans/study/study1/chapter2',
    );
    expect(studyChapterPath('study1', 'chapter2', '/study/study1')).toBe('/study/study1/chapter2');
    expect(chapterIdFromStudyPath('/study/study1/chapter2', 'study1')).toBe('chapter2');
    expect(chapterIdFromStudyPath('/study/other/chapter2', 'study1')).toBeNull();
  });

  it('opens a linked chapter and updates history when switching chapters', async () => {
    window.history.replaceState({}, '', '/study/study1/chapter2');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url === '/api/studies/study1') {
          return jsonResponse({
            study: {
              id: 'study1',
              name: 'Cannon manual',
              description: '',
              visibility: 'public',
              isOwner: false,
              likeCount: 0,
              likedByViewer: false,
            },
            chapters: [
              {
                id: 'chapter1',
                name: 'First',
                variant: 'xiangqi',
                orientation: 'red',
                root: { version: 1, root: { children: [] } },
                version: 1,
                gamebook: false,
              },
              {
                id: 'chapter2',
                name: 'Second',
                variant: 'xiangqi',
                orientation: 'red',
                root: { version: 1, root: { children: [] } },
                version: 1,
                gamebook: false,
              },
            ],
          });
        }
        if (url === '/api/chat/study/study1') return jsonResponse({ lines: [] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    const root = document.createElement('div');
    document.body.append(root);

    await mountStudy(root, 'study1', 'chapter2');
    expect(root.querySelector('.study-chapters__row.is-active')?.textContent).toContain('Second');
    root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')[0]?.click();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/study/study1/chapter1'));
    await vi.waitFor(() =>
      expect(root.querySelector('.study-chapters__row.is-active')?.textContent).toContain('First'),
    );
  });

  it('flushes a recovered local draft before switching chapters or closing', async () => {
    const storage = memoryStorage();
    const pendingSave = deferred<Response>();
    storage.setItem(
      studyDraftKey('study1', 'chapter1'),
      JSON.stringify({
        schemaVersion: 1,
        baseVersion: 1,
        tree: {
          version: 1,
          root: { children: [{ uci: 'h2e2', children: [] }] },
        },
        updatedAt: 123,
      }),
    );
    vi.stubGlobal('localStorage', storage);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/studies/study1' && !init?.method) {
        return jsonResponse({
          study: {
            id: 'study1',
            name: 'Cannon manual',
            description: '',
            visibility: 'private',
            isOwner: true,
            likeCount: 0,
            likedByViewer: false,
          },
          chapters: [
            {
              id: 'chapter1',
              name: 'First',
              variant: 'xiangqi',
              orientation: 'red',
              root: { version: 1, root: { children: [] } },
              version: 1,
              gamebook: false,
            },
            {
              id: 'chapter2',
              name: 'Second',
              variant: 'xiangqi',
              orientation: 'red',
              root: { version: 1, root: { children: [] } },
              version: 1,
              gamebook: false,
            },
          ],
        });
      }
      if (url === '/api/chat/study/study1') return jsonResponse({ lines: [] });
      if (url === '/api/studies/study1/chapters/chapter1' && init?.method === 'PATCH') {
        return pendingSave.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);

    await mountStudy(root, 'study1', 'chapter1');
    expect(root.querySelector('.review-shell--study')).not.toBeNull();
    expect(root.querySelector('.study-actions__status')?.textContent).toBe('Recovered local draft');

    root.querySelectorAll<HTMLAnchorElement>('.study-chapters__link')[1]?.click();
    await vi.waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/studies/study1/chapters/chapter1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    expect(window.location.pathname).toBe('/study/study1/chapter1');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    pendingSave.resolve(jsonResponse({ chapter: { version: 2 } }));
    await vi.waitFor(() => expect(window.location.pathname).toBe('/study/study1/chapter2'));
    expect(storage.getItem(studyDraftKey('study1', 'chapter1'))).toBeNull();
  });
});

function clickSquare(root: HTMLElement, square: string): void {
  root
    .querySelector(`[data-square="${square}"]`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
