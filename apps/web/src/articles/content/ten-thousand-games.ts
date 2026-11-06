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

type BotCount = TenThousandGamesRecord['bots'][number];

// One row per bot with all its levels counted together, so no row is a choice.
// Keyed by the stable bot id, because a display name has changed over time, and
// `pikafish` is two bots: Level 8 of the jieqi ladder and a separate xiangqi bot.
// A bot in the record with no row here fails the test beside this file.
// Only these two bots are ladders; the /api/bots list has every other bot as one
// bot. The no-break space and word joiner keep "levels 1-8" whole when the cell
// wraps on a phone, which would otherwise break at the hyphen.
const EIGHT_LEVELS = '(levels\u00a01-\u20608)';
const BOT_ROWS: { name: string; variant: string; has: (b: BotCount) => boolean }[] = [
  {
    name: `Pikafish ${EIGHT_LEVELS}`,
    variant: 'Jieqi',
    has: (b) => b.variant === 'jieqi' && /^pikafish(-level-\d)?$/.test(b.bot),
  },
  { name: 'Misty', variant: 'Banqi and more', has: (b) => b.bot === 'misty' },
  {
    name: `Fairy-Stockfish ${EIGHT_LEVELS}`,
    variant: 'Xiangqi and more',
    has: (b) => /^fairy-stockfish-level-\d$/.test(b.bot),
  },
  { name: 'AB-JChess', variant: 'Jieqi', has: (b) => b.bot === 'ab-jchess' },
  { name: 'jqe', variant: 'Jieqi', has: (b) => b.bot === 'jqe' },
  {
    name: 'Pikafish',
    variant: 'Xiangqi',
    has: (b) => b.bot === 'pikafish' && b.variant === 'xiangqi',
  },
  { name: 'KataGo', variant: 'Jungle Chess', has: (b) => b.bot === 'katago' },
  { name: 'General Blunder', variant: 'Xiangqi', has: (b) => b.bot === 'general-blunder' },
];

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

export function botsWithoutARow(record: TenThousandGamesRecord): string[] {
  return record.bots
    .filter((b) => !BOT_ROWS.some((row) => row.has(b)))
    .map((b) => `${b.bot} in ${b.variant}`);
}

// Every bot, most played first. The games left over were against engines from
// June that predate the bot accounts, and they take the last row so the table
// adds up to the total the prose gives.
export function botRows(record: TenThousandGamesRecord) {
  const rows = BOT_ROWS.map(({ name, variant, has }) => {
    const levels = record.bots.filter(has);
    return {
      name,
      variant,
      games: levels.reduce((sum, b) => sum + b.games, 0),
      peopleWon: levels.reduce((sum, b) => sum + b.peopleWon, 0),
    };
  }).sort((a, b) => b.games - a.games);
  const games = record.gamesAgainstBots - rows.reduce((sum, r) => sum + r.games, 0);
  const peopleWon = record.gamesWonAgainstBots - rows.reduce((sum, r) => sum + r.peopleWon, 0);
  if (games <= 0) return rows;
  return [...rows, { name: 'Earlier engines', variant: 'Fog Chess', games, peopleWon }];
}

function jieqiLevel(record: TenThousandGamesRecord, bot: string): string {
  const found = record.bots.find((b) => b.bot === bot && b.variant === 'jieqi');
  if (!found) throw new Error(`no ${bot} in jieqi in the record`);
  return percent(found.peopleWon, found.games);
}

// A variant with no name has no row, so the table stops adding up to the total.
export function unnamedVariants(record: TenThousandGamesRecord): string[] {
  return record.variants.filter((v) => !VARIANT_NAMES[v.variant]).map((v) => v.variant);
}

// Two columns of variants read down, then across, to keep the table short.
function variantRows(named: TenThousandGamesRecord['variants']): string[][] {
  const half = Math.ceil(named.length / 2);
  return named.slice(0, half).map((left, i) => {
    const right = named[half + i];
    return [
      VARIANT_NAMES[left.variant],
      count(left.games),
      right ? VARIANT_NAMES[right.variant] : '',
      right ? count(right.games) : '',
    ];
  });
}

