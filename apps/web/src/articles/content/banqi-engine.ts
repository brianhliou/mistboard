import { BANQI_CONVERSION_GAME, BANQI_WIN_GAME } from '../../banqi-engine-game.js';
import { BANQI_ENGINE_THUMBNAIL, playClosing } from '../diagrams.js';
import type { Article } from '../types.js';

// Player-facing companion to the Banqi rules page: how the engine you play
// actually works, and one honest blind spot you can use. The full engineering
// writeup (how each pathology was found and measured) lives on the author's
// blog; this page is the short, playable version. Sibling of the Misty (Fog of
// War) engine article.

export const banqiEngineArticle: Article = {
  slug: 'mistybanqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'How MistyBanqi Plays',
  summary:
    'MistyBanqi is the engine you play in Banqi on Mistboard: a classical search engine with a hand-written evaluation. How it thinks, and the blind spot worth knowing: it can draw a game it has already won.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-20',
  audience:
    'Banqi players curious about the bot they play against, and anyone who wants to know where a hand-written engine cracks.',
  thumbnail: { kind: 'svg', svg: BANQI_ENGINE_THUMBNAIL },
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
        {
          kind: 'banqi-replay',
          spec: {
            red: BANQI_WIN_GAME.red,
            black: BANQI_WIN_GAME.black,
            event: BANQI_WIN_GAME.event,
            outcome: BANQI_WIN_GAME.outcome,
            resultText: BANQI_WIN_GAME.result,
            deal: BANQI_WIN_GAME.deal,
            moves: BANQI_WIN_GAME.moves,
          },
        },
        {
          kind: 'paragraph',
          text:
            'That kind of capture-by-capture calculation is the strong half of its game. The blind spot is the other half: what happens when the win needs no more captures, just patience.',
        },
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
        {
          kind: 'banqi-replay',
          spec: {
            red: BANQI_CONVERSION_GAME.red,
            black: BANQI_CONVERSION_GAME.black,
            event: BANQI_CONVERSION_GAME.event,
            outcome: BANQI_CONVERSION_GAME.outcome,
            resultText: BANQI_CONVERSION_GAME.result,
            deal: BANQI_CONVERSION_GAME.deal,
            moves: BANQI_CONVERSION_GAME.moves,
          },
        },
        {
          kind: 'paragraph',
          text:
            "Nothing in the evaluation rewards converting a won position over just holding material, so a position it's winning by a mile and a position it has actually won score about the same. With no term pushing it to make progress, it shuffles, and Banqi's threefold-repetition rule ends the game a draw.",
        },
        {
          kind: 'paragraph',
          text:
            "There's an upshot for you here. If you're losing on material, you're not necessarily lost: herd one of its strong pieces into a perpetual chase, and MistyBanqi may walk into the draw it can't see it should decline. It happens often enough to measure: in 200 games of the engine against itself, [one in six ended in a draw](/blog/banqi-statistics), and half of those had passed through a winning position.",
        },
      ],
    },
    {
      heading: 'It can also lose its own general',
      blocks: [
        {
          kind: 'paragraph',
          text:
            "A related blind spot involves the general. A soldier is the only piece that can capture it, and the engine is slow to make room for a general boxed into a corner. It will sometimes march a piece off to the far side of the board while a lone enemy soldier walks up and traps it. Same gap as the draw above: the evaluation has no real sense of a slow, quiet threat building several moves away.",
        },
        {
          kind: 'paragraph',
          text:
            'How each of these was found, reproduced, and measured is written up in detail in the engineering post linked below.',
        },
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
    playClosing({
      heading: 'Play it',
      lead: 'MistyBanqi is live on Mistboard. Take it on at the strength you pick, or read the full writeup of how it was built and measured.',
      playLabel: 'Play MistyBanqi',
      playHref: '/?play=computer&gameSpecId=banqi',
      secondary: [
        {
          label: 'The engineering story',
          href: 'https://brianhliou.com/posts/tuning-a-banqi-engine/',
          emphasis: 'secondary',
          external: true,
        },
        { label: 'Banqi Rules', href: '/rules/banqi', emphasis: 'secondary' },
      ],
    }),
  ],
};
