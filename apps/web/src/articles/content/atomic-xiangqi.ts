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
// no card links here. The play link in the closing block is a PvP invite,
// because the setup dialog's play CTA is null for hidden surfaces and there is
// no bot yet.
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
      text: 'Atomic Chess dates from 1995 on the German Chess Server, where a capture removes the capturer, the captured piece and every non-pawn on the eight neighbouring squares. This is that rule on the xiangqi board, played with a standard set from the standard array, and it needed two answers of its own before it worked as a game. They are the rest of this page.',
    },
  ],
  sections: [
    {
      heading: 'The explosion',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board, the pieces and the opening array are ordinary xiangqi, and every piece moves as it always has. The difference starts the moment one piece takes another.',
        },
        {
          kind: 'paragraph',
          text: 'A capture removes three things: the capturing piece, the captured piece, and every piece standing on the four points orthogonally next to the capture point. Diagonal neighbours are not touched. Soldiers are never removed by an explosion, only by being captured themselves. Both sides’ pieces are removed alike; the blast does not know whose piece it is clearing.',
        },
        {
          kind: 'paragraph',
          text: 'Two consequences follow. Taking a piece next to your own general is not a move, because the blast would remove your general; the board will not offer it. And taking a piece next to the enemy general wins on the spot, whatever else is on the board, because the blast removes theirs.',
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
      heading: 'The cannon shot',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A cannon’s capture removes only the cannon and its target. Nothing beside the target is touched, and the screen the cannon fired over is not touched. The shot is at range; the explosion is on contact.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_SHOT_PAIR,
          caption:
            'Red’s cannon fires over its soldier and takes the horse. The cannon and the horse go; the chariot and cannon beside the horse stay, and so does the soldier that screened the shot.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This is the rule that makes the game hold. Without it, a chariot standing on the file of an advisor forces a draw: the only defence is to block with a cannon, the cannon’s own shot back over the chariot forces the chariot to move, the cannon follows, and neither side can do anything else. With it, the block still stops the chariot but threatens nothing back, and the attacker has to find something better than shuffling. The cannon becomes a piece you trade and block with; it is no longer the piece that clears a rank.',
        },
      ],
    },
    {
      heading: 'Check, here',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Xiangqi’s rules about the general stand. A move may not leave your general where a piece attacks it, and the two generals may not face each other down an open file. Checkmate wins. A player with no legal move loses.',
        },
        {
          kind: 'paragraph',
          text: 'One thing is wider than in xiangqi. Your general is in check whenever the opponent could remove it with their next move, and under these rules that includes taking the piece beside it. A chariot bearing on your advisor is bearing on your general. The board shows this as check, and it matters for the repetition rule below: a player who gives this kind of check on every move of a repeated cycle loses, exactly as a player giving ordinary perpetual check loses in xiangqi.',
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
          text: 'You win by blowing up the enemy general, by checkmate, or by leaving the opponent with no legal move. Games also end by timeout, resignation, or abandonment, the same as any other game here.',
        },
        {
          kind: 'paragraph',
          text: 'Two rules draw. Sixty moves by each player without a capture is a draw, which is xiangqi’s own no-progress limit. The third occurrence of the same position is a draw, unless one side gave check (in the wide sense above) on every move of the repeated cycle: then that side loses. If both sides did, it is a draw.',
        },
      ],
    },
    {
      heading: 'Why these rules',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The plain port, every capture exploding, was tested first and played engine games that ended in the same forced draw on the advisor files within twenty moves. The two additions above were measured against it: with them, a stronger engine beats a weaker one 19 games to 0, equal engines reach decisive games from two random opening plies half the time, and forty-one of forty-four first moves stay level, with no forced line. What the game is like between people is the thing the measurements cannot say, which is why the board is here.',
        },
      ],
    },
    playClosing({
      heading: 'Where to next',
      lead: 'Play it against a friend with an invite link. A computer opponent is coming.',
      playLabel: 'Play Atomic Xiangqi',
      playHref: '/?play=friend&gameSpecId=atomic-xiangqi',
    }),
  ],
};
