import {
  ATOMIC_XIANGQI_BLAST_PAIR,
  ATOMIC_XIANGQI_CHECK,
  ATOMIC_XIANGQI_GENERALS,
  ATOMIC_XIANGQI_SHOT_PAIR,
  ATOMIC_XIANGQI_THUMBNAIL,
} from '../../atomic-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The rules page is the front door of an unlisted variant: no rail, no tile,
// no card links here. The play links in the closing block are authored by
// hand because the setup dialog's play CTA is null for hidden surfaces.
export const atomicXiangqiArticle: Article = {
  slug: 'atomic-xiangqi',
  gameSpecId: 'atomic-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Atomic Xiangqi Rules',
  summary:
    'Xiangqi where a capture is an explosion. The capturer, the captured piece and the four neighbouring pieces go; soldiers survive; a cannon shot takes only its target; and a blast threat on the general is check.',
  showSummaryOnPage: false,
  status: 'published',
  updatedAt: '2026-09-16',
  audience:
    'Xiangqi players, and Atomic Chess players who want the xiangqi version stated precisely.',
  thumbnail: { kind: 'svg', svg: ATOMIC_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Atomic Xiangqi is [xiangqi](/rules/xiangqi) with one change: a capture is an explosion. The piece that captures, the piece it takes, and every piece on the four points next to the capture are removed from the board. Soldiers survive an explosion. A general does not.',
    },
    {
      kind: 'raw-svg',
      svg: ATOMIC_XIANGQI_BLAST_PAIR,
      caption:
        'Red’s chariot takes the horse. The chariot, the horse, the chariot beside it and the cannon beside it all go. The soldier above the horse stays.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'Brian H. Liou adapted Atomic Xiangqi to the 9 by 10 board in 2026 as a Mistboard original; nobody had put the explosion on a xiangqi board before. The blast is four points rather than eight because a xiangqi piece’s neighbour is the next point along a line, and the cannon gets one rule of its own.',
    },
    {
      kind: 'paragraph',
      text: '[Atomic Chess](https://en.wikipedia.org/wiki/Atomic_chess) began on the German Internet Chess Server in 1995, from rules Klaus Knopper collected from friends who played it over the board. It is now one of the most played chess variants: Lichess added it in 2015 and hosted 4.9 million games of it in 2021, and grandmasters Andrew Tang and Jeffery Xiong reached the quarter- and semi-finals of its 2017 championship.',
    },
  ],
  sections: [
    {
      heading: 'The explosion',
      blocks: [
        {
          kind: 'paragraph',
          text: '**What goes.** The capturing piece, the captured piece, and every piece on the four points orthogonally next to the capture point, whichever side they belong to.',
        },
        {
          kind: 'paragraph',
          text: '**What stays.** Diagonal neighbours. Soldiers: an explosion never removes a soldier, so a soldier leaves the board only by being captured itself, though a soldier that captures explodes like anything else.',
        },
        {
          kind: 'paragraph',
          text: '**Your general.** You cannot capture next to your own general; the blast would take it. So a general never captures.',
        },
        {
          kind: 'paragraph',
          text: '**Their general.** A capture next to the enemy general wins on the spot. The advisors beside each general are the points the game turns on.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_GENERALS,
          caption:
            'The chariot on d9 may take the advisor, and that ends the game: the blast reaches the general on e10. The chariot on f2 may not take the horse, because the blast would reach Red’s own general on e1.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The cannon shot is the one exception',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A cannon’s capture does not explode. It removes only the cannon and its target: nothing beside the target is touched, and neither is the screen the cannon fired over. The shot is at range; the explosion is on contact.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_SHOT_PAIR,
          caption:
            'Red’s cannon fires over its soldier and takes the horse. The cannon and the horse go; the chariot and cannon beside the horse stay, and so does the soldier that screened the shot.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This is the one change from a straight port, and it is there because the straight port has a draw by repetition that can start on move three and that the defender can never refuse. A chariot on the file of an advisor threatens to blow up the general. The only defence is to block with a cannon, and with cannons exploding, the block is also a shot back over the chariot at the attacker’s own advisor, so the chariot has to move to the other advisor file, the cannon follows, and the position repeats. In engine games a side that had lost a chariot could hold the draw this way against a far stronger opponent. A quiet shot leaves the block standing but harmless, and the check rule below makes the hop that remains a loss for the side making it. The cannon becomes a piece you trade and block with rather than the piece that clears a rank, and everything else about the explosion stays as it is.',
        },
      ],
    },
    {
      heading: 'A threat to blow up the general is check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Xiangqi’s rules about the general stand. A move may not leave your general where a piece attacks it, and the two generals may not face each other down an open file. Checkmate wins. A player with no legal move loses.',
        },
        {
          kind: 'paragraph',
          text: 'One thing is wider than in xiangqi. Your general is in check whenever the opponent could remove it with their next move, and under these rules that includes taking the piece beside it. A chariot bearing on your advisor is bearing on your general. The board shows this as check, and it matters for the repetition rule below: a player who gives this kind of check on every move of a repeated cycle loses, as a player giving ordinary perpetual check does under xiangqi’s tournament rules.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_CHECK,
          caption:
            'Nothing attacks the black general. Black is in check all the same: the chariot can take the advisor and blow the general up. Black is not obliged to answer it, but repeating a position under this threat is the checking side’s loss, not a draw.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'How games end',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win by blowing up the enemy general, by checkmate, by leaving the opponent with no legal move, or when the opponent gives perpetual check in the wide sense above. Games also end by timeout, resignation, or abandonment, the same as any other game here.',
        },
        {
          kind: 'paragraph',
          text: 'Two rules draw. Sixty consecutive plies without a capture is a draw, the same limit as xiangqi here. The third occurrence of the same position is a draw, unless one side gave check on every move of the repeated cycle: then that side loses, where plain xiangqi on Mistboard would call it a draw. If both sides did, it is a draw.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'One of the engine games behind this page: Fairy-Stockfish at ten million nodes as Red against itself at one million. Red is a pawn and a half up by move 6 and the game stays close until Black’s 21…Hxf9, a horse taking a cannon on f9 with Black’s own advisor on f10 beside it. The blast takes the advisor, the palace is a piece lighter for nothing, and it never recovers: 30…Cb9 leaves the general without cover, and on move 38 Red’s chariot takes the cannon on d8, next to the general on d9. The blast takes the general, and the elephant on e8 with it.',
        },
        {
          kind: 'embed',
          path: '/embed/study/dPKhvJKb/Zwlt0Ch5',
          title: 'Atomic Xiangqi: an engine game decided by a self-blast in the palace',
          // Sized so the card is width-bound at the article's 702px column:
          // the board gets the column minus the 226px move sheet (474px, so
          // 527px tall at 9:10), plus the seat rows and controls (117px) and
          // the header and credit lines (~52px). Shorter, and the card sizes
          // the board to the height instead and hands the spare width to the
          // sheet, which then reads as an empty column.
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    playClosing({
      heading: 'Where to next',
      lead: 'Play it against the engine at any of eight strengths, or against a friend with an invite link. The [launch note](/blog/atomic-xiangqi-build) is what decides a first game; the design post has the measurements behind the cannon rule; the study has all twelve engine games, with every explosion marked and a note on the move that decided each.',
      playLabel: 'Play Atomic Xiangqi',
      playHref: '/?play=computer&gameSpecId=atomic-xiangqi',
      secondary: [
        {
          label: 'The design post',
          href: 'https://brianhliou.com/posts/atomic-xiangqi/',
          emphasis: 'secondary',
        },
        { label: 'The twelve engine games', href: '/study/dPKhvJKb', emphasis: 'secondary' },
      ],
    }),
  ],
};
