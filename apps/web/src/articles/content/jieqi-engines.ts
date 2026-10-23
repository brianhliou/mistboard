import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// DRAFT. Three jieqi engines side by side: PikaJieQi (Levels 1 to 8), AB-JChess
// and jqe (Devin O'Keefe's engine, the top jieqi bot since 2026-10-22, with his
// yes). The AB-JChess post covers that engine's arrival and two of its games, the
// reveal-bug post covers PikaJieQi's averaging bugs; this page links both and does
// not restate them.
//
// publishedAt: Brian dates it (Tuesday or Friday only, article-schedule.test.ts).
//
// Elo margins from separate matches do not chain: each row states its own match.
//
// Sources, refreshed 2026-10-22:
// - mistboard-engine lab/jieqi-match/jqe-vs-abj-0.2d/run1-4s-4thr.jsonl (the
//   match players meet today): 300 games, 150 colour-swapped deals, 4 s, 4 threads,
//   b = jqe. jqe 171-15-114, +67 pentanomial [+31, +104]; jqe won both games of a
//   deal 43 times, AB-JChess 19; 15 repetitions; one game (53) passed 80 plies
//   without a capture, won by jqe. Recomputed from the file and summarize.py.
// - lab/jieqi-match/abj-0.2d-vs-0.2b/run1-4s-4thr.jsonl: v0.2d 165-16-119 over 150
//   deals, +54 [+16, +93]. Smoke there: v0.2d 89.6k nps vs v0.2b 72.7k (1.23x).
// - lab/jieqi-abjchess-2026-09-29/README.md: run7, AB-JChess v0.2b vs PikaJieQi
//   248-136-16 at 4 s, 4 threads, +100 [+66, +136]; speeds at the start position
//   (31k vs 1.7M positions a second, 1 thread, the v0.2a build).
// - lab/jieqi-jqe-2026-10-16/README.md + summarize.py over run1-4s-4thr.jsonl and
//   run2-15s-4thr.jsonl (against v0.2b): jqe 71-4-25, +173 [+101, +262];
//   33-4-13, +147 [+58, +261].
// - jqe @ 331a6e61 (~/projects/tools/jqe-331a6e61): README.md (results table vs
//   v0.2b, net size), REPORT.md (chance nodes, network, formal results),
//   docs/DECISIONS.md D091 item 3 (30x the nodes of v0.2b; the gain is search),
//   THIRD_PARTY.md (PikaJieQi commit 6398d4c1, before the bcc83f88 reveal fix),
//   CHANGELOG.md (0.1.0, 2026-10-13), LICENSE (MIT). Net it014.jqn 1,547,356 bytes.
// - AB-JChess net file sizes: ~/projects/tools/AB-JChess/nets/abjchess-20261010.nnue
//   (v0.2d, 143,667,546 bytes; about 93x jqe's); the billion training positions
//   for the first net: ab-jchess.ts.
// - PikaJieQi's averaging and the fix: pikafish-reveal-bug.ts and pikafish-jieqi.ref.

const JQE_REPO = 'https://github.com/devinokeefe/jieqi';
const AB_REPO = 'https://github.com/lxsgx23/AB-JChess';
// @mistboard's public study of the 300 games against AB-JChess 0.2d at 4 s a move,
// one chapter a game ("jqe vs AB-JChess 0.2d: 300 games at 4 s a move"). The older
// 100-game study against 0.2b (R612nAlt) is unlisted; do not link it.
const JQE_STUDY = '/study/3RQbr51i';

