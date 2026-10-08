import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveRefs } from '../live-state.js';
import type { ProfileIdentity } from '../profile-link.js';
import {
  createTenantRoomChrome,
  type TenantChromeContext,
  type TenantWebView,
  type WebVariantTenant,
} from './room-chrome.js';

// Direct pins for the chrome branches the per-tenant suites do not reach:
// the scrubbed-replay notice, the PvP invite window (and its PvE/engine
// non-trigger), and the variant-detail meta suffix. The bulk of the chrome
// (clocks, countdowns, confirm dialogs, room actions) stays pinned through
// the DMX room suite, the web reference tenant.

// The locale is read from window.localStorage (i18n/locale.ts resolveLocale);
// happy-dom does not provide one here, so the smallest stand-in does (same shim
// as forum-i18n.test.ts). Empty, every test below reads English.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

type Color = 'white' | 'red';

const tenant: WebVariantTenant<Color> = {
  displayName: 'variant.xiangqi.name',
  colors: ['white', 'red'],
  isColor: (value): value is Color => value === 'white' || value === 'red',
  oppositeColor: (color) => (color === 'white' ? 'red' : 'white'),
  enabled: () => true,
  reviewUrl: (roomId) => `/testboard/game/${roomId}`,
  reasonPhrase: () => 'result.gameRules',
  spectatorBody: 'live.spectatorFullBoard',
  selectInstruction: 'live.selectPieceThenDestination',
};

type CtxOverrides = Partial<{
  view: TenantWebView<Color> | null;
  seat: unknown;
  connectionState: string;
  closeReason: string;
  connectedSeats: Partial<Record<Color, boolean>>;
  seats: Partial<Record<Color, string>>;
  seatDisplayNames: Partial<Record<Color, string>>;
  seatProfiles: Partial<Record<Color, ProfileIdentity>>;
  clock: {
    activeColor: Color | null;
    incrementMs: number;
    initialMs: number;
    remainingMs: Record<Color, number>;
    runningSince: number | null;
  } | null;
  timeControl: { initialMs: number; incrementMs: number; daysPerMove?: number } | null;
  rated: boolean;
  isReplayLive: boolean;
  variantDetail: string | null;
  lobbyMatch: boolean;
  abortDeadline: number | null;
  roomMode: string;
  playAgainRequestBody: Record<string, unknown>;
}>;

function chromeHarness(
  overrides: CtxOverrides = {},
  tenantOverride: WebVariantTenant<Color> = tenant,
) {
  const ctx: TenantChromeContext<Color> = {
    view: () => ('view' in overrides ? (overrides.view ?? null) : playingView()),
    seat: () => overrides.seat ?? 'white',
    connectionState: () => overrides.connectionState ?? 'connected',
    closeReason: () => overrides.closeReason ?? '',
    clock: () => overrides.clock ?? null,
    timeControl: () => overrides.timeControl ?? null,
    connectedSeats: () => overrides.connectedSeats ?? { white: true, red: true },
    seats: () => overrides.seats ?? { white: 'c-white', red: 'c-red' },
    seatDisplayNames: () => overrides.seatDisplayNames ?? {},
    seatProfiles: () => overrides.seatProfiles ?? {},
    abortDeadline: () => overrides.abortDeadline ?? null,
    forfeitDeadline: () => null,
    roomMode: () => overrides.roomMode ?? 'pvp',
    room: () => 'test_room',
    debugRequested: () => false,
    isReplayLive: () => overrides.isReplayLive ?? true,
    orientation: () => 'white',
    playAgainRequestBody: () => overrides.playAgainRequestBody ?? {},
    rematchControls: () => null,
    lobbyMatch: () => overrides.lobbyMatch ?? false,
    rated: () => overrides.rated ?? false,
    ...(overrides.variantDetail !== undefined
      ? { variantDetail: () => overrides.variantDetail ?? null }
      : {}),
  };
  const refs = refsFixture();
  const chrome = createTenantRoomChrome(tenantOverride, ctx);
  chrome.setRenderTarget(refs, { reconnectNow: () => {}, sendSocket: () => true });
  return { chrome, refs };
}

function playingView(overrides: Partial<TenantWebView<Color>> = {}): TenantWebView<Color> {
  return {
    id: 'test_room',
    status: { type: 'playing', turn: 'white' },
    moveNumber: 1,
    ...overrides,
  };
}

