import { canonicalVariantOrderIndex, type GameSpecId } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLandingPlayPanel,
  buildLobbyRequestsWindow,
  type LandingRoomSetup,
  maybeOpenPlayDeepLink,
  roomCreationRequestBody,
  setRoomNavigator,
} from './landing-play.js';
import { setRatedModeEnabled } from './rated-flag.js';
import { setResolvedSignedIn } from './signed-in-state.js';

// The public shelf keeps the xiangqi family together, pairs Fog Xiangqi with
// Fog Chess, then closes with Jungle + Flip Jungle.
const BASELINE_PICKER_SPECS = [
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
];

describe('landing play panel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
    setRatedModeEnabled(false);
    setResolvedSignedIn(undefined);
    setRoomNavigator(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('hides parked chess variants in production without client launch flags', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    openPlaySetup(panel, 'Challenge a friend');

    expect(variantPickerSpecs()).toEqual(BASELINE_PICKER_SPECS);
  });

  it('hides the bot row when only one bot is available', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    // Dark chess is the variant whose bot roster comes from the passed-in list
    // (empty here); the dialog opens on xiangqi, which has its own tenant bots.
    selectModalVariant('dark-chess');
    const overlay = document.querySelector('.landing-setup-overlay');

    expect(document.querySelector<HTMLElement>('[data-setup-section="engine"]')?.hidden).toBe(true);
    expect(overlay?.textContent).not.toContain('Random Legal');
  });

  it('localizes the first-screen play actions', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );

    const panel = buildLandingPlayPanel([], { locale: 'zh-Hant' });
    document.body.append(panel);

    // The panel is the single unified Play button; the per-opponent choices
    // localize inside the dialog's switcher.
    expect(panel.textContent).toContain('開始對局');
    openPlaySetup(panel, '對戰機器人');
    const switcher = document.querySelector('.landing-setup-mode-switcher');
    expect(switcher?.textContent).toContain('機器人');
    expect(switcher?.textContent).toContain('好友');
    expect(switcher?.textContent).toContain('大廳');
  });

  it('localizes the play setup dialog shell', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );

    const panel = buildLandingPlayPanel([], { locale: 'zh-Hant' });
    document.body.append(panel);

    openPlaySetup(panel, '挑戰好友');

    expect(document.querySelector('.landing-setup-title')?.textContent).toBe('開始對局');
    expect(document.querySelector('[aria-label="對局類型"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="變體"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="用時"]')).not.toBeNull();
    // Xiangqi pivot: DMX is hidden from the picker; assert a still-visible
    // xiangqi variant card (Dark Xiangqi) localizes instead.
    expect(document.body.textContent).toContain('迷霧象棋');
    expect(document.querySelector('.landing-setup-start')?.textContent).toBe('建立房間');
    expect(document.querySelector('.landing-setup-close')?.getAttribute('aria-label')).toBe(
      '關閉設定',
    );
  });

  it('puts opponent near the end and only shows Bot when there are multiple choices', () => {
    vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    expect(document.querySelector('.landing-setup-title')?.textContent).toBe('Play a game');
    selectModalVariant('dark-chess');
    expect(setupSectionOrder()).toEqual(['variant', 'time', 'side', 'gameType', 'opponent']);
    selectModalVariant('dark-xiangqi');
    expect(document.querySelector<HTMLElement>('[data-setup-section="gameType"]')?.hidden).toBe(
      false,
    );
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('.landing-start-option')].find(
        (button) => button.textContent === 'Ratedcoming soon',
      )?.disabled,
    ).toBe(true);
    selectModalVariant('xiangqi');
    expect(setupSectionOrder()).toEqual([
      'variant',
      'time',
      'side',
      'gameType',
      'opponent',
      'engine',
    ]);

    openPlaySetup(panel, 'Challenge a friend');
    expect(setupSectionOrder()).toEqual(['variant', 'time', 'side', 'gameType', 'opponent']);

    openPlaySetup(panel, 'Find opponent');
    expect(setupSectionOrder()).toEqual(['variant', 'time', 'gameType', 'opponent']);
  });

  it('uses chess kings for Fog Chess and red/blue elephants for Jungle sides', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('dark-chess');
    const kings = document.querySelectorAll('.landing-color-piece.chess svg');
    expect(kings).toHaveLength(4);
    expect([...kings].every((king) => king.getAttribute('viewBox') === '0 0 45 45')).toBe(true);

    selectModalVariant('jungle');
    const options = [...document.querySelectorAll<HTMLElement>('.landing-color-option')];
    expect(
      options.map((option) => option.querySelector('.landing-color-label')?.textContent),
    ).toEqual(['Red', 'Random', 'Blue']);
    expect(
      [...options[0]!.querySelectorAll<HTMLImageElement>('.landing-color-piece.jungle')].map(
        (image) => image.getAttribute('src'),
      ),
    ).toEqual(['/piece-sets/jungle/dobutsu/red-elephant.png']);
    expect(
      [...options[1]!.querySelectorAll<HTMLImageElement>('.landing-color-piece.jungle')].map(
        (image) => image.getAttribute('src'),
      ),
    ).toEqual([
      '/piece-sets/jungle/dobutsu/red-elephant.png',
      '/piece-sets/jungle/dobutsu/black-elephant.png',
    ]);
    expect(
      [...options[2]!.querySelectorAll<HTMLImageElement>('.landing-color-piece.jungle')].map(
        (image) => image.getAttribute('src'),
      ),
    ).toEqual(['/piece-sets/jungle/dobutsu/black-elephant.png']);
  });

  it('localizes the open lobby requests window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          requests: [
            {
              gameSpecId: 'dark-chess',
              hiddenDraft960: false,
              rated: false,
              timeControl: { initialMs: 180_000, incrementMs: 2_000 },
              waitingMs: 65_000,
            },
          ],
        }),
      ),
    );

    const shell = buildLobbyRequestsWindow('zh-Hant');
    document.body.append(shell);
    await flushPromises();

    expect(shell.getAttribute('aria-label')).toBe('公開配對請求');
    expect(shell.textContent).toContain('公開請求');
    expect(shell.textContent).toContain('1 個等待中');
    expect(shell.textContent).toContain('休閒');
    expect(shell.textContent).toContain('已等待 1m');
    expect(shell.querySelector('button')?.textContent).toBe('加入');
  });

  it('shows finalized one-color markers for the baseline picker variants', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');
    vi.stubEnv('VITE_JIEQI_ENABLED', 'false');
    vi.stubEnv('VITE_BANQI_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');

    expect(variantPickerPresent()).toBe(true);
    expect(variantPickerSpecs()).toEqual(BASELINE_PICKER_SPECS);
    expect(
      document.querySelector(
        '.landing-variant-card[data-game-spec="dark-chess"] span[data-variant-marker-id="dark-chess"]',
      ),
    ).not.toBeNull();
    // Mini Xiangqi is hidden from the baseline picker post-pivot; assert a
    // still-listed xiangqi variant renders its marker instead.
    expect(
      document.querySelector(
        '.landing-variant-card[data-game-spec="dark-xiangqi"] span[data-variant-marker-id="dark-xiangqi"]',
      ),
    ).not.toBeNull();
  });

  it('starts setup on Variant and shows all offered variants together', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');

    expect(activeSetupSection()).toBe('variant');
    expect(document.querySelector('[aria-label="Game group"]')).toBeNull();
    expect(visibleVariantPickerSpecs()).toEqual(BASELINE_PICKER_SPECS);
    expect(selectedVariantSpec()).toBe('dark-chess');

    selectModalVariant('fortress-xiangqi');

    expect(activeSetupSection()).toBe('time');
    expect(selectedVariantSpec()).toBe('fortress-xiangqi');
  });

  it('opens a first-time player on the flagship variant, not the fog one', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    for (const entry of ['Play a bot', 'Challenge a friend', 'Find opponent']) {
      openPlaySetup(panel, entry);
      expect(selectedVariantSpec()).toBe('xiangqi');
      document.querySelector('.landing-setup-overlay')?.remove();
    }
  });

  it('does not render game groups in the engine flow', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');

    expect(document.querySelector('[aria-label="Game group"]')).toBeNull();
    expect(variantPickerSpecs()).toContain('dark-chess');
    expect(variantPickerSpecs()).toContain('dark-xiangqi');
    const darkXiangqi = document.querySelector<HTMLButtonElement>(
      '.landing-variant-card[data-game-spec="dark-xiangqi"]',
    );
    expect(darkXiangqi?.disabled).toBe(false);
  });

  it('creates dark chess rooms with a canonical game spec id behind the Variant UI', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/dark_home' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('dark-chess');
    const createButton = [...document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Create room',
    );
    createButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    const roomCall = fetchSpy.mock.calls.find(([input]) => String(input) === '/api/rooms');
    expect(roomCall).toBeDefined();
    expect(JSON.parse(String(roomCall?.[1]?.body))).toEqual({
      mode: 'pvp',
      gameSpecId: 'dark-chess',
      hiddenDraft960: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      rated: false,
      preferredColor: 'random',
    });
    expect(window.location.pathname).toBe('/room/dark_home');
  });

  it('remembers start setup separately for engine, friend, and lobby entry points', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/sticky' });
      if (String(input) === '/api/lobby' && init?.method === 'POST') {
        return jsonResponse({ status: 'waiting', ticketId: 'sticky-ticket', pollAfterMs: 60_000 });
      }
      return jsonResponse({ requests: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    clickModalButton('1 + 1');
    clickModalColor('Black');
    clickModalButton('Start game');
    await flushPromises();
    document.querySelector('.landing-setup-overlay')?.remove();

    // Each entry point starts at the variant's default pace (xiangqi = 10+5)
    // until that entry point has remembered a choice of its own.
    openPlaySetup(panel, 'Challenge a friend');
    expect(selectedModalTimeControl()).toBe('10 + 5');
    expect(selectedModalColor()).toBe('Random');
    // Xiangqi is the default variant, so the colour row reads Red/Random/Black.
    clickModalColor('Red');
    clickModalButton('Create room');
    await flushPromises();
    document.querySelector('.landing-setup-overlay')?.remove();

    openPlaySetup(panel, 'Find opponent');
    expect(selectedModalTimeControl()).toBe('10 + 5');
    expect(document.querySelector('.landing-color-label')).toBeNull();
    clickModalButton('1 + 1');
    clickModalButton('Find opponent');
    await flushPromises();
    document.querySelector('.landing-setup-overlay')?.remove();

    openPlaySetup(panel, 'Play a bot');
    expect(selectedModalTimeControl()).toBe('1 + 1');
    expect(selectedModalColor()).toBe('Black');
    document.querySelector('.landing-setup-overlay')?.remove();

    openPlaySetup(panel, 'Challenge a friend');
    expect(selectedModalTimeControl()).toBe('10 + 5');
    expect(selectedModalColor()).toBe('Red');
    document.querySelector('.landing-setup-overlay')?.remove();

    openPlaySetup(panel, 'Find opponent');
    expect(selectedModalTimeControl()).toBe('1 + 1');
  });

  // A rules-page CTA names no side, and landing on second means the board moves
  // before the visitor has touched anything. On the flip pair the picker is move
  // order rather than ink, so "Second" is the whole first impression.
  for (const { gameSpecId, label } of [
    { gameSpecId: 'jungle-flip', label: 'First' },
    { gameSpecId: 'banqi', label: 'First' },
    { gameSpecId: 'jieqi', label: 'Red' },
  ]) {
    it(`opens a ${gameSpecId} engine deep link on the first mover`, async () => {
      const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
        if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/first_mover' });
        return jsonResponse({}, { status: 404 });
      });
      vi.stubGlobal('fetch', fetchSpy);
      setRoomNavigator(() => {});
      window.history.replaceState(null, '', `/?play=computer&gameSpecId=${gameSpecId}`);

      maybeOpenPlayDeepLink([]);
      expect(selectedModalColor()).toBe(label);

      clickModalButton('Start game');
      await flushPromises();

      expect(roomPostBody(fetchSpy)).toMatchObject({
        mode: 'pve',
        gameSpecId,
        preferredColor: 'red',
      });
    });
  }

  it('keeps the coin flip on Challenge a friend, where it is the fairness rule', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    expect(selectedModalColor()).toBe('Random');
  });

  // Sides are variant-declared, so an untouched default must not persist as if it
  // were a pick: xiangqi's 'red' coerces to the SECOND seat in any variant whose
  // first mover is not red, which would seat a player who never chose anything.
  it('does not let an untouched engine side follow the player into another variant', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/no_leak' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
    const panel = buildLandingPlayPanel([
      { id: 'python-v2-v1.0', name: 'Misty', familyName: 'Misty', kind: 'fog-chess' },
    ]);
    document.body.append(panel);

    // Xiangqi (red opens): take the default without touching the picker.
    openPlaySetup(panel, 'Play a bot');
    expect(selectedModalColor()).toBe('Red');
    clickModalButton('Start game');
    await flushPromises();
    document.querySelector('.landing-setup-overlay')?.remove();
    // roomPostBody reads the FIRST /api/rooms POST; drop the xiangqi one so the
    // assertion below cannot pass on a stale call.
    fetchSpy.mockClear();

    // Fog Chess opens white. A remembered 'red' would coerce to Black here.
    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('dark-chess');
    expect(selectedModalColor()).toBe('White');

    clickModalButton('Start game');
    await flushPromises();
    expect(roomPostBody(fetchSpy)).toMatchObject({
      mode: 'pve',
      preferredColor: 'white',
    });
  });

  it('remembers an engine side the player actually picked', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/sticky_side' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('jungle-flip');
    expect(selectedModalColor()).toBe('First');
    clickModalColor('Second');
    clickModalButton('Start game');
    await flushPromises();
    expect(roomPostBody(fetchSpy)).toMatchObject({ preferredColor: 'black' });
    document.querySelector('.landing-setup-overlay')?.remove();

    openPlaySetup(panel, 'Play a bot');
    expect(selectedModalColor()).toBe('Second');
  });

  it('shows Banqi first and second move-order choices in the setup modal', async () => {
    vi.stubEnv('VITE_BANQI_ENABLED', 'true');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/bq_home' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('banqi');

    const picker = document
      .querySelector('.landing-color-option')
      ?.closest<HTMLElement>('.landing-start-options');
    expect(picker?.getAttribute('aria-label')).toBe('Move order');
    expect(modalColorOptions()).toEqual([
      { label: 'First', glyph: '1', classes: 'landing-color-glyph banqi-seat' },
      { label: 'Random', glyph: '12', classes: 'landing-color-glyph random banqi-seat' },
      { label: 'Second', glyph: '2', classes: 'landing-color-glyph banqi-seat' },
    ]);

    clickModalColor('Second');
    clickModalButton('Create room');
    await flushPromises();

    expect(roomPostBody(fetchSpy)).toEqual({
      mode: 'pvp',
      gameSpecId: 'banqi',
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      preferredColor: 'black',
    });
    expect(window.location.pathname).toBe('/room/bq_home');
  });

  it('remembers each variant engine pick independently (no cross-variant clobber)', () => {
    vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
    vi.stubEnv('VITE_JIEQI_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    // Pick the strongest xiangqi engine (the default is level 4)...
    selectModalVariant('xiangqi');
    selectModalEngine('fairy-stockfish-xiangqi-level-8');
    // ...then visit Jieqi (one public bot since consolidation, so the bot row
    // disappears entirely)...
    selectModalVariant('jieqi');
    expect(document.querySelector<HTMLElement>('[data-setup-section="engine"]')?.hidden).toBe(true);
    // ...and back to xiangqi: the earlier pick must survive the round-trip.
    selectModalVariant('xiangqi');
    expect(document.querySelector<HTMLElement>('[data-setup-section="engine"]')?.hidden).toBe(
      false,
    );
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Bot"]')!.value).toBe(
      'fairy-stockfish-xiangqi-level-8',
    );
  });

  it('makes the last-played engine sticky across reopening the setup dialog', async () => {
    vi.stubEnv('VITE_XIANGQI_ENABLED', 'true');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/xq_engine' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('xiangqi');
    selectModalEngine('fairy-stockfish-xiangqi-level-8');
    clickModalColor('Black');
    clickModalButton('Start game');
    await flushPromises();

    // Reopen: level 8 (a non-default pick) should be preselected.
    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('xiangqi');
    expect(document.querySelector<HTMLSelectElement>('select[aria-label="Bot"]')!.value).toBe(
      'fairy-stockfish-xiangqi-level-8',
    );
  });

  // The fog engines' per-move floor outruns a 1s or 2s increment and they lose
  // on time in long games (#283), so bot games there are pinned to the slowest
  // pace. The pin is PvE-only: the same variant keeps all three paces against a
  // human.
  it('pins Fog Chess bot games to 5+5 and starts them there', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/pinned' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('dark-chess');
    expect(visibleModalTimeControls()).toEqual(['5 + 5']);

    // The stored/house default is 3+2, which the pin hides: starting without
    // touching the picker must still send the pinned pace, not the hidden one.
    clickModalButton('Start game');
    await flushPromises();

    expect(roomPostBody(fetchSpy)).toMatchObject({
      mode: 'pve',
      timeControl: { initialMs: 300_000, incrementMs: 5_000 },
    });
  });

  it('pins Fog Xiangqi bot games to 5+5 as well', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('dark-xiangqi');

    expect(visibleModalTimeControls()).toEqual(['5 + 5']);
  });

  it('leaves human fog games on every pace', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('dark-chess');
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5', '10 + 5']);

    selectModalVariant('dark-xiangqi');
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5', '10 + 5']);
  });

  it('offers 1+1 for Fortress Xiangqi', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('fortress-xiangqi');

    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5', '10 + 5']);
  });

  it('offers correspondence days for casual dark chess in both friend challenge and find opponent', () => {
    vi.stubEnv('VITE_CORRESPONDENCE_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    // Challenge a friend, dark chess: the Real time / Correspondence segmented
    // toggle is offered, and flipping to Correspondence reveals the day chips.
    openPlaySetup(panel, 'Challenge a friend');
    selectModalVariant('dark-chess');
    expect(correspondenceToggleVisible()).toBe(true);
    expect(visibleCorrespondenceOptions()).toEqual([]); // hidden until the segment is active
    clickModalButton('Correspondence');
    expect(visibleCorrespondenceOptions()).toEqual(['1 day', '3 days', '7 days']);

    // Other fog variants (Dark Xiangqi) don't carry correspondence yet — dark
    // chess only — so the toggle disappears and the picker falls back to real time.
    selectModalVariant('dark-xiangqi');
    expect(correspondenceToggleVisible()).toBe(false);
    expect(visibleCorrespondenceOptions()).toEqual([]);

    // Find opponent offers it too (submitting posts an open seek to the board).
    openPlaySetup(panel, 'Find opponent');
    selectModalVariant('dark-chess');
    expect(correspondenceToggleVisible()).toBe(true);
    clickModalButton('Correspondence');
    expect(visibleCorrespondenceOptions()).toEqual(['1 day', '3 days', '7 days']);
  });

  it('an untouched pace follows the variant; a chosen one sticks across variants', () => {
    // Every variant OFFERS 10+5, but only xiangqi and jieqi DEFAULT to it. That
    // distinction only survives if an untouched preset re-resolves on a variant
    // switch: the preset is no longer narrowed out of the allowed set when you
    // leave xiangqi, so without this, xiangqi's default would follow the player
    // into banqi and every variant would inherit 10+5 by the back door.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Challenge a friend');
    expect(selectedModalTimeControl()).toBe('10 + 5'); // xiangqi, the default variant

    selectModalVariant('banqi');
    expect(selectedModalTimeControl()).toBe('3 + 2'); // banqi keeps the house pace

    // An explicit pick survives the switch, including onto a variant whose own
    // default differs.
    clickModalButton('10 + 5');
    selectModalVariant('jungle');
    expect(selectedModalTimeControl()).toBe('10 + 5');
  });

  it('offers every rated-eligible pace in rated setup', () => {
    setRatedModeEnabled(true);
    setResolvedSignedIn(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    // The default variant here is xiangqi, which carries the deliberate ladder:
    // 10+5 is offered casually but is casual-ONLY (rated: false on the spec), so
    // the rated toggle is what separates the two sets. A variant whose picker
    // omits a pace still omits it rated: allowedTimePresetIds narrows the
    // variant's own set.
    openPlaySetup(panel, 'Find opponent');
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5']);

    clickModalButton('Casual');
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5', '10 + 5']);

    clickModalButton('Rated');
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5']);
  });

  it('keeps rated setup disabled for signed-out players', () => {
    setRatedModeEnabled(true);
    setResolvedSignedIn(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Find opponent');

    expect(document.body.textContent).toContain('Ratedcoming soon');
    // Signed out is casual, so xiangqi's casual-only 10+5 rung shows here.
    expect(visibleModalTimeControls()).toEqual(['1 + 1', '3 + 2', '5 + 5', '10 + 5']);
  });

  it('hides Dark Mini Xiangqi from the browse picker even with its flags on', () => {
    // Xiangqi pivot: DMX is de-listed from the browse picker (offerInMenu=false)
    // regardless of its enable flags; it stays reachable only by deep link.
    vi.stubEnv('DEV', false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    [...panel.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === 'Challenge a friend')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  it('creates a Dark Xiangqi engine room with server-defaulted bot and selected color', async () => {
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'true');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
      if (String(input) === '/api/rooms') return jsonResponse({ url: '/room/dxq_engine' });
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    setRoomNavigator(() => {});
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);

    openPlaySetup(panel, 'Play a bot');
    selectModalVariant('dark-xiangqi');
    expect(document.querySelector<HTMLElement>('[data-setup-section="engine"]')?.hidden).toBe(true);
    clickModalColor('Black');
    clickModalButton('Start game');
    await flushPromises();

    expect(roomPostBody(fetchSpy)).toMatchObject({
      mode: 'pve',
      gameSpecId: 'dark-xiangqi',
      preferredColor: 'black',
    });
    expect(roomPostBody(fetchSpy)).not.toHaveProperty('engineId');
  });

  it('keeps the old engine deep-link alias working', () => {
    window.history.replaceState(null, '', '/?play=engine');

    maybeOpenPlayDeepLink([]);

    expect(document.querySelector('.landing-setup-title')?.textContent).toBe('Play a game');
    expect(window.location.search).toBe('');
  });

  it('offers Dark Xiangqi (9x10) in the play menu', () => {
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    openPlaySetup(panel, 'Challenge a friend');

    expect(variantPickerSpecs()).toContain('dark-xiangqi');
  });

  it('keeps Dark Xiangqi in the play menu when the old flag is off', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    openPlaySetup(panel, 'Challenge a friend');

    expect(variantPickerSpecs()).toContain('dark-xiangqi');
  });

  it('orders the variant picker by the shared canonical variant order', () => {
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'true');
    vi.stubEnv('VITE_JIEQI_ENABLED', 'true');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    openPlaySetup(panel, 'Challenge a friend');

    const specs = variantPickerSpecs();
    const canonical = [...specs].sort(
      (a, b) =>
        canonicalVariantOrderIndex(a as GameSpecId) - canonicalVariantOrderIndex(b as GameSpecId),
    );
    expect(specs).toEqual(canonical);
    // The mini xiangqi trio is hidden; the two public fog games stay adjacent
    // ahead of the Jungle pair.
    expect(specs).toContain('dark-xiangqi');
    expect(specs.indexOf('dark-xiangqi')).toBeLessThan(specs.indexOf('dark-chess'));
    expect(specs.indexOf('dark-chess')).toBeLessThan(specs.indexOf('jungle'));
    expect(specs.indexOf('jungle')).toBeLessThan(specs.indexOf('jungle-flip'));
  });

  it('sends the chess game spec id when finding a chess opponent', async () => {
    const fetchSpy = lobbyFetchSpy();
    vi.stubGlobal('fetch', fetchSpy);
    const panel = buildLandingPlayPanel([]);
    document.body.append(panel);
    openLobbySetup(panel);
    selectModalVariant('dark-chess');
    document
      .querySelector<HTMLButtonElement>('.landing-setup-start')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(lobbyPostBody(fetchSpy).gameSpecId).toBe('dark-chess');
  });

  // RETIRED 2026-09-04 (Brian). Mini Xiangqi was hidden from the picker in the
  // 2026-07-03 pivot but kept an unconditional deep link, so a link was its only
  // door; that door is now closed. The three tests that pinned its friend /
  // engine / lobby deep links were replaced by this one.
  it('no longer soft-links Mini Xiangqi from a deep link, in any play mode', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ playing: 0, online: 0 })),
    );
    for (const mode of ['friend', 'computer', 'lobby']) {
      document.body.replaceChildren();
      window.history.replaceState(null, '', `/?play=${mode}&gameSpecId=mini-xiangqi`);
      maybeOpenPlayDeepLink([]);
      expect(softLinkedVariantLabel(), `play=${mode}`).toBeUndefined();
      expect(document.body.textContent, `play=${mode}`).not.toContain('Mini Xiangqi');
    }
  });
});

