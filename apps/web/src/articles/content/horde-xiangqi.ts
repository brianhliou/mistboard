import {
  HORDE_GAME_SET_STRINGS,
  HORDE_XIANGQI_ARRAYS,
  HORDE_XIANGQI_CHARIOT_GAME,
  HORDE_XIANGQI_COVER_CHESS,
  HORDE_XIANGQI_COVER_STANDARD,
  HORDE_XIANGQI_COVER_VETERAN,
  HORDE_XIANGQI_FORTRESS,
  HORDE_XIANGQI_GAME,
  HORDE_XIANGQI_STANDARD_ROWS,
  HORDE_XIANGQI_START,
  HORDE_XIANGQI_THUMBNAIL,
  HORDE_XIANGQI_VETERAN_ROWS,
} from '../../horde-xiangqi-article-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The whole analysis, folded in from the brianhliou.com post (2026-10-07).
// Every board, game and table row comes from scripts/gen-horde-diagrams.mts,
// which replays the lab artifacts through the rule kernel and asserts each
// claim a note or a table makes before it writes the module.
const EVIDENCE = 'https://github.com/brianhliou/horde-xiangqi';

const RUN_INI = `[hordexiangqi:xiangqi]
startFen = rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/VVVVVVVVV/VVVVVVVVV/VVVVVVVVV/VVVVVVVVV w - - 0 1
customPiece1 = v:fsW
extinctionValue = loss
extinctionPieceTypes = *
flyingGeneral = false
chasingRule = none
stalemateValue = loss
perpetualCheckIllegal = false
nFoldValue = draw
nMoveRule = 60`;

const RUN_UCI = `stockfish check horde.ini            # parses the stanza
setoption name VariantPath value horde.ini
setoption name UCI_Variant value hordexiangqi
position startpos
go nodes 1000000`;