describe('tenant room chrome action status', () => {
  it('hides the notice during normal connected play', () => {
    const { chrome, refs } = chromeHarness();
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
  });

  it('names the per-account play lock instead of the tenant room-not-active line', () => {
    const { chrome, refs } = chromeHarness({
      connectionState: 'rejected',
      closeReason: 'play disabled',
    });
    chrome.renderActionStatus();
    expect(refs.actionStatus.textContent).toContain('Playing is off');
    expect(refs.actionStatus.textContent).toContain('This account cannot play games.');
    expect(refs.actionStatus.textContent).not.toContain('room is not active.');
  });

  it('falls back to the tenant rejected line for every other close reason', () => {
    const { chrome, refs } = chromeHarness({
      connectionState: 'rejected',
      closeReason: 'private room',
    });
    chrome.renderActionStatus();
    expect(refs.actionStatus.textContent).toContain('Room unavailable');
    expect(refs.actionStatus.textContent).toContain('This Xiangqi room is not active.');
  });

  it('tells a guest on a rated room it is a rated game and offers a sign-in back here', () => {
    window.history.replaceState(null, '', '/room/jq_rated');
    const { chrome, refs } = chromeHarness({
      connectionState: 'rejected',
      closeReason: 'rated requires account',
    });
    chrome.renderActionStatus();
    const text = refs.actionStatus.textContent ?? '';
    expect(text).toContain('Rated game');
    expect(text).toContain('This is a rated game.');
    expect(text).not.toContain('Room unavailable');
    expect(text).not.toContain('room is not active.');
    const signIn = refs.actionStatus.querySelector<HTMLAnchorElement>('a');
    expect(signIn?.textContent).toBe('Sign in to take your seat');
    // The login page returns the player to this room after sign-in.
    expect(signIn?.getAttribute('href')).toContain('/account?tab=login');
    expect(decodeURIComponent(signIn?.getAttribute('href') ?? '')).toContain('/room/jq_rated');
    window.history.replaceState(null, '', '/');
  });

  it('offers no sign-in on a refusal that signing in would not fix', () => {
    const { chrome, refs } = chromeHarness({
      connectionState: 'rejected',
      closeReason: 'private room',
    });
    chrome.renderActionStatus();
    expect(refs.actionStatus.querySelector('a')).toBeNull();
  });

  describe('a live game refused to a visitor with no seat', () => {
    // The prod report (2026-10-08): a Fog Xiangqi game opened in a private
    // window read "Room unavailable. This Fog Xiangqi room is not active. Create
    // a new invite to start a game." with the board spinning "Connecting".
    afterEach(() => store.clear());

    function refused(tenantOverride?: WebVariantTenant<Color>) {
      return chromeHarness(
        { view: null, seat: null, connectionState: 'rejected', closeReason: 'live game, no seat' },
        tenantOverride,
      );
    }

    it('says the game is in progress and who can see it, not that the room is inactive', () => {
      const { chrome, refs } = refused();
      chrome.renderActionStatus();
      const text = refs.actionStatus.textContent ?? '';
      expect(text).toContain('Game in progress');
      expect(text).toContain(
        'Only its two players can see this game while it is being played. The full game opens here for everyone once it ends.',
      );
      expect(text).not.toContain('Room unavailable');
      expect(text).not.toContain('not active');
      expect(text).not.toContain('invite');
      expect(text).not.toContain('\u2014');
      // Not styled as an error.
      expect(refs.actionStatus.querySelector('.action-notice')?.className).toBe(
        'action-notice default',
      );
    });

    it('offers a signed-out visitor a way back to their seat', () => {
      window.history.replaceState(null, '', '/room/dxq_live');
      const { chrome, refs } = refused();
      chrome.renderActionStatus();
      const signIn = refs.actionStatus.querySelector<HTMLAnchorElement>('a');
      expect(signIn?.textContent).toBe('One of the players? Sign in to return to your seat');
      expect(decodeURIComponent(signIn?.getAttribute('href') ?? '')).toContain('/room/dxq_live');
      window.history.replaceState(null, '', '/');
    });

    it('offers no sign-in to a visitor who is already signed in', () => {
      store.set('mb_signed_in', '1');
      const { chrome, refs } = refused();
      chrome.renderActionStatus();
      expect(refs.actionStatus.querySelector('a')).toBeNull();
    });

    it('uses the tenant line when its finished rooms do not open up', () => {
      const { chrome, refs } = refused({
        ...tenant,
        liveGameRejectedBody: 'live.roomLiveHandSeatedOnly',
      });
      chrome.renderActionStatus();
      const text = refs.actionStatus.textContent ?? '';
      expect(text).toContain('Only the players at this table can see this hand');
      expect(text).not.toContain('once it ends');
    });

    it('replaces the board spinner with a still label', () => {
      const { chrome, refs } = refused();
      chrome.renderBoardStatus();
      expect(refs.boardStatus.hidden).toBe(false);
      expect(boardStatusLabel(refs)).toBe('Game in progress');
      expect(boardStatusSpinner(refs).hidden).toBe(true);
      expect(refs.boardStatus.dataset.tone).toBe('pending');
    });
  });

  describe('board status overlay', () => {
    it('spins while the socket opens', () => {
      const { chrome, refs } = chromeHarness({ view: null, connectionState: 'connecting' });
      chrome.renderBoardStatus();
      expect(refs.boardStatus.hidden).toBe(false);
      expect(boardStatusLabel(refs)).toBe('Connecting');
      expect(boardStatusSpinner(refs).hidden).toBe(false);
    });

    it('stops spinning on any refusal and names it', () => {
      const { chrome, refs } = chromeHarness({
        view: null,
        connectionState: 'rejected',
        closeReason: 'private room',
      });
      chrome.renderBoardStatus();
      expect(boardStatusLabel(refs)).toBe('Room unavailable');
      expect(boardStatusSpinner(refs).hidden).toBe(true);
      expect(refs.boardStatus.dataset.tone).toBe('danger');
    });

    it('hides once a board arrives', () => {
      const { chrome, refs } = chromeHarness();
      chrome.renderBoardStatus();
      expect(refs.boardStatus.hidden).toBe(true);
    });
  });

  it('keeps the notice hidden while a seated player scrubs a live game', () => {
    // The scrubbed state must not insert a row into the rail: the replay
    // controls and the board carry it without moving the layout.
    const { chrome, refs } = chromeHarness({ isReplayLive: false });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
  });

  it('shows no replay notice to a spectator scrubbed off live', () => {
    // The lit jump-to-latest arrow marks the scrubbed state (game-shell.css);
    // "Return to latest before making a move" never applied to a spectator.
    const { chrome, refs } = chromeHarness({ isReplayLive: false, seat: 'spectator' });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
  });

  it('shows invite guidance while the opponent seat is empty pre-game', () => {
    const { chrome, refs } = chromeHarness({
      connectedSeats: { white: true, red: false },
      seats: { white: 'c-white' },
    });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(false);
    expect(refs.actionStatus.textContent).toContain('Invite opponent');
    expect(refs.actionStatus.textContent).toContain('Copy the invite link');
  });

  it('does not read a connected engine seat as a missing opponent', () => {
    // The server reports engine seats as connected, so a PvE room plays
    // normally (notice hidden) instead of asking for an invite.
    const { chrome, refs } = chromeHarness({ connectedSeats: { white: true, red: true } });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
  });

  it('stops asking for an invite once the first full move is complete', () => {
    const { chrome, refs } = chromeHarness({
      view: playingView({ moveNumber: 2 }),
      connectedSeats: { white: true, red: false },
    });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
  });

  it('renders the finished winner via the tenant seatLabel, not the raw seat token', () => {
    // Banqi regression: the winner is a SEAT ('white' here = first mover), but the
    // ink binds on the opening flip, so the first-mover seat can win with the OTHER
    // ink. The "X wins" line must use the tenant's ink-aware label, never the seat.
    const inkTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'setup.black' : 'setup.red'),
      reasonPhrase: () => 'result.noLegalMove',
    };
    const { chrome, refs } = chromeHarness(
      {
        view: {
          id: 'test_room',
          status: { type: 'finished', winner: 'white', reason: 'stalemate' },
          moveNumber: 12,
        },
      },
      inkTenant,
    );
    // The result now closes the move list (postgame-panel.ts) and the notice
    // stays hidden; the winner line must still be the ink-aware label.
    const console = document.createElement('section');
    console.className = 'game-console';
    const result = document.createElement('div');
    result.dataset.gameResult = '';
    result.hidden = true;
    console.append(refs.actionSection, result);
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(true);
    expect(result.hidden).toBe(false);
    expect(result.textContent).toContain('1-0');
    expect(result.textContent).toContain('Black is victorious');
    expect(result.textContent).not.toContain('White');
  });

  it('renders the spectator "to move" label via the tenant seatLabel', () => {
    const inkTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'setup.first' : 'setup.second'),
    };
    const { chrome, refs } = chromeHarness(
      { seat: 'spectator', view: playingView({ status: { type: 'playing', turn: 'red' } }) },
      inkTenant,
    );
    chrome.renderActionStatus();
    expect(refs.actionStatus.textContent).toContain('Second to move');
    expect(refs.actionStatus.textContent).not.toContain('Red to move');
  });
});

