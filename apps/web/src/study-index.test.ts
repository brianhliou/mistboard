import { createGomokuRoomState, gomokuFen, parseGomokuFen } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountStudyIndex } from './study-index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
});

describe('study index Classical collections tab', () => {
  const card = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    description: '',
    visibility: 'public',
    chapterCount: 90,
    chapterPreview: [{ name: 'Chapter 1' }],
    updatedAt: '2026-11-17T12:00:00.000Z',
    createdAt: '2026-11-17T12:00:00.000Z',
    owner: { handle: 'mistboard', displayName: 'mistboard' },
    likeCount: 0,
    ...extra,
  });
  const seven = card('uXnuObfx', 'Seven Stars', {
    i18n: { 'zh-Hant': { name: '七星聚會' } },
    owner: { handle: 'teacher', displayName: 'Teacher' },
  });
  const elegant = card('elegant1', 'Elegant Pastime Manual, Vol. 1: 90 classical compositions');

  it('lists five tabs in the rail, Classical collections after Staff picks', async () => {
    window.history.replaceState({}, '', '/study');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ studies: [] })),
    );
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyIndex(root);
    await vi.waitFor(() => expect(root.querySelector('.study-index__rail')).not.toBeNull());
    expect(
      [...root.querySelectorAll<HTMLAnchorElement>('.study-index__rail-tab')].map((tab) => [
        tab.textContent,
        tab.getAttribute('href'),
      ]),
    ).toEqual([
      ['All studies', '/study'],
      ['My studies', '/study?tab=mine'],
      ['Favorites', '/study?tab=favorites'],
      ['Staff picks', '/study?tab=staff'],
      ['Classical collections', '/study?tab=classical'],
    ]);
  });

  it('fetches the classical list and renders it as the same study cards, paged', async () => {
    window.history.replaceState({}, '', '/study?tab=classical');
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      calls.push(url);
      return url.includes('offset=2')
        ? jsonResponse({ studies: [card('9IIMlPp1', 'Secret in the Tangerine')], hasMore: false })
        : jsonResponse({ studies: [seven, elegant], hasMore: true });
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelectorAll('.study-index__grid > li .study-index__card')).toHaveLength(2),
    );
    expect(calls[0]).toBe('/api/studies/classical?limit=30');
    expect(root.querySelector('.study-index__rail [aria-current="page"]')?.textContent).toBe(
      'Classical collections',
    );
    expect(
      [...root.querySelectorAll<HTMLAnchorElement>('.study-index__card')].map((a) =>
        a.getAttribute('href'),
      ),
    ).toEqual(['/study/uXnuObfx', '/study/elegant1']);
    expect(root.querySelector('.study-index__name')?.textContent).toBe('Seven Stars');
    expect(root.querySelector('.study-index__thumbnail')).not.toBeNull();
    expect(root.querySelector('.study-index__staff-intro')).toBeNull();
    expect(root.querySelector('.study-index__search input')?.getAttribute('placeholder')).toContain(
      'Classical collections',
    );

    root.querySelector<HTMLButtonElement>('.study-index__more-button')!.click();
    await vi.waitFor(() => expect(root.querySelectorAll('.study-index__card')).toHaveLength(3));
    expect(calls[1]).toBe('/api/studies/classical?limit=30&offset=2');
    expect(root.querySelector('.study-index__more-button')).toBeNull();
  });

  it('localizes the tab, card names and links', async () => {
    window.history.replaceState({}, '', '/zh-hant/study?tab=classical');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ studies: [seven] })),
    );
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyIndex(root);
    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__name')?.textContent).toBe('七星聚會'),
    );
    expect(root.querySelector('.study-index__rail [aria-current="page"]')?.textContent).toBe(
      '古典棋譜集',
    );
    expect(root.querySelector('.study-index__card')?.getAttribute('href')).toBe(
      '/zh-hant/study/uXnuObfx',
    );
  });

  it('searches within the tab', async () => {
    window.history.replaceState({}, '', '/study?tab=classical&q=tangerine');
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ studies: [] }));
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyIndex(root);
    await vi.waitFor(() => expect(root.querySelector('.study-index__empty')).not.toBeNull());
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/studies/classical?limit=30&q=tangerine');
  });

  it('All studies opens directly on its list, with no classical shelf', async () => {
    window.history.replaceState({}, '', '/study');
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      // A server from before the tab still sends the shelf; the page ignores it.
      jsonResponse({ studies: [card('engine0', 'AB-JChess vs jqe')], classicalStudies: [seven] }),
    );
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);
    mountStudyIndex(root);
    await vi.waitFor(() => expect(root.querySelector('.study-index__grid')).not.toBeNull());
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('/api/studies/public?limit=30');
    expect(root.querySelector('.study-index__classical')).toBeNull();
    expect(root.querySelector('.study-index__content h2')).toBeNull();
    expect(
      [...root.querySelector('.study-index__content')!.children].map((child) => child.className),
    ).toEqual(['study-index__toolbar', 'study-index__grid']);
    expect([...root.querySelectorAll('.study-index__name')].map((n) => n.textContent)).toEqual([
      'AB-JChess vs jqe',
    ]);
  });
});

