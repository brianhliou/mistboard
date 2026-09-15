import {
  HORDE_XIANGQI_CHARIOT,
  HORDE_XIANGQI_GAME,
  HORDE_XIANGQI_START,
  HORDE_XIANGQI_THUMBNAIL,
} from '../../horde-xiangqi-article-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The short account. The full design map, with a picture of every array
// beside its result and every engine game in a viewer, lives on
// brianhliou.com, which is the canonical page for the numbers; this one says
// what was found and why there is no play page, and sends the reader on.
// Diagrams are kernel-checked positions from the generator that made the
// deep dive's boards.
const DEEP_DIVE = 'https://brianhliou.com/posts/horde-xiangqi/';
const EVIDENCE = 'https://github.com/brianhliou/horde-xiangqi';

export const hordeXiangqiArticle: Article = {
  slug: 'horde-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Horde on the Xiangqi Board: The River Is a Cliff',
  seoTitle: 'Horde Xiangqi: Horde Chess on the Xiangqi Board, Measured',
  summary:
    'We put Horde on the xiangqi board and measured it before building anything: twelve start arrays, two soldier rules, each played four times by an engine against itself. With xiangqi’s own soldier the army wins every game by one trick; give the soldier the crossed move from the start and the game becomes a siege that draws three times in four. We are publishing the measurement, not the variant.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-15',
  audience:
    'Chess players who know Horde and wonder what it does on the xiangqi board, and xiangqi players curious why a variant was measured and then not built.',
  thumbnail: { kind: 'svg', svg: HORDE_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Horde chess is 36 pawns and no king against a normal army; the pawns win by checkmate, the army by taking the last pawn. Lichess has played it since 2015. We put the same idea on the xiangqi board: Red has soldiers only and no general, Black has the standard army, and everything else is xiangqi. Then we measured it before designing anything.',
    },
    {
      kind: 'paragraph',
      text: 'None of the twenty-four designs is a game, and the reason is the soldier. Below the river a block of soldiers cannot defend itself; above it the army cannot attack it. The full map, with a picture of every array beside its result and every engine game in a viewer, is on brianhliou.com; this page is the short account and the reason there is no play button.',
    },
  ],
  sections: [
    {
      heading: 'Twelve arrays and two soldiers',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The soldier’s move is the whole design space; how many soldiers, where they start, what shape the block is and which no-capture clock runs are dials. We turned all of them: 18 to 45 soldiers, blocks at the back, a rank forward, or already across the river, the parent’s silhouette, xiangqi’s own five soldier points. Two soldier rules: xiangqi’s own, which moves one point forward and sideways only after crossing the river, and the veteran, which has the crossed soldier’s move from its first step. Every array was played four times at four search budgets by Fairy-Stockfish against itself, refereed by a rule kernel that had agreed with the engine on every legal move first.',
        },
        {
          kind: 'raw-svg',
          svg: HORDE_XIANGQI_START,
          caption:
            'The parent’s array with standard soldiers, and the closest thing to a game we found: 36 veterans a rank forward, drawn with the crossed-soldier piece because that is the move they have.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Standard soldiers: the chariot eats the horde from behind',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A standard soldier covers only the point in front of it, so the horde is nine columns rather than a wall. The moment a column empties, a chariot drops through it to the first rank and takes a soldier a move from behind, and nothing in the horde attacks backward. Every array of 40 or fewer that starts on its own side loses this way, four games out of four. Only a five-deep block of 45, or a start already across the river, sometimes gets enough soldiers over before the chariot is done, and those cells split.',
        },
        {
          kind: 'raw-svg',
          svg: HORDE_XIANGQI_CHARIOT,
          caption:
            'The million-node game from the parent’s array. Black’s chariot drops through the f-file, which the horde emptied by advancing; fifteen moves later eleven soldiers are gone and the army has lost nothing for them.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Veteran soldiers: the horde holds, and the siege is a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Give every horde soldier the crossed soldier’s move from the start and the road closes: a veteran column attacks the points beside it, so the chariot cannot sit next to it for free. The horde becomes a side. Between equals the game becomes a siege: the horde marches to the palace, finds a general and two chariots waiting, and stops, because the block guards itself where it stands but can only advance a whole rank at a time while the army waits. Forty-eight games: 37 draws, six horde wins, five army wins, all five against 18 soldiers.',
        },
        {
          kind: 'raw-svg-stepper',
          header: {
            players: 'Horde (36 veterans, ranks 2 to 5) vs the army',
            event: 'Fairy-Stockfish against itself, a million nodes a move',
          },
          steps: HORDE_XIANGQI_GAME,
          caption:
            'Eight frames of the horde’s win from its best array, the one it wins four times in five: the march, the siege, both chariots falling, and the smother at ply 435. Every game in this array is in the viewer on brianhliou.com.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The one array the horde is favoured in is the same siege with a better score, not a different game: four hundred to a thousand plies in which the army’s best plan is to wait in the palace and the horde’s is to shuffle a block one point at a time.',
        },
      ],
    },
    {
      heading: 'What a different soldier would need',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A chess pawn captures diagonally, so the pawn behind covers the point its neighbour steps to and pawns advance as chains; that is why Horde works in chess. The xiangqi soldier captures the way it moves, straight ahead, so the point a soldier steps to is covered by nothing, and the river is a cliff: no cover on the way, total cover once there. No count, start rank, shape or clock changes that. What would is a soldier with cover on the way, and the candidates run from a diagonal-forward capture to a double step, two soldiers a turn, or the chess pawn outright. We stopped at the veteran because it is the only one xiangqi already has; each of the others is a new piece and a different game.',
        },
      ],
    },
    {
      heading: 'What we are publishing instead of a play page',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The rule kernel with both soldier rules and all twelve arrays, the Fairy-Stockfish stanzas, all 387 engine games, the checks behind them, and a verifier that replays every game against the rules and recomputes the tallies in half a minute, with no engine needed. If you have a soldier rule that gives the block cover on the way, that is where the next attempt starts; open an issue there and the write-up will say so.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Read the full analysis', href: DEEP_DIVE, emphasis: 'primary', external: true },
            { label: 'Check the games yourself', href: EVIDENCE, emphasis: 'secondary', external: true },
            { label: 'Learn xiangqi', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