describe('tenant room chrome player names', () => {
  const armedClock = {
    activeColor: 'white' as Color,
    incrementMs: 2000,
    initialMs: 180_000,
    remainingMs: { white: 170_000, red: 175_000 },
    runningSince: null,
  };
  const timeControl = { initialMs: 180_000, incrementMs: 2000 };

  it('renders server-resolved names on the armed clock rows', () => {
    const { chrome, refs } = chromeHarness({
      clock: armedClock,
      timeControl,
      seatDisplayNames: { white: 'brian', red: 'Misty DMX' },
    });
    chrome.renderClocks();
    const names = [refs.playerTop.textContent, refs.playerBottom.textContent];
    // Viewer is white (bottom); opponent red on top. Player lines render into
    // the boxed table's player rows, not the clock slots.
    expect(names[0]).toContain('Misty DMX');
    expect(names[1]).toContain('brian');
    expect(`${names[0]}${names[1]}`).not.toContain('You');
  });

  it('falls back to You / Guest for anonymous seats, seat label for an empty one', () => {
    const { chrome, refs } = chromeHarness({ clock: armedClock, timeControl });
    chrome.renderClocks();
    expect(refs.playerBottom.textContent).toContain('You');
    // The same person is "Guest" on /games and /watch; the room said "Red".
    expect(refs.playerTop.textContent).toContain('Guest');
    expect(refs.playerTop.textContent).not.toContain('Red');

    const empty = chromeHarness({ clock: null, timeControl, seats: { white: 'c-white' } });
    empty.chrome.renderClocks();
    expect(empty.refs.playerTop.textContent).toContain('Red');
    expect(empty.refs.playerTop.textContent).not.toContain('Guest');
  });

  it('names an anonymous opponent Guest on the meta card too', () => {
    const { chrome, refs } = chromeHarness({});
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('Guest (Red)');
    expect(refs.gameInfo.textContent).toContain('You (White)');
  });

  it('gives the pregame (unarmed) rows the same seat identity as the armed rows', () => {
    const { chrome, refs } = chromeHarness({
      clock: null,
      timeControl,
      seatDisplayNames: { red: 'gm_visitor' },
    });
    chrome.renderClocks();
    expect(refs.playerTop.textContent).toContain('gm_visitor');
    // 'You', not the seat label 'White': the seat's identity does not depend on
    // whether its clock has armed. The unarmed rows used to read "White" with no
    // presence dot and then become "You" with one, on the same row, mid-game.
    expect(refs.playerBottom.textContent).toContain('You');
    expect(refs.playerTop.querySelector('.presence-dot')).not.toBeNull();
    expect(refs.playerBottom.querySelector('.presence-dot')).not.toBeNull();
  });

  it('gives the meta card the variant marker, not a family glyph', () => {
    const markerTenant: WebVariantTenant<Color> = { ...tenant, metaMarkerId: 'jungle-flip' };
    const { chrome, refs } = chromeHarness({}, markerTenant);
    chrome.renderMeta();
    const icon = refs.gameInfo.querySelector('.game-meta-card__icon');
    // The room is where a game's identity matters most; it reads the same icon
    // language as the picker, watch rail, and review page rather than a CJK
    // glyph shared by every variant in the family.
    expect(icon?.querySelector('[data-variant-marker-id="jungle-flip"]')).not.toBeNull();
  });

  it('heads the meta card Rated for a rated room and Casual otherwise', () => {
    // Until 2026-10-02 the headline was hard-coded Casual, so a rated lobby game
    // and a rated correspondence game both read Casual in the room.
    const rated = chromeHarness({
      rated: true,
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    });
    rated.chrome.renderMeta();
    expect(rated.refs.gameInfo.textContent).toContain('Rated');
    expect(rated.refs.gameInfo.textContent).not.toContain('Casual');
    const casual = chromeHarness({ timeControl: { initialMs: 180_000, incrementMs: 2_000 } });
    casual.chrome.renderMeta();
    expect(casual.refs.gameInfo.textContent).toContain('Casual');
  });

  it('heads the meta card Rated for a guest refused a rated seat', () => {
    // The refused guest never gets a snapshot, so rated() stays false; the
    // close reason is the only thing that knows the room is rated.
    const refused = chromeHarness({
      closeReason: 'rated requires account',
      timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    });
    refused.chrome.renderMeta();
    expect(refused.refs.gameInfo.textContent).toContain('Rated');
    expect(refused.refs.gameInfo.textContent).not.toContain('Casual');
  });

  it('names a correspondence allowance instead of a minutes clock', () => {
    const { chrome, refs } = chromeHarness({
      rated: true,
      timeControl: { initialMs: 3 * 86_400_000, incrementMs: 0, daysPerMove: 3 },
    });
    chrome.renderMeta();
    // Short form, so the headline fits one line in the room rail.
    expect(refs.gameInfo.textContent).toContain('3 days • Rated');
    expect(refs.gameInfo.textContent).not.toContain('per move');
    expect(refs.gameInfo.textContent).not.toContain('4320+0');
  });

  it('uses server names in the meta card player rows', () => {
    const { chrome, refs } = chromeHarness({
      seatDisplayNames: { white: 'brian', red: 'Misty DMX' },
    });
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('brian');
    expect(refs.gameInfo.textContent).toContain('Misty DMX');
    expect(refs.gameInfo.textContent).not.toContain('You (');
  });
});

