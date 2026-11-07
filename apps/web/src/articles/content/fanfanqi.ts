import { BANQI_RANK_LADDER } from '../../banqi-rules-diagrams.js';
import {
  FANFANQI_CANNON_CAPTURES,
  FANFANQI_FIRST_FLIP,
  FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER,
  FANFANQI_REPLY_FLIP,
  FANFANQI_SETUP,
  FANFANQI_SOLDIER_TAKES_GENERAL,
} from '../../fanfanqi-rules-diagrams.js';
import type { Article } from '../types.js';

// Keep this page aligned with FFQ_BANQI_RULES in variants-ffq-banqi.ts.
// A draft for the local playtest; production does not publish it.
export const fanfanqiArticle: Article = {
  slug: 'fanfanqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Fanfanqi Rules',
  summary:
    'Fanfanqi uses a 4 by 8 board, hidden pieces and a 60 HP race. Learn the rank ladder, capture-only cannons, damage values, chase limit and draw rule.',
  showSummaryOnPage: false,
  status: 'draft',
  audience: 'Players learning Fanfanqi or comparing its HP rules with banqi.',
  tldr: [
    'Four pieces start face up. Each turn, flip a covered piece or move one of your face-up pieces.',
    'Captures follow a rank ladder. Cannons only capture and can take covered pieces of either color.',
    'Both players start with 60 HP. A captured piece costs its owner HP, even when the owner made the capture.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Fanfanqi is a faster form of [banqi](/rules/banqi), scored by HP. Hidden pieces and a rank ladder make each flip matter, and every capture costs the captured piece’s owner HP. Bring your opponent to zero to win.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board has 4 by 8 squares. Each color has one general, two advisors, two elephants, two chariots, two horses, two cannons and five soldiers. Shuffle all 32 pieces onto the board. Four fixed squares start face up. The other 28 start face down. The four face-up squares are fixed, and the pieces on them are whatever the shuffle put there.',
        },
        {
          kind: 'paragraph',
          text: 'Red moves before Black. The seats have fixed colors from the start. Flipping a piece never changes your color. Both players can see which pieces remain covered, but cannot see which piece is under each back.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: FANFANQI_SETUP, caption: 'Before the first turn.' },
            { svg: FANFANQI_FIRST_FLIP, caption: 'After Red’s first flip. The tint marks that tile.' },
            { svg: FANFANQI_REPLY_FLIP, caption: 'After Black’s reply flip. The tint marks that tile.' },
          ],
        },
      ],
    },
    {
      heading: 'Turns and flips',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn, flip one covered piece or move one of your face-up pieces. A flip takes the whole turn. You may flip any covered piece, even one that turns out to belong to your opponent. You may move a face-up piece on the opening turn.',
        },
      ],
    },
    {
      heading: 'Steps and the rank ladder',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every piece except the cannon moves one square up, down, left or right. It can step onto an empty square or capture a face-up enemy it outranks or matches. It cannot land on a covered piece or a friendly piece. There are no diagonal moves.',
        },
        {
          kind: 'paragraph',
          text: 'The rank ladder, from highest to lowest, is **general > advisor > elephant > chariot > horse > cannon > soldier**. Two exceptions apply: a general cannot capture a soldier, and a soldier can capture a soldier or a general. There is no check. Capturing the general follows the same HP rules as any other capture.',
        },
        { kind: 'raw-svg', svg: BANQI_RANK_LADDER },
        {
          kind: 'svg-row',
          items: [
            {
              svg: FANFANQI_SOLDIER_TAKES_GENERAL,
              caption: 'The ring marks a capture; dots mark empty destinations.',
            },
            {
              svg: FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER,
              caption: 'Dots mark empty destinations. The soldier has no capture ring.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Cannons only capture',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A cannon cannot move to an empty square. To capture along a row or column, it jumps exactly one occupied square, called the screen. The screen may be face up or face down and may belong to either player. The next occupied square is the target. The cannon cannot skip it to reach a piece farther away.',
        },
        {
          kind: 'paragraph',
          text: 'The target may be a face-up enemy of any rank or a covered piece of either color. A cannon cannot capture a face-up friendly piece. A covered capture is shown to both players, including its color and piece type. Pieces still covered on the board stay hidden, even after the game ends.',
        },
        {
          kind: 'raw-svg',
          svg: FANFANQI_CANNON_CAPTURES,
          caption: 'The dot on the back and the ring on the face-up piece mark capture targets.',
        },
      ],
    },
    {
      heading: 'HP and capture damage',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Both players start with **60 HP**. Each capture removes HP from the owner of the captured piece. The damage depends on that piece:',
        },
        {
          kind: 'table',
          headers: ['Captured piece', 'HP lost'],
          keyColumn: true,
          rows: [
            ['Soldier', '2'],
            ['Cannon', '5'],
            ['Horse', '5'],
            ['Chariot', '5'],
            ['Elephant', '5'],
            ['Advisor', '10'],
            ['General', '30'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'If your cannon captures a covered piece of your own color, you lose the HP. This can lose you the game. HP stops at zero, and a player at zero loses.',
        },
      ],
    },
    {
      heading: 'Chases',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A quiet step is a move with no flip and no capture. It counts as a chase if the moved piece can then capture an adjacent face-up enemy. Threatening several pieces counts as one chase. The target may change between turns. Covered targets do not count. Cannons never make quiet steps, so they never chase.',
        },
        {
          kind: 'paragraph',
          text: 'You may make four consecutive chases. Your fifth is illegal. Your opponent’s quiet turn does not break your streak. A quiet move that does not chase resets your own count. A flip or capture by either player resets both counts. The chase limit still applies when it leaves you with no legal move.',
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Reduce your opponent to zero HP to win. A player with no legal move on their turn loses. A flip is a legal move while any covered piece remains.',
        },
        {
          kind: 'paragraph',
          text: 'After 30 plies without a flip or capture, the game is a draw. A ply is one player’s turn. Any flip or capture resets this count, including a cannon’s capture of a covered friendly piece.',
        },
        {
          kind: 'paragraph',
          text: 'HP is checked before the draw count. The draw count is checked before the no-legal-move loss. At 30 quiet plies, the game draws even if a player cannot move.',
        },
      ],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play Fanfanqi',
              href: '/?play=friend&gameSpecId=ffq-banqi',
              emphasis: 'primary',
            },
          ],
        },
      ],
    },
  ],
};
