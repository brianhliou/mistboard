import type { XmjTile } from '@mistboard/game';
import {
  XMJ32_CLAIM_ANIMATION_SVG,
  XMJ32_CLAIM_STATIC_SVG,
  XMJ32_DEAL_SVG,
  XMJ32_TILES_SVG,
  XMJ32_WORKED_SVG,
  xmj32NotWinSvg,
  xmj32WinSvg,
} from '../../xiangqi-mahjong-32-rules-diagrams.js';
import {
  XMJ_GROUP_GAP,
  XMJ_TILE_DEPTH,
  XMJ_TILE_GAP,
  XMJ_TILE_H,
  XMJ_TILE_W,
  xmjTileSvg,
} from '../../xiangqi-mahjong-tile-svg.js';
import { activeXiangqiPieceSet } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The launch post for Xiangqi Mahjong: how to play, for a reader new to the
// game. Every rule here is the rules page's (/rules/xiangqi-mahjong-32), which
// follows the kernel in packages/game xiangqi-mahjong.ts; every tile picture is
// one of that page's diagrams, whose test runs each hand through xmjWinShape and
// xmjScore. Facts read from code, 2026-10-25: the first dealer is random in a
// live room (createXmjSetup; correspondence is held out at launch); the clock owner is the
// seat to discard or, after a discard, the claimant, and nobody between hands
// (xmjClockOwner); 1+1, 3+2 and 5+5 are rated, 10+5 casual (time-controls.ts),
// and the rated unit is the whole match (xiangqi-mahjong-registration.ts).

const win = (id: string, caption: string): ArticleBlock => ({
  kind: 'raw-svg',
  svg: xmj32WinSvg(id),
  caption,
});

// Card art: the rules page's worked hand (red chariot, horse and cannon with
// the two generals as the pair), the same hand the share card shows
// (server og-image.ts XMJ_OG_HAND), on the board colour. 320x200 is the card's
// 16/10 media box. Tiles only, no words, so the card reads in any language.
const THUMB_HAND: readonly (readonly XmjTile[])[] = [
  ['rR', 'rH', 'rC'],
  ['rK', 'bK'],
];
const THUMB_SCALE = 1.1;

