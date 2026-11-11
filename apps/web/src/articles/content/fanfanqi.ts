import {
  FANFANQI_CANNON_SHOT,
  FANFANQI_CAPTURE_CARDS,
  FANFANQI_CHASE_COUNTS,
  FANFANQI_CHASE_RUN_STEPS,
  FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER,
  FANFANQI_RANK_LADDER,
  FANFANQI_SETUP,
  FANFANQI_SHOT_AFTER,
  FANFANQI_SHOT_BEFORE,
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
          text: 'Red moves first. The seats have fixed colors from the start, and flipping a piece never changes your color. Both players can see which pieces remain covered, but not which piece is under each back. Below, one deal before the first turn.',
        },
        { kind: 'raw-svg', svg: FANFANQI_SETUP },
        {
          kind: 'paragraph',
          text: 'Every square starts full, so no piece can step on the first turn. Red either flips a covered piece or shoots with a face-up red cannon, like the one in this deal. Then Black moves, and the players alternate from there.',
        },
      ],
    },
    {
      heading: 'Turns and flips',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn, flip one covered piece or move one of your face-up pieces. A flip takes the whole turn. You may flip any covered piece, even one that turns out to belong to your opponent.',
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
          text: 'The rank ladder, from highest to lowest, is **general > advisor > elephant > chariot > horse > cannon > soldier**. A piece captures its own rank or any rank below it, with three exceptions: a general cannot capture a soldier, a soldier can capture a general, and a cannon ignores rank when it captures (see [Cannons only capture](#cannons-only-capture)).',
        },
        { kind: 'raw-svg', svg: FANFANQI_RANK_LADDER },
        {
          kind: 'paragraph',
          text: 'There is no check. Capturing the general follows the same HP rules as any other capture. Below, the soldier can take the general beside it, and the general cannot take the soldier.',
        },
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
          text: 'HP stops at zero, and a player at zero loses. Each side’s sixteen pieces add up to 100 HP of damage against a start of 60, so a game ends well before one side is captured out. Losing the general costs half your HP at once.',
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
          text: 'To find a shot, pick a row or column and count out from the cannon. The first piece in the way is the **screen**, and the cannon jumps over it. The screen can be any piece: yours or your opponent’s, face up or face down. The next piece after the screen, however far, is the **target**, and rank does not matter. Below, the black soldier is the screen, and the cannon can take the general behind it.',
        },
        { kind: 'raw-svg', svg: FANFANQI_CANNON_SHOT, caption: 'The ring marks the target.' },
        {
          kind: 'paragraph',
          text: 'The target must be a face-up enemy or a face-down piece of either color. If the next piece after the screen is a face-up piece of your own, there is no shot along that line. Only a cannon can capture a face-down piece, and the shot is a gamble, because it may be your own. Below, the red cannon from the opening deal shoots down, over the back beside it.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: FANFANQI_SHOT_BEFORE, caption: 'Before: the dots mark the cannon’s two shots.' },
            { svg: FANFANQI_SHOT_AFTER, caption: 'After: the tint marks the shot.' },
          ],
        },
        {
          kind: 'paragraph',
          text: 'The captured piece is turned face up as it leaves the board, so both players see its color and type. Here it was a black soldier, and Black loses its HP.',
        },
        { kind: 'raw-svg', svg: FANFANQI_CAPTURE_CARDS },
        {
          kind: 'paragraph',
          text: 'Had it been a red piece, Red would have lost the HP instead. Pieces still face down on the board stay hidden from both players, even after the game ends.',
        },
      ],
    },
    {
      heading: 'Chases',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A chase is a step, with no flip and no capture, that ends next to a face-up enemy piece the moved piece could capture. A step that ends next to only stronger pieces or covered pieces is not a chase. Ending next to two pieces you could take is still one chase. Cannons never step, so they never chase.',
        },
        {
          kind: 'paragraph',
          text: 'Below, stepping beside the black cannon is a chase for the red horse. Stepping beside the elephant is not, because a horse cannot capture an elephant, and stepping beside the covered piece is not either.',
        },
        {
          kind: 'raw-svg',
          svg: FANFANQI_CHASE_COUNTS,
          caption: 'Dots mark the horse’s steps.',
        },
        {
          kind: 'paragraph',
          text: 'You may chase four times in a row. The game does not offer a fifth chase in a row, so you pick another move instead; it is never an automatic loss. Below, a red chariot chases a black horse back and forth until it reaches the limit.',
        },
        {
          kind: 'raw-svg-stepper',
          gameSpecId: 'ffq-banqi',
          steps: FANFANQI_CHASE_RUN_STEPS,
          caption: 'Crosses mark the steps the chase limit removes. The dot is the chariot’s one step left.',
        },
        {
          kind: 'paragraph',
          text: 'A step that is not a chase resets your own count. A flip or a capture by either player resets both counts. Your opponent’s steps do not reset yours. If every move you have left would be a fifth chase, you have no legal move and lose.',
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
              href: '/?play=computer&gameSpecId=ffq-banqi',
              emphasis: 'primary',
            },
            { label: 'Play a friend', href: '/?play=friend&gameSpecId=ffq-banqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
