import { describe, expect, it } from 'vitest';
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

type Color = 'white' | 'red';

const tenant: WebVariantTenant<Color> = {
  displayName: 'Testboard',
  colors: ['white', 'red'],
  isColor: (value): value is Color => value === 'white' || value === 'red',
  oppositeColor: (color) => (color === 'white' ? 'red' : 'white'),
  enabled: () => true,
  reviewUrl: (roomId) => `/testboard/game/${roomId}`,
  reasonPhrase: (reason) => reason,
  disabledTitle: 'Testboard disabled',
  disabledBody: 'Renderer off.',
  rejectedBody: 'Room not active.',
  spectatorBody: 'Watching.',
  selectInstruction: 'Pick a piece.',
};

type CtxOverrides = Partial<{
  view: TenantWebView<Color> | null;
  seat: unknown;
  connectionState: string;
  closeReason: string;
  connectedSeats: Partial<Record<Color, boolean>>;
  seatDisplayNames: Partial<Record<Color, string>>;
  seatProfiles: Partial<Record<Color, ProfileIdentity>>;
  clock: {
    activeColor: Color | null;
    incrementMs: number;
    initialMs: number;
    remainingMs: Record<Color, number>;
    runningSince: number | null;
  } | null;
  timeControl: { initialMs: number; incrementMs: number } | null;
  isReplayLive: boolean;
  variantDetail: string | null;
}>;

function chromeHarness(
  overrides: CtxOverrides = {},
  tenantOverride: WebVariantTenant<Color> = tenant,
) {
  const ctx: TenantChromeContext<Color> = {
    view: () => overrides.view ?? playingView(),
    seat: () => overrides.seat ?? 'white',
    connectionState: () => overrides.connectionState ?? 'connected',
    closeReason: () => overrides.closeReason ?? '',
    clock: () => overrides.clock ?? null,
    timeControl: () => overrides.timeControl ?? null,
    connectedSeats: () => overrides.connectedSeats ?? { white: true, red: true },
    seatDisplayNames: () => overrides.seatDisplayNames ?? {},
    seatProfiles: () => overrides.seatProfiles ?? {},
    abortDeadline: () => null,
    forfeitDeadline: () => null,
    roomMode: () => 'pvp',
    room: () => 'test_room',
    debugRequested: () => false,
    isReplayLive: () => overrides.isReplayLive ?? true,
    orientation: () => 'white',
    playAgainRequestBody: () => ({}),
    rematchControls: () => null,
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
    expect(refs.actionStatus.textContent).not.toContain('Room not active.');
  });

  it('falls back to the tenant rejected line for every other close reason', () => {
    const { chrome, refs } = chromeHarness({
      connectionState: 'rejected',
      closeReason: 'private room',
    });
    chrome.renderActionStatus();
    expect(refs.actionStatus.textContent).toContain('Room unavailable');
    expect(refs.actionStatus.textContent).toContain('Room not active.');
  });

  it('shows a replay notice while scrubbed off live', () => {
    const { chrome, refs } = chromeHarness({ isReplayLive: false });
    chrome.renderActionStatus();
    expect(refs.actionSection.hidden).toBe(false);
    expect(refs.actionStatus.textContent).toContain('Viewing replay');
    expect(refs.actionStatus.textContent).toContain('Return to latest before making a move.');
  });

  it('shows invite guidance while the opponent seat is empty pre-game', () => {
    const { chrome, refs } = chromeHarness({ connectedSeats: { white: true, red: false } });
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
      seatLabel: (seat) => (seat === 'white' ? 'Black' : 'Red'),
      reasonPhrase: () => 'no legal move',
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
    chrome.renderActionStatus();
    expect(refs.actionStatus.textContent).toContain('Black wins by no legal move.');
    expect(refs.actionStatus.textContent).not.toContain('White wins');
  });

  it('renders the spectator "to move" label via the tenant seatLabel', () => {
    const inkTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'First' : 'Second'),
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

  it('falls back to You / seat label for anonymous seats', () => {
    const { chrome, refs } = chromeHarness({ clock: armedClock, timeControl });
    chrome.renderClocks();
    expect(refs.playerBottom.textContent).toContain('You');
    expect(refs.playerTop.textContent).toContain('Red');
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
      [...disc.classList].filter((name) => name !== 'game-meta-card__disc').join(' '),
    );
  }

  it('tints the disc by seat when the seat name IS the color', () => {
    const { chrome, refs } = chromeHarness();
    chrome.renderMeta();
    // colors: ['white', 'red'] -> hollow light, filled red.
    expect(discClasses(refs)).toEqual(['game-meta-card__disc--light', 'game-meta-card__disc--red']);
  });

  it('tints the disc by the BOUND INK, not the seat, for a flip variant', () => {
    // Flip Jungle regression (jgf_afd6374e): the 'white' seat here is the first mover
    // and its opening flip turned up the OTHER ink, so the first-mover seat must render
    // dark and the second-mover seat red. Server display names suppress the ink-aware
    // seatLabel, which leaves the disc as the only colour cue on the row — so a raw
    // seat here is silently wrong rather than merely inconsistent.
    const flipTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'Black' : 'Red'),
      seatInk: (seat) => (seat === 'white' ? 'black' : 'red'),
    };
    const { chrome, refs } = chromeHarness(
      { seatDisplayNames: { white: 'brianhliou-dev', red: 'Misty' } },
      flipTenant,
    );
    chrome.renderMeta();
    expect(discClasses(refs)).toEqual(['game-meta-card__disc--dark', 'game-meta-card__disc--red']);
  });

  it('renders a neutral disc while a flip variant has no ink bound yet', () => {
    const preFlipTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'First' : 'Second'),
      seatInk: () => null,
    };
    const { chrome, refs } = chromeHarness({}, preFlipTenant);
    chrome.renderMeta();
    expect(discClasses(refs)).toEqual([
      'game-meta-card__disc--unbound',
      'game-meta-card__disc--unbound',
    ]);
  });
});