// Text card (text-card.ts). No engine is named on it.
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
  title: 'Three jieqi engines, head to head',
  seoTitle: 'Jieqi engines compared: PikaJieQi, AB-JChess and jqe',
  summary:
    'How PikaJieQi, AB-JChess and jqe judge a face-down piece, what each evaluates positions with, and how they did against each other: jqe, the top jieqi bot on the site, beat AB-JChess 0.2d 171 to 114 over 300 games.',
  showSummaryOnPage: false,
  status: 'draft',
  thumbnail: { kind: 'svg', svg: JIEQI_ENGINES_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'Jieqi players and engine authors who want to know which engine is strongest and why.',
  readNext: ['ab-jchess', 'pikafish-reveal-bug', 'jieqi-platform'],
  tldr: [
    "jqe, an open-source engine by Devin O'Keefe, is the top jieqi bot on the site. Over 300 games against AB-JChess 0.2d, the release the site runs, it won 171, drew 15 and lost 114, a margin of about 67 Elo.",
    'AB-JChess 0.2d is a stronger release than the 0.2b we tested first: it beat 0.2b by about 54 Elo over 300 games. Each match is measured on its own, and the margins do not add up.',
    'All three engines treat moving a face-down piece as a gamble and average over what it could be. They differ in how carefully they take that average and in what judges the positions.',
    "jqe's network is about 90 times smaller than AB-JChess's. Most of its lead comes from its search.",
  ],
  intro: [
    {
      kind: 'paragraph',
      text: `We have now measured three [jieqi](/rules/jieqi) engines against each other. PikaJieQi is our build of Pikafish and plays Levels 1 to 8 here. [AB-JChess](/blog/ab-jchess) was the top bot on the site from early October and now plays one level below jqe. [jqe](${JQE_REPO}) is an engine by Devin O'Keefe, first released on October 13, and the top bot here since October 22.`,
    },
    {
      kind: 'paragraph',
      text: 'They finish in that order. This page asks how far apart they are and where the strength comes from: what each engine does when it moves a piece it has not seen, and what it judges a position with.',
    },
  ],
  sections: [
    {
      heading: 'One idea, three engines',
      blocks: [
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
          text: `**[AB-JChess](${AB_REPO})**, by Huorongrong and Laoxu (Kouza), is also built from Pikafish, but it judges positions with a neural network. Its first network was trained on about a billion jieqi positions; the one in release 0.2d, which the site runs, is a 144 MB file. In the same speed test the first release we tried looked at about 31,000 positions a second, more than fifty times fewer than PikaJieQi, and understood each one better. Release 0.2d is about a fifth faster than 0.2b.`,
        },
        {
          kind: 'paragraph',
          text: `**[jqe](${JQE_REPO})** is written from scratch, with no code from another engine. Its network is 1.5 MB, about 90 times smaller than AB-JChess's. It was trained only on jqe's own games: 82 million positions, each one labelled with jqe's own search score and the game's result, over rounds in which a new network replaced the old one only after beating it in a 400-game match. Its inputs include, besides the board, a count of every piece still face-down, so the network can see what a reveal might turn up. By its author's count jqe looks at about 30 times as many positions as AB-JChess 0.2b in the same time.`,
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
          text: 'PikaJieQi had this flaw and a second one, a colour mix-up that made Black\'s reveals take the best outcome where they meant to take the worst. We found both on October 2 and fixed them for the move the bot is choosing; [the reveal-bug post](/blog/pikafish-reveal-bug) has the details. Deeper in its search the old averaging is still there, because fixing it everywhere made the bot about 150 Elo weaker. The AB-JChess release we checked, built from the same code, has the bound flaw and not the colour one.',
        },
        {
          kind: 'paragraph',
          text: "jqe's author found the same bound flaw on his own and measured it. On 72 reveals jqe had played, the old way of averaging rated them too high by 0.021 in expected score, about two points in a hundred. His fix searches every possible piece six half-moves less deep with the window fully open, so each comes back with a real score, and searches the most numerous piece at full depth as well. That brought the error down to 0.009 while searching only 1.15 times as many positions. Against the old version of itself it gained about 137 Elo, and about 34 more for doing it at every reveal in the search along with three smaller changes. Doing the exact average at every reveal is the step that cost our bot 150.",
        },
      ],
    },
    {
      heading: 'Head to head',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We played our matches on the setup the site uses for its bots: 4 seconds a move, 4 threads each, on the same match referee. The one that matters today is jqe against AB-JChess 0.2d, the release the site runs: 150 deals, each played twice with colours swapped, so neither engine got the luck of a better deal. The other rows are earlier matches against AB-JChess 0.2b, which the site no longer runs. The last two are from jqe\'s own report, on his referee at a minute a game plus 0.6 seconds a move.',
        },
        {
          kind: 'table',
          caption:
            'Results for the first engine named: wins, draws, losses. The range is the 95% interval. The last two rows are from jqe\'s report.',
          headers: ['Match', 'Clock', 'Games', 'Result', 'Elo', 'Range'],
          rows: [
            ['jqe vs AB-JChess 0.2d', '4 s a move', '300', '171-15-114', '+67', '+31 to +104'],
            ['AB-JChess 0.2d vs 0.2b', '4 s a move', '300', '165-16-119', '+54', '+16 to +93'],
            ['jqe vs AB-JChess 0.2b', '4 s a move', '100', '71-4-25', '+173', '+101 to +262'],
            ['jqe vs AB-JChess 0.2b', '15 s a move', '50', '33-4-13', '+147', '+58 to +261'],
            ['AB-JChess 0.2b vs PikaJieQi', '4 s a move', '400', '248-16-136', '+100', '+66 to +136'],
            ['jqe vs AB-JChess 0.2b', '60 s + 0.6 s', '1,000', '701-24-275', '+158', '+136 to +181'],
            ['jqe vs PikaJieQi', '60 s + 0.6 s', '1,000', '761-20-219', '+211', '+187 to +236'],
          ],
          highlightRows: [0],
          keyColumn: true,
        },
        {
          kind: 'paragraph',
          text: 'Against AB-JChess 0.2d, jqe won both games of a deal 43 times, and AB-JChess did it 19 times. Release 0.2d is the stronger AB-JChess, and jqe\'s lead over it is smaller than its lead over 0.2b was. Against 0.2b the margin held at 15 seconds a move, so more time did not close it.',
        },
        {
          kind: 'paragraph',
          text: 'Each row is its own match, on its own deals and settings, and the margins do not add up to give a third. We have not played AB-JChess 0.2d against PikaJieQi. The order is the same in every match. Every PikaJieQi in the table is the build from before the October 2 fix, which in our tests plays about as well as the fixed one.',
        },
        {
          kind: 'paragraph',
          text: `The rules were not quite jqe's own. Our referee draws any threefold repetition and any 60 moves without a capture, where jqe's own rules make a perpetual checker lose and draw after 40 moves without a capture. Of the 300 games against 0.2d, 15 ended in repetition, and one went past 40 moves without a capture before jqe won it. Our match referee also shows a piece captured face-down to both engines, where on the site only its capturer learns what it was. Both engines saw the same thing, so neither gained from it. All 300 games against 0.2d are in [a study](${JQE_STUDY}), and the 400 games of AB-JChess against PikaJieQi each have [their own review page](/games/search?variant=jieqi&source=engine-match).`,
        },
      ],
    },
    {
      heading: 'Where the strength comes from',
      blocks: [
        {
          kind: 'paragraph',
          text: "On the site today the order is jqe, then AB-JChess 0.2d, which lost to it by about 67 Elo, then PikaJieQi, which lost to the older AB-JChess 0.2b by about 100. The two steps came from different places. AB-JChess passed PikaJieQi with a better judge of positions: a large network in place of hand-written rules, at the cost of looking at far fewer positions. jqe passed AB-JChess with a network a fraction of the size and a search that looks at many more positions and averages its reveals without letting a cut-short score through. Its author puts most of its lead down to that search. His fix to the average gained him about 137 Elo, more than the 92 his first network gained over hand-written rules. In jieqi, how an engine prices the pieces it cannot see counts for at least as much as how well it judges the ones it can.",
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `jqe is open source under the MIT licence at [github.com/devinokeefe/jieqi](${JQE_REPO}), with its network, its match records and the tools that recompute every number in its report. Thank you, Devin O'Keefe. AB-JChess is open source under the GPL-3.0 licence at [github.com/lxsgx23/AB-JChess](${AB_REPO}); thank you, Huorongrong and Laoxu.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play jqe', href: '/bot/jqe', emphasis: 'primary' },
            { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
