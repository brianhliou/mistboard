import type { Article, ArticleBlock } from '../types.js';

// The audit's short account. Every finding is a chapter in the study, where the
// book's line is the mainline and the fault is a branch at the move it happens;
// this page says what the count was and what the three classes of fault mean.
// Positions and lines come from scripts/problem-lab (the exact solver and the
// audit that generated the study), replayed here through the rules kernel.
// The audit study and the four chapters this page frames. Ids change whenever
// the study is reseeded, so they live here as one block: editing the study id
// and the chapter ids separately is how this page once shipped a new study with
// a previous seed's chapter ids, which renders as "chapter not available".
const STUDY_ID = 'dMzqT71w';
const STUDY = `/study/${STUDY_ID}`;
const CHAPTER = {
  dual: 't2fvSCYx',
  secondKey: 'qCaPgQkT',
  corrupt: '98Ce7IuR',
  famous: 'tao4KCOH',
} as const;
const embed = (chapter: keyof typeof CHAPTER) => `/embed/study/${STUDY_ID}/${CHAPTER[chapter]}`;
// The nine refuted records (scripts/problem-lab/refutations-study.ts, slug
// refuted-records). FSJc9OM6 is the LOCAL seed: the production seed creates a
// new id, and this constant must be set to it before the release that
// publishes this page. Only the CTA links it, so this is the one edit.
const REFUTED_STUDY_ID = 'FSJc9OM6';
const REFUTED_STUDY = `/study/${REFUTED_STUDY_ID}`;