describe('tenant room chrome player discs', () => {
  function discClasses(refs: LiveRefs): string[] {
    return [...refs.gameInfo.querySelectorAll('.game-meta-card__disc')].map((disc) =>
      [...disc.classList].filter((name) => name.startsWith('seat-disc--')).join(' '),
    );
  }

  it('tints the disc by seat when the seat name IS the color', () => {
    const { chrome, refs } = chromeHarness();
    chrome.renderMeta();
    // colors: ['white', 'red'] -> the white ink, the red ink.
    expect(discClasses(refs)).toEqual(['seat-disc--white', 'seat-disc--red']);
  });

  it('tints the disc by the BOUND INK, not the seat, for a flip variant', () => {
    // Flip Jungle regression (jgf_afd6374e): the 'white' seat here is the first mover
    // and its opening flip turned up the OTHER ink, so the first-mover seat must render
    // dark and the second-mover seat red. Server display names suppress the ink-aware
    // seatLabel, which leaves the disc as the only colour cue on the row — so a raw
    // seat here is silently wrong rather than merely inconsistent.
    const flipTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'setup.black' : 'setup.red'),
      seatInk: (seat) => (seat === 'white' ? 'black' : 'red'),
    };
    const { chrome, refs } = chromeHarness(
      { seatDisplayNames: { white: 'brianhliou-dev', red: 'Misty' } },
      flipTenant,
    );
    chrome.renderMeta();
    expect(discClasses(refs)).toEqual(['seat-disc--black', 'seat-disc--red']);
  });

  it('renders a neutral disc while a flip variant has no ink bound yet', () => {
    const preFlipTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'setup.first' : 'setup.second'),
      seatInk: () => null,
    };
    const { chrome, refs } = chromeHarness({}, preFlipTenant);
    chrome.renderMeta();
    expect(discClasses(refs)).toEqual(['seat-disc--unbound', 'seat-disc--unbound']);
  });
});

