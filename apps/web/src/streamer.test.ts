import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shipped list is empty until real streamers agree to be listed, so the
// card path is exercised against a mocked module rather than live data. That
// keeps these tests honest when STREAMERS is seeded later.
vi.mock('./streamers-data.js', () => ({
  STREAMERS: [
    {
      name: 'Riverbank',
      platform: 'twitch',
      url: 'https://twitch.tv/riverbank',
      blurb: 'Xiangqi for chess players, most evenings.',
      language: 'English',
      handle: 'riverbank',
      addedAt: '2026-08-27',
    },
    {
      name: '象棋频道',
      platform: 'youtube',
      url: 'https://youtube.com/@xiangqi',
      blurb: 'Tournament recaps.',
      language: 'Mandarin',
      addedAt: '2026-08-27',
    },
  ],
}));

describe('streamer directory', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders a card per streamer with an external channel link', async () => {
    const { mountStreamer } = await import('./streamer.js');
    const root = document.createElement('div');
    mountStreamer(root);

    const cards = [...root.querySelectorAll('.streamer-card')];
    expect(cards).toHaveLength(2);
    expect(root.querySelector('.streamer-empty')).toBeNull();

    const channel = cards[0]?.querySelector<HTMLAnchorElement>('.streamer-card-name');
    expect(channel?.textContent).toBe('Riverbank');
    expect(channel?.getAttribute('href')).toBe('https://twitch.tv/riverbank');
    // An outbound link to a third-party host leaks neither referrer nor opener.
    expect(channel?.rel).toBe('nofollow noopener noreferrer');
    expect(channel?.target).toBe('_blank');
    expect(cards[0]?.querySelector('.streamer-card-platform')?.textContent).toBe('Twitch');
    expect(cards[1]?.querySelector('.streamer-card-platform')?.textContent).toBe('YouTube');
  });

  it('links a Mistboard profile only for a streamer who has a handle', async () => {
    const { mountStreamer } = await import('./streamer.js');
    const root = document.createElement('div');
    mountStreamer(root);

    const cards = [...root.querySelectorAll('.streamer-card')];
    expect(
      cards[0]?.querySelector<HTMLAnchorElement>('.streamer-card-profile')?.getAttribute('href'),
    ).toBe('/@/riverbank');
    expect(cards[1]?.querySelector('.streamer-card-profile')).toBeNull();
  });
});

describe('streamer directory with nobody listed', () => {
  it('renders the empty state instead of an empty list', async () => {
    vi.resetModules();
    vi.doMock('./streamers-data.js', () => ({ STREAMERS: [] }));
    const { mountStreamer } = await import('./streamer.js');
    const root = document.createElement('div');
    mountStreamer(root);

    expect(root.querySelector('.streamer-list')).toBeNull();
    expect(root.querySelector('.streamer-empty')?.textContent).toBe(
      'No streamers are listed yet. You could be one of the first.',
    );
  });
});
