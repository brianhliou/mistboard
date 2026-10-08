import { describe, expect, it, vi } from 'vitest';
import { buildInboxCard, type PageContext } from './correspondence.js';
import type { CorrespondenceGame } from './correspondence-model.js';
import type { CurrentGame } from './current-games-model.js';

// The board mount is the compact live renderer; record the side it is asked
// for instead of drawing it.
const mountShowcaseBoard = vi.hoisted(() =>
  vi.fn(async (_root: HTMLElement, _spec: string, _room: string, _options: unknown) => ({
    destroy: () => {},
  })),
);
vi.mock('./showcase-board.js', () => ({ mountShowcaseBoard }));

// The /correspondence lists are the site's game cards (current-games.css
// .current-game-card), the same frame as /games and the homepage (2026-10-04).

function pageCtx(): PageContext {
  return { signedIn: true, isConnected: () => true, handles: [], tickers: [] };
}

const game: CorrespondenceGame = {
  roomId: 'xq_9',
  url: '/room/xq_9',
  gameSpecId: 'xiangqi',
  mySeat: 'red',
  isYourMove: true,
  opponentName: 'Bob',
  opponentHandle: 'bob_h',
  dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
};

function seats(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(':scope > .current-game-seat')];
}

function visibleClock(seat: HTMLElement | undefined): string | null {
  const clock = seat?.querySelector<HTMLElement>('.current-game-seat-clock');
  return clock && !clock.hidden ? clock.textContent : null;
}

