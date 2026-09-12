import {
  DUCK_XIANGQI_CANNON_SCREEN,
  DUCK_XIANGQI_SHARED_SCREEN,
  DUCK_XIANGQI_THUMBNAIL,
  DUCK_XIANGQI_TURN_PAIR,
} from '../../duck-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const duckXiangqiBuildArticle: Article = {
  slug: 'duck-xiangqi-build',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Duck Xiangqi Is Live: How Not to Lose Your First Game',
  seoTitle: 'Duck Xiangqi: How Not to Lose Your First Game',
  summary:
    'Chinese chess with one duck both players share. The rules take a minute; the four things that actually decide your first game take longer, and three of them are the opposite of the instinct.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-11',
  audience:
    'Anyone who has just read the Duck Xiangqi rules and is about to play, and xiangqi players wondering whether the duck changes anything real.',
  thumbnail: { kind: 'svg', svg: DUCK_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Duck Xiangqi is live today. It is Chinese chess with one duck that both players share: you make an ordinary xiangqi move, then you put the duck on any empty point. It blocks everything, belongs to nobody, and cannot be captured. The rules take about a minute to read.',
    },
    {
      kind: 'paragraph',
      text: 'What follows is not the rules. It is what decides your first game, starting with the one that catches everybody: the most obstructive-looking square for the duck is often the losing one. These come from the seven engine games behind this launch, and from measuring the engine itself.',
    },
  ],
  sections: [
    {
      heading: 'A turn is a move plus a duck placement',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every turn you move a piece and then place the duck. The move is xiangqi and you already know how to think about it. The placement is the new game, and it is where first games are lost.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_TURN_PAIR,
          caption:
            'One turn, both halves. The move on the left is ordinary xiangqi; the duck on the right is the part with no precedent.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The duck is a cannon screen for whoever moves next',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A cannon captures by jumping exactly one piece, and the duck counts as that piece. This is the most important thing on this page, and it follows from the order of a turn rather than from any subtlety: you place the duck at the END of your move, so the next person to play is your opponent. Any cannon line you just completed is theirs to fire down first.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_CANNON_SCREEN,
          caption:
            'The duck as a cannon platform. Nothing marks it as either side’s: whoever is to move gets to use it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The practical habit: before you place the duck, look along the ranks and files it will sit on and check whether an enemy cannon has just been handed a target. The square that most obstructs your opponent is usually a square next to their pieces, which is exactly where it is most likely to arm one of their cannons.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_SHARED_SCREEN,
          caption:
            'From a real engine game. Both cannons are ringed because the duck on e2 serves each of them, but only the side to move collects: here that is Red, taking on d2. Neither capture exists without the duck, and whoever moves has to move it again.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'There is no check and no checkmate',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You may leave your general attacked, move it onto an attacked point, and nothing on the board or in the interface says a word. Your opponent wins by actually taking it, and the game ends there.',
        },
        {
          kind: 'paragraph',
          text: 'This is not a theoretical risk. All seven of the engine games we published end with a general captured outright. Not one reached a resignation, a repetition or a stalemate: every game ended because somebody could take the general and did. Count the threats yourself, every turn, including the ones the duck just opened.',
        },
      ],
    },
    {
      heading: 'The duck must move every turn',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A duck jamming a horse’s leg, filling an elephant’s eye or holding a file is doing that job for exactly one turn. Then it is your problem again: on your next turn you have to pick it up and put it somewhere else.',
        },
        {
          kind: 'paragraph',
          text: 'So a block is never a structure, only a delay, and it is worth one turn of inconvenience rather than a wall. It also means you can be forced to open a line against yourself, because standing still is not among your options.',
        },
      ],
    },
    {
      heading: 'The bot places the duck at random',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The bot is a patched Fairy-Stockfish and it plays the piece half of its turn properly. The duck half it essentially guesses, and that is measurable rather than a suspicion.',
        },
        {
          kind: 'paragraph',
          text: 'We scored every legal duck placement after the engine’s own opening move, 58 of them, and the engine returned an identical evaluation for all 58. Raising the search from 300,000 nodes to four million changed the number but not the verdict: still identical across every placement. Fairy-Stockfish has no evaluation term for a duck or a wall, so nothing in its scoring can prefer one point to another, and the placement it reports is whatever its move ordering happened to surface.',
        },
        {
          kind: 'paragraph',
          text: 'That makes it a real opponent for the xiangqi half of the game and a poor teacher for the duck half. If its placements look arbitrary to you, it is because they are. The games are still worth reading for the piece play, and the study below has all seven.',
        },
      ],
    },
    {
      heading: 'The generals may face each other',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In ordinary xiangqi that is forbidden. Here the prohibition stopped making sense once check was gone, so flying the general is simply a capture that ends the game. It is one more threat with no warning attached, and one more line the duck can open or close.',
        },
      ],
    },
    {
      heading: 'Games run 120 to 229 plies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'That is the range across the seven engine games. Expect a full-length game rather than a novelty, and pick a clock accordingly: the two paces offered here are 5+5 and 10+5 for exactly this reason.',
        },
      ],
    },
    playClosing({
      heading: 'Play it',
      lead: 'Eight engine strengths, or a friend. The rules page has the whole thing with diagrams, and the study has all seven engine games if you want to watch it played first.',
      playLabel: 'Play Duck Xiangqi',
      playHref: '/?play=computer&gameSpecId=duck-xiangqi',
      secondary: [
        { label: 'Rules', href: '/rules/duck-xiangqi', emphasis: 'secondary' },
        { label: 'Seven engine games', href: '/study/uMbk76wd', emphasis: 'secondary' },
      ],
    }),
  ],
};
