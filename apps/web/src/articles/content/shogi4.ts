import {
  relatedClosing,
  SHOGI4_CAPTURE,
  SHOGI4_DROP,
  SHOGI4_GAME_STEPS,
  SHOGI4_GAME_TITLE,
  SHOGI4_JUMP_CASES,
  SHOGI4_MOVE_ROYAL,
  SHOGI4_PAIR_CARP,
  SHOGI4_PAIR_FOX,
  SHOGI4_PAIR_RACCOON,
  SHOGI4_PAIR_TAPIR,
  SHOGI4_RULES_THUMBNAIL,
  SHOGI4_START_BOARD,
  SHOGI4_WIN,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const shogi4Article: Article = {
    slug: 'shogi4',
    kind: 'rules',
    title: 'Shogi4 (4×4 Shogi) Rules',
    summary:
      "The complete rules of Shogi4 (4x4 Shogi), Oca Studios' public-domain animal drop-shogi on a 4×4 board: how the Carp, Tapir, Raccoon-dog, Fox, and royal move, plus the friendly-jump, evolution, drops, and king-capture wins.",
    showSummaryOnPage: false,
    // Guest rules page: hosted for an outside project (linked from
    // brianhliou.com), not a Mistboard variant. Keep it reachable but out of
    // every index/landing/rail listing. Its own page still renders the rail
    // (other games), with nothing highlighted — see buildVariantSidebar.
    showInIndex: false,
    status: 'published',
    publishedAt: '2026-06-05',
    updatedAt: '2026-06-06',
    updateNote:
      'Reworked the diagrams, the history and the prose.',
    audience:
      'Players and shogi-curious readers who want the full, primary-sourced rules of Shogi4, a 4×4 drop-shogi.',
    thumbnail: { kind: 'svg', svg: SHOGI4_RULES_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text:
          'Shogi4, also called 4x4 Shogi, is a drop-shogi played with animal tiles on a 4×4 board. It plays much like ordinary shogi shrunk to sixteen squares: pieces step in marked directions, captured pieces switch sides and drop back into play, and you win by taking the king. The one rule shogi players won\'t recognize is that a piece may hop over a friendly piece, added so your own pieces don\'t jam each other on a board this small.',
      },
      {
        kind: 'paragraph',
        text:
          'Oca Studios released Shogi4 into the public domain in its "Four" series, free as a print-and-play set and as an app. Each player has five pieces: a Carp, a Tapir, a Raccoon-dog, a Fox, and a royal (a Crane for the first player, a Pheasant for the second).',
      },
    ],
    sections: [
      {
        heading: 'The board and setup',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "The board is 4×4, with a farm to either side that holds captured pieces. A tile's owner is shown by its facing: the first player's tiles point up the board, the second player's point down.",
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_START_BOARD,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'The pieces',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Every piece moves one square per turn, in the directions printed on its tile. On reaching the far row, each non-royal piece evolves, flipping to its evolved side. The pairs below show the base piece, then its evolved form, with a dot on every square each can reach (forward is up).',
          },
          {
            kind: 'paragraph',
            text: '**Carp → Koi.** The Carp steps one square straight forward, a pawn. It evolves into a Koi, which moves as a silver from shogi.',
          },
          { kind: 'raw-svg', svg: SHOGI4_PAIR_CARP } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**Tapir → Baku.** The Tapir steps forward or to a forward diagonal. It evolves into a Baku, a silver.',
          },
          { kind: 'raw-svg', svg: SHOGI4_PAIR_TAPIR } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**Raccoon-dog → Tanuki.** The Raccoon-dog steps one diagonal. It evolves into a Tanuki, a silver.',
          },
          { kind: 'raw-svg', svg: SHOGI4_PAIR_RACCOON } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**Fox → Kitsune.** The Fox steps one orthogonal. It evolves into a Kitsune, which moves as a gold from shogi.',
          },
          { kind: 'raw-svg', svg: SHOGI4_PAIR_FOX } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Crane / Pheasant.** The royal steps one square in any of the eight directions, a king. The two royals differ only in theme. It never evolves, and capturing it ends the game.',
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_MOVE_ROYAL,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Jumping over a friendly piece',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'A piece can leap over a friendly piece. If an ally sits on the next square in a direction the piece moves, the piece jumps it and lands on the square just beyond, empty or capturing an enemy there. It works in any direction the piece itself moves: straight for a Carp, on the diagonal for a Raccoon-dog, any of the eight for the royal.',
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_JUMP_CASES,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Capturing, farms, and drops',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Move onto an enemy to capture it; it switches sides into your farm, reverting to its base form if it was evolved.',
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_CAPTURE,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Instead of moving, drop a piece from your farm onto any empty square, except those on the far row (the opponent's back rank).",
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_DROP,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Winning',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Capturing the royal is the only way to win. No check, no checkmate: the game ends the moment a royal is taken.',
          },
          {
            kind: 'raw-svg',
            svg: SHOGI4_WIN,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              'There is no stalemate. Because moving the king into capture range is legal, a lack of safe moves never ends the game: you simply make the unsafe move and play on until a king is taken. A side with no legal move at all, boxed in with nothing to drop, loses rather than draws.',
          },
        ],
      },
      {
        heading: 'Repetition and draws',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The original rules address neither repetition nor a move-count limit. Our convention fills the gap: a position reached three times is an automatic draw. That rule is ours, not Oca\'s, and changes none of the rules above.',
          },
        ],
      },
      {
        heading: 'A sample game',
        blocks: [
          {
            kind: 'paragraph',
            text: SHOGI4_GAME_TITLE,
          },
          {
            kind: 'raw-svg-stepper',
            header: {
              players: 'Fairy-Stockfish (White) vs Fairy-Stockfish (Black)',
              event: 'Engine self-play · 2s/move',
            },
            steps: SHOGI4_GAME_STEPS,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Source and license',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Shogi4 and its tile art are by Oca Studios, which released its whole \"Four\" series into the public domain. The [BoardGameGeek entry](https://boardgamegeek.com/boardgame/146291/shogi4) is a catalog reference.",
          },
          {
            kind: 'paragraph',
            text:
              "We recovered the exact rules from Oca's official Shogi4 app, decompiling it to read the move logic directly: the friendly-jump geometry, the single drop ban, and king-capture as the sole win all come from there. Oca's public rules page and starting-position graphic (now reachable only through the [Internet Archive](https://web.archive.org/web/20240926113424/https://www.ocastudios.com/four/shogi/), since the live site is down) corroborate the board and the basic moves.",
          },
        ],
      },
      relatedClosing({
        heading: 'Playing Shogi4',
        lead: "Shogi4 isn't playable on the site yet; for now this page is the rules reference. Browse the rest of the rules, or compare it with the chess and xiangqi primers.",
        links: [
          { label: 'All rules', href: '/rules', emphasis: 'primary' },
          { label: 'Chess Rules', href: '/rules/chess', emphasis: 'secondary' },
          { label: 'Xiangqi Rules', href: '/rules/xiangqi', emphasis: 'secondary' },
        ],
      }),
    ],
};
