import { afterEach, describe, expect, it, vi } from 'vitest';

const openChallengeDialog = vi.fn();
vi.mock('./challenge-dialog.js', () => ({ openChallengeDialog }));

const { buildRecentOpponents, mountCorrespondence, parseRecentOpponents } = await import(
  './correspondence.js'
);

// #1058: the signed-in page reads in order of urgency. Challenges for you, then
// your move, then games waiting on the opponent, then your own open seeks and
// recent opponents, and only then the cards that start a new game.

const future = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

function game(roomId: string, isYourMove: boolean) {
  return {
    roomId,
    url: `/room/${roomId}`,
    gameSpecId: 'xiangqi',
    mySeat: 'red',
    isYourMove,
    opponentName: 'Alice',
    opponentHandle: 'alice',
    dueAt: future(2),
  };
}

const responses: Record<string, unknown> = {
  '/api/correspondence/games': {
    games: [game('move-1', true), game('wait-1', false)],
    yourMoveCount: 1,
  },
  '/api/correspondence/seeks/incoming': {
    challenges: [
      {
        id: 'in-1',
        gameSpecId: 'xiangqi',
        daysPerMove: 3,
        preferredColor: 'random',
        rated: false,
        challengerName: 'Bob',
        challengerHandle: 'bob',
        createdAt: new Date().toISOString(),
        expiresAt: future(10),
      },
    ],
  },
  '/api/correspondence/seeks/mine': {
    limit: 6,
    seeks: [
      {
        id: 'mine-1',
        gameSpecId: 'xiangqi',
        daysPerMove: 3,
        preferredColor: 'random',
        rated: false,
        visibility: 'public',
        targetName: null,
        challengeUrl: null,
        expiresAt: future(10),
      },
    ],
  },
  '/api/correspondence/opponents/recent': {
    opponents: [
      { handle: 'alice', displayName: 'Alice' },
      { handle: 'carol', displayName: 'Carol' },
    ],
  },
  '/api/correspondence/seeks': { seeks: [] },
};

function stubFetch(overrides: Record<string, unknown> = {}): void {
  const table = { ...responses, ...overrides };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
      const path = url.split('?')[0] ?? url;
      const body = table[path];
      return body === undefined
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function headings(root: HTMLElement): string[] {
  return [
    ...root.querySelectorAll<HTMLElement>('.correspondence-main > section:not([hidden]) h2'),
  ].map((h) => h.textContent?.trim() ?? '');
}

describe('correspondence page order (#1058)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    openChallengeDialog.mockReset();
    document.body.replaceChildren();
  });

  it('puts challenges for you, your move and waiting before your seeks and the create cards', async () => {
    stubFetch();
    const root = document.createElement('div');
    document.body.append(root);
    await mountCorrespondence(root);
    await settle();

    const order = headings(root).map((text) => text.replace(/\d+$/, '').trim());
    const at = (prefix: string): number => order.findIndex((text) => text.startsWith(prefix));
    expect(order.length).toBeGreaterThanOrEqual(5);
    const incoming = at('Challenges for you');
    expect(incoming).toBe(0);
    expect(at('Your move')).toBeGreaterThan(incoming);
    expect(at('Waiting on opponent')).toBeGreaterThan(at('Your move'));
    expect(at('Waiting for an opponent')).toBeGreaterThan(at('Waiting on opponent'));
    expect(at('Recent opponents')).toBeGreaterThan(at('Waiting on opponent'));

    // The create cards come after every list, inside the main column.
    const main = root.querySelector('.correspondence-main');
    const launchers = main?.querySelector('.correspondence-launchers');
    const ownSeeks = main?.querySelector('.correspondence-own-seeks');
    expect(launchers).not.toBeNull();
    expect(ownSeeks).not.toBeNull();
    const position = ownSeeks?.compareDocumentPosition(launchers as Node) ?? 0;
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "Waiting for an opponent" once on a posted seek', async () => {
    stubFetch();
    const root = document.createElement('div');
    document.body.append(root);
    await mountCorrespondence(root);
    await settle();
    const seekCard = root.querySelector('.correspondence-own-seeks');
    const text = seekCard?.textContent ?? '';
    expect(text.split('Waiting for an opponent').length - 1).toBe(1);
    expect(text).toContain('Open seek');
  });

  it('hides Recent opponents when there are none', async () => {
    stubFetch({ '/api/correspondence/opponents/recent': { opponents: [] } });
    const root = document.createElement('div');
    document.body.append(root);
    await mountCorrespondence(root);
    await settle();
    expect(root.querySelector<HTMLElement>('.correspondence-recent-opponents')?.hidden).toBe(true);
  });
});

