import { RATED_TIME_CONTROLS } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPlayPanel,
  orderPanelSpecs,
  panelBotPaces,
  panelPersonPaces,
  playPanelEnabled,
} from './landing-play-panel.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn } from './signed-in-state.js';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function row(board: HTMLElement, spec: string, kind: 'bot' | 'person' = 'bot'): HTMLElement {
  const el = board.querySelector<HTMLElement>(`.pp-row-${kind}[data-game-spec="${spec}"]`);
  if (!el) throw new Error(`no ${kind} row for ${spec}`);
  return el;
}

function stepValue(el: HTMLElement, which: 'level' | 'clock'): string {
  return el.querySelector(`.pp-step-${which} .pp-step-main`)?.textContent ?? '';
}

function clickNext(el: HTMLElement, which: 'level' | 'clock', times = 1): void {
  for (let i = 0; i < times; i++) {
    el.querySelectorAll<HTMLButtonElement>(`.pp-step-${which} .pp-step-btn`)[1]!.click();
  }
}

describe('homepage play panel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    sessionStorage.clear();
    setResolvedSignedIn(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    setRatedModeEnabled(false);
    window.history.replaceState(null, '', '/');
  });

  it('opens on Play the computer with a row per bot-playable game', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const tabs = [...board.querySelectorAll('.pp-tab')].map((el) => el.textContent);
    expect(tabs[0]).toBe('Play the computer');
    expect(tabs[1]).toContain('Play a person');
    expect(board.querySelector('.pp-tab.is-active')?.textContent).toBe('Play the computer');
    const specs = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (el) => el.dataset.gameSpec,
    );
    expect(specs).toEqual(expect.arrayContaining(['xiangqi', 'jieqi', 'banqi']));
    expect(new Set(specs).size).toBe(specs.length);
  });

  it('walks the xiangqi ladder to full-strength Pikafish and stops there', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const xiangqi = row(board, 'xiangqi');
    // A device with no bot history starts on the first-game rung (#365).
    expect(stepValue(xiangqi, 'level')).toBe('Level 2');
    clickNext(xiangqi, 'level', 12);
    expect(stepValue(xiangqi, 'level')).toBe('Pikafish');
    const [, harder] = xiangqi.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn');
    expect(harder?.disabled).toBe(true);
  });

  it('ends the jieqi ladder on AB-JChess', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const jieqi = row(board, 'jieqi');
    clickNext(jieqi, 'level', 4);
    expect(stepValue(jieqi, 'level')).toBe('Level 8');
    clickNext(jieqi, 'level', 12);
    expect(stepValue(jieqi, 'level')).toBe('AB-JChess');
  });

  it('shows one fixed Misty for the house-built games', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const banqi = row(board, 'banqi');
    expect(stepValue(banqi, 'level')).toBe('Misty');
    expect(banqi.querySelector('.pp-step-level')?.classList.contains('is-fixed')).toBe(true);
    // Named bots read yellow everywhere, Misty included.
    expect(
      banqi.querySelector('.pp-step-level .pp-step-value')?.classList.contains('is-named'),
    ).toBe(true);
  });

  it('says which engine a level is and marks the ones on a net', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const xiangqi = row(board, 'xiangqi');
    const sub = () => xiangqi.querySelector('.pp-step-level .pp-step-sub')?.textContent;
    expect(sub()).toBe('Fairy-Stockfish');
    clickNext(xiangqi, 'level', 6);
    expect(stepValue(xiangqi, 'level')).toBe('Level 8');
    expect(sub()).toBe('Fairy-Stockfish · NNUE');
    clickNext(xiangqi, 'level');
    expect(stepValue(xiangqi, 'level')).toBe('Pikafish');
    expect(sub()).toBe('NNUE');
    const jieqi = row(board, 'jieqi');
    expect(jieqi.querySelector('.pp-step-level .pp-step-sub')?.textContent).toBe('Pikafish');
  });

  it('only searches for a person from Find, never from a stray row click', () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const person = row(board, 'xiangqi', 'person');
    person.querySelector<HTMLElement>('.pp-name')!.click();
    person.click();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(true);
  });

  it('never offers a fog bot a clock under a 5 s increment (#283)', () => {
    const fog = panelBotPaces('dark-chess');
    expect(fog.ids.length).toBeGreaterThan(0);
    expect(fog.ids).not.toContain('3m2');
    expect(fog.ids).not.toContain('1m1');
    expect(panelBotPaces('xiangqi').defaultId).toBe('10m5');
  });

  it('starts the chosen bot and clock in one click, labelled and remembered', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ url: '/xiangqi/room-1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const xiangqi = row(board, 'xiangqi');
    clickNext(xiangqi, 'level', 2);
    // Clock stepper: 10+5 is the slowest bot pace, so step down once.
    xiangqi.querySelectorAll<HTMLButtonElement>('.pp-step-clock .pp-step-btn')[0]!.click();
    xiangqi.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/rooms');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      mode: 'pve',
      botId: 'fairy-stockfish-level-4',
      gameSpecId: 'xiangqi',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
    expect(JSON.parse(sessionStorage.getItem('mistboard.gameStartSource') ?? '{}').source).toBe(
      'panel-bot',
    );
    const stored = JSON.parse(localStorage.getItem('mistboard.playPanel.v1') ?? '{}');
    expect(stored.last).toEqual({
      gameSpecId: 'xiangqi',
      botId: 'fairy-stockfish-level-4',
      tc: '5m5',
    });
  });

  it('offers Play again for the last bot game, and keeps the picked level', () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({
        last: { gameSpecId: 'jieqi', botId: 'pikafish-level-5', tc: '10m5' },
        bots: { jieqi: { botId: 'pikafish-level-5', tc: '10m5' } },
      }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    const again = board.querySelector('.pp-feature-again');
    expect(again?.textContent).toContain('Play again');
    expect(again?.textContent).toContain('Pikafish Level 5');
    expect(stepValue(row(board, 'jieqi'), 'level')).toBe('Level 5');
  });

  it('shows a waiting player on top and counts open games on the person tab', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (input === '/api/lobby') {
          return Response.json({
            requests: [
              {
                gameSpecId: 'xiangqi',
                rated: false,
                timeControl: { initialMs: 300_000, incrementMs: 5_000 },
                waitingMs: 14_000,
              },
            ],
          });
        }
        if (input === '/api/live-stats') return Response.json({ playingBySpec: { jieqi: 3 } });
        return Response.json({});
      }),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    expect(board.querySelector('.pp-feature-waiting')?.textContent).toContain('Xiangqi');
    expect(board.querySelector('.pp-badge')?.textContent).toBe('1');
    expect(row(board, 'jieqi').querySelector('.pp-playing')?.textContent).toBe('3 playing');
    const person = row(board, 'xiangqi', 'person');
    expect(person.classList.contains('has-waiting')).toBe(true);
    expect(person.querySelector('.pp-waiting')?.textContent).toBe('1 waiting');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('does not offer you your own seek while you wait', async () => {
    vi.useFakeTimers();
    const mine = {
      gameSpecId: 'xiangqi',
      rated: false,
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      waitingMs: 1_000,
    };
    let posted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === '/api/lobby' && init?.method === 'POST') {
          posted = true;
          return Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 });
        }
        if (input === '/api/lobby') return Response.json({ requests: posted ? [mine] : [] });
        return Response.json({});
      }),
    );
    const board = buildPlayPanel('en');
    document.body.append(board);
    await vi.advanceTimersByTimeAsync(0);
    row(board, 'xiangqi', 'person').querySelector<HTMLButtonElement>('.pp-act')!.click();
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();

    expect(posted).toBe(true);
    expect(board.querySelector('.pp-offer')).toBeNull();
    expect(board.querySelector('.pp-feature-waiting')).toBeNull();
    expect(board.querySelector<HTMLElement>('.pp-badge')?.hidden).toBe(true);
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('sends a guest who picks Rated to sign in', () => {
    setRatedModeEnabled(true);
    const board = buildPlayPanel('en', { hydrate: false });
    const rated = [...board.querySelectorAll<HTMLButtonElement>('.pp-mode-btn')].find(
      (el) => el.textContent === 'Rated',
    );
    rated?.click();
    expect(window.location.href).toContain('/account?tab=login');
  });

  it('narrows rated to the rated clocks and keeps days per move casual-only', () => {
    const rated = panelPersonPaces('xiangqi', 'rated');
    const ratedIds = new Set(RATED_TIME_CONTROLS.map((tc) => tc.id));
    expect(rated.every((p) => p.kind === 'live' && ratedIds.has(p.id))).toBe(true);
    const casual = panelPersonPaces('xiangqi', 'casual');
    expect(casual.some((p) => p.kind === 'days')).toBe(true);
    expect(panelPersonPaces('jieqi', 'casual').some((p) => p.kind === 'days')).toBe(false);
  });

  it('orders rows by the server ranking, then canonical order', () => {
    expect(orderPanelSpecs(['xiangqi', 'banqi', 'jieqi'], ['jieqi'])).toEqual([
      'jieqi',
      'xiangqi',
      'banqi',
    ]);
    expect(orderPanelSpecs(['banqi', 'xiangqi'], undefined)).toEqual(['xiangqi', 'banqi']);
  });

  it('turns on with ?hero=grid, stays on, and turns off with ?hero=lobby', () => {
    expect(playPanelEnabled('')).toBe(false);
    expect(playPanelEnabled('?hero=grid')).toBe(true);
    expect(playPanelEnabled('')).toBe(true);
    expect(playPanelEnabled('?hero=lobby')).toBe(false);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
