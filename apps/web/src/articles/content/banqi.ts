import { BANQI_SAMPLE_GAME } from '../../banqi-sample-game.js';
import {
  BANQI_CANNON_CAPTURE,
  BANQI_RANK_LADDER,
  BANQI_RULES_THUMBNAIL,
  BANQI_SETUP_BOARD,
  playClosing,
} from '../diagrams.js';
import type { Article } from '../types.js';

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
    updatedAt: '2026-09-17',
    audience:
      'Experienced Banqi players and newcomers who want the rank ladder, screen-jumping cannon, and Mistboard rules explained on one page.',
    thumbnail: { kind: 'svg', svg: BANQI_RULES_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text:
          'Banqi, also called Chinese dark chess or blind chess, is a fast hidden-piece game played on half a xiangqi board. All thirty-two pieces begin shuffled and face-down. The first flip assigns colors. After that, each turn is a choice: flip a tile or move a revealed piece. Captures follow rank, except for the cannon.',
      },
      {
        kind: 'paragraph',
        text:
          'Although it uses [Xiangqi](/rules/xiangqi) pieces, it is a separate game: pieces move one square, the general is not royal, and face-down tiles cannot be captured. This page describes the exact rules used on Mistboard.',
      },
    ],
    sections: [
      {
        heading: 'Board and setup',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The board is half a xiangqi board: thirty-two squares in a 4x8 grid, shown here with the long side horizontal. Unlike xiangqi, pieces sit inside the squares rather than on intersections, and the thirty-two shuffled pieces exactly fill the board, every one face-down.',
          },
          {
            kind: 'paragraph',
            text:
              'Colors are not assigned in advance. The first player opens the game by flipping any piece: whatever color comes up is theirs, and the opponent plays the other.',
          },
          {
            kind: 'raw-svg',
            svg: BANQI_SETUP_BOARD,
          },
        ],
      },
      {
        heading: 'Turns',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'On your turn, do exactly one of two things: **flip** any face-down tile, or **move** one of your revealed pieces one square up, down, left, or right. A move may land on an empty square or capture an enemy when the rank rules allow it. A flip reveals the piece to both players, even if it belongs to your opponent. There is no passing.',
          },
        ],
      },
      {
        heading: 'Capture by rank',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Most pieces capture by stepping one square onto an adjacent revealed enemy. They may capture the same rank or any lower rank. On Mistboard, the order is General > Advisor > Elephant > Chariot > Horse > Soldier. Two exceptions connect the ends of the ladder: a soldier can capture the general, and the general cannot capture soldiers.',
          },
          {
            kind: 'table',
            headers: ['Rank', 'Piece (red / black)', 'Can capture', 'Exception'],
            rows: [
              ['1', 'General 帥 / 將', 'general, advisor, elephant, chariot, horse, cannon', 'cannot capture a soldier'],
              ['2', 'Advisor 仕 / 士', 'advisor, elephant, chariot, horse, cannon, soldier', ''],
              ['3', 'Elephant 相 / 象', 'elephant, chariot, horse, cannon, soldier', ''],
              ['4', 'Chariot 俥 / 車', 'chariot, horse, cannon, soldier', ''],
              ['5', 'Horse 傌 / 馬', 'horse, cannon, soldier', ''],
              ['6', 'Soldier 兵 / 卒', 'soldier, general', 'the only piece that captures the general'],
              ['', 'Cannon 炮 / 砲', 'any revealed enemy, by jumping one screen', 'as a target it ranks between horse and soldier'],
            ],
            caption: 'Capture order on Mistboard. A piece may also capture its own rank.',
          },
          {
            kind: 'paragraph',
            text:
              'Face-down tiles cannot be captured. The cannon uses a different attack, so it sits outside the ladder when capturing. The dashed slot shows only how other pieces treat a cannon as a target: it ranks between the horse and soldier.',
          },
          {
            kind: 'raw-svg',
            svg: BANQI_RANK_LADDER,
          },
        ],
      },
      {
        heading: 'The cannon',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The cannon ignores rank when it captures. Instead of taking an adjacent piece, it travels along a row or column, jumps exactly one intervening piece called the screen, and captures the first piece beyond it if that piece is a revealed enemy. The screen may be friendly, enemy, or face-down. Without a capture, the cannon moves one square like every other piece. Because it needs a screen, it cannot capture an adjacent piece.',
          },
          {
            kind: 'raw-svg',
            svg: BANQI_CANNON_CAPTURE,
          },
        ],
      },
      {
        heading: 'Winning and draws',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'You win when your opponent has no legal move, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal: capturing it is progress, not the win, and play continues until one side is wiped out or stuck.',
          },
          {
            kind: 'paragraph',
            text:
              'Mistboard draws a game two ways: 40 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly.',
          },
        ],
      },
      {
        heading: 'Rule variants',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Banqi is a folk game and the rules differ by region. Three families are common. Taiwanese rules use the ladder above and a cannon that captures by jumping one screen. Hong Kong rules rank the pieces general, chariot, horse, cannon, advisor, elephant, soldier, with the cannon inside the ladder. Mainland rules usually have no jumping cannon at all: it captures adjacent pieces by rank like everything else.',
          },
          {
            kind: 'paragraph',
            text:
              'Mistboard plays Taiwanese banqi with the competition draw rules of the Taiwan Computer Game Association (Chen, Shen and Hsu, ICGA Journal, 2010): the 40-ply no-progress clock and the repetition draw above. Two documented house rules are deliberately not used: a cannon may not capture a face-down tile, and the general never captures a soldier, not even on its first move. If you learned a different ladder, the table on this page is the one the engine and every game on the site follow.',
          },
        ],
      },
      {
        heading: 'A sample game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Step through a real game between Mistboard’s strongest bot and a human. Red falls behind early, but its elephant becomes the highest-ranked piece left and turns the game around. Each tile reveals its dealt piece when it is first flipped.',
          },
          {
            kind: 'banqi-replay',
            spec: {
              red: BANQI_SAMPLE_GAME.red,
              black: BANQI_SAMPLE_GAME.black,
              event: BANQI_SAMPLE_GAME.event,
              outcome: 'MistyBanqi (Red) wins by resignation · 49 moves',
              resultText: BANQI_SAMPLE_GAME.result,
              deal: BANQI_SAMPLE_GAME.deal,
              moves: BANQI_SAMPLE_GAME.moves,
            },
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
                question: 'What is the capture order in banqi?',
                answer:
                  'General > Advisor > Elephant > Chariot > Horse > Soldier. A piece captures its own rank or anything below it. Two exceptions: the soldier can capture the general, and the general cannot capture a soldier. The cannon captures by jumping and sits outside the ladder.',
              },
              {
                question: 'How does the cannon capture in banqi?',
                answer:
                  'It moves along a row or column, jumps over exactly one piece (face-up or face-down, either color), and captures the first revealed enemy beyond it, whatever its rank. It cannot capture an adjacent piece because it needs that one piece to jump. Without a capture it moves one square like everything else.',
              },
              {
                question: 'Can a soldier capture a cannon?',
                answer:
                  'No. A soldier captures only soldiers and the general. As a target, the cannon ranks between the horse and the soldier, so the horse and everything above it can take a cannon, and a soldier cannot.',
              },
              {
                question: 'Can a horse capture a chariot?',
                answer:
                  'No. The chariot outranks the horse. A horse captures horses, cannons, and soldiers.',
              },
              {
                question: 'Can you capture more than once in a turn?',
                answer:
                  'No. A turn is exactly one action: flip one face-down tile, or move one revealed piece one square, capturing or not. There are no chain captures on Mistboard.',
              },
              {
                question: 'What other names does banqi have?',
                answer:
                  'Chinese dark chess, blind chess, and half-board xiangqi in English. The Chinese name is an qi, the everyday word for it in Taiwan and Hong Kong; fan qi and ban pan xiangqi are also used.',
              },
              {
                question: 'Are there different banqi rules?',
                answer:
                  'Yes, three regional families: Taiwanese, Hong Kong, and mainland, differing on the capture ladder and on whether the cannon jumps. Mistboard uses the Taiwanese rules (general > advisor > elephant > chariot > horse > soldier, cannon captures by jumping one screen) with the Taiwan Computer Game Association draw rules. A cannon cannot capture a face-down tile and the general cannot capture a soldier.',
              },
              {
                question: 'How do I play banqi online with a friend?',
                answer:
                  'Choose Challenge a friend on this page. It creates an invite link; your friend opens it and the game starts. No account is needed for either player.',
              },
              {
                question: 'Can the bot see the face-down tiles?',
                answer:
                  'No. MistyBanqi gets the same board you do. Every face-down tile is sent to it as unknown, along with the count of what is still hidden, and it learns what a tile is at the moment it flips, the same moment you do. A test fails the build if an identity ever leaks into what it is sent.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Banqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
        playLabel: 'Play vs computer',
        playHref: '/?play=computer&gameSpecId=banqi',
        secondary: [
          { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=banqi', emphasis: 'secondary' },
        ],
      }),
    ],
};