// 2026-11-11: signed out, the page opens on a compact strip (headline, pitch,
// one fact line, the two account buttons) and no board, so the games in play
// sit right under it at the fold.
describe('signed-out header strip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function stubSignedOut(): void {
    const inPlay = {
      roomId: 'corr-1',
      gameSpecId: 'xiangqi',
      channelId: null,
      composition: 'pvp',
      observe: 'open',
      players: [
        { seat: 'red', name: 'Ann' },
        { seat: 'black', name: 'Ben' },
      ],
      ply: 10,
      rated: false,
      startedAt: null,
      lastActivityAt: null,
      timeControl: { initialMs: 0, incrementMs: 0, daysPerMove: 3 },
      timeClass: 'correspondence',
      clock: null,
      deadline: null,
      url: '/room/corr-1',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
        const path = url.split('?')[0] ?? url;
        if (path === '/api/correspondence/games') return new Response('{}', { status: 401 });
        if (path === '/api/games/current') {
          return new Response(JSON.stringify({ channel: 'all', channels: [], games: [inPlay] }), {
            status: 200,
          });
        }
        if (path === '/api/correspondence/seeks') {
          return new Response(JSON.stringify({ seeks: [] }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
  }

  it('is copy and two buttons with no board, and the games in play come next', async () => {
    stubSignedOut();
    const root = document.createElement('div');
    document.body.append(root);
    await mountCorrespondence(root);
    await settle();

    const hero = root.querySelector<HTMLElement>('.is-signed-out > .correspondence-hero');
    expect(hero).not.toBeNull();
    expect(hero?.querySelector('h1')?.textContent).toBeTruthy();
    expect(hero?.querySelector('.correspondence-hero-pitch')?.textContent).toBeTruthy();
    // One fact line, not a row of pills.
    const facts = hero?.querySelectorAll('.correspondence-hero-facts') ?? [];
    expect(facts.length).toBe(1);
    expect(facts[0]?.tagName).toBe('P');
    expect(facts[0]?.textContent?.split(' · ').length).toBe(3);
    // The buttons sit beside the copy, not inside it.
    const actions = hero?.querySelector(':scope > .correspondence-signedout-actions');
    expect([...(actions?.querySelectorAll('a') ?? [])].map((a) => a.className)).toEqual([
      'correspondence-btn',
      'correspondence-ghost',
    ]);
    expect(hero?.querySelector('figure, svg, .current-game-board')).toBeNull();
    // The games grid follows the strip directly.
    expect(hero?.nextElementSibling?.classList.contains('correspondence-showcase')).toBe(true);
    expect(root.querySelectorAll('.correspondence-showcase-card')).toHaveLength(1);
  });
});

describe('recent opponents (#1058)', () => {
  afterEach(() => openChallengeDialog.mockReset());

  it('keeps only entries with a handle and falls back to the handle for a name', () => {
    expect(
      parseRecentOpponents({
        opponents: [
          { handle: 'alice', displayName: 'Alice' },
          { handle: '', displayName: 'Nobody' },
          { displayName: 'No handle' },
          { handle: 'bob' },
        ],
      }),
    ).toEqual([
      { handle: 'alice', displayName: 'Alice' },
      { handle: 'bob', displayName: 'bob' },
    ]);
    expect(parseRecentOpponents(null)).toEqual([]);
  });

  it('opens the challenge dialog prefilled with that player', () => {
    const host = document.createElement('section');
    host.append(...buildRecentOpponents([{ handle: 'alice', displayName: 'Alice' }]));
    expect(host.querySelector('h2')?.textContent).toContain('Recent opponents');
    const button = host.querySelector<HTMLButtonElement>('.correspondence-recent-challenge');
    expect(button?.textContent).toBe('Challenge');
    button?.click();
    expect(openChallengeDialog).toHaveBeenCalledWith({ handle: 'alice', displayName: 'Alice' });
  });
});
