// "Puzzles with more than one solution": the mate-uniqueness rule change of 2026-09-11.
//
// Every position is either a real served puzzle by id or the fixture the
// grader's own test uses, and every line was replayed through
// applyStandardXiangqiMove before anything was written about it. The
// alternative mate on the opening board (h7-g9) was found by enumerating every
// legal first move through a kernel mate search; its continuation is the
// defender's longest resistance.
//
// Draft until Brian's voice pass. Each string becomes two zh keys on publish.

import { embedPuzzlePath } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';
import { PTA_THUMBNAIL } from '../puzzles-with-more-than-one-solution-diagrams.js';

// Engine coordinates (ranks 1-10) to ICCS (ranks 0-9), which is what the
// replay widget ships. Two-digit ranks are why this is not slice(0, 2).
function iccs(line: string): string {
  return line
    .split(' ')
    .map((token) => {
      const m = /^([a-i])(10|[1-9])([a-i])(10|[1-9])$/.exec(token);
      if (!m) throw new Error(`bad move token ${token}`);
      return `${m[1]}${Number(m[2]) - 1}${m[3]}${Number(m[4]) - 1}`;
    })
    .join(' ');
}

// xq-mined-hxq_2326cfdc2aa04eef6682486d-60, served from August until it was
// withheld on 2026-09-11 with reason runner-up-mates.
const TWO_ANSWERS_FEN = '1r1ak1b2/4a4/2n1b4/pcR4Np/1c2C4/1R7/9/N3B4/4A4/4KA3 r - - 0 31';

// The grader's own fixture: black general e10, red chariots on a9 and i9.
const TWO_MATES_IN_ONE_FEN = '4k4/R7R/9/9/9/9/9/9/9/3K5 r - - 0 1';

