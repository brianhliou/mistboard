import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdvantageChart } from './review/advantage-chart.js';
import { mountBroadcastBoardReview, mountBroadcastHeldBoard } from './xiangqi-broadcast-review.js';

vi.mock('./review/advantage-chart.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./review/advantage-chart.js')>();
  return { ...actual, createAdvantageChart: vi.fn(actual.createAdvantageChart) };
});

// A finished broadcast game seats its players the way lichess does: a strip
// above and below the board with the name, the team, and a link to the
// player's page. The side card keeps the event and the result.
describe('broadcast board review seats', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names each side in a strip with the team and a player-page link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const root = document.createElement('div');
    mountBroadcastBoardReview(root, {
      board: {
        id: 'league-r01-b1',
        tourSlug: 'league',
        roundId: 'league-r01',
        boardNumber: 1,
        red: {
          name: '尹昇',
          nameEn: 'Yin Sheng',
          federation: '浙江民泰银行象棋队',
          federationEn: 'Zhejiang Mintai Bank Xiangqi Team',
        },
        black: { name: '刘柏宏', nameEn: 'Liu Baihong', federation: '常熟文旅酒店' },
        result: '1-0',
      },
      timeline: [
        { ply: 1, color: 'red', move: { from: 'h3', to: 'e3' } },
        { ply: 2, color: 'black', move: { from: 'h10', to: 'g8' } },
      ],
      playerSlugs: { red: 'yin-sheng', black: null },
    });

    const strips = [...root.querySelectorAll('.review-seat')];
    expect(strips).toHaveLength(2);
    // Unflipped: Red faces the reader at the bottom.
    const bottom = root.querySelector('.review-seat--bottom');
    const top = root.querySelector('.review-seat--top');
    expect(bottom?.textContent).toContain('Yin Sheng');
    expect(bottom?.querySelector('.review-seat__detail')?.textContent).toBe(
      'Zhejiang Mintai Bank Xiangqi Team',
    );
    expect(
      bottom?.querySelector<HTMLAnchorElement>('a.player-name-link')?.getAttribute('href'),
    ).toBe('/players/yin-sheng');
    // No page for this player: plain text, and the untranslated team as sent.
    expect(top?.textContent).toContain('Liu Baihong');
    expect(top?.querySelector('a')).toBeNull();
    expect(top?.querySelector('.review-seat__detail')?.textContent).toBe('常熟文旅酒店');
  });
});

// A finished game the source published without its moves: the board view
// says so over the start position, as the round grid's card does.
describe('broadcast board review without a record', () => {
  afterEach(() => vi.unstubAllGlobals());

  const mount = (timeline: Parameters<typeof mountBroadcastBoardReview>[1]['timeline']) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const root = document.createElement('div');
    mountBroadcastBoardReview(root, {
      board: {
        id: 't-r01-b1',
        tourSlug: 't',
        roundId: 't-r01',
        boardNumber: 1,
        red: { name: '尹昇', nameEn: 'Yin Sheng' },
        black: { name: '刘柏宏', nameEn: 'Liu Baihong' },
        result: '0-1',
      },
      timeline,
    });
    return root;
  };

  it('labels the board "No record published"', () => {
    const root = mount([]);
    const label = root.querySelector('.review-board-host .xqb-review-no-record-label');
    expect(label?.textContent).toBe('No record published');
    expect(root.querySelector('.review-board-host')?.classList).toContain('xqb-review-no-record');
  });

  it('leaves a game with moves unlabelled', () => {
    const root = mount([{ ply: 1, color: 'red', move: { from: 'h3', to: 'e3' } }]);
    expect(root.querySelector('.xqb-review-no-record-label')).toBeNull();
  });
});

// A creator links "the move at ply 34" in a video description (#454): the
// finished review opens on ?ply=, keeps the URL and the Share field on the
// reader's place, and offers the game as PGN.
describe('broadcast board review links and PGN', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  const input = {
    board: {
      id: 'league-r01-b1',
      tourSlug: 'league',
      roundId: 'league-r01',
      boardNumber: 1,
      red: { name: '尹昇', nameEn: 'Yin Sheng' },
      black: { name: '刘柏宏', nameEn: 'Liu Baihong' },
      result: '1-0' as const,
    },
    timeline: [
      { ply: 1, color: 'red' as const, move: { from: 'h3' as const, to: 'e3' as const } },
      { ply: 2, color: 'black' as const, move: { from: 'h10' as const, to: 'g8' as const } },
    ],
  };

  it('opens on the ply in the URL and keeps the Share link on it', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    window.history.replaceState(null, '', '/broadcast/xiangqi/board/league-r01-b1?ply=1');
    const root = document.createElement('div');
    document.body.append(root);
    mountBroadcastBoardReview(root, input);

    // One move played: the moves field holds the line up to the position shown.
    const moves = root.querySelector<HTMLTextAreaElement>('.review-share__field--moves');
    expect(moves?.value.trim().split(/\s+/)).toHaveLength(1);
    expect(window.location.search).toBe('?ply=1');
    const share = [...root.querySelectorAll<HTMLInputElement>('input.review-share__field')].find(
      (field) => field.value.includes('/broadcast/xiangqi/board/'),
    );
    expect(share?.value).toContain('?ply=1');
    root.remove();
  });

  it('drops ply from the URL on the position the page opens on', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    window.history.replaceState(null, '', '/broadcast/xiangqi/board/league-r01-b1');
    const root = document.createElement('div');
    mountBroadcastBoardReview(root, input);
    expect(window.location.search).toBe('');
  });

  it('offers the game as PGN beside the JSON', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const root = document.createElement('div');
    mountBroadcastBoardReview(root, input);
    const pgn = [...root.querySelectorAll<HTMLAnchorElement>('a.review-share__download')].find(
      (link) => link.textContent === 'PGN',
    );
    expect(pgn?.getAttribute('download')).toBe('Yin Sheng vs Liu Baihong.pgn');
    expect(decodeURIComponent(pgn?.href ?? '')).toContain('[Red "Yin Sheng"]');
  });
});