describe('tenant room chrome meta and invite emphasis', () => {
  it('appends the variant detail to the Variant row', () => {
    const { chrome, refs } = chromeHarness({ variantDetail: '5+5' });
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('Xiangqi · 5+5');
  });

  it('keeps the bare variant name without a detail hook', () => {
    const { chrome, refs } = chromeHarness();
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('Xiangqi');
    expect(refs.gameInfo.textContent).not.toContain('·');
  });

  it('labels the seat by its colour word without a seatLabel hook', () => {
    const { chrome, refs } = chromeHarness({ seat: 'white' });
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('White');
  });

  it('labels the seat via the tenant seatLabel override (banqi ink/sequence)', () => {
    // Banqi-style: seat names are not colors, so the chrome must honor the tenant's label.
    const labelTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'setup.first' : 'setup.second'),
    };
    const { chrome, refs } = chromeHarness({ seat: 'white' }, labelTenant);
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('First');
    expect(refs.gameInfo.textContent).not.toContain('White');
  });

  it('offers copy-invite only while the opponent seat is unclaimed', () => {
    const waiting = chromeHarness({
      connectedSeats: { white: true, red: false },
      seats: { white: 'c-white' },
    });
    waiting.chrome.renderRoomActions();
    const waitingCopy = waiting.refs.roomActions.querySelector('button');
    expect(waitingCopy?.textContent).toBe('Copy invite');
    expect(waitingCopy?.className).toBe('primary');

    // Both players in: the invite has nothing left to do (Brian's playtest,
    // 2026-10-02: it sat in the column for the whole game).
    const playing = chromeHarness();
    playing.chrome.renderRoomActions();
    expect(playing.refs.roomActions.textContent).not.toContain('Copy invite');

    // The friend took the seat and their tab dropped: the seat is theirs, so
    // there is nobody to invite (keyed on the seat, not the connection).
    const dropped = chromeHarness({ connectedSeats: { white: true, red: false } });
    dropped.chrome.renderActionStatus();
    dropped.chrome.renderRoomActions();
    expect(dropped.refs.actionStatus.textContent).not.toContain('Invite opponent');
    expect(dropped.refs.roomActions.textContent).not.toContain('Copy invite');
  });

  it('offers no copy-invite in a bot game', () => {
    // The engine seat reports connected, so a PvE room is never waiting.
    const bot = chromeHarness({ roomMode: 'pve', seats: { white: 'c-white', red: 'engine' } });
    bot.chrome.renderRoomActions();
    expect(bot.refs.roomActions.textContent).not.toContain('Copy invite');
  });
});