describe('study index Staff picks', () => {
  it('loads the public curated collection without repeating badges on its cards', async () => {
    window.history.replaceState({}, '', '/study?tab=staff');
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toBe('/api/studies/staff?limit=30');
      return jsonResponse({
        studies: [
          {
            id: 'Dfi3NpRE',
            name: 'Secret in the Tangerine',
            description: 'Archive transcription',
            visibility: 'public',
            chapterCount: 20,
            chapterNames: ['The first game', 'The second game'],
            updatedAt: '2026-07-23T12:00:00.000Z',
            featuredAt: '2026-07-24T12:00:00.000Z',
            owner: { handle: 'mistboard', displayName: 'mistboard' },
            likeCount: 4,
          },
        ],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__name')?.textContent).toBe('Secret in the Tangerine'),
    );
    expect(root.querySelector('.study-index__rail [aria-current="page"]')?.textContent).toBe(
      'Staff picks',
    );
    expect(root.querySelector('.study-index__staff-intro')?.textContent).toContain(
      'Curated by Mistboard',
    );
    expect(root.querySelector('.study-index__staff-badge')).toBeNull();
    expect(
      root.querySelector<HTMLImageElement>('.study-index__thumbnail img')?.getAttribute('src'),
    ).toBe('/study-thumbnails/tangerine-vol-1.webp');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps Staff picks public when the curated collection is empty', async () => {
    window.history.replaceState({}, '', '/study?tab=staff');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ studies: [] })),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__empty')?.textContent).toBe('No staff picks yet.'),
    );
    expect(root.querySelector('.dxq-postgame__error')).toBeNull();
  });
});

// Chapter names on a card are authored text with a per-locale overlay, exactly
// like the study title. The list endpoint used to send bare names, so a Chinese
// reader got the English chapter list under a translated title.
describe('study index chapter previews', () => {
  it('localizes chapter names from the preview overlay, per chapter', async () => {
    window.history.replaceState({}, '', '/zh-hant/study?tab=staff');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          studies: [
            {
              id: 'Dfi3NpRE',
              name: 'Secret in the Tangerine',
              description: 'Archive transcription',
              i18n: { 'zh-Hant': { name: '橘中秘' } },
              visibility: 'public',
              chapterCount: 3,
              chapterPreview: [
                {
                  name: 'Rank chariot vs file chariot',
                  i18n: { 'zh-Hant': { name: '順砲橫車破直車棄馬局' } },
                },
                { name: 'An untranslated chapter', i18n: {} },
              ],
              chapterNames: ['Rank chariot vs file chariot', 'An untranslated chapter'],
              updatedAt: '2026-07-23T12:00:00.000Z',
              owner: { handle: 'mistboard', displayName: 'mistboard' },
              likeCount: 4,
            },
          ],
        }),
      ),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__name')?.textContent).toBe('橘中秘'),
    );
    const chapters = [...root.querySelectorAll('.study-index__chapter')].map(
      (row) => row.textContent,
    );
    // The translated chapter reads in the viewer's locale; the untranslated one
    // falls back to its base name rather than blanking.
    expect(chapters[0]).toBe('順砲橫車破直車棄馬局');
    expect(chapters[1]).toBe('An untranslated chapter');
  });

  it('still renders names from a server that predates the preview overlay', async () => {
    window.history.replaceState({}, '', '/study?tab=staff');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          studies: [
            {
              id: 'Dfi3NpRE',
              name: 'Secret in the Tangerine',
              description: 'Archive transcription',
              visibility: 'public',
              chapterCount: 3,
              chapterNames: ['The first game', 'The second game'],
              updatedAt: '2026-07-23T12:00:00.000Z',
              owner: { handle: 'mistboard', displayName: 'mistboard' },
              likeCount: 4,
            },
          ],
        }),
      ),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__chapter')?.textContent).toBe('The first game'),
    );
    expect(root.querySelector('.study-index__chapter--more')?.textContent).toBe('+1 more');
  });
});