describe('correspondence inbox card', () => {
  it('a Your move card: board, seats, time left on your seat, Play your move', () => {
    const card = buildInboxCard(pageCtx(), game, undefined, true);
    expect(card.classList.contains('current-game-card')).toBe(true);
    expect(card.dataset.kind).toBe('correspondence');
    expect(card.querySelector('.current-game-board')).not.toBeNull();
    const [top, bottom] = seats(card);
    // Red moves first and the board draws it at the bottom: you sit there.
    expect(top?.textContent).toContain('Bob');
    expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
    expect(visibleClock(bottom)).toMatch(/left$/);
    expect(visibleClock(top)).toBeNull();
    const play = card.querySelector<HTMLAnchorElement>('a.correspondence-card-play');
    expect(play?.textContent).toBe('Play your move');
    expect(play?.getAttribute('href')).toBe('/room/xq_9');
    expect(card.querySelector('.current-game-chip')?.textContent).toBe('Xiangqi');
    expect(card.querySelectorAll('a a')).toHaveLength(0);
  });

  it('a Waiting card: time left on the opponent seat, no Play button', () => {
    const card = buildInboxCard(
      pageCtx(),
      { ...game, mySeat: 'black', isYourMove: false },
      undefined,
      false,
    );
    const [top, bottom] = seats(card);
    // Black moves second, and you still sit at the bottom: the opponent's clock
    // is the one running, on top.
    expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
    expect(top?.textContent).toContain('Bob');
    expect(visibleClock(top)).toMatch(/left$/);
    expect(visibleClock(bottom)).toBeNull();
    expect(card.querySelector('.correspondence-card-play')).toBeNull();
  });

  // The badge and its bar already say how long is left; a second line restating
  // the deadline as a date (and an "Updated" time that is any event, not the
  // last move) read as three competing clocks. The exact due time is the
  // badge's tooltip instead.
  it('tells the deadline once: the badge, with the due time as its tooltip', () => {
    for (const yourMove of [true, false]) {
      const card = buildInboxCard(
        pageCtx(),
        { ...game, mySeat: yourMove ? 'red' : 'black', isYourMove: yourMove },
        undefined,
        yourMove,
      );
      expect(card.querySelector('.correspondence-card-when')).toBeNull();
      const clock = [...card.querySelectorAll<HTMLElement>('.current-game-seat-clock')].find(
        (el) => !el.hidden,
      );
      expect(clock?.title).toMatch(/^due /);
    }
  });

  it('marks a deadline under a day away as urgent', () => {
    const card = buildInboxCard(
      pageCtx(),
      { ...game, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      undefined,
      true,
    );
    expect(card.dataset.urgency).toBe('urgent');
  });

  // Brian, 2026-10-08: you at the bottom and the opponent at the top on every
  // card, the board drawn from your side the way the room draws it.
  describe('you at the bottom', () => {
    const DAY = 86_400_000;

    function feedGame(gameSpecId: string, roomId: string): CurrentGame {
      return {
        roomId,
        gameSpecId,
        channelId: gameSpecId,
        composition: 'pvp',
        observe: 'open',
        players: [
          { color: 'red', name: 'First', handle: null, isEngine: false },
          { color: 'black', name: 'Second', handle: null, isEngine: false },
        ],
        ply: 3,
        rated: false,
        startedAt: Date.now() - DAY,
        lastActivityAt: Date.now(),
        timeControl: { initialMs: 0, incrementMs: 0, daysPerMove: 3 },
        timeClass: 'correspondence',
        clock: null,
        deadline: null,
        url: `/room/${roomId}`,
        payload: { game: { roomId } },
      };
    }

    function inboxGame(gameSpecId: string, mySeat: 'red' | 'black', yourMove: boolean) {
      const roomId = `${gameSpecId}_${mySeat}_${yourMove ? 'move' : 'wait'}`;
      const corr: CorrespondenceGame = {
        roomId,
        url: `/room/${roomId}`,
        gameSpecId,
        mySeat,
        isYourMove: yourMove,
        opponentName: 'Bob',
        opponentHandle: null,
        dueAt: new Date(Date.now() + DAY).toISOString(),
      };
      return { corr, current: feedGame(gameSpecId, roomId) };
    }

    // The card's direct children by role, in order.
    function layout(card: HTMLElement): string[] {
      return [...card.children].flatMap((el) => {
        if (el.classList.contains('current-game-seat')) {
          return [el.textContent?.includes('You') ? 'you' : 'opponent'];
        }
        if (el.classList.contains('current-game-board')) return ['board'];
        if (el.classList.contains('current-game-bar')) return ['bar'];
        return [];
      });
    }

    async function mountedPov(roomId: string): Promise<unknown> {
      await vi.waitFor(() => {
        expect(mountShowcaseBoard.mock.calls.some((call) => call[2] === roomId)).toBe(true);
      });
      const call = mountShowcaseBoard.mock.calls.find((c) => c[2] === roomId);
      return (call?.[3] as { tenantPov?: string } | undefined)?.tenantPov;
    }

    for (const spec of ['xiangqi', 'jieqi', 'duck-xiangqi']) {
      for (const mySeat of ['red', 'black'] as const) {
        for (const yourMove of [true, false]) {
          const label = `${spec}, ${mySeat === 'red' ? 'first' : 'second'} mover, ${
            yourMove ? 'Your move' : 'Waiting'
          }`;
          it(`${label}: You at the bottom, board from your side, bar by the running clock`, async () => {
            const { corr, current } = inboxGame(spec, mySeat, yourMove);
            const card = buildInboxCard(pageCtx(), corr, current, yourMove);
            const [top, bottom] = seats(card);
            expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
            expect(top?.textContent).toContain('Bob');

            const board = card.querySelector<HTMLElement>('.current-game-board');
            const side = mySeat === 'red' ? 'first' : 'second';
            expect(board?.dataset.perspective).toBe(side);
            expect(await mountedPov(corr.roomId)).toBe(mySeat === 'red' ? 'white' : 'black');

            // The running clock is yours on a Your move card, the opponent's on a
            // Waiting one, and the bar hangs under that seat's row.
            expect(visibleClock(yourMove ? bottom : top)).toMatch(/left$/);
            expect(visibleClock(yourMove ? top : bottom)).toBeNull();
            expect(layout(card)).toEqual(
              yourMove ? ['opponent', 'board', 'you', 'bar'] : ['opponent', 'bar', 'board', 'you'],
            );
          });
        }
      }
    }

    // Banqi and Flip Jungle boards have no sides: the board stays as the variant
    // draws it (no side requested), and you still sit at the bottom.
    for (const spec of ['banqi', 'jungle-flip']) {
      it(`${spec}: the board keeps its fixed orientation, You at the bottom`, async () => {
        const { corr, current } = inboxGame(spec, 'black', false);
        const card = buildInboxCard(pageCtx(), corr, current, false);
        const [, bottom] = seats(card);
        expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
        expect(card.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
          'fixed',
        );
        expect(await mountedPov(corr.roomId)).toBeUndefined();
      });
    }

    // Fog draws the seat's own PlayerView, already turned to that seat; the card
    // never swaps it for the feed's board.
    it('Fog Xiangqi: the seat board stays your own view, You at the bottom', () => {
      const corr: CorrespondenceGame = {
        roomId: 'fog_1',
        url: '/room/fog_1',
        gameSpecId: 'dark-xiangqi',
        mySeat: 'black',
        isYourMove: false,
        opponentName: 'Bob',
        dueAt: new Date(Date.now() + DAY).toISOString(),
        seatBoard: {
          board: {},
          visibleSquares: [],
          perspective: 'black',
          status: { type: 'playing' },
        },
      };
      const card = buildInboxCard(pageCtx(), corr, undefined, false);
      const [top, bottom] = seats(card);
      expect(bottom?.querySelector('.current-game-seat-name')?.textContent).toBe('You');
      expect(top?.textContent).toContain('Bob');
      expect(card.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
        'second',
      );
      expect(mountShowcaseBoard.mock.calls.some((call) => call[2] === 'fog_1')).toBe(false);
    });
  });
});
