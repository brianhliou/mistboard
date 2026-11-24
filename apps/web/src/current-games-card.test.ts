// A Playing now game card on /games is the board, one line per player (disc,
// name, BOT tag, clock) and one quiet line under the board with the game and
// its time control. No kind chip, no variant chip, no Casual, no move count and
// no correspondence bar; the kind is the card's top edge.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardMetaText } from './current-games.js';
import type { CurrentGame } from './current-games-model.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOW = Date.now();

function game(overrides: Partial<CurrentGame>): CurrentGame {
  return {
    channelId: 'xiangqi',
    clock: null,
    composition: 'pvp',
    deadline: null,
    gameSpecId: 'xiangqi',
    lastActivityAt: null,
    observe: 'open',
    players: [],
    ply: 12,
    rated: false,
    roomId: 'room',
    startedAt: null,
    timeClass: 'rapid',
    timeControl: { incrementMs: 5_000, initialMs: 600_000 },
    url: '/room/room',
    ...overrides,
  };
}

const liveBot = game({
  roomId: 'live-bot',
  url: '/room/live-bot',
  composition: 'pve',
  players: [
    { color: 'red', name: 'Ann', handle: 'ann', isEngine: false },
    { color: 'black', name: 'Fairy-Stockfish Level 3', handle: null, isEngine: true },
  ],
  clock: {
    remainingMs: { red: 600_000, black: 605_000 },
    activeColor: 'red',
    asOf: NOW,
    running: true,
  },
});

const correspondence = game({
  roomId: 'corr',
  url: '/room/corr',
  rated: true,
  timeClass: 'correspondence',
  timeControl: { incrementMs: 0, initialMs: 0, daysPerMove: 3 },
  players: [
    { color: 'red', name: 'Bob', handle: 'bob', isEngine: false },
    { color: 'black', name: 'Cy', handle: 'cy', isEngine: false },
  ],
  deadline: { seat: 'red', dueAt: new Date(NOW + 2 * 86_400_000 + 3_600_000).toISOString() },
});

async function mountWithGames(games: CurrentGame[]): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/games/current')) {
        return Response.json({ channel: 'all', channels: [], games, now: '', total: games.length });
      }
      if (url === '/api/correspondence/seeks') return Response.json({ seeks: [] });
      return new Response('{}', { status: 503 });
    }),
  );
  const { mountCurrentGames } = await import('./current-games.js');
  const root = document.createElement('main');
  document.body.append(root);
  await mountCurrentGames(root);
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return root;
}

function cardFor(root: HTMLElement, roomId: string): HTMLElement {
  const card = root.querySelector<HTMLElement>(
    `[data-section="playing"] .current-game-card[data-room-id="${roomId}"]`,
  );
  if (!card) throw new Error(`no card for ${roomId}`);
  return card;
}