export const puzzleTwoAnswersArticle: Article = {
  slug: 'puzzles-with-more-than-one-solution',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Puzzles with more than one solution',
  seoTitle: 'Handling xiangqi puzzles with multiple solutions: why 382 were pulled',
  summary:
    'A solver found a real mate and was told to try again. 382 served puzzles could do that. How the miner admitted them, the patch that half-fixed it, the rule lichess uses instead, and what came out of the corpus.',
  thumbnail: { kind: 'svg', svg: PTA_THUMBNAIL },
  status: 'draft',
  audience:
    'Players who have been marked wrong on a move that mates, and developers who run a puzzle generator and a grader and want the two to agree.',
  boardFamily: 'xiangqi',
  intro: [
    {
      kind: 'paragraph',
      text: 'Red to move. The stored answer is the horse to f8: check, the general steps to f10, the cannon lands on f6, mate in two. The horse to g9 is also check, and also mate, one move slower. Until this week the site told that solver "try again" and took rating off them.',
    },
    {
      kind: 'xq-replay',
      spec: {
        startFen: TWO_ANSWERS_FEN,
        iccs: iccs('h7f8 e10f10 e6f6'),
        title: 'Two answers',
        event: 'Withheld 2026-09-11',
        perspective: 'red',
        red: 'Solver',
        black: 'Defence',
        resultText: 'Mate in two, the stored line.',
        annotations: {
          byPly: {
            1: {
              label: 'Also mates',
              line: iccs('h7g9 e10f10 b5f5 e9f8 f5f8'),
              note: 'The other answer. Horse to g9, the general steps aside, the chariot checks, the advisor blocks and is taken. Mate in three, every bit as forced, and marked wrong until 2026-09-11.',
              lineEval: '+−',
            },
          },
        },
      },
      caption:
        'The stored line is the mainline. Open the line under move 1 to step through the mate the grader used to refuse.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'That puzzle had been served since August. It was one of 382.',
    },
  ],
  sections: [
    {
      heading: 'How a puzzle gets two answers',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The miner keeps a position only when the winning move is unique. For most positions that is a centipawn question: the runner-up has to lose the win, or win a whole piece less. Mates saturate the centipawn scale, so they got their own rule: the best move mates strictly faster than the second-best move.',
        },
        {
          kind: 'paragraph',
          text: 'That is a race, not uniqueness. Mate in two beats mate in three, the position passes, and nothing in the record says the mate in three exists. By September, 29% of the served mate puzzles had a second mating move at the first ply. Nobody reported it. A solver who is told they are wrong assumes they are wrong.',
        },
      ],
    },
    {
      heading: 'The patch, and why it went',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first fix went into the grader: a move that was not the stored one was searched for a forced mate and accepted if one was found. The search ran on the request path, so it stopped three moves deep, and longer puzzles stayed traps with a special prompt over them. Too shallow, too clever, and none of it should be specific to xiangqi. Chess puzzle sites settled this years ago.',
        },
      ],
    },
    {
      heading: 'The lichess rule',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Lichess generates a mate puzzle only if the mating move is unique at every solver move. A runner-up that also mates, at any length, means no puzzle. At play time the solver plays the stored line, with one exception: any move that delivers mate right now is accepted. That needs no search. It is a board check.',
        },
        {
          kind: 'paragraph',
          text: 'The two halves fit. Everything the grader would have to search for, the generator already refused to publish, so the grader can be dumb. The miner now works this way, the three-move search is gone, and so is the "fastest mate" prompt. The one exception matches lichess\u2019s: a position where the stored move mates in one stays a puzzle even if other moves also mate in one, because the grader takes any of them.',
        },
        {
          kind: 'xq-replay',
          spec: {
            startFen: TWO_MATES_IN_ONE_FEN,
            iccs: iccs('a9a10'),
            title: 'Two mates in one',
            event: 'Still a puzzle',
            perspective: 'red',
            red: 'Solver',
            black: 'Defence',
            resultText: 'Mate. The chariot on i9 mates the same way.',
            annotations: {
              byPly: {
                1: {
                  label: 'Also mates',
                  line: iccs('i9i10'),
                  note: 'The other chariot, the same mate. The grader accepts either.',
                  lineEval: '+−',
                },
              },
            },
          },
          caption:
            'The chariot on a9 mates on a10. The chariot on i9 mates on i10. Both are accepted, and a position like this is still a puzzle. This is the grader\u2019s own test fixture.',
        } as ArticleBlock,
      ],
    },
    {
      heading: '382 puzzles withheld',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Reading the audit evidence for every served mate puzzle: 661 of 965 had a second mating move somewhere in the line. Most were on the last move, where the stored move mates in one and so does something else, which the exception covers. 472 had a second mate at a move that was not a mate in one. 90 were already withheld for another reason. The other 382 were withheld on 2026-09-11.',
        },
        {
          kind: 'table',
          headers: ['Mate puzzles', 'Count'],
          rows: [
            ['In the corpus', '965'],
            ['With a second mating move somewhere in the line', '661'],
            ['Second mate at a move that is not a mate in one', '472'],
            ['Already withheld for another reason', '90'],
            ['Withheld on 2026-09-11', '382'],
          ],
          highlightRows: [4],
          caption: 'The funnel from every mate puzzle to the ones pulled.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That is 27% of the served xiangqi puzzles. The corpus went from 1,415 to 995, and every puzzle left has one answer, checked at every move. The strict rule costs mates: the pilot published about one puzzle for every three games, and the mate half of that will drop by something like 40%. I will know the real number after the next thousand-game batch. Fewer puzzles that are all puzzles is the right trade.',
        },
      ],
    },
    {
      heading: 'Try one that has one answer',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Today\u2019s puzzle, from the corpus that stayed. If you find a mate the site does not accept, that is now a bug, and I want to hear about it.',
        },
        {
          kind: 'embed',
          path: embedPuzzlePath(),
          title: 'Today\u2019s xiangqi puzzle',
          // The card splits 70/30 like the study replays above it, and the
          // board is width-driven inside its column as long as the frame is
          // tall enough that the widget's height budget does not bind: at the
          // 702px column that is a 452px board, 501px tall, plus the mat and
          // the header and credit lines. Shorter, and the board shrinks away
          // from the study card's; taller, and the card floats in empty frame.
          aspect: [702, 590],
        } as ArticleBlock,
        {
          kind: 'cta',
          buttons: [
            { label: 'Solve xiangqi puzzles', href: '/puzzles', emphasis: 'primary' },
            {
              label: 'How the miner works',
              href: '/blog/how-puzzle-mining-works',
              emphasis: 'secondary',
            },
          ],
          layout: 'single-row',
        },
      ],
    },
  ],
};