describe('tenant room chrome bot rematch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const finished: TenantWebView<Color> = {
    id: 'test_room',
    status: { type: 'finished', winner: 'red', reason: 'resignation' },
    moveNumber: 9,
  };

  async function rematchBody(seat: Color): Promise<Record<string, unknown>> {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { chrome, refs } = chromeHarness({
      view: finished,
      seat,
      roomMode: 'pve',
      // What the tenants send today: a coin flip.
      playAgainRequestBody: { mode: 'pve', gameSpecId: 'xiangqi', preferredColor: 'random' },
    });
    chrome.renderRoomActions();
    const rematch = refs.roomActions.querySelector<HTMLButtonElement>(
      'button.postgame-actions__rematch',
    );
    expect(rematch?.textContent).toBe('Rematch');
    rematch?.click();
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit;
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  // Brian stayed Red on a Crazyhouse Xiangqi rematch against the bot: the
  // tenant asked for 'random'. A rematch swaps sides, as on lichess.
  it('asks for the opposite seat of the game just played', async () => {
    expect(await rematchBody('white')).toMatchObject({
      mode: 'pve',
      gameSpecId: 'xiangqi',
      preferredColor: 'red',
    });
    expect(await rematchBody('red')).toMatchObject({ preferredColor: 'white' });
  });
});

