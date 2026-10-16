import {
  XMJ32_CLAIM_ANIMATION_SVG,
  XMJ32_CLAIM_STATIC_SVG,
  XMJ32_DEAL_SVG,
  XMJ32_MATCH_HEADERS,
  XMJ32_PAIRS_SVG,
  XMJ32_SEQUENCES_SVG,
  XMJ32_SEQUENCES_SVG_2,
  XMJ32_TILES_SVG,
  XMJ32_TRIPLETS_SVG,
  XMJ32_WORKED_SVG,
  xmj32MatchRows,
  xmj32NotWinSvg,
  xmj32WinSvg,
} from '../../xiangqi-mahjong-32-rules-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Unlisted while Brian reviews it: HIDDEN_RULES_SLUGS (web) and
// NON_INDEXED_ARTICLE_SLUGS (server) keep it out of the rail, the /rules
// index, the sitemap and search; it answers by URL. No gameSpecId on purpose:
// listing then follows this slug, so the page stays unlisted when the variant
// itself goes public. English only (UNTRANSLATED_ARTICLE_SLUGS) until the
// English is signed off.
//
// Every tile row below is data in xiangqi-mahjong-32-rules-diagrams.ts, and
// its test runs each hand through xmjWinShape / xmjScore: a picture here
// cannot claim a win or a score the kernel would not give.

const win = (id: string, caption: string): ArticleBlock => ({
  kind: 'raw-svg',
  svg: xmj32WinSvg(id),
  caption,
});

const notWin = (id: string, caption: string): ArticleBlock => ({
  kind: 'raw-svg',
  svg: xmj32NotWinSvg(id),
  caption,
});

