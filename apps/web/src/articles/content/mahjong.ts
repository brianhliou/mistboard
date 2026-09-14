import { playClosing } from '../diagrams.js';
import type { Article } from '../types.js';

// Written while the table is admin-only, so it documents what THIS table does
// and scores, in that order. The faan values are the ones the kernel plays
// with (packages/mahjong/src/hk-patterns.ts, orthodox set, 10-faan limit) and
// have not been checked by a Hong Kong player; the page says so rather than
// claiming to be the Hong Kong rules. When the table is corrected, this page
// and the kernel change together. English only until then: a translated page
// is twelve strings to re-translate per correction.
export const mahjongArticle: Article = {
  slug: 'mahjong',
  gameSpecId: 'mahjong',
  kind: 'rules',
  title: 'Hong Kong Mahjong Rules',
  summary:
    'How a hand of Hong Kong mahjong is played on Mistboard: the deal, claiming discards, why a complete hand is not always a win, and the faan table the site scores with.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-13',
  playableOnMistboard: true,
  audience:
    'Someone sitting down at the Mistboard table for the first time, and anyone who has played a hand and wants to know why it was not a win.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Mahjong is a four-player game of drawing and discarding tiles until one player holds a complete hand. Hong Kong style is the version most people mean when they say mahjong in Cantonese: no complicated scoring elements, a short list of patterns, and one rule that trips up every newcomer, which is that a complete hand is not always a hand you can win with.',
    },
    {
      kind: 'paragraph',
      text: 'This page describes the table as Mistboard plays it. The mechanics are standard. The scoring values are the ones this site uses, and they have not yet been checked against a Hong Kong player, so treat the numbers as this table’s rules rather than as the last word on Hong Kong scoring.',
    },
  ],
  sections: [
    {
      heading: 'The tiles',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A set is 144 tiles. Three numbered suits run 1 to 9, four of each tile: characters (萬, marked with a Chinese numeral), dots (筒, drawn as circles) and bamboo (索, drawn as canes). Then the honours, also four each: the four winds (東南西北) and the three dragons (中發白). Finally eight bonus tiles, one each: four flowers (梅蘭菊竹) and four seasons (春夏秋冬), numbered 1 to 4.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard draws the dot and bamboo pips the way a printed tile has them, so a nine is a three-by-three block rather than a numeral. The characters suit is written, as on a real tile. Hover a tile in your hand for its name.',
        },
      ],
    },
    {
      heading: 'The table and the deal',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Four seats, named East, South, West and North. Play runs from East to South to West to North, which is anticlockwise around a real table, so the seat that plays after you is on your right. East deals and plays first. Each player receives thirteen tiles; East, who moves first, starts with fourteen and discards one.',
        },
        {
          kind: 'paragraph',
          text: 'The tiles nobody holds form the wall. Fourteen of them are set aside as the dead wall, used only for replacement draws. The rest is the live wall, and the number in the middle of the table counts what is left of it.',
        },
        {
          kind: 'paragraph',
          text: 'A flower or season is never part of a hand. When you draw one it goes face up beside your name and you draw a replacement from the dead wall. Flowers score, and yours are shown in the row with your seat name.',
        },
      ],
    },
    {
      heading: 'A turn',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn you draw one tile from the live wall and discard one tile from your hand. Mistboard draws for you, because there is exactly one tile you may take and no reason to decline it; your decision is the discard. Click a tile to throw it. Discards go face up into your pond, in rows of six, so everyone can see what you have let go.',
        },
        {
          kind: 'paragraph',
          text: 'A discard is not quite the end of your turn. For a few seconds it sits under claim: any other player who can use it may take it instead of drawing. If nobody claims it, play passes to the next seat, who draws as normal.',
        },
      ],
    },
    {
      heading: 'Claiming a discard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'There are four claims, and the table only offers you the ones you can make. Each one takes the discard into your hand as part of a set which is then laid face up beside your hand, declared. A declared set stays as it is for the rest of the hand and cannot be discarded from.',
        },
        {
          kind: 'table',
          headers: ['Claim', 'What you need', 'Who may make it'],
          rows: [
            [
              '上 Chow',
              'Two tiles in hand that make a run of three with the discard, in one numbered suit (a 4 with your 2 and 3, 3 and 5, or 5 and 6)',
              'Only the seat immediately after the discarder',
            ],
            ['碰 Pung', 'Two of the same tile in hand', 'Any other seat'],
            ['槓 Kong', 'Three of the same tile in hand', 'Any other seat'],
            ['食糊 Win', 'The discard completes a hand worth at least three faan', 'Any other seat'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'The chow restriction is the one that surprises people. If South throws a tile that fits your run and you are sitting at East, you cannot take it, because South is not the seat before you; only North’s discards can be chowed by East. The table tells you when this is why a tile that fits is not on offer.',
        },
        {
          kind: 'paragraph',
          text: 'When two players want the same discard, a win beats a kong or pung, and a pung beats a chow. Between two claims of the same rank, the seat nearest after the discarder wins. Two players can never both pung the same tile, since that would need five copies. Claiming a tile hands the turn to the claimant, skipping anyone in between, and the claimant then discards.',
        },
        {
          kind: 'paragraph',
          text: 'After a kong you have used four tiles for one set, so you draw a replacement from the dead wall before discarding. On this table a kong is always a claim: declaring one from your own hand (a concealed kong, or adding a fourth tile to a pung you already declared) is not offered yet, and neither is robbing such a kong.',
        },
        {
          kind: 'paragraph',
          text: 'A claim window is six seconds. Declining is a button, so you can pass at once rather than wait it out; if a discard can be claimed by nobody at all, the table moves on immediately.',
        },
      ],
    },
    {
      heading: 'A complete hand',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A complete hand is four sets and a pair: fourteen tiles, or more if any set is a kong. A set is three of a kind (a pung), four of a kind (a kong), or a run of three in one numbered suit (a chow). Runs do not wrap around, so 8-9-1 is not a run, and honours have no runs at all. The pair is any two identical tiles.',
        },
        {
          kind: 'paragraph',
          text: 'Declared sets count toward the four. So a player who has chowed twice needs two more sets and a pair from the tiles still in hand. The line under your pond tracks this for you: how many tiles away from complete you are, and when you are one away, that you are waiting.',
        },
        {
          kind: 'paragraph',
          text: 'You complete a hand in one of two ways. Either you draw the last tile yourself (自摸, self-draw), in which case a declare button appears and you win by pressing it, or another player discards it and you claim the win. A self-drawn win is worth one faan more.',
        },
      ],
    },
    {
      heading: 'Why a complete hand is not always a win',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Hong Kong mahjong scores every hand in faan (番). A plain hand of four sets and a pair with nothing special about it scores zero; it is called a chicken hand (雞糊). The rule of the table is 三番起糊: you may only declare a hand worth three faan or more. A complete hand worth less is not a win. You keep drawing and discarding, and you keep the option of breaking it up to build something that scores.',
        },
        {
          kind: 'paragraph',
          text: 'This is the rule to plan around from the first discard. Chows are quick to collect and worth nothing. A hand made of two chows, a pung of a wind that is not yours, and a pair is finished the moment the last tile lands and still cannot be declared: on a discard it scores whatever your flowers are worth and nothing else. The status line under your pond says so as soon as the hand is complete, but by then it is late. Count to three while you are still choosing what to keep.',
        },
        {
          kind: 'sub-heading',
          text: 'The cheapest ways to three',
        },
        {
          kind: 'paragraph',
          text: 'Most declarable hands get there by stacking small things or by committing to one big one.',
        },
        {
          kind: 'table',
          headers: ['Route', 'Faan', 'What it takes'],
          rows: [
            ['對對糊 All Pungs', '3', 'Four pungs or kongs and a pair, no chows. Three on its own'],
            ['混一色 Half Flush', '3', 'Every tile in one numbered suit or an honour. Three on its own'],
            ['Honour pungs', '1 each', 'A pung of any dragon (中發白), of your own seat wind, or of the round wind. East’s pung of 東 in an East round is two'],
            ['The one-faan bits', '1 each', '平糊 all four sets are chows; 門前清 you claimed nothing; 自摸 you drew the winning tile; 正花 a flower or season whose number matches your seat; 無花 you drew no flower at all'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'So a hand of four chows that you never claimed from and finish by self-draw is three: all chows, fully concealed, self-drawn. The same hand with one chow claimed drops to two and cannot be declared. A pung of your seat wind plus a pung of a dragon plus your flower is three with any shape around it. All pungs is three by itself and often carries an honour pung on top.',
        },
      ],
    },
    {
      heading: 'The faan table',
      blocks: [
        {
          kind: 'paragraph',
          text: 'These are the patterns the Mistboard table scores, with the value each adds. Patterns combine unless the table says otherwise: a half flush made of pungs is 3 plus 3, and a pung of a dragon inside it adds one more. A few patterns imply a smaller one and are listed at their combined value. The table pays a limit of ten faan; the hands marked as limit hands pay that limit however they are built.',
        },
        {
          kind: 'table',
          headers: ['Pattern', 'Faan', 'Notes'],
          rows: [
            ['平糊 All Chows', '1', 'Four chows and a pair'],
            ['門前清 Fully Concealed', '1', 'No claimed sets. A win on a discard still counts'],
            ['自摸 Self-drawn', '1', ''],
            ['無花 No Flowers', '1', 'You drew no flower or season all hand'],
            ['正花 Seat Flower', '1', 'Per flower or season matching your seat, at most one of each'],
            ['一台花 Complete Flower Set', '2', 'All four flowers or all four seasons; replaces the seat flowers of that series'],
            ['三元牌 Dragon Pung', '1', 'Per pung of 中, 發 or 白'],
            ['門風 Seat Wind Pung', '1', 'A pung of your own wind'],
            ['圈風 Round Wind Pung', '1', 'A pung of the round wind; scores again if it is also your seat wind'],
            ['海底撈月 Last Tile', '1', 'Winning on the last tile of the wall'],
            ['槓上開花 Kong Replacement', '2', 'Winning on the replacement tile after a kong, self-draw included'],
            ['對對糊 All Pungs', '3', 'Four pungs or kongs'],
            ['混一色 Half Flush', '3', 'One suit plus honours'],
            ['花幺九 All Terminals and Honours', '4', 'Every set and the pair made of 1s, 9s or honours; all pungs included'],
            ['小三元 Little Three Dragons', '5', 'Two dragon pungs and the third dragon as the pair, both pungs included'],
            ['小四喜 Little Four Winds', '6', 'Three wind pungs and the fourth wind as the pair'],
            ['清一色 Full Flush', '7', 'Every tile in one numbered suit'],
            ['大三元 Big Three Dragons', '8', 'All three dragons as pungs, the pungs included'],
            ['連槓開花 Kong on Kong', '8', 'Winning on the replacement after two kongs in a row'],
            ['八仙過海 Eight Flowers', '8', 'All eight flowers and seasons. Instant win'],
            ['坎坎糊 Four Concealed Pungs', '8', 'All pungs, nothing claimed. Stands alone'],
            ['字一色 All Honours', 'limit', 'Every tile a wind or dragon'],
            ['清幺九 All Terminals', 'limit', 'Every tile a 1 or a 9'],
            ['九蓮寶燈 Nine Gates', 'limit', '1112345678999 in one suit, concealed, completed by any tile of that suit'],
            ['大四喜 Big Four Winds', 'limit', 'All four winds as pungs'],
            ['十三幺 Thirteen Orphans', 'limit', 'One of each 1, 9, wind and dragon plus one duplicate'],
            ['十八羅漢 Four Kongs', 'limit', 'Four kongs and a pair'],
            ['天糊 / 地糊 / 人糊', 'limit', 'Completing on the deal, on the first draw, or on the first discard'],
          ],
          caption:
            'The orthodox Hong Kong set as this table scores it, limit ten faan. Seven pairs and the other imported patterns are not scored.',
        },
        {
          kind: 'paragraph',
          text: 'Payment between players is not settled on Mistboard yet. A hand ends with a winner and a faan count, and the next hand is a new room. Kongs declared from hand, robbing the kong, and the patterns that depend on them are also not on the table yet.',
        },
      ],
    },
    {
      heading: 'How a hand ends',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Someone declares a win, self-drawn or on a discard, and the hand is over. Or the live wall runs out with nobody having won, which is a draw (流局): no winner, nothing paid. On Mistboard each room is one hand; East does not rotate and there are no rounds yet.',
        },
      ],
    },
    {
      heading: 'Reading the table',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You sit at the bottom. The seat that plays after you is on your right, then across, then on your left, matching the turn order at a real table. Each opponent shows a rack of slivers for their concealed hand (the count is beside their name), their declared sets face up, and their pond. The badge in the middle shows the round wind, how many tiles are left in the wall, and the tile currently under claim.',
        },
        {
          kind: 'paragraph',
          text: 'The bar between your pond and your hand is where the table talks to you. Between turns it says how far your hand is from complete. When a discard you can claim lands, the claim buttons appear there with a strip draining toward the deadline. When you cannot claim, it says what was thrown and, if the tile fits your hand, why it is not on offer.',
        },
        {
          kind: 'paragraph',
          text: 'The clock runs for whoever is deciding and pauses while a discard is under claim. A marker beside a seat name means that seat is to play; a green mark means that seat is still deciding on a claim.',
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
              question: 'My hand is complete. Why can I not declare it?',
              answer:
                'It is worth fewer than three faan. Hong Kong mahjong requires three to declare (三番起糊). The status line under your pond says what the hand is worth; keep playing and build a pattern that scores, or wait for a self-draw, which adds one.',
            },
            {
              question: 'Someone threw a tile that fits my run. Why was there no chow button?',
              answer:
                'A chow may only take the discard of the seat immediately before you. Sitting at East, that is North. Tiles from South or West can only be claimed as a pung, a kong or a win.',
            },
            {
              question: 'What are the tiles beside a player’s name?',
              answer:
                'Flowers and seasons that player has drawn. They are never part of the hand. One whose number matches the seat (1 for East, 2 for South, 3 for West, 4 for North) is worth a faan; drawing none at all is also worth a faan.',
            },
            {
              question: 'Why did my declared set move out of my hand?',
              answer:
                'A claimed set is exposed and fixed. It counts as one of your four sets, but the tiles in it can no longer be discarded, so the table shows it beside your hand rather than in it.',
            },
            {
              question: 'Is this the standard Hong Kong scoring?',
              answer:
                'It is the orthodox Hong Kong pattern set with a ten-faan limit, as this site scores it. The values have not yet been checked by a Hong Kong player, and Hong Kong tables vary on several of them. If you play and see something scored wrongly, the feedback link is at the bottom of every page.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Hong Kong mahjong is on Mistboard as a one-hand table against three bots. It is still being tested and is open to invited accounts.',
      playLabel: 'Play a hand',
      playHref: '/?play=computer&gameSpecId=mahjong',
    }),
  ],
};