const XMJ_LAUNCH_THUMBNAIL = (): string => {
  const tiles = THUMB_HAND.flat().length;
  const width =
    tiles * XMJ_TILE_W +
    (tiles - THUMB_HAND.length) * XMJ_TILE_GAP +
    (THUMB_HAND.length - 1) * XMJ_GROUP_GAP;
  const height = XMJ_TILE_H + XMJ_TILE_DEPTH;
  const tx = (320 - width * THUMB_SCALE) / 2;
  const ty = (200 - height * THUMB_SCALE) / 2;
  const parts: string[] = [];
  let x = 0;
  THUMB_HAND.forEach((group, gi) => {
    if (gi > 0) x += XMJ_GROUP_GAP - XMJ_TILE_GAP;
    for (const tile of group) {
      parts.push(xmjTileSvg(tile, x, 0, activeXiangqiPieceSet));
      x += XMJ_TILE_W + XMJ_TILE_GAP;
    }
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="A winning Xiangqi Mahjong hand: red chariot, horse and cannon with the two generals">',
    '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
    `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${THUMB_SCALE})">`,
    parts.join(''),
    '</g>',
    '</svg>',
  ].join('');
};

export const howToPlayXiangqiMahjongArticle: Article = {
  slug: 'how-to-play-xiangqi-mahjong',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'How to Play Xiangqi Mahjong',
  summary:
    'Xiangqi Mahjong is a folk game from Taiwan that plays one 32-piece xiangqi set as mahjong tiles. How a turn goes, what makes a winning hand, how it scores, and how to start a match on Mistboard.',
  showSummaryOnPage: false,
  thumbnail: { kind: 'svg', svg: XMJ_LAUNCH_THUMBNAIL },
  // Draft until the zh pages exist (article-i18n.ts): English is translated only
  // after Brian signs it off, and a published article with no zh decision fails
  // article-i18n.coverage.test.ts. At sign-off: translate, add the slug to
  // TRANSLATED_ARTICLE_SLUGS, flip this to 'published', then `npm run
  // articles:meta` and `npm run articles:fingerprint`.
  status: 'draft',
  publishedAt: '2026-11-06',
  audience:
    'Xiangqi players who have never played mahjong, mahjong players who have never seen this game, and anyone about to sit down at the Xiangqi Mahjong table for the first time.',
  readNext: ['xiangqi-mahjong-32'],
  tldr: [
    'The tiles are one xiangqi set: 32 pieces, red and black, and colour works like a suit.',
    'A winning hand is five tiles, one set of three and a pair.',
    'A match is six hands on one clock, and each player deals three times.',
    'Play Misty, a friend or the lobby at 1+1 to 10+5; a rated game counts all six hands as one result.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'In Taiwan, people play mahjong with a xiangqi set. Turn the 32 pieces face down and shuffle them, and they are tiles: you draw, you discard, and the first player to hold a complete hand of five tiles wins.',
    },
    {
      kind: 'paragraph',
      text: 'Mistboard plays the two-player game. Xiangqi players already know the tiles and mahjong players already know the turn, but you need neither to start.',
    },
  ],
  sections: [
    {
      heading: 'The tiles are one xiangqi set',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The 32 tiles are the pieces you set up on a xiangqi board, 16 red and 16 black. Each side has one general, two advisors, two elephants, two chariots, two horses, two cannons and five soldiers. There’s no board, and nothing moves. A tile is its piece and its colour, and colour works like a suit in mahjong.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_TILES_SVG,
          caption: 'The tiles follow the piece set you play xiangqi with, figures or traditional characters.',
        },
      ],
    },
    {
      heading: 'A winning hand is one set and a pair',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win with five tiles that make one set of three and one pair. There are three kinds of set, and a set is always one colour: general, advisor and elephant; chariot, horse and cannon; or three soldiers. A pair is two identical tiles, with one exception. The red general and the black general pair with each other.',
        },
        win('palace', 'General, advisor and elephant, with a pair of horses.'),
        win('chariot', 'Chariot, horse and cannon. The pair can be either colour.'),
        win('soldiers', 'Three soldiers, with a pair of advisors.'),
        {
          kind: 'paragraph',
          text: 'A set with one tile of the other colour does not count, however finished the hand looks.',
        },
        {
          kind: 'raw-svg',
          svg: xmj32NotWinSvg('mixed-colour'),
          caption: 'Not a win: the advisor is black, and a set must be one colour.',
        },
      ],
    },
    {
      heading: 'A turn is one draw and one discard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The dealer takes five tiles and the other player four. The other 23 stay face down as the wall, and both players draw from it. The dealer opens by discarding one tile, without drawing.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_DEAL_SVG,
          caption: 'A deal seen from your seat, with the other player dealing.',
        },
        {
          kind: 'paragraph',
          text: 'After that every turn is the same. Draw a tile from the wall, then declare a win or throw one tile away face up. Between turns you hold four tiles, one short of a hand, and you’re waiting on the fifth.',
        },
        {
          kind: 'paragraph',
          text: 'The other player’s discards count too. When they throw a tile away, you can take it in place of your next draw, to win or to finish a set: two tiles of a sequence and the discard, or two soldiers and a third. A claimed set goes face up beside your hand, and you discard without drawing. A hand has room for one set, so you can claim a set once in a hand, and claim a winning tile any time. Mahjong players should know there’s no kong and no declaring ready.',
        },
        {
          kind: 'animated-svg',
          svg: XMJ32_CLAIM_ANIMATION_SVG,
          reducedSvg: XMJ32_CLAIM_STATIC_SVG,
          caption: 'You hold the red chariot and horse. The other player discards the red cannon, you claim it, and you discard the soldier without drawing.',
        },
        {
          kind: 'paragraph',
          text: 'Deciding whether to claim takes time from your own clock. After every discard the table waits about a second and a half, whether or not anyone can claim, so the pause never tells the other player that their tile fit your hand.',
        },
        {
          kind: 'paragraph',
          text: 'A hand ends when someone wins, by drawing the winning tile (a self-drawn win) or by claiming it from a discard. If the wall runs out first, the hand is void. Nobody scores, and the deal passes.',
        },
      ],
    },
    {
      heading: 'Every win scores 1 point, plus extras',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A winning hand scores 1 point, and every line below that applies adds to it. Some lines are about the hand itself, and some are about how you won it.',
        },
        {
          kind: 'table',
          keyColumn: true,
          compact: true,
          headers: ['Line', 'Points', 'When'],
          rows: [
            ['Win', '1', 'Every winning hand'],
            ['One colour', '+1', 'All five tiles one colour'],
            ['One general', '+1', 'One general in the hand and not the other'],
            ['Generals pair', '+2', 'The two generals are the pair'],
            ['Three of a piece', '+2', 'Three advisors, elephants, chariots, horses or cannons'],
            ['Mixed soldiers', '+2', 'Five soldiers of both colours'],
            ['Five soldiers', '+5', 'Five soldiers of one colour'],
            ['Self-draw', '+2', 'You drew the winning tile'],
            ['Last tile', '+1', 'Self-draw on the last wall tile'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'One hand skips the table and scores a flat 6: the **heavenly hand**, a win on either player’s first five tiles, before anyone has claimed a tile. Dealing earns nothing extra.',
        },
        {
          kind: 'paragraph',
          text: 'Here’s a hand that adds up. The dealer holds the red chariot, horse and cannon and the red general, then draws the black general. That’s 1 for the win, 2 for the generals pair and 2 for the self-draw, 5 points in all.',
        },
        {
          kind: 'raw-svg',
          svg: XMJ32_WORKED_SVG,
        },
      ],
    },
    {
      heading: 'A match is six hands on one clock',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The deal passes every hand, so in a six-hand match each player deals three times. The first dealer is drawn at random. The winner of a hand adds its points to their score, and the other score stays where it was. After six hands the higher score wins the match, and equal scores are a draw.',
        },
        {
          kind: 'paragraph',
          text: 'Each player has one clock for all six hands, and it stops between hands. Pick 1+1, 3+2, 5+5 or 10+5. A turn is a single draw and discard, so the increment goes a long way: at 5+5 I finished a match with nearly six minutes left, more than I started with. Running out of time, resigning or leaving loses the match, whatever the score.',
        },
        {
          kind: 'paragraph',
          text: 'Games at 1+1, 3+2 and 5+5 between two signed-in players can be rated, and the rating counts the match as one result, all six hands together. Games at 10+5 and against Misty are unrated.',
        },
      ],
    },
    {
      heading: 'Start a match',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Misty, Mistboard’s bot, is the quickest way to learn the hands, and it’s there any time. You can also challenge a friend, or post or answer a seek in the lobby. The rules page draws every winning hand and scores a sample six-hand match from the first deal to the last.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play Misty',
              href: '/?play=computer&gameSpecId=xiangqi-mahjong',
              emphasis: 'primary',
            },
            { label: 'Read the rules', href: '/rules/xiangqi-mahjong-32', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
