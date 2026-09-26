import { playClosing } from '../diagrams.js';
import {
  RB_ADVISOR_TRAP,
  RB_BATTERY_FROZEN,
  RB_CANNON_DOWN,
  RB_CHARIOT_DOWN,
  RB_FIVE_FILES,
  RB_SEAL_COVER,
  RB_SHELTER,
  RB_STEALTH_PAIR,
  RB_THUMBNAIL,
  RB_TRIPWIRE_PAIR,
} from '../riverbank-cannon-diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The fog-xiangqi opening-balance essay. Every line here is verified against
// the rules kernel by the scripts in docs-private/fog-xiangqi-balance/ (which
// also holds the engine runs the numbers come from). The replay blocks step
// through the exact verified sequences via the fog kernel; the static diagrams
// are built from replayed kernel states in ../riverbank-cannon-diagrams.ts.
export const riverbankCannonArticle: Article = {
  slug: 'riverbank-cannon',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'The Riverbank Cannon Problem',
  seoTitle: 'Fog Xiangqi Opening Theory: The Riverbank Cannon',
  summary:
    'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.',
  status: 'published',
  thumbnail: { kind: 'svg', svg: RB_THUMBNAIL },
  publishedAt: '2026-08-23',
  audience:
    'Fog xiangqi players, xiangqi players curious about the fog variant, and anyone who wants to see how a hidden-information opening gets analyzed honestly.',
  intro: [
    {
      kind: 'paragraph',
      text:
        'Fog xiangqi is xiangqi with two changes: you only see the points your own pieces could move to, and there is no check. Capture the general and the game ends.',
    },
    {
      kind: 'paragraph',
      text:
        'That makes Red’s first move alarming. Slide the opening cannon to the riverbank and it is one move from firing down any of five files: two chariots, two elephants, and behind the center soldier, the general. One capture ends the game. I built this variant, and I wondered if it was dead on arrival.',
    },
    {
      kind: 'raw-svg',
      svg: RB_FIVE_FILES,
      caption:
        'The dots are the five firing points. From each one the cannon shoots the piece behind the soldier screen: chariot, elephant, general, elephant, chariot.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text:
        'So I checked, against the real rules kernel and our fog engine. Short version: the threat is worse than it looks, the natural defense is a trap, and the game survives.',
    },
  ],
  sections: [
    {
      heading: 'The rush is invisible',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The b-file route announces itself: Black’s cannon watches that file and sees something land on the riverbank. Red does not have to go that way. Up the empty d-file, nothing Black owns sees a single point: d3, d5, e5, mate on move 4. The only warning is that a red piece left home, which describes every game ever played.',
        },
        {
          kind: 'raw-svg',
          svg: RB_STEALTH_PAIR,
          caption:
            'One move before mate. Left: the truth. Right: everything Black can see. The cannon never enters the picture.',
        } as ArticleBlock,
        {
          kind: 'xq-replay',
          spec: {
            iccs: 'b2d2 h9g7 d2d4 b9c7 d4e4 c6c5 e4e9',
            red: 'Red',
            black: 'Black',
            title: 'The stealth rush',
            event: 'Kernel-verified line',
            resultText:
              'Red captures the general on move 4. Black developed normally and saw nothing.',
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'So the defense cannot wait for a warning; it has to be played every game. The rest of the article draws the visible route so the diagrams read easily. The threats are the same either way.',
        },
      ],
    },
    {
      heading: 'The natural defense is a landmine',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'There is exactly one screen between cannon and general: Black’s own center soldier. A cannon needs exactly one, so any second body on the center file kills the mate. The natural pick is advisor up. It seals the center and nothing else, and it plants a mine: Red slides to an elephant wing and takes.',
        },
        {
          kind: 'raw-svg',
          svg: RB_ADVISOR_TRAP,
          caption:
            'Red guessed the wing whose advisor stayed home. The cannon fires along the back rank through it, the marked flight point loses to the same shot, and the sealing advisor blocks the only parry. All 41 legal replies lose, engine-checked. The other wing costs only an elephant.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'There is a save: play the poisoned wing’s elephant to the middle immediately, and both grabs die. But that is the move you should have opened with. The advisor spends a whole move doing a fraction of the elephant’s job, and while you fix it, Red takes a rim chariot for free.',
        },
      ],
    },
    {
      heading: 'One elephant move holds everything',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The move that works is the standard developing move of xiangqi: elephant to the middle.',
        },
        {
          kind: 'raw-svg',
          svg: RB_SEAL_COVER,
          caption:
            'Second screen on the center file, so the snipe is marked dead; both elephant home points covered by the recapture.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'Snipe dead, both elephant wings covered, one move. Xiangqi theory reached this square centuries before the fog did. A cannon to the same point works too.',
        },
      ],
    },
    {
      heading: 'The chariot gamble',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'That leaves the edges: from the riverbank corner the cannon shoots the chariot through the edge soldier, and the elephant does nothing about it.',
        },
        {
          kind: 'paragraph',
          text:
            'Move order decides this. The mate cannot arrive before Red’s third move, so the elephant is still in time on Black’s second. The edges cannot wait: Red picks his corner on his second move, and a soldier pushed after that is too late. So soldier first, elephant second. The pushed soldier watches the one point the cannon must fire from, and eats it on arrival.',
        },
        {
          kind: 'raw-svg',
          svg: RB_TRIPWIRE_PAIR,
          caption:
            'The same push, one move apart. Played first, the soldier watches the arrival point and the cannon dies on landing. Played second, the cannon shoots the chariot straight over it: a pushed soldier still counts as one screen.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'That leaves one honest gamble. Red commits blind to a corner on move two: half the time it is the watched one and he trades his cannon for a soldier, half the time he wins a chariot. Played out by the engine, the branches roughly cancel. One fair coin flip per game, and only if Red commits immediately: given a third move, Black closes both edges.',
        },
      ],
    },
    {
      heading: 'When the cannon dies',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Half the flips, Red loses the cannon to the soldier. He recaptures the soldier (the engine did, in every playout), and the recapture is a gift: it is now the screen, and Black\u2019s cannon shoots the corner chariot straight through it. The engine scores this -0.55 for Red: attack over, a cannon down, nothing to show.',
        },
        {
          kind: 'raw-svg',
          svg: RB_CANNON_DOWN,
          caption:
            'After the recapture on a5, Black’s cannon steps to the edge and fires through Red’s own soldier. Misty found this follow-up in every playout.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'Can Red defend the shot? Two ways, neither happy. Declining the recapture keeps two screens on the file, but the crossed soldier just keeps eating and the shot reopens a move later, one soldier cheaper. Recapturing and then blocking with the horse holds the chariot. In six engine playouts from the fired tripwire, the whole sequence played itself out, capture, recapture, counter-shot and all, and Black converted five (the Tripwire games in the companion study). The block:',
        },
        {
          kind: 'xq-replay',
          spec: {
            iccs: 'b2b4 a6a5 b4a4 a5a4 a3a4 b7a7 b0a2',
            red: 'Red',
            black: 'Black',
            title: 'Red saves the chariot',
            event: 'Kernel-verified line',
            resultText:
              'The horse steps to the edge as a second screen and the shot is dead. Red is still a cannon for a soldier down with nothing to attack. The engine scores the branch -0.55 either way and calls the recapture the least bad move on the board: the block saves a piece, not the game.',
          },
        } as ArticleBlock,
      ],
    },
    {
      heading: 'When the chariot falls',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The other half, Black is a chariot down. The engine scores positions from -1, lost, to +1, won; it calls this one -0.75, which is roughly one win in eight. Close to lost, not over. And the landed cannon looks scarier than it is: every capture it has loses on the spot to a recapture. Its real power is the freeze: the horse and the elephant beside it are holding the back rank shut, and if either ever moves, the next shot is the general.',
        },
        {
          kind: 'raw-svg',
          svg: RB_CHARIOT_DOWN,
          caption:
            'The cannon\u2019s bites (arrows left) are answered: the central elephant retakes on one point, the general on the other. But the horse and elephant are the back rank\u2019s screens now. Move either and the cannon mates. Leave them home.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'So how does Black fight? The engine showed three ideas. First, patience: touch nothing on the back rank. Second, an immediate simplification: in our first playouts its opening move from here, every game, was to snipe Red’s home horse with its own cannon, over Red’s home cannon as the screen, trading cannon for horse to blunt the attack. Third, counterattack on the other wing, where your own cannons still have a game; the next section shows the sharpest version. And it escapes: of the ten forced-grab games, Black won two outright (Rim gambit games 2 and 8 in the companion study, in 84 and 56 plies) and held three more to the ply cap. One win in eight is the eval; in the decided games, the practice was one in four.',
        },
      ],
    },
    {
      heading: 'Whoever moves the wall first dies',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'One pattern decided games in every branch, and it travels to any fog game with long-range pieces: a cannon on its firing point is also the block against the enemy cannon opposite. Whoever steps away first, the other fires through the hole. And the fog baits you to step away: from the wall, an enemy soldier looks free. Take it and you are mated on the reply.',
        },
        {
          kind: 'xq-replay',
          spec: {
            iccs: 'b2b4 h7h5 b4a4 h5e5 a4a9 e5e0',
            red: 'Red',
            black: 'Black',
            title: 'The counter-battery',
            event: 'Kernel-verified line',
            resultText:
              'Black skipped the elephant and parked a cannon on the center file. Red cannot see it, grabs the chariot, and is mated on the reply.',
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'Which answers a fair question: why not go to the riverbank yourself as Black? You can, and it punishes any Red who grabs. Red has exactly one sound reply: seal his own center before touching anything. Then the battery never fires.',
        },
        {
          kind: 'raw-svg',
          svg: RB_BATTERY_FROZEN,
          caption:
            'The line: cannon to the riverbank, Black answers with his own battery, Red seals with the elephant before grabbing. The battery is now two screens from the general (the cross) and frozen where it stands; move it and Red\u2019s cannon fires. The engine puts Red a quarter point up here (+0.25, against 0.00 in the soldier line) and sends its cannon to the edges (the arrow). A weapon for greedy opponents, not a default.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'What the engine says',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'I forced the rush onto the board and let Misty play both sides, thirty games: twenty through the snipe attempt, ten through the chariot grab. The snipe never fired once; Black sealed within three moves in eighteen of twenty. The rush games went Black 9, Red 4, seven ply-cap draws; the forced grabs went Red 5, Black 2, three caps. Then I made Black answer the same forced rush with this article’s exact line, eight more games: Black won six, no draws. The line does not just suit humans; it outscored the engine’s own defensive choices. Here is one of those games in full:',
        },
        {
          kind: 'xq-replay',
          spec: {
            iccs: 'b2b4 a6a5 b4e4 c9e7 b0c2 h9i7 a0b0 b9a7 h2e2 i6i5 h0g2 i7h5 i0h0 h7h0 b0b7 h0h1 e4e7 g9e7 b7e7 d9e8 e2e6 h5f4 e7a7 f4e6 a7a9 e8d9 c3c4 i9h9 g2e1 h9h2 a9a5 c6c5 c4c5 h1h0 a5a4 h2f2 c5d5 f2f0 e0f0 h0f0',
            red: 'Misty (rush forced)',
            black: 'Misty (this article’s line)',
            title: 'Rush vs the recommended line, game 7 of 8',
            event: 'Engine-vs-engine playout, full record',
            resultText:
              'Both sides forced through their first three moves, then free. Black follows the line this article teaches; the snipe never comes, heavy trades follow, and Black finishes with a deflection: chariot takes the advisor beside the general, the general recaptures, and the second chariot takes the general.',
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            // PROD study id (seeded 2026-08-23 under the mistboard account, unlisted until the
            // article ships; flip to public at publish). Local preview: study KMssjbOV in the dev DB.
            'All the games behind this article are in the [companion study](/study/3LGIVr59): the theory lines, twenty forced-rush games and ten forced rim-gambit games with the engine on both sides, and sixteen free self-play games. Flip the study board to Black’s fogged view and step through what he actually saw.',
        },
        {
          kind: 'paragraph',
          text:
            'Left to choose freely, sixteen more games, Red won eleven of the twelve decisive and never once played the rush. Lean samples, so treat the counts as direction. The position evaluations are firmer ground: they hold still under a sixteen-fold compute increase.',
        },
        {
          kind: 'table',
          wrap: true,
          headers: ['position', 'engine verdict'],
          rows: [
            ['game start, Red to move', '+0.06 Red: a real but small first-move edge'],
            ['theory settled: seal up, rush cannon on e5', '0.00: dead even, the rush fully answered'],
            ['Red won the chariot flip', '-0.75 for Black: close to lost, still fighting'],
            ['Red lost the cannon flip', '-0.55 for Red: clearly losing'],
            ['counter-battery vs a Red who seals first', '+0.25 Red: the battery concedes more than the soldier line'],
          ],
        },
        {
          kind: 'paragraph',
          text:
            'One last check: I forced Black through the line this article teaches against a free Red, eight games. Black won five of the seven decisive, against one of twelve when choosing freely. The three insurance moves cost nothing.',
        },
        {
          kind: 'paragraph',
          text:
            'Average the flip branches and the committed rush is worth about +0.10 to Red, the same ballpark as the +0.06 he starts with: the whole first-move advantage, spent in one gamble. Initiative in fog is real, probably bigger than in chess, because defense is paid blind. The rush is the loudest way to spend it, and the loudest way is answerable.',
        },
      ],
    },
    {
      heading: 'The line to learn',
      blocks: [
        {
          kind: 'raw-svg',
          svg: RB_SHELTER,
          caption:
            'Black’s three moves: edge soldier, central elephant, far-side horse. The dot is the watched firing point, the cross is the dead snipe, the arrows are the elephant’s cover.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'As Black: edge soldier, elephant to the middle, horse to the other edge. After three moves the only target left is the chariot on the edge you did not push, and only if Red committed on move two. Never seal with the advisor. And before you move any piece near a landed cannon, count screens: most losses we found came from moving a piece that was quietly holding a firing line shut.',
        },
        {
          kind: 'paragraph',
          text:
            'As Red: the rush beats anyone who has not read this far, and it is even money against anyone who has. If you play it, commit to an edge on move two or not at all, and seal your own center before cashing any grab: every scripted Red that grabbed first got mated.',
        },
      ],
    },
    playClosing({
      heading: 'Step through it yourself',
      lead:
        'Every line and every game in this article is in the companion study, on a board you can flip to either side’s fogged view. When you are ready, Misty will punish you while you learn the line. No account required.',
      // PROD study id: see note above.
      playLabel: 'Open the companion study',
      playHref: '/study/3LGIVr59',
      secondary: [
        {
          label: 'Play vs computer',
          href: '/?play=computer&gameSpecId=dark-xiangqi',
          emphasis: 'secondary',
        },
        // Renders only once the target publishes: an internal link to a draft
        // is dropped from the page (see pointsAtHiddenArticle in articles.ts),
        // so this can sit here through the companion's draft life.
        {
          label: 'Every xiangqi champion since 1956',
          href: '/blog/xiangqi-champions',
          emphasis: 'secondary',
        },
      ],
    }),
  ],
};
