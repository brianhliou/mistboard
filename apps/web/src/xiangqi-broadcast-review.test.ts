import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBroadcastBoardReview } from './xiangqi-broadcast-review.js';

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
