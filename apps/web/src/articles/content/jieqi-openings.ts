import {
  JIEQI_OPENING_MOVES,
  JIEQI_OPTION_SPENT,
  JIEQI_RULES_THUMBNAIL,
  JIEQI_START_ROW,
} from '../diagrams.js';
import type { Article } from '../types.js';

export const jieqiOpeningsArticle: Article = {
  slug: 'jieqi-openings',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'What Strong Jieqi Players Believe About the Opening',
  seoTitle: 'Jieqi Opening Theory: The First Move, Ranked',
  summary:
    'Jieqi has no opening book. It has an argument about the first move, running on Chinese forums among players with thousands of games, never written down in English. Why a face-down piece is a one-shot option you can waste, five openings ranked, and the pawn push weighed against the crossed cannon on all six reveals.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-04',
  audience:
    'Jieqi and xiangqi players who want to know what the first move is worth, and English speakers who have never seen this material because it has only ever existed in Chinese.',
  thumbnail: { kind: 'svg', svg: JIEQI_RULES_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text:
        'Jieqi has no opening book. No catalog of variations, no agreed piece-value table, nothing to memorize. One of the strongest players who writes about the game, a level-two Chinese xiangqi player claiming 90% over three thousand games, started the missing book and got one chapter in.',
    },
    {
      kind: 'paragraph',
      text:
        'What exists is an argument about the first move, running on Chinese forums for years, never written down in English. Here it is, with the sources at the bottom. Treat it as what strong players believe: none of it has been measured.',
    },
    {
      kind: 'raw-svg',
      svg: JIEQI_START_ROW,
      caption:
        'Every piece but the two generals starts face-down and shuffled. Neither player knows their own.',
    },
  ],
  sections: [
    {
      heading: 'A dark piece moves as the point it stands on',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'A face-down piece moves, attacks, and captures as the piece belonging to the point it sits on, not as whatever it turns out to be. A dark piece on a cannon point moves like a cannon and captures like a cannon. Then it flips and plays as itself. The [rules page](/rules/jieqi) has the rest.',
        },
        {
          kind: 'paragraph',
          text:
            'So a face-down piece holds one use of its square’s power. A dark piece on a chariot point is a chariot for exactly one move, and then it is whatever it actually is, which might be a pawn. That single move is the most valuable thing about it, and you get to spend it once.',
        },
        {
          kind: 'paragraph',
          text:
            'Flipping costs two things. The square’s power goes, and so does the concealment: your opponent does not know what the piece is either, so while it stays down it threatens as its point in their reading of the position too. What you buy is that the piece plays as itself from then on, which is often a downgrade. The common mistake is spending an expensive option on a cheap job, and it costs nothing you can see on the board.',
        },
        {
          kind: 'raw-svg',
          svg: JIEQI_OPTION_SPENT,
          caption:
            'The same move, before and after. Face-down on a cannon point it slides the file and takes the horse behind the screen. Play that capture and you have spent a cannon’s only shot to win a horse, and what stands on the point is a soldier. Strong players call that trade a loss.',
        },
        {
          kind: 'paragraph',
          text:
            'The first move is therefore two decisions. You choose which option to spend, and you take a lottery ticket on what stands up.',
        },
      ],
    },
    {
      heading: 'Five first moves, ranked',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'From the largest jieqi thread on Zhihu, ranked by a player with more than four hundred games.',
        },
        {
          kind: 'raw-svg',
          svg: JIEQI_OPENING_MOVES,
          caption:
            'Where they are, from Red’s side. Left board, left to right: the edge pawn, the 3- or 7-file pawn push, the central pawn, and the cannon point crossing the river. Right board: both cannons firing over the black cannons to take both horses.',
        },
        {
          kind: 'table',
          wrap: true,
          headers: ['Opening', 'Verdict'],
          highlightRows: [0],
          rows: [
            ['Pawn push (仙人指路)', 'Standard. No bad reveal.'],
            ['Crossed cannon (炮二进四)', 'Good on a pawn, bad on a horse.'],
            ['Central pawn (冲中兵)', 'Risky. Exposed in the middle.'],
            ['Edge pawn (九尾龟)', 'Poor. An edge horse is stuck.'],
            ['Both cannons take horses', 'Losing. A weak player’s gamble against a strong one.'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            'Option cost explains both ends of that list. The pawn push is first because a pawn point’s one move is the cheapest thing in the game to spend. Taking two horses with two cannons is last because it spends the two most expensive options on the board for two horses.',
        },
        {
          kind: 'paragraph',
          text:
            'The middle two rank on position. The central pawn is the sensitive one: turn over a chariot there and a revealed cannon can kill it, but turn over a cannon and you can probe the centre and both edges for chariots, and those follow-ups are settled enough that players call them 定式, set patterns. The edge pawn is just as cheap and buys much less. It opens a path for the edge horse and announces that it is doing so, and a horse turned over on the edge is stuck where it stands.',
        },
        {
          kind: 'paragraph',
          text:
            'Our own games disagree with the list. Across fifty jieqi games here that ran past ten moves, humans playing Red opened with the central pawn in fourteen of twenty-five, and with the recommended pawn push in three. Whatever the forums say, players open in the middle.',
        },
        {
          kind: 'paragraph',
          text:
            'PikaJieQi, our build of Pikafish’s jieqi branch, declines the list altogether. In twenty of its twenty-five games as Red it opened from a back-rank horse point, h1 to g3 or b1 to c3, a development move none of the five covers. Read that carefully before treating it as a verdict. It is one engine at two settings repeating itself, not twenty independent opinions. The humans lost almost every game, so nothing here settles which opening is better. And PikaJieQi runs a hand-written evaluation with no neural network, so its opening preference reflects the heuristics someone wrote into it rather than anything it learned. What it does suggest is that the list answers a narrower question than it appears to.',
        },
      ],
    },
    {
      heading: 'The pawn push beats the crossed cannon on 13 of 15',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'A player rated 揭7 on two accounts weighed the top two against each other: the pawn push against the cannon point crossing the river. Whichever you pick, the piece you move is your own and you do not know what it is until it lands. Fifteen sit face-down on your side, five pawns and two each of chariot, horse, cannon, advisor and elephant, so the odds on what stands up are countable.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['What flips up', 'Odds', 'Better opening'],
          highlightRows: [5],
          rows: [
            ['Pawn', '33%', 'Pawn push'],
            ['Chariot', '13%', 'Pawn push'],
            ['Cannon', '13%', 'Pawn push'],
            ['Horse', '13%', 'Pawn push'],
            ['Elephant', '13%', 'Pawn push'],
            ['Advisor', '13%', 'Crossed cannon'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            'On a pawn, the crossed cannon eats once and gives up two or three reveals in exchange. On a chariot, holding a dark cannon in reserve beats holding a dark pawn. The rest it simply plays less efficiently, and the advisor is the one case it wins, slightly.',
        },
        {
          kind: 'paragraph',
          text:
            'Thirteen of the fifteen favour the pawn push, about 87%, and the count understates it: the crossed cannon’s one win is slight while several of the pawn push’s are decisive. The verdicts are theirs, the weights are mine from the piece counts, and nobody has run that comparison past an engine.',
        },
        {
          kind: 'paragraph',
          text:
            'Those odds hold on move one. The deck does not refill, so every reveal narrows what is left, and a player counting what has already turned over is working from better numbers later in the game.',
        },
      ],
    },
    {
      heading: 'A chariot is worth about two cannons',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'In xiangqi a chariot trades roughly for a horse and a cannon. In jieqi the same players put it higher, closer to two cannons, and arguably above a horse, cannon and advisor together. The general has no fixed guard here: any piece can be anything, so the wall in front of a jieqi general is whatever happened to land there, and a chariot walks through it.',
        },
        {
          kind: 'paragraph',
          text:
            'Protect yours. Holding one chariot against two, refuse the trade, even with both of theirs still face-down. This is also why the two dark pieces on the back chariot points usually stay down: they defend, and they are the most expensive unspent options either player holds.',
        },
      ],
    },
    {
      heading: 'With a chariot: the river bank, then the file',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'One sequence in jieqi behaves like a line. With a chariot out, take the opponent’s river bank, occupy a file, and prepare the attack that comes with exposing your own general. Experienced opponents know the answer: fly an elephant and jump a horse quickly, so the back chariot point covers the approach.',
        },
        {
          kind: 'paragraph',
          text:
            'A chariot-led file attack against a fast elephant-and-horse screen is as close as this opening gets to established theory.',
        },
      ],
    },
    {
      heading: 'Black races for a chariot of their own',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Everything above is Red’s choice. Red’s edge is larger here than in xiangqi, because chariots can sit face-down and arrive in the middlegame.',
        },
        {
          kind: 'paragraph',
          text:
            'When Red’s pawn push turns over a chariot, develop a horse and race for a chariot of your own. There is no better answer, and strong players do not pretend there is one.',
        },
        {
          kind: 'paragraph',
          text:
            'When your chariots arrive late anyway, drop the development order. Pawn, then horse, then advisor is a peacetime plan. Get both horses out instead, so your pieces defend each other.',
        },
      ],
    },
    {
      heading: 'Stop flipping once three major pieces are out',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Once three major pieces are revealed and active, attack with them. Flipping past that point hands the initiative to whoever is already developed, because a flip is a move that threatens nothing while your opponent uses theirs. On Tiantian Xiangqi the rated jieqi clock is tighter than the xiangqi one and carries no per-move increment, so the player still turning pieces over in a sharp position tends to lose on time as well.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play Jieqi', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'primary' },
            { label: 'Jieqi on Mistboard', href: '/blog/jieqi-platform', emphasis: 'secondary' },
          ],
        },
      ],
    },
    {
      heading: 'Sources',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Three Chinese-language posts. Titles are given in English, with the original after, so you can search for them.',
        },
        {
          kind: 'paragraph',
          text:
            '[Notes on Jieqi, Part 1](https://zhuanlan.zhihu.com/p/347466882) (揭棋心得 Part.1). The closest thing to a jieqi book that exists, and it is one chapter. Source for the piece values, the chariot, and what spending an option costs.',
        },
        {
          kind: 'paragraph',
          text:
            '[What do you make of Tiantian Xiangqi’s jieqi mode?](https://www.zhihu.com/question/53501615) (如何看待天天象棋推出的“揭棋”玩法？). The largest jieqi discussion anywhere. Source for the ranking, the reveal-by-reveal case, and the chariot plan.',
        },
        {
          kind: 'paragraph',
          text:
            '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.',
        },
        {
          kind: 'paragraph',
          text:
            'There is no jieqi opening database and no published statistics. The fifty games cited above are our own, they are mostly humans losing to Pikafish, and they are nowhere near enough to settle whether the pawn push really outperforms the crossed cannon. They are enough to say what people here actually play.',
        },
      ],
    },
  ],
};
