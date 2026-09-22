import {
  BANQI_CANNON_AS_TARGET,
  BANQI_CANNON_FRIENDLY_SCREEN,
  BANQI_CANNON_NO_SCREEN,
  BANQI_CANNON_SCREEN,
  BANQI_FIRST_FLIP,
  BANQI_GENERAL_CANNOT_TAKE_SOLDIER,
  BANQI_RANK_CAPTURE,
  BANQI_RANK_LADDER,
  BANQI_SETUP,
  BANQI_SOLDIER_CANNOT_TAKE_CANNON,
  BANQI_SOLDIER_TAKES_GENERAL,
  BANQI_STEP,
} from '../../banqi-rules-diagrams.js';
import { BANQI_RULES_THUMBNAIL } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Re-cut 2026-09-21 on Brian's read of the page: the custom diagrams go, and
// every rule is shown on the real board renderer with the board's own move
// hints (banqi-rules-diagrams.ts, each one checked against the kernel); the
// ladder is the jungle page's row; the prose is shorter; the FAQ keeps only the
// questions people actually search. The sample game moves to the companion
// study once the engine games are in.
export const banqiArticle: Article = {
  slug: 'banqi',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Banqi Rules (Chinese Dark Chess)',
  summary:
    'Banqi, also called Chinese dark chess or blind chess: the 4 by 8 half-board game with face-down pieces, rank captures, and screen-jumping cannons. Play it free in your browser.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-15',
  updatedAt: '2026-09-21',
  audience:
    'Experienced Banqi players and newcomers who want the rank ladder, screen-jumping cannon, and Mistboard rules explained on one page.',
  thumbnail: { kind: 'svg', svg: BANQI_RULES_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi, also called Chinese dark chess or blind chess, is a fast hidden-piece game played on half a xiangqi board. All thirty-two pieces begin shuffled and face-down. The first flip assigns colors. After that, each turn is a choice: flip a tile or move a revealed piece. Captures follow rank, except for the cannon.',
    },
    {
      kind: 'paragraph',
      text: 'Although it uses [Xiangqi](/rules/xiangqi) pieces, it is a separate game: pieces move one square, the general is not royal, and face-down tiles cannot be captured. This page describes the exact rules used on Mistboard.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board is half a xiangqi board, a 4 by 8 grid. Pieces sit in the squares, and the thirty-two shuffled pieces fill it exactly, every one face-down.',
        },
        {
          kind: 'paragraph',
          text: 'Colors are not assigned in advance. The first player flips any tile: whatever color comes up is theirs for the game, and the opponent plays the other.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: BANQI_SETUP, caption: 'Before the first flip. Nobody has a color yet.' },
            {
              svg: BANQI_FIRST_FLIP,
              caption: 'The first flip turned up red, so the player who flipped it is red.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Turns',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn you do exactly one of two things.',
        },
        {
          kind: 'paragraph',
          text: '**Flip** any face-down tile. It turns over for both players to see, whichever color it turns out to be, and your turn is over.',
        },
        {
          kind: 'paragraph',
          text: '**Move** one of your revealed pieces one square up, down, left, or right, onto an empty square or onto an enemy piece it outranks, which captures it. Face-down tiles block the way and cannot be captured.',
        },
        {
          kind: 'paragraph',
          text: 'The cannon is the one exception to both the movement and the ranks below: it moves one square like everything else, but it captures by jumping, not by stepping, and rank does not apply to what it takes.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_STEP,
          caption: 'The selected horse can move to the three marked squares. The face-down tile above it is not a destination.',
        },
      ],
    },
    {
      heading: 'Capture by rank',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Strongest to weakest: general, advisor, elephant, chariot, horse, soldier. A piece captures an adjacent revealed enemy of equal or lower rank.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_RANK_LADDER,
          caption:
            'Strongest at the left, weakest at the right. The cannon captures by jumping; as a target it ranks where it stands here, between the horse and the soldier.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_RANK_CAPTURE,
          caption: 'The horse may take the soldier or the other horse, not the chariot above it.',
        },
        {
          kind: 'paragraph',
          text: 'One exception connects the ends of the ladder: the soldier can capture the general, and the general cannot capture a soldier.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_SOLDIER_TAKES_GENERAL,
          caption: 'The lowest piece can take the highest.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_GENERAL_CANNOT_TAKE_SOLDIER,
          caption: 'The general cannot take the soldier back; the advisor beside it, it can.',
        },
      ],
    },
    {
      heading: 'The cannon',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The cannon captures along a row or column by jumping exactly one piece, the screen, and taking the first revealed enemy beyond it, whatever its rank. The screen can be any piece: friendly, enemy, or face-down. With nothing to jump, it cannot capture at all, so an adjacent piece is safe from it. Without a capture it moves one square like everything else.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_CANNON_SCREEN,
          caption: 'One screen, then the target. Rank does not matter: the cannon takes the general.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_CANNON_NO_SCREEN,
          caption: 'No screen, no capture: the chariot beside it is safe, and so is the horse two squares up with nothing between.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_CANNON_FRIENDLY_SCREEN,
          caption: 'A friendly piece is a screen too. The face-down tile beyond the elephant is not a target.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_CANNON_AS_TARGET,
          caption: 'As a target, the cannon is below the horse: the horse may take it.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_SOLDIER_CANNOT_TAKE_CANNON,
          caption: 'A soldier cannot take a cannon. It can take the other soldier, or the general.',
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win when your opponent has no legal move, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal: capturing it is progress, not the win, and play continues until one side is wiped out or stuck.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard draws a game two ways: 40 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly.',
        },
      ],
    },
    {
      heading: 'Rule variants',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Banqi is a folk game and the rules differ by region. Three families are common. Taiwanese rules use the ladder above and a cannon that captures by jumping one screen. Hong Kong rules rank the pieces general, chariot, horse, cannon, advisor, elephant, soldier, with the cannon inside the ladder. Mainland rules usually have no jumping cannon at all: it captures adjacent pieces by rank like everything else.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard plays Taiwanese banqi with the competition draw rules of the Taiwan Computer Game Association (Chen, Shen and Hsu, ICGA Journal, 2010): the 40-ply no-progress clock and the repetition draw above. Two documented house rules are deliberately not used: a cannon may not capture a face-down tile, and the general never captures a soldier, not even on its first move. If you learned a different ladder, the one on this page is the one the engine and every game on the site follow.',
        },
      ],
    },
    {
      heading: 'An engine game',
      blocks: [
        {
          kind: 'paragraph',
          text: '[MistyBanqi](/blog/mistybanqi) against itself at ten million nodes a move, three times the strength the site’s bot plays at. Step through it with the arrows. The [companion study](/study/FsA5sowX) has all twenty games from the run, one chapter each, with a note on how it went. Two hundred games from the same run are reduced to numbers in [Banqi by the Numbers](/blog/banqi-statistics): how big a lead is safe, and when a game is decided.',
        },
        {
          kind: 'embed',
          path: '/embed/study/FsA5sowX/F8fezAhm',
          title: 'Banqi: an engine game under the competition rules',
          // Width-bound at the article column: a 2:1 board beside the 226px
          // sheet, plus the seat rows, controls and credit line.
          aspect: [702, 440],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'What is the capture order in banqi?',
              answer:
                'General > Advisor > Elephant > Chariot > Horse > Soldier. A piece captures its own rank or anything below it. Two exceptions: the soldier can capture the general, and the general cannot capture a soldier. The cannon captures by jumping and sits outside the ladder.',
            },
            {
              question: 'How does the cannon capture in banqi?',
              answer:
                'Under the Taiwanese rules this site plays: it moves along a row or column, jumps over exactly one piece (face-up or face-down, either color), and captures the first revealed enemy beyond it, whatever its rank. It cannot capture an adjacent piece because it needs that one piece to jump. Without a capture it moves one square like everything else. Hong Kong and mainland tables differ; see Rule variants above.',
            },
            {
              question: 'Can a soldier capture a cannon?',
              answer:
                'No. A soldier captures only soldiers and the general. As a target, the cannon ranks between the horse and the soldier, so the horse and everything above it can take a cannon, and a soldier cannot.',
            },
            {
              question: 'Can a horse capture a chariot?',
              answer: 'No. The chariot outranks the horse. A horse captures horses, cannons, and soldiers.',
            },
            {
              question: 'Can you capture more than once in a turn?',
              answer:
                'No. A turn is exactly one action: flip one face-down tile, or move one revealed piece one square, capturing or not. There are no chain captures on Mistboard.',
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
          text: 'Play against the engine or challenge a friend. No account required.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play vs computer', href: '/?play=computer&gameSpecId=banqi', emphasis: 'primary' },
            { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=banqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
