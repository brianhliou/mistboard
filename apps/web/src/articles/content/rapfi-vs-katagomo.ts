import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuRoomState,
  type GomokuSquare,
} from '@mistboard/game';
import { gomokuRulesBoard } from '../../gomoku-rules-diagrams.js';
import { gameLengthChartSvg, resultLinesChartSvg } from '../gomoku-title-charts.js';
import type { Article, ArticleBlock } from '../types.js';
import decisive from './gomoku-title-decisive.json' with { type: 'json' };
import match from './gomoku-title-match.json' with { type: 'json' };

// The first Gomoku title match (2026-11-11): Rapfi, the engine behind every
// Gomoku bot here, against KataGomo. An engineering post, English only until
// the English is signed off.
//
// Every number in the prose is read from gomoku-title-match.json, which was
// recomputed from the lab's per-game files (mistboard-engine
// lab/gomoku-title-match-2026-11/run-equal-3s) with the paired bootstrap in
// scripts/gomoku-level-ladder.mjs. The record also keeps an earlier match at
// matched search (uneven: Level 8 against KataGomo at 250 visits). The title is
// the equal-time match; the earlier one gets one sentence, its result, and
// Level 8's budget (decided 2026-11-11). Why the games are decisive is read from
// gomoku-title-decisive.json (Rapfi's own logged evals; KataGomo logged none).
// gomoku-title-match.test.ts holds both records to themselves, replays the
// featured game, and checks that the prose states the records' numbers.
//
// Left out on purpose: KataGomo sometimes asks to pass, which Gomoku here has
// no move for; the referee asked again with pass forbidden. No such retry
// changed a result (record: katagomo.passRetry), so the post does not explain it.

const E = match.equal.total;
const ET = E.timing;
/** Level 8's search budget, the bot players meet (gomoku-level-ladder.mjs level 8). */
const L8 = match.uneven.rapfiBudget;
const SECONDS = match.equal.katagomoBudget.maxTimeS;
/** The earlier match at matched search, which the post gives one sentence. */
const U = match.uneven;
const D = decisive;
const KV = decisive.katagomoView;

const commas = (n: number): string => n.toLocaleString('en-US');
const pct = (score: number): string => `${Math.round(score * 100)}%`;
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const seconds = (ms: number): string => (ms / 1000).toFixed(1);
/** A won-drawn-lost line joined by non-breaking hyphens (U+2011), so it never wraps mid-score. */
const wdl = (r: { wins: number; draws: number; losses: number }): string =>
  `${r.wins}\u2011${r.draws}\u2011${r.losses}`;
const pct1 = (x: number): string => `${(x * 100).toFixed(1)}%`;
const points = (x: number): string => `${Math.round(x * 100)}`;

/** The stone count at which the post reads the result lines apart. */
export const PARTED_AT_STONES = 20;
const partedAt = (line: readonly { stones: number; chance: number }[]): number => {
  const point = line.find((x) => x.stones === PARTED_AT_STONES);
  if (!point) throw new Error(`no trajectory point at ${PARTED_AT_STONES} stones`);
  return point.chance;
};
/** Rapfi's mean win chance at PARTED_AT_STONES, by final result. */
export const PARTED = {
  wins: partedAt(D.trajectory.wins),
  draws: partedAt(D.trajectory.draws),
  losses: partedAt(D.trajectory.losses),
};
/** The opening's dealt stones, so a stone count reads as moves played. */
const DEALT = match.featured.opening.stones.length;

/** The 55% a challenger needs (champions.ruleScore). */
export const TITLE_BAR = 0.55;
/** KataGomo's score in the title match, as the challenger. */
export const KATAGOMO_SCORE = 1 - E.score;
/** The title match's median Rapfi search, as a multiple of Level 8's budget. */
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

/** The match study (scripts/variant-lab/gomoku-title-study.ts): a chapter per
 *  game, both engines' win chance graphed under the board. Local study until it
 *  is created on prod; then these ids are swapped for the prod ones. */
export const RAPFI_KATAGOMO_STUDY = {
  id: 'gVo12Ybf',
  chapters: { featured: 'Yhg41QMH', draw: 'pnDEEhxT' } as Record<string, string>,
} as const;

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

