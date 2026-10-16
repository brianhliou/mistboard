import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProfileOverview } from './profile.js';

// A challenge to one particular player starts on their profile (the
// /correspondence form dropped "A player", 2026-10-04): a Challenge button in
// the action row opens the directed-challenge dialog, which posts a seek
// targeted at that player's handle.

type Overview = Parameters<typeof buildProfileOverview>[0];

function profile(overrides: Partial<Overview> = {}): Overview {
  return {
    isViewer: false,
    relation: { following: false, blocked: false },
    user: {
      handle: 'river_horse',
      displayName: 'River Horse',
      profileVisibility: 'public',
      accountRole: 'player',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    ratings: [],
    puzzleRatings: [],
    games: [],
    gamesTotal: 0,
    ...overrides,
  };
}

function challengeButton(root: HTMLElement): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>('button[data-action="challenge"]');
}

describe('profile Challenge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector('dialog[data-challenge-dialog]')?.remove();
  });

  it("shows on someone else's profile for a signed-in viewer", () => {
    const overview = buildProfileOverview(profile(), document.createElement('div'), 'en');
    expect(challengeButton(overview)?.textContent).toBe('Challenge');
    // One Challenge entry point, not a second button beside an existing one.
    expect(overview.querySelectorAll('button[data-action="challenge"]')).toHaveLength(1);
  });

  it('is absent for a signed-out viewer (no relation)', () => {
    const overview = buildProfileOverview(
      profile({ relation: null }),
      document.createElement('div'),
      'en',
    );
    expect(challengeButton(overview)).toBeNull();
  });

  it('is absent on your own profile', () => {
    const overview = buildProfileOverview(
      profile({ isViewer: true, relation: null }),
      document.createElement('div'),
      'en',
    );
    expect(challengeButton(overview)).toBeNull();
    expect(overview.textContent).toContain('Edit profile');
  });

  it('is absent on a profile you blocked', () => {
    const overview = buildProfileOverview(
      profile({ relation: { following: false, blocked: true } }),
      document.createElement('div'),
      'en',
    );
    expect(challengeButton(overview)).toBeNull();
  });

  it('opens the dialog named for the player and posts a seek targeted at their handle', () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const overview = buildProfileOverview(profile(), document.createElement('div'), 'en');
    challengeButton(overview)?.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[data-challenge-dialog]');
    expect(dialog?.querySelector('h2')?.textContent).toContain('River Horse');
    dialog?.querySelector<HTMLButtonElement>('.confirm-dialog-confirm')?.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/correspondence/seeks');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.targetHandle).toBe('river_horse');
    expect(body).toMatchObject({ preferredColor: 'random' });
    expect(typeof body.gameSpecId).toBe('string');
    expect(typeof body.daysPerMove).toBe('number');
  });
});
