import type { Article } from '../types.js';
import { weeklyGamesChartSvg } from '../ten-thousand-games-chart.js';
import tenThousandGamesRecord from './ten-thousand-games-record.json' with { type: 'json' };

// The date stays null in the record until the count crosses.
export type TenThousandGamesRecord = Omit<typeof tenThousandGamesRecord, 'tenThousandOn'> & {
  tenThousandOn: string | null;
};

const VARIANT_NAMES: Record<string, string> = {
  jieqi: 'Jieqi',
  xiangqi: 'Xiangqi',
  banqi: 'Banqi',
  'jungle-flip': 'Flip Jungle',
  'dark-chess': 'Fog Chess',
  jungle: 'Jungle Chess',
  'dark-xiangqi': 'Fog Xiangqi',
  'crazyhouse-xiangqi': 'Crazyhouse Xiangqi',
  'duck-xiangqi': 'Duck Xiangqi',
  'xiangqi-mahjong': 'Xiangqi Mahjong',
};

const count = (n: number): string => n.toLocaleString('en-US');
const percent = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;
const longDate = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// Full weeks only: the last entry of the series is the week still in progress.
export function fullWeeks(record: TenThousandGamesRecord) {
  return record.weeks.slice(0, -1);
}

// The week from which every full week has had at least 1,000 games.
export function firstLastingThousandWeek(record: TenThousandGamesRecord) {
  const weeks = fullWeeks(record);
  let first = weeks.length - 1;
  while (first > 0 && weeks[first - 1].games >= 1_000) first -= 1;
  return weeks[first];
}