// The browse fetched 30 and rendered them with no way to ask for the rest, so
// once the classical-manual library passed 30 studies a third of the shelf was
// unreachable from the index (2026-09-22, 42 public studies).
describe('study index paging', () => {
  const card = (id: string, name: string) => ({
    id,
    name,
    description: '',
    visibility: 'public',
    chapterCount: 1,
    chapterNames: ['One'],
    updatedAt: '2026-09-22T12:00:00.000Z',
    owner: { handle: 'mistboard', displayName: 'mistboard' },
    likeCount: 0,
  });

  it('offers another page only when there is one, and appends it in place', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      calls.push(url);
      return url.includes('offset=1')
        ? jsonResponse({ studies: [card('b2', 'Second page')], hasMore: false })
        : jsonResponse({ studies: [card('a1', 'First page')], hasMore: true });
    });
    vi.stubGlobal('fetch', fetcher);
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__name')?.textContent).toBe('First page'),
    );
    expect(calls[0]).toBe('/api/studies/public?limit=30');

    const more = root.querySelector<HTMLButtonElement>('.study-index__more-button');
    expect(more?.textContent).toBe('More studies');
    more?.click();

    await vi.waitFor(() => expect(root.querySelectorAll('.study-index__name')).toHaveLength(2));
    // The second page is appended, not swapped in.
    expect([...root.querySelectorAll('.study-index__name')].map((n) => n.textContent)).toEqual([
      'First page',
      'Second page',
    ]);
    // Offset is the count already on screen, not a page number.
    expect(calls[1]).toBe('/api/studies/public?limit=30&offset=1');
    // hasMore false on the last page retires the control.
    expect(root.querySelector('.study-index__more-button')).toBeNull();
  });

  it('shows no control when the first page is the whole list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ studies: [card('a1', 'Only page')], hasMore: false })),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountStudyIndex(root);

    await vi.waitFor(() =>
      expect(root.querySelector('.study-index__name')?.textContent).toBe('Only page'),
    );
    expect(root.querySelector('.study-index__more-button')).toBeNull();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('public Gomoku study creation', () => {
  const dealtFen = gomokuFen(
    createGomokuRoomState('index', {
      stones: [{ square: 'h8', color: 'black' }],
      turn: 'white',
    }),
  );
  for (const fen of ['', dealtFen]) {
    it(`creates a public chapter with ${fen ? 'a pasted dealt position' : 'an empty position'}`, async () => {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
        if (options?.method === 'POST') return jsonResponse({ study: { id: 'created' } });
        return jsonResponse({ studies: [] });
      });
      vi.stubGlobal('fetch', fetcher);
      const root = document.createElement('div');
      document.body.append(root);
      mountStudyIndex(root);
      await vi.waitFor(() => expect(root.querySelector('.study-index__create')).not.toBeNull());
      root.querySelector<HTMLButtonElement>('.study-index__create')!.click();
      const dialog = document.querySelector<HTMLDialogElement>('[data-create-study]')!;
      const selects = dialog.querySelectorAll('select');
      const variant = selects[1]!;
      expect([...variant.options].map((option) => option.value)).toContain('gomoku');
      variant.value = 'gomoku';
      variant.dispatchEvent(new Event('change'));
      selects[0]!.value = 'public';
      const inputs = dialog.querySelectorAll('input');
      inputs[0]!.value = 'Gomoku lesson';
      inputs[1]!.value = fen;
      dialog
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() =>
        expect(fetcher.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(true),
      );
      const post = fetcher.mock.calls.find((call) => call[1]?.method === 'POST')!;
      expect(post[0]).toBe('/api/studies');
      const body = JSON.parse(post[1]!.body as string);
      expect(body.visibility).toBe('public');
      expect(body.chapter.variant).toBe('gomoku');
      expect(body.chapter.root.root.children).toEqual([]);
      if (!fen) {
        expect(body.chapter.root.rootFen).toBeUndefined();
        return;
      }
      const parsed = parseGomokuFen(body.chapter.root.rootFen);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.error);
      expect(parsed.state.board.filter(Boolean)).toHaveLength(1);
      expect(parsed.state.status).toEqual({ type: 'playing', turn: 'white' });
      expect(body.chapter.root.rootFen).toBe(fen);
    });
  }
});
