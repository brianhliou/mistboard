import { JUNGLE_RANK_LADDER, playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Moved from the brianhliou.com post of 2026-06-27 (/posts/building-dou-shou-qi-engine/,
// "A Dou Shou Qi (Jungle Chess) Engine: Classical Search Beat the Learned Eval")
// on 2026-10-16, text unchanged except what the move required: site links made
// relative, the capture-order strip drawn with the rules page's rank ladder, the
// three rule bullets as paragraphs, the Data section's three subsections promoted
// to sections, the two dated notes as note blocks, and Tencent's game portal named
// in English. The six boards were already this site's study embeds (study
// xzzhAld5, same chapters and plies).

const STUDY_ID = 'xzzhAld5';

function game(chapter: string, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${STUDY_ID}/${chapter}?ply=${ply}`,
    title,
    // Width-bound at the 702px column, as the rules page's jungle embed.
    aspect: [702, 780],
  };
}

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

export const douShouQiEngineArticle: Article = {
  slug: 'dou-shou-qi-engine',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'A Dou Shou Qi (Jungle Chess) Engine: Classical Search Beat the Learned Eval',
  cardTitle: 'A Dou Shou Qi Engine',
  summary:
    "Building an engine for Jungle, also called Animal Chess: alpha-beta search and a hand-written evaluation went 11-2 with 187 draws against the strongest open-source engine I could run. A learned evaluation and a tablebase didn't help.",
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-27',
  updatedAt: '2026-10-16',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/dou-shou-qi-engine/thumbnail.png',
    alt: 'A Jungle Chess board in mid-game, red and black animals around the two rivers.',
  },
  audience:
    'Engine builders and Jungle Chess players curious how a classical search engine measures up, and where learned evaluation and tablebases stop helping.',
  readNext: ['katago-jungle', 'jungle-den-term', 'mistybanqi'],
  tldr: [
    'MistyJungle, a classical Rust engine for Dou Shou Qi (Jungle), scored W11-L2-D187 against the strongest open-source engine I could run, about +16 Elo.',
    'It matched exact four-piece tablebases on 779 of 800 positions with no win/draw/loss mistakes.',
    "The two upgrades I expected to help didn't: a learned eval never beat the hand eval, and a tablebase at the search leaf cost about 13 Elo.",
    'Published endgame databases stop at four pieces, and the full game is likely to stay unsolved.',
  ],
  intro: [
    p(
      'I built MistyJungle, a classical Rust engine for Dou Shou Qi, the 7×9 board game usually called Jungle or Animal Chess. You can [play MistyJungle on Mistboard](/?play=computer&gameSpecId=jungle). It uses alpha-beta search, a handcrafted evaluation, repetition handling, and no neural network in the playing version.',
    ),
    {
      kind: 'note',
      text: "Updated October 7: MistyJungle is no longer Mistboard's strongest jungle bot. In September [KataGo-AnimalChess](/blog/katago-jungle), a self-play net, beat it 82-0 with 118 draws over 200 games and took the top seat; MistyJungle is now the easier bot below it.",
    },
    p(
      'The result is narrow but real. Against the strongest open-source engine I could run, it scored W11-L2-D187 over 200 games, about +16 Elo in a drawish game, and its four-piece endgame play matched exact tablebases with no win/draw/loss mistakes. The two upgrades I expected to help, a learned eval and a tablebase at the search leaf, did not. Classical search did the work.',
    ),
  ],
  sections: [
    {
      heading: 'What I built',
      blocks: [
        p(
          'A standalone Rust engine with a small UCI-style protocol, usable from the command line or from Python via PyO3. Strength is a **node budget, not a clock**, so the same position returns the same move on any machine.',
        ),
        p(
          'The stack is conventional: negamax alpha-beta with iterative deepening, a Zobrist transposition table, quiescence on captures and den-entries, and killer/history move ordering with PVS and late-move reductions, over a handcrafted evaluation that scores material, distance to the enemy den, traps, water, and mobility. That ordering-and-pruning polish was worth a measured +49 Elo at a fixed node budget.',
        ),
        p(
          'The eval has to be exact before a learned correction can add anything. Dou Shou Qi is material-heavy but full of sharp exceptions: a rat stops an elephant, a trapped piece loses its rank, one step into the den ends the game.',
        ),
      ],
    },
    {
      heading: 'Specs',
      blocks: [
        p(
          "Each side has eight animals on a 7×9 board, and you win by stepping into the opponent's den or capturing every piece. The rules vary by region, so the exact set matters. I used the Mistboard rules as of June 2026, where wolf outranks dog (some sources swap them). One of those rules has since changed: the tiger jumped the river lengthwise only, a reading that comes from English Wikipedia, while the Chinese rule sets (Tencent's QQ Games, Leiden's page) give the tiger the same leap as the lion. Mistboard and MistyJungle 0.0.6 switched to the Chinese rule in September 2026; the games in this post were played under the old one.",
        ),
        {
          kind: 'raw-svg',
          svg: JUNGLE_RANK_LADDER,
          caption:
            "Capture order, strongest to weakest. Each animal captures to the right. The rat also captures the elephant. A piece in the opponent's trap counts as rank zero.",
        },
        p('Beyond plain capture-by-rank, three rules give the game its tactics:'),
        p(
          '**Rat beats elephant, but only on land.** The weakest piece captures the strongest. Captures can’t cross the bank, though, so a rat that swims into the water is safe from everything except another rat.',
        ),
        p(
          '**Lions and tigers jump the rivers.** Only the rat may enter the water. The big cats instead leap a whole river to the far bank, sideways or lengthwise, unless a rat sits in the water and blocks the jump.',
        ),
        p(
          '**A trapped piece loses its rank.** The three squares around each den are traps. An enemy piece standing on one drops to rank zero, so anything, even a rat, can capture it.',
        ),
        p('Full rules with a playable board: [Jungle Chess rules](/rules/jungle).'),
      ],
    },
    {
      heading: 'Results',
      blocks: [
        p('A small edge in a game where strong engines draw most of their games:'),
        {
          kind: 'table',
          headers: ['Test', 'Result'],
          rows: [
            ['Open-source benchmark, 200 games', 'W11-L2-D187, about **+16 Elo**'],
            ['Search polish (ordering, PVS, LMR)', '**+49 Elo**, paired self-play, p = 0.008'],
            ['Four-piece tablebase check', '779/800 matched, **0 WDL contradictions**'],
            ['Five and six pieces', '**>99%** vs an 8x deeper search (proxy, not proof)'],
            ['Tablebase at the search leaf', 'W37-L40-D3, about **-13 Elo**'],
            ['Residual neural eval', 'best about **-70 Elo**'],
          ],
          keyColumn: true,
          wrap: true,
        },
        p(
          'The +49 was the hard one to measure. Two even Jungle engines draw too much for a win-rate gate, so I used paired, color-swapped self-play (every opening played both ways, new search against old) and a sign test on the decisive games.',
        ),
      ],
    },
    {
      heading: 'Endgames and the state of the solve',
      blocks: [
        p(
          'Small endgames yield to retrograde analysis, and they make excellent judges. Van Rijn and Vis solved four pieces at Leiden in 2013 (under the Leiden convention, which swaps dog and wolf), and I can find nothing larger published since. My engine matched exact four-piece play on 779 of 800 positions with no WDL contradictions, and tracked an 8x deeper search above 99% at five and six pieces.',
        ),
        p(
          'That four-piece database is still the frontier, and the wall past it is storage, not solving technique. The board is the problem: 63 squares against the 16 of [Flip Jungle](/blog/flip-jungle-skill-ceiling), so each added piece has some 60 empty squares to stand on instead of a dozen, and the level sizes grow about five times faster. Five Flip Jungle pieces fit in 2.8 GB on my laptop; five Dou Shou Qi pieces run to roughly 7 TB. Eight pieces and up, half the starting material, is out of reach as a database, and nobody has a forward proof of the full sixteen-piece game either. Dou Shou Qi is solved to four pieces and open above it, and likely to stay that way.',
        ),
        {
          kind: 'note',
          text: 'Corrected 27 September 2026: an earlier version put the frontier at seven pieces. That figure came from a citation in a 2019 paper, which on inspection points to a Leiden thesis on Jungle Checkers, a different game.',
        },
        p(
          "A tablebase loaded at the search leaf also added nothing to playing strength (about -13 Elo): search already finds the answer at the sizes that fit, and the sizes where it would help don't ship. One caveat from the Flip Jungle build, where the same experiment first read as null and later turned out to be hiding a bug: those tables stored win/draw/loss with no distance, and a WDL-only leaf lets the engine hold a won endgame forever without finishing it, since every winning move grades the same. Adding distance-to-mate to the tables fixed the finishing there. My Jungle leaf probe was WDL-only too, so some of that -13 may be the same effect rather than tablebases being useless at the leaf. Untested; the classical engine ships without the probe either way.",
        ),
      ],
    },
    {
      heading: 'Learned eval',
      blocks: [
        p(
          'This stalled on data, not architecture. A residual net (the handcrafted score plus a bounded correction) climbed from -470 to about -70 Elo as I fixed the labels, but never beat the hand eval. The labels were weakest exactly where the net needed help: draw-heavy self-play underrepresents material swings, exact tablebase labels only cover small endgames, and search-score labels mostly teach the net to imitate the search it already has.',
        ),
      ],
    },
    {
      heading: 'AlphaZero',
      blocks: [
        p(
          'Still open work. I did not run a full Jungle AZ climb. The adjacent Banqi AZ de-risk failed its gate, but that is a different game and does not falsify AZ for Jungle, which is friendlier ground: deterministic and perfect-information, with no chance-node reveal. I parked it because the cheap rung was negative and the classical engine already beat the benchmark.',
        ),
      ],
    },
    {
      heading: 'Example games',
      blocks: [
        p(
          `The match was mostly draws, but the decisive games show the shape of the edge: den pressure first, material second. The boards open near the conversion, so step back for the opening; all six are in a [study on Mistboard](/study/${STUDY_ID}). They were played under the lengthwise-only tiger rule Mistboard used until September 2026.`,
        ),
        p('MistyJungle (black) builds a material lead and finishes with a lion in red’s den:'),
        game('QP3lG9Cf', 88, "MistyJungle (black) wins, a lion in red's den"),
        p('Another black win, a shorter squeeze where the last piece reaches d1 after exchanges around the trap:'),
        game('eYlv81WI', 64, 'MistyJungle (black) reaches the den after an 80-ply squeeze'),
        p('A red win that shows why you can’t just count material: MistyJungle loses material but wins the den race:'),
        game('PqrytU1I', 44, 'MistyJungle (red) wins the den race down material'),
        p('The longest saved win, red grinding through 283 plies before reaching the den:'),
        game('lbGFBE2I', 258, 'MistyJungle (red) grinds out a 283-ply win'),
        p(
          'The engine against itself at 8M nodes a move, about five seconds each: a long even fight where red nurses a one-piece edge for forty moves, then converts and walks a lion into black’s den:',
        ),
        game('g9mzWSN8', 0, 'MistyJungle against itself at 8M nodes: a one-piece edge converted'),
        p(
          'More dramatic still, also a mirror game at 8M nodes: red lets black keep the elephant, lion, and tiger, falls sixteen points behind in material, and wins anyway by racing a rat into the den before that material can matter. The clearest statement of what the engine is actually optimizing:',
        ),
        game('PKXarVfT', 70, "MistyJungle against itself at 8M nodes: down sixteen, red's rat reaches the den first"),
      ],
    },
    {
      heading: 'Conclusion',
      blocks: [
        p(
          'MistyJungle is a classical search engine with a narrow, measured edge over the strongest open-source engine I could run. The work that moved strength was unglamorous: correct rules, fixed-budget measurement, color-swapped tests, search polish, and endgame validation. Tablebases judged well but did not help at the leaf, the first neural rung lost to the hand eval, and a real AlphaZero climb is still open work.',
        ),
        p(
          '[misty-jungle](https://github.com/brianhliou/misty-jungle) is the engine, in Rust. [Layheng-Hok/Jungle-Chess](https://github.com/Layheng-Hok/Jungle-Chess) is the open-source engine I used as the fixed benchmark. [Bagheera](https://liacs.leidenuniv.nl/~visjk/doushouqi/) is Leiden’s closed-source engine and the endgame tablebases I graded against. More in the engine series: [MistyBanqi](/blog/mistybanqi), the same measurement discipline on Chinese Dark Chess.',
        ),
      ],
    },
    playClosing({
      heading: 'Play it',
      lead: 'MistyJungle is on Mistboard as the easier of the two jungle bots. Take it on, or read its source.',
      playLabel: 'Play MistyJungle',
      playHref: '/?play=computer&gameSpecId=jungle',
      secondary: [
        {
          label: 'misty-jungle on GitHub',
          href: 'https://github.com/brianhliou/misty-jungle',
          emphasis: 'secondary',
          external: true,
        },
        { label: 'Jungle Chess Rules', href: '/rules/jungle', emphasis: 'secondary' },
      ],
    }),
  ],
};
