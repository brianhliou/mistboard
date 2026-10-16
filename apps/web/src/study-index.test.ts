import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountStudyIndex } from './study-index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
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
