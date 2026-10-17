import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// DRAFT. Three jieqi engines side by side: PikaJieQi (Levels 1 to 8), AB-JChess
// (the top bot) and jqe (Devin O'Keefe's engine). The AB-JChess post covers that
// engine's arrival and two of its games, the reveal-bug post covers PikaJieQi's
// averaging bugs; this page links both and does not restate them.
//
// HOLD: jqe must not appear on any public page until its author answers
// github.com/devinokeefe/jieqi issue #1 (ledger/steps s-3a3a). Every passage
// that depends on him carries the marker comment below. The article stays
// `status: 'draft'` until then. Drafts ship in the production bundle (only the
// route is hidden), and this repository is public, so the commit must not be
// pushed or shipped before his yes either.
//
// publishedAt: Brian dates it (Tuesday or Friday only, article-schedule.test.ts).
//
// Sources, all read 2026-10-16:
// - mistboard-engine lab/jieqi-abjchess-2026-09-29/README.md: run7, AB-JChess vs
//   PikaJieQi 248-136-16 at 4 s, 4 threads, +100 [+66, +136]; speeds at the start
//   position (31k vs 1.7M positions a second, 1 thread); the edge falling with
//   time for the v0.2a build (+98 at 1 s, +40 at 4 s).
// - mistboard-engine lab/jieqi-jqe-2026-10-16/README.md + summarize.py over
//   run1-4s-4thr.jsonl and run2-15s-4thr.jsonl: jqe 71-4-25, +173 [+101, +262];
//   33-4-13, +147 [+58, +261]; pair scores; colours; repetition/no-capture rules.
// - jqe @ 331a6e61 (~/projects/tools/jqe-331a6e61): README.md (results table, net
//   size), REPORT.md (chance nodes, network, formal results), docs/DECISIONS.md
//   D091 item 3 (30x the nodes; the gain is search), THIRD_PARTY.md (PikaJieQi
//   commit 6398d4c1, before the bcc83f88 reveal fix), CHANGELOG.md (0.1.0,
//   2026-10-13), LICENSE (MIT).
// - AB-JChess net file size: ~/projects/tools/AB-JChess/nets/abjchess-20260911.nnue
//   (132,764,846 bytes); the billion training positions: ab-jchess.ts.
// - PikaJieQi's averaging and the fix: pikafish-reveal-bug.ts and pikafish-jieqi.ref.

const JQE_REPO = 'https://github.com/devinokeefe/jieqi';
const AB_REPO = 'https://github.com/lxsgx23/AB-JChess';
// @mistboard's public study of the 100 games at 4 s a move (run1), one chapter a
// game, built by mistboard-engine lab/jieqi-jqe-2026-10-16/study/build-plan.ts.
// JQE: needs Devin's yes (s-3a3a)
const JQE_STUDY = '/study/R612nAlt';

// Text card (text-card.ts). No engine is named on it, so the card itself does
// not depend on the hold.
const JIEQI_ENGINES_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'JIEQI',
      lead: 'ENGINES',
      tagline: 'THREE BOTS, HEAD TO HEAD',
      ariaLabel: 'A card reading jieqi engines, three bots head to head',
    },
    locale,
  );

