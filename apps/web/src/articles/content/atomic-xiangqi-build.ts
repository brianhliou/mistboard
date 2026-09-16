import {
  ATOMIC_XIANGQI_CHECK,
  ATOMIC_XIANGQI_CORK,
  ATOMIC_XIANGQI_GENERALS,
  ATOMIC_XIANGQI_SHOT_PAIR,
  ATOMIC_XIANGQI_THUMBNAIL,
} from '../../atomic-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The launch piece for an unlisted variant: what decides a first game, in the
// shape of the duck launch article. Linked from the rules page and the
// brianhliou.com post; kept off the homepage cards and the feed by the spec's
// public surface, and non-indexed until the first twenty human games are in.
export const atomicXiangqiBuildArticle: Article = {
  slug: 'atomic-xiangqi-build',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  gameSpecId: 'atomic-xiangqi',
  title: 'Atomic Xiangqi Is Live: What Decides Your First Game',
  seoTitle: 'Atomic Xiangqi: What Decides Your First Game',
  summary:
    'Chinese chess where a capture is an explosion. The rules take a minute. What decides your first game is the three points beside your general, the cannon that no longer clears a rank, and a chariot on your advisor file counting as check.',
  showSummaryOnPage: false,
  // Off the /blog index: the variant is unlisted, and this page is reached
  // from its rules page and the brianhliou.com post.
  showInIndex: false,
  status: 'published',
  publishedAt: '2026-09-16',
  audience:
    'Anyone who has just read the Atomic Xiangqi rules and is about to play, and xiangqi players wondering what an explosion does to a game they already know.',
  thumbnail: { kind: 'svg', svg: ATOMIC_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Atomic Xiangqi is live today, against a bot at eight strengths or a friend by invite link. It is Chinese chess where a capture is an explosion: the piece that captures, the piece it takes and everything on the four points next to it are removed, soldiers survive, and a general does not. Same set, same array, three lines of rules.',
    },
    {
      kind: 'paragraph',
      text: 'What follows is not the rules. It is what decides a first game, taken from the twelve engine games behind this launch and the few hundred it took to find rules that hold.',
    },
  ],
  sections: [
    {
      heading: 'Three points kill your general from move one',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A capture on any point next to a general removes it. Red’s general on e1 has three neighbours, d1, f1 and e2, and two of them hold advisors from the first move. So every advisor is a target that carries the general with it, and every piece that can reach d1 or f1 is a threat to the game, not to a piece.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_GENERALS,
          caption:
            'The chariot on d9 takes the advisor and the game ends. The chariot on f2 may not take the horse on f1: the blast would reach its own general, and the board does not offer the move.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The mirror of that is the rule you will feel first: you cannot capture anything next to your own general. A piece that steps beside your general is safe from every one of your pieces, and it stays safe until the general moves.',
        },
      ],
    },
    {
      heading: 'A cannon shot takes one piece',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every capture explodes except the cannon’s. A cannon that fires over a screen removes its target and itself, and nothing beside the target. The screen survives too.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_SHOT_PAIR,
          caption:
            'The cannon takes the horse and dies doing it. The chariot and cannon beside the horse stay, and so does the soldier the shot went over.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This changes what the cannon is for. In xiangqi it is the piece that clears a file; here it is the piece you trade one for one and, more often, the piece you block with. A cannon standing directly in front of an enemy chariot stops it and threatens nothing back, so the chariot side has to find a plan rather than wait for the block to move. The engine’s best-play draw at two million nodes ends exactly that way: a cannon sliding along in front of a chariot.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_CORK,
          caption:
            'Black’s general is on f10 and Red’s chariot wants the f-file. Black’s cannon on f4 corks it: a quiet block, because its own shot would take one piece and the chariot is not on the far side of a screen.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'A chariot on your advisor file is check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nothing attacks the general in the position below, and the board says check. The rule: you are in check whenever your opponent could remove your general next move by any means, and taking the advisor beside it is one of the means.',
        },
        {
          kind: 'raw-svg',
          svg: ATOMIC_XIANGQI_CHECK,
          caption:
            'Black is in check. The chariot is not attacking the general; it is attacking the advisor, and the blast would do the rest.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'You are not obliged to answer it, and the game does not end for ignoring it. It matters for one rule: xiangqi’s perpetual-check law. A player who gives check, in this wide sense, on every move of a repeated cycle loses. So a chariot hopping between the two advisor files to force a repetition is a losing plan, and because the board shows the check on every move, the loss on the third repetition is not a surprise.',
        },
      ],
    },
    {
      heading: 'Soldiers survive blasts, and a soldier’s capture explodes like any other',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A soldier next to an explosion is untouched, which makes a soldier the one piece that can stand in a kill zone and stay. But a soldier that captures explodes with its target. In one of the engine games a soldier takes a chariot on c9 and removes the elephant on c10 and the horse on c8 with it, three pieces for a soldier, and another game is won by a soldier’s checkmate on e1.',
        },
      ],
    },
    {
      heading: 'Games end by explosion or by mate, in 46 to 145 plies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Of the ten decisive engine games behind this launch, six end with a general blown up and four with checkmate; the shortest is 23 moves and the longest 73. Expect a full game, and pick a clock for one: 10+5 is the default here.',
        },
        {
          kind: 'paragraph',
          text: 'Openings look like xiangqi’s. The cannon shot that took a cannon and a horse together under an earlier version of the rules is gone, so nobody trades cannons on move one; the engine opens Cb5, Ri3, Ra3 or Hg3, and the first explosion usually comes in the middlegame.',
        },
      ],
    },
    {
      heading: 'The bot takes a general on offer without thinking',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The bot is Fairy-Stockfish with a patch for these rules, eight node-anchored levels, the same ladder the other xiangqi variants use. Its weaker levels are weakened by choosing a move other than the best one they found, and on the duck board that made a level-1 bot decline a general capture it could see. Here the loop checks for a move that removes the general before it asks the engine anything, so a general left next to a capturable piece is taken at every level. Weakness is in how the bot builds a position, not in whether it finishes one.',
        },
      ],
    },
    playClosing({
      heading: 'Play it',
      lead: 'Eight engine strengths, or a friend by invite link. The rules page has the whole thing with diagrams.',
      playLabel: 'Play Atomic Xiangqi',
      playHref: '/?play=computer&gameSpecId=atomic-xiangqi',
      secondary: [
        { label: 'Rules', href: '/rules/atomic-xiangqi', emphasis: 'secondary' },
        {
          label: 'Invite a friend',
          href: '/?play=friend&gameSpecId=atomic-xiangqi',
          emphasis: 'secondary',
        },
        { label: 'The twelve engine games', href: '/study/dPKhvJKb', emphasis: 'secondary' },
      ],
    }),
  ],
};