export function ending(record: TenThousandGamesRecord, name: string) {
  const found = record.endings.find((e) => e.ending === name);
  if (!found) throw new Error(`no ending ${name} in the record`);
  return found;
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
  const blunder = record.bots.find((b) => b.bot === 'general-blunder');
  const stalemate = ending(record, 'stalemate');
  const borders =
    record.gamesAcrossBorders === 0
      ? `So far, in all ${count(record.gamesSeenFromBothSides)} games between two people where we can see both sides, both players were in the same country or region. That will change.`
      : `So far, ${count(record.gamesAcrossBorders)} of the ${count(record.gamesSeenFromBothSides)} games between two people where we can see both sides crossed a border. That number will grow.`;

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
      'Engine matches, our test accounts and variants we have retired are left out; counting started on June 1.',
      'A player is an account, or a browser playing as a guest.',
      'Countries and regions are read from the network of each browser that started a game, so a VPN can place someone elsewhere.',
    ],
    publishedAt: '2026-11-10',
    thumbnail: {
      kind: 'image',
      src: '/article-thumbs/ten-thousand-games.jpg',
      alt: 'A round Chinese chess piece marked with the character for ten thousand, beside the number 10,000 with a small grey cloud at its last zero.',
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
            headers: ['Variant', 'Games', 'Variant', 'Games'],
            rows: variantRows(named),
            compact: true,
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
            text: `${count(record.gamesAgainstBots)} games were against a bot. ${count(record.gamesBetweenPeople)} were between two people, up from ${count(record.atOneThousand.gamesBetweenPeople)} in the first 1,000.`,
          },
          {
            kind: 'paragraph',
            text: 'To play a person, use Find opponent on the homepage, challenge a friend, or start a [correspondence game](/correspondence).',
          },
        ],
      },
      {
        heading: 'How often people beat the bots',
        blocks: [
          {
            kind: 'paragraph',
            text: `People won ${count(record.gamesWonAgainstBots)} of their ${count(record.gamesAgainstBots)} games against bots. The table lists every bot, most played first, with all of a bot's levels counted together.`,
          },
          {
            kind: 'table',
            headers: ['Bot', 'Variant', 'Games', 'Beaten'],
            rows: botRows(record).map((row) => [
              row.name,
              row.variant,
              count(row.games),
              percent(row.peopleWon, row.games),
            ]),
            keyColumn: true,
            compact: true,
            wrap: true,
          },
          {
            kind: 'paragraph',
            text: `Levels make a large difference: in jieqi, people beat Pikafish ${jieqiLevel(record, 'pikafish-level-1')} of the time at Level 1 and ${jieqiLevel(record, 'pikafish')} at Level 8. Each bot meets different players, so the table is not a strength rating.${blunder ? ` General Blunder, which tries to lose, lost only ${count(blunder.peopleWon)} of its ${count(blunder.games)} games.` : ''}`,
          },
        ],
      },
      {
        heading: 'How games ended',
        blocks: [
          {
            kind: 'paragraph',
            text: `Resignation was the most common ending, in ${count(ending(record, 'resignation').games)} games, ahead of ${count(ending(record, 'checkmate').games)} checkmates and ${count(ending(record, 'timeout').games)} games lost on time. Another ${count(stalemate.games)} ended with a player out of legal moves, which is a loss in these games and a draw in chess. Those were the longest of the four, at about ${count(Math.round(stalemate.averagePlies / 2))} moves a side.`,
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
            text: 'Thank you to everyone who played a game, reported a bug or became a [patron](/patron). You are why Mistboard is here, and we are grateful for every game.',
          },
          {
            kind: 'paragraph',
            text: `${borders} Our mission is to bring people together across cultures through Chinese chess and the world's classic strategy games.`,
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
