// Public-API-shaped fixtures shared by body tests and the built crawler probe.
import type { DataPageSources } from './data-page-body.js';
import type { DataListing } from './game-data-files.js';
import type { PublicSiteStats } from './persistence.js';
import type { CoachListing } from './persistence-coaches.js';
import type { ForumCategory } from './persistence-forum.js';
import type { LeaderboardEntry } from './persistence-leaderboards.js';

export const DATA_STATS_FIXTURE: PublicSiteStats = {
  generatedAt: '2026-11-07T00:00:00Z',
  totalCompletedGames: 1200,
  last30dCompletedGames: 90,
  publicGames: 1100,
  accounts: 120,
  weeklyCompletedGames: Array.from({ length: 12 }, (_, i) => ({
    weekStart: new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10),
    completedGames: i + 10,
  })),
  weeklyByVariant: [],
  modeTotals: { pvp: 400, pve: 800, eve: 5000 },
  variantTotals: [
    { variant: 'xiangqi', count: 800 },
    { variant: 'jieqi', count: 400 },
  ],
  dailyCompletedGames: [],
  variantDaily: [],
};
export const DATA_DOWNLOAD_FIXTURE: DataListing = {
  license: 'CC-BY-4.0',
  schemaVersion: '1',
  variants: ['xiangqi', 'jieqi'],
  offeredVariants: ['xiangqi', 'jieqi', 'gomoku'],
  firstArchives: [{ variant: 'gomoku', month: '2026-11' }],
  unavailableVariants: [{ variant: 'three-kingdoms-banqi', reason: 'hidden-pieces' }],
  collections: [],
  months: [
    {
      month: '2026-10',
      games: 120,
      files: [
        {
          format: 'jsonl',
          path: '/api/data/monthly/2026-10/all.jsonl.gz',
          fileName: '2026-10-all.jsonl.gz',
          games: 120,
          built: { bytes: 2048, sha256: 'abcdef0123456789', builtAt: '2026-11-01T00:00:00Z' },
        },
      ],
      variants: [
        {
          variant: 'xiangqi',
          games: 120,
          files: [
            {
              format: 'pgn',
              path: '/api/data/monthly/2026-10/xiangqi.pgn.gz',
              fileName: '2026-10-xiangqi.pgn.gz',
              games: 120,
              built: null,
            },
          ],
        },
      ],
    },
  ],
  engineMonths: [
    {
      month: '2026-10',
      games: 500,
      files: [
        {
          format: 'jsonl',
          path: '/api/data/engine-monthly/2026-10/all.jsonl.gz',
          fileName: '2026-10-engine-all.jsonl.gz',
          games: 500,
          built: null,
        },
      ],
      variants: [],
    },
  ],
};
export const DATA_COACH_FIXTURE: CoachListing = {
  handle: 'crawler-coach',
  displayName: 'Coach <Lin>',
  title: 'xim',
  headline: 'Practical xiangqi endgames and tournament preparation',
  languages: 'English, Mandarin',
  rate: '25 per lesson',
  acceptingStudents: true,
};
export const DATA_FORUM_FIXTURE: ForumCategory[] = [
  {
    id: 'general',
    slug: 'general',
    name: 'General discussion',
    description: 'Talk about xiangqi, chess variants, and the games you play on Mistboard.',
    i18n: {
      'zh-Hans': {
        name: '综合讨论',
        description: '讨论象棋、棋类变体以及你在 Mistboard 上的对局。',
      },
      'zh-Hant': {
        name: '綜合討論',
        description: '討論象棋、棋類變體以及你在 Mistboard 上的對局。',
      },
    },
    sortOrder: 0,
    topicWritePolicy: 'account',
    topicCount: 3,
    postCount: 9,
    latestPost: {
      post: { id: 'post1' },
      topic: {
        id: 'topic1',
        slug: 'endgame-study',
        title: 'How do you study practical endgames?',
        postCount: 4,
      },
      author: null,
      createdAt: new Date('2026-11-07'),
    },
  },
  {
    id: 'analysis',
    slug: 'analysis',
    name: 'Game analysis',
    description:
      'Share your games and discuss positions, tactical ideas, mistakes and alternative lines with other players.',
    i18n: {},
    sortOrder: 1,
    topicWritePolicy: 'account',
    topicCount: 2,
    postCount: 6,
    latestPost: null,
  },
  {
    id: 'feedback',
    slug: 'feedback',
    name: 'Feedback and questions',
    description:
      'Report a problem with the site, ask a question about playing here, or suggest an improvement.',
    i18n: {},
    sortOrder: 2,
    topicWritePolicy: 'account',
    topicCount: 0,
    postCount: 0,
    latestPost: null,
  },
];
export const DATA_RANKING_FIXTURE: LeaderboardEntry[] = [
  {
    rank: 1,
    handle: 'lin',
    displayName: 'Lin',
    title: null,
    eloRating: 1700,
    gamesPlayed: 30,
    provisional: false,
  },
  {
    rank: 2,
    handle: 'chen',
    displayName: 'Chen',
    title: null,
    eloRating: 1450,
    gamesPlayed: 10,
    provisional: true,
  },
];
export function crawlerDataPageSources(): DataPageSources {
  return {
    stats: async () => DATA_STATS_FIXTURE,
    data: async () => DATA_DOWNLOAD_FIXTURE,
    coaches: async () => [DATA_COACH_FIXTURE],
    categories: async () => DATA_FORUM_FIXTURE,
    leaderboard: async () =>
      Array.from({ length: 16 }, (_, i) => ({
        ...DATA_RANKING_FIXTURE[0]!,
        rank: i + 1,
        handle: `rated-player-${i}`,
        displayName: `Rated player ${i}`,
        eloRating: 2400 - i * 100,
      })),
  };
}