export const hordeXiangqiArticle: Article = {
  slug: 'horde-xiangqi',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'Horde on the Xiangqi Board: The River Is a Cliff',
  cardTitle: 'Horde on the Xiangqi Board',
  seoTitle: 'Horde Xiangqi: Horde Chess on the Xiangqi Board, Measured',
  summary:
    'We put Horde on the xiangqi board and measured it before building anything: twelve start arrays, two soldier rules, each played four times by an engine against itself. With xiangqi’s own soldier the army wins every game by one trick; give the soldier the crossed move from the start and the game becomes a siege that draws three times in four. We are publishing the measurement, not the variant.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-15',
  updatedAt: '2026-10-07',
  audience:
    'Chess players who know Horde and wonder what it does on the xiangqi board, and xiangqi players curious why a variant was measured and then not built.',
  thumbnail: { kind: 'svg', svg: HORDE_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Horde chess is 36 pawns and no king against a normal army; the pawns win by checkmate, the army by taking the last pawn. Lichess has played it since 2015. We put the same idea on the xiangqi board: Red has soldiers only and no general, Black has the standard army, and everything else is xiangqi. Then we measured it before designing anything.',
    },
    {
      kind: 'paragraph',
      text: 'None of the twenty-four designs is a game, and the reason is the soldier. With xiangqi’s own soldier the army wins every start of 40 or fewer on its own side of the river, by one trick: a chariot behind the block. Give the soldier its crossed-river move from the first step and the trick is gone, but the game becomes a siege, 37 draws in 48 games. Below the river the block cannot defend itself; above it the army cannot attack it. There is no play page for Horde Xiangqi; this page holds the measurement.',
    },
  ],
  sections: [
    {
      heading: 'The rules',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Horde chess is the parent: 36 pawns and no king against a normal army. The port keeps as much of xiangqi as it can. Red is the horde: soldiers only, no general, and Red moves first. Black is the standard army. Red wins by checkmate; Black wins by capturing every red piece. There is no check against the horde and no facing rule, since only one general exists.',
        },
        {
          kind: 'paragraph',
          text: 'The side to move with no legal move loses, as in xiangqi; Lichess Horde calls it a draw, and the terminal rules below say how much that matters. Threefold repetition draws, and so does a run of 60 or 120 plies without a capture. Standard soldiers move as in xiangqi: one point forward, sideways only after crossing the river, never backward. Veteran soldiers have the crossed soldier’s move from their first step. The army’s five soldiers stay standard either way.',
        },
        {
          kind: 'raw-svg',
          svg: HORDE_XIANGQI_START,
          caption:
            'The parent’s array with standard soldiers, and the closest thing to a game we found: 36 veterans a rank forward, drawn with the crossed-soldier piece because that is the move they have.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The design space',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Five dials. A design is a soldier rule and a start array, and twenty-four were played.',
        },
        {
          kind: 'table',
          headers: ['Dial', 'Settings tried'],
          rows: [
            ['The soldier’s move', 'Standard; veteran (sideways from move one)'],
            ['How many soldiers', '18, 27, 31, 32, 36, 40, 45'],
            [
              'Where the block starts',
              'At the back (rank 1 up), forward (rank 2 or 3 up), across the river (front rank on rank 6)',
            ],
            [
              'The block’s shape',
              'Full rows; the parent’s shape (rows plus paired outposts); xiangqi’s five soldier points',
            ],
            [
              'Terminal rules',
              'No-capture clock of 60 or 120 plies; stalemate as a loss (xiangqi) or a draw (the parent)',
            ],
          ],
          keyColumn: true,
          wrap: true,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Every design ran on stock Fairy-Stockfish with a short configuration and no engine code, refereed by a rule kernel that agreed with the engine’s move generator before any game was read (the checks are under “How we checked it”). Each array was played four times, the engine against itself at four search budgets with no randomness, and once more at a million nodes a move. The engine cannot use its xiangqi neural net without a red general on the board, so it plays on classical evaluation alone. It plays the game anyway.',
        },
        {
          kind: 'raw-svg',
          svg: HORDE_XIANGQI_ARRAYS,
          zoomable: true,
          caption:
            'The twelve start arrays, in the order of the tables below. Red is the horde, Black the standard army; each array was played with both soldier rules.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Standard soldiers: the chariot eats the horde from behind',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nine of the twelve arrays go to the army four games out of four, by one mechanism. A standard soldier covers only the point in front of it, so the horde is nine columns rather than a wall. The moment a column empties, a chariot drops through it to the first rank and eats the block from behind at a soldier a move, and nothing in the horde attacks backward. Shape changes nothing: an outpost is a target, not cover.',
        },
        {
          kind: 'horde-xiangqi-replay',
          spec: HORDE_XIANGQI_CHARIOT_GAME,
          caption:
            'The million-node game from the parent’s array, every ply. The chariot drops at ply 50; step on from there to watch the block go from behind. Replayed on this page through the rule kernel.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The other three arrays are one exception: enough soldiers get across before the chariot is done. 45 on ranks 1 to 5 is a five-deep block, and its four games split two army wins, one horde mate and one draw. The two arrays that start across the river begin in contact with the army’s soldiers. The 27 still loses; the 36 is a coin flip that skips the march and previews the veteran game.',
        },
        {
          kind: 'table',
          headers: ['Soldiers', 'Start', 'Army', 'Horde', 'Draw', '1M game', 'Plies'],
          rows: HORDE_XIANGQI_STANDARD_ROWS,
          highlightRows: [7],
          compact: true,
          caption:
            'Army, Horde and Draw count four games per array at 150,000, 200,000, 300,000 and 500,000 nodes a move, 120-ply clock, every move the engine’s first choice. Then the single game at a million nodes with a 60-ply clock, and its length. Four arrays were played once more at five million nodes: the army won the 36 on ranks 1 to 4 in 156 plies, the 36 on ranks 2 to 5 in 146 and the 32 in 106, and the 36 across the river drew by repetition at 104.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Veteran soldiers: the horde holds, and the siege is a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The chariot’s road exists because a standard soldier attacks nothing beside it, and xiangqi already has a soldier that does: the crossed soldier, which moves and captures one point forward or sideways. Veteran soldiers are a horde that starts promoted. Every horde soldier has that move from its first step, nothing else changes, and a player learns nothing new.',
        },
        {
          kind: 'paragraph',
          text: 'This closes the road. A veteran column attacks the points beside it, so the chariot cannot sit next to it for free. The horde becomes a side, and between equals the game becomes a siege: 48 games, 37 draws. The army wins only against 18 soldiers, and from 27 up it never wins.',
        },
        {
          kind: 'table',
          headers: ['Soldiers', 'Start', 'Army', 'Horde', 'Draw', '1M game', 'Plies', 'Army lost'],
          rows: HORDE_XIANGQI_VETERAN_ROWS,
          highlightRows: [6],
          compact: true,
          caption:
            'Four games per array at the same four budgets and the 120-ply clock, then the single game at a million nodes; Army lost counts the army’s pieces lost in that game. *Three million-node games ran into the harness’s 1,000-ply cap and were played on from that position with the clock in force; no capture followed, and the ply shown is where the clock ended them. Each ended with nine or ten soldiers against a general and both chariots, with an elephant or an advisor beside them in two.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**The ending.** The horde marches, takes the army’s cannons and elephants on the way in, and arrives at the palace to find a general with two chariots waiting. From there the soldiers cannot force their way past the chariots, and the chariots cannot eat a block of soldiers that guard each other. Start rank and shape decide how much of the army the horde takes on the way in, and nothing else. The parent’s 31 shows the other face of the same rule: its four games drew at 155 to 245 plies with never more than two soldiers across the river, because a block that has not moved cannot be attacked and a block that moves loses the soldier that moved.',
        },
        {
          kind: 'raw-svg',
          svg: HORDE_XIANGQI_FORTRESS,
          caption:
            'The ending, here from the 40-soldier array at a million nodes a move: twelve soldiers against a general, an advisor and two chariots at ply 754. The soldiers cannot force a way past the chariots, and the chariots take a soldier only when one steps out of the block: two in the next 246 plies, at 822 and 896.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'We took the 40-soldier ending at ply 754 and let the engine play it on for 200 more plies at five million nodes a side: one capture, and the engine’s own evaluation of the horde’s advantage slid from 2.3 pawns to 0.7. At a million nodes the army had managed two captures in the same stretch, then none in the next 120, and the clock ended it. Two soldiers in 262 plies is not winning an ending.',
        },
        {
          kind: 'paragraph',
          text: '**The win.** The 36 that starts a rank forward took both chariots and smothered the bare general at ply 435: no move, no check, which xiangqi scores as a loss. It is the one array where the horde is the favourite, with three wins in its four games and the million-node game too: a rank closer to the river, it arrives with more of the army already gone and enough soldiers left to trade for the chariots. The horde’s other wins are the same finish, all past ply 390, and four of its six are the smother.',
        },
        {
          kind: 'horde-xiangqi-replay',
          spec: HORDE_XIANGQI_GAME,
          caption:
            'The horde’s win, every ply: the march, the siege, the chariots falling at plies 267 and 431, and the smother at ply 435. Replayed on this page through the rule kernel.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The terminal rules',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Three ways a game here stops without a winner, and they are not the same thing. **Repetition**: the same position with the same side to move three times; a draw. **The clock**: a run of plies with no capture, 60 or 120 of them; a draw, and a soldier stepping forward does not reset it. **The cap**: the harness stopped the game at 400, 1,000 or 2,000 plies. That is not a rule of the game, so a capped game is unfinished, not drawn. Three million-node veteran games hit the 1,000 cap and were played on until the clock ended them, and no four-budget game reached 2,000, so every result in the tables is one of the first two.',
        },
        {
          kind: 'paragraph',
          text: '**The clock.** Xiangqi’s no-capture rule is 60 plies. With standard soldiers it fired once in 48 games. With veterans it is the usual ending: 30 of the 37 draws, the other seven by repetition. At 60 plies it cuts live games short with the march still going, so the veteran games and every four-game sample run at 120. The clock is also a rule the engine plays by, so a game under a 60-ply clock and one under 120 are different games from ply 2, not one game cut at different points.',
        },
        {
          kind: 'paragraph',
          text: '**Stalemate.** Under the parent’s rule a general with no move and no check is a draw. Re-scoring every game in the lab under that rule: five of the horde’s seven equal-strength wins with veterans become draws, and one of its four with standard soldiers; against a random army, 20 of its 35 wins with standard soldiers and 16 of its 38 with veterans; and five of its ten wins in the veteran budget ladder. The smother is the horde’s mate about half the time, and the parent’s rule would take it away.',
        },
      ],
    },
    {
      heading: 'Why the soldier fails, and what a different soldier would need',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The game has two phases, and xiangqi’s soldier fails in each of them differently.',
        },
        {
          kind: 'paragraph',
          text: '**Below the river, the block cannot defend itself.** A standard soldier attacks only the point ahead of it. So the horde is nine columns, not a wall: a chariot beside a column, or behind it, is untouchable, and any file that empties is a road to the back rank. Every start of 40 or fewer on the horde’s own side is decided here, by that one chariot, four games in four. At 45 the block is deep enough to outlast it some of the time, and that array splits.',
        },
        {
          kind: 'paragraph',
          text: '**Above the river, the block cannot move.** A crossed soldier (or a veteran) attacks sideways too, so the block guards itself where it stands. But it protects only the points its soldiers could step to, never the point ahead of a neighbour. The soldier that steps forward lands on a point nobody covers and is a free capture until a neighbour steps up beside it. So the block can advance only as a whole rank, nine moves per rank, while the army waits, and any soldier that moves early is picked off. The army, for its part, cannot attack a block that has not moved. Nine of the twelve veteran arrays end there in every game or all but one: a general and two chariots in the palace, a block of soldiers outside it, and nothing either side can do.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: HORDE_XIANGQI_COVER_CHESS },
            { svg: HORDE_XIANGQI_COVER_STANDARD },
            { svg: HORDE_XIANGQI_COVER_VETERAN },
          ],
          caption:
            'The same step on three boards: the middle piece has just moved one point forward, and the green rings are the points its side now protects. A chess pawn captures diagonally, so the pawn on d4 covers e5 and the pawn that arrived there is safe from the rook: pawns advance as chains. A xiangqi soldier captures the way it moves, straight ahead, so d4 and f4 cover d5 and f5 and nothing covers e5; the chariot takes the soldier for free. Veteran soldiers (right) attack sideways too, which makes the block guard itself where it stands, and still nothing covers the point a soldier steps to. The horde can hold its ground and cannot leave it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'A chess pawn is built differently. It captures diagonally, so the pawn on d4 already covers e5 before the e-pawn steps there: pawns advance as chains, one at a time, each landing protected, and a chain can be undermined from the base. That is why Horde works in chess and why chess players never have to think about it. On the xiangqi board the river is a cliff: no cover on the way, total cover once there, and no setting of count, start rank, shape or clock changes that. Those are the dials we turned. The one we left alone, past the veteran, is the soldier itself.',
        },
        {
          kind: 'paragraph',
          text: 'That is where the next attempt starts. The property the horde is missing is cover on the way: a soldier that protects the point its neighbour is about to step to, so the block can advance one piece at a time instead of one rank at a time. Anything that supplies it is a candidate, from small to large: a soldier that captures diagonally forward but still moves straight, a double step on the first move, two soldiers moving per turn as in the old Five Tigers handicap, a second promotion at the far rank, or the chess pawn outright, which turns this into Horde chess on a bigger board. We stopped at the veteran because it is the only one of these xiangqi already has; each of the others is a new piece, and a new piece is a different game. The rules are data in the lab, so any of them is one line and an afternoon of engine time, and the tables here are the baseline to beat.',
        },
      ],
    },
    {
      heading: 'Run it yourself',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The whole variant is a stanza in Fairy-Stockfish’s `variants.ini`. This is the parent’s array with veteran soldiers and the 120-ply clock (`nMoveRule` counts moves, so 60 is 120 plies); for standard soldiers drop the `customPiece1` line and write `P` for `V` in the start position.',
        },
        { kind: 'code', language: 'ini', text: RUN_INI },
        { kind: 'code', language: 'bash', text: RUN_UCI },
        {
          kind: 'paragraph',
          text: 'Two lines matter and are easy to leave out. `chasingRule = none` is mandatory: the engine’s chase detector reads the missing general’s square on a kingless side. `flyingGeneral = false` changes nothing and documents a fact: the engine keys the facing rule on its king piece and silently switches it off when one side has none.',
        },
      ],
    },
    {
      heading: 'How we checked it',
      blocks: [
        {
          kind: 'paragraph',
          text: '**The engine plays these rules.** A rule kernel (the same one that ran Atomic Xiangqi, with hooks for a side with no general, a win by extinction, and the veteran soldier) referees every game: the engine proposes a move, the kernel validates and applies it, and an engine quietly playing different rules aborts the run instead of producing a record of a different game. Before any game was read, the two had to agree on every legal move: perft to depth 3 from each array, nine hand-built positions compared as exact move sets, and 300 positions from random play. Zero disagreements, both soldier rules, all twelve arrays.',
        },
        {
          kind: 'paragraph',
          text: '**The engine understands the game.** At 100,000 nodes it beat a random mover 70-0 with standard soldiers and 78 of 80 with veterans. Ten times the search budget beat a tenth of it 17-1-2 on the standard forward array and 11-0-9 on veterans. One footnote: on the parent’s array with standard soldiers, ten times the budget scored only 55%, because every decided game went to the army whichever budget held it; the seat was the result, not the search.',
        },
        {
          kind: 'paragraph',
          text: '**How deep the search is.** Node budgets, not time, so nothing depends on the machine: 200,000, 1 million and 5 million nodes a move reach about depth 12, 15 to 20, and 24 to 33 on these positions. Play is not saturated at these budgets: the across-the-river array with standard soldiers went draw, army, horde, horde, army, horde, draw across seven budgets. The standard-soldier verdict holds at every budget tried, by the same mechanism, and that claim is safe. The siege is the position class search is worst at: a hundred-ply plan is invisible at depth 20, and classical evaluation has no idea what the ending is worth (it scored the fortress at +2.3 for the horde while the army was eroding it). So the draw claim is weaker than the loss claim, and a human with a plan might do better on either side than the engine did.',
        },
        {
          kind: 'paragraph',
          text: '**One game is one sample.** Every array was played four times, at 150,000, 200,000, 300,000 and 500,000 nodes a move, every move the engine’s first choice and no random openings, so the counts in the tables are a rate and the million-node game is one of five, not the verdict. A deterministic engine replays the same game from the same start, so the budgets are what make the four games different, and the script refuses an array where two of them came out identical (none did). Where an array splits, the split is the result. One more caveat on the veteran numbers: the engine sees the veteran as a custom piece with a value estimated from its mobility, not tuned, so its judgement of a soldier-for-piece trade is rougher than for the standard soldier. The fortress it cannot break at five million nodes is real; the material it gave up on the way in may not be best play.',
        },
      ],
    },
    {
      heading: 'Where it stands',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A variant is a game, for this series, if it clears three bars under measured play: it is decided between good players rather than drawn by default; neither side wins from the start; and both seats have something to do. Horde Xiangqi clears none of them in any design tried.',
        },
        {
          kind: 'paragraph',
          text: '**Standard soldiers:** the army wins from every start of 40 or fewer on its own side of the river, 36 games out of 36, by one trick. Decided, but from move one. At 45, or starting across the river, the array is a coin flip settled by the opening exchanges.',
        },
        {
          kind: 'paragraph',
          text: '**Veteran soldiers:** a siege that two good players draw 37 times in 48, in games of 137 to 1,098 plies. The horde wins six, four of them by smother, and the army wins five, all against 18 soldiers. Not decided, and neither seat has a plan: the army’s best play is to sit in the palace and wait, the horde’s is to shuffle a block one point at a time. The one array the horde is favoured in is the same siege with a better score, not a different game.',
        },
        {
          kind: 'paragraph',
          text: '**Against weak play** the horde is dangerous: at 100,000 nodes it beat a random army 35 times in 35, 20 of them by smother, and people are weaker than a million-node search. That makes it a trap, not a game.',
        },
        {
          kind: 'paragraph',
          text: 'What would reopen it: a human result, a soldier rule that gives the block cover on the way (the candidates are listed above), or a chariot-fall rate well above the six in 48 measured here. Nothing so far points that way for xiangqi’s own soldier. The soldier is the design space, the river is a cliff in it, and the next design has to change the soldier.',
        },
        {
          kind: 'paragraph',
          text: '**Prior art.** We looked in Fairy-Stockfish’s variant file, PyChess, Lichess, Chess.com’s official list, PlayStrategy, Ludii, both Wikipedias’ xiangqi-variant pages, chessvariants.com’s 9x10 index, a Zhihu list of 231 folk xiangqi variants and the nine soldier-named variants with rules on Baidu Baike, and found no horde among them. Tieba’s folk boards and Chess.com’s user variants we could not read, so this is a thorough negative, not an exhaustive one. Xiangqi’s own lopsided games (Manchu chess, Five Tigers, the nine-piece handicap) run the other way, taking pieces from one side, soldiers first. Horde chess descends from BrainKing’s Horde Chess (2002) and Lord Dunsany’s “Pieces against Pawns” (1942), and Lichess settled its rules in [scalachess](https://github.com/lichess-org/scalachess/commit/79cfa70) in 2015.',
        },
        {
          kind: 'paragraph',
          text: 'The engine is [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish); the harness that produced the games, with the engine gate and the commands, is the [variant lab](https://github.com/brianhliou/mistboard/tree/main/scripts/variant-lab).',
        },
      ],
    },
    {
      heading: 'Every game, to step through',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Fifty-eight of the engine games are in the viewer below: the engine against itself on the arrays at 200,000, one million and five million nodes a move, 28 games with standard soldiers and 28 with veterans; and two ladder games on the standard forward array, where 100,000 nodes met 10,000: the horde’s fastest win, mate at ply 151, and a draw on the clock. It opens on the horde’s win above. Pick any other from the list.',
        },
        {
          kind: 'step-game-set',
          load: () => import('../../horde-xiangqi-games.js'),
          strings: HORDE_GAME_SET_STRINGS,
          caption:
            'All 58 games, each replayed through the rule kernel. The arrow keys step through the one on the board.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'What we are publishing instead of a play page',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The rule kernel with both soldier rules and all twelve arrays, the Fairy-Stockfish stanzas, all 387 engine games, the checks behind them, and a verifier that replays every game against the rules and recomputes the tallies in half a minute, with no engine needed. If you have a soldier rule that gives the block cover on the way, that is where the next attempt starts; open an issue there and the write-up will say so.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Check the games yourself', href: EVIDENCE, emphasis: 'primary', external: true },
            { label: 'Learn xiangqi', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
