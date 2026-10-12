import {
  RETIRED_ATOMIC_PARRY,
  RETIRED_VARIANTS_THUMBNAIL,
} from '../../retired-variants-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Why Fortress Xiangqi and Atomic Xiangqi were closed to new games on
// 2026-10-11 (branch agent/retire-fortress-atomic). Sources: the Fortress rules
// page and docs-private/drop-game-lab/DESIGN-SPEC.md; the Atomic launch post and
// the lab record behind scripts/gen-atomic-diagrams.mts. The Fortress embed is
// game 17 of study NUVBVjFf, replayed through the Fortress kernel to its final
// position (Black mates with P@a2, ply 76). The Atomic embed is chapter
// FYndnT2d of study dPKhvJKb at ply 59 (30.Cxf2), the one cannon capture in
// that study that the four-point rules would have made illegal: its blast
// would have reached Red's own general on f1.

export const retiringFortressAndAtomicXiangqiArticle: Article = {
  slug: 'retiring-fortress-and-atomic-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Why we retired Fortress and Atomic Xiangqi',
  seoTitle: 'Why we retired Fortress Xiangqi and Atomic Xiangqi',
  cardTitle: 'Retiring Fortress and Atomic',
  summary:
    'On 11 October we closed Fortress Xiangqi and Atomic Xiangqi to new games. Fortress put four new ideas on one small board and the drops decided it; Atomic only stopped looping after we bolted an exception onto the cannon. Finished games still replay.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: RETIRED_VARIANTS_THUMBNAIL },
  status: 'published',
  publishedAt: '2026-10-13',
  boardFamily: 'xiangqi',
  audience: 'Players who tried Fortress Xiangqi or Atomic Xiangqi, and anyone who designs variants.',
  readNext: ['atomic-xiangqi-build'],
  tldr: [
    'Fortress Xiangqi and Atomic Xiangqi are closed to new games. Finished games still replay, and both rules pages stay up.',
    'Fortress mixed drops, a smaller board, corner palaces and a new piece. The drops decided the games, and Crazyhouse Xiangqi now has drops on the normal board.',
    'Atomic only played well after we gave the cannon its own exception and added a repetition rule. We launched it too fast.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'On 11 October we closed [Fortress Xiangqi](/rules/fortress-xiangqi) and [Atomic Xiangqi](/rules/atomic-xiangqi) to new games. Games already played still replay from their links, and both rules pages stay up for anyone who wants to read them. So why take down two games people could play?',
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
          text: 'Each idea was worth trying. Together they made a game that was hard to learn, and the drops overwhelmed the rest. With the general boxed into a corner of a small board, a soldier dropped beside it was usually the end. The engine game below is typical.',
        },
        {
          kind: 'embed',
          path: '/embed/study/NUVBVjFf/s5KWaDgY?ply=76',
          title: 'Fortress Xiangqi: an engine game decided by drops',
          caption:
            'The final position. Black mates the Red general in its corner with a soldier dropped on a2. Step back through the last few moves to see the drops that set it up.',
          aspect: [702, 826],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Since 2 October, [Crazyhouse Xiangqi](/rules/crazyhouse-xiangqi) has played the drop idea on the normal board, with the normal pieces and palaces. Fortress was built around drops, and Crazyhouse is the better home for them.',
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
          text: 'In the first version the cannon exploded like everything else, and that made it the best defender on the board. A cannon fires over exactly one piece, so a chariot that came onto a file beside the enemy general could become the screen for the cannon behind it.',
        },
        {
          kind: 'raw-svg',
          svg: RETIRED_ATOMIC_PARRY,
          caption:
            'Under the first rules. Red’s chariot on d2 threatens to take the advisor on d10 and blow up the general beside it. Black shoots first: the cannon on d8 fires over that same chariot onto d1, and the blast takes the advisor, the elephant, the chariot and Red’s general.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Every chariot attack could be answered this way. The chariot threatens, a cannon steps onto its file and threatens back through it, the chariot moves to the other file and the cannon follows. In engine games at full strength neither side could leave that loop. For the defender every other move lost at once, and the attacker who stepped away came out badly behind. Every best-play game also opened the same way, with each side’s cannon taking three pieces on move one.',
        },
        {
          kind: 'paragraph',
          text: 'To launch it we added two rules. A cannon’s capture removes only the cannon and the piece it takes, with no blast around them. And a player who keeps a threat on the enemy general through every move of a repeated cycle loses, the way perpetual check loses in xiangqi. Either rule alone still left the loop.',
        },
        {
          kind: 'embed',
          path: '/embed/study/dPKhvJKb/FYndnT2d?ply=59',
          title: 'Atomic Xiangqi as launched: a cannon capture beside its own general',
          caption:
            'Under the launch rules, 30.Cxf2 takes the black soldier on f2, next to Red’s own general and advisor. Only the cannon and the soldier leave the board. Under the first rules this shot would have blown up Red’s general.',
          aspect: [702, 700],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'With both rules in, the engine games stopped looping. The cannon was left following a rule no other piece follows, for a reason a player only learns by reading why it is there. We launched Atomic before we had a design that worked without that patch.',
        },
      ],
    },
    {
      heading: 'We would rather run fewer games we stand behind',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We retired Fortress because the drops carried it, and Crazyhouse Xiangqi now plays them on the board people already know. We retired Atomic because it only worked with an exception we had to explain. We would rather run a short list of games we stand behind. If a version of either game works, it comes back.',
        },
      ],
    },
    playClosing({
      heading: 'Play Crazyhouse Xiangqi',
      lead: 'If dropping pieces was the part of Fortress you liked, Crazyhouse Xiangqi has it on the normal board.',
      playLabel: 'Play the computer',
      playHref: '/?play=computer&gameSpecId=crazyhouse-xiangqi',
      secondary: [
        { label: 'Crazyhouse Xiangqi rules', href: '/rules/crazyhouse-xiangqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
