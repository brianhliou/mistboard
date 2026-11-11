import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuRoomState,
  type GomokuSquare,
} from '@mistboard/game';
import { gomokuRulesBoard } from '../../gomoku-rules-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';
import match from './gomoku-title-match.json' with { type: 'json' };

// The first Gomoku title match (2026-11-11): Rapfi, the engine behind every
// Gomoku bot here, against KataGomo. An engineering post, English only until
// the English is signed off.
//
// Every number in the prose is read from gomoku-title-match.json, which was
// recomputed from the lab's per-game files (mistboard-engine
// lab/gomoku-title-match-2026-11/{run-100,run-100b,run-equal-3s}) with the
// paired bootstrap in scripts/gomoku-level-ladder.mjs.
// gomoku-title-match.test.ts holds the record to itself, replays the featured
// game, and checks that the prose states the record's numbers.
//
// Left out on purpose: KataGomo sometimes asks to pass, which Gomoku here has
// no move for; the referee asked again with pass forbidden. No such retry
// changed a result (record: katagomo.passRetry), so the post does not explain it.

const U = match.uneven.total;
const E = match.equal.total;
const UT = U.timing;
const ET = E.timing;
const L8 = match.uneven.rapfiBudget;
const KG = match.uneven.katagomoBudget;
const SECONDS = match.equal.katagomoBudget.maxTimeS;

const commas = (n: number): string => n.toLocaleString('en-US');
const pct = (score: number): string => `${Math.round(score * 100)}%`;
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const seconds = (ms: number): string => (ms / 1000).toFixed(1);
const wdl = (r: { wins: number; draws: number; losses: number }): string =>
  `${r.wins}-${r.draws}-${r.losses}`;

/** The 55% a challenger needs (champions.ruleScore). */
export const TITLE_BAR = 0.55;
/** KataGomo's score in each match, as the challenger. */
export const KATAGOMO_SCORE = { uneven: 1 - U.score, equal: 1 - E.score };
/** How many times longer KataGomo took a move than Rapfi in the first match. */
export const UNEVEN_TIME_RATIO = Math.round(UT.katagomoMeanMs / UT.rapfiMeanMs);
/** The rematch's median Rapfi search, as a multiple of Level 8's budget. */
export const LEVEL8_SHARE = Math.round(ET.rapfiNodesMedian / L8.nodes);

const F = match.featured;

/** How long Rapfi took over the voided move, from the referee's reason. */
export const VOIDED_MS = Number(/(\d+)ms$/.exec(match.equal.voided.reason)?.[1]);

/** The featured game's position after `plies` of its moves (all of them by default). */
export function featuredGameState(plies = F.moves.length): GomokuRoomState {
  let state = createGomokuRoomState('rapfi-vs-katagomo', {
    stones: F.opening.stones.map((s) => ({
      square: s.square as GomokuSquare,
      color: s.color as 'black' | 'white',
    })),
    turn: F.opening.turn as 'black' | 'white',
  });
  for (const to of F.moves.slice(0, plies)) {
    state = applyGomokuRoomMove(state, { to: to as GomokuSquare });
  }
  return state;
}

/** Rapfi's moves in the featured game (it had White; Black moves first). */
export const FEATURED_RAPFI_MOVES = F.moves.length / 2;
/** The five Rapfi completed, in board order, and its last stone. */
export const FEATURED_FIVE = ['b9', 'c8', 'd7', 'e6', 'f5'] as const;
export const FEATURED_LAST = F.moves.at(-1) as string;

const featuredBoard = (): string => gomokuRulesBoard(featuredGameState());

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