/** A game from the study, opened on its last position, the graph under it. */
function studyEmbed(chapter: string, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${RAPFI_KATAGOMO_STUDY.id}/${RAPFI_KATAGOMO_STUDY.chapters[chapter]}?ply=${ply}`,
    title,
    // A placeholder until the card reports its height: the card plus the
    // win-chance graph under it (study_chapters.score_series).
    aspect: [702, 926],
  };
}

export const rapfiVsKatagomoArticle: Article = {
  slug: 'rapfi-vs-katagomo',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'Rapfi wins the Gomoku title against KataGomo',
  cardTitle: 'Rapfi wins the Gomoku title',
  summary: `Rapfi, the engine behind Mistboard's Gomoku bots, beat KataGomo over ${E.games} games at ${SECONDS} seconds a move and is the first Gomoku champion.`,
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-13',
  method: [
    `${E.games} counted games from ${match.equal.played / 2} dealt openings, each played twice with colours swapped, at ${SECONDS} seconds a move for both engines; one game voided.`,
    `Elo ranges: 95% paired bootstrap over the opening pairs (${commas(100_000)} resamples).`,
  ],
  thumbnail: { kind: 'svg', svg: featuredBoard },
  audience: 'People who play Gomoku against the bots on Mistboard, and engine authors.',
  readNext: ['gomoku', 'ab-jchess-vs-jqe', 'katago-jungle'],
  tldr: [
    `Rapfi is Mistboard's first Gomoku champion. Given ${SECONDS} seconds a move each, it beat KataGomo over ${E.games} games: ${E.wins} wins, ${E.draws} draws and ${E.losses} losses, a score of ${pct(E.score)} (about ${signed(E.elo)} Elo).`,
    `Rapfi Level 8, the bot you play, searches ${commas(L8.nodes)} positions a move. In the title match Rapfi searched about ${LEVEL8_SHARE} times that.`,
    `The games that end in a five end early, a median ${D.lengths.decisiveMedian} moves after the opening; every draw filled the board.`,
  ],
  intro: [
    p(
      `Rapfi is the first [Gomoku](/rules/gomoku) champion on Mistboard. It is the open-source engine by dhbloo and the Rapfi contributors that plays every Gomoku bot here, Level 1 to Level 8. Its challenger was KataGomo, hzyhhzy's Gomoku build of the Go engine KataGo. By the rules on the [champions page](/champions), KataGomo needed ${pct(TITLE_BAR)} to take the title. With ${SECONDS} seconds a move for both engines, it scored ${pct(KATAGOMO_SCORE)}. On the CPUs Mistboard serves from, Rapfi is the stronger engine.`,
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
            [`All games, ${SECONDS} s each`, wdl(E), pct(E.score)],
            ['With Black', wdl(E.rapfiAsBlack), pct((E.rapfiAsBlack.wins + E.rapfiAsBlack.draws / 2) / E.rapfiAsBlack.games)],
            ['With White', wdl(E.rapfiAsWhite), pct((E.rapfiAsWhite.wins + E.rapfiAsWhite.draws / 2) / E.rapfiAsWhite.games)],
          ],
          highlightRows: [0],
          keyColumn: true,
          wrap: true,
        },
        p(
          `That is about **${signed(E.elo)} Elo** for Rapfi (95% range ${signed(E.eloLow)} to ${signed(E.eloHigh)}). Both engines had the same clock on one CPU thread, and used it differently: Rapfi took ${seconds(ET.rapfiMeanMs)} of its ${SECONDS} seconds on average and searched a median **${commas(ET.rapfiNodesMedian)} positions** a move, while KataGomo, on its ${match.katagomo.backend} backend, searched a median ${commas(ET.katagomoVisitsMedian)} visits. A KataGomo visit runs a large neural network on one position; a Rapfi position costs far less.`,
        ),
        p(
          `The engine mattered far more than the colour: moving first was worth about ${points(D.edges.colour)} points of score, being Rapfi about ${points(D.edges.engine)}.`,
        ),
        p(
          `The clock is what decides it. In an earlier match at matched search, Rapfi Level 8 at ${commas(L8.nodes)} positions a move against KataGomo at ${U.katagomoBudget.maxVisits} visits, the two scored level: ${wdl(U.total)} over ${U.total.games} games.`,
        ),
      ],
    },
    {
      heading: 'Game 1',
      blocks: [
        p(
          `Each game starts from one of the dealt openings the site uses, with stones already on the board. In game 1 KataGomo had Black, and Rapfi won with its ${FEATURED_RAPFI_MOVES}th move, ${FEATURED_LAST}, a diagonal five from ${FEATURED_FIVE[0]} to ${FEATURED_FIVE.at(-1)}. Under the board, both engines read every position of the game: the teal line is Rapfi's win chance for Black, the orange line KataGomo's.`,
        ),
        studyEmbed('featured', F.moves.length, 'KataGomo vs Rapfi, game 1'),
      ],
    },
    {
      heading: `Decisive games end in about ${Math.round(D.lengths.decisiveMedian)} moves, and every draw fills the board`,
      blocks: [
        p(
          `${D.lengths.decisive} of the ${D.games} games ended in a five, at a median of ${D.lengths.decisiveMedian} moves after the opening. All ${D.lengths.draws} draws ran the full ${D.lengths.drawMoves} moves: no game was drawn before the board filled.`,
        ),
        {
          kind: 'raw-svg',
          svg: gameLengthChartSvg(D.lengths),
          caption: `Games by moves played after the opening, in bins of ${D.lengths.binMoves}. The grey bar is the ${D.lengths.draws} draws.`,
        },
        p(
          `Under these rules a full board is the only draw, and the engines have no way to agree one, so a drawn game is played out to the last point. In a typical draw the fight is over long before that. Rapfi last read either side as clearly ahead, above 62%, at a median move ${D.draws.settledMedianMove}, and the other ${D.lengths.drawMoves - D.draws.settledMedianMove} or so moves fill the board without a five.`,
        ),
        p(
          `Game ${D.draws.featured.game} is one of them. Both engines read it as somewhat better for White until move ${D.draws.featured.lastUnevenMove}, then dead even to the end.`,
        ),
        studyEmbed('draw', D.lengths.drawMoves, `Rapfi vs KataGomo, game ${D.draws.featured.game}`),
      ],
    },
    {
      heading: `The games turn in the first ${PARTED_AT_STONES - DEALT} moves`,
      blocks: [
        p(
          `Rapfi logged its reading of every position it moved in. Averaged by result, its win chance had already split by stone ${PARTED_AT_STONES}, ${PARTED_AT_STONES - DEALT} moves after the ${DEALT} dealt stones: ${pct(PARTED.wins)} in its eventual wins, ${pct(PARTED.draws)} in the draws and ${pct(PARTED.losses)} in its losses.`,
        ),
        {
          kind: 'raw-svg',
          svg: resultLinesChartSvg(D.trajectory),
          caption: `Rapfi's mean win chance by stones on the board, in bins of ${D.trajectory.binStones}, one line per result.`,
        },
        p(`In the games it won, Rapfi saw a forced five at a median stone ${D.forcedWin.medianStone}.`),
      ],
    },
    {
      heading: 'KataGomo read the openings better than Rapfi did',
      blocks: [
        p(
          `Rapfi screened the openings, and it read them as even all match. KataGomo, reading each one at ${commas(KV.openings.visits)} visits, gave Black anywhere from ${pct(KV.openings.blackMin)} to ${pct(KV.openings.blackMax)}, and put ${KV.openings.outsideFortySixty} of the ${KV.openings.read} outside 40-60%.`,
        ),
        p(
          `The results sided with KataGomo: in the ${KV.openings.high.openings} openings it gave Black over 60%, Black scored ${pct(KV.openings.high.blackScore)}; in the ${KV.openings.low.openings} it gave Black under 40%, Black scored ${pct(KV.openings.low.blackScore)}.`,
        ),
      ],
    },
    {
      heading: 'How the games were lost',
      blocks: [
        p(
          `**Rapfi lost from even games.** Its ${D.losses.games} losses were slides: in the ${D.losses.read} with logged readings, the best it ever gave itself was a median ${pct(D.losses.bestChanceMedian)}, and only ${D.losses.aboveSeventy} went above 70%.`,
        ),
        p(
          `**KataGomo saw its losses coming.** In ${KV.rapfiWins.sample} of Rapfi's wins, it read the position one move before Rapfi saw a won game and gave itself a median ${pct(KV.rapfiWins.chanceMedian)}. With ten times its match search, ${commas(KV.rapfiWins.deepVisits)} visits, it still gave itself ${pct(KV.rapfiWins.deepChanceMedian)}. By its own reading, no move saved those games by then.`,
        ),
        p(
          `**Rapfi attacks more.** ${pct1(D.attack.rapfi.fours / D.attack.rapfi.moves)} of its moves made a four, against ${pct1(D.attack.katagomo.fours / D.attack.katagomo.moves)} of KataGomo's, and it made ${D.attack.rapfi.doubleThreats} moves with two threats at once to KataGomo's ${D.attack.katagomo.doubleThreats}.`,
        ),
      ],
    },
    {
      heading: 'What it means for the bot you play',
      blocks: [
        p(
          `Level 8 is the champion's engine with a smaller search: **${commas(L8.nodes)} positions** a move, with a ${seconds(L8.timeMs)}-second ceiling so a slow phone can reach it. The Rapfi that won the title searched about ${LEVEL8_SHARE} times as much, so it is stronger than the bot you play.`,
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
            `One game was voided when Rapfi took ${seconds(VOIDED_MS)} seconds on one move, past the referee's limit. The other game of that opening counts in the totals and is left out of the Elo range, which pairs games by opening.`,
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
