// Deterministic in-memory page sources for the built-server integration probe.
// Use the same source interfaces as player-pages.test, broadcast-pages.test
// and server-static-pages.test; no production DB and no synthetic HTML bodies.
import { XIANGQI_BROADCAST_SCHEMA } from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { type BroadcastPageSources, broadcastPageFor } from './broadcast-pages.js';
import type { StudyWithChapters } from './persistence.js';
import type { HistoricalXiangqiGameInput } from './persistence-historical-xiangqi.js';
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
          children: [],
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
  moves: [],
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
  moves: [],
  plyCount: 0,
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
    playerPage: (path) =>
      playerPageFor(path, {
        listPlayers: async () => [player],
        listBoards: async () => [],
        reference: async () => ({
          ...EMPTY_PLAYER_REFERENCE,
          points: {
            [player.name]: { points: 3105, rank: 1, group: 'men', of: 50, listDate: '2026-11-07' },
          },
          ratings: { [player.name]: { rating: 2650, rank: 3, of: 151, listLabel: '2026-11-07' } },
        }),
      }),
    broadcastPage: (path) => broadcastPageFor(path, broadcasts),
    puzzleId: async (id) => (id === 'crawler-puzzle' || id === puzzle.id ? puzzle.id : null),
    // Historical games currently have no raw-body renderer. Keep that gap in
    // the manifest; seeding its record must not invent a passing crawler body.
  };
}
