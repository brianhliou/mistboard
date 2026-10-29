import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaderboardVariants } from './variants.js';

describe('landing community widgets', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hydrates popular studies and the leader of each returned public ladder', async () => {
    const variant = leaderboardVariants[0]!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/studies/public?limit=')) {
        return jsonResponse({
          studies: [
            {
              id: 'uXnuObfx',
              name: 'Seven Stars',
              owner: { handle: 'teacher', displayName: 'Teacher' },
              chapterCount: 3,
              likeCount: 0,
            },
            {
              id: 'studyOne',
              name: 'Horse and cannon attacks: a long title the box shows whole, never cut off',
              i18n: { 'zh-Hans': { name: '马炮攻杀' }, 'zh-Hant': { name: '馬炮攻殺' } },
              owner: { handle: 'teacher', displayName: 'Teacher' },
              chapterCount: 1,
              likeCount: 0,
            },
            {
              id: 'banqiStudy',
              name: 'Banqi endgames',
              owner: { handle: 'teacher', displayName: 'Teacher' },
              chapterCount: 2,
              previewBoard: {
                variant: 'banqi',
                fen: null,
                grid: {
                  shape: 'banqi',
                  files: 8,
                  ranks: 4,
                  cells: '..................?.....r....?b.',
                },
              },
            },
          ],
        });
      }
      if (url === '/api/leaderboard/summary?limit=1') {
        return jsonResponse({
          ladders: [
            {
              variant: variant.id,
              leaderboard: [
                {
                  handle: 'champion',
                  displayName: 'Champion',
                  eloRating: 2412,
                  provisional: false,
                },
              ],
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { buildLandingCommunityWidgets } = await import('./landing-community-widgets.js');

    const strip = buildLandingCommunityWidgets();
    document.body.append(strip);

    await vi.waitFor(() => {
      expect(strip.querySelector('.landing-study-row')?.textContent).toContain('Seven Stars');
      expect(strip.querySelector('.landing-leaderboard-player')?.textContent).toBe('Champion');
    });
    const flagshipRow = strip.querySelector<HTMLAnchorElement>('.landing-study-row');
    expect(flagshipRow?.pathname).toBe('/study/uXnuObfx');
    expect(
      flagshipRow?.querySelector<HTMLImageElement>('.landing-study-thumbnail img'),
    ).toMatchObject({
      alt: '',
      loading: 'lazy',
      src: expect.stringContaining('/study-thumbnails/seven-stars.webp'),
    });
    const ordinaryRow = [...strip.querySelectorAll<HTMLAnchorElement>('.landing-study-row')].find(
      (row) => row.pathname === '/study/studyOne',
    );
    // No board and no marker: an empty slot of the same shape keeps titles aligned.
    expect(
      ordinaryRow?.querySelector('.landing-study-thumbnail.study-thumbnail--blank'),
    ).not.toBeNull();
    // The whole title, in English on an English page; no like count (#710).
    expect(ordinaryRow?.querySelector('.landing-study-name')?.textContent).toBe(
      'Horse and cannon attacks: a long title the box shows whole, never cut off',
    );
    expect(strip.querySelector('.landing-study-likes')).toBeNull();
    expect(strip.textContent).not.toContain('♥');
    // Every derivable variant draws its own board (#710): banqi on its 8x4
    // squares, face-down tiles as plain backs with no colour, face-up discs in
    // their side's colour.
    const banqiRow = [...strip.querySelectorAll<HTMLAnchorElement>('.landing-study-row')].find(
      (row) => row.pathname === '/study/banqiStudy',
    );
    const banqiThumb = banqiRow?.querySelector<HTMLElement>(
      '.landing-study-thumbnail.study-thumbnail--board',
    );
    expect(banqiThumb?.dataset.boardShape).toBe('banqi');
    expect(banqiThumb?.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 83 43');
    expect(banqiThumb?.querySelectorAll('.study-thumbnail__down').length).toBe(2);
    expect(
      banqiThumb?.querySelectorAll('.study-thumbnail__down--red, .study-thumbnail__down--black')
        .length,
    ).toBe(0);
    expect(banqiThumb?.querySelectorAll('.study-thumbnail__red').length).toBe(1);
    expect(banqiThumb?.querySelectorAll('.study-thumbnail__black').length).toBe(1);
    expect(
      strip.querySelector('.landing-study-meta, .landing-community-meta')?.textContent,
    ).toContain('Teacher');
    expect(fetchMock).toHaveBeenCalledWith('/api/studies/public?limit=6', expect.anything());
    expect(strip.querySelector('.landing-leaderboard-category')?.textContent).toBe(variant.label);
    expect(strip.querySelector('.landing-leaderboard-rating')?.textContent).toBe('2412');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows five studies with three-line titles in the column, six in the wide grid', async () => {
    // Layout lives in CSS (no layout engine here), so pin the rules that set
    // the count and the title room (#710): the sixth row fetched is hidden in
    // the column and shown again in the two-by-three grid.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/landing-community-widgets.css', 'utf8');
    const cap = /landing-study-row:nth-child\(n \+ 6\) \{\s*display: (\w+);/g;
    expect([...css.matchAll(cap)].map((m) => m[1])).toEqual(['none', 'flex']);
    expect(css.indexOf('display: none')).toBeLessThan(css.indexOf('@container landing-studies'));
    expect(css).toMatch(/\.landing-study-name \{[^}]*-webkit-line-clamp: 3;/);
  });

  it('draws a preview grid only on a shape it knows, with cells that fill it', async () => {
    const { buildStudyThumbnail } = await import('./study-thumbnails.js');
    const board = (grid: { shape: string; files: number; ranks: number; cells: string }) =>
      buildStudyThumbnail('x', 'c', 'lazy', {
        variant: 'not-a-variant',
        fen: null,
        grid: grid as never,
      });
    const chess = buildStudyThumbnail('x', 'c', 'lazy', {
      variant: 'chess',
      fen: null,
      grid: { shape: 'chess', files: 8, ranks: 8, cells: `${'.'.repeat(52)}r${'.'.repeat(11)}` },
    });
    expect(chess?.dataset.boardShape).toBe('chess');
    expect(chess?.querySelectorAll('.study-thumbnail__white').length).toBe(1);
    // Fail-closed: an unknown shape, or cells that do not fill the board, draw
    // nothing rather than a guess.
    expect(board({ shape: 'mahjong', files: 8, ranks: 8, cells: '.'.repeat(64) })).toBeNull();
    expect(board({ shape: 'chess', files: 8, ranks: 8, cells: '.'.repeat(63) })).toBeNull();
    expect(board({ shape: 'chess', files: 9, ranks: 10, cells: '.'.repeat(90) })).toBeNull();
  });

  it('shows an @mistboard study title in the page locale when the study has one', async () => {
    window.history.replaceState(null, '', '/zh-hans/');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          jsonResponse({
            studies: [
              {
                id: 'DO92ymcx',
                name: 'jqe vs AB-JChess: 100 games at 4 s a move',
                i18n: {
                  'zh-Hans': { name: 'jqe 对 AB-JChess：每步 4 秒的 100 盘' },
                  'zh-Hant': { name: 'jqe 對 AB-JChess：每步 4 秒的 100 盤' },
                },
                owner: { handle: 'mistboard', displayName: 'Mistboard' },
                chapterCount: 100,
                likeCount: 0,
              },
              {
                id: 'userStudy',
                name: 'My openings',
                owner: { handle: 'someone', displayName: 'Someone' },
                chapterCount: 2,
                likeCount: 0,
              },
            ],
          }),
        ),
      );
      const { buildTopStudiesWidget } = await import('./landing-community-widgets.js');
      const box = buildTopStudiesWidget();
      document.body.append(box);
      await vi.waitFor(() => {
        expect(box.querySelectorAll('.landing-study-name').length).toBe(2);
      });
      const names = [...box.querySelectorAll('.landing-study-name')].map((el) => el.textContent);
      // A study with no overlay keeps its author's title.
      expect(names).toEqual(['jqe 对 AB-JChess：每步 4 秒的 100 盘', 'My openings']);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('fits Top studies to whole rows against the body height and fills small slack', async () => {
    const study = (n: number) => ({
      id: `study_${n}`,
      name: `Study ${n}`,
      owner: { handle: 'teacher', displayName: 'Teacher' },
      chapterCount: n,
      likeCount: 0,
    });
    // A fresh Response per call: a body reads once, and this test hydrates twice.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ studies: [1, 2, 3, 4, 5].map(study) })),
    );
    // jsdom has no layout: stack the rows 40px apart by DOM order, body at 0.
    const rowHeight = 40;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const index = this.classList.contains('landing-study-row')
        ? Array.from(this.parentElement?.children ?? []).indexOf(this)
        : -1;
      const top = index < 0 ? 0 : index * rowHeight;
      const bottom = index < 0 ? 0 : top + rowHeight;
      return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top } as DOMRect;
    });
    const { buildTopStudiesWidget } = await import('./landing-community-widgets.js');

    const box = buildTopStudiesWidget();
    const body = box.querySelector<HTMLElement>('.site-box-body')!;
    // Four rows fit (160px), a fifth (200px) would clip; 20px of slack is
    // within the 28px-per-row spread, so the rows grow to fill it.
    Object.defineProperty(body, 'clientHeight', { value: 180, configurable: true });
    await vi.waitFor(() => {
      expect(body.querySelectorAll('.landing-study-row').length).toBe(4);
    });
    expect(body.classList.contains('landing-community-body--fill')).toBe(true);

    // Content-starved: the same rows in a much taller body keep their slack.
    const tall = buildTopStudiesWidget();
    const tallBody = tall.querySelector<HTMLElement>('.site-box-body')!;
    Object.defineProperty(tallBody, 'clientHeight', { value: 400, configurable: true });
    await vi.waitFor(() => {
      expect(tallBody.querySelectorAll('.landing-study-row').length).toBe(5);
    });
    expect(tallBody.classList.contains('landing-community-body--fill')).toBe(false);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}
