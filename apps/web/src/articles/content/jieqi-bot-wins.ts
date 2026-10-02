import { parseJieqiFen, type XiangqiPiece, type XiangqiSquare } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint, xqVisionDemoState } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// Card art: the last position of the stalemate win (jq_53ead5f3, ply 126), a
// full-bleed crop of Red's half of the board. The bot's general on d1 is not in
// check and has nowhere to go: both of its points, d2 and e1, carry a cross.
// Built from the kernel's own FEN parse; jieqi-bot-wins-thumbnail.test.ts
// asserts Red really has no legal move here, so the card cannot drift from the
// rule it shows.
export const JIEQI_BOT_WINS_STALEMATE_FEN = '9/9/3k5/9/9/5p3/4n1p2/3p5/4p4/3K5 w - 0 64';

// 16:10 to match the card media box (.articles-index-card-media, 16/10).
const THUMB_ASPECT = 16 / 10;

const JIEQI_BOT_WINS_THUMBNAIL = (): string => {
  const parsed = parseJieqiFen(JIEQI_BOT_WINS_STALEMATE_FEN);
  if (!parsed.ok) throw new Error(`jieqi-bot-wins thumbnail: ${parsed.error}`);
  const board: Partial<Record<XiangqiSquare, XiangqiPiece>> = {};
  for (const [square, piece] of Object.entries(parsed.state.board)) {
    if (piece) board[square as XiangqiSquare] = { color: piece.color, role: piece.role };
  }
  const boardY = 28; // xqBoardSvg draws the grid 28 below its y, under the title row.
  // Ranks 1 to 5 with most of a cell of room above and below the pieces.
  const top = xqPoint(4, 5, 'red', 0, boardY).y - XQ_CELL * 0.8;
  const bottom = xqPoint(4, 1, 'red', 0, boardY).y + XQ_CELL * 0.8;
  const h = bottom - top;
  const w = h * THUMB_ASPECT;
  const left = xqPoint(4, 1, 'red', 0, boardY).x - w / 2;
  const svg = xqBoardSvg({
    state: xqVisionDemoState('jieqi-bot-wins-thumb', board),
    x: 0,
    y: 0,
    label: '',
    perspective: 'red',
    dots: [
      { square: 'd2' as XiangqiSquare, blocked: true },
      { square: 'e1' as XiangqiSquare, blocked: true },
    ],
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="Red's general stalemated on d1" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${svg}</svg>`;
};

// Games are finished rooms, so /embed/game shows every piece. Each opens at
// `ply` (plies played, 0 = start), the bot to move just before the game turns,
// read from the bot's own evals in its move records. Sized like the study
// embeds: width-bound at the 702px column beside the move sheet. The board is
// turned to the winner (`pov`), read from their side in WINS, so a Black win
// shows the player at the bottom.
function gameEmbed(roomId: string, ply: number, title: string): ArticleBlock {
  const win = WINS.find((row) => row[5] === roomId);
  if (!win) throw new Error(`jieqi-bot-wins: ${roomId} is not in WINS`);
  const pov = win[2] === 'Black' ? 'black' : 'white';
  return {
    kind: 'embed',
    path: `/embed/game/${roomId}?ply=${ply}&pov=${pov}`,
    title,
    aspect: [702, 696],
  } as ArticleBlock;
}

// Every counted jieqi game people won against the full-strength bot, from the
// switch to it on 2026-08-23 04:15 UTC (commit 514a2387) to 2026-09-29.
// Counted = persistence-counted-games (completed, both sides moved, no test or
// owner seat). Two further bot losses in the window are left out as our
// failures: jq_66ae08e2 (09-02, the bot resigned after two engine timeouts,
// #335) and jq_23d2a761 (08-31, a reveal the search could not see past walked
// into mate in one). Audited 2026-09-30 from each game's events and the bot's move records.
const WINS: ReadonlyArray<[date: string, player: string, side: string, plies: number, finish: string, roomId: string]> = [
  ['Sep 4', '@boliquangtri', 'Red', 97, 'Checkmate', 'jq_9fe33497-3ace-4465-bb15-e0736c7438ad'],
  ['Sep 13', '@tonghuiqu', 'Red', 135, 'Checkmate', 'jq_4b7e09b1-5056-4a0c-b6b1-61ed12ff03d7'],
  ['Sep 17', '@tonghuiqu', 'Red', 41, 'Checkmate', 'jq_bed23125-b330-41f6-b88d-6fb750cb3a19'],
  ['Sep 19', '@tonghuiqu', 'Red', 67, 'Stalemate', 'jq_edca0a1c-eff0-47cb-bc19-51b441eb0859'],
  ['Sep 19', '@tonghuiqu', 'Red', 45, 'Checkmate', 'jq_f5ab7428-e3b0-4389-8a9f-9d552665017a'],
  ['Sep 21', 'Guest', 'Black', 94, 'Stalemate', 'jq_8ae5fc9e-6eb1-4b9f-9e75-2485137db1f5'],
  ['Sep 21', 'Guest', 'Black', 126, 'Stalemate', 'jq_53ead5f3-3c1b-4e7d-8b30-896cce9ab8ff'],
  ['Sep 22', 'Guest', 'Black', 92, 'Stalemate', 'jq_3c0ae446-92b4-457e-b9eb-8da7dbef9e7b'],
  ['Sep 23', 'Guest', 'Black', 176, 'Checkmate', 'jq_1895343d-5933-4361-84d0-21d8d06f0e5a'],
  ['Sep 24', 'Guest', 'Red', 63, 'Checkmate', 'jq_207d4371-1376-4cc9-a982-e27f4ee40e2c'],
  ['Sep 25', 'Guest', 'Red', 117, 'Stalemate', 'jq_36a1267e-1a57-4526-a615-365ab2592edd'],
  ['Sep 27', 'Guest', 'Red', 65, 'Checkmate', 'jq_823995d4-feed-4d7d-b258-367664bb0dc2'],
  ['Sep 29', 'Guest', 'Black', 160, 'Checkmate', 'jq_2538c964-9d13-4a25-98ac-bbe4639f12dd'],
  ['Sep 29', 'Guest', 'Black', 100, 'Checkmate', 'jq_dee4dda3-b78b-4c02-954d-01b954df94f6'],
];

function winRows(): string[][] {
  return WINS.map(([date, player, side, plies, finish, roomId]) => [
    date,
    player,
    side,
    String(Math.ceil(plies / 2)),
    `[${finish}](/watch?channel=jieqi&game=${roomId})`,
  ]);
}

export const jieqiBotWinsArticle: Article = {
  slug: 'jieqi-bot-wins',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Fourteen wins against our jieqi bot',
  seoTitle: 'Beating the Pikafish jieqi bot: 14 wins in 596 games',
  summary:
    'Since August 23, people have played our jieqi bot 596 times and beaten it 14 times. Here is how those games were won, and seven new levels for everyone else.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-01',
  thumbnail: { kind: 'svg', svg: JIEQI_BOT_WINS_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: 'If you have played [jieqi](/rules/jieqi) against the computer here, you have been playing Pikafish at full strength. Until this week it was the only jieqi bot we had.',
    },
    {
      kind: 'paragraph',
      text: 'Since August 23 it has played 596 games against more than 60 people and lost 16 of them. Two of those losses were our fault: once the engine timed out and the bot resigned, and once it walked into a mate its search could not see. That leaves 14 games that people won outright, about one in 42.',
    },
    {
      kind: 'paragraph',
      text: 'That is a hard wall to learn against, so the ladder now has seven easier levels below it. The rest of this page is about the 14 wins, because they show where the top level can be beaten.',
    },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: 'Play jieqi', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'primary' },
        { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
      ],
    },
  ],
  sections: [
    {
      heading: 'Eight levels',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Levels 1 to 7 are the same engine choosing among its top few moves, with more room for error at the lower levels. Level 8 is the bot you have been playing. We set each level by playing the bots against each other and against a player that moves at random, so every step up is measured. The ratings are on the [bots page](/bots).',
        },
        {
          kind: 'paragraph',
          text: 'If you have played jieqi here before, you were playing Level 8.',
        },
      ],
    },
    {
      heading: 'How the fourteen were won',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Five of the 14 ended in stalemate. In jieqi, as in xiangqi, a side with no legal move loses, so trapping the bot\'s general with nowhere to go is a win even when it is not in check. In every one of them the bot had seen the loss coming several moves earlier, and every move it had left lost. The game below opens at move 11, just before the turn: the bot is sure it is well ahead, and one move later it is lost. Step forward with the arrows to reach the stalemate.',
        },
        gameEmbed(
          'jq_53ead5f3-3c1b-4e7d-8b30-896cce9ab8ff',
          20,
          'Jieqi: a guest stalemates the bot\'s lone general after 63 moves',
        ),
        {
          kind: 'paragraph',
          text: 'Five of the wins turned right after the bot moved one of its own face-down pieces. A hidden piece is revealed when it moves, and the bot tends to value that move as if the reveal will go its way. This game opens at move 15 with the bot well ahead and about to reveal a piece. The reply takes a cannon, and within a few moves the lead is gone.',
        },
        gameEmbed(
          'jq_207d4371-1376-4cc9-a982-e27f4ee40e2c',
          29,
          'Jieqi: a guest punishes the bot\'s reveal and mates in 32 moves',
        ),
        {
          kind: 'paragraph',
          text: 'Not every win needed a gamble from the bot. @tonghuiqu has four of the 14, and in the longest of them the game turned on ordinary moves, not a lucky reveal. It opens at move 19 with the game level; over the next 20 moves @tonghuiqu gains ground one step at a time, and mates on move 68.',
        },
        gameEmbed(
          'jq_4b7e09b1-5056-4a0c-b6b1-61ed12ff03d7',
          37,
          'Jieqi: @tonghuiqu outplays the bot over 68 moves',
        ),
        {
          kind: 'paragraph',
          text: 'The winners were also patient. Five of the 14 went past 50 moves, and in this one the lead changed hands twice. It opens at move 42, with the bot ahead for the second time and about to reveal a piece. The player takes over from there and finishes it 38 moves later.',
        },
        gameEmbed(
          'jq_2538c964-9d13-4a25-98ac-bbe4639f12dd',
          82,
          'Jieqi: a guest wins an 80-move game after the lead changes twice',
        ),
      ],
    },
    {
      heading: 'All fourteen',
      blocks: [
        {
          kind: 'table',
          compact: true,
          headers: ['Date', 'Player', 'Side', 'Moves played', 'Finish'],
          rows: winRows(),
          caption:
            'Every game a person won against the full-strength bot from August 23 to September 29. The finish links to the game. Guests are not named.',
        },
      ],
    },
    {
      heading: 'Before August 23',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Until August 23 the jieqi bot ran on a quicker setting than we meant it to, searching for a fraction of a second a move. It won 13 games in a row in early August anyway. Then it lost nine in three days, most likely all to one player, which is how we noticed. We moved it to full strength that night, and none of those nine games are counted above.',
        },
      ],
    },
    {
      heading: 'What is next',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A stronger engine now sits above Level 8: AB-JChess, an open-source jieqi engine by Huorongrong and Laoxu (Kouza), which beat full-strength Pikafish in 248 of 400 games. Its story, and how it handles positions like these, follows next week.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play jieqi', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'primary' },
            { label: 'Jieqi rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
