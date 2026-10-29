import { describe, expect, it } from 'vitest';
import {
  type BotSummaryProfile,
  buildBotSummaryCard,
  buildUserCard,
  type UserCardProfile,
} from './profile-summary-card.js';
import { profileRatingVariants } from './variants.js';

// A variant guaranteed to be on the profile surface (dark chess leads the list),
// so the rating tile renders with a mini-board icon.
const ratedVariant = profileRatingVariants[0].id;

function profile(overrides: Partial<UserCardProfile> = {}): UserCardProfile {
  return {
    isViewer: false,
    relation: { following: false, blocked: false },
    user: {
      handle: 'conan',
      displayName: 'Conan_The_Barbarian8',
      accountRole: 'player',
      createdAt: '2025-08-01T00:00:00.000Z',
    },
    ratings: [
      {
        variant: ratedVariant,
        timeClass: 'blitz',
        eloRating: 2903,
        ratedGamesPlayed: 120,
        totalGamesPlayed: 200,
        provisional: false,
      },
    ],
    gamesTotal: 587,
    ...overrides,
  };
}

describe('profile summary cards', () => {
  it('renders the name as a profile link', () => {
    const card = buildUserCard(profile());
    const name = card.querySelector('.profile-summary-card-name') as HTMLAnchorElement;
    expect(name.textContent).toBe('Conan_The_Barbarian8');
    expect(name.getAttribute('href')).toBe('/@/conan');
  });

  it('shows a rated variant tile with its Elo', () => {
    const card = buildUserCard(profile());
    const value = card.querySelector('.profile-summary-card-rating-value');
    expect(value?.textContent).toBe('2903');
    expect(card.querySelector('.profile-summary-card-rating-icon .variant-marker')).not.toBeNull();
  });

  it('marks a provisional rating with a "?"', () => {
    const card = buildUserCard(
      profile({
        ratings: [
          {
            variant: ratedVariant,
            timeClass: 'blitz',
            eloRating: 1500,
            ratedGamesPlayed: 3,
            totalGamesPlayed: 3,
            provisional: true,
          },
        ],
      }),
    );
    expect(card.querySelector('.profile-summary-card-rating-value')?.textContent).toBe('1500?');
  });

  it('omits the rating grid when the player has no rated variant', () => {
    const card = buildUserCard(profile({ ratings: [] }));
    expect(card.querySelector('.profile-summary-card-ratings')).toBeNull();
  });

  it('renders Follow + Message actions for a non-viewer', () => {
    const card = buildUserCard(profile());
    const actions = [...card.querySelectorAll('.profile-summary-card-action')].map(
      (el) => el.textContent,
    );
    expect(actions).toContain('Follow');
    expect(actions).toContain('Message');
  });

  it('shows Unfollow when already following', () => {
    const card = buildUserCard(profile({ relation: { following: true, blocked: false } }));
    const actions = [...card.querySelectorAll('.profile-summary-card-action')].map(
      (el) => el.textContent,
    );
    expect(actions).toContain('Unfollow');
  });

  it('hides actions on the viewer’s own card', () => {
    const card = buildUserCard(profile({ isViewer: true, relation: null }));
    expect(card.querySelector('.profile-summary-card-actions')).toBeNull();
  });

  it('renders a presence dot only when online', () => {
    expect(
      buildUserCard(profile(), { online: true }).querySelector('.profile-summary-card-dot'),
    ).not.toBeNull();
    expect(
      buildUserCard(profile(), { online: false }).querySelector('.profile-summary-card-dot'),
    ).toBeNull();
  });

  it('shows the game count in the footer', () => {
    const card = buildUserCard(profile());
    expect(card.querySelector('.profile-summary-card-footer')?.textContent).toContain('587');
  });

  it('renders bots through the same card shell with a bot-only action fork', () => {
    const bot: BotSummaryProfile = {
      id: 'misty',
      displayName: 'Misty',
      bio: 'Searches hidden positions.',
      ownerType: 'system',
      defaultGameSpecId: 'dark-chess',
      activeEngineId: 'misty-v1',
      supportedGameSpecIds: ['dark-chess'],
      playOptions: [{ gameSpecId: 'dark-chess', engineId: 'misty-v1', playable: true }],
      gamesTotal: 12,
      record: { games: 12, wins: 8, losses: 3, draws: 1 },
      rating: {
        gameSpecId: 'dark-chess',
        timeClass: 'blitz',
        rating: 1812,
        games: 12,
        provisional: false,
      },
    };

    const card = buildBotSummaryCard(bot);

    expect(card.className).toBe('profile-summary-card');
    expect(card.dataset.subjectKind).toBe('bot');
    expect(card.querySelector<HTMLAnchorElement>('.profile-summary-card-name')?.pathname).toBe(
      '/bot/misty',
    );
    expect(card.querySelector('.profile-summary-card-rating-value')?.textContent).toBe('1,812');
    // Its one variant is its one action: the primary "Play Fog Chess", not a bare chip.
    const play = card.querySelector('button.profile-summary-card-action');
    expect(play?.textContent).toBe('Play Fog Chess');
    expect(play?.classList.contains('profile-summary-card-action-primary')).toBe(true);
    expect(card.querySelector('.profile-summary-card-footer')?.textContent).toContain('8-3-1');
  });
});
