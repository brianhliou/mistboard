import { readFileSync } from 'node:fs';
import { GAME_SPECS, isPublicGameSpec, RATED_TIME_CONTROLS } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_PARTY_BOT_PROFILES } from '../../server/src/first-party-bots.js';
import { enabledLandingVariantGameSpecs } from './landing-play.js';
import {
  buildPlayPanel,
  orderPanelSpecs,
  panelBotPaces,
  panelPersonPaces,
  playPanelEnabled,
} from './landing-play-panel.js';
import { resetLiveStatsCacheForTests } from './live-stats-client.js';
import { openLobbySeekCount, withdrawLobbySeeks } from './lobby-seek-registry.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn, setResolvedStatsExcluded } from './signed-in-state.js';

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

// Person rows open on a day per move; a test of the live search picks 5+5 the
// way a returning visitor's saved pace does.
function rememberLivePace(): void {
  localStorage.setItem('mistboard.playPanel.v1', JSON.stringify({ people: { xiangqi: '5m5' } }));
}

// /api/live-stats reads are shared through a module cache; start each test cold.
beforeEach(() => resetLiveStatsCacheForTests());

describe('homepage play panel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
    sessionStorage.clear();
    setResolvedSignedIn(false);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    setRatedModeEnabled(false);
    setResolvedStatsExcluded(undefined);
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
    // A device with no remembered jieqi bot starts on the newcomer level.
    expect(stepValue(jieqi, 'level')).toBe('Level 2');
    clickNext(jieqi, 'level', 6);
    expect(stepValue(jieqi, 'level')).toBe('Level 8');
    clickNext(jieqi, 'level', 12);
    expect(stepValue(jieqi, 'level')).toBe('AB-JChess');
  });

  it('lists every launched bot variant except the named Fog exclusions on both tabs', () => {
    for (const flag of [
      'XIANGQI',
      'JIEQI',
      'BANQI',
      'DARK_XIANGQI',
      'JUNGLE',
      'JUNGLE_FLIP',
      'XIANGQI_MAHJONG',
      'GOMOKU',
      'THREE_KINGDOMS_BANQI',
      'FFQ_BANQI',
      'MAHJONG',
    ]) {
      vi.stubEnv(`VITE_${flag}_ENABLED`, 'true');
    }
    const board = buildPlayPanel('en', { hydrate: false });
    const excluded = ['dark-xiangqi', 'dark-chess'];
    // The same bot identities used by /api/bots, independent of the web
    // picker's PvE predicate: a server bot omitted by the web must fail too.
    const botSpecs = new Set(FIRST_PARTY_BOT_PROFILES.flatMap((bot) => Object.keys(bot.engines)));
    const expected = GAME_SPECS.filter(
      (spec) =>
        spec.runtimeStatus === 'live' &&
        isPublicGameSpec(spec.id) &&
        !excluded.includes(spec.id) &&
        botSpecs.has(spec.id),
    ).map((spec) => spec.id);
    const bots = [...board.querySelectorAll<HTMLElement>('.pp-row-bot')].map(
      (el) => el.dataset.gameSpec,
    );
    expect(bots).toEqual(orderPanelSpecs(expected));
    const people = [...board.querySelectorAll<HTMLElement>('.pp-row-person')].map(
      (el) => el.dataset.gameSpec,
    );
    expect(people).toEqual(
      orderPanelSpecs(
        enabledLandingVariantGameSpecs('pvp', 'en')
          .filter(
            (spec) => isPublicGameSpec(spec.gameSpecId) && !excluded.includes(spec.gameSpecId),
          )
          .map((spec) => spec.gameSpecId),
      ),
    );
    for (const spec of [
      ...excluded,
      ...GAME_SPECS.filter((spec) => !isPublicGameSpec(spec.id)).map((spec) => spec.id),
    ]) {
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
    }
    expect(bots.at(-1)).toBe('gomoku');
    expect(people.at(-1)).toBe('gomoku');
  });

  it('omits flag-off variants and hidden playtests from both tabs', () => {
    vi.stubEnv('DEV', false);
    for (const flag of ['XIANGQI', 'GOMOKU', 'XIANGQI_MAHJONG']) {
      vi.stubEnv(`VITE_${flag}_ENABLED`, 'false');
    }
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', 'true');
    const board = buildPlayPanel('en', { hydrate: false });
    for (const spec of [
      'xiangqi',
      'gomoku',
      'xiangqi-mahjong',
      'three-kingdoms-banqi',
      'ffq-banqi',
    ]) {
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
    }
  });

  it.each(['dark-xiangqi', 'dark-chess'])(
    'keeps %s off remembered and waiting-player hero rows',
    async (spec) => {
      vi.useFakeTimers();
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({ last: { gameSpecId: spec, botId: 'misty', tc: '10m5' } }),
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string) => {
          if (input === '/api/lobby')
            return Response.json({
              requests: [
                {
                  gameSpecId: spec,
                  rated: false,
                  timeControl: { initialMs: 600_000, incrementMs: 5_000 },
                  createdAt: Date.now(),
                },
              ],
            });
          if (input === '/api/correspondence/seeks')
            return Response.json({
              seeks: [{ id: 'fog-seek', gameSpecId: spec, daysPerMove: 1, rated: false }],
            });
          return Response.json({ bots: [], engines: [], playing: 0, online: 0 });
        }),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      await flush();
      expect(board.querySelector(`[data-game-spec="${spec}"]`)).toBeNull();
      expect(board.querySelector('.pp-feature-again')).toBeNull();
      expect(board.querySelector('.pp-feature-waiting')).toBeNull();
      expect(board.querySelector<HTMLElement>('.pp-badge')?.hidden).toBe(true);
      board.remove();
      await vi.advanceTimersByTimeAsync(3_000);
    },
  );

  it('walks Gomoku Levels 1-8, shows its icon and clock, and starts the chosen Rapfi level', async () => {
    vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) =>
      Response.json({ url: '/room/gomoku' }, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    const gomoku = row(board, 'gomoku');
    expect(gomoku.querySelector('[data-variant-marker-id="gomoku"]')).not.toBeNull();
    expect(stepValue(gomoku, 'clock')).toBe('10+5');
    for (let level = 1; level <= 8; level++) {
      expect(stepValue(gomoku, 'level')).toBe(`Level ${level}`);
      expect(gomoku.querySelector('.pp-step-main')?.textContent).toBe('Rapfi');
      if (level < 8) clickNext(gomoku, 'level');
    }
    expect(
      gomoku.querySelectorAll<HTMLButtonElement>('.pp-step-level .pp-step-btn')[1]?.disabled,
    ).toBe(true);
    gomoku.querySelector<HTMLButtonElement>('.pp-act')!.click();
    await flush();
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      botId: 'rapfi-level-8',
      gameSpecId: 'gomoku',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    });
  });

  it.each(['banqi', 'jungle-flip'])(
    'starts %s at Level 4, sends Level 5 and remembers it for Play again',
    async (spec) => {
      const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) =>
        Response.json({ url: '/room/level-5' }, { status: 201 }),
      );
      vi.stubGlobal('fetch', fetchSpy);
      const board = buildPlayPanel('en', { hydrate: false });
      const bot = row(board, spec);
      expect(bot.querySelector('.pp-step-main')?.textContent).toBe('Misty');
      expect(stepValue(bot, 'level')).toBe('Level 4');
      clickNext(bot, 'level');
      bot.querySelector<HTMLButtonElement>('.pp-act')!.click();
      await flush();
      const engineId = `misty-${spec}-level-5`;
      expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
        botId: 'misty',
        gameSpecId: spec,
        engineId,
        mode: 'pve',
        rated: false,
      });
      expect(JSON.parse(localStorage.getItem('mistboard.playPanel.v1')!).bots[spec].botId).toBe(
        engineId,
      );
      expect(
        JSON.parse(localStorage.getItem('mistboard:setup:pve')!).engineIdByGameSpec[spec],
      ).toBe(engineId);
      expect(JSON.parse(localStorage.getItem('mistboard:last-bot-game')!).botId).toBe(engineId);
      const returning = buildPlayPanel('en', { hydrate: false });
      expect(stepValue(row(returning, spec), 'level')).toBe('Level 5');
      expect(returning.querySelector('.pp-feature-again')?.textContent).toContain('Misty Level 5');
      returning.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
      await flush();
      expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)).engineId).toBe(engineId);
    },
  );

  it.each(['banqi', 'jungle-flip'])('maps an old %s stored Misty pick to Level 7', (spec) => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({ bots: { [spec]: { botId: 'misty', tc: '10m5' } } }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    expect(stepValue(row(board, spec), 'level')).toBe('Level 7');
    clickNext(row(board, spec), 'level', 4);
    expect(stepValue(row(board, spec), 'level')).toBe('Level 7');
  });

  it.each(['banqi', 'jungle-flip'])(
    'offers neural %s L8 only after the runtime roster confirms it',
    async (spec) => {
      vi.useFakeTimers();
      const engineId = `misty-${spec}-level-8`;
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({ bots: { [spec]: { botId: engineId, tc: '10m5' } } }),
      );
      let available = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          Response.json(
            url === '/api/engines/playable'
              ? {
                  [spec === 'banqi' ? 'banqiEngines' : 'jungleFlipEngines']: available
                    ? [{ id: engineId }]
                    : [],
                }
              : {},
          ),
        ),
      );
      const board = buildPlayPanel('en');
      document.body.append(board);
      expect(stepValue(row(board, spec), 'level')).toBe('Level 4');
      await vi.advanceTimersByTimeAsync(0);
      expect(stepValue(row(board, spec), 'level')).toBe('Level 8');
      expect(row(board, spec).querySelector('.pp-step-tag')?.textContent).toBe('Neural net');
      board.remove();
      available = false;
      const noNet = buildPlayPanel('en');
      document.body.append(noNet);
      await vi.advanceTimersByTimeAsync(0);
      clickNext(row(noNet, spec), 'level', 12);
      expect(stepValue(row(noNet, spec), 'level')).toBe('Level 7');
      expect(row(noNet, spec).querySelector('.pp-step-tag')).toBeNull();
    },
  );

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

  // #543: .pp-name clips its overflow, so a line box shorter than the font's
  // glyph box (Noto Sans 1.36, CJK fallback 1.45) cuts descenders.
  it('gives both name lines a line box tall enough for descenders', () => {
    const panelCss = readFileSync('src/landing-play-panel.css', 'utf8');
    for (const selector of ['.pp-name-label', '.pp-playing']) {
      const block = panelCss.match(
        new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm'),
      )?.[1];
      const lineHeight = Number(block?.match(/line-height: ([\d.]+);/)?.[1]);
      expect(lineHeight, selector).toBeGreaterThanOrEqual(1.45);
    }
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
    // Flip Jungle's classical ladder does not depend on the bot profile.
    expect(stepValue(row(board, 'jungle-flip'), 'level')).toBe('Level 4');

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
    expect(JSON.parse(localStorage.getItem('mistboard:last-bot-game') ?? '{}')).toEqual({
      gameSpecId: 'xiangqi',
      botId: 'fairy-stockfish-level-4',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
  });

  // Brian, 2026-10-23: the row still named Duck Xiangqi against Fairy-Stockfish
  // Level 8 after a later game, because only this panel's own Play button wrote
  // its record. A game started from the setup dialog or a room's play again
  // writes the shared one, and the row follows it.
  it('offers Play again for a bot game started outside the panel', async () => {
    localStorage.setItem(
      'mistboard.playPanel.v1',
      JSON.stringify({
        last: { gameSpecId: 'duck-xiangqi', botId: 'fairy-stockfish-level-8', tc: '10m5' },
      }),
    );
    // The setup dialog names the jieqi levels by engine id.
    localStorage.setItem(
      'mistboard:last-bot-game',
      JSON.stringify({
        gameSpecId: 'jieqi',
        botId: 'pikafish-jieqi-level-5',
        timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      }),
    );
    const fetchSpy = vi.fn(async () => Response.json({ url: '/jieqi/room-1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    const board = buildPlayPanel('en', { hydrate: false });
    document.body.append(board);
    const again = board.querySelector('.pp-feature-again');
    expect(again?.textContent).toContain('Pikafish Level 5');
    expect(again?.textContent).not.toContain('Duck');
    expect(again?.textContent).toContain('5+5');

    board.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
    await flush();
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      mode: 'pve',
      botId: 'pikafish-level-5',
      gameSpecId: 'jieqi',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
  });

  it('offers no Play again for a last game at a pace the panel has no preset for', () => {
    localStorage.setItem(
      'mistboard:last-bot-game',
      JSON.stringify({
        gameSpecId: 'xiangqi',
        botId: 'fairy-stockfish-level-4',
        timeControl: { initialMs: 420_000, incrementMs: 0 },
      }),
    );
    const board = buildPlayPanel('en', { hydrate: false });
    expect(board.querySelector('.pp-feature-again')).toBeNull();
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
    rememberLivePace();
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
    // Its own line under the label, so a long name cannot ellipsise it away.
    const jieqiName = row(board, 'jieqi').querySelector('.pp-name');
    expect(jieqiName?.querySelector('.pp-name-label')?.textContent).toBe('Jieqi');
    expect(jieqiName?.lastElementChild?.className).toBe('pp-playing');
    const person = row(board, 'xiangqi', 'person');
    expect(person.classList.contains('has-waiting')).toBe(true);
    expect(person.querySelector('.pp-waiting')?.textContent).toBe('1 waiting');
    board.remove();
    await vi.advanceTimersByTimeAsync(3_000);
  });

  it('does not offer you your own seek while you wait', async () => {
    vi.useFakeTimers();
    rememberLivePace();
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

  it('says in plain words why Rated is out of reach, per account state', async () => {
    const { ensureLocaleCatalog } = await import('./i18n/catalog.js');
    await ensureLocaleCatalog('zh-Hans');
    await ensureLocaleCatalog('zh-Hant');
    const note = (board: HTMLElement) => board.querySelector('.pp-note')?.textContent;
    // Rated off on the server: no switch, no note.
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('');
    setRatedModeEnabled(true);
    // A guest is told to sign in.
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('Sign in to play rated games.');
    // A signed-in counted account in Casual sees nothing.
    setResolvedSignedIn(true);
    expect(note(buildPlayPanel('en', { hydrate: false }))).toBe('');
    // A stats-excluded account plays casual only.
    setResolvedStatsExcluded(true);
    const excluded = buildPlayPanel('en', { hydrate: false });
    expect(note(excluded)).toBe('This account plays casual games only.');
    expect(note(buildPlayPanel('zh-Hans', { hydrate: false }))).toBe('此账号只能下休闲对局。');
    expect(note(buildPlayPanel('zh-Hant', { hydrate: false }))).toBe('此帳號只能下休閒對局。');
    for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      expect(note(buildPlayPanel(locale, { hydrate: false }))).not.toMatch(/counted|计入|計入|—/);
    }
  });

  it('shows Casual/Rated once /api/server-status turns rated on after the panel is built', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    expect(board.querySelectorAll('.pp-mode-btn')).toHaveLength(0);
    setRatedModeEnabled(true);
    const labels = [...board.querySelectorAll('.pp-mode-btn')].map((el) => el.textContent);
    expect(labels).toEqual(['Casual', 'Rated']);
  });

  it('opens a person row on a day per move, with no bot-offer note', () => {
    const board = buildPlayPanel('en', { hydrate: false });
    const person = row(board, 'xiangqi', 'person');
    expect(person.querySelector('.pp-step-clock .pp-step-value')?.textContent).toBe('1d/move');
    expect(board.querySelector('.pp-note')?.textContent).toBe('');
    // Rated has no days while rated correspondence is held, so it opens on 5+5.
    setResolvedSignedIn(true);
    setRatedModeEnabled(true);
    const signedIn = buildPlayPanel('en', { hydrate: false });
    [...signedIn.querySelectorAll<HTMLButtonElement>('.pp-mode-btn')]
      .find((el) => el.textContent === 'Rated')!
      .click();
    const rated = row(signedIn, 'xiangqi', 'person');
    expect(rated.querySelector('.pp-step-clock .pp-step-value')?.textContent).toBe('5+5');
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

  // Prod, 2026-10-09: a guest's seek outlived the bot game the same tab
  // started, and the next joiner was seated in a room nobody entered.
  describe('an open seek', () => {
    type Call = { url: string; method: string; keepalive: boolean };
    const lobbyFetch = (opts: { post?: Promise<Response>; poll?: () => Response } = {}) => {
      const calls: Call[] = [];
      const fn = vi.fn(async (input: string, init?: RequestInit) => {
        calls.push({ url: input, method: init?.method ?? 'GET', keepalive: !!init?.keepalive });
        if (input === '/api/lobby' && init?.method === 'POST') {
          return (
            opts.post ??
            Response.json(
              { status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 },
              { status: 202 },
            )
          );
        }
        if (input === '/api/lobby/t1' && !init?.method && opts.poll) return opts.poll();
        if (input === '/api/rooms') return Response.json({ url: '/room/bot-1' }, { status: 201 });
        return Response.json({ ok: true });
      });
      vi.stubGlobal('fetch', fn);
      const index = (url: string, method: string): number =>
        calls.findIndex((c) => c.url === url && c.method === method);
      const deletes = (): Call[] => calls.filter((c) => c.method === 'DELETE');
      return { calls, index, deletes };
    };
    const settle = async (ms = 0): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
      await flush();
    };
    const seek = async (board: HTMLElement): Promise<void> => {
      row(board, 'xiangqi', 'person').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();
    };

    beforeEach(() => {
      vi.useFakeTimers();
      rememberLivePace();
    });
    afterEach(async () => {
      await withdrawLobbySeeks();
    });

    it('withdraws the seek before a bot row starts its game', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(false);

      row(board, 'jieqi').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
      expect(net.calls[del]?.keepalive).toBe(true);
      expect(board.querySelector<HTMLElement>('.pp-search')?.hidden).toBe(true);
      expect(openLobbySeekCount()).toBe(0);
    });

    it('withdraws the seek before Play again starts its game', async () => {
      localStorage.setItem(
        'mistboard.playPanel.v1',
        JSON.stringify({
          last: { gameSpecId: 'jieqi', botId: 'pikafish-level-5', tc: '10m5' },
          people: { xiangqi: '5m5' },
        }),
      );
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);

      board.querySelector<HTMLButtonElement>('.pp-feature-again .pp-act')!.click();
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
    });

    it('deletes a ticket whose POST was still in flight when a bot game started', async () => {
      let answer!: (r: Response) => void;
      const post = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      const net = lobbyFetch({ post });
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      row(board, 'jieqi').querySelector<HTMLButtonElement>('.pp-act')!.click();
      await settle();
      expect(net.index('/api/rooms', 'POST')).toBe(-1);

      answer(Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 60_000 }));
      await settle();

      const del = net.index('/api/lobby/t1', 'DELETE');
      expect(del).toBeGreaterThanOrEqual(0);
      expect(del).toBeLessThan(net.index('/api/rooms', 'POST'));
    });

    it('withdraws the seek with a keepalive DELETE when the page goes away', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);

      window.dispatchEvent(new Event('pagehide'));
      await settle();

      expect(net.deletes()).toEqual([{ url: '/api/lobby/t1', method: 'DELETE', keepalive: true }]);
    });

    it('stops listening for pagehide once the seek is cancelled or matched', async () => {
      const net = lobbyFetch();
      const board = buildPlayPanel('en', { hydrate: false });
      document.body.append(board);
      await seek(board);
      board.querySelector<HTMLButtonElement>('.pp-search-cancel')!.click();
      await settle();
      expect(net.deletes()).toHaveLength(1);
      window.dispatchEvent(new Event('pagehide'));
      await settle();
      expect(net.deletes()).toHaveLength(1);

      const matched = lobbyFetch({
        post: Promise.resolve(
          Response.json({ status: 'waiting', ticketId: 't1', pollAfterMs: 1_000 }),
        ),
        poll: () => Response.json({ status: 'matched', ticketId: 't1', url: '/room/r1' }),
      });
      await seek(board);
      await settle(1_000);
      expect(matched.index('/api/lobby/t1', 'GET')).toBeGreaterThanOrEqual(0);
      window.dispatchEvent(new Event('pagehide'));
      await settle();
      expect(matched.deletes()).toEqual([]);
      expect(openLobbySeekCount()).toBe(0);
    });
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
