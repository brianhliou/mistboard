import type { Square } from '@mistboard/game';
import {
  ARTICLE_OG_POSITIONS,
  DEDUCE_BACK_PAWN_POSITIONS,
  DEDUCE_BB4_POSITIONS,
  DEDUCE_PAWN_BLOCKED,
  DEDUCE_PAWN_BLOCKED_FOG,
  DEDUCE_PAWN_OPEN,
  DEDUCE_PAWN_OPEN_FOG,
  DEDUCE_RECAP_NB_POSITIONS,
  DEDUCE_RECAP_POSITIONS,
  fogFor,
  SURVIVE_BB4_FINAL,
  SURVIVE_GREEDY_FINAL,
  SURVIVE_PATIENT_STATE,
  WORLD_CENTER,
  WORLD_KINGSIDE,
  WORLD_QUEENSIDE,
  WORLDS_VIEW_FOG,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const darkChessConceptsArticle: Article = {
    slug: 'fog-chess-concepts',
    kind: 'article',
    publisher: 'mistboard',
    title: 'Fog Chess Concepts',
    // "Fog Chess" is our name; "fog of war chess" is what players search.
    seoTitle: 'Fog of War Chess Strategy: Reading the Fog and Thinking in Worlds',
    summary:
      'Strategy concepts for Fog Chess: read fogged squares and capture clues, model the hidden positions you could be facing, cluster them into the few that matter, and pick moves that survive every one.',
    status: 'draft',
    audience:
      'Players who know the Fog Chess rules and want to start making better decisions under fog.',
    thumbnail: ARTICLE_OG_POSITIONS['dark-chess-concepts'],
    intro: [
      {
        kind: 'paragraph',
        text:
          'Fog chess is played on the squares you cannot see as much as the ones you can. Fogged squares, missing destinations, and vanished pieces are all information. The most useful habit in the game is reading what the fog is telling you; the second is deciding well under what it still hides.',
      },
    ],
    sections: [
      {
        heading: 'Reading the fog',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The goal is not perfect certainty. A good Fog Chess player learns which hidden worlds are dangerous enough to respect, then chooses moves that survive those worlds.',
          },
        ],
      },
      {
        heading: 'Pawn moves',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "A pawn sees where it can push. Fog on a push square means an opponent piece or pawn is blocking it.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                { board: DEDUCE_PAWN_OPEN.board, fogSquares: DEDUCE_PAWN_OPEN_FOG, orientation: 'white', label: 'EMPTY AHEAD' },
                { board: DEDUCE_PAWN_BLOCKED.board, fogSquares: DEDUCE_PAWN_BLOCKED_FOG, orientation: 'white', label: 'BLOCKED AHEAD' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Same signal in opening play. After 1.d4 e6 2.Nf3 Bb4, b4 leaves White's view: the b2-pawn no longer pushes there. A Black piece just landed on b4. Pawn, knight, or bishop, and White can't tell which. But c3 and d2 are visible empty, so a bishop would capture the king next move. White has to defend on that assumption.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: DEDUCE_BB4_POSITIONS,
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Captures',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "When the opponent takes one of your pieces, the capture square falls to fog. You can't see what took. Here: White pawn on d5, with four Black attackers around it (c6 pawn, e6 pawn, c7 knight, d7 rook). After 1...exd5, the d5 pawn vanishes. Which Black piece took it?",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: DEDUCE_RECAP_NB_POSITIONS,
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Add a White bishop on h3. Its diagonal keeps e6 in view. After the same 1...exd5, White loses d5 and the bishop sees e6 fall empty. So the e-pawn took.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: DEDUCE_RECAP_POSITIONS,
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "A pawn behind the captured piece can also prove what did not happen. Here White's d5 pawn is attacked by a Black pawn on e6 and a Black knight on f6, with another White pawn on d4 behind it. After the pawn vanishes, d5 is fogged in front of the d4 pawn.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: DEDUCE_BACK_PAWN_POSITIONS,
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "White makes a quiet king move. Then the hidden piece on d5 moves away, and d5 becomes visible empty again. That rules out 1...exd5: a Black pawn on d5 would still be blocking the d4 pawn's push square. The mobile piece was the knight.",
          },
        ],
      },
      {
        heading: 'Castling into hidden safety',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "In regular chess, castling choices are judged in public. In Fog Chess, your opponent often does not know where your king is unless a scout has seen it, a move has revealed it, or castling itself gives the position away.",
          },
          {
            kind: 'paragraph',
            text:
              "That makes some unconventional castles playable. You can sometimes castle into a pawn structure or side you would normally reject because the opponent cannot immediately aim at a king they have not located. The safety is relative: the structure still matters, but the hidden king buys time.",
          },
          {
            kind: 'paragraph',
            text:
              "The danger is scouting. Once a knight, bishop, rook, queen, or pawn signal reveals where the king landed, the position stops being mysterious and has to hold up as chess again.",
          },
        ],
      },
      {
        heading: 'Thinking in worlds',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Every move your opponent makes, you usually do not see. So the board in front of you is not one position. It is a fan of positions: one for every move they could have made, branching again with every move you miss. You are never really looking at the board. You are looking at a cloud of boards that all happen to match what you can see.",
          },
          {
            kind: 'paragraph',
            text:
              "Here White sees only the near half. The whole enemy camp is fog. The pieces in your fog did not vanish: they are somewhere. The skill is holding a rough picture of where they could be.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                { board: WORLD_KINGSIDE.board, fogSquares: WORLDS_VIEW_FOG, orientation: 'white', label: 'WHAT YOU SEE' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Each of these is a different position that fits that exact view, and there are far more than three. You cannot tell them apart from where you sit.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'triptych',
              boards: [
                { board: WORLD_KINGSIDE.board, orientation: 'white', label: 'WORLD A' },
                { board: WORLD_CENTER.board, orientation: 'white', label: 'WORLD B' },
                { board: WORLD_QUEENSIDE.board, orientation: 'white', label: 'WORLD C' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "The signals from the last sections are how you prune the cloud. A pawn that can still push means nothing sits in front of it, so every world that put a piece there is gone. A capture you can name removes the worlds where a different piece took. Each thing you observe kills off worlds. You will never get down to one, and you do not need to.",
          },
          {
            kind: 'sub-heading',
            text: 'The cloud has a size',
          },
          {
            kind: 'paragraph',
            text:
              "That cloud has a name. In game theory, the set of positions consistent with everything you have observed is your information set, and its size is a real, countable number. You feel it as a vague unease; an engine can count it exactly.",
          },
          {
            kind: 'paragraph',
            text:
              "Obscuro, the first superhuman fog-of-war chess engine, does exactly that: it enumerates the whole set rather than sampling it, and calls it P. The rough scale is worth sitting with. In a typical position P holds on the order of ten thousand boards (the Obscuro paper reports an average near 17,000), and in the sharpest, most hidden positions it climbs toward a million, the practical upper bound the paper works with. Your two or three buckets are a human compression of a set that large. You are not being imprecise. You are doing the only thing a person can do with a number that big.",
          },
        ],
      },
      {
        heading: 'Clustering the worlds',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "There are too many worlds to track one by one. A computer can enumerate them all; you cannot, and you do not play like one. What you can do is group them, because most of those worlds do not change your move. The ones that do tend to fall into a handful of buckets.",
          },
          {
            kind: 'paragraph',
            text:
              "Their king is kingside or it is queenside. The piece that just landed on b4 is a bishop or a knight. You are walking into a battery or you are not. You rarely need the exact position. You need to know which bucket you are in, because the bucket is what changes your plan.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                { board: WORLD_KINGSIDE.board, orientation: 'white', label: 'KING KINGSIDE', highlightSquares: ['g8' as Square] },
                { board: WORLD_QUEENSIDE.board, orientation: 'white', label: 'KING QUEENSIDE', highlightSquares: ['c8' as Square] },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Cluster by what would change your decision, not by what is merely different. Two worlds that point to the same best move are one world for your purposes, so collapse them. Two that demand opposite moves are the split worth naming. Most of Fog Chess is this: reducing a cloud you cannot count to the two or three buckets you can actually plan against.",
          },
        ],
      },
      {
        heading: 'Patience and risk',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Once the cloud is down to a few buckets, the question is not which one is true. You often cannot know. The question is whether your next move still works if the dangerous bucket is the real one.",
          },
          {
            kind: 'paragraph',
            text:
              "That changes what counts as a good move. A move that beats the board you see but loses to a hidden piece you cannot rule out is a gamble, not a plan. The strong move is usually the one that holds up across every live bucket, even if it wins by less when you turn out to be right. Recall the bishop on b4: you cannot prove it is a bishop, but Nc3 blocks the diagonal whether b4 hides a bishop, a knight, or a pawn. The grab only works if you guessed right; the block survives every world.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'triptych',
              boards: [
                { board: SURVIVE_BB4_FINAL.board, fogSquares: fogFor(SURVIVE_BB4_FINAL, 'white'), orientation: 'white', label: 'WHAT YOU SEE', highlightSquares: ['b4' as Square] },
                { board: SURVIVE_GREEDY_FINAL.board, orientation: 'white', label: 'IGNORE IT: Bxe1', arrows: [{ orig: 'b4', dest: 'e1' }] },
                { board: SURVIVE_PATIENT_STATE.board, orientation: 'white', label: 'BLOCK: Nc3', arrows: [{ orig: 'b1', dest: 'c3' }] },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "This is why patience pays. Forcing the position commits you before the fog clears. A quieter move keeps your options open, makes the opponent act first, and often makes them reveal a piece in the process. Let the board come into focus before you stake the game on it.",
          },
          {
            kind: 'paragraph',
            text:
              "That is the whole arc: read the fog, hold the worlds it could hide, cluster them down to the few that matter, and choose the move that beats the dangerous ones. Deduction narrows the problem; what you do with what is left is the game.",
          },
          {
            kind: 'cta',
            buttons: [
              { label: 'Read the rules', href: '/rules/fog-chess', emphasis: 'secondary' },
              { label: 'Play Misty', href: '/?play=computer', emphasis: 'primary' },
            ],
          } as ArticleBlock,
        ],
      },
    ],
};