// A lobby match pairs two players who were both already waiting, so its room has
// no invite link to share. Prod, 2026-10-02: a jieqi joiner whose matched seeker
// had closed the tab sat under "Copy the invite link and send it to your
// opponent" until the server's no-show abort (LOBBY_NO_SHOW_ABORT_MS) ended it.
describe('tenant room chrome lobby rooms', () => {
  const absentOpponent = { connectedSeats: { white: true, red: false } };
  // A friend room before the friend opens the link: their seat is unclaimed.
  const openSeat = { ...absentOpponent, seats: { white: 'c-white' } };

  it('tells a lobby player its opponent is connecting, never to share an invite', () => {
    const { chrome, refs } = chromeHarness({ ...absentOpponent, lobbyMatch: true });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(false);
    expect(refs.actionStatus.textContent).toContain('Waiting for your opponent to connect.');
    expect(refs.actionStatus.textContent).not.toContain('invite');
    expect(refs.actionStatus.textContent).not.toContain('Invite');
  });

  it('offers no invite link in a lobby room', () => {
    const { chrome, refs } = chromeHarness({ ...absentOpponent, lobbyMatch: true });
    chrome.renderRoomActions();
    expect(refs.roomActions.textContent).not.toContain('Copy invite');
  });

  it('counts the no-show abort down in its own words, not as a first-move warning', () => {
    const { chrome, refs } = chromeHarness({
      ...absentOpponent,
      lobbyMatch: true,
      abortDeadline: Date.now() + 20_000,
    });
    chrome.renderGameControls();
    expect(refs.gameControls.textContent).toContain('Opponent has not connected, aborting in');
    expect(refs.gameControls.textContent).not.toContain('Make your first move');
  });

  it('keeps the invite prompt and button for an invite room', () => {
    const { chrome, refs } = chromeHarness({ ...openSeat, lobbyMatch: false });
    chrome.renderActionStatus();
    chrome.renderRoomActions();
    expect(refs.actionStatus.textContent).toContain('Copy the invite link');
    expect(refs.roomActions.textContent).toContain('Copy invite');
  });

  // A correspondence opponent is offline between moves; a seated one is not
  // missing (2026-10-04: a jieqi game read "Waiting for opponent" with an
  // invite link after the opponent had already moved).
  // Correspondence is read off the time control, as on the wire: no tenant
  // client reports roomMode 'correspondence' (2026-10-06).
  const dayPerMove = { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 };

  it('treats a seated, offline correspondence opponent as present', () => {
    const { chrome, refs } = chromeHarness({ ...absentOpponent, timeControl: dayPerMove });
    chrome.renderMeta();
    chrome.renderActionStatus();
    chrome.renderRoomActions();
    expect(refs.gameInfo.textContent).not.toContain('Waiting for opponent');
    expect(refs.actionStatus.textContent).not.toContain('Copy the invite link');
    expect(refs.roomActions.textContent).not.toContain('Copy invite');
  });

  it('still offers the invite while a correspondence seat is empty', () => {
    const { chrome, refs } = chromeHarness({
      ...openSeat,
      timeControl: dayPerMove,
    });
    chrome.renderRoomActions();
    expect(refs.roomActions.textContent).toContain('Copy invite');
  });

  it('counts a correspondence first-move window in hours, not seconds', () => {
    const { chrome, refs } = chromeHarness({
      timeControl: dayPerMove,
      abortDeadline: Date.now() + (17 * 60 + 7) * 60_000 + 30_000,
    });
    chrome.renderGameControls();
    expect(refs.gameControls.textContent).toContain(
      'Make your first move, aborting in 17h\u00a07m',
    );
  });

  // Rated is not a reason on its own: a rated friend room is still shared by
  // link (c3f33ac6), so it keeps the invite while the seat is open. A rated
  // lobby pairing, or a rated room with both seats taken, never shows it.
  it('keeps the invite for a rated friend room with an open seat', () => {
    const { chrome, refs } = chromeHarness({ ...openSeat, rated: true });
    chrome.renderRoomActions();
    expect(refs.roomActions.textContent).toContain('Copy invite');
  });

  it('offers no invite in a rated lobby room or a rated room with both seats taken', () => {
    for (const overrides of [
      { ...openSeat, rated: true, lobbyMatch: true },
      { ...absentOpponent, rated: true },
    ]) {
      const { chrome, refs } = chromeHarness(overrides);
      chrome.renderActionStatus();
      chrome.renderRoomActions();
      expect(refs.actionStatus.textContent).not.toContain('Invite opponent');
      expect(refs.roomActions.textContent).not.toContain('Copy invite');
    }
  });

  it('offers no invite to a spectator, even with a seat open', () => {
    const { chrome, refs } = chromeHarness({ ...openSeat, seat: 'spectator' });
    chrome.renderActionStatus();
    chrome.renderRoomActions();
    expect(refs.actionStatus.textContent).not.toContain('Invite opponent');
    expect(refs.roomActions.textContent).not.toContain('Copy invite');
  });
});

