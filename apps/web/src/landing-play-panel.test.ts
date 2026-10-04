import { readFileSync } from 'node:fs';
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
  // The level a rung reads as: its second line when the engine has levels,
  // otherwise the engine name alone (the NNUE tag is not part of it).
  const value = el.querySelector(`.pp-step-${which} .pp-step-value`);
  const sub = value?.querySelector('.pp-step-sub')?.textContent;
  if (sub) return sub;
  return value?.querySelector('.pp-step-main')?.firstChild?.textContent ?? '';
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
    expect(banqi.querySelector('.pp-step-level .pp-step-sub')).toBeNull();
    expect(banqi.querySelector('.pp-step-level .pp-step-tag')).toBeNull();
  });

  it('puts the engine on top and the level with its NNUE tag under it', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const xiangqi = row(board, 'xiangqi');
    const main = () =>
      xiangqi.querySelector('.pp-step-level .pp-step-main')?.firstChild?.textContent;
    const tag = () => xiangqi.querySelector('.pp-step-level .pp-step-tag')?.textContent ?? null;
    const sub = () => xiangqi.querySelector('.pp-step-level .pp-step-sub')?.textContent ?? null;
    expect([main(), tag(), sub()]).toEqual(['Fairy-Stockfish', null, 'Level 2']);
    clickNext(xiangqi, 'level', 6);
    expect([main(), tag(), sub()]).toEqual(['Fairy-Stockfish', 'NNUE', 'Level 8']);
    // The tag rides the second line, never the engine name's.
    expect(xiangqi.querySelector('.pp-step-level .pp-step-main .pp-step-tag')).toBeNull();
    expect(xiangqi.querySelector('.pp-step-level .pp-step-meta .pp-step-tag')).not.toBeNull();
    clickNext(xiangqi, 'level');
    expect([main(), tag(), sub()]).toEqual(['Pikafish', 'NNUE', null]);
    expect(xiangqi.querySelector('.pp-step-level .pp-step-main')?.textContent).toBe('Pikafish');
    const jieqi = row(board, 'jieqi');
    expect(jieqi.querySelector('.pp-step-level .pp-step-main')?.firstChild?.textContent).toBe(
      'Pikafish',
    );
    expect(jieqi.querySelector('.pp-step-level .pp-step-tag')).toBeNull();
    // No name is gold: gold in this panel means a person.
    expect(board.querySelector('.pp-step-level .is-named')).toBeNull();
  });

  it('sizes the marker with a rule that outranks the shared 24px seed thumb', () => {
    // The production bundle loads landing.css after this panel's CSS, so an
    // equal-specificity .pp-thumb lost to .landing-lobby-seed-thumb (24px) in
    // prod while dev, loading them the other way round, showed 40px.
    const panelCss = readFileSync('src/landing-play-panel.css', 'utf8');
    const landingCss = readFileSync('src/landing.css', 'utf8');
    expect(landingCss).toMatch(/^\.landing-lobby-seed-thumb \{[^}]*width: 24px/m);
    expect(panelCss).toMatch(/^\.pp-board \.pp-thumb \{[^}]*width: var\(--pp-icon\)/m);
    expect(panelCss).not.toMatch(/^\.pp-thumb \{/m);
  });

  it('covers the bot list on the person tab instead of removing it', () => {
    // The bot list sets the panel's height for both tabs, so it must stay in
    // flow: [hidden] is display:none !important site-wide.
    const board = buildPlayPanel('en', { hydrate: false });
    const computer = board.querySelector<HTMLElement>('.pp-view-computer')!;
    const person = board.querySelector<HTMLElement>('.pp-view-person')!;
    const [computerTab, personTab] = board.querySelectorAll<HTMLButtonElement>('.pp-tab');
    personTab!.click();
    expect(computer.hidden).toBe(false);
    expect(computer.classList.contains('is-covered')).toBe(true);
    expect(computer.inert).toBe(true);
    expect(person.hidden).toBe(false);
    computerTab!.click();
    expect(computer.classList.contains('is-covered')).toBe(false);
    expect(computer.inert).toBe(false);
    expect(person.hidden).toBe(true);
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

  it('offers KataGo above Misty in jungle once /api/bots says it is playable', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input === '/api/bots') {
        return Response.json({
          bots: [
            {
              id: 'misty',
              playOptions: [
                { gameSpecId: 'jungle', playable: true },
                { gameSpecId: 'jungle-flip', playable: true },
              ],
            },
            { id: 'katago', playOptions: [{ gameSpecId: 'jungle', playable: true }] },
          ],
        });
      }
      if (input === '/api/rooms') return Response.json({ url: '/jungle/room-1' }, { status: 201 });
      return Response.json({});
    });
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en');
    document.body.append(board);
    // Before the roster lands the row is the fixed Misty every box can serve.
    expect(row(board, 'jungle').querySelector('.pp-step-level.is-fixed')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    await flush();

    const jungle = row(board, 'jungle');
    expect(stepValue(jungle, 'level')).toBe('Misty');
    expect(jungle.querySelector('.pp-step-level.is-fixed')).toBeNull();
    const [easier, stronger] = jungle.querySelectorAll<HTMLButtonElement>(
      '.pp-step-level .pp-step-btn',
    );
    expect(easier?.getAttribute('aria-label')).toBe('Easier opponent');
    expect(stronger?.getAttribute('aria-label')).toBe('Stronger opponent');
    expect(easier?.disabled).toBe(true);
    clickNext(jungle, 'level');
    expect(stepValue(jungle, 'level')).toBe('KataGo');
    expect(stronger?.disabled).toBe(true);
    // A ResNet, not an NNUE: the general net tag (Brian, 2026-10-04).
    expect(jungle.querySelector('.pp-step-level .pp-step-meta .pp-step-tag')?.textContent).toBe(
      'Neural net',
    );
    // Flip Jungle keeps its single Misty.
    expect(row(board, 'jungle-flip').querySelector('.pp-step-level.is-fixed')).not.toBeNull();

    jungle.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();
    const create = fetchSpy.mock.calls.find(([url]) => url === '/api/rooms');
    expect(JSON.parse(String(create?.[1]?.body))).toMatchObject({
      mode: 'pve',
      botId: 'katago',
      gameSpecId: 'jungle',
    });
    const stored = JSON.parse(localStorage.getItem('mistboard.playPanel.v1') ?? '{}');
    expect(stored.bots.jungle.botId).toBe('katago');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('comes back to a remembered KataGo, and never offers it when the server cannot seat it', async () => {
    vi.useFakeTimers();
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ bots: { jungle: { botId: 'katago', tc: '10m5' } } }),
    );
    let katagoPlayable = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) =>
        input === '/api/bots'
          ? Response.json({
              bots: [
                { id: 'misty', playOptions: [{ gameSpecId: 'jungle', playable: true }] },
                {
                  id: 'katago',
                  playOptions: [{ gameSpecId: 'jungle', playable: katagoPlayable }],
                },
              ],
            })
          : Response.json({}),
      ),
    );
    const remembered = buildPlayPanel('en');
    document.body.append(remembered);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(stepValue(row(remembered, 'jungle'), 'level')).toBe('KataGo');
    remembered.remove();

    katagoPlayable = false;
    const unplayable = buildPlayPanel('en');
    document.body.append(unplayable);
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    const jungle = row(unplayable, 'jungle');
    expect(stepValue(jungle, 'level')).toBe('Misty');
    expect(jungle.querySelector('.pp-step-level.is-fixed')).not.toBeNull();
    unplayable.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('starts a bot game only from Play, never from a stray row click', () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const bot = row(board, 'xiangqi');
    bot.querySelector<HTMLElement>('.pp-name')!.click();
    bot.click();
    expect(fetchSpy).not.toHaveBeenCalled();
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

  it('narrows rated to the rated clocks; days per move are rated where correspondence rates', () => {
    // Rated switch off: rated is live clocks only.
    const rated = panelPersonPaces('xiangqi', 'rated');
    const ratedIds = new Set(RATED_TIME_CONTROLS.map((tc) => tc.id));
    expect(rated.every((p) => p.kind === 'live' && ratedIds.has(p.id))).toBe(true);
    const casual = panelPersonPaces('xiangqi', 'casual');
    expect(casual.some((p) => p.kind === 'days')).toBe(true);
    // Every variant plays by correspondence since 2026-10-02.
    expect(panelPersonPaces('jieqi', 'casual').some((p) => p.kind === 'days')).toBe(true);
    // Rated switch off: no rated days anywhere.
    expect(panelPersonPaces('jieqi', 'rated').some((p) => p.kind === 'days')).toBe(false);
    // Rated switch on (2026-10-02): a correspondence-rated variant offers days in Rated
    // too, live clocks still narrowed to the rated ones.
    // Live rated on alone (rated correspondence held, the default): no rated days.
    setRatedModeEnabled(true);
    expect(panelPersonPaces('xiangqi', 'rated').some((p) => p.kind === 'days')).toBe(false);
    setRatedModeEnabled(true, true);
    const ratedOn = panelPersonPaces('xiangqi', 'rated');
    expect(ratedOn.filter((p) => p.kind === 'live').every((p) => ratedIds.has(p.id))).toBe(true);
    expect(ratedOn.some((p) => p.kind === 'days')).toBe(true);
    expect(panelPersonPaces('jieqi', 'rated').some((p) => p.kind === 'days')).toBe(true);
  });

  it('orders rows in canonical order', () => {
    expect(orderPanelSpecs(['fortress-xiangqi', 'banqi', 'crazyhouse-xiangqi', 'xiangqi'])).toEqual(
      ['xiangqi', 'banqi', 'crazyhouse-xiangqi', 'fortress-xiangqi'],
    );
  });

  it('ignores a play-count order cached by an earlier visit', () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ order: ['jieqi', 'banqi', 'xiangqi', 'crazyhouse-xiangqi'] }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    const specs = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (row) => row.dataset.gameSpec as string,
    );
    expect(specs.length).toBeGreaterThan(1);
    expect(specs).toEqual(orderPanelSpecs(specs));
    expect(specs[0]).toBe('xiangqi');
  });

  it('is on by default; ?hero=lobby brings the old tabs back until ?hero=grid', () => {
    expect(playPanelEnabled('')).toBe(true);
    expect(playPanelEnabled('?hero=lobby')).toBe(false);
    expect(playPanelEnabled('')).toBe(false);
    expect(playPanelEnabled('?hero=grid')).toBe(true);
    expect(playPanelEnabled('')).toBe(true);
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
