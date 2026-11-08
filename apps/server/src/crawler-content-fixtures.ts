// Deterministic in-memory page sources for the built-server integration probe.
// Use the same source interfaces as player-pages.test, broadcast-pages.test
// and server-static-pages.test; no production DB and no synthetic HTML bodies.
import { XIANGQI_BROADCAST_SCHEMA } from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { type BroadcastPageSources, broadcastPageFor } from './broadcast-pages.js';
import type { StudyWithChapters } from './persistence.js';
import type { BotProfilePage } from './persistence-bots.js';
import type { ProfileGameRecord } from './persistence-games.js';
import type { HistoricalXiangqiGameInput } from './persistence-historical-xiangqi.js';
import type { UserProfile } from './persistence-profiles.js';
import type { XiangqiPlayerRecord } from './persistence-xiangqi-players.js';
import { playerPageFor } from './player-pages.js';
import { EMPTY_PLAYER_REFERENCE } from './player-reference.js';
import type { CrawlerPageSources } from './server-http.js';

export const CRAWLER_STUDY: StudyWithChapters = {
  id: 'CrawlerStudy',
  ownerId: 'crawler-owner',
  slug: null,
  name: 'Study classical xiangqi compositions',
  description:
    'Study classical Chinese chess compositions, forcing moves and practical endgame technique. Each chapter explains a position and invites careful calculation before playing through the solution.',
  i18n: {
    'zh-Hans': {
      name: '象棋经典研习排局',
      description:
        '学习中国象棋经典排局、强制着法和实用残局技巧。每章介绍一个局面，邀请读者仔细计算，再逐步研究解答。我们将依次观察将帅的安全、车马炮的配合、兵卒的推进和防守资源。通过比较不同的应对，可以发现每一种着法背后的战术目的，以及何时应该主动交换、保留攻势或转入和棋残局。这份研习还介绍如何检查遗漏的将军、捉子和闲着，并将计算过程整理成可复习的变化，帮助读者建立可靠的思考习惯。',
    },
    'zh-Hant': {
      name: '象棋經典研習排局',
      description:
        '學習中國象棋經典排局、強制著法和實用殘局技巧。每章介紹一個局面，邀請讀者仔細計算，再逐步研究解答。我們將依次觀察將帥的安全、車馬炮的配合、兵卒的推進和防守資源。通過比較不同的應對，可以發現每一種著法背後的戰術目的，以及何時應該主動交換、保留攻勢或轉入和棋殘局。這份研習還介紹如何檢查遺漏的將軍、捉子和閒著，並將計算過程整理成可複習的變化，幫助讀者建立可靠的思考習慣。',
    },
  },
  visibility: 'public',
  featuredAt: null,
  createdAt: new Date('2026-11-07'),
  updatedAt: new Date('2026-11-07'),
  chapters: [
    {
      id: 'CrawlerChapter',
      studyId: 'CrawlerStudy',
      ordinal: 0,
      name: 'Seven Stars',
      i18n: {},
      variant: 'xiangqi',
      orientation: 'red',
      root: {
        version: 1,
        root: {
          children: [
            { id: 'h3e3', uci: 'h3e3', children: [{ id: 'h8e8', uci: 'h8e8', children: [] }] },
          ],
          annotations: {
            comments: [
              {
                text: 'Study this classical composition by identifying forcing checks and captures before selecting a plan. Compare the defensive resources carefully, trace each variation to a quiet position, and only then choose the move that preserves the attack.',
              },
            ],
          },
        },
      },
      tags: {},
      denorm: {},
      version: 0,
      gamebook: false,
      practice: false,
      practiceGoal: null,
      scoreSeries: null,
      createdAt: new Date('2026-11-07'),
      updatedAt: new Date('2026-11-07'),
    },
  ],
};

export const CRAWLER_HISTORICAL_GAME: HistoricalXiangqiGameInput = {
  id: 'hxq_crawler',
  sourceId: 'crawler-source',
  sourceGameId: 'crawler-game',
  eventName: 'Crawler fixture invitational',
  site: 'Guangzhou',
  round: '1',
  redNameRaw: '孟繁睿',
  blackNameRaw: '尹昇',
  playedOn: '2026-11-07',
  result: '1-0',
  moveFormat: 'coordinate',
  moves: [
    { from: 'h3', to: 'e3' },
    { from: 'h8', to: 'e8' },
    { from: 'h1', to: 'g3' },
    { from: 'h10', to: 'g8' },
  ],
  visibility: 'public',
};

