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
//
// Organizational pass, 2026-10-30 (Brian: "reads a bit more scattered"): each
// fact stated once, in the section whose question it answers. The how-to-play
// section is the short answer with setup and the turn as its parts, the capture
// order is one rule plus two exceptions, the regional rules are a table,
// diagram pairs sit side by side, and the two notes hold the chain-capture house
// rule and the 40-to-60-ply history. The chase rule moved from a note into the
// body, since it is a rule of play.
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
    'The page is reorganized around the questions players ask, with new sections on how to play and chain captures, the capture order set out as one rule with two exceptions, and a table of how the regional rules differ.',
  audience:
    'Experienced banqi players and newcomers who want the rank ladder, screen-jumping cannon, and Mistboard rules explained on one page.',
  thumbnail: { kind: 'svg', svg: BANQI_RULES_THUMBNAIL },
  tldr: [
    'All thirty-two xiangqi pieces start face-down on half a xiangqi board. On your turn you flip one tile or move one revealed piece one square.',
    'A piece captures an enemy of equal or lower rank, general down to soldier, except that the soldier takes the general and the general cannot take a soldier.',
    'The cannon captures by jumping exactly one piece, and then rank does not matter.',
    'One capture per turn, no chain captures. You win when your opponent cannot move.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi, also called Chinese dark chess or blind chess, is a fast hidden-piece game played with [xiangqi](/rules/xiangqi) pieces on half a xiangqi board, and a separate game from xiangqi with its own rules, given here exactly as Mistboard plays them.',
    },
  ],
  sections: [
    {
      heading: 'How do you play banqi?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Shuffle the thirty-two xiangqi pieces face-down onto half a xiangqi board. The first tile flipped decides the colors. On each turn you either flip one tile or move one of your revealed pieces one square, and you capture by moving onto an enemy piece of equal or lower rank. You win when your opponent has no legal move left.',
        },
        {
          kind: 'paragraph',
          text: 'You can [play a game against the computer](/?play=computer&gameSpecId=banqi) right now, no account needed.',
        },
        { kind: 'sub-heading', text: 'How is banqi set up on half a xiangqi board?' },
        {
          kind: 'paragraph',
          text: 'The board is a **4 by 8 grid**, half a xiangqi board, and the thirty-two shuffled pieces fill its squares exactly, every one face-down. Colors are not assigned in advance: whatever color the first flip turns up belongs to the player who flipped it, and the opponent plays the other.',
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
        { kind: 'sub-heading', text: 'What can you do on your turn?' },
        {
          kind: 'paragraph',
          text: '**Flip** any face-down tile. It turns over for both players to see, whichever color it turns out to be, and your turn is over.',
        },
        {
          kind: 'paragraph',
          text: '**Move** one of your revealed pieces one square up, down, left or right, onto an empty square or onto an enemy piece of equal or lower rank, which captures it. Every piece moves this way, the horse and the chariot included, and none moves diagonally; only the cannon captures differently, by jumping. Face-down tiles block the way and cannot be captured.',
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
          text: 'Strongest to weakest: general, advisor, elephant, chariot, horse, cannon, soldier. A piece captures an adjacent revealed enemy of **equal or lower rank**.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_RANK_LADDER,
          caption: 'Strongest at the left. Each piece takes its own rank and everything to its right, with two exceptions.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_RANK_CAPTURE,
          caption: 'The horse may take the soldier or the other horse, not the chariot above it.',
        },
        { kind: 'sub-heading', text: 'Two exceptions: the soldier and the cannon' },
        {
          kind: 'paragraph',
          text: '**The soldier captures the general**, and the general cannot capture a soldier.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: BANQI_SOLDIER_TAKES_GENERAL, caption: 'The lowest piece can take the highest.' },
            {
              svg: BANQI_GENERAL_CANNOT_TAKE_SOLDIER,
              caption: 'The general cannot take the soldier back; the advisor beside it, it can.',
            },
          ],
        },
        {
          kind: 'paragraph',
          text: '**The cannon captures by jumping** and ignores rank, as the next section shows. As a target it keeps its place in the order: the horse and every piece above it can take a cannon, and a soldier cannot.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: BANQI_CANNON_AS_TARGET,
              caption: 'As a target, the cannon is below the horse: the horse may take it.',
            },
            {
              svg: BANQI_SOLDIER_CANNOT_TAKE_CANNON,
              caption: 'A soldier cannot take a cannon. It can take the other soldier, or the general.',
            },
          ],
        },
      ],
    },
    {
      heading: 'What can the cannon capture in banqi?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The cannon captures along a row or column by jumping exactly one piece, the screen, and taking the first piece beyond it if that piece is a revealed enemy, **whatever its rank**. Without a capture it moves one square like everything else.',
        },
        {
          kind: 'paragraph',
          text: 'Any piece can be the screen: friendly, enemy, or face-down. With nothing to jump, the cannon cannot capture at all, so a piece right beside it is safe from it.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: BANQI_CANNON_SCREEN,
              caption: 'One screen, then the target. Rank does not matter: the cannon takes the general.',
            },
            {
              svg: BANQI_CANNON_FRIENDLY_SCREEN,
              caption: 'A friendly piece is a screen too. The face-down tile beyond the elephant is not a target.',
            },
          ],
        },
        {
          kind: 'raw-svg',
          svg: BANQI_CANNON_NO_SCREEN,
          caption: 'No screen, no capture: the chariot beside it is safe, and so is the horse two squares up with nothing between.',
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
          kind: 'note',
          label: 'The Taiwan house rule',
          text: 'Chain capture is a well-known house rule in Taiwan, offered as a separate table mode by many banqi apps and game sites. A piece that captures may keep capturing in the same turn, and some versions also let a piece attack a face-down tile, turning it over in the process. Mistboard plays only the standard game.',
        },
      ],
    },
    {
      heading: 'How do you win at banqi, and when is it a draw?',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win when your opponent has **no legal move**, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal. Capturing it is progress, and play continues until one side is wiped out or stuck.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard draws a game two ways: 60 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly.',
        },
        { kind: 'sub-heading', text: 'Repetition and chases' },
        {
          kind: 'paragraph',
          text: 'A **chase** is a quiet move, with no flip and no capture, that threatens to capture the enemy piece that just moved, protected or not. The chasing side may not repeat a position for the third time with a chase unless it has no other legal move, so a chase never ends in a repetition draw; a chase that drives the piece onto new squares is not limited. [Why the rule works this way](/blog/banqi-perpetual-chase), with games.',
        },
        {
          kind: 'note',
          label: 'Changed October 2026',
          text: 'The draw rules come from the competition rules of Chen, Shen and Hsu (ICGA Journal, 2010), which set the no-progress limit at 40 plies. Mistboard moved it to 60 in October 2026, because some won endings need more than 40 plies to force the next capture. A game started before 17 October 2026 keeps the 40-ply limit it began under.',
        },
      ],
    },
    {
      heading: 'Rule variants',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Banqi is a folk game and the rules differ by region. Mistboard plays the **standard Taiwanese game**, the one used in computer competition and on the main banqi sites in Taiwan. If you learned a different ladder, the one on this page is the one the engine and every game on the site follow.',
        },
        {
          kind: 'table',
          keyColumn: true,
          wrap: true,
          headers: ['Region', 'How it plays'],
          rows: [
            ['Taiwan', 'The ladder on this page, and a cannon that captures by jumping one screen'],
            [
              'Hong Kong',
              'Pieces rank general, chariot, horse, cannon, advisor, elephant, soldier, with the cannon inside the ladder',
            ],
            [
              'Mainland China',
              'The cannon usually does not jump and captures adjacent pieces by rank like everything else',
            ],
          ],
          highlightRows: [0],
          caption: 'Taiwan’s rules are the ones played on Mistboard.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard plays none of the common house rules: no chain captures, no cannon firing at a face-down tile (a cannon only captures revealed enemy pieces), and no diagonal horse (every piece moves one square up, down, left or right).',
        },
      ],
    },
    {
      heading: 'An engine game',
      blocks: [
        {
          kind: 'paragraph',
          text: '[MistyBanqi](/blog/mistybanqi) against itself at ten million nodes a move, three times the strength the site’s bot plays at. Step through it with the arrows.',
        },
        {
          kind: 'embed',
          path: '/embed/study/FsA5sowX/F8fezAhm',
          title: 'Banqi: an engine game under the competition rules',
          // Width-bound at the article column: a 2:1 board beside the 226px
          // sheet, plus the seat rows, controls and credit line.
          aspect: [702, 446],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The [companion study](/study/FsA5sowX) has all twenty games from the run, one chapter each, with a note on how it went. Two hundred games from the same run are reduced to numbers in [Banqi by the Numbers](/blog/banqi-statistics): how big a lead is safe, and when a game is decided.',
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
              question: 'Can a soldier capture a cannon?',
              answer:
                'No. A soldier captures only soldiers and the general. The cannon ranks just above the soldier, so the horse and every piece above it can take a cannon, and a soldier cannot.',
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
          ],
        },
      ],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Play the computer or send a friend a link. No account needed.',
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
