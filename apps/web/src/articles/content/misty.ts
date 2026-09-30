import type { Article } from '../types.js';

export const mistyArticle: Article = {
    slug: 'misty',
    kind: 'article',
    publisher: 'mistboard',
    title: 'How Misty Plays',
    summary:
      "Misty is Mistboard's Fog of War chess engine: how it sees, searches possible boards, avoids hidden catastrophes, and where the current version stands.",
    thumbnail: {
      kind: 'image',
      src: '/article-thumbs/misty-engine-belief-20260708.jpg',
      alt: 'A cute mist engine mascot thinking through glowing paths in a foggy search space.',
    },
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-06-21',
    updatedAt: '2026-09-05',
    audience:
      'Dark chess players and chess-engine builders curious about how the Mistboard engine works.',
    intro: [
      {
        kind: 'paragraph',
        text:
          'Misty is the bot you play on Mistboard in Fog of War chess. It is not allowed to peek. The server sends it the same kind of limited view a human player gets, then Misty has to choose a move from that uncertainty.',
      },
    ],
    sections: [
      {
        heading: 'It plays under the same fog you do',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Misty never sees the canonical board. Each move, it gets only what the side to move can legally observe under Fog of War: its own pieces, the squares they see, and the captures in view. Everything else is hidden. It plays under the same rules you do, and you can verify that: Mistboard is open source, so anyone can audit the server code that enforces the fog before the engine sees a position.',
          },
        ],
      },
      {
        heading: 'How it thinks',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'A classical chess engine like Stockfish has one advantage: it can see the whole board. It picks its move by searching the game tree, looking ahead through the lines both sides could play and backing up the best line (minimax). The search assumes a single true position and a single true continuation.',
          },
          {
            kind: 'paragraph',
            text:
              "Under fog there is no single position to search. Misty can't see the opponent's pieces, so the board it has to reason about is a belief set: many legal boards consistent with what it has observed. A move that wins on one board can hang the king on another. Misty samples from that set, searches those worlds, and looks for a move that holds up across them.",
          },
          {
            kind: 'paragraph',
            text:
              'Sampling boards and searching them is the straightforward part. Combining the answers is where Fog Chess stops behaving like chess, and Misty borrows its method from poker: it minimizes regret across the sampled worlds, converging toward a strategy an opponent cannot exploit, instead of taking the move with the best average score. Obscuro, the strongest published Fog of War chess engine, works the same way. The hard part is keeping that model faithful to what has actually been observed while the clock is running.',
          },
        ],
      },
      {
        heading: "What's hard",
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Two things. The first is the possible-board set itself. A few plies into a foggy middlegame, "every consistent board" blows up fast. Misty has to keep that uncertainty under control inside a live-game time budget.',
          },
          {
            kind: 'paragraph',
            text:
              'The second is picking a move over that set. Scoring one move means weighing it across thousands of possible boards at once, and the obvious way to do that, averaging the outcomes, quietly buries disasters. A move that loses the king on a small slice of boards may barely move the average, but it still loses those games outright. Reasoning well over a distribution of boards, rather than a single board, is most of what the engine does.',
          },
        ],
      },
      {
        heading: 'What changed in the current release',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The current production engine is Misty 1.6. Most of the work since the first public release has been hardening, not a new personality: avoid rare king walks into hidden captures, avoid major-piece hangs in fog, stop stale search memory from leaking into a new live position, see fog-castles during search, and steer away from unstable early lines with a small opening book. Version 1.6 closes one specific queen hang. The safety check that vetoes catastrophic captures was subtracting the value of the piece being taken, so giving up a queen for a defended rook scored as a small loss rather than a disaster, and Misty walked into it in two real games before the floor that catches it shipped.',
          },
          {
            kind: 'paragraph',
            text:
              "That does not make Misty solved or perfectly safe. It means the cheap fog-specific failures that made earlier versions look silly are much rarer, so games against it test your understanding instead of your patience.",
          },
        ],
      },
      {
        heading: 'The engine is open source',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Misty's source is on GitHub under the GPL, and it installs from PyPI as misty-chess. What ships is the Fog Chess engine itself: the belief enumerator, the search, the guards that veto a catastrophic move at commit time, and the test suite that holds the Rust and Python implementations to byte-for-byte agreement at every ply. The variant siblings and the research lab stay private.",
          },
          {
            kind: 'paragraph',
            text:
              'Obscuro is not public. So as far as I can find, Misty is the only Fog of War chess engine built on that architecture that anyone else can run, read, or take apart, and that is most of the reason to publish it.',
          },
          {
            kind: 'cta',
            buttons: [
              {
                label: 'Misty on GitHub',
                href: 'https://github.com/brianhliou/misty',
                emphasis: 'secondary',
              },
            ],
          },
        ],
      },
      {
        heading: 'Where it stands',
        // Strength claim is deliberately rating-free: we gate any number on a
        // human match we'd stand behind, and don't have one yet. The earlier
        // fog-specific catastrophes have been hardened in the shipped default,
        // so the read below is of the current prod engine. Add a number only
        // after a human match earns it.
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Misty is the strongest Fog of War chess engine I've seen available to play, but version numbers are not ratings. The yardstick that matters is human play, and I won't put a number on it until a serious human match earns one.",
          },
        ],
      },
      {
        heading: "What's next",
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Misty itself stays focused on Fog of War chess. The same redacted engine protocol now supports variant-specific siblings, including Misty DMX for Dark Mini Xiangqi and MistyBanqi for banqi, but those are separate engines with their own rules and evaluation problems.',
          },
        ],
      },
      {
        heading: 'Play it',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Misty is live on Mistboard, and every serious game against it sharpens the estimate of where it stands. Play one, and you're part of the benchmark.",
          },
          {
            kind: 'cta',
            buttons: [
              { label: 'Play Misty', href: '/?play=computer', emphasis: 'primary' },
              { label: 'All articles', href: '/blog', emphasis: 'secondary' },
            ],
          },
        ],
      },
      {
        heading: 'For engine builders',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "If you build Fog of War engines, I'd like to play yours against Misty. There's almost no public head-to-head data between engines for this variant, and engine-vs-engine games are the cleanest way to see where any of them stand. Get in touch and we'll set up a match.",
          },
          {
            kind: 'cta',
            buttons: [{ label: 'Get in touch', href: '/contact', emphasis: 'secondary' }],
          },
        ],
      },
      {
        heading: 'References',
        blocks: [
          {
            kind: 'paragraph',
            text:
              '[Obscuro (Zhang & Sandholm, ICLR 2026)](https://arxiv.org/abs/2506.01242). The academic neighbor is Reconnaissance Blind Chess, whose engine lineage runs StrangeFish (CMU, 2018), ReBeL (FAIR, 2020), Penumbra (Georgia Tech), and Obscuro (CMU, 2026).',
          },
        ],
      },
    ],
};
