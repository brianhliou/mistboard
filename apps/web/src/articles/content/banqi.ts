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
//
// Question-led pass, 2026-10-29: the zh-Hant page takes ~30% of the site's
// Google impressions (Taiwan searches: 暗棋規則, 暗棋怎麼玩, 暗棋規則吃法,
// 暗棋規則連吃, 暗棋大小, 象棋規則半盤, 暗棋馬可以斜吃嗎), so each section is
// headed by the question a player types and opens with a sentence that answers
// it. When the English is signed off, the zh-Hant headings should read as those
// searches do: 暗棋怎麼玩？, 半盤象棋怎麼擺？, 輪到你可以做什麼？,
// 暗棋大小順序：誰吃誰？, 暗棋的炮可以吃什麼？, 暗棋可以連吃嗎？,
// 暗棋怎樣算贏？什麼時候和棋？. The zh-Hant body uses the generic piece names
// Taiwan players search with (將 士 象 車 馬 炮 兵), not one colour's set.
export const banqiArticle: Article = {
  slug: 'banqi',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Banqi Rules (Chinese Dark Chess)',
  summary:
    'Banqi, also called Chinese dark chess or blind chess, is played face-down on half a xiangqi board. Pieces capture by rank, except that the soldier takes the general and the cannon jumps a screen to take anything.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-15',
  updatedAt: '2026-10-29',
  updateNote:
    'Each section now opens with the question it answers, and two new sections cover how to play and whether you can chain captures.',
  audience:
    'Experienced banqi players and newcomers who want the rank ladder, screen-jumping cannon, and Mistboard rules explained on one page.',
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
      heading: 'How do you play banqi?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Banqi is played with the thirty-two xiangqi pieces shuffled face-down on half a xiangqi board. On each turn you either flip one tile or move one of your revealed pieces one square, and you capture by moving onto an enemy piece of equal or lower rank. You win when your opponent has no legal move left.',
        },
        {
          kind: 'paragraph',
          text: '**Setup.** All thirty-two pieces go face-down into the thirty-two squares, so the board starts full and nobody has a color yet.',
        },
        {
          kind: 'paragraph',
          text: '**First flip.** The first player flips any tile, and the color that turns up is theirs for the game.',
        },
        {
          kind: 'paragraph',
          text: '**Each turn.** Flip one face-down tile, or move one of your revealed pieces one square up, down, left or right. Moving onto an enemy piece of equal or lower rank captures it. The cannon is the exception: it captures by jumping over exactly one piece.',
        },
        {
          kind: 'paragraph',
          text: '**Winning.** You win when your opponent cannot move, usually because all their pieces are gone. Capturing the general does not end the game. Sixty plies with no flip or capture, or the same position three times, is a draw, with one exception for chases explained below.',
        },
        {
          kind: 'paragraph',
          text: 'You can [play a game against the computer](/?play=computer&gameSpecId=banqi) right now, no account needed.',
        },
      ],
    },
    {
      heading: 'How is banqi set up on half a xiangqi board?',
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
      heading: 'What can you do on your turn?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn you do exactly one of two things: flip a face-down tile, or move one of your revealed pieces one square.',
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
          text: 'Every piece moves the same way, the horse and the chariot included: one square at a time, never diagonally.',
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
      heading: 'What is the piece order, and who captures whom?',
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
      heading: 'What can the cannon capture in banqi?',
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
      heading: 'Can you chain captures in banqi?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'No. In standard banqi, the game played on Mistboard and in computer competition, a turn is one flip or one move, so a piece captures at most once per turn.',
        },
        {
          kind: 'paragraph',
          text: 'Chain capture is a well-known house rule in Taiwan, offered as a separate table mode by many banqi apps and game sites. A piece that captures may keep capturing in the same turn, and some versions also let a piece attack a face-down tile, turning it over in the process. Mistboard plays only the standard game.',
        },
      ],
    },
    {
      heading: 'How do you win at banqi, and when is it a draw?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win when your opponent has no legal move, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal: capturing it is progress, not the win, and play continues until one side is wiped out or stuck.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard draws a game two ways: 60 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly. A game started before 17 October 2026 keeps the 40-ply limit it began under.',
        },
        {
          kind: 'note',
          label: 'Repetition and chases',
          text: 'A position repeated three times draws, with one exception: a chase. A chase is a quiet move, with no flip and no capture, that threatens to capture the enemy piece that just moved, protected or not. The chasing side may not make a position appear for the third time with a chase; it must play something else, unless it has no other legal move. So a repetition caused by a chase is never a draw: the chased piece cannot stay put without being taken. A chase that keeps driving a piece onto new squares is not limited. [Why the rule works this way](/blog/banqi-perpetual-chase), with games.',
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
          text: 'Mistboard plays the standard Taiwanese game, the one used in computer competition and on the main banqi sites in Taiwan. The draw rules come from the competition rules of Chen, Shen and Hsu (ICGA Journal, 2010): the no-progress clock and the repetition draw above. Those rules set the clock at 40 plies. Mistboard moved it to 60 in October 2026, because some won endings need more than 40 plies to force the next capture. A common house rule lets a cannon also fire at a face-down tile, often played together with chain captures. That is a side variant, not the standard game, and it is not played here: a cannon only captures revealed enemy pieces. If you learned a different ladder, the one on this page is the one the engine and every game on the site follow.',
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
          aspect: [702, 446],
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
              question: 'Can the horse move or capture diagonally in banqi?',
              answer:
                'No. In standard banqi every piece, the horse included, moves one square up, down, left or right. A diagonal horse is a house rule some apps offer as a table option; Mistboard does not use it.',
            },
            {
              question: 'Can the general capture a soldier in banqi?',
              answer:
                'No. The general can capture every enemy piece except a soldier, and a soldier can capture the general.',
            },
            {
              question: 'Can the cannon capture the general in banqi?',
              answer:
                'Yes. The cannon ignores rank: with exactly one piece between them in a straight line, it can capture the general or any other revealed enemy piece.',
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
          text: 'A soldier can take the general, and the general can never take a soldier. No account needed.',
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