// Resolve the "Find opponent" mode → setup screen (via the unified Play button
// plus the dialog's opponent switcher); the start button is
// `.landing-setup-start`.
function openLobbySetup(panel: HTMLElement): void {
  openPlaySetup(panel, 'Find opponent');
}

// The panel is a single unified Play button since the homepage rework; the
// old per-mode entry labels map onto the dialog's opponent switcher segments.
const PLAY_SETUP_MODE_BY_LABEL: Record<string, 'pve' | 'pvp' | 'lobby'> = {
  'Play a bot': 'pve',
  對戰機器人: 'pve',
  'Challenge a friend': 'pvp',
  挑戰好友: 'pvp',
  'Find opponent': 'lobby',
  尋找對手: 'lobby',
};

function openPlaySetup(panel: HTMLElement, label: string): void {
  panel
    .querySelector<HTMLButtonElement>('.landing-play-action')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const mode = PLAY_SETUP_MODE_BY_LABEL[label];
  if (mode && mode !== 'pve') {
    document
      .querySelector<HTMLButtonElement>(`.landing-setup-mode-switcher [data-play-mode="${mode}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}

function clickModalButton(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('.landing-setup-dialog button')]
    .find((button) => button.textContent === label)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clickModalColor(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('.landing-color-option')]
    .find((button) => button.querySelector('.landing-color-label')?.textContent === label)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function clickModalTimeControl(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('.landing-time-presets button')]
    .find((button) => button.textContent?.trim() === label)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function selectModalVariant(gameSpecId: string): void {
  const card = document.querySelector<HTMLButtonElement>(
    `.landing-variant-card[data-game-spec="${gameSpecId}"]`,
  );
  expect(card).not.toBeNull();
  card!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// The variant picker is a card grid (was a <select>): these read the cards.
function variantPickerSpecs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.landing-variant-card[data-game-spec]')].map(
    (el) => el.dataset.gameSpec ?? '',
  );
}

function visibleVariantPickerSpecs(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.landing-variant-card[data-game-spec]')]
    .filter((el) => !el.hidden)
    .map((el) => el.dataset.gameSpec ?? '');
}

function selectedVariantSpec(): string | undefined {
  return document.querySelector<HTMLElement>('.landing-variant-card.selected[data-game-spec]')
    ?.dataset.gameSpec;
}

function activeSetupSection(): string | undefined {
  return document.querySelector<HTMLElement>('.landing-setup-accordion-section.active')?.dataset
    .setupSection;
}

function setupSectionOrder(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.landing-setup-accordion-section')]
    .filter((section) => !section.hidden)
    .map((section) => section.dataset.setupSection ?? '');
}

function variantPickerPresent(): boolean {
  return document.querySelector('.landing-variant-grid') !== null;
}

// Post-pivot, a menu-hidden variant
// reached by deep link is not a browse-grid card — the picker collapses to a single
// soft-linked variant control. In the engine flow the FIRST control is the variant
// and the second is the bot, so read the first.
function softLinkedVariantLabel(): string | undefined {
  return document.querySelector<HTMLElement>('.landing-variant-control')?.textContent?.trim();
}

function selectModalEngine(engineId: string): void {
  const engineSelect = document.querySelector<HTMLSelectElement>('select[aria-label="Bot"]');
  expect(engineSelect).not.toBeNull();
  engineSelect!.value = engineId;
  engineSelect!.dispatchEvent(new Event('change', { bubbles: true }));
}

function selectedModalTimeControl(): string | undefined {
  return [
    ...document.querySelectorAll<HTMLButtonElement>('.landing-time-presets .selected'),
  ][0]?.textContent?.trim();
}

function visibleModalTimeControls(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.landing-time-presets:not(.landing-correspondence-presets) button',
    ),
  ]
    .filter((button) => !button.hidden)
    .map((button) => button.textContent?.trim() ?? '');
}

// Day chips are revealed/hidden as a group by the active time-control segment, so
// read the group's hidden state rather than each button's.
function visibleCorrespondenceOptions(): string[] {
  const group = document.querySelector<HTMLElement>('.landing-correspondence-presets');
  if (!group || group.hidden) return [];
  return [...group.querySelectorAll<HTMLButtonElement>('button')].map(
    (button) => button.textContent?.trim() ?? '',
  );
}

function correspondenceToggleVisible(): boolean {
  const toggle = document.querySelector<HTMLElement>('.landing-time-mode');
  return toggle !== null && !toggle.hidden;
}

function selectedModalColor(): string | undefined {
  return document
    .querySelector<HTMLButtonElement>('.landing-color-option.selected .landing-color-label')
    ?.textContent?.trim();
}

function modalColorOptions(): Array<{ label: string; glyph: string; classes: string }> {
  return [...document.querySelectorAll<HTMLButtonElement>('.landing-color-option')].map(
    (button) => ({
      label: button.querySelector('.landing-color-label')?.textContent?.trim() ?? '',
      glyph: button.querySelector('.landing-color-glyph')?.textContent?.trim() ?? '',
      classes: button.querySelector('.landing-color-glyph')?.className ?? '',
    }),
  );
}

function lobbyFetchSpy(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/live-stats') return jsonResponse({ playing: 0, online: 0 });
    if (String(input) === '/api/lobby' && init?.method === 'POST') {
      return jsonResponse({ status: 'matched', roomId: 'dmxq_lobby', url: '/room/dmxq_lobby' });
    }
    if (String(input) === '/api/lobby') return jsonResponse({ requests: [] });
    return jsonResponse({}, { status: 404 });
  });
}

function lobbyPostBody(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchSpy.mock.calls.find(
    ([input, init]) =>
      String(input) === '/api/lobby' && (init as RequestInit | undefined)?.method === 'POST',
  );
  expect(call).toBeDefined();
  return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
}

function roomPostBody(fetchSpy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchSpy.mock.calls.find(
    ([input, init]) =>
      String(input) === '/api/rooms' && (init as RequestInit | undefined)?.method === 'POST',
  );
  expect(call).toBeDefined();
  return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('roomCreationRequestBody — jungle PvE bots', () => {
  function setupFor(gameSpecId: LandingRoomSetup['gameSpecId']): LandingRoomSetup {
    return {
      gameSpecId,
      startFormat: 'standard',
      rated: false,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
      preferredColor: 'random',
    };
  }

  // Regression: the flip body hardcoded `mode: 'pvp'`, so "Play a bot"
  // created a PvP invite link instead of a bot game.
  it('sends mode=pve and the picked engine id for Flip Jungle', () => {
    const body = roomCreationRequestBody('pve', setupFor('jungle-flip'), 'misty-jungle-flip');
    expect(body.mode).toBe('pve');
    expect(body.engineId).toBe('misty-jungle-flip');
  });

  it('omits the engine id for a PvP Flip Jungle room', () => {
    const body = roomCreationRequestBody('pvp', setupFor('jungle-flip'), 'misty-jungle-flip');
    expect(body.mode).toBe('pvp');
    expect(body.engineId).toBeUndefined();
  });

  it('sends mode=pve and the picked engine id for Jungle', () => {
    const body = roomCreationRequestBody('pve', setupFor('jungle'), 'misty-jungle-level-2');
    expect(body.mode).toBe('pve');
    expect(body.engineId).toBe('misty-jungle-level-2');
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
