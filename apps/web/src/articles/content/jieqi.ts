import { JIEQI_CAPTURE_PRIVACY, JIEQI_RULES_THUMBNAIL, playClosing } from '../diagrams.js';
import { jieqiRulesAfterPair, jieqiRulesDiagram, jieqiRulesStartPair } from '../../jieqi-rules-diagrams.js';
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
  updatedAt: '2026-11-27',
  updateNote: 'The rules are shorter, set out as lists beside the diagrams, with a new board showing how each face-down piece makes its first move.',
  audience: 'Players learning jieqi, with or without experience of xiangqi.',
  thumbnail: { kind: 'svg', svg: JIEQI_RULES_THUMBNAIL },
  tldr: [
    'Every piece but the general starts face-down and makes its first move as the piece whose point it starts on.',
    'That move turns it face-up, and from then on it plays as itself. Advisors may leave the palace and elephants may cross the river.',
    'Checkmate wins, and so does leaving your opponent with no legal move.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Jieqi, also called Reveal Xiangqi, is xiangqi played with the pieces shuffled face-down. You can see where every piece stands and whose it is, but not what it is until it moves. Red moves first.',
    },
  ],
  sections: [
    {
      heading: 'The board and setup',
      blocks: [
        {
          kind: 'raw-svg',
          svg: jieqiRulesStartPair('WHAT YOU SEE', 'WHAT EACH POINT MOVES AS'),
        },
        {
          kind: 'list',
          items: [
            '**The generals start face-up** in the centre of each back rank.',
            "**Each side's other 15 pieces are shuffled face-down** onto that side's usual starting points. Nobody knows which is which, not even their owner.",
            '**A face-down piece moves as the piece that starts on its point** in xiangqi, shown on the right. [Xiangqi Rules](/rules/xiangqi#the-pieces) draws each move.',
          ],
        },
      ],
    },
    {
      heading: 'How a face-down piece moves',
      blocks: [
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('horse', 'MOVES AS A HORSE', 'TURNS OVER: AN ADVISOR'),
        },
        {
          kind: 'list',
          items: [
            '**Its first move is its point’s move.** The piece on a horse point makes a horse move, whatever it turns out to be.',
            '**It turns face-up where it lands**, for both players to see. Moving and turning over is one turn; you cannot flip a piece in place.',
          ],
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('cannon', 'CAPTURES AS A CANNON', 'TURNS OVER: A SOLDIER'),
        },
        {
          kind: 'list',
          items: [
            '**Captures work the same way.** A piece on a cannon point captures by jumping one piece, as a cannon does.',
          ],
        },
      ],
    },
    {
      heading: 'Revealed pieces use their own moves',
      blocks: [
        {
          kind: 'raw-svg',
          svg: jieqiRulesAfterPair(
            ['advisor', 'ADVISOR OUT OF THE PALACE'],
            ['elephant', 'ELEPHANT ACROSS THE RIVER'],
          ),
        },
        {
          kind: 'list',
          items: [
            '**Advisors may leave the palace**, still one point diagonally.',
            '**Elephants may cross the river**, still two points diagonally, blocked when the point between them is taken.',
            '**The general never leaves its palace.**',
          ],
        },
        {
          kind: 'raw-svg',
          svg: jieqiRulesDiagram('corner', 'MOVES AS A CHARIOT', 'A SOLDIER FROM THE CORNER'),
        },
        {
          kind: 'list',
          items: [
            '**A soldier keeps its river rule wherever it turns over.** This one moved from the corner as a chariot, and now it can only step forward.',
          ],
        },
      ],
    },
    {
      heading: 'Captured dark pieces',
      blocks: [
        {
          kind: 'raw-svg',
          svg: JIEQI_CAPTURE_PRIVACY,
        },
        {
          kind: 'list',
          items: [
            '**Only the capturer learns what a face-down piece was.** Its owner and spectators see a dark piece leave the board.',
            '**A face-down piece that captures turns over** for both players, as on any move.',
          ],
        },
      ],
    },
    {
      heading: 'Check, checkmate, and draws',
      blocks: [
        {
          kind: 'list',
          items: [
            '**A face-down piece never gives check.** No starting point reaches the enemy palace. The move that turns it over can check, as the piece it turns out to be.',
            '**Answer every check.** A move that leaves your general attacked is illegal.',
            '**The generals may not face each other** on an open file. Any piece blocks it, face-down ones included.',
          ],
        },
        {
          kind: 'table',
          wrap: true,
          headers: ['When', 'Result'],
          rows: [
            ['You have no legal move and are in check', 'Checkmate: you lose.'],
            ['You have no legal move and are not in check', 'Stalemate: you lose too.'],
            ['80 plies (40 moves each) pass without a capture', 'Draw. A reveal alone does not reset the count.'],
            ['The same position, with the same side to move, comes a third time', 'Whoever checked on every turn of the cycle loses. Otherwise, if one player alone chased on every turn, that player loses. Anything else is a draw.'],
          ],
        },
        { kind: 'sub-heading', text: 'What counts as a chase' },
        {
          kind: 'list',
          items: [
            '**A chase newly attacks an enemy piece**, the same piece every time.',
            '**It does not count against a protected piece**, or against a piece of the same kind that could take back.',
            '**Except:** a horse or cannon attacking a chariot, or an advisor or elephant attacking a chariot, horse or cannon, counts even when the target is protected.',
            '**Generals and soldiers never chase.** A general, or a soldier that has not crossed the river, cannot be chased.',
          ],
        },
        {
          kind: 'note',
          label: 'Older games',
          text: 'A game started under the older rule keeps it: only perpetual check lost, and the no-capture draw came after 60 moves each.',
        },
      ],
    },
    {
      heading: 'About jieqi',
      blocks: [
        {
          kind: 'list',
          items: [
            "**It began in Guangzhou in the 1980s,** by [Chinese Wikipedia's account](https://zh.wikipedia.org/wiki/%E6%8F%AD%E6%A3%8B), when two brothers brought the hidden pieces of a military board game into xiangqi. It spread through Guangdong, Hong Kong and Macau.",
            '**The first tournament with standard rules was in Hong Kong in May 2011**, with more than 60 players. The first online one followed in 2014.',
            "**Today it is a built-in mode in China's biggest xiangqi apps**, and it is spreading in Vietnam, where it is called Cờ úp.",
          ],
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'jqe, playing Red, against AB-JChess, from their 600-game match in October. Black is at the bottom of this board. Red takes six pieces in the first eleven moves, but two of Black’s face-down pieces turn over as chariots on moves 11 and 13. On move 23 Red turns over the piece beside its general and gets a soldier, and Black’s chariots mate on move 25. The marks are AB-JChess’s grades, and the die beside a turned-over piece grades its luck.',
        },
        {
          kind: 'embed',
          // Local study ids (scripts/variant-lab/rules-page-games/plans/jieqi.plan.json);
          // swapped for the prod ids when the study is created there.
          path: '/embed/study/4KNglJHs/olxXB9Ny',
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
      lead: 'Play it here in English with no account. The bots never see your face-down pieces, every finished game gets a move-by-move review, and above the eight Pikafish levels sits [AB-JChess](/blog/ab-jchess), the strongest jieqi bot on the site.',
      playLabel: 'Play a bot',
      playHref: '/?play=computer&gameSpecId=jieqi',
      layout: 'single-row',
      secondary: [
        { label: 'Play a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