// Every number a reader sees is built here from the record. The refresh before
// launch rewrites the JSON, and the prose follows it; the test beside this file
// fails on a number the record cannot produce.
export function buildTenThousandGamesArticle(record: TenThousandGamesRecord): Article {
  const crossed = record.tenThousandOn !== null;
  const reachedOn = record.tenThousandOn ?? record.capturedAt.slice(0, 10);
  const nextGames = crossed ? 9_000 : record.totalGames - 1_000;
  const milestone = crossed ? 10_000 : record.totalGames;
  const jieqi = record.variants.find((v) => v.variant === 'jieqi')?.games ?? 0;
  const lasting = firstLastingThousandWeek(record);
  const named = record.variants.filter((v) => VARIANT_NAMES[v.variant]);
  const retired = record.variants
    .filter((v) => !VARIANT_NAMES[v.variant])
    .reduce((sum, v) => sum + v.games, 0);

  return {
    slug: 'ten-thousand-games',
    kind: 'article',
    publisher: 'mistboard',
    title: '10,000 games played',
    seoTitle: 'Mistboard passes 10,000 games',
    summary: 'How the first 10,000 games on Mistboard came in, what people played, and who played them.',
    showSummaryOnPage: false,
    status: 'draft',
    method: [
      'A game counts once both sides have moved and it ends, against a person or a bot.',
      'Engine matches, our test accounts and the two variants we retired in October are left out; counting started on June 1.',
      'A player is an account, or a browser playing as a guest.',
      'Countries and regions are read from the network of each browser that started a game, so a VPN can place someone elsewhere.',
    ],
    publishedAt: '2026-11-10',
    thumbnail: {
      kind: 'image',
      src: '/article-thumbs/ten-thousand-games.jpg',
      alt: 'A stack and a scatter of round wooden Chinese chess pieces on a table, most of them face down.',
    },
    audience: 'Everyone who plays on Mistboard.',
    tldr: [
      `Mistboard passed ${count(milestone)} finished games on ${longDate(reachedOn)}.`,
      `Jieqi is ${percent(jieqi, record.totalGames)} of them.`,
      `All but ${count(record.gamesBetweenPeople)} were against a bot.`,
      `The ${count(record.playersWithHundredGames)} players with at least 100 games were in ${percent(record.gamesWithThosePlayers, record.totalGames)} of them.`,
    ],
    intro: [
      {
        kind: 'paragraph',
        text: `The first 1,000 games on Mistboard took four months. The next ${count(nextGames)} took ${daysBetween(record.firstThousandOn, reachedOn)} days.`,
      },
      {
        kind: 'raw-svg',
        svg: weeklyGamesChartSvg(fullWeeks(record)),
        caption: 'Finished games each week since June 1, Monday to Sunday.',
      },
      {
        kind: 'paragraph',
        text: `Every week since ${longDate(lasting.weekStart)} has had more than 1,000 games. The busiest was the week of ${longDate(record.peakWeek.weekStart)}, with ${count(record.peakWeek.games)}, and one player played ${count(record.peakWeek.gamesByItsBusiestPlayer)} of those. The [statistics page](/stats) keeps the running count.`,
      },
    ],
    sections: [
      {
        heading: 'What people played',
        blocks: [
          {
            kind: 'paragraph',
            text: `[Jieqi](/rules/jieqi), xiangqi with the pieces face down, is ${percent(jieqi, record.totalGames)} of all games. It was ${percent(record.atOneThousand.jieqiGames, 1_000)} of the first 1,000. Crazyhouse Xiangqi and Xiangqi Mahjong launched after that post.`,
          },
          {
            kind: 'table',
            headers: ['Variant', 'Games'],
            rows: [
              ...named.map((v) => [VARIANT_NAMES[v.variant], count(v.games)]),
              ...(retired > 0 ? [['Earlier variants', count(retired)]] : []),
            ],
            keyColumn: true,
          },
        ],
      },
      {
        heading: 'Who played them',
        blocks: [
          {
            kind: 'paragraph',
            text: `Mistboard has had ${count(record.players)} players, counting a guest browser as one, so a person on two devices counts twice. ${count(record.playersWithOneGame)} of them have played once and ${count(record.playersWithTenGames)} have played at least ten. They came from at least ${count(record.countriesAndRegions)} countries and regions, most of all mainland China, then the United States, Taiwan and Vietnam.`,
          },
          {
            kind: 'paragraph',
            text: `The ${count(record.playersWithHundredGames)} players with at least 100 games were in ${percent(record.gamesWithThosePlayers, record.totalGames)} of all games. The most active has played ${count(record.mostGamesByOnePlayer)}.`,
          },
          {
            kind: 'paragraph',
            text: `${count(record.gamesAgainstBots)} games were against a bot, and people won ${count(record.gamesWonAgainstBots)} of those. ${count(record.gamesBetweenPeople)} were between two people, up from ${count(record.atOneThousand.gamesBetweenPeople)} in the first 1,000.`,
          },
          {
            kind: 'paragraph',
            text: 'To play a person, use Find opponent on the homepage, challenge a friend, or start a [correspondence game](/correspondence).',
          },
        ],
      },
      {
        heading: 'New since the first 1,000',
        blocks: [
          {
            kind: 'paragraph',
            text: 'The site was rebuilt for phones, and rated play opened to more variants. Puzzles gained [Puzzle Storm](/puzzles?mode=storm), [Puzzle Streak](/puzzles?mode=streak), puzzles by theme and a [dashboard](/puzzles/dashboard). Jieqi gained [jqe](/bot/jqe), and xiangqi gained [General Blunder](/bot/general-blunder), a bot that tries to lose. Pieces can now stand in 3D, and banqi tiles turn over. The [updates page](/feed) has the full list.',
          },
        ],
      },
      {
        heading: 'Thank you',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Thank you to everyone who played a game, reported a bug, or supports the site as a [patron](/patron). Mistboard is still small, and we are grateful to every person who gave it a try.',
          },
          {
            kind: 'paragraph',
            text: `People have sat down across these boards for centuries, in parks, teahouses and kitchens. We hope that one day a player anywhere can open Mistboard and find someone on the other side of the world to play. With ${count(record.gamesBetweenPeople)} games between two people so far, we have a long way to go. Our mission is to bring people together across cultures through Chinese chess and the world's classic strategy games.`,
          },
          {
            kind: 'cta',
            layout: 'single-row',
            buttons: [
              { label: 'Play a game', href: '/', emphasis: 'primary' },
              { label: 'Send feedback', href: '/contact', emphasis: 'secondary' },
            ],
          },
        ],
      },
    ],
  };
}

export const tenThousandGamesArticle: Article = buildTenThousandGamesArticle(tenThousandGamesRecord);