describe('tenant room chrome meta and invite emphasis', () => {
  it('appends the variant detail to the Variant row', () => {
    const { chrome, refs } = chromeHarness({ variantDetail: '5+5' });
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('Testboard · 5+5');
  });

  it('keeps the bare variant name without a detail hook', () => {
    const { chrome, refs } = chromeHarness();
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('Testboard');
    expect(refs.gameInfo.textContent).not.toContain('·');
  });

  it('labels the seat by capitalize(seat) without a seatLabel hook', () => {
    const { chrome, refs } = chromeHarness({ seat: 'white' });
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('White');
  });

  it('labels the seat via the tenant seatLabel override (banqi ink/sequence)', () => {
    // Banqi-style: seat names are not colors, so the chrome must honor the tenant's label.
    const labelTenant: WebVariantTenant<Color> = {
      ...tenant,
      seatLabel: (seat) => (seat === 'white' ? 'First' : 'Second'),
    };
    const { chrome, refs } = chromeHarness({ seat: 'white' }, labelTenant);
    chrome.renderMeta();
    expect(refs.gameInfo.textContent).toContain('First');
    expect(refs.gameInfo.textContent).not.toContain('White');
  });

  it('marks copy-invite primary only while waiting for the opponent', () => {
    const waiting = chromeHarness({ connectedSeats: { white: true, red: false } });
    waiting.chrome.renderRoomActions();
    const waitingCopy = waiting.refs.roomActions.querySelector('button');
    expect(waitingCopy?.textContent).toBe('Copy invite');
    expect(waitingCopy?.className).toBe('primary');

    const playing = chromeHarness();
    playing.chrome.renderRoomActions();
    const playingCopy = playing.refs.roomActions.querySelector('button');
    expect(playingCopy?.textContent).toBe('Copy invite');
    expect(playingCopy?.className).toBe('');
  });
});

function refsFixture(): LiveRefs {
  const root = document.createElement('div');
  root.innerHTML = '<button data-replay="first"></button><button data-replay="next"></button>';
  return {
    actionSection: el('section'),
    actionStatus: el('div'),
    board: el('div'),
    boardPaused: el('div'),
    boardStatus: el('div'),
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
