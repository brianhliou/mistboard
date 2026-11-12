import { JIEQI_CAPTURE_PRIVACY, JIEQI_RULES_THUMBNAIL, playClosing } from '../diagrams.js';
import { jieqiRulesDiagram } from '../../jieqi-rules-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const jieqiArticle: Article = {
  slug: 'jieqi',
  gameSpecId: 'jieqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Jieqi Rules (Reveal Xiangqi)',
  tagline: 'Xiangqi with every piece but the general face-down.',
  summary:
    'Jieqi, the hidden-piece Chinese chess variant, explained in English. Every piece but the general starts face-down, makes its first move as the piece whose point it stands on, then turns face-up.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-15',
  updatedAt: '2026-11-12',
  updateNote: 'The sample game is a new one, with every move graded by AB-JChess and the luck of each turned-over piece.',
  audience: 'Players learning jieqi, with or without experience of xiangqi.',
  thumbnail: { kind: 'svg', svg: JIEQI_RULES_THUMBNAIL },
  tldr: [
    'A face-down piece makes its first move using the role of its starting point, then reveals to both players.',
    'After revealing, it uses its own moves. Advisors can leave the palace and elephants can cross the river.',
    'Checkmate wins. Leaving your opponent with no legal move also wins, even without check.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Jieqi, also called Reveal Xiangqi, is xiangqi with shuffled, hidden pieces. You can see where every piece stands and which side it belongs to. Only the generals start face-up. You learn the identity of one of your other pieces by moving it. Red moves first.',
    },
  ],
  sections: [
    {
      heading: 'The board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pieces stand on points where the lines meet. Red starts at the bottom of the diagrams and moves toward the top. Black moves toward the bottom. The river divides the board across the middle. Each general stays inside its own palace, the area marked with diagonal lines.',
        },
        {
          kind: 'paragraph',
          text: "Set each general face-up at the centre of its back rank. Shuffle each side's other fifteen pieces separately and deal them face-down onto its remaining starting points. Each side has two advisors, two elephants, two horses, two chariots, two cannons, and five soldiers. Neither player knows the hidden identities, including their own. Face-down pieces are often called dark pieces.",
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('start', 'START: RED AT THE BOTTOM'),
          caption: 'The generals are face-up. Every plain disc is a face-down piece, red-brown for Red and green for Black. The deal changes identities, while the starting points stay the same.',
        },
        {
          kind: 'paragraph',
          text: 'The coordinates in these examples name points. Files run from a on the left to i on the right, as Red sees them. Ranks run from 1 at the bottom to 10 at the top. So b1 is a horse starting point beside the left corner; e4 is the central soldier starting point.',
        },
      ],
    },
    {
      heading: 'How a face-down piece moves',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A face-down piece moves, attacks, and captures as the piece that normally starts on its point. The corners use chariot moves. Beside them are horse points, then elephant points, then advisor points beside the general. The two pieces set forward behind the soldiers use cannon moves. The front line uses soldier moves. [Xiangqi Rules](/rules/xiangqi#the-pieces) draws each move on its own board.',
        },
        {
          kind: 'paragraph',
          text: 'You move and reveal as a single turn. There is no separate turn for flipping a piece in place. Its hidden identity cannot change the path of this first move: the piece on b1 must make a horse move even if it will turn out to be a cannon or an advisor.',
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('horse', 'BEFORE: HORSE POINT b1', 'AFTER: ADVISOR ON c3'),
          caption: 'Red moves b1 to c3 as a horse, which needs b2 empty. It lands and reveals as an advisor. The horse move from b1 to d2 is blocked by the piece on c1.',
        },
        {
          kind: 'paragraph',
          text: 'Both players see the identity when the piece lands, and from then on it moves and attacks as that piece.',
        },
        { kind: 'sub-heading', text: 'A cannon capture can reveal a soldier' },
        {
          kind: 'paragraph',
          text: 'A cannon captures by jumping over exactly one piece, and a face-down piece on a cannon point does the same. At the start, Red can play b3 to b10 by jumping over the black piece on b8, which stays where it is.',
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('cannon', 'BEFORE: CANNON POINT b3', 'AFTER: SOLDIER ON b10'),
          caption: 'The piece makes a cannon capture over b8, then reveals as a soldier. Red learns the captured identity. Black sees its face-down piece leave the board.',
        },
        {
          kind: 'paragraph',
          text: 'The revealed soldier has already crossed the river, so from b10 it can step sideways, but it cannot go back to b9.',
        },
      ],
    },
    {
      heading: 'Revealed pieces use their own moves',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A revealed advisor may leave the palace. A revealed elephant may cross the river. Their movement shapes stay the same: an advisor moves one point diagonally, and an elephant moves two diagonally, with the point between, called the eye, empty. The general always stays inside its own palace.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: jieqiRulesDiagram('advisor', 'REVEALED ADVISOR: c3 TO d4'),
              caption: 'After the b1 to c3 reveal and a Black reply, the advisor can step from c3 to d4. It can continue playing outside the palace.',
            },
            {
              svg: jieqiRulesDiagram('elephant', 'REVEALED ELEPHANT: a5 TO c7'),
              caption: 'A different deal puts an elephant under a4. Red moves it to a5 as a soldier. After Black replies, the elephant can capture on c7 across the river because b6, its eye, is clear.',
            },
          ],
        },
        {
          kind: 'paragraph',
          text: "A soldier follows its river rule from wherever it reveals, so a corner reveal can leave you with a soldier far behind your front line.",
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('corner', 'CORNER REVEAL: SOLDIER ON a3'),
          caption: 'Red can slide the dark piece from a1 to a3 as a chariot. Here it reveals as a soldier. It will have to advance as a soldier on later turns; its own piece on a4 currently blocks it.',
        },
      ],
    },
    {
      heading: 'Captured dark pieces',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If a piece is captured face-down, only its capturer learns its identity. Its former owner and spectators see a dark piece leave the board and nothing else. The capturer can then rule that identity out among the pieces still hidden. If the piece had already revealed, everyone already knew what was taken. The piece that made the capture reveals to both players either way.',
        },
        {
          kind: 'raw-svg',
          svg: JIEQI_CAPTURE_PRIVACY,
        },
      ],
    },
    {
      heading: 'Check, checkmate, and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A general is in check when an enemy piece attacks its point. A face-down enemy piece attacks using its starting-point role. A piece that has just moved attacks using its revealed identity, so you must look again after every reveal.',
        },
        {
          kind: 'paragraph',
          text: 'You must answer check on your turn, and a move that leaves your own general attacked is illegal. The generals also cannot face each other along a clear file. Any piece, including a face-down one, can block that file.',
        },
        {
          kind: 'table',
          wrap: true,
          headers: ['Position or event', 'Result on Mistboard'],
          rows: [
            ['The player to move is in check and has no legal move.', 'Checkmate. That player loses.'],
            ['The player to move has no legal move, even without check.', 'Stalemate. That player loses.'],
            ['80 plies pass without a capture.', 'Draw. A ply is one move by one player, so this is 40 moves by each side. Revealing a piece alone does not reset the count.'],
            ['The same position with the same side to move occurs for the third time.', 'A player who checked on every one of their turns in the repeating cycle loses. If nobody gave check in the cycle and only one player chased on every one of their turns, that player loses. Anything else is a draw.'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'A chase is a move that newly attacks an enemy piece, the same piece every time. Generals and soldiers never chase, and a general or a soldier that has not crossed the river cannot be chased. Attacking a protected piece does not count, and neither does attacking a piece of the same kind that could capture back. A horse or cannon attacking a chariot, or an advisor or elephant attacking a chariot, horse or cannon, counts even when the target is protected. Games started before this update keep the old rule: only perpetual check lost, and the no-capture draw came after 60 moves each.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'jqe, playing Red, against AB-JChess, from their 600-game match in October. Black is at the bottom of this board. Red takes six pieces in the first eleven moves, but two of Black’s face-down pieces turn over as chariots on moves 11 and 13, and the game swings to Black. Both sides slip once on move 17. On move 23 Red turns over the piece beside its general and gets a soldier, and Black’s chariots mate on move 25. The marks and side lines are AB-JChess’s reading of the game, and the die beside a turned-over piece grades how lucky the turn was.',
        },
        {
          kind: 'embed',
          // Local study ids (scripts/variant-lab/rules-page-games/plans/jieqi.plan.json);
          // swapped for the prod ids when the study is created there.
          path: '/embed/study/yjFgHr3X/onCJNmMA',
          title: 'Jieqi: jqe against AB-JChess, Black mates on move 25',
          // A placeholder until the card reports its height: the 702px column
          // holds the board, seat rows, win-chance graph, controls and credit.
          aspect: [702, 800],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'For more good games, [the match write-up](/blog/ab-jchess-vs-jqe) goes through six more, and [Fourteen wins against our jieqi bot](/blog/jieqi-bot-wins) shows how players have beaten it.',
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
              question: 'How is jieqi different from xiangqi?',
              answer:
                'Same board, same pieces, same checkmate goal. Every piece except the general starts face-down and shuffled, moves once as the piece that normally starts on its point, then flips and plays as itself. Revealed advisors may leave the palace and revealed elephants may cross the river.',
            },
            {
              question: 'Can I look at or flip my own face-down pieces without moving them?',
              answer: 'No. You learn a piece only when it moves, and a reveal is always part of a legal move.',
            },
            {
              question: 'Can a revealed advisor leave the palace, and can an elephant cross the river?',
              answer:
                'Both, yes. After revealing, a piece plays by its identity anywhere on the board. Advisors still step one point diagonally and elephants still move two, blocked at the eye.',
            },
            {
              question: 'Is stalemate a draw in jieqi?',
              answer: 'No. The player with no legal move loses, even when their general is not in check.',
            },
            {
              question: 'Where can I play jieqi online?',
              answer:
                'Here. Play a bot starts a game at the level you choose; Play a friend makes an invite link. No account is needed, and finished games get a move-by-move review.',
            },
            {
              question: 'Is there a jieqi app?',
              answer:
                'There is nothing to install. Mistboard runs in the browser on a phone, tablet, or desktop.',
            },
            {
              question: 'Can I play jieqi against an AI?',
              answer:
                'Yes. The levels run from beginner to strong, and stronger engines with their own neural networks sit above them. No bot can see your hidden pieces: each gets the same face-down board you do and is never told the deal.',
            },
            {
              question: 'Any tips for jieqi?',
              answer:
                'A dark piece is a one-shot option: on a chariot point it is a chariot for exactly one move, then whatever it really is. Do not spend that move on a cheap job. Strong players push a soldier before flipping the cannon, race to reveal a real chariot, and stop flipping once three major pieces are out. None of it has been measured; the openings article on this site lays out the argument with sources.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Above the eight Pikafish levels sits [AB-JChess](/blog/ab-jchess), the strongest jieqi bot on the site.',
      playLabel: 'Play a bot',
      playHref: '/?play=computer&gameSpecId=jieqi',
      layout: 'single-row',
      secondary: [
        { label: 'Play a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
