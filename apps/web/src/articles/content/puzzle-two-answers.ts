// "The puzzle had two answers": the mate-uniqueness rule change of 2026-09-11.
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
import { PTA_THUMBNAIL } from '../puzzle-two-answers-diagrams.js';

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

// xq-mined-hxq_b8b6762877e07fa8269f2865-23, served, tagged 马后炮.
const MA_HOU_PAO_PUZZLE_ID = 'xq-mined-hxq_b8b6762877e07fa8269f2865-23';

export const puzzleTwoAnswersArticle: Article = {
  slug: 'the-puzzle-had-two-answers',
  kind: 'article',
  publisher: 'mistboard',
  title: 'The puzzle had two answers',
  seoTitle: 'Why 382 xiangqi puzzles were pulled: mate puzzles with two answers',
  summary:
    'A solver found a real mate and was told to try again. It turned out 382 served puzzles could do that. Here is how the miner admitted them, the patch that half-fixed it, the rule lichess uses instead, and what came out of the corpus.',
  thumbnail: { kind: 'svg', svg: PTA_THUMBNAIL },
  status: 'draft',
  audience:
    'Players who have been marked wrong on a move that mates, and developers who run a puzzle generator and a grader and want the two to agree.',
  boardFamily: 'xiangqi',
  intro: [
    {
      kind: 'paragraph',
      text: 'Red to move. The stored answer is the horse to f8: check, the general steps to f10, the cannon comes to f6 and it is mate in two. A solver who plays the horse to g9 instead is also giving check, and it is also mate, one move slower. Until this week the site told that solver "try again" and took rating off them.',
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
          text: 'The miner keeps a position only when the winning move is unique. For most positions that is a centipawn question: the runner-up has to lose the win, or win a whole piece less. Mates saturate the centipawn scale, so they got their own rule, and the rule I wrote was "the best move mates strictly faster than the second-best move."',
        },
        {
          kind: 'paragraph',
          text: 'That sounds like uniqueness. It is a race. Mate in two beats mate in three, so the position passes, and nothing in the record says the mate in three exists. On the corpus that had accumulated by September, 29% of mate puzzles had a second mating move at the first ply. I found this by reading the audit evidence, not by anyone reporting it, because a solver who is told they are wrong assumes they are wrong.',
        },
      ],
    },
    {
      heading: 'A three-move search in the grader, and its cap',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first fix, on 2026-09-02, went into the grader. When a solver played a move that was not the stored one, the server searched the position for a forced mate and accepted the move if it found one. It ran on the request path, so it had a budget: three moves deep, about fifty milliseconds. Four moves deep took seconds.',
        },
        {
          kind: 'paragraph',
          text: 'So mate-in-two and mate-in-three puzzles stopped being traps, and mate-in-four puzzles stayed traps, and the prompt on those grew a special case: "Find the fastest mate." A third patch was on the board, an engine search at mine time to count how many moves mate, so the gate could reject positions with too many.',
        },
        {
          kind: 'paragraph',
          text: 'I looked at the whole stack again this week. Three moves deep is too shallow, the thing is too clever, and none of it should be specific to xiangqi. The last point is the useful one, because chess puzzle sites settled this years ago.',
        },
      ],
    },
    {
      heading: 'Lichess refuses the position instead of rescuing the solver',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Lichess generates a mate puzzle only if the mating move is unique at every solver move. If the runner-up also mates, at any length, the position is not a puzzle. At play time the solver has to play the stored line, with exactly one exception: any move that delivers mate right now is accepted. That exception needs no search. It is a board check.',
        },
        {
          kind: 'paragraph',
          text: 'Those two rules fit together. Everything the grader would need to search for, the generator already refused to publish. So the grader can be dumb, and the patches come out.',
        },
      ],
    },
    {
      heading: 'One rule at mine time, a board check at play time',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The miner now rejects a mating position when any other move mates, whatever its length. Two engine lines are enough to know: if the second-best move does not mate, no lower move does. The one exception matches lichess’s: a position where the stored move mates in one is fine even if other moves also mate in one, because the grader will take any of them.',
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
          },
          caption:
            'The chariot on a9 mates on a10. The chariot on i9 mates on i10. Both are accepted, and a position like this is still a puzzle. This is the grader’s own test fixture.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The grader’s mate search is gone. A move that is not the stored line is accepted if it mates on the spot and refused otherwise. The "fastest mate" prompt is gone with it.',
        },
      ],
    },
    {
      heading: '382 puzzles withheld',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Reading the audit evidence for every served mate puzzle: 661 of 965 had a second mating move somewhere in the line. Most of those were on the last move, where the stored move mates in one and so does something else, which the exception covers. 472 had a second mate at a move that was not a mate in one. 90 of those were already withheld for a different reason. The remaining 382 were withheld on 2026-09-11.',
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
            ['Of those: mate in 2 / mate in 3 / mate in 4', '171 / 167 / 134'],
          ],
          highlightRows: [4],
          caption: 'The funnel from every mate puzzle to the ones pulled.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That is 27% of the served xiangqi puzzles. The corpus went from 1,415 to 995 (38 of the difference were pre-audit seed puzzles pulled the day before for an unrelated reason), and every puzzle left has one answer, checked at every move.',
        },
        {
          kind: 'paragraph',
          text: 'The mining explainer on this site shows a position with two mates in one being thrown away with the caption "two answers is not one answer." Under the new rule that position is fine on the two-answers count; it is still rejected, because a one-move puzzle is a spot-check, which the same article explains a paragraph earlier.',
        },
      ],
    },
    {
      heading: 'Fewer mates per thousand games',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The strict rule costs mates. The pilot published about one puzzle for every three games; under the new rule the mate half of that drops by something like 40%, and I will know the real number after the next thousand-game batch. The licensed corpus has 5,969 games left, so the ceiling is a few thousand puzzles, not ten thousand. That was already true. Fewer puzzles that are all puzzles is the right trade.',
        },
      ],
    },
    {
      heading: 'The ones that stayed now say what they teach',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Xiangqi has a named vocabulary for mates that chess mostly lacks: 马后炮, the cannon behind the horse; 铁门栓, the iron bolt; 双车错, the scissoring chariots; 白脸将, the facing generals. The same day the 382 came out, the puzzles that stayed started carrying those names. Each pattern is a geometry test over the final position and the moves that reached it, and a puzzle is tagged only when the test passes.',
        },
        {
          kind: 'embed',
          // Relative, and it has to be: the site is cross-origin isolated for the
          // WASM engine (COEP), so a page here can frame only its own origin.
          // The served corpus lives in production, so a dev pair shows "not
          // available" here; check it on the deployed page.
          path: embedPuzzlePath(MA_HOU_PAO_PUZZLE_ID),
          title: 'A served puzzle: 马后炮, cannon behind the horse',
          caption:
            'A served puzzle, live. Black to move, mate in two. Solve it and the site names the pattern: 马后炮, mǎ hòu pào, the cannon firing over the horse that also covers the escape squares.',
        } as ArticleBlock,
        {
          kind: 'table',
          headers: ['Pattern', 'Served puzzles'],
          rows: [
            ['马后炮 · Cannon behind the horse', '51'],
            ['铁门栓 · Iron bolt', '36'],
            ['双车错 · Scissoring chariots', '31'],
            ['白脸将 · Facing generals', '26'],
            ['钓鱼马 · Fishing horse', '16'],
            ['双照将 · Double check', '14'],
          ],
          caption:
            'The six most common named patterns on the served corpus. 226 of the 430 served mate puzzles carry at least one; the rest are mates with no classical name.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The names show only after the solve, since a name is a hint. What they are for comes next: a way to train on one pattern at a time, and a page per pattern for anyone who searches for it in English and finds nothing.',
        },
      ],
    },
  ],
};
