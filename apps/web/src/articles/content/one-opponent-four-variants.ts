import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';

const THUMBNAIL = (locale: Parameters<typeof textCard>[1]): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'CORRESPONDENCE',
      lead: 'ONE OPPONENT',
      tagline: 'FOUR VARIANTS',
      ariaLabel: 'A card reading one opponent, four variants',
    },
    locale,
  );

// The four games as @mistboard studies, one per variant (a study holds one
// variant), made by scripts/variant-lab/rebirthfox-annotated-studies.ts from
// rebirthfox-games.json. These ids are the LOCAL database's: the prod studies
// are created with the same script and study:edit --apply on Brian's yes, and
// these ids replaced then. Rewrite the trees with the script's --update mode,
// never by hand.
export const REBIRTHFOX_STUDIES = {
  fog: { id: '888gXTxO', chapter: 'CCAS8FFK' },
  banqi: { id: 'LGHoQ8Yv', chapter: 'PWAvb6AJ' },
  jieqi: { id: 'GoP84icD', chapter: 'crwc0UnD' },
  duck: { id: 'jKxR8HZJ', chapter: 'nJA9yhB6' },
} as const;

function gameEmbed(game: keyof typeof REBIRTHFOX_STUDIES, ply: number, title: string): ArticleBlock {
  const study = REBIRTHFOX_STUDIES[game];
  return {
    kind: 'embed',
    path: `/embed/study/${study.id}/${study.chapter}?ply=${ply}`,
    title,
    aspect: [702, 780],
  };
}

export const oneOpponentFourVariantsArticle: Article = {
  slug: 'one-opponent-four-variants',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Won the fog game, lost the other three: four variants against one opponent',
  seoTitle: 'Fog Xiangqi, banqi, jieqi and Duck Xiangqi: four games against one opponent',
  summary:
    'Correspondence games against one player in Fog Xiangqi, banqi, jieqi and Duck Xiangqi, with every move scored by the engine.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-20',
  thumbnail: { kind: 'svg', svg: THUMBNAIL },
  boardFamily: 'xiangqi',
  homeRow: 'deep-dives',
  game: 'xiangqi',
  audience: 'Xiangqi players curious about the variants, and anyone who plays more than one of them.',
  tldr: [
    '@rebirthfox333 and I played four correspondence games at once, one in each of Fog Xiangqi, banqi, jieqi and Duck Xiangqi.',
    "Every board below steps through the game with the engine's marks and score chart, and in banqi and jieqi it splits each flip into choice and luck.",
  ],
  intro: [
    {
      kind: 'paragraph',
      text: "On October 8, @rebirthfox333 and I started four correspondence games at once, one day a move, each in a different variant. I won the first and lost the other three. Each board is a study you can step through, with the engine's marks (?!, ? and ??), its lines and its score chart. A few notes follow each one.",
    },
  ],
  sections: [
    {
      heading: 'Fog Xiangqi: the chariot the fog hid',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In [Fog Xiangqi](/rules/fog-xiangqi) each side sees only the points its own pieces can reach, and the game ends when a general is taken. I was Black.',
        },
        gameEmbed('fog', 11, 'Fog Xiangqi, @rebirthfox333 vs @brianhliou-dev, annotated'),
        {
          kind: 'paragraph',
          text: "Red's sixth move decided it: the chariot went to a point my horse guarded from under the fog, and the horse took it. The engine sees the whole board, so its marks show what a move cost, not what either of us could see. Not all of mine have that excuse: on my first two moves my cannon could have taken a horse in plain view.",
        },
      ],
    },
    {
      heading: 'Banqi: the flips that dealt the game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In [banqi](/rules/banqi) all 32 pieces start face down on half a board. A turn is a flip or a move, and the first flip decides the colours. Mine turned up a black elephant.',
        },
        gameEmbed('banqi', 15, 'Banqi, @brianhliou-dev vs @rebirthfox333, annotated'),
        {
          kind: 'paragraph',
          text: "The board grades each flip twice: once for the choice to flip, once for what came up ([how that works](/blog/skill-vs-luck)). One flip went badly for me, a red cannon that took my cannon on the next move. But over the game my choices cost me more than the luck did, and I flipped 19 times to rebirthfox's 10.",
        },
      ],
    },
    {
      heading: 'Jieqi: the chariot move and the face-down recapture',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In [jieqi](/rules/jieqi) every piece but the generals starts face down, moves as the piece whose home point it stands on, and turns face up once it moves.',
        },
        gameEmbed('jieqi', 44, 'Jieqi, @rebirthfox333 vs @brianhliou-dev, annotated'),
        {
          kind: 'paragraph',
          text: "It was level until move 22, when my chariot went to f3 and the engine had me losing; f2 would have held. Red took back with a face-down piece, which turned out to be an elephant, and went on to mate me.",
        },
      ],
    },
    {
      heading: 'Duck Xiangqi: the endgame lost by waiting',
      blocks: [
        {
          kind: 'paragraph',
          text: "In [Duck Xiangqi](/rules/duck-xiangqi) every turn is a move and then a duck placement on an empty point, which blocks it for both sides. The game is won by taking the general.",
        },
        gameEmbed('duck', 96, 'Duck Xiangqi, @rebirthfox333 vs @brianhliou-dev, annotated'),
        {
          kind: 'paragraph',
          text: "I was ahead until move 20, when I left my horse where Red's chariot could take it. In the endgame I shuffled my general back and forth while Red's soldiers crossed the river, and Red went on to win.",
        },
        {
          kind: 'note',
          label: 'Why the chart is smoothed',
          text: 'The duck engine scores a position about 10 points better for whichever side is to move, so its raw numbers zigzag every turn. The chart averages each position with the one before, and each move is graded against the same player\'s next turn.',
        },
        {
          kind: 'paragraph',
          text: 'Congratulations to @rebirthfox333 on winning the match 3-1, and thanks for the games.',
        },
      ],
    },
  ],
};