describe('/games game card', () => {
  it('is the board, a line per player and one meta line, and nothing else', async () => {
    const root = await mountWithGames([liveBot, correspondence]);
    for (const id of ['live-bot', 'corr']) {
      const card = cardFor(root, id);
      expect(card.classList.contains('is-slim')).toBe(true);
      const parts = [...card.children].map((el) =>
        [...el.classList].find((c) => c.startsWith('current-game-')),
      );
      expect(parts).toEqual([
        'current-game-open',
        'current-game-seat',
        'current-game-board',
        'current-game-seat',
        'current-game-meta',
      ]);
      // Under the board: the bottom seat and the meta line, nothing more.
      const board = card.querySelector('.current-game-board');
      const below = [] as Element[];
      for (let el = board?.nextElementSibling; el; el = el.nextElementSibling) below.push(el);
      expect(below.map((el) => el.className)).toEqual([
        'current-game-seat',
        'current-game-meta current-game-line',
      ]);
      expect(
        card.querySelector('.current-game-kind, .current-game-chip, .current-game-bar'),
      ).toBeNull();
    }
    root.remove();
    await Promise.resolve();
  });

  it('puts each player on one row: disc, name and BOT tag, then the clock', async () => {
    const root = await mountWithGames([liveBot]);
    const seats = cardFor(root, 'live-bot').querySelectorAll<HTMLElement>('.current-game-seat');
    expect(seats).toHaveLength(2);
    for (const seat of seats) {
      expect([...seat.children].map((el) => el.classList[0])).toEqual([
        'current-game-seat-who',
        'current-game-seat-clock',
      ]);
      expect(seat.querySelectorAll('.current-game-seat-label')).toHaveLength(1);
      expect(seat.querySelector('br')).toBeNull();
    }
    const bot = [...seats].find((seat) => seat.dataset.color === 'black');
    const label = bot?.querySelector('.current-game-seat-label');
    expect(label?.querySelector('.current-game-seat-name')?.textContent).toBe('FSF Level 3');
    // The tag sits inside the name's line, after the name.
    expect(label?.lastElementChild?.classList.contains('current-game-bot')).toBe(true);
    expect(bot?.querySelector('.current-game-seat-clock')?.textContent).toBe('10:05');
    root.remove();
    await Promise.resolve();
  });

  it('says the game and its time control under the board, and nothing about move or casual', async () => {
    const root = await mountWithGames([liveBot, correspondence]);
    const live = cardFor(root, 'live-bot').querySelector('.current-game-line')?.textContent;
    expect(live).toBe('Xiangqi · 10 + 5');
    const corr = cardFor(root, 'corr').querySelector('.current-game-line')?.textContent;
    expect(corr).toBe('Xiangqi · 3 days per move · Rated');
    for (const text of [live, corr]) {
      expect(text).not.toMatch(/Casual|Move|Live|Correspondence/);
    }
    root.remove();
    await Promise.resolve();
  });

  it('keeps the correspondence deadline in the seat on move', async () => {
    const root = await mountWithGames([correspondence]);
    const card = cardFor(root, 'corr');
    const red = card.querySelector<HTMLElement>(
      '.current-game-seat[data-color="red"] .current-game-seat-clock',
    );
    const black = card.querySelector<HTMLElement>(
      '.current-game-seat[data-color="black"] .current-game-seat-clock',
    );
    expect(red?.classList.contains('is-deadline')).toBe(true);
    expect(red?.textContent).toMatch(/^2d \d+h left$/);
    expect(black?.hidden).toBe(true);
    root.remove();
    await Promise.resolve();
  });
});

describe('cardMetaText', () => {
  it('names one day per move in the singular and leaves an untimed game to its name', () => {
    expect(
      cardMetaText(
        game({
          timeClass: 'correspondence',
          timeControl: { initialMs: 0, incrementMs: 0, daysPerMove: 1 },
        }),
      ),
    ).toBe('Xiangqi · 1 day per move');
    expect(cardMetaText(game({ timeControl: null, timeClass: null }))).toBe('Xiangqi');
  });
});

// The seat line stays one line only through the scoped stylesheet; a rule that
// lost its .is-slim scope or its nowrap would let a long name wrap again.
describe('current-games.css slim card rules', () => {
  const css = readFileSync('src/current-games.css', 'utf8');

  function rule(selectorTail: RegExp): string {
    const match = css.match(
      new RegExp(
        `\\.current-game-card(?:\\.is-slim|:is\\(\\.is-slim, \\.is-seek\\))${selectorTail.source}\\s*\\{([^}]*)\\}`,
      ),
    );
    if (!match?.[1]) throw new Error(`no .is-slim rule for ${selectorTail}`);
    return match[1];
  }

  it('keeps the name, tag and meta on one line', () => {
    expect(rule(/\s+\.current-game-seat-label/)).toMatch(/white-space:\s*nowrap/);
    expect(rule(/\s+>\s+\.current-game-line/)).toMatch(/white-space:\s*nowrap/);
  });

  it('gives a profile link a tap target at least 40px tall', () => {
    const body = rule(/\s+a\.player-name-link/);
    const padding = Number(body.match(/padding-block:\s*(\d+)px/)?.[1] ?? 0);
    // 0.85rem at line-height 1.25 is about 17px of text.
    expect(17 + 2 * padding).toBeGreaterThanOrEqual(40);
  });
});
