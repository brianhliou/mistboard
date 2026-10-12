import {
  RETIRED_ATOMIC_SHUFFLE,
  RETIRED_FORTRESS_DROP_MATE,
  RETIRED_VARIANTS_THUMBNAIL,
} from '../../retired-variants-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Fortress Xiangqi and Atomic Xiangqi were closed to new games on 2026-10-11
// (branch agent/retire-fortress-atomic) and are on hold for a redesign. Sources:
// the Fortress rules page and docs-private/drop-game-lab/DESIGN-SPEC.md; the
// Atomic launch post and the lab record behind scripts/gen-atomic-diagrams.mts.
// Every figure is built through the rules kernels and assert their own claims
// (retired-variants-diagrams.ts).

export const fortressAndAtomicXiangqiOnHoldArticle: Article = {
  slug: 'fortress-and-atomic-xiangqi-on-hold',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Back to the drawing board: Fortress and Atomic Xiangqi',
  seoTitle: 'Back to the drawing board: Fortress Xiangqi and Atomic Xiangqi',
  cardTitle: 'Fortress and Atomic on hold',
  summary:
    'On 11 October we stopped new games of Fortress Xiangqi and Atomic Xiangqi so we can redesign them. In Fortress the drops took over a small board; Atomic only stopped looping after the cannon got its own exception. Finished games still replay.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: RETIRED_VARIANTS_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-10-13',
  boardFamily: 'xiangqi',
  audience: 'Players who tried Fortress Xiangqi or Atomic Xiangqi, and anyone who designs variants.',
  readNext: ['atomic-xiangqi-build'],
  tldr: [
    'Fortress Xiangqi and Atomic Xiangqi are on hold while we redesign them. You cannot start a new game, but finished games still replay and both rules pages stay up.',
    'In Fortress the drops took over the small board. A redesign has to make a smaller xiangqi that still feels like the full game.',
    'Atomic only played well after the cannon got its own exception. A redesign has to give it a cannon that follows the same rule as every other piece.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'On 11 October we stopped new games of [Fortress Xiangqi](/rules/fortress-xiangqi) and [Atomic Xiangqi](/rules/atomic-xiangqi). Games already played still replay from their links, and both rules pages stay up. We designed both games, and we launched both before they were ready. What went wrong with each, and what does a version worth bringing back have to fix?',
    },
  ],
  sections: [
    {
      heading: 'Fortress Xiangqi tried four new ideas at once',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Fortress was played on a 7 by 8 board with the two palaces in opposite corners. It added the Treasure, a new piece that steps one point in any direction. A captured piece went into your hand, and you could drop it back onto the board later as your own move. For its first two months it also had veteran soldiers, which we later took out.',
        },
        {
          kind: 'paragraph',
          text: 'Each idea was worth trying. Together they made a game that was hard to learn, and the drops overwhelmed the rest. With the general boxed into a corner of a small board, one piece dropped beside it was often enough. The simplest case takes three pieces.',
        },
        {
          kind: 'raw-svg',
          svg: RETIRED_FORTRESS_DROP_MATE,
          caption:
            'Black drops a soldier from its hand on a2. The general on a1 cannot take it, because the horse on c3 guards a2, and it cannot step to b1, which the same horse covers. That is mate.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'A redesign has to make a smaller xiangqi that keeps the feel of the full game, without drops taking over.',
        },
        {
          kind: 'paragraph',
          text: 'Until then, drops live on the site in [Crazyhouse Xiangqi](/rules/crazyhouse-xiangqi), which plays them on the normal board with the normal pieces and palaces.',
        },
      ],
    },
    {
      heading: 'Atomic Xiangqi needed an exception for the cannon',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In Atomic Xiangqi a capture explodes. The piece that captures, the piece it takes and every piece on the four points next to the capture leave the board. Soldiers survive a blast; a general does not, and losing it loses the game.',
        },
        {
          kind: 'paragraph',
          text: 'In the first version the cannon exploded like everything else, and that made it the best defender on the board. A cannon fires over exactly one piece, so a chariot attacking down a file beside the enemy general could be blocked by a cannon that then threatened back through it. With that parry, an attacker could often force a draw with one simple pattern.',
        },
        {
          kind: 'svg-row',
          className: 'article-figure-row--strip',
          items: [
            { svg: RETIRED_ATOMIC_SHUFFLE[0], caption: '(a) Rd2' },
            { svg: RETIRED_ATOMIC_SHUFFLE[1], caption: '(b) Cd6' },
            { svg: RETIRED_ATOMIC_SHUFFLE[2], caption: '(c) Rf2' },
            { svg: RETIRED_ATOMIC_SHUFFLE[3], caption: '(d) Cf6' },
          ],
          caption:
            'Under the first rules. (a) Red’s chariot threatens to take the advisor on d10. (b) Black’s cannon blocks on d6 and, over the chariot, threatens d1. (c) The chariot hops to f2 and threatens f10. (d) The cannon follows to f6, and the position is (b) again on the other file. Two more moves bring back (b) itself.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Once the palace is closed in by its own pieces, as it is here, the defender has no choice: every other move is mated at once by the chariot taking the advisor. A repetition rule couldn’t break it, because both sides are threatening on every move.',
        },
        {
          kind: 'paragraph',
          text: 'To launch it we added two rules. A cannon’s capture removes only the cannon and the piece it takes, with no blast around them. And a player who keeps a threat on the enemy general through every move of a repeated cycle loses, the way perpetual check loses in xiangqi. Either rule alone still left the loop.',
        },
        {
          kind: 'paragraph',
          text: 'With both rules in, the engine games stopped looping, but the cannon now played by its own rule. It could take a piece on the point beside its own general, and only those two pieces left the board. A chariot or horse could not make that capture at all, because its blast would take its own general. A player only learns why the cannon is different by reading the rules page. We launched Atomic before we had a design that worked without that patch.',
        },
        {
          kind: 'paragraph',
          text: 'A redesign has to give Atomic a cannon that follows the same rule as every other piece.',
        },
      ],
    },
    {
      heading: 'Both come back when they are right',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We would rather run a short list of games we stand behind than keep two that need an apology. Neither game is dead. Each has one problem to solve. Fortress needs a small board that drops do not take over, and Atomic needs a cannon with no exception. When a version of either one solves it, that game comes back.',
        },
      ],
    },
    playClosing({
      heading: 'Play Crazyhouse Xiangqi',
      lead: 'If dropping pieces was the part of Fortress you liked, Crazyhouse Xiangqi is where drops live on the site today.',
      playLabel: 'Play the computer',
      playHref: '/?play=computer&gameSpecId=crazyhouse-xiangqi',
      secondary: [
        { label: 'Crazyhouse Xiangqi rules', href: '/rules/crazyhouse-xiangqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
