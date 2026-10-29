import { BANQI_ENGINE_THUMBNAIL, playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Player-facing companion to the Banqi rules page: how the engine you play
// actually works, and one honest blind spot you can use. Sibling of the Misty
// (Fog of War) engine article.
//
// On 2026-10-16 the brianhliou.com engineering post of 2026-06-19
// (/posts/building-banqi-engine/, "Banqi: Self-Play Said +77 Elo, the Real Number
// Was Zero") was merged in here instead of moving as a twin: its In short list
// is the tldr, and its build sections (the honest yardstick, the value table and
// adaptive domination, the search plateau, the two pathology fixes, the
// AlphaZero de-risk) sit between this page's own sections, text unchanged. The
// zh strings come from that post's zh-hans and zh-hant translations.
//
// The three games are chapters of the public study "MistyBanqi against people"
// (scripts/misty-banqi-study.ts, data in scripts/data/misty-banqi-study.json,
// which holds the deals, moves and notes); misty-banqi-study.test.ts replays
// them and checks the embeds below against the data file. The general hunt is
// the same game (bq_e684b31b) the blog post stepped through.
const STUDY_ID = '4P6Di0tP';

function game(chapter: string, ply: number, title: string, caption?: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${STUDY_ID}/${chapter}?ply=${ply}`,
    title,
    ...(caption ? { caption } : {}),
    // Width-bound at the article column: a 2:1 board beside the sheet, plus
    // the seat rows, controls and credit line (as the rules page's embed).
    aspect: [702, 446],
  };
}

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

export const banqiEngineArticle: Article = {
  slug: 'mistybanqi',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  boardFamily: 'xiangqi',
  title: 'How MistyBanqi Plays and How It Was Built',
  cardTitle: 'How MistyBanqi Plays',
  seoTitle: 'Banqi Engine: How MistyBanqi Plays and How It Was Built',
  summary:
    'MistyBanqi is the engine you play in banqi on Mistboard: a classical search engine with a hand-written evaluation. How it thinks, and the blind spot worth knowing: it can draw a game it has already won.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-20',
  updatedAt: '2026-10-16',
  updateNote:
    'Added how the engine was built: self-play, the value table, the search plateau and the repetition fix.',
  audience:
    'Banqi players curious about the bot they play against, and anyone who wants to know where a hand-written engine cracks.',
  thumbnail: { kind: 'svg', svg: BANQI_ENGINE_THUMBNAIL },
  readNext: ['dou-shou-qi-engine', 'banqi-perpetual-chase'],
  tldr: [
    'MistyBanqi is an open-source Banqi (Chinese Dark Chess) engine, about even with the open engine I benchmarked it against. The closed programs are stronger.',
    'Self-play said a search change was worth +77 Elo; against the outside engine it was worth nothing. Every later change was measured against that engine.',
    'The outside benchmark found the cannon and chariot values swapped. The biggest eval gain, a piece’s value rising as its capturers leave the board, took the full stack to +16.6% against the benchmark.',
    'A cheap AlphaZero test topped out at a 35% win rate against the hand-tuned engine, so the paid run is on hold.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text:
        "MistyBanqi is the bot you play in [Banqi](/rules/banqi) on Mistboard. It's a classical engine: it searches ahead and scores positions with a hand-written evaluation, no neural network, and it's open source. It will outplay most people. It also has a few honest blind spots, and the one worth knowing is that it can draw a game it has completely won.",
    },
  ],
  sections: [
    {
      heading: 'How it thinks',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "Banqi hides information in its own way: every tile starts face-down, and flipping one reveals a random piece from the bag of what's left. So unlike chess, the engine's search tree mixes ordinary moves with chance events. MistyBanqi treats a flip as a chance node, averaging over the pieces the tile might turn out to be, and otherwise searches like a classical chess engine: it looks ahead through the lines both sides could play and backs up the value of the best one.",
        },
        {
          kind: 'paragraph',
          text:
            "What it can't do is judge a position by feel. Every leaf of that search gets scored by a hand-written evaluation: material on a corrected value table (the cannon, which captures by jumping a screen, is the most dangerous piece on the board), how many squares each piece controls, how exposed the general is, and a handful of other terms. The engine is only as good as those terms, which is where the weakness below comes from.",
        },
      ],
    },
    {
      heading: 'Most of the time, it wins',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "MistyBanqi will beat most people, and it does it the way a classical engine does: by calculating captures several moves deep. Step through a game where it clears the board. Banqi swings with the flips, so it even fell behind on material early here, then worked its way back until the opponent had no piece left to move. Tiles flip to their dealt piece the first time they're turned over.",
        },
        game('BRgLtDVe', 95, 'MistyBanqi wins · the opponent is left with no piece to move'),
        {
          kind: 'paragraph',
          text:
            'That kind of capture-by-capture calculation is the strong half of its game. The blind spot is the other half: what happens when the win needs no more captures, just patience.',
        },
      ],
    },
    {
      heading: 'How it was built',
      blocks: [
        p(
          'I built MistyBanqi, a classical Rust engine for Banqi (Chinese Dark Chess). It uses alpha-beta plus Star1 expectiminimax, a handcrafted evaluation, and no neural network in the playing version.',
        ),
        p(
          'This is not a strongest-engine claim. The strong Banqi programs, CLAP_CDC and DarkKnight, are closed and stronger. This is the build report for the strongest open-source engine I could make on the budget I was willing to spend. The useful result was not one magic eval term. Almost all the progress came from fixing how I measured strength.',
        ),
        p(
          'I started its evaluation from [george0828Zhang’s open-source CDC engine](https://github.com/george0828Zhang/chinese-dark-chess-hw), then kept that engine as the fixed opponent I measured every change against. MistyBanqi is now competent, about even with that benchmark, and open-source.',
        ),
      ],
    },
    {
      heading: 'Don’t measure against yourself',
      blocks: [
        p(
          'My first upgrade was the usual search machinery, a transposition table and repetition detection. I measured it against an earlier build of my own engine in paired self-play. It scored 60.9%, about +77 Elo, and every statistic said the gain was real.',
        ),
        p(
          'Then I ran the same change against the reference engine. The +77 Elo was gone; the result was even. A bot tuned against itself optimizes for beating its own blind spots, and the self-play number was measuring my engine’s idea of a hard opponent, which is just my engine. So I made that engine the yardstick and ran every later change as a large paired bakeoff against it, a few hundred games a side fanned across containers on Modal so each run lands in under an hour. Banqi draws a lot, so a few-percent edge needs that many games to see; the 20-game matches I started with were noise.',
        ),
      ],
    },
    {
      heading: 'Tuning the evaluation',
      blocks: [
        p(
          'The first thing the honest yardstick found was a bug I’d been carrying the whole time, in the piece-value table. Here is the corrected version:',
        ),
        {
          kind: 'table',
          headers: ['Piece', 'Value'],
          rows: [
            ['General', '30'],
            ['Cannon', '16 (was 12)'],
            ['Advisor', '14'],
            ['Elephant', '11'],
            ['Chariot', '9 (was 14)'],
            ['Horse', '7'],
            ['Soldier', '4'],
          ],
          highlightRows: [1, 4],
          keyColumn: true,
        },
        p(
          'The cannon and the chariot were backwards. The cannon captures by jumping a screen piece, which makes it the most tactically dangerous piece on the board even though it sits low in the capture order; the chariot is a plain slider. That one fix was worth a few points by itself and most of the eval gain. Self-play could never have shown it to me, because every version of my own engine carried the same wrong table; it took an outside opponent to expose it.',
        ),
        p(
          'The more interesting tuning is that a piece’s value depends on what’s left on the board, not a constant. The reference engine already did a small version of this for the general, the one piece a soldier can capture: its value climbs as enemy soldiers come off, because the only thing that threatens it is disappearing. I generalized that to every piece. Each piece has a set of enemy pieces that can capture it, and as those are traded away its value rises toward untouchable. That term, adaptive domination, was the single biggest eval gain, and the whole stack reached +16.6% against the reference engine with two-thirds fewer losses. It still gave +8.7% when I deliberately paired it with the old, wrong value table, which is the sign it captures real Banqi structure instead of numbers fit to one opponent.',
        ),
        p(
          'The whole term is a dozen lines. For every piece on the board, count the enemy pieces still alive (on the board or in the bag) that could capture it, and scale a bonus inversely:',
        ),
        {
          kind: 'code',
          language: 'rust',
          text: [
            '// dom_val: a piece\'s value grows as the enemy pieces that can capture it',
            '// disappear, toward "immortal" when its dominators are gone.',
            'const DOM_K: f64 = 0.5;',
            'for i in 0..NSQ {',
            '    let c = self.sq[i];',
            '    if !is_piece(c) { continue; }',
            '    let role = code_role(c);',
            '    let enemy = (1 - code_color(c)) as usize;',
            '    // living enemy pieces that can capture this role',
            '    // (role 5 = cannon, which screen-captures anything, so it always counts)',
            '    let mut dominators = 0;',
            '    for d in 0..7 {',
            '        if d == 5 || can_capture(d, role) { dominators += alive[enemy][d]; }',
            '    }',
            '    let bonus = values[role] * DOM_K / (1.0 + dominators as f64);',
            '    total += if code_color(c) == persp { bonus } else { -bonus };',
            '}',
          ].join('\n'),
        },
        p(
          'A general with the enemy soldiers all traded off, or any piece whose capturers have left the board, drifts toward untouchable, which is exactly the intuition a fixed table can’t hold. ([the full function](https://github.com/brianhliou/misty-banqi/blob/main/banqi_rust/src/engine.rs))',
        ),
      ],
    },
    {
      heading: 'The strength wasn’t in more search',
      blocks: [
        p('The static eval terms plateaued, so next I went after depth. Two things stopped me.'),
        p(
          'First, the flips. At a flip node the engine has to average over every piece the tile might turn out to be, so a single flip fans out into a dozen-odd weighted outcomes, and there are many flippable tiles. That chance branching makes the tree explode; you can’t naively search deep in Banqi the way you can in chess. (Star1 expectiminimax prunes the chance branches, which helps, but it doesn’t make the problem go away.)',
        ),
        p(
          'Second, and more important: even with more nodes, the results stopped moving. Past a few hundred thousand nodes per move, deeper play didn’t beat the reference engine any better. The bottleneck wasn’t depth. It was the evaluation, the function that scores a position the search bottoms out on. So I stopped trying to search my way to strength and started watching games. A win-rate tells you that you’re losing; it never tells you which move to look at.',
        ),
      ],
    },
    {
      heading: 'It can draw a game it has won',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "Here is the same engine in a position it has completely won. It is up ten pieces to two, with nothing left to capture, and the only task is to walk the win home. It draws instead.",
        },
        game(
          'G1ULot1C',
          56,
          'Draw by repetition · MistyBanqi up 10 pieces to 2',
          'Played before October 2026, when every threefold repetition was a draw. The chase rule the site plays under now forbids the 64th move, so this board stops at move 63.',
        ),
        {
          kind: 'paragraph',
          text:
            "Nothing in the evaluation rewards converting a won position over just holding material, so a position it's winning by a mile and a position it has actually won score about the same. With no term pushing it to make progress, it never forces the issue, and the game drifts into a threefold repetition, which banqi scores as a draw.",
        },
        p(
          'The engine was also blind to the repetition itself. In production it was handed only the current position with no history, so it could not see the repetition it was walking into.',
        ),
        p(
          'The fix threaded the real game’s move history into the search, so the engine sees a repetition coming and avoids it when ahead, seeking it only when losing (a small contempt setting). That was worth about +53 Elo. A separate guard handles the ugliest version, where the engine sheds a piece into a losing capture and then takes the draw anyway, strictly worse than just taking it. That one looked like a contempt bug, but it reproduced at contempt zero; the real cause was the eval scoring the losing capture a hair above the draw value.',
        ),
        {
          kind: 'paragraph',
          text:
            "There's an upshot for you here. If you're losing on material, you're not necessarily lost: MistyBanqi may still shuffle into a [repetition draw](/blog/banqi-perpetual-chase). It happens often enough to measure: in 200 games of the engine against itself, [one in six ended in a draw](/blog/banqi-statistics), and half of those had passed through a winning position.",
        },
      ],
    },
    {
      heading: 'It can also lose its own general',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "A related blind spot involves the general. Only a soldier, the other general or a cannon's jump can take it, so a boxed-in general is in danger from one piece at a time, and the engine is slow to make room for one cornered. It will sometimes march a piece off to the far side of the board while a lone enemy soldier walks up and traps it. Same gap as the draw above: the evaluation has no real sense of a slow, quiet threat building several moves away.",
        },
        p(
          'Watch a single enemy soldier hunt Misty’s general down the a-file. MistyBanqi has the black pieces. Its general is on b1, and the red soldier that will hunt it is on b4.',
        ),
        game(
          'ZFrZS00U',
          44,
          'One soldier hunts the general into the corner',
          'MistyBanqi (black) against a player on Mistboard, 18 June 2026, moves 44 to 58.',
        ),
        p(
          'Misty (black, here) drifts its general into the a1 corner. One red soldier marches up the file, and the general is walled in: the squares next to it are still face-down, you can’t move onto a face-down tile, and a general can’t capture a soldier. It ends with no legal move at all, frozen in place, and is captured 28 moves later.',
        ),
        p(
          'The save is what players call making luft: flip a face-down neighbour to open the general an escape before the hunter arrives. I added a general-safety term that induces exactly that, and it cut how often Misty loses its own general from 35.5% to 26%. Look at what measuring that took: against the reference engine the win-rate barely moved, because it doesn’t hunt generals and Misty usually won these games anyway. The benchmark couldn’t see the fix, so I measured the disaster directly instead of trusting the score. (I also caught myself asking the engine’s own eval whether a save worked. An eval that’s blind to the danger can’t grade a fix for its own blindness, so I checked it by hand.)',
        ),
        p(
          'This is the honest edge of what handcrafting reaches. The threat is a slow, quiet, multi-move march that no static term sees until it’s too late, which is exactly the long-horizon judgment a learned evaluation is for.',
        ),
      ],
    },
    {
      heading: 'Why these exist, and what’s next',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "These are the limits of a hand-written evaluation: it can only value what someone thought to encode, and conversion and slow king-hunts are exactly the long-horizon calls that are hard to write down. The fix the strongest Dark Chess programs use is a learned evaluation, trained from game outcomes, which lets the engine judge these on its own. That's the eventual next step for MistyBanqi. Until a learned version clears the current engine's bar in testing, the hand-written one is what you play: strong, and honest about where it cracks.",
        },
      ],
    },
    {
      heading: 'The last measurement: is the climb worth paying for?',
      blocks: [
        p(
          'The cheap gains are spent, and both pathologies point at the same fix: an evaluation that understands positions instead of counting them. That’s a learned value network, the AlphaZero recipe CLAP_CDC used to win the Computer Olympiad at this game.',
        ),
        p(
          'So I built the pipeline (board encoding, a small ResNet, chance-aware MCTS, gated self-play so a bad generation can’t poison the next), and then, before paying for a full run, made one more measurement: a cheap local de-risk to check whether the value net would actually beat the hand-tuned engine.',
        ),
        p(
          'It didn’t. I ran the de-risk on my laptop’s GPU, and across three runs the network capped around a 35% win-rate against the alpha-beta engine, never reaching the 55% that would count as an improvement. Doubling the search budget barely moved it, so this isn’t a case of too few games; the likeliest causes are the noisy value targets the chance nodes produce and a network that’s too small. Those are fixable, but testing the fixes needs far more compute than a laptop that throttles after a few hours, and cloud GPUs aren’t plug-and-play here: the game logic is single-threaded Python, so a fast GPU sits starved waiting on it until that path is rewritten in Rust behind a batched inference server. That’s a week or two of work, then hundreds to low thousands of dollars to run. On the evidence I have, it’s a bet, not a sure step, so I haven’t taken it; the cheaper local experiments come first.',
        ),
        p(
          'So MistyBanqi is a competent alpha-beta engine, not a state-of-the-art claim, and that’s a measured choice, not a dead end. I haven’t run a reproducible head-to-head against CLAP_CDC, DarkKnight, or other top CDC programs; the learned net is the next climb, the day a de-risk says it’s worth paying for.',
        ),
        p(
          'The pattern under every section here: the cheapest, highest-leverage decision in the whole project was choosing what to measure. The self-play score, the win-rate, the general-loss rate, the de-risk gate, each time picking an instrument that could see what I actually cared about did more than any change to the engine itself.',
        ),
        p(
          '[misty-banqi](https://github.com/brianhliou/misty-banqi) is the engine, MIT-licensed, alpha-beta + Star1 search and the eval terms above. [chinese-dark-chess-hw](https://github.com/george0828Zhang/chinese-dark-chess-hw) is the open engine I started the evaluation from and used as the fixed benchmark. More in the engine series: [the Dou Shou Qi engine](/blog/dou-shou-qi-engine), the perfect-information cousin on a bigger board.',
        ),
      ],
    },
    playClosing({
      heading: 'Play it',
      lead: 'MistyBanqi is live on Mistboard. Take it on at the strength you pick, or read its source.',
      playLabel: 'Play MistyBanqi',
      playHref: '/?play=computer&gameSpecId=banqi',
      secondary: [
        {
          label: 'misty-banqi on GitHub',
          href: 'https://github.com/brianhliou/misty-banqi',
          emphasis: 'secondary',
          external: true,
        },
        { label: 'Banqi Rules', href: '/rules/banqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