const player: XiangqiPlayerRecord = {
  slug: 'crawler-player',
  name: '孟繁睿',
  nameEn: 'Meng Fanrui',
  federation: '浙江',
  federationEn: 'Zhejiang',
  games: 1,
  wins: 1,
  draws: 0,
  losses: 0,
  events: [],
  firstPlayedOn: '2026-11-07',
  lastPlayedOn: '2026-11-07',
};
const at = new Date('2026-11-07');
const tour = {
  schema: XIANGQI_BROADCAST_SCHEMA,
  slug: 'crawler-cup',
  name: '象棋邀请赛',
  nameEn: 'Crawler fixture invitational',
  location: 'Guangzhou',
  sourceUrl: 'https://example.test/source',
  startsAt: '2026-11-07T10:00:00Z',
  endsAt: '2026-11-08T10:00:00Z',
  pollMode: 'off' as const,
  pollEnabled: false,
  pollIntervalMs: 30_000,
  createdAt: at,
  updatedAt: at,
};
const round = {
  schema: XIANGQI_BROADCAST_SCHEMA,
  id: 'crawler-cup-r01',
  tourSlug: tour.slug,
  name: '第一轮',
  nameEn: 'Round 1',
  startsAt: '2026-11-07T10:00:00Z',
  createdAt: at,
  updatedAt: at,
};
const board = {
  schema: XIANGQI_BROADCAST_SCHEMA,
  id: 'crawler-board',
  tourSlug: tour.slug,
  roundId: round.id,
  sourceBoardId: 'crawler-board',
  boardNumber: 1,
  red: { name: player.name, nameEn: player.nameEn! },
  black: { name: '尹昇', nameEn: 'Yin Sheng' },
  status: 'complete' as const,
  result: '1-0' as const,
  moves: [...CRAWLER_HISTORICAL_GAME.moves],
  plyCount: CRAWLER_HISTORICAL_GAME.moves.length,
  finalStatus: {
    type: 'finished' as const,
    winner: 'red' as const,
    reason: 'resignation' as const,
  },
  sourceUrl: 'https://example.test/source',
  createdAt: at,
  updatedAt: at,
};

export function crawlerFixtureSources(): CrawlerPageSources {
  // Explicit public launch flags in this test-only serving set. No production reads.
  process.env.MISTBOARD_XIANGQI_ENABLED = 'true';
  process.env.MISTBOARD_JIEQI_ENABLED = 'true';
  const broadcasts: BroadcastPageSources = {
    listTours: async () => [tour],
    getTour: async (slug) => (slug === tour.slug ? tour : null),
    listRounds: async (slug) => (slug === tour.slug ? [round] : []),
    listBoards: async (id) => (id === round.id ? [board] : []),
    getBoard: async (id) => (id === board.id ? board : null),
    playerSlugs: async () => new Map([[player.name, player.slug]]),
    shareMeta: async () => null,
  };
  const puzzle = loadSeedPuzzleRegistry('xiangqi')[0]!;
  return {
    listPublicStudies: async () => [
      {
        ...CRAWLER_STUDY,
        ownerHandle: 'crawler-owner',
        ownerDisplayName: 'Crawler fixture',
        likeCount: 0,
        chapterCount: 1,
        chapterPreview: [{ name: 'Seven Stars', i18n: {} }],
        chapterNames: ['Seven Stars'],
        previewBoard: null,
      },
    ],
    getStudy: async (id) => (id === CRAWLER_STUDY.id ? CRAWLER_STUDY : null),
    playerPage: (path, locale) =>
      playerPageFor(
        path,
        {
          listPlayers: async () => [player],
          listBoards: async () => [
            {
              boardId: board.id,
              tourSlug: tour.slug,
              tourName: tour.name,
              tourNameEn: tour.nameEn,
              roundId: round.id,
              roundName: round.name,
              roundNameEn: round.nameEn,
              playedOn: '2026-11-07',
              colour: 'red',
              opponent: { name: board.black.name, nameEn: board.black.nameEn, slug: null },
              result: '1-0',
              outcome: 'win',
              plyCount: board.plyCount,
              sourceUrl: null,
              opening: null,
            },
          ],
          reference: async () => ({
            ...EMPTY_PLAYER_REFERENCE,
            points: {
              [player.name]: {
                points: 3105,
                rank: 1,
                group: 'men',
                of: 50,
                listDate: '2026-11-07',
              },
            },
            ratings: { [player.name]: { rating: 2650, rank: 3, of: 151, listLabel: '2026-11-07' } },
          }),
        },
        locale,
      ),
    broadcastPage: (path, locale) => broadcastPageFor(path, broadcasts, locale),
    puzzle: async (id) => (id === 'crawler-puzzle' || id === puzzle.id ? puzzle : null),
    historicalGame: async (id) =>
      id === CRAWLER_HISTORICAL_GAME.id ? CRAWLER_HISTORICAL_GAME : null,
    profile: async (handle) => (handle === CRAWLER_PROFILE.user.handle ? CRAWLER_PROFILE : null),
    bot: async (id) => (id === CRAWLER_BOT.id ? CRAWLER_BOT : null),
  };
}