export const xiangqiMahjong32Article: Article = {
  slug: 'xiangqi-mahjong-32',
  kind: 'rules',
  title: 'Xiangqi Mahjong Rules (32 tiles)',
  summary:
    'The 32-tile game of Xiangqi Mahjong for two players: one xiangqi set used as tiles, five-tile hands, the winning hands drawn out, and the points each one scores.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-15',
  audience:
    'Xiangqi players who have never played mahjong, mahjong players who have never seen this game, and anyone at the Mistboard table who wants to know why a hand won.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Xiangqi Mahjong is a mahjong game played with the 32 pieces of a xiangqi set, a pastime from Taiwan. The pieces go face down as tiles, you draw and discard, and the first player to hold a complete hand wins. The hand is tiny: five tiles, which is one set of three and a pair. That makes the game fast, and it means you can learn the winning hands from the pictures on this page.',
    },
    {
      kind: 'paragraph',
      text: 'This page describes the two-player game as Mistboard’s table plays it, with the rules the sources agree on.',
    },
  ],
  sections: [
    {
      heading: 'The tiles',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The tiles are exactly one standard xiangqi set, the same 32 pieces you set up on a xiangqi board: sixteen red and sixteen black. Each side has one General, two Advisors, two Elephants, two Chariots, two Horses, two Cannons and five Soldiers. Colour works like a suit in mahjong. A set has to be all red or all black.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_TILES_SVG,
          caption: 'All 32 tiles. One General, five Soldiers and two of every other piece on each side.',
        },
        {
          kind: 'paragraph',
          text: 'Each tile shows its piece in the piece set you play xiangqi with on Mistboard, so you can play with figures or with the Chinese characters of a traditional set. The pictures on this page follow your piece set too, with each piece’s English name underneath.',
        },
      ],
    },
    {
      heading: 'Sets and the pair',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A **set** is three tiles of one colour, and there are only two kinds. A **sequence** is one of four fixed groups: General, Advisor and Elephant, or Chariot, Horse and Cannon, in red or in black. The order in your hand does not matter.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_SEQUENCES_SVG,
          caption: 'General, Advisor, Elephant: a sequence in each colour.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_SEQUENCES_SVG_2,
          caption: 'Chariot, Horse, Cannon: the other sequence in each colour.',
        },
        {
          kind: 'paragraph',
          text: 'A **triplet** is three identical tiles. Only the Soldiers have more than two of a kind, so the only triplets are three red Soldiers and three black Soldiers.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_TRIPLETS_SVG,
          caption: 'The two triplets the set allows.',
        },
        {
          kind: 'paragraph',
          text: 'A **pair** is two identical tiles. There is one exception: the red General and the black General also make a pair, even though they differ in colour. Each General is a single tile, so this is the only way a General can be in the pair at all, and it scores extra.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_PAIRS_SVG,
          caption: 'Pairs: two identical tiles, or the two Generals together.',
        },
      ],
    },
    {
      heading: 'The deal and a turn',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Shuffle the 32 tiles face down. The dealer takes five and the other player four; the other 23 are the wall, and both players draw from it. The table shows how many tiles are left in the wall.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_DEAL_SVG,
          caption: 'A deal from your seat: the dealer has five tiles, you have four, and 23 are left in the wall.',
        },
        {
          kind: 'paragraph',
          text: 'The dealer starts by discarding one tile, without drawing. From then on, a turn is: draw one tile from the wall, then either declare a win or discard one tile face up. Between turns you always hold four tiles, one short of a hand, and the fifth tile is the one you are waiting for.',
        },
        {
          kind: 'paragraph',
          text: 'If you discard the tile you just drew, it shows shaded in your discard row, so the other player knows you did not keep the new tile. If you discard from your hand instead, they know you kept it, but not which of your tiles you threw: the table always shows the tile leaving from the middle of your hand, never from the place it really sat.',
        },
      ],
    },
    {
      heading: 'Claiming a discard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When the other player discards, you may take that tile instead of drawing. You can claim it to win, if it completes your hand. Or you can claim it to finish a set: two tiles of a sequence and the discard as the third, or two Soldiers and a third. A claimed set goes face up, and you discard without drawing.',
        },
        {
          kind: 'paragraph',
          text: 'Deciding whether to claim takes time from your own clock, and there is no separate claim timer. If you pass, you draw as usual.',
        },
        {
          kind: 'paragraph',
          text: 'After every discard, the table waits about a second and a half before the next draw, whether or not anyone can claim. If it waited only when you could claim, the wait itself would tell the other player that their discard fits your hand.',
        },
        {
          kind: 'paragraph',
          text: 'Here is a claim. You hold the red Chariot and Horse, a black Elephant and a black Soldier, and the other player discards the red Cannon, the tile your sequence is missing.',
        },
        {
          kind: 'animated-svg',
          svg: XMJ32_CLAIM_ANIMATION_SVG,
          reducedSvg: XMJ32_CLAIM_STATIC_SVG,
          caption: 'You claim the Cannon instead of drawing. Chariot, Horse and Cannon go face up, set apart from your hand, with the claimed Cannon turned sideways, and you discard the Soldier without drawing. You keep the black Elephant and wait for the other one to make the pair.',
        },
        {
          kind: 'paragraph',
          text: 'You can lay down only one set this way, since a hand has room for one. There is no kong (four of a kind) in this game, and no declaring that you are one tile from winning.',
        },
      ],
    },
    {
      heading: 'How a hand ends',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A hand ends in one of three ways. You draw the tile that completes your hand and declare a win, which is a self-drawn win. Or the other player discards that tile and you claim it. Or the wall runs out with nobody winning: the hand is void, nobody scores, and the deal passes.',
        },
        {
          kind: 'paragraph',
          text: 'Two wins happen before the hand has really started. If the dealer’s opening five tiles already make a winning hand, that is a **heavenly hand**. If the other player wins with their first draw, before anyone has claimed a tile, that is an **earthly hand**.',
        },
      ],
    },
    {
      heading: 'Winning hands and their score',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A winning hand is five tiles: one set and one pair, counting a set you laid down after a claim. There are only three sets to make, a General sequence, a Chariot sequence or three Soldiers, so the first three hands below cover them all. A hand scores points; each caption gives what it scores when the player who did not deal wins it on a discard.',
        },
        win('palace', 'General, Advisor and Elephant, with any pair: 1 point.'),
        win('chariot', 'Chariot, Horse and Cannon, with any pair. The pair need not match the set’s colour: 1 point.'),
        win('soldiers', 'Three Soldiers of one colour, with any pair: 1 point.'),
        win('one-colour', 'One colour: every tile red, or every tile black. 1 more, for 2 points.'),
        win('generals', 'Generals pair: the red and the black General as the pair. 2 more, for 3 points.'),
        win(
          'five-soldiers',
          'Five Soldiers: all five Soldiers of one colour. 5 more, and it is one colour too: 7 points.',
        ),
        {
          kind: 'sub-heading',
          text: 'Close, but not a win',
        },
        {
          kind: 'paragraph',
          text: 'These look finished and are not. In each, the three tiles on the left fail to make a set or the two on the right fail to make a pair.',
        },
        notWin('mixed-colour', 'A red General and Elephant with a black Advisor. A sequence must be one colour.'),
        notWin(
          'mixed-group',
          'General, Advisor and Horse. The two sequences do not mix; Horse belongs with Chariot and Cannon.',
        ),
        notWin('mixed-soldiers', 'Two red Soldiers and a black one. A triplet is three identical tiles.'),
        notWin('mixed-pair', 'A red and a black Advisor. Only the two Generals pair across colours.'),
        {
          kind: 'sub-heading',
          text: 'Adding it up',
        },
        {
          kind: 'paragraph',
          text: 'Every winning hand scores 1. Add every line marked + that applies: the hand’s own lines from the pictures above, then how it was won.',
        },
        {
          kind: 'table',
          keyColumn: true,
          compact: true,
          headers: ['Line', 'Points', 'When'],
          rows: [
            ['Win', '1', 'Every winning hand'],
            ['One colour', '+1', 'All five tiles one colour'],
            ['Generals pair', '+2', 'The two Generals are the pair'],
            ['Five Soldiers', '+5', 'Five Soldiers of one colour'],
            ['Self-draw', '+2', 'You drew the winning tile'],
            ['Dealer', '+1', 'The dealer won'],
            ['Last tile', '+1', 'Self-draw on the last wall tile'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'The two special hands are the exception. Each scores a flat 6, and nothing is added to it.',
        },
        {
          kind: 'table',
          keyColumn: true,
          compact: true,
          headers: ['Special hand', 'Points', 'When'],
          rows: [
            ['Heavenly hand', '6', 'The dealer’s first five tiles win'],
            ['Earthly hand', '6', 'The other player wins on their first draw'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'A worked example. The dealer holds the red Chariot, Horse and Cannon and the red General, and draws the black General from the wall. That is a set and the Generals pair: 1 for the win, 2 for the Generals pair, 2 for the self-draw and 1 because the dealer won, 6 points in all. It is not one colour, since the pair is half black.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_WORKED_SVG,
          caption: 'The dealer draws the black General and declares a win.',
        },
      ],
    },
    {
      heading: 'The match',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A match is six hands, and the deal alternates every hand, so each player deals three times. The winner of a hand adds its points to their score, and the other score stays where it was. After six hands the higher score wins the match, and equal scores are a draw.',
        },
        {
          kind: 'paragraph',
          text: 'Here is a whole match between Ana and Ben, kept the way a mahjong scoreboard is. Ana deals hands 1, 3 and 5, and Ben deals 2, 4 and 6. Each column is one hand, with the points its winner scored from the table above; hands 2 and 6 are void, because the wall ran out.',
        },
        {
          kind: 'table',
          keyColumn: true,
          compact: true,
          headers: [...XMJ32_MATCH_HEADERS],
          rows: xmj32MatchRows(),
          highlightColumns: [5],
        },
        {
          kind: 'paragraph',
          text: 'Ana wins the match 7 to 6. The hand that decided it was the fifth: a self-draw on the last tile while she was dealer, worth 1 for the win, 2 for the self-draw, 1 as dealer and 1 for the last tile.',
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
              question: 'Where do these rules come from?',
              answer:
                'The game has no rulebook. The rules and point values here follow the Chinese Wikipedia article and the Eastking rule page, which agree, checked against other Taiwanese rule pages and FunTown’s online parlour. Where they are silent, Mistboard chose: the deal alternates every hand, and a match is six hands, since the sources play for money and give no match format.',
            },
            {
              question: 'Can more than two people play?',
              answer:
                'Folk sources play with two to four. With four, 17 tiles are dealt and only 15 stay in the wall, so each player gets about four draws, and claims on the other three players’ discards do much of the work. Mistboard plays the two-player game.',
            },
            {
              question: 'What if a player leaves before the match is over?',
              answer:
                'The other player wins the match, whatever the score. Leaving the game, running out of time and resigning all end the match the same way they end any game on Mistboard.',
            },
            {
              question: 'Why is there no kong or ready declaration?',
              answer:
                'The sources are silent on both, so Mistboard leaves them out. A kong would hardly come up anyway: it is four identical tiles, and only the Soldiers come in more than two.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Five tiles, one set and a pair. Learn the hands against the computer, then play a friend.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play vs computer', href: '/?play=computer&gameSpecId=xiangqi-mahjong', emphasis: 'primary' },
            { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=xiangqi-mahjong', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