describe('tenant room chrome meta card names', () => {
  it('links a server-named seat to its profile and leaves fallbacks plain', () => {
    const { chrome, refs } = chromeHarness({
      seatDisplayNames: { red: 'scene-1174' },
      seatProfiles: { red: { handle: 'scene-1174' }, white: { handle: 'ignored' } },
    });
    chrome.renderMeta();
    const links = [...refs.gameInfo.querySelectorAll('a.player-name-link')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/@/scene-1174']);
    expect(links[0]?.textContent).toBe('scene-1174');
  });
});

// #427: the room was English end to end for zh visitors with every suite green.
// Render the whole chrome in each zh locale and read it back for Latin words.
describe('tenant room chrome in Chinese', () => {
  afterEach(() => {
    store.delete('mistboard.locale');
  });

  const timeControl = { initialMs: 300_000, incrementMs: 5000 };
  const latin = (text: string | null) => (text ?? '').match(/[A-Za-z]{3,}/g) ?? [];

  for (const locale of ['zh-Hant', 'zh-Hans']) {
    it(`renders ${locale} with no English words`, () => {
      store.set('mistboard.locale', locale);
      const texts: string[] = [];

      const playing = chromeHarness({ timeControl });
      playing.chrome.renderMeta();
      playing.chrome.renderClocks();
      playing.chrome.renderGameControls();
      playing.chrome.renderRoomActions();
      texts.push(
        playing.refs.gameInfo.textContent ?? '',
        playing.refs.playerTop.textContent ?? '',
        playing.refs.playerBottom.textContent ?? '',
        playing.refs.clockNote.textContent ?? '',
        playing.refs.gameControls.textContent ?? '',
        playing.refs.roomActions.textContent ?? '',
      );

      const resigned = chromeHarness({
        view: {
          id: 'test_room',
          status: { type: 'finished', winner: 'red', reason: 'resignation' },
          moveNumber: 9,
        },
      });
      resigned.chrome.renderMeta();
      resigned.chrome.renderActionStatus();
      resigned.chrome.renderRoomActions();
      texts.push(
        resigned.refs.gameInfo.textContent ?? '',
        resigned.refs.actionStatus.textContent ?? '',
        resigned.refs.roomActions.textContent ?? '',
      );

      const spectator = chromeHarness({ seat: 'spectator', connectionState: 'reconnecting' });
      spectator.chrome.renderActionStatus();
      texts.push(spectator.refs.actionStatus.textContent ?? '');

      const lobby = chromeHarness({
        connectedSeats: { white: true, red: false },
        lobbyMatch: true,
        abortDeadline: Date.now() + 20_000,
      });
      lobby.chrome.renderActionStatus();
      lobby.chrome.renderGameControls();
      texts.push(
        lobby.refs.actionStatus.textContent ?? '',
        lobby.refs.gameControls.textContent ?? '',
      );

      expect(texts.flatMap(latin)).toEqual([]);
      expect(texts.join(' ')).toContain('象棋');
    });
  }
});

function refsFixture(): LiveRefs {
  const root = document.createElement('div');
  root.innerHTML = '<button data-replay="first"></button><button data-replay="next"></button>';
  return {
    actionSection: el('section'),
    actionStatus: el('div'),
    board: el('div'),
    boardPaused: el('div'),
    boardStatus: boardStatusFixture(),
    capturesBottom: el('div'),
    capturesTop: el('div'),
    clockBottom: el('div'),
    clockNote: el('p'),
    clockTop: el('div'),
    devViews: el('div'),
    devViewsSection: el('section'),
    gameControls: el('div'),
    gameControlsSection: el('section'),
    gameInfo: el('div'),
    hiddenPool: el('div'),
    moveList: el('ol'),
    playerBottom: el('div'),
    playerTop: el('div'),
    promotion: el('div'),
    replayControls: root.querySelectorAll<HTMLButtonElement>('[data-replay]'),
    replayMeta: el('p'),
    roomActions: el('div'),
    roomMeta: el('p'),
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K] {
  return document.createElement(tagName);
}

// The layout's overlay markup (live-layout.ts): a spinner and a label.
function boardStatusFixture(): HTMLDivElement {
  const status = el('div');
  status.innerHTML =
    '<div><span data-board-status-spinner></span><p data-board-status-label>Connecting</p></div>';
  return status;
}

function boardStatusLabel(refs: LiveRefs): string | null {
  return refs.boardStatus.querySelector('[data-board-status-label]')?.textContent ?? null;
}

function boardStatusSpinner(refs: LiveRefs): HTMLElement {
  const spinner = refs.boardStatus.querySelector<HTMLElement>('[data-board-status-spinner]');
  if (!spinner) throw new Error('fixture has a spinner');
  return spinner;
}
