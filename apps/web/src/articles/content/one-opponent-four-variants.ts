// NAMING: Brian is asking @rebirthfox333 whether to be named or anonymised; the handle stays until they answer.
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

// Three of the games as @mistboard studies, one per variant (a study holds one
// variant), made by scripts/variant-lab/rebirthfox-annotated-studies.ts from
// rebirthfox-games.json. These ids are the LOCAL database's: the prod studies
// are created with the same script and study:edit --apply on Brian's yes, and
// these ids replaced then. Rewrite the trees with the script's --update mode,
// never by hand. The script builds a fog study too, but the study embed card
// cannot frame a dark-xiangqi chapter yet (CHAPTER_EMBED_VARIANTS), so the fog
// board is the finished game itself, shown from Red's side.
const FOG_ROOM_ID = 'dxq_cfa3ee3a-a688-4338-a626-e6c923b65bbb';

export const REBIRTHFOX_STUDIES = {
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
  title: 'One opponent, four variants',
  seoTitle: 'Fog Xiangqi, banqi, jieqi and Duck Xiangqi: four games against one opponent',
  summary:
    'Four correspondence games against the same player, one in each of four xiangqi variants. Each turned at one moment, and each moment came from what that variant changes.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-10-27',
  thumbnail: { kind: 'svg', svg: THUMBNAIL },
  boardFamily: 'xiangqi',
  homeRow: 'deep-dives',
  audience: 'Xiangqi players curious about the variants, and anyone who plays more than one of them.',
  tldr: [
    'In Fog Xiangqi my opponent put a chariot on a square my horse guarded. The horse was under the fog. I won that game, and it is the board here that turned on their move rather than mine.',
    'In banqi a flip the engine itself would have made turned up the piece that cost me the game. Over the game, though, my own choices of what to flip cost me more than the draw did.',
    'In jieqi one chariot move took me from level to losing, and a face-down piece recaptured, moving as an elephant and turning out to be one.',
    'In Duck Xiangqi I was well ahead in the middlegame, gave most of it back, then moved my general back and forth thirteen times while my opponent brought soldiers across.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'On October 8, @rebirthfox333 and I started four correspondence games at once, one day a move, each in a different variant: [Fog Xiangqi](/rules/fog-xiangqi), [banqi](/rules/banqi), [jieqi](/rules/jieqi) and [Duck Xiangqi](/rules/duck-xiangqi). I won the first and lost the other three. The last one finished on October 14.',
    },
    {
      kind: 'paragraph',
      text: 'Four games at once against one person makes a fair comparison: the same two players, the same week, the same pace. Each game turned at one moment, and each moment came from the thing that makes that variant different from xiangqi: pieces you cannot see, a random deal, pieces that only show what they are once they move, and a duck that blocks a square every turn.',
    },
    {
      kind: 'paragraph',
      text: "I scored every position again with the engine the site uses for that variant, with longer searches at the moments that mattered. Each board below can be stepped through. The banqi, jieqi and Duck Xiangqi boards are studies, where the marks (?!, ? and ??) and the alternative lines are the engine's, and most of the marks are on my moves. The Fog Xiangqi board is the game itself, opening on Red's view; the buttons above it switch to Black's view or to the board with nothing hidden.",
    },
  ],
  sections: [
    {
      heading: 'Fog Xiangqi: the chariot the fog hid',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In Fog Xiangqi each side sees only the squares its own pieces can reach. There is no check, since you may not know you are in it: the game ends when a general is taken.',
        },
        {
          kind: 'paragraph',
          text: "I was Black, and I started badly. On my first move, Red's horse stood on h1, in my view, where my cannon on h8 could take it by jumping over the cannon on h3. I did not take it. On my second move it was still there and I missed it again; the engine marks that one ?? and puts my expected score down from 55% to 23%. The engine sees the whole board, which neither of us could, so its numbers say what a move cost, not what its player could have known. Here I could have known.",
        },
        {
          kind: 'paragraph',
          text: "Red's sixth move decided the game. The chariot went from d2 to d9, deep in my half. Red could see black pieces on d10, e7 and e8, and no others; the board below opens on that view. My horse on b10 guards d9, and it was under the fog. The horse took the chariot. Red's expected score went from 58% to 9% and never rose above 9% again.",
        },
        {
          kind: 'embed',
          // pov=white is the first mover's view: Red's fog, as Red saw it.
          path: `/embed/game/${FOG_ROOM_ID}?ply=11&pov=white`,
          title: "Fog Xiangqi, @rebirthfox333 vs @brianhliou-dev, from Red's side",
          aspect: [702, 780],
        },
        {
          kind: 'paragraph',
          text: "The finish was the same idea. My cannon came to e1 unseen, and on the next move it jumped the advisor on e2 to take the general on e3. This board turned on my opponent's move, and it was not a careless one. Red could not see the horse. A move onto a square you cannot see is a guess, and d9 was a bad square to guess on.",
        },
      ],
    },
    {
      heading: 'Banqi: the flips that dealt the game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Banqi is played on half a xiangqi board with all 32 pieces face down. Each turn is a flip or a move of a face-up piece, and the first flip decides the colours. I flipped first, turned up a black elephant, and so played Black. Captures go by rank, with two exceptions that matter here: a cannon captures by jumping exactly one piece, face up or face down, and a soldier can take a general.',
        },
        {
          kind: 'paragraph',
          text: 'Banqi is the variant where luck is loudest, so the question is how much of the loss was luck. The engine can separate the two, the way [our piece on skill and luck](/blog/skill-vs-luck) does: a flip is graded on its average over every piece it could turn up, before it turns, and whatever the draw then gives or takes is luck.',
        },
        {
          kind: 'paragraph',
          text: "My eighth turn is the luck. I flipped e1, which was the engine's own choice, at an expected score of 48%. It turned up a red cannon, on the same rank as my cannon on g1 with one face-down tile between them, and it took my cannon on the next move. My expected score fell to 27%. The flip cost nothing by choice; all 21 points were the draw.",
        },
        gameEmbed('banqi', 15, 'Banqi, @brianhliou-dev vs @rebirthfox333, annotated'),
        {
          kind: 'paragraph',
          text: "My choices were not free either. On five turns running, from my third to my seventh, the engine wanted the tile on h4 (it was one of my own soldiers) and marked each flip I made instead. On my twelfth turn my cannon on f1 could take an elephant on f3; I flipped instead, which the engine prices at 8 points. Summed over the game, my 19 flips gave away 52 points of expected score by choice and 42 to the draw. Rebirthfox's 10 flips gave away 8 by choice and 20 to the draw. The deal was unkind to me, and my choices were unkinder. A red soldier took my general and I resigned.",
        },
      ],
    },
    {
      heading: 'Jieqi: the chariot move and the face-down recapture',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In jieqi every piece except the generals starts face down, shuffled onto the home squares. A face-down piece moves as whatever piece belongs on the square it stands on, and once it moves it turns face up and is what it really is from then on.',
        },
        {
          kind: 'paragraph',
          text: 'After 21 moves each the game was level. On my 22nd move I played my chariot from f6 to f3. The engine wanted f2, which keeps it level; after f3 my expected score went from 52% to 24%. Red answered by bringing a cannon to e2, behind the other cannon on e3, lined up on my second chariot on e5.',
        },
        gameEmbed('jieqi', 44, 'Jieqi, @rebirthfox333 vs @brianhliou-dev, annotated'),
        {
          kind: 'paragraph',
          text: "I took the cannon on e3, which the engine agrees was the best I had by then. Red took back with the face-down piece on g1. It moved as an elephant, because g1 is an elephant's home square, and turned over to show an elephant. Before it turned, Red's expected score was 84.5%; with an elephant underneath, 91.6%. So the reveal helped Red by about 7 points, but the chariot move had already cost me 28. I took the elephant with my other chariot, and had still given a chariot for a cannon and an elephant. Red mated me on their 33rd move.",
        },
      ],
    },
    {
      heading: 'Duck Xiangqi: the endgame lost by waiting',
      blocks: [
        {
          kind: 'paragraph',
          text: "In Duck Xiangqi every turn is a move and then a duck placement. The duck goes on an empty square, blocks it for both sides and can serve as a cannon's screen, and the game is won by capturing the general.",
        },
        {
          kind: 'paragraph',
          text: 'I was Black and well ahead out of the opening. Before my 18th move my expected score was 79% (a second search of the same size said 87%), and I let most of it go by taking a soldier with my horse: 62% after it. That was the first mistake.',
        },
        {
          kind: 'paragraph',
          text: "The second was slower. From my 39th move to my 51st I moved my general from d10 to e10 and back, thirteen times, with the duck parked on f8, while Red's soldiers walked across. Red's expected score was 51% when I started and 70% when I stopped. The engine marks three of those moves, because none of them costs much by itself. Together they cost the game. At each marked one the engine's line does something: my soldier on d2 takes on e2.",
        },
        gameEmbed('duck', 100, 'Duck Xiangqi, @rebirthfox333 vs @brianhliou-dev, annotated'),
        {
          kind: 'paragraph',
          text: "When I did act, my soldier took an advisor on d1 and the other advisor took it straight back. From there the engine scores it as a slow loss, and Red's chariot took my general on their 69th move.",
        },
      ],
    },
    {
      heading: 'What each variant changed',
      blocks: [
        {
          kind: 'paragraph',
          text: 'So what did each variant change? In Fog Xiangqi the game turned on a square one player could not see. In banqi it turned on a tile neither of us could see, though the tiles I chose to turn did more harm than the one that went wrong. In jieqi it turned on a plain chariot move, and the hidden piece made the result a little worse. In Duck Xiangqi it turned on what I did not do: thirteen waiting moves gave a level position away. Two of the four turned on my own moves, one mostly on the draw, and one on a square my opponent could not see. My thanks to @rebirthfox333 for four good games.',
        },
      ],
    },
  ],
};