describe('finished broadcast locale fixtures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(createAdvantageChart).mockClear();
    window.history.replaceState(null, '', '/');
    window.localStorage?.clear();
  });

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'keeps the held-record view and the game date localized in %s',
    (locale) => {
      const english = locale === 'en';
      window.history.replaceState(
        null,
        '',
        `${english ? '' : `/${locale.toLowerCase()}`}/broadcast/xiangqi/board/held`,
      );
      const root = document.createElement('div');
      const ownName = { nameOwn: '趙奕帆' };
      mountBroadcastHeldBoard(root, {
        board: {
          id: 'held',
          tourSlug: 'test',
          roundId: 'r1',
          boardNumber: 1,
          red: { ...ownName, name: '赵奕帆', nameEn: 'Chao Yi-fan' },
          black: { name: '無名', nameEn: ' ' },
          result: '1-0',
          recordWithheld: 'ambiguous',
          details: { playedAt: '2026-09-11' },
          sourceUrl: 'https://example.com/record',
        },
        context: {
          tour: { name: '测试杯', nameEn: 'Test Cup' },
          round: { name: '第1轮', nameEn: 'Round 1', startsAt: '2026-09-13T14:30:00+08:00' },
        },
      });
      expect(root.querySelector('h1')?.textContent).toBe(
        english
          ? 'Chao Yi-fan vs 無名'
          : locale === 'zh-Hans'
            ? '赵奕帆 对 無名'
            : '趙奕帆 對 無名',
      );
      expect(root.querySelector('.xqb-held-note')?.textContent).toBe(
        english
          ? "The source record of this game can be read two ways, so it isn't replayed."
          : locale === 'zh-Hans'
            ? '本局的来源棋谱有两种读法，因此不提供回放。'
            : '本局的來源棋譜有兩種讀法，因此不提供回放。',
      );
      expect(root.querySelector('.xqb-held-note a')?.getAttribute('href')).toBe(
        'https://example.com/record',
      );
      expect(root.querySelector('.review-provenance')?.textContent).toContain(
        english ? 'Sep 11, 2026' : '2026年9月11日',
      );
      expect(root.querySelector('.review-board-host')).toBeNull();
    },
  );

  it.each(['en', 'zh-Hans', 'zh-Hant'] as const)(
    'localizes seats, provenance and chart phases while preserving PGN in %s',
    async (locale) => {
      const english = locale === 'en';
      window.history.replaceState(
        null,
        '',
        `${english ? '' : `/${locale.toLowerCase()}`}/broadcast/xiangqi/board/test-b1`,
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: unknown) =>
          String(url).endsWith('/analysis')
            ? {
                ok: true,
                status: 200,
                json: async () => ({
                  engineId: 'pikafish',
                  depth: 10,
                  plies: [0, 1].map((ply) => ({ ply, cp: 0, mate: null, best: null })),
                }),
              }
            : new Response(null, { status: 204 }),
        ),
      );
      const root = document.createElement('div');
      const ownName = { nameOwn: '趙奕帆' };
      const review = mountBroadcastBoardReview(root, {
        board: {
          id: 'test-b1',
          tourSlug: 'test',
          roundId: 'r1',
          boardNumber: 1,
          red: {
            ...ownName,
            name: '赵奕帆',
            nameEn: 'Chao Yi-fan',
            federation: '台灣',
            federationEn: 'Taiwan',
          },
          black: { name: '無名', nameEn: ' ' },
          result: '1-0',
        },
        timeline: [{ ply: 1, color: 'red', move: { from: 'h3', to: 'h10' } }],
        context: {
          tour: { name: '测试杯', nameEn: 'Test Cup' },
          round: { name: '第1轮', nameEn: 'Round 1' },
        },
      });
      expect(root.querySelector('.review-seat--bottom')?.textContent).toContain(
        english ? 'Chao Yi-fan' : locale === 'zh-Hans' ? '赵奕帆' : '趙奕帆',
      );
      expect(root.querySelector('.review-seat--bottom .review-seat__detail')?.textContent).toBe(
        english ? 'Taiwan' : '台灣',
      );
      expect(root.querySelector('.review-provenance')?.textContent).toContain(
        english ? 'Round 1' : locale === 'zh-Hans' ? '第1轮' : '第1輪',
      );
      await vi.waitFor(() => expect(createAdvantageChart).toHaveBeenCalled());
      expect(vi.mocked(createAdvantageChart).mock.calls.at(-1)?.[1]?.phaseLabels).toEqual(
        english
          ? { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' }
          : locale === 'zh-Hans'
            ? { opening: '开局', middlegame: '中局', endgame: '残局' }
            : { opening: '開局', middlegame: '中局', endgame: '殘局' },
      );
      expect(
        [...root.querySelectorAll('.advantage-chart__phase-label')].map((el) => el.textContent),
      ).toEqual(
        english
          ? ['Opening', 'Middlegame']
          : locale === 'zh-Hans'
            ? ['开局', '中局']
            : ['開局', '中局'],
      );
      const pgn = [...root.querySelectorAll<HTMLAnchorElement>('a.review-share__download')].find(
        (link) => link.textContent === 'PGN',
      )!;
      expect(decodeURIComponent(pgn.href)).toContain('[Red "Chao Yi-fan"]');
      expect(decodeURIComponent(pgn.href)).toContain('[Event "Test Cup"]');
      expect(decodeURIComponent(pgn.href)).toContain('[Round "Round 1"]');
      review.destroy();
    },
  );
});