export const CRAWLER_PUBLIC_GAME: ProfileGameRecord = {
  roomId: 'crawler-game',
  variant: 'xiangqi',
  mode: 'pvp',
  result: '1-0',
  termination: 'resignation',
  plyCount: 4,
  startedAt: at,
  endedAt: at,
  whiteName: 'Crawler player',
  blackName: 'Public opponent',
  corpusId: null,
  rated: true,
  visibility: 'public',
  participants: [],
  playerColor: 'red',
  initialMs: 180000,
  incrementMs: 2000,
};
export const CRAWLER_PROFILE: UserProfile = {
  user: {
    handle: 'crawler-player',
    displayName: 'Crawler player',
    bio: '',
    location: '',
    profileLinks: [],
    profileVisibility: 'public',
    accountRole: 'player',
    isFounder: false,
    title: null,
    flair: null,
    patronSince: null,
    createdAt: at,
  },
  ratings: [
    {
      variant: 'xiangqi',
      timeClass: 'blitz',
      eloRating: 1742,
      ratedGamesPlayed: 12,
      totalGamesPlayed: 15,
      provisional: true,
    },
  ],
  puzzleRatings: [],
  puzzleStreak: { current: 0, best: 0 },
  achievements: [],
  games: [CRAWLER_PUBLIC_GAME],
  gamesTotal: 1,
};
export const CRAWLER_BOT: BotProfilePage = {
  id: 'pikafish',
  displayName: 'Pikafish',
  bio: 'Pikafish',
  ownerType: 'system',
  ownerUserId: null,
  activeEngineId: 'pikafish',
  defaultGameSpecId: 'xiangqi',
  supportedGameSpecIds: ['xiangqi', 'jieqi'],
  play: {
    mode: 'pve',
    gameSpecId: 'xiangqi',
    engineId: 'pikafish',
    timeControl: { initialMs: 600000, incrementMs: 5000 },
    preferredColor: 'random',
  },
  rating: null,
  ratings: [
    {
      gameSpecId: 'xiangqi',
      timeClass: 'blitz',
      rating: 2700,
      ratingDeviation: null,
      games: 40,
      source: 'eve-anchor',
      sourceRef: null,
      createdAt: at,
      provisional: false,
    },
  ],
  visibility: 'public',
  createdAt: at,
  updatedAt: at,
  gamesTotal: 20,
  record: { games: 20, wins: 12, losses: 6, draws: 2 },
  recordsByGameSpecId: {
    xiangqi: { games: 20, wins: 12, losses: 6, draws: 2 },
    jieqi: { games: 0, wins: 0, losses: 0, draws: 0 },
  },
  games: [CRAWLER_PUBLIC_GAME],
  gamesByGameSpecId: { xiangqi: [CRAWLER_PUBLIC_GAME], jieqi: [] },
};
