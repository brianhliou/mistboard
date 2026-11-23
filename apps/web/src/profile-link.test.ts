import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeDisplayPreference } from './display-preferences.js';
import { FLAIR_KEYS } from './flair.js';
import type { GameParticipant } from './game-display.js';
import {
  nameDecorationTarget,
  participantNameDecoration,
  participantProfileTarget,
  playerNameEl,
  profileTargetFor,
  reviewSeatProfiles,
  seatNameEl,
} from './profile-link.js';

// #1083: the shared name helper puts a member's title badge before the name and
// their flair after it, and leaves every other name exactly as it was.

const FLAIR = FLAIR_KEYS[0]!;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function participant(overrides: Partial<GameParticipant> = {}): GameParticipant {
  return {
    color: 'red',
    displayName: 'Ann',
    subjectType: 'user',
    subjectId: 'user-1',
    visibility: 'public',
    handle: 'ann',
    ...overrides,
  };
}

/** The decorated link's children as their roles, in order. */
function parts(el: HTMLElement): string[] {
  return [...el.children].map((child) => {
    if (child.classList.contains('title-badge')) return `badge:${child.textContent}`;
    if (child.classList.contains('player-name-text')) return `name:${child.textContent}`;
    if (child.classList.contains('flair')) return 'flair';
    if (child.classList.contains('champion-crowns')) return 'crowns';
    return child.className;
  });
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() });
});

afterEach(() => {
  writeDisplayPreference('playerFlairs', true);
});

describe('playerNameEl: undecorated names keep their DOM', () => {
  it('a member with no title, flair or crown is the plain link it always was', () => {
    const el = playerNameEl('Bob', profileTargetFor({ handle: 'bob' }), 'clock-name');
    expect(el.outerHTML).toBe(
      '<a class="clock-name player-name-link" href="/@/bob" title="Bob">Bob</a>',
    );
  });

  it('a seat with no page is the plain span it always was', () => {
    const el = playerNameEl('Guest', profileTargetFor({ handle: null }), 'clock-name');
    expect(el.outerHTML).toBe('<span class="clock-name" title="Guest">Guest</span>');
  });

  it('a title or flair value the client does not know adds nothing', () => {
    const target = profileTargetFor({
      handle: 'bob',
      title: 'grandmaster' as never,
      flair: 'not-a-flair',
    });
    const el = playerNameEl('Bob', target, 'clock-name');
    expect(el.outerHTML).toBe(
      '<a class="clock-name player-name-link" href="/@/bob" title="Bob">Bob</a>',
    );
  });
});

describe('playerNameEl: titled and flaired members', () => {
  it('a live seat shows the badge before the name and the flair after it, inside the link', () => {
    // The live room's seatProfiles entry, as the server sends it (#1086).
    const target = profileTargetFor({ handle: 'ann', title: 'xgm', flair: FLAIR });
    const el = playerNameEl('Ann', target, 'clock-name');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/@/ann');
    expect(el.title).toBe('Ann');
    expect(el.classList.contains('player-name--decorated')).toBe(true);
    expect(el.classList.contains('player-name--champion')).toBe(false);
    expect(parts(el)).toEqual(['badge:XGM', 'name:Ann', 'flair']);
  });

  it('a finished-game seat carries both through participantProfileTarget', () => {
    const target = participantProfileTarget(participant({ title: 'gm', flair: FLAIR }));
    expect(target).toEqual({ kind: 'user', handle: 'ann', title: 'gm', flair: FLAIR });
    const el = playerNameEl('Ann', target, 'review-seat__name');
    expect(parts(el)).toEqual(['badge:GM', 'name:Ann', 'flair']);
  });

  it('a spectator TV seat (LiveTvPlayer shape) renders the same way', () => {
    const tvPlayer = {
      color: 'red',
      name: 'Ann',
      isEngine: false,
      handle: 'ann',
      title: 'xim' as const,
      flair: FLAIR,
    };
    const el = playerNameEl('Ann', profileTargetFor(tvPlayer), 'watch-seat-name');
    expect(parts(el)).toEqual(['badge:XIM', 'name:Ann', 'flair']);
  });

  it('review seat strips pass title and flair through on the right seat', () => {
    const { red, black } = reviewSeatProfiles([
      { color: 'red', handle: 'ann', title: 'xnm' },
      { color: 'black', handle: 'bob', flair: FLAIR },
    ]);
    expect(parts(playerNameEl('Ann', red, 'x'))).toEqual(['badge:XNM', 'name:Ann']);
    expect(parts(playerNameEl('Bob', black, 'x'))).toEqual(['name:Bob', 'flair']);
  });

  it('sits beside a champion crown, flair before the crown', () => {
    const target = profileTargetFor({
      handle: 'ann',
      title: 'xgm',
      flair: FLAIR,
      champions: [{ variant: 'xiangqi', timeClass: 'blitz' }],
    });
    const el = playerNameEl('Ann', target, 'clock-name');
    expect(el.classList.contains('player-name--champion')).toBe(true);
    expect(el.classList.contains('player-name--decorated')).toBe(true);
    expect(parts(el)).toEqual(['badge:XGM', 'name:Ann', 'flair', 'crowns']);
  });

  it('a crown alone keeps the crown DOM it had before', () => {
    const target = profileTargetFor({
      handle: 'ann',
      champions: [{ variant: 'xiangqi', timeClass: 'blitz' }],
    });
    const el = playerNameEl('Ann', target, 'clock-name');
    expect(el.classList.contains('player-name--decorated')).toBe(false);
    expect(parts(el)).toEqual(['name:Ann', 'crowns']);
  });

  it('with the viewer playerFlairs setting off, the flair goes and the title stays', () => {
    writeDisplayPreference('playerFlairs', false);
    const el = playerNameEl(
      'Ann',
      profileTargetFor({ handle: 'ann', title: 'xgm', flair: FLAIR }),
      'clock-name',
    );
    expect(parts(el)).toEqual(['badge:XGM', 'name:Ann']);
    expect(el.querySelector('.flair')).toBeNull();

    const flairOnly = playerNameEl('Bob', profileTargetFor({ handle: 'bob', flair: FLAIR }), 'x');
    expect(flairOnly.outerHTML).toBe(
      '<a class="x player-name-link" href="/@/bob" title="Bob">Bob</a>',
    );
  });
});

