import {
  DUCK_XIANGQI_CANNON_SCREEN,
  DUCK_XIANGQI_SHARED_SCREEN,
  DUCK_XIANGQI_THUMBNAIL,
} from '../../duck-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const duckXiangqiBuildArticle: Article = {
  slug: 'duck-xiangqi-build',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Duck Xiangqi Is Live',
  seoTitle: 'Duck Xiangqi: Duck Chess on the Chinese Chess Board',
  summary:
    'Chess.com made Duck Chess an official variant in 2022. Nobody had put it on a xiangqi board, where four different rules ask whether a point is occupied instead of one. Now you can play it.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-11',
  audience:
    'Xiangqi players who want a new game on a familiar board, and Duck Chess players who want to know what the duck does somewhere it has never been.',
  thumbnail: { kind: 'svg', svg: DUCK_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Chess.com made [Duck Chess](https://www.chess.com/variants/duck-chess) an official variant in October 2022, alongside Seirawan and Setup Chess. You make your move, then you drop a duck on any empty square, and it blocks both players until somebody moves it again. Dr Tim Paulden invented it in 2016. It is a joke that turns out to be a real game, which is the best kind.',
    },
    {
      kind: 'paragraph',
      text: 'Nobody had put it on a xiangqi board. So we did, and it is live today.',
    },
  ],
  sections: [
    {
      heading: 'Four ways to be in the way',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Duck Xiangqi is the game you already know, on the 9 by 10 board, with one duck that both players take turns moving. It is not a reskin. Chess has exactly one way to block a piece: stand on the square it wants. Xiangqi has four.',
        },
        {
          kind: 'paragraph',
          text: 'A horse has a leg, and anything on the leg stops it. An elephant has an eye. A cannon needs a screen to capture over, and takes one from any piece at all. The two generals bear on each other down any open file. Every one of those rules asks whether a point is occupied, and the duck occupies.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_CANNON_SCREEN,
          caption:
            'The cannon on e3 stops short of the duck, and shoots over it to take the chariot on e8. A screen is a screen, whoever it belongs to.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The cannon is where it gets strange. You place the duck at the end of your turn, which means the screen you just built is your opponent’s to fire over and never yours. The most obstructive square on the board is usually the one that hands their cannon a platform aimed at you.',
        },
      ],
    },
    {
      heading: 'The duck may never stand still',
      blocks: [
        {
          kind: 'paragraph',
          text: 'It has to move every single turn. A duck holding a file, jamming a horse’s leg, or filling an elephant’s eye is doing that job for exactly one turn, and then you have to decide again.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_SHARED_SCREEN,
          caption:
            'From a real engine game. Both cannons are ringed because either can take the other, and neither capture exists without the duck on e2. It is a battery with an expiry date: whoever moves has to move the duck.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'A platform that belongs to nobody and is guaranteed to be gone next turn is not something a xiangqi board has ever had. Neither has a chessboard.',
        },
      ],
    },
    playClosing({
      heading: 'Play it',
      lead: 'Eight engine strengths, or a friend. Ratings and a ladder work here the way they do for every variant we run, so the games count. The rules page has the whole thing with diagrams, and there is a study of seven engine games if you want to see it played properly first.',
      playLabel: 'Play Duck Xiangqi',
      playHref: '/?play=computer&gameSpecId=duck-xiangqi',
      secondary: [
        { label: 'Rules', href: '/rules/duck-xiangqi', emphasis: 'secondary' },
        { label: 'Seven engine games', href: '/study/uMbk76wd', emphasis: 'secondary' },
      ],
    }),
  ],
};