export const jieqiEnginesArticle: Article = {
  slug: 'jieqi-engines',
  kind: 'article',
  publisher: 'mistboard',
  // JQE: needs Devin's yes (s-3a3a)
  title: 'Three jieqi engines, head to head',
  // JQE: needs Devin's yes (s-3a3a)
  seoTitle: 'Jieqi engines compared: PikaJieQi, AB-JChess and jqe',
  // JQE: needs Devin's yes (s-3a3a)
  summary:
    'How PikaJieQi, AB-JChess and jqe judge a face-down piece, what each evaluates positions with, and how they did against each other: jqe beat AB-JChess 71 to 25, and AB-JChess beat PikaJieQi 248 to 136.',
  showSummaryOnPage: false,
  status: 'draft',
  thumbnail: { kind: 'svg', svg: JIEQI_ENGINES_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'Jieqi players and engine authors who want to know which engine is strongest and why.',
  readNext: ['ab-jchess', 'pikafish-reveal-bug', 'jieqi-platform'],
  tldr: [
    // JQE: needs Devin's yes (s-3a3a)
    'jqe, an open-source engine by Devin O\'Keefe, beat AB-JChess 71 to 25 with 4 draws at the settings our bots use, about 170 Elo. AB-JChess had beaten PikaJieQi 248 to 136, about 100 Elo.',
    'All three treat moving a face-down piece as a gamble and average over what it could be. They differ in how carefully they take that average and in what judges the positions.',
    // JQE: needs Devin's yes (s-3a3a)
    "jqe's network is about 85 times smaller than AB-JChess's and was trained on about a twelfth as many positions. Most of its lead comes from its search.",
  ],
  intro: [
    // JQE: needs Devin's yes (s-3a3a)
    {
      kind: 'paragraph',
      text: `We have now measured three [jieqi](/rules/jieqi) engines against each other. PikaJieQi is our build of Pikafish and plays Levels 1 to 8 here. [AB-JChess](/blog/ab-jchess) has been the top bot on the site since October. [jqe](${JQE_REPO}) is a new engine by Devin O'Keefe, first released on October 13.`,
    },
    // JQE: needs Devin's yes (s-3a3a)
    {
      kind: 'paragraph',
      text: 'They finish in that order. This page asks how far apart they are and where the strength comes from: what each engine does when it moves a piece it has not seen, and what it judges a position with.',
    },
  ],
  sections: [
    {
      heading: 'One idea, three engines',
      blocks: [
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: 'All three are alpha-beta engines, the kind of search Pikafish and Stockfish use: look ahead along the moves, cut off lines that are already worse than one found earlier. Jieqi adds one thing a xiangqi engine never meets. A face-down piece is turned over when it moves, so the engine does not know what it is moving. Each of the three handles that the same way. It plays the move once for each piece the face-down one could be, scores each outcome, and averages them, weighted by how many of each piece are still unaccounted for.',
        },
        {
          kind: 'paragraph',
          text: 'That average is where most of the trouble has been. A reveal that wins when the piece is a chariot and gets mated when it is a soldier should come out somewhere between the two. Getting that number right, quickly, inside a search that is trying to skip work, is harder than it sounds.',
        },
      ],
    },
    {
      heading: 'What each one judges positions with',
      blocks: [
        {
          kind: 'paragraph',
          text: '**PikaJieQi** is a fork of [Pikafish](https://github.com/official-pikafish/Pikafish) on its jieqi branch, with a hand-written evaluation and no neural network. It is fast: at the starting position, on one thread, it looks at about 1.7 million positions a second. A network we trained for it never beat the hand-written rules ([Jieqi on Mistboard](/blog/jieqi-platform) has more).',
        },
        {
          kind: 'paragraph',
          text: `**[AB-JChess](${AB_REPO})**, by Huorongrong and Laoxu (Kouza), is also built from Pikafish, but it judges positions with a neural network trained on about a billion jieqi positions. The network file is 133 MB. In the same test it looked at about 31,000 positions a second, more than fifty times fewer than PikaJieQi, and understood each one better.`,
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: `**[jqe](${JQE_REPO})** is written from scratch, with no code from another engine. Its network is 1.5 MB, about 85 times smaller than AB-JChess's. It was trained only on jqe's own games: 82 million positions, each one labelled with jqe's own search score and the game's result, over rounds in which a new network replaced the old one only after beating it in a 400-game match. Its inputs include, besides the board, a count of every piece still face-down, so the network can see what a reveal might turn up. By its author's count jqe looks at about 30 times as many positions as AB-JChess in the same time.`,
        },
      ],
    },
    {
      heading: 'Averaging a reveal honestly',
      blocks: [
        {
          kind: 'paragraph',
          text: 'To save time, an alpha-beta search stops working on a move once it knows the move is worse than the best one so far. What it hands back is then a bound, "this much or worse", and not the move\'s real score. A bound is fine for comparing moves. It goes wrong in an average: a piece that gets mated can come back as "no better than +7" and count as +7, so a risky reveal looks safer than it is.',
        },
        {
          kind: 'paragraph',
          text: 'PikaJieQi had this flaw and a second one, a colour mix-up that made Black\'s reveals take the best outcome where they meant to take the worst. We found both on October 2 and fixed them for the move the bot is choosing; [the reveal-bug post](/blog/pikafish-reveal-bug) has the details. Deeper in its search the old averaging is still there, because fixing it everywhere made the bot about 150 Elo weaker. AB-JChess, built from the same code, has the bound flaw and not the colour one.',
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: "jqe's author found the same bound flaw on his own and measured it. On 72 reveals jqe had played, the old way of averaging rated them too high by 0.021 in expected score, about two points in a hundred. His fix searches every possible piece six half-moves less deep with the window fully open, so each comes back with a real score, and searches the most numerous piece at full depth as well. That brought the error down to 0.009 while searching only 1.15 times as many positions. Against the old version of itself it gained about 137 Elo, and about 34 more for doing it at every reveal in the search along with three smaller changes. Doing the exact average at every reveal is the step that cost our bot 150.",
        },
      ],
    },
    {
      heading: 'Head to head',
      blocks: [
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: 'We played both matches on the setup the site uses for its bots: 4 seconds a move, 4 threads each, on the same match referee. jqe and AB-JChess played 50 deals twice each, with colours swapped, so neither got the luck of a better deal. We then played 25 more deals at 15 seconds a move to see whether the gap closed with more time. jqe\'s own report adds two longer matches of 1,000 games each, on his referee and at a minute a game plus 0.6 seconds a move.',
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'table',
          caption:
            'Results for the first engine named: wins, draws, losses. The range is the 95% interval. The last two rows are from jqe\'s report.',
          headers: ['Match', 'Clock', 'Games', 'Result', 'Elo', 'Range'],
          rows: [
            ['AB-JChess vs PikaJieQi', '4 s a move', '400', '248-16-136', '+100', '+66 to +136'],
            ['jqe vs AB-JChess', '4 s a move', '100', '71-4-25', '+173', '+101 to +262'],
            ['jqe vs AB-JChess', '15 s a move', '50', '33-4-13', '+147', '+58 to +261'],
            ['jqe vs AB-JChess', '60 s + 0.6 s', '1,000', '701-24-275', '+158', '+136 to +181'],
            ['jqe vs PikaJieQi', '60 s + 0.6 s', '1,000', '761-20-219', '+211', '+187 to +236'],
          ],
          highlightRows: [1],
          keyColumn: true,
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: 'At 4 seconds a move jqe won both games of a deal 26 times out of 50, and AB-JChess did it 4 times. jqe scored 37 of 50 as Red and 36 as Black. At 15 seconds the margin was much the same. That matters because AB-JChess\'s lead over PikaJieQi did shrink with time in our earlier tests (from about +98 at 1 second a move to +40 at 4 seconds, with an earlier release of AB-JChess): the fast engine with hand-written rules gains more from extra time than the slow one with a network. jqe\'s lead over AB-JChess shows no sign of doing the same.',
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: 'The steps do not add up exactly. +100 and +173 would put jqe about 270 above PikaJieQi, and jqe\'s own match measured 211. The matches used different clocks, threads and referees, and an engine that beats a second one by a margin need not beat a third by the sum. The order is clear in every match. Every PikaJieQi in the table is the build from before the October 2 fix, which in our tests plays about as well as the fixed one.',
        },
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: `The rules were not quite jqe's own. Our referee draws any threefold repetition and any 60 moves without a capture, where jqe's own rules make a perpetual checker lose and draw after 40 moves without a capture. None of the 100 games at 4 seconds went 40 moves without a capture, and 4 games in each of our runs ended in repetition. Our match referee also shows a piece captured face-down to both engines, where on the site only its capturer learns what it was. Both engines saw the same thing, so neither gained from it. All 100 games at 4 seconds a move are in [a study](${JQE_STUDY}), and the 400 games of AB-JChess against PikaJieQi each have [their own review page](/games/search?variant=jieqi&source=engine-match).`,
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: `jqe is open source under the MIT licence at [github.com/devinokeefe/jieqi](${JQE_REPO}), with its network, its match records and the tools that recompute every number in its report. Thank you, Devin O'Keefe. AB-JChess is open source under the GPL-3.0 licence at [github.com/lxsgx23/AB-JChess](${AB_REPO}); thank you, Huorongrong and Laoxu.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
            { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
          ],
        },
      ],
    },
    {
      heading: 'Where the strength comes from',
      blocks: [
        // JQE: needs Devin's yes (s-3a3a)
        {
          kind: 'paragraph',
          text: "The order is jqe, then AB-JChess about 150 to 170 Elo behind it, then PikaJieQi about 100 behind that. The two steps came from different places. AB-JChess passed PikaJieQi with a better judge of positions: a large network in place of hand-written rules, at the cost of looking at far fewer positions. jqe passed AB-JChess with a network a fraction of the size, trained on a fraction of the data, and a search that looks at many more positions and averages its reveals without letting a cut-short score through. Its author puts most of its lead down to that search. His fix to the average gained him about 137 Elo, more than the 92 his first network gained over hand-written rules. In jieqi, how an engine prices the pieces it cannot see counts for at least as much as how well it judges the ones it can.",
        },
      ],
    },
  ],
};
