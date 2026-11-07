import { BANQI_RANK_LADDER } from '../../banqi-rules-diagrams.js';
import {
  FANFANQI_CANNON_GAMBLE,
  FANFANQI_CANNON_NO_SHOT,
  FANFANQI_CANNON_SHOT,
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
          text: 'The board has 4 by 8 squares. Each color has one general, two advisors, two elephants, two chariots, two horses, two cannons and five soldiers. Shuffle all 32 pieces onto the board. Four fixed squares start face up, showing whatever pieces the shuffle put there. The other 28 start face down.',
        },
        {
          kind: 'paragraph',
          text: 'Red moves before Black. The seats have fixed colors from the start. Flipping a piece never changes your color. Both players can see which pieces remain covered, but cannot see which piece is under each back. Below, one deal before the first turn and after each player’s first flip.',
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
          text: 'The rank ladder, from highest to lowest, is **general > advisor > elephant > chariot > horse > cannon > soldier**. Two exceptions apply: a general cannot capture a soldier, and a soldier can capture a soldier or a general. There is no check. Capturing the general follows the same HP rules as any other capture. Below, the soldier can take the general beside it, and the general cannot take the soldier.',
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
          text: 'In banqi a cannon can step one square like any other piece. In Fanfanqi it cannot: a cannon moves only to capture. A cannon with no shot stays where it is, and a threatened cannon cannot step out of danger.',
        },
        {
          kind: 'paragraph',
          text: 'To find a shot, pick a row or column and count out from the cannon. The first piece in the way is the **screen**, and the cannon jumps over it. The screen can be any piece: yours or your opponent’s, face up or face down. The next piece after the screen, however far, is the **target**. If nothing stands behind the screen, there is no shot along that line.',
        },
        {
          kind: 'paragraph',
          text: 'The target must be a face-up enemy, of any rank, or a face-down piece of either color. A face-up piece of your own blocks the shot, and the cannon cannot skip past it to a piece farther away. Below, a shot, a gamble and a cannon with no move.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: FANFANQI_CANNON_SHOT,
              caption: 'The soldier is the screen. The general behind it is the target, though it outranks the cannon.',
            },
            {
              svg: FANFANQI_CANNON_GAMBLE,
              caption: 'Your own soldier is the screen. The face-down piece behind it may be yours.',
            },
            {
              svg: FANFANQI_CANNON_NO_SHOT,
              caption: 'No shot, so no move: nothing screens the horse above, and the red horse blocks the line to the general.',
            },
          ],
        },
        {
          kind: 'paragraph',
          text: 'A shot at a face-down piece is a gamble. The piece leaves the board and both players see its color and type. If it is yours, you lose its HP, and a shot that takes you to zero loses the game. Pieces still face down on the board stay hidden, even after the game ends.',
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
        {
          kind: 'paragraph',
          text: 'Each side’s sixteen pieces add up to 100 HP of damage against a start of 60, so a game ends well before one side is captured out. Losing the general costs half your HP at once.',
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
      heading: 'How Fanfanqi differs from banqi',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The rank ladder and the one-square steps are the same as in [banqi](/rules/banqi). Six rules differ:',
        },
        {
          kind: 'table',
          keyColumn: true,
          wrap: true,
          headers: ['Rule', 'Banqi', 'Fanfanqi'],
          rows: [
            ['Colors', 'Set by the first flip', 'Fixed by seat: the first player is Red'],
            ['Start', 'All 32 pieces face down', 'Four face up, 28 face down'],
            [
              'Cannon',
              'Steps one square, or captures over a screen',
              'Only captures, and may shoot a face-down piece of either color',
            ],
            ['Winning', 'Your opponent has no legal move', 'Your opponent reaches zero HP or has no legal move'],
            [
              'Draws',
              '60 plies with no flip or capture, or a threefold repetition',
              '30 plies with no flip or capture',
            ],
            ['Chases', 'A chase may not repeat a position a third time', 'At most four chases in a row'],
          ],
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
              question: 'Which player is Red?',
              answer:
                'The player who moves first. Colors belong to the seats from the start, so flipping a black piece on your first turn does not make you Black.',
            },
            {
              question: 'Can I flip one of my opponent’s pieces?',
              answer:
                'Yes. You may flip any face-down piece. If it turns out to be your opponent’s, it stays theirs and they can move it on their turn.',
            },
            {
              question: 'Can a cannon move without capturing?',
              answer:
                'No. A cannon only moves by capturing over a screen. When it has no shot, it cannot move at all.',
            },
            {
              question: 'What happens if my cannon captures my own face-down piece?',
              answer:
                'You lose that piece’s HP: 30 for your own general. The capture still counts as progress, so it resets the 30-ply draw count.',
            },
          ],
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