export const solverAuditArticle: Article = {
  slug: 'solver-audit',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'What the Solver Found in the Old Manuals',
  cardTitle: 'Auditing the Old Manuals',
  seoTitle: 'An Exact Audit of the Classical Xiangqi Manuals',
  summary:
    'We ran an exhaustive solver over every short continuous-check composition in 適情雅趣 (1570), 渊深海阔 (1808) and a modern collection: 172 problems, asking whether the printed solution is the only one. Forty-five are. Seventy have a second winning continuation somewhere in the tree, fourteen have a second first move, nine can be mated faster, and three records turned out to be corrupt rather than wrong.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-06',
  audience:
    'Xiangqi players who know the classical manuals, and chess problemists who want to know what a 450-year-old composition tradition looks like under a solver.',
  intro: [
    {
      kind: 'paragraph',
      text: 'A 排局 gives you a diagram and a claim. Red to play and mate in five, by checks all the way. For four centuries the check on that claim has been another player’s eyes, and the tradition is good at it: these positions have been copied, corrected and argued over by people who knew the game better than any of us. What nobody has done is ask a machine to enumerate the whole tree and report every other way the mate works.',
    },
    {
      kind: 'paragraph',
      text: 'We did that for the short problems, the ones where a solution runs nine to thirteen plies and exhaustive search finishes. 172 compositions across three books. The books hold up better than the engine reports suggested and worse than a composition judge would want.',
    },
  ],
  sections: [
    {
      heading: 'Where the positions come from',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The three books are on dpxq.com, the two classical ones typed from 1980s and 1990s annotated reprints of Ming and Qing woodblocks. We mined every public-domain manual on its two 古谱 shelves, 2,938 records, and published the ones that replay as studies here, after telling the site’s owner, with a link back to each record. The diagrams and the moves are centuries old; every modern editor’s note stays on dpxq, because that part is not ours to republish.',
        },
        {
          kind: 'paragraph',
          text: 'A record arrives as two strings. 適情雅趣 第011局 群鼠争穴 is a board of two digits per piece, reading from Black’s back rank, and a move list in the same coordinates. Both are one long line in the file; they are broken up here, four pieces to a group:',
        },
        {
          kind: 'code',
          language: 'text',
          caption:
            'The record for 第011局 as dpxq serves it, trimmed to the three tags that carry the position, the solution and the book’s verdict (“Red gives up both chariots; the two cannons win”).',
          text:
            '[DhtmlXQ_binit]\n72999999 59999957 22771799 99999411\n29942993 09960996 80282294 89999999\n\n[DhtmlXQ_movelist]\n22204220 72320232 77706042 17373222\n57362232 36443222 4432\n\n[DhtmlXQ_comment0]\n红弃双车，双炮胜',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That becomes a position and a line by replaying it through the same rules kernel the site plays with. The replay is the first check on the record rather than on the book: a solution recorded short still replays cleanly, but a mis-typed piece usually produces an illegal move somewhere, and those records are dropped rather than trimmed. Then Pikafish sweeps each position for a verdict that contradicts the book’s, which is where the engine can say “this is not a Red win” and stop.',
        },
        {
          kind: 'paragraph',
          text: 'The sweep cannot say whether the solution is the only one. That takes exhaustive search: every legal Red move at every turn, every Black reply, to the end of the claimed length. On these boards, with twenty pieces and a nine-to-thirteen-ply solution, it finishes in seconds to a few minutes per problem. The whole audit below is a few hours of laptop time.',
        },
      ],
    },
    {
      heading: 'What counts as a fault',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Four things can be wrong with a solution that still mates. A second key: another first move forces the mate in the same number of moves, so the diagram has two answers. A dual: further in, after some defence, Red has two winning continuations. A faster mate: the book prints a mate in seven and a mate in five exists, which breaks the stipulation outright. A longer mate: the book is right about who wins and wrong about how long, because Black has a better defence than the one printed.',
        },
        {
          kind: 'paragraph',
          text: 'The dual is where the two traditions differ. Western chess composition has treated it as a fault since the nineteenth century. 朱鹤洲’s ten-character standard for judging 排局 asks for 新深妙多走少美无趣名, novelty, depth, brilliance, many variations, every attacking piece moving, few pieces, a pretty diagram, no idle piece, amusement and an apt title. Uniqueness is not on the list.',
        },
      ],
    },
    {
      heading: 'Forty-five of 172 are clean',
      blocks: [
        {
          kind: 'table',
          headers: ['Book', 'Audited', 'Sound', 'Dual', 'Second key', 'Faster', 'Longer'],
          rows: [
            ['適情雅趣 (1570)', '111', '28', '45', '7', '5', '21'],
            ['渊深海阔 (1808)', '39', '10', '12', '6', '4', '4'],
            ['林幼如作品集 (20th c.)', '22', '7', '13', '1', '0', '0'],
          ],
          caption:
            'Continuous-check compositions up to thirteen plies, each solved exhaustively: every key, every winning continuation after every defence. Each problem is counted once, under its most serious fault. The nine not in a column are one book key that misses its own length and five Red wins past the search’s reach, in 適情雅趣 and 林幼如作品集, and the three broken records in 渊深海阔.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Duals are the story, and they are not close calls. 適情雅趣 第011局 群鼠争穴 is a mate in seven: both chariots are given up, and the cannons and the horse do the rest. At Red’s sixth move the book plays 傌六进五, and 傌六进七 mates from the same position in the same number of moves.',
        },
        {
          kind: 'embed',
          path: embed('dual'),
          title: '適情雅趣 第011局 群鼠争穴: the book\u2019s line and the dual',
          caption:
            'The book\u2019s line to Red\u2019s sixth move, and then the other mate played out. Neither editor nor reader was looking for it, because in this tradition it has never been a fault. The chapter in the study carries both.',
          aspect: [702, 700],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The second keys are the ones a composer would care about. 第015局 妙振兵铃 opens with a chariot check and mates in six; pushing the soldier on d9 up beside the general mates in six as well, by a different arrangement of the same pieces. Seven of those in 適情雅趣 alone.',
        },
        {
          kind: 'embed',
          path: embed('secondKey'),
          title: '適情雅趣 第015局 妙振兵铃: two first moves that both mate in six',
          caption:
            'The second key played out: a different first move, the same six moves to mate.',
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Some records are broken, not wrong',
      blocks: [
        {
          kind: 'paragraph',
          text: '渊深海阔 第217局 疾诛文丑 claims a mate in five with every move a check, and the printed line does mate. It mates because Black’s fourth move walks into it. Black has a second legal move there, 车5退8, swinging the chariot that has stood on e2 since the diagram back to e10; after it Red has no check at all, so a continuous-check mate is over on the spot, and no quiet move mates either.',
        },
        {
          kind: 'embed',
          path: embed('corrupt'),
          title: '渊深海阔 第217局 疾诛文丑: the record as transcribed, and Black\u2019s mate',
          caption:
            'The book\u2019s line to Red\u2019s fourth move, and then the move the record does not give: 车5退8 in place of 士6进5. Red is out of checks.',
          aspect: [702, 700],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'No editor prints a Red win in a position where Red is lost, so the diagram as typed is probably not the composition. Which piece is wrong is a question a machine can help with: try every single-piece edit to the diagram, and ask which of them makes the book\u2019s own line a forced mate in five. Of 154 edits, four do. Three of them concern the black chariot on e2, and the fourth puts a black soldier on e3, in that chariot\u2019s file.',
        },
        {
          kind: 'code',
          language: 'text',
          caption:
            'Every single-piece edit that restores the book\u2019s solution. Three remove the black chariot on e2 or make it a weaker piece; the fourth blocks its file with the soldier from d2.',
          text: 'remove the black chariot on e2\nthe black piece on e2 is a horse, not a chariot\nthe black piece on e2 is a soldier, not a chariot\nblack soldier on d2 belongs on e3',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'We sent the board and the line to the person who maintains dpxq\u2019s records, in Chinese, with our guess that the chariot was a soldier in the book. His answer was 古谱就有错呀: the old manuals have errors in them. He did not check a printed copy, so whether the chariot is the book\u2019s mistake or the transcriber\u2019s is still open. If you have a printed edition of 渊深海阔, the square is e2.',
        },
        {
          kind: 'paragraph',
          text: 'The other two, 第202局 and 第265局, are worse off. No single-piece edit restores either of them, so whatever went wrong took more than one piece with it, or the move list is mis-typed as well. All three are still in the 渊深海阔 study as dpxq records them, and the audit study carries the finding.',
        },
        {
          kind: 'paragraph',
          text: 'Those three are the ones inside the 172. Across the whole corpus, 34 records are flagged as corrupt: the diagram as typed does not support the claim printed beside it. Ten of them claim mate by continuous checks, and nine are refuted inside the book\u2019s own line, in four manuals; in each, the search ran six moves past the recorded length and found no continuous-check mate. They have a study of their own, linked below, ordered by how decisive the refutation is: in 第217局 Red is left without a single check, and in the last Red still has ten checks that go nowhere.',
        },
        {
          kind: 'paragraph',
          text: 'That changes how the rest of this should be read. An exact search that reports no forced mate looks identical whether the composition is broken or the record is, and one engine evaluation at the root separates them in seconds. Five positions we had flagged as cooked turned out fine that way: Red does force the mate, later than the printed line.',
        },
      ],
    },
    {
      heading: 'The four great positions: nothing broken',
      blocks: [
        {
          kind: 'paragraph',
          text: '七星聚会, 蚯蚓降龙, 野马操田 and 千里独行 are the street positions, argued over since 百局象棋谱 in 1801. They claim a draw, and a draw cannot be proved without the repetition law. What can be tested is whether the claim breaks, with one side forcing a mate. Across twenty-nine records of those four and their relatives, the search found no mate that contradicts the book. On eight it proved that neither side mates within its depth; on the rest it ran out of budget for one side or both before it could say.',
        },
        {
          kind: 'embed',
          path: embed('famous'),
          title: '渊深海阔 第001局 七星曜彩: the book\u2019s draw, fifty-four plies',
          caption:
            '七星聚会 as 渊深海阔 prints it: two chariots, a cannon and three soldiers against a chariot, an elephant and four soldiers. Fifty-four plies of the book\u2019s line. Red cannot force a mate within the search; for Black, the search ran out of budget before it could say.',
          aspect: [702, 700],
        } as ArticleBlock,
      ],
    },
    {
      heading: 'What we did not check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The quiet compositions, which are most of the corpus. A 宽紧杀 runs past twenty plies on a board with twenty pieces, and the exhaustive search that settles a nine-ply problem does not finish there. A proof-number search gets further and still runs out on the long ones. Everything above is about continuous-check problems only.',
        },
        {
          kind: 'paragraph',
          text: 'None of this is a claim about the compositions as compositions. A dual in 適情雅趣 is a dual by a standard 適情雅趣 was not written to, and the geometry that made these positions worth copying for four hundred years is untouched by the count.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play every finding', href: STUDY, emphasis: 'primary' },
            { label: 'The nine refuted records', href: REFUTED_STUDY, emphasis: 'secondary' },
            { label: 'The manuals themselves', href: '/study', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