describe('profile targets: bots and guests carry no decorations', () => {
  it('a bot identity drops a planted title and flair', () => {
    const target = profileTargetFor({ botId: 'misty', title: 'xgm', flair: FLAIR });
    expect(target).toEqual({ kind: 'bot', botId: 'misty' });
    expect(playerNameEl('Misty', target, 'x').outerHTML).toBe(
      '<a class="x player-name-link" href="/bot/misty" title="Misty">Misty</a>',
    );
  });

  it('a bot or guest participant has no title or flair, whatever the row holds', () => {
    expect(
      participantProfileTarget(
        participant({ subjectType: 'bot', subjectId: 'misty', handle: null, title: 'gm' }),
      ),
    ).toEqual({ kind: 'bot', botId: 'misty' });
    expect(
      participantProfileTarget(participant({ subjectType: 'guest', title: 'gm', flair: FLAIR })),
    ).toBeNull();
    // A user seat whose handle the server withheld (private or closed) has no page.
    expect(participantProfileTarget(participant({ handle: null, title: 'gm' }))).toBeNull();
  });
});

describe('seatNameEl: the homepage board seat, decorated but never a link', () => {
  it('a seat with no decoration is the bare span it always was, no tooltip', () => {
    expect(seatNameEl('Bob', null, 'showcase-seat-name').outerHTML).toBe(
      '<span class="showcase-seat-name">Bob</span>',
    );
  });

  it('a titled and flaired member reads badge, name, flair, inside a span with no href', () => {
    const el = seatNameEl(
      'Ann',
      nameDecorationTarget({ handle: 'ann', title: 'xgm', flair: FLAIR }),
      'showcase-seat-name',
    );
    expect(el.tagName).toBe('SPAN');
    expect(el.hasAttribute('href')).toBe(false);
    expect(el.querySelector('a')).toBeNull();
    expect(el.className).toBe('showcase-seat-name player-name--decorated');
    expect(parts(el)).toEqual(['badge:XGM', 'name:Ann', 'flair']);
  });

  it('with the viewer playerFlairs setting off, a flair-only seat stays the bare span', () => {
    writeDisplayPreference('playerFlairs', false);
    const el = seatNameEl('Bob', nameDecorationTarget({ handle: 'bob', flair: FLAIR }), 'x');
    expect(el.outerHTML).toBe('<span class="x">Bob</span>');
  });

  it('the board drops crowns and needs a handle and a title or flair to decorate', () => {
    expect(nameDecorationTarget({ handle: 'ann', title: 'gm', champions: [] } as never)).toEqual({
      kind: 'user',
      handle: 'ann',
      title: 'gm',
    });
    expect(nameDecorationTarget({ handle: 'ann' })).toBeNull();
    // A private or closed account reaches the client with no handle (the server's
    // linkable gate), so a stray title or flair beside it is ignored.
    expect(nameDecorationTarget({ handle: null, title: 'gm', flair: FLAIR })).toBeNull();
  });

  it('a finished-game participant decorates only a member seat with a handle', () => {
    expect(participantNameDecoration(participant({ title: 'gm', flair: FLAIR }))).toEqual({
      kind: 'user',
      handle: 'ann',
      title: 'gm',
      flair: FLAIR,
    });
    expect(participantNameDecoration(participant({ handle: null, title: 'gm' }))).toBeNull();
    expect(
      participantNameDecoration(
        participant({ subjectType: 'bot', subjectId: 'misty', handle: 'misty', title: 'gm' }),
      ),
    ).toBeNull();
    expect(participantNameDecoration(participant())).toBeNull();
  });
});