export const rapfiVsKatagomoArticle: Article = {
  slug: 'rapfi-vs-katagomo',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'Rapfi wins the Gomoku title against KataGomo',
  cardTitle: 'Rapfi wins the Gomoku title',
  summary: `Rapfi, the engine behind Mistboard's Gomoku bots, beat KataGomo over ${E.games} games at ${SECONDS} seconds a move and is the first Gomoku champion. At the bots' own budgets the two were about even.`,
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-13',
  method: [
    `First match: ${U.games} games from ${U.pairs} dealt openings, each played twice with colours swapped. Rapfi at Level 8's budget (${commas(L8.nodes)} positions a move), KataGomo at ${KG.maxVisits} visits a move.`,
    `Rematch: ${E.games} counted games from ${match.equal.played / 2} openings at ${SECONDS} seconds a move for both engines; one game voided.`,
    `Elo ranges: 95% paired bootstrap over the opening pairs (${commas(100_000)} resamples).`,
  ],
  thumbnail: { kind: 'svg', svg: featuredBoard },
  audience: 'People who play Gomoku against the bots on Mistboard, and engine authors.',
  readNext: ['gomoku', 'ab-jchess-vs-jqe', 'katago-jungle'],
  tldr: [
    `Rapfi is Mistboard's first Gomoku champion. Given ${SECONDS} seconds a move each, it beat KataGomo over ${E.games} games: ${E.wins} wins, ${E.draws} draws and ${E.losses} losses, a score of ${pct(E.score)} (about ${signed(E.elo)} Elo).`,
    `At the bots' own budgets the first match was about even, ${wdl(U)} over ${U.games} games, but KataGomo took about ${UNEVEN_TIME_RATIO} times as long a move.`,
    `Rapfi Level 8, the bot you play, searches ${commas(L8.nodes)} positions a move. In the rematch Rapfi searched about ${LEVEL8_SHARE} times that.`,
  ],
  intro: [
    p(
      `Rapfi is the first [Gomoku](/rules/gomoku) champion on Mistboard. It is the open-source engine by dhbloo and the Rapfi contributors that plays every Gomoku bot here, Level 1 to Level 8. Its challenger was KataGomo, hzyhhzy's Gomoku build of the Go engine KataGo. By the rules on the [champions page](/champions), KataGomo needed ${pct(TITLE_BAR)} to take the title. It scored ${pct(KATAGOMO_SCORE.uneven)} in a first match at each bot's own budget and ${pct(KATAGOMO_SCORE.equal)} in a rematch at equal time.`,
    ),
    {
      kind: 'note',
      label: 'As of November 11, 2026',
      text: `Rapfi commit ${match.rapfi.commit.slice(0, 7)} with Rapfi Networks 7eeb19b, and KataGomo commit ${match.katagomo.commit.slice(0, 7)} with its b10 freestyle network, each on one CPU thread. KataGomo usually runs on a graphics card, where it searches far more in the same time, so it may score differently there, as may a later release of either engine.`,
    },
  ],
  sections: [
    {
      heading: 'The result',
      blocks: [
        {
          kind: 'table',
          headers: ['Rapfi', 'Won-drawn-lost', 'Score'],
          rows: [
            [`Rematch, ${SECONDS} s each`, wdl(E), pct(E.score)],
            ['With Black', wdl(E.rapfiAsBlack), pct((E.rapfiAsBlack.wins + E.rapfiAsBlack.draws / 2) / E.rapfiAsBlack.games)],
            ['With White', wdl(E.rapfiAsWhite), pct((E.rapfiAsWhite.wins + E.rapfiAsWhite.draws / 2) / E.rapfiAsWhite.games)],
            ['First match', wdl(U), pct(U.score)],
          ],
          highlightRows: [0],
          keyColumn: true,
          wrap: true,
        },
        p(
          `The rematch is about **${signed(E.elo)} Elo** for Rapfi (95% range ${signed(E.eloLow)} to ${signed(E.eloHigh)}). The first match is about ${signed(U.elo)} Elo, with a range of ${signed(U.eloLow)} to ${signed(U.eloHigh)} that holds no clear winner.`,
        ),
      ],
    },
    {
      heading: 'The first match gave KataGomo more time',
      blocks: [
        p(
          `The first match used each bot's own budget: Rapfi at Level 8's **${commas(L8.nodes)} positions** a move, KataGomo at **${KG.maxVisits} visits**. The two numbers count different work. A KataGomo visit runs a large neural network on one position; a Rapfi position costs far less.`,
        ),
        {
          kind: 'table',
          headers: ['A move', 'First match', 'Rematch'],
          rows: [
            ['Rapfi time', `${seconds(UT.rapfiMeanMs)} s`, `${seconds(ET.rapfiMeanMs)} s`],
            ['Rapfi positions', commas(UT.rapfiNodesMedian), commas(ET.rapfiNodesMedian)],
            ['KataGomo time', `${seconds(UT.katagomoMeanMs)} s`, `${seconds(ET.katagomoMeanMs)} s`],
            ['KataGomo visits', String(UT.katagomoVisitsMedian), String(ET.katagomoVisitsMedian)],
          ],
          keyColumn: true,
          wrap: true,
        },
        p(
          `Times are means and searches are medians. The champions rule gives both engines the same budget, and positions and visits are not the same budget, so the rematch gave both the same clock: ${SECONDS} seconds a move. Rapfi used ${seconds(ET.rapfiMeanMs)} of its ${SECONDS} seconds on average. KataGomo searched fewer visits than in the first match, ${commas(ET.katagomoVisitsMedian)} against ${commas(UT.katagomoVisitsMedian)}, while Rapfi rose to ${commas(ET.rapfiNodesMedian)} positions, about ${LEVEL8_SHARE} times as many.`,
        ),
      ],
    },
    {
      heading: 'Game 1 of the rematch',
      blocks: [
        p(
          `Each game starts from one of the dealt openings the site uses, with stones already on the board. In game 1 KataGomo had Black, and Rapfi won with its ${FEATURED_RAPFI_MOVES}th move, a diagonal five from ${FEATURED_FIVE[0]} to ${FEATURED_FIVE.at(-1)}.`,
        ),
        {
          kind: 'raw-svg',
          svg: featuredBoard,
          caption: `Green rings mark the five; the red square marks Rapfi's last stone, ${FEATURED_LAST}.`,
        },
      ],
    },
    {
      heading: 'What it means for the bot you play',
      blocks: [
        p(
          `Level 8 is the champion's engine with a smaller search: **${commas(L8.nodes)} positions** a move, with a ${seconds(L8.timeMs)}-second ceiling so a slow phone can reach it. On the match machine that took ${seconds(UT.rapfiMeanMs)} seconds a move on average, and at that budget Rapfi was about even with KataGomo. The Rapfi that won the title searched about ${LEVEL8_SHARE} times as much, so it is stronger than the bot you play.`,
        ),
      ],
    },
    {
      heading: 'How the match was run',
      blocks: [
        {
          kind: 'list',
          items: [
            `Freestyle Gomoku on a 15 by 15 board: five or more in a row wins, a full board is a draw.`,
            `Openings dealt from the site's ${match.openings.poolSize} screened positions, each played twice with colours swapped.`,
            `One search thread per engine and a fresh engine process for every move, on an Apple silicon Mac. The site serves an x86-64 build of the same Rapfi commit.`,
            `Rapfi with a ${match.rapfi.hashMb} MB hash; KataGomo on its CPU backend.`,
            `One rematch game was voided when Rapfi took ${seconds(VOIDED_MS)} seconds on one move, past the referee's limit. The other game of that opening counts in the totals and is left out of the Elo range, which pairs games by opening.`,
            `Ending by five: ${E.endings.five} rematch games and ${U.endings.five} first-match games; the rest filled the board.`,
          ],
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        p(
          `Rapfi is open source under the GPL-3.0 licence at [github.com/dhbloo/rapfi](${match.rapfi.repo}), and its networks are public domain (CC0). KataGomo is open source under the MIT licence at [github.com/hzyhhzy/KataGomo](${match.katagomo.repo}); the network we ran is [b10_freestyle15x](${match.katagomo.network.url}) from its Gomocup 2025 release. Thank you, dhbloo and the Rapfi contributors, and thank you, hzyhhzy.`,
        ),
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play Rapfi', href: '/bot/rapfi-level-8', emphasis: 'primary' },
            { label: 'See the champions', href: '/champions', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
