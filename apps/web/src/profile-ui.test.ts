import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeaturedGame } from './game-display.js';
import { buildProfileGameRow } from './profile-ui.js';
import { webVariantTenants } from './variant-tenant/registry.js';

function game(overrides: Partial<FeaturedGame> = {}): FeaturedGame {
  return {
    roomId: 'room_1',
    variant: 'dark-chess',
    mode: 'pvp',
    rated: false,
    result: 'white-wins',
    termination: 'resignation',
    plyCount: 12,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt: '2026-06-07T12:00:00.000Z',
    participants: [
      {
        color: 'white',
        displayName: 'Alice',
        subjectType: 'user',
        subjectId: 'u_alice',
        visibility: 'public',
      },
      {
        color: 'black',
        displayName: 'Bob',
        subjectType: 'user',
        subjectId: 'u_bob',
        visibility: 'public',
      },
    ],
    playerColor: 'white',
    ...overrides,
  };
}

describe('profile game rows', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads the shared bot summary when a bot opponent name is hovered', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          bot: {
            id: 'misty',
            displayName: 'Misty',
            bio: 'Searches hidden positions.',
            ownerType: 'system',
            defaultGameSpecId: 'dark-chess',
            activeEngineId: 'misty-v1',
            supportedGameSpecIds: ['dark-chess'],
            gamesTotal: 12,
            record: { games: 12, wins: 8, losses: 3, draws: 1 },
            rating: null,
          },
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 },
      ),
    );
    const row = buildProfileGameRow(
      game({
        participants: [
          {
            color: 'white',
            displayName: 'Alice',
            subjectType: 'user',
            subjectId: 'u_alice',
            visibility: 'public',
          },
          {
            color: 'black',
            displayName: 'Misty',
            subjectType: 'bot',
            subjectId: 'misty',
            visibility: 'public',
          },
        ],
      }),
    );
    document.body.append(row);

    // The card hangs off the NAME, not the whole 'vs X' span: the name is also
    // the profile link, so hover target and click target are the same element.
    row.querySelector('.profile-game-opponent-name')?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(220);

    expect(fetchMock).toHaveBeenCalledWith('/api/bots/misty');
    expect(document.querySelector('.profile-summary-card-popover')?.textContent).toContain('Misty');
  });

  it('renders a banqi row vs the engine (not "vs White") and routes to the banqi surface', () => {
    // Regression: banqi names sides red/black, and a black player's opponent is
    // red. The opponent-colour resolver used to fall through to 'white', which
    // has no participant, so the row showed the literal seat "vs White" instead
    // of the engine. The href also fell through to /game/:id, whose chess-family
    // replay reducer 403s on banqi events.
    const row = buildProfileGameRow(
      game({
        roomId: 'bq_profile',
        variant: 'banqi',
        result: 'black-wins',
        participants: [
          {
            color: 'red',
            displayName: 'MistyBanqi - Strongest',
            subjectType: 'engine-version',
            subjectId: 'python-banqi-v1.0',
            visibility: 'private',
          },
          {
            color: 'black',
            displayName: 'dev-testing',
            subjectType: 'user',
            subjectId: 'u_dev',
            visibility: 'private',
          },
        ],
        playerColor: 'black',
      }),
    );

    const link = row.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/banqi/game/bq_profile');
    expect(row.textContent).toContain('Win');
    expect(row.textContent).toContain('vs MistyBanqi - Strongest');
    expect(row.textContent).not.toContain('vs White');
    expect(row.textContent).toContain('Banqi');
    expect(row.textContent).toContain('Black');
  });

  it('renders a Flip Jungle row vs the engine (not "vs White") and routes to the flip-jungle surface', () => {
    // Regression (prod, 2026-07-03): Flip Jungle names sides red/black, so a
    // black player's opponent is red. profileGameHref/opponentColor were
    // hand-maintained switches that never listed jungle-flip, so the row showed
    // the literal seat "vs White" and the href fell through to /game/:id, whose
    // chess-family replay reducer 403s on jungle-flip events. Both now resolve
    // through the variant registry + spec family.
    const row = buildProfileGameRow(
      game({
        roomId: 'jgf_profile',
        variant: 'jungle-flip',
        result: 'red-wins',
        participants: [
          {
            color: 'red',
            displayName: 'MistyJungleFlip',
            subjectType: 'engine-version',
            subjectId: 'container-jungle-flip-v1',
            visibility: 'private',
          },
          {
            color: 'black',
            displayName: 'dev-testing',
            subjectType: 'user',
            subjectId: 'u_dev',
            visibility: 'private',
          },
        ],
        playerColor: 'black',
      }),
    );

    const link = row.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/jungle-flip/game/jgf_profile');
    expect(row.textContent).toContain('vs MistyJungleFlip');
    expect(row.textContent).not.toContain('vs White');
    expect(row.textContent).toContain('Flip Jungle');
    expect(row.textContent).toContain('Black');
  });

  it('routes jieqi profile rows to the jieqi surface', () => {
    const row = buildProfileGameRow(
      game({
        roomId: 'jq_profile',
        variant: 'jieqi',
        result: 'red-wins',
        participants: [
          {
            color: 'red',
            displayName: 'Red Player',
            subjectType: 'user',
            subjectId: 'red-user',
            visibility: 'private',
          },
          {
            color: 'black',
            displayName: 'PikaJieQi',
            subjectType: 'engine-version',
            subjectId: 'python-jieqi-v1.0',
            visibility: 'private',
          },
        ],
        playerColor: 'red',
      }),
    );

    expect(row.querySelector('a')?.getAttribute('href')).toBe('/jieqi/game/jq_profile');
    expect(row.textContent).toContain('vs PikaJieQi');
  });

  it('keeps chess profile rows on the chess game route', () => {
    const row = buildProfileGameRow(game());
    expect(row.querySelector('a')?.getAttribute('href')).toBe('/game/room_1');
    expect(row.textContent).toContain('Fog Chess');
    expect(row.textContent).toContain('White');
  });

  // Registry-driven conformance: every variant tenant that owns a postgame
  // surface must route its profile rows there, never to the dark-chess
  // /game/:id (whose chess-family replay reducer 403s on a non-chess event
  // log). This is the lock that a hand-maintained switch lacked, so a newly
  // launched variant can't silently regress to "vs White" / a 403 postgame.
  const tenantsWithPostgame = webVariantTenants().filter((tenant) => tenant.gameRouteBase);
  it.each(tenantsWithPostgame.map((tenant) => [tenant.gameSpecId, tenant] as const))(
    'routes %s profile rows to its own postgame surface',
    (_specId, tenant) => {
      const roomId = `${tenant.roomIdPrefix}conformance`;
      const row = buildProfileGameRow(game({ roomId, variant: tenant.gameSpecId }));
      expect(row.querySelector('a')?.getAttribute('href')).toBe(
        `${tenant.gameRouteBase}/${roomId}`,
      );
    },
  );
});
