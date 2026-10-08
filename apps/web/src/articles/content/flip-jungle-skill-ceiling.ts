import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';

// Folded in from the brianhliou.com post of 2026-07-02 ("Flip Jungle: 512×
// More Search Still Loses 23% of the Time"), which 301s here. Numbers are the
// post's. The position counts in the solve table recompute as C(16,k) piece
// sets × 16!/(16-k)! placements, halved by colour symmetry and doubled by side
// to move: 28,800 / 1.88M / 79.5M / 2.29B / 46.2B. The ladder steps
// (+89, +64, +89) are its differences. Dropped from the post: the capture-order
// graphic (the rules page has it), the parallel tablebase build, and the
// five-game replay viewer (its games are not in the site's format; the rules
// page's twenty-game study stands in for it).
const FLIP_JUNGLE_SKILL_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'jungle',
      eyebrow: 'FLIP JUNGLE',
      lead: 'SKILL CEILING',
      tagline: '512× THE SEARCH, 23% LOST',
      ariaLabel: 'A card reading Flip Jungle, skill ceiling: 512 times the search still loses 23% of games',
    },
    locale,
  );

const PLAY_HREF = '/?play=computer&gameSpecId=jungle-flip';

export const flipJungleSkillCeilingArticle: Article = {
  slug: 'flip-jungle-skill-ceiling',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Flip Jungle: 512 times the search still loses 23% of games',
  cardTitle: "Flip Jungle's skill ceiling",
  seoTitle: 'Flip Jungle skill vs luck: 512× more search still loses 23% of games',
  summary:
    'Flip Jungle is 4×4 Jungle Chess with every animal face-down. A near-perfect engine shows how much skill survives the flips: 512 times the search buys about 242 Elo and still loses 23% of its games.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-07-02',
  updatedAt: '2026-10-07',
  thumbnail: { kind: 'svg', svg: FLIP_JUNGLE_SKILL_THUMBNAIL },
  audience: 'People who play Flip Jungle on Mistboard and wonder how much of a game is luck.',
  readNext: ['skill-vs-luck', 'katago-jungle'],
  intro: [
    {
      kind: 'paragraph',
      text: '[Flip Jungle](/rules/jungle-flip) is Jungle Chess on a 4×4 board with all sixteen animals face-down. Each turn you flip a tile, which reveals a random animal, or move a face-up animal one square. MistyJungleFlip, the bot you play here, picks the optimal move 99 to 100% of the time in the endgames that can be checked exactly. That makes it a measuring instrument for the question every flip game raises: how much of a game is skill, and how much is the flips?',
    },
    {
      kind: 'paragraph',
      text: 'Less skill than it feels like. A copy of the engine with 512 times more search still loses 23% of its games against the weaker one.',
    },
    {
      kind: 'table',
      keyColumn: true,
      wrap: true,
      headers: ['Measure', 'Result'],
      rows: [
        ['Search ladder, 1k to 512k nodes', '242 Elo across a 512× range'],
        ['512× more search', 'loses 23% of games'],
        ['8× more search', 'loses 37 to 40%'],
        ['Any search against random moves', 'about 99% (random won 0 of 800)'],
        ['Endgames, 5 pieces or fewer, against exact tablebases', '99 to 100% optimal'],
        ['Midgames, 5 to 6 pieces, against an exact solver', '200 of 200 moves optimal'],
      ],
    },
  ],
  sections: [
    {
      heading: 'A search engine with exact endgames',
      blocks: [
        {
          kind: 'paragraph',
          text: 'MistyJungleFlip is alpha-beta search with a handwritten evaluation and no neural network: material plus mobility, with a small term against draws. Its strength is set by a node budget, not a clock, so the same position gets the same move on any machine, and a measured gap belongs to the engine rather than the hardware.',
        },
        {
          kind: 'paragraph',
          text: 'A flip is a chance node. Its value is the average over the animals still face-down, pruned with star-minimax, the chance-node form of alpha-beta. Endgames come from exact tablebases instead, solved backward from every finished position. Each entry stores the result under best play and the distance to it.',
        },
      ],
    },
    {
      heading: 'Checked against exact answers where they exist',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Self-play shows which of two versions is stronger, not whether either plays well: two copies of one engine share the same blind spots. So move quality is graded against the tablebases. In endgames of up to five pieces the engine played the optimal move 99 to 100% of the time; the misses were search depth, and a deeper search cleared them. A forward solver built on the tablebases reaches five- and six-piece midgames with tiles still face-down, and on 200 of those the engine matched the optimal move every time.',
        },
        {
          kind: 'paragraph',
          text: 'That coverage stops where exact computation stops, near the end of the game. The opening, where the flips happen, is too large to solve, so nothing here verifies the engine’s opening play.',
        },
      ],
    },
    {
      heading: '512 times the search buys about 242 Elo',
      blocks: [
        {
          kind: 'paragraph',
          text: 'To measure the opening without an exact answer, four copies searching 1k, 8k, 64k and 512k nodes a move played a round robin of paired, colour-swapped games, 120 per pairing. Their fitted ratings were +0, +89, +153 and +242. Each eightfold step is worth 64 to 89 Elo, and the ladder flattens at the top: 320k to 640k nodes was worth 6 Elo. In chess, 512 times the compute is worth several hundred.',
        },
        {
          kind: 'paragraph',
          text: 'Upsets are more common than the ratings suggest. An engine with 8 times the search loses 37 to 40% of its games; one with 512 times loses 23%. The flips decide enough games on their own that more search cannot close the gap.',
        },
        {
          kind: 'paragraph',
          text: 'The one big step is at the bottom. A 1k-node search beats a random mover about 99% of the time (random won 0 of 800 games across the tiers), a gap near 850 Elo. About 80% of the distance from random to perfect is that single step, from moving at random to searching at all. Tuning the evaluation did nothing: better piece values, a rat-and-elephant term and draw aversion all came back flat in paired self-play.',
        },
      ],
    },
    {
      heading: 'Perfect play against perfect play is a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Small versions of the game can be solved outright. With two and four pieces, every tile face-down at the start and played to the end under the full rules, the game is a draw under best play: two perfect players cannot beat each other. Solving even a six-piece game from the opening crosses 40 million distinct positions, the same wall that keeps the sixteen-piece game out of reach, so the full game is unproven.',
        },
        {
          kind: 'paragraph',
          text: 'That still places the 23%. Perfect against perfect is a draw. Perfect against a much weaker player is a near-certain win: the random mover lost all 800 of its games. Two close players sit in between, with the gap inside the variance and the flips deciding.',
        },
      ],
    },
    {
      heading: 'How far the tablebases go',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The tables cover every fully revealed position at each piece count and ignore the 40-half-move no-progress rule.',
        },
        {
          kind: 'table',
          compact: true,
          headers: ['Pieces', 'Positions', 'Longest forced win', 'Build'],
          rows: [
            ['2', '28,800', '9 plies', 'instant'],
            ['3', '1.9M', '21 plies', '2 s'],
            ['4', '79M', '41 plies', '200 s'],
            ['5', '2.3B', '63 plies', '4 hr on a laptop, 2.8 GB'],
            ['6', '46B', 'unbuilt', 'days, ~140 GB of RAM'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Six pieces could be built on a rented server and would add nothing: five-piece coverage already grades every endgame that reaches the tables. Past that, a full solve means the opening, a flip tree of sixteen distinct pieces revealed in random order, with on the order of 10¹¹ or more reachable states.',
        },
        {
          kind: 'paragraph',
          text: 'The distance column was not in the first tables. They stored win, draw or loss, which is enough to grade moves but not to finish games. In one self-play game the engine held a tiger and a rat against a lone elephant, a forced win (the rat traps the elephant in three plies, since an elephant cannot take a rat). For eight turns it played moves the tables graded optimal and made no progress, because every winning move scored the same, until repetition drew the game. With the distance stored, a win in 3 outranks a win in 9: the engine takes the shortest forced win, drags out forced losses, and that endgame ends with the rat taking the elephant in three. Chess endgame tables such as Syzygy carry a distance for the same reason.',
        },
      ],
    },
    {
      heading: 'Skill shows in the average, not the game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Skill is real in Flip Jungle: the 242-Elo ladder is a real gap, and over a long match the stronger engine wins. But the deal and the flips decide a large share of any one game, so even a far stronger player loses often, and one result says little about who is better. The measurement still missing is a rating against a strong human player, the one test that does not lean on the engine or its solver.',
        },
        {
          kind: 'paragraph',
          text: 'Our [game review](/blog/skill-vs-luck) splits each flip into the decision and the luck, so you can see which share of your own games was which. The [twenty engine games](/study/uKxJ60mN) from the rules page show the bot playing itself, and the engine’s source is [on GitHub](https://github.com/brianhliou/misty-flip-jungle).',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play MistyJungleFlip', href: PLAY_HREF, emphasis: 'primary' },
            { label: 'Flip Jungle rules', href: '/rules/jungle-flip', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
