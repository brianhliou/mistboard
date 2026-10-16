import {
  CRAZYHOUSE_XIANGQI_ADVISOR_PAIR,
  CRAZYHOUSE_XIANGQI_CAPTURE_PAIR,
  CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR,
  CRAZYHOUSE_XIANGQI_DROP_MATE_PAIR,
  CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR,
  CRAZYHOUSE_XIANGQI_INTRO_BOARD,
  CRAZYHOUSE_XIANGQI_START_BOARD,
  CRAZYHOUSE_XIANGQI_TURN_PAIR,
  CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE,
  CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF,
} from '../../crazyhouse-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Listed and indexed (public 2026-10-02 after a same-day polish hold); the
// zh-Hans / zh-Hant copy is machine-drafted (article-i18n.ts). Every rule here is the kernel's,
// packages/game/src/variants-crazyhouse-xiangqi.ts: the start is
// createInitialCrazyhouseXiangqiState, the drop zones are
// crazyhouseXiangqiDropRegion, the advisor and elephant moves are its rule
// geometry, and the endings are applyCrazyhouseXiangqiMove. The diagrams are
// drawn from the kernel (crazyhouse-xiangqi-rules-diagrams.ts). The sample game
// is chapter 3 of study nlZy4yNA (scripts/data/crazyhouse-xiangqi-study.json)
// and crazyhouse-xiangqi-sample-game.ts; captions that name a count or a move
// number are pinned by those modules' tests. Change them together.
export const crazyhouseXiangqiArticle: Article = {
  slug: 'crazyhouse-xiangqi',
  gameSpecId: 'crazyhouse-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Crazyhouse Xiangqi Rules',
  summary:
    'Xiangqi where a captured piece joins your hand and the advisors and elephants start there: drop a piece on any empty point, advisors and elephants on their own half, check and mate included.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-01',
  playableOnMistboard: true,
  audience:
    'Xiangqi players trying the drop version for the first time, and Crazyhouse players who want the xiangqi rules stated precisely.',
  thumbnail: { kind: 'svg', svg: CRAZYHOUSE_XIANGQI_START_BOARD },
  intro: [
    {
      kind: 'paragraph',
      text: 'Crazyhouse Xiangqi is [xiangqi](/rules/xiangqi) with drops. A piece you capture joins your hand as one of your own, and each turn you either move a piece on the board or drop one from your hand onto an empty point. Both sides also start with their two advisors and two elephants in hand.',
    },
    {
      kind: 'raw-svg',
      svg: CRAZYHOUSE_XIANGQI_INTRO_BOARD,
      className: 'article-figure-xq--pair-board',
      caption:
        'The last position of the sample game below. Red mates by dropping a soldier on e9, ringed. Each side’s hand is drawn on its own side of the board: Black’s above, Red’s below.',
    } as ArticleBlock,
    // TODO link the deep-dive post once published
    {
      kind: 'paragraph',
      text: 'Brian H. Liou designed this version in 2026 as a Mistboard original. Drop rules for xiangqi have been proposed before, in Moshe Callen’s Drop-Xiangqi (2007) and in Fairy-Stockfish’s built-in xiangqihouse, but none became a settled standard. This one is a complete rule set, tested in well over 1,600 engine games across more than 40 candidate rule sets.',
    },
    {
      kind: 'paragraph',
      text: 'Everything else is xiangqi: the board, how the other pieces move, the general in its palace, the river, the rule that the two generals may not face each other on an open file, and the way a game ends.',
    },
  ],
  sections: [
    {
      heading: 'Advisors and elephants start in hand',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Each side begins with its two advisors and two elephants in hand, not on the board. The back rank reads chariot, horse, two empty points, the general, two empty points, horse, chariot. The cannons and soldiers stand where they always do.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_START_BOARD,
          className: 'article-figure-xq--pair-board',
          caption:
            'The start. Black’s hand is above the board and Red’s below, two advisors and two elephants each.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Red moves first, and the first move may already be a drop.',
        },
      ],
    },
    {
      heading: 'Advisors and elephants move anywhere on their own half',
      blocks: [
        {
          kind: 'paragraph',
          text: 'An advisor steps one point diagonally and an elephant two, as in xiangqi, and an elephant is still blocked when the point between (its eye) is occupied. What changes is where they may go: an advisor is no longer held to the palace, nor an elephant to its seven points. Both may go anywhere on their own side of the river, and neither ever crosses it.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_ADVISOR_PAIR,
          caption:
            'Left, an advisor on c2, outside the palace, steps to any of four points. Right, on the river bank at e5 it has two; the crosses are the points the river keeps it from.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'An elephant dropped off its seven old points moves on from there by the same two-point step, and never gets back onto them.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_ELEPHANT_PAIR,
          caption:
            'Left, an elephant dropped on d3 reaches b1, b5, f1 and f5, none of them a point a xiangqi elephant ever stands on. Right, a soldier on e4 fills its eye, and the step to f5 is gone.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Each turn is a move or a drop',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn you do one thing: move a piece on the board, or take a piece from your hand and put it on an empty point. A drop is the whole turn, and dropping is never required.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_TURN_PAIR,
          caption:
            'Two ways to start. Left, Red moves the cannon from h3 to e3. Right, Red drops an elephant on e3 instead, and Red’s hand is one elephant lighter.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Captured pieces join your hand',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When you capture a piece it leaves the board and goes into your hand as one of your own. Take a black horse and you hold a red horse. Both hands are shown beside the board, so you always know what your opponent can drop.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_CAPTURE_PAIR,
          caption:
            'Red’s chariot takes the black horse on c7, and a red horse joins the soldier already in Red’s hand.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The general is never captured, so it is never in a hand. Every other piece can be: chariots, horses, elephants, advisors, cannons and soldiers.',
        },
      ],
    },
    {
      heading: 'Where each piece may drop',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A piece may be dropped on any empty point, with one limit: advisors and elephants stay on your own half of the board. Chariots, horses, cannons and soldiers may go anywhere, the enemy palace and your own back rank included.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: CRAZYHOUSE_XIANGQI_ZONE_OWN_HALF },
            { svg: CRAZYHOUSE_XIANGQI_ZONE_ANYWHERE },
          ],
          caption:
            'Red’s drop zones on an empty board: 45 points for an advisor or elephant, all 90 for a chariot, horse, cannon or soldier. Black’s are the mirror image.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Any number of soldiers may share a file. A soldier moves from wherever it lands as if it had walked there: one step forward on your own half, even from your back rank, and forward or sideways once across the river.',
        },
      ],
    },
    {
      heading: 'A drop may give check and mate',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The dropped piece may attack the general itself, or become the screen one of your own cannons fires over. A drop may also block a check. The one drop you may not make is one that leaves your own general in check, such as a piece that becomes the screen an enemy cannon fires over at your general.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_DROP_CHECK_PAIR,
          caption:
            'Left, a horse dropped on d8 checks the general on e10. Right, a soldier dropped on e6 gives Red’s cannon on e3 its screen.',
        } as ArticleBlock,
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_DROP_MATE_PAIR,
          caption:
            'The sample game’s last move. Left, Red to move with three soldiers in hand. Right, one dropped on e9 mates the general on f9.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'How the game ends',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Checkmate wins,** by a move or by a drop. As in xiangqi, so does stalemate: a player with no legal move loses, in check or not. Count your drops as moves. A player with a piece in hand and an empty point to put it on is rarely out of moves.',
        },
        {
          kind: 'paragraph',
          text: '**Repetition.** When the same position occurs for the third time, with the same pieces on the same points, the same pieces in both hands and the same player to move, the game is drawn. If one player gave check with every move of the repeating cycle and the other did not, the checking player loses instead: perpetual check is not a way to save a game.',
        },
        {
          kind: 'paragraph',
          text: '**Sixty plies without a capture** is a draw. Moves and drops both count toward the sixty; only a capture starts the count again.',
        },
        {
          kind: 'paragraph',
          text: 'Time, resignation and abandonment end a game as they do everywhere else on Mistboard.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Fairy-Stockfish against itself under these rules, five seconds a move. Both sides drop advisors and elephants on points they never reach in xiangqi, and Red’s attack comes out of its hand: seven of its checks are drops, and the last is mate.',
        },
        {
          kind: 'embed',
          path: '/embed/study/nlZy4yNA/EBLNng54',
          title: 'Crazyhouse Xiangqi: a comeback, and a soldier drop mates',
          caption:
            'Watch Red’s advisor dropped on d4 on move 6, Black’s elephant dropped in the corner on a10 on move 18, the cannon Red drops with check on move 31, and the mate on move 49.',
          // Sized so the card is width-bound at the article's 702px column, as
          // the Atomic page's is: the board column tops out at 447px beside the
          // 225px move sheet, and the two hand bands make it taller than a
          // plain xiangqi card. Measured 2026-10-02: height-bound below 788px.
          aspect: [702, 790],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This game is one of six in the [companion study](/study/nlZy4yNA), each with notes on the drops that decided it.',
        },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'Can a drop give check?',
              answer:
                'Yes. A drop may check and may mate, directly or by becoming the screen for one of your cannons. The only drop you may not make is one that leaves your own general in check.',
            },
            {
              question: 'Why can my elephant not cross the river?',
              answer:
                'Advisors and elephants never cross it, by move or by drop. On your own side of the river they may stand on any point, so that whole half is open to them.',
            },
            {
              question: 'Why do advisors and elephants start in hand?',
              answer:
                'So both sides have pieces to drop from the first move, placed where the game needs them instead of on fixed points.',
            },
            {
              question: 'Does a drop reset the sixty-ply count?',
              answer:
                'No. Only a capture does. Without that, two players could trade drops forever without either one taking anything.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Crazyhouse Xiangqi is on Mistboard against the Fairy-Stockfish ladder, a friend with an invite link, or whoever is waiting in the lobby.',
      playLabel: 'Play the computer',
      playHref: '/?play=computer&gameSpecId=crazyhouse-xiangqi',
      secondary: [{ label: 'The six engine games', href: '/study/nlZy4yNA', emphasis: 'secondary' }],
    }),
  ],
};
