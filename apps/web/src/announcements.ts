// Entries for the landing News box and the /feed page.
//
// Workflow: when shipping a user-facing change, append a new entry with
// today's date. Newest first (both surfaces sort by date descending). Skip
// for internal-only changes (engine internals, infra, CI, refactors).
//
// STUDIES: do not post per published study, and never count them ("two new
// studies"): the count is wrong the next time one ships, and the homepage
// already lists them live from the API. Post when a WORK is finished (a manual,
// not a volume) or at a milestone worth a reader's attention. Individual
// publications reach people through the studies widget and /study on their own.

export type AnnouncementKind = 'status' | 'article' | 'release' | 'update';

export type Announcement = {
  date: string; // ISO YYYY-MM-DD
  kind: AnnouncementKind;
  headline: string;
  body?: string;
  href?: string;
  cta?: string; // inline link label on /feed; falls back to "Read more"
  showInHomeArticleWidget?: boolean;
};

const baseAnnouncements: Announcement[] = [
  {
    date: '2026-09-11',
    kind: 'status',
    headline: 'The statistics count visitor games only.',
    body: 'The games-played number on the home page and the statistics page now counts finished games between visitors, or a visitor and a bot, since the site opened in June. Engine matches, our own test games, and the games we played before anyone else had found the site are left out. That takes the number down to about a third of what it showed; the other two thirds was us.',
    href: '/stats',
    cta: 'See the statistics',
  },
  {
    date: '2026-09-11',
    kind: 'release',
    headline: 'Duck Xiangqi has launched.',
    body: "Chinese chess with one duck that both players share. Make your move, then put the duck on any empty point. It blocks a horse's leg, an elephant's eye and the file between the generals, and it works as a cannon screen for whoever moves next, so the screen you build is never yours. There is no check: you win by capturing the general outright, and the two generals may now face each other down an open file, where flying the general is a capture. Play the eight-level bot or a friend.",
    href: '/rules/duck-xiangqi',
    cta: 'Study the rules',
  },
  {
    date: '2026-09-11',
    kind: 'release',
    headline: 'All six volumes of the Elegant Pastime Manual are online.',
    body: "The Elegant Pastime Manual is a Ming collection of xiangqi endgame compositions. Five hundred and forty-nine of its problems are here now, each on its own board, with the book's solution played out as the mainline and the original four-character title kept beside the English one. Around sixty are draw studies where the source gives its answer in prose rather than as a line, and those notes are quoted as written rather than guessed at. Positions come from dpxq.com and are credited on every composition. One problem is absent: the line recorded for number 479 stops being legal partway through, and half a solution is worse than none.",
    href: '/study/0Qi14WbN',
    cta: 'Open volume one',
  },
  {
    date: '2026-09-06',
    kind: 'update',
    headline: 'Patron checkout is open.',
    body: 'The Support page takes monthly subscriptions now, at $5, $10, $20, or $50. A subscription puts a heart badge on your profile and does nothing else: no Patron-only content, no gameplay advantage. Core play and learning stay free and are meant to. Subscriptions pay for the servers and the development time. Cancel from the billing portal at any point and the period you already paid for runs out.',
    href: '/patron',
    cta: 'Become a Patron',
  },
  {
    date: '2026-09-06',
    kind: 'release',
    headline: 'Practice the basic endgames against the engine.',
    body: 'Thirty-two positions from the book endgames, each with a goal instead of a stored answer. The engine plays the defense and grades you on whether the win is still there after your move. A chariot cannot break the full defense and three soldiers can, which is the sort of claim you only believe after failing to prove it. Endgames come first because their verdicts are the part of xiangqi an English speaker has the least access to. More sets will follow.',
    href: '/practice',
    cta: 'Try an exercise',
  },
  {
    date: '2026-09-06',
    kind: 'release',
    headline: 'Misty is open source.',
    body: 'The Fog of War chess engine you play here is on GitHub under the GPL, and installs from PyPI as misty-chess. It is a build of the architecture behind Obscuro, the first superhuman Fog of War chess AI, whose own code was never released. The engine article now says how it works, what version 1.6 fixed, and what is still wrong with it.',
    href: '/blog/misty',
    cta: 'How Misty plays',
  },
  {
    // Dated to the article's own date, a day after the platform page it links
    // back to, so the News row and the page never disagree about a post.
    date: '2026-09-04',
    kind: 'article',
    headline: 'What strong jieqi players believe about the opening.',
    body: 'Jieqi has no opening book. What it has is an argument, running on Chinese forums for years among players with thousands of games, that has never appeared in English. Five first moves ranked, why a face-down piece is a one-shot option you can waste, and the pawn push weighed against the crossed cannon on all six things you might reveal. Our own fifty games disagree with the ranking, and the engine declines the list altogether.',
    href: '/blog/jieqi-openings',
    cta: 'Read the article',
  },
  {
    date: '2026-09-03',
    kind: 'article',
    headline: 'What the site does with jieqi, on one page.',
    body: 'The jieqi page now says it in one place: play the engine or a friend, get a review that prices every flip separately from every choice you made, and run the same engine in your own browser on the analysis board. It reads in Simplified and Traditional Chinese too.',
    href: '/blog/jieqi-platform',
    cta: 'Read the article',
  },
  {
    date: '2026-09-03',
    kind: 'update',
    headline: 'Storm the Fortress: the Soldier crosses the river again.',
    body: 'Two rule changes. The Soldier goes back to the xiangqi rule it should always have had: one point forward on your own half, and the sideways step only once it has crossed the river. Crossing is the commitment it costs something to make. The Treasure now stays home for good, moving and dropping only on its own half, so the piece you are storming for cannot parachute into the fight. Engine self-play across five rule sets and a thousand games says the Soldier is what makes this game sharp: draws fall from 34% to 9% and a typical game runs half again as long.',
    href: '/rules/fortress-xiangqi',
    cta: 'Read the updated rules',
  },
  {
    date: '2026-09-03',
    kind: 'release',
    headline: 'Every game in progress, on one page.',
    body: 'Current games lists everything being played right now, across every variant: live games with their clocks, and correspondence games waiting on a move, each as a small board you can click into. Fog games appear as cards without a board until they end. When nothing is running, the page shows the open correspondence seeks and the most recent finished games instead. The games database moved to Advanced search under Tools.',
    href: '/games',
    cta: 'See current games',
  },
  {
    date: '2026-09-02',
    kind: 'release',
    headline: 'Put a Mistboard board in your own page.',
    body: 'Any finished game, Mistboard TV, the daily puzzle and the xiangqi analysis board now run inside an iframe, the way a study chapter already could. Copy a snippet from the developers page; no key needed. The read API behind the site is documented too, as an OpenAPI document at /api/openapi.json: games, watch feeds, puzzles, studies and the ladders.',
    href: '/developers',
    cta: 'See the developers page',
  },
  {
    date: '2026-09-02',
    kind: 'release',
    headline: 'Read the forum in your language.',
    body: 'Forum titles and posts written in Chinese now carry a Translate button for English readers, and English posts carry one for Chinese readers. A language model does the translating. The result is marked as machine translation, and one click brings the original back. Each post is translated once and then served from a cache, so the second reader never waits.',
    href: '/forum',
    cta: 'Open the forum',
  },
  {
    // Dated to the day the article becomes readable, not the day it was drafted.
    date: '2026-09-02',
    kind: 'article',
    headline: 'Where the puzzles come from.',
    body: 'Three thousand five hundred real games went through Pikafish looking for tactics. It found 10,503 blunders and published 1,211 of them. The whole pipeline is written up, including the parts that throw work away: two thirds of every blunder found dies because the position had more than one winning move, or because winning it took one obvious move.',
    href: '/blog/how-puzzle-mining-works',
    cta: 'Read the article',
  },
  {
    date: '2026-09-01',
    kind: 'release',
    headline: 'A ten-minute clock, on every game.',
    body: 'Ten minutes with a five-second increment is now on the time control list for every variant, and xiangqi and jieqi start there. A full board runs thirty to forty moves a side, which three minutes does not cover. The faster paces are all still there.',
    href: '/?play=computer',
    cta: 'Start a game',
  },
  {
    date: '2026-08-30',
    kind: 'update',
    headline: 'Sixty-one games from the Division A qualifier.',
    body: "China's top xiangqi league runs its qualifier in Hangzhou every August, and this year's three rounds are now here to replay in English, with the club names and the players romanized. Ten clubs, four boards a match, and an engine a click away on any position. The league itself starts in September.",
    href: '/broadcast/xiangqi/2026-league-qualifier',
    cta: 'Open the qualifier',
  },
  {
    // Matches the article's own date. A News item dated the 29th above a page
    // dated the 30th is the two surfaces disagreeing about the same post.
    date: '2026-08-30',
    kind: 'article',
    headline: 'The Xiangqi World Championship, and why it is not the senior title.',
    body: 'Nineteen editions since 1990, eleven winners, and a title that stayed in China until last September. Every champion, an annotated game for ten of them, and the reason the Chinese national championship is the harder one to win.',
    href: '/blog/xiangqi-world-championship',
    cta: 'Read the article',
  },
  {
    date: '2026-08-28',
    kind: 'release',
    headline: 'Paste a game, get a board.',
    body: 'Import takes a xiangqi game in whatever notation you happen to have: PGN, coordinates, WXF, or Chinese move text. It works out which one you pasted by replaying it, then hands you a browsable board with engine analysis. Nothing is published, and the game travels in the link.',
    href: '/import',
    cta: 'Import a game',
  },
  {
    date: '2026-08-28',
    kind: 'update',
    headline: 'Brilliant moves are marked now.',
    body: 'Xiangqi review adds !! and ! beside the mistake glyphs it already showed. A move earns !! when you give material up and the engine agrees it does not come back. Blunders were never the only thing worth seeing in your own game.',
    href: '/games/search',
    cta: 'Find a game',
  },
  {
    // Dated to the day the article actually became readable, not the day it was
    // announced. This went out on 2026-08-27 while the article was still a
    // draft, so its link 404d in production for two days. The guid carries the
    // date, so moving it resurfaces the item for anyone who got the dead link.
    date: '2026-08-29',
    kind: 'article',
    headline: 'Who Is the Greatest Xiangqi Player?',
    body: 'Nine hundred years of Chinese chess, and a championship only sixty-nine years old. Hu Ronghua, the men who came before the title existed, and the decade that was struck from the record.',
    href: '/blog/xiangqi-champions',
    cta: 'Read the article',
  },
  {
    date: '2026-08-28',
    kind: 'update',
    headline: 'A bigger video library, and one that reads Chinese.',
    body: 'The library is up to 61 hand-picked videos, ordered best first instead of by the date they were added, and it now opens in Chinese at its own address. Every entry has been checked against YouTube, so nothing on the shelf is a dead link.',
    href: '/videos',
    cta: 'Browse the library',
  },
  {
    date: '2026-08-27',
    kind: 'release',
    headline: 'Set up any position, then share it.',
    body: 'A board editor for eight variants: place pieces by hand, set the side to move, and hand the position straight to the analysis board. The analysis board also takes a FEN directly, and every position you build has its own link.',
    href: '/editor/xiangqi',
    cta: 'Open the editor',
  },
  {
    date: '2026-08-27',
    kind: 'release',
    headline: 'A head-to-head record on every finished game.',
    body: 'The review page gains a Crosstable with your record against that opponent in that variant, engines included, and Share and export hands you the game as PGN or JSON.',
    href: '/games/search',
    cta: 'Find a game',
  },
  {
    date: '2026-08-27',
    kind: 'update',
    headline: 'Chess titles count for verification now.',
    body: 'GM, IM, FM and the rest join the xiangqi titles. A verified title puts a badge beside your name wherever people are listed, and opens a coaching page students can find. Verification takes about two minutes.',
    href: '/blog/titled-players',
    cta: 'Read the article',
  },
  {
    date: '2026-08-27',
    kind: 'update',
    headline: 'Board coordinates, on every board that has them.',
    body: 'One switch in Display settings reaches the xiangqi family, the chess boards, jungle, and shogi. Xiangqi counts its files from each player’s own right, so the labels follow your move-notation setting and change sides when you flip the board.',
    href: '/account/settings/display',
    cta: 'Open settings',
  },
  {
    date: '2026-08-27',
    kind: 'update',
    headline: 'Follow a forum thread without refreshing it.',
    body: 'Watch a topic and the bell counts its unread replies. Quoting someone now tells them, and every source the bell reports has its own switch.',
    href: '/forum',
    cta: 'Join the forum',
  },
  {
    date: '2026-08-26',
    kind: 'release',
    headline: 'Studies read and write PGN.',
    body: 'Import a PGN to build a study, export one chapter or all of them, and add a finished game to a study from its link. The opening explorer sits beside the board while you work.',
    href: '/study',
    cta: 'Browse the studies',
  },
  {
    date: '2026-08-23',
    kind: 'article',
    headline: 'The Riverbank Cannon Problem.',
    body: 'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.',
    href: '/blog/riverbank-cannon',
    cta: 'Read the article',
  },
  {
    date: '2026-08-23',
    kind: 'update',
    headline: 'Puzzles are rated by how hard they play.',
    body: 'A puzzle’s rating used to come from how many moves the mate took, which says little about how hard it is to find. It now comes from the position itself, so what you are served sits closer to your rating.',
    href: '/puzzles',
    cta: 'Solve puzzles',
  },
  {
    date: '2026-08-23',
    kind: 'update',
    headline: 'Pick a flair for your name.',
    body: 'Choose a small icon that shows beside your handle across the site, from the variant markers and xiangqi characters the boards already use. The bell also reports new followers and incoming challenges now.',
    href: '/account',
    cta: 'Edit your profile',
  },
  {
    date: '2026-08-22',
    kind: 'update',
    headline: 'Both house bots play stronger.',
    body: 'Misty runs version 1.6 in fog chess, which closes a queen hang it used to walk into. Pikafish now searches jieqi to full depth; it had been stopping early, which made it easier to beat than it should have been.',
    href: '/',
    cta: 'Find a game',
  },
  {
    date: '2026-08-22',
    kind: 'update',
    headline: 'Four times as many xiangqi puzzles.',
    body: 'The standard xiangqi set goes from 394 puzzles to 1,605, every one mined from a finished game and checked by the engine before it ships.',
    href: '/puzzles',
    cta: 'Solve puzzles',
  },
  {
    date: '2026-08-22',
    kind: 'release',
    headline: 'Move badges and best lines on every reviewable variant.',
    body: 'The move-judgment badge now sits on the board for all six variants with analysis, not xiangqi alone, and a blunder names the move that refutes it. Jieqi reveal plies get the ranked candidates the engine scored instead of a line, since nothing past a flip is knowable.',
    href: '/analysis',
    cta: 'Open the board',
  },
  {
    date: '2026-08-22',
    kind: 'article',
    headline: 'Separating skill from luck in flip games.',
    body: 'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Game review splits every flip into the decision you made and the tile you got, and the article runs that over 52 human-versus-engine games.',
    href: '/blog/skill-vs-luck',
    cta: 'Read the article',
  },
  {
    date: '2026-08-13',
    kind: 'update',
    headline: 'What Patron support will cost.',
    body: 'The Support page lists the monthly amounts, what they include (a profile badge, no gameplay advantage), and the billing and refund terms in full. Checkout is not open yet.',
    href: '/patron',
    cta: 'See the amounts',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-08-13',
    kind: 'release',
    headline: 'A games database for xiangqi.',
    body: 'Search finished games from three sources in one place: the historical corpus, the tournament boards we broadcast, and games played here.',
    href: '/games/search',
    cta: 'Search the games',
  },
  {
    date: '2026-08-13',
    kind: 'release',
    headline: 'Perpetual check now loses in standard xiangqi.',
    body: 'Repeating a check forever used to draw. The checker has to vary or lose the game, which is how the published rulesets score it and how the course has always taught it.',
    href: '/rules/xiangqi',
    cta: 'Study the rules',
  },
  {
    date: '2026-08-08',
    kind: 'release',
    headline: 'Mistboard works on a phone.',
    body: 'Every page was swept at phone width: a full-size live board, lobby rows that still name the variant, and real touch targets on the controls you tap.',
    href: '/',
    cta: 'Find a game',
  },
  {
    date: '2026-08-08',
    kind: 'update',
    headline: 'Every composition has its own page.',
    body: 'Each endgame composition in the library is a page you can link to, and sharing one previews its own diagram rather than the site card.',
    href: '/study',
    cta: 'Browse the studies',
  },
  {
    date: '2026-08-03',
    kind: 'release',
    headline: 'Mistboard reads in Chinese.',
    body: 'Playing, watching, the forum, and the xiangqi rules pages are all available in Simplified and Traditional Chinese. Switch languages in the settings menu.',
    href: '/rules/xiangqi',
    cta: 'Study the rules',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-07-28',
    kind: 'release',
    headline: 'Rated games at every time control.',
    body: 'Bullet, blitz, and rapid each keep their own rating now, instead of rated meaning 3+2 only. Correspondence stays casual on purpose.',
    href: '/leaderboard',
    cta: 'See the leaderboard',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-07-23',
    kind: 'release',
    headline: 'An opening explorer for xiangqi.',
    body: 'Open any position on the analysis board and see what has been played from it, with example games to study and the corpus it came from named on the panel.',
    href: '/analysis',
    cta: 'Open the board',
  },
  {
    date: '2026-07-22',
    kind: 'release',
    headline: 'Rated xiangqi is live.',
    body: 'Choose Rated in the lobby. Your rating starts at 1500 and appears after it settles.',
    href: '/leaderboard',
    cta: 'See the leaderboard',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-07-23',
    kind: 'article',
    headline: 'Secret in the Tangerine, both game volumes.',
    body: 'Both volumes are playable move by move in English: 33 games with every printed variation.',
    href: '/study/Dfi3NpRE',
    cta: 'Open volume one',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-07-21',
    kind: 'article',
    headline: 'Classical xiangqi, from the original woodblocks.',
    body: 'Read the earliest printings move by move, with every corrected misprint marked on the board.',
    href: '/study',
    cta: 'Browse the studies',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-07-17',
    kind: 'release',
    headline: 'Correspondence play has launched.',
    body: 'Post or accept a days-per-move seek, or send a friend a challenge link and play at your own pace.',
    href: '/',
    cta: 'Find a game',
  },
  {
    date: '2026-07-17',
    kind: 'release',
    headline: 'An analysis board for every game.',
    body: 'Set up any position, import moves, run a local evaluation, or grade a finished game with server analysis.',
    href: '/analysis',
    cta: 'Open the board',
  },
  {
    date: '2026-07-11',
    kind: 'release',
    headline: 'Studies have launched.',
    body: 'Build shareable analysis boards: draw on the board, comment, branch variations, organize chapters, and publish interactive gamebook lessons.',
    href: '/study',
    cta: 'Browse studies',
  },
  {
    date: '2026-07-11',
    kind: 'release',
    headline: 'Mistboard TV is live.',
    body: 'Watch live games on the new Watch page, with a channel for every game and an Engines channel for bot-versus-bot matches.',
    href: '/watch',
    cta: 'Watch now',
  },
  {
    date: '2026-07-10',
    kind: 'release',
    headline: 'Learn xiangqi from scratch.',
    body: 'A free interactive course: 20 stages and 111 hands-on levels take you from how each piece moves to the named checkmate patterns.',
    href: '/learn',
    cta: 'Start the course',
  },
  {
    date: '2026-07-10',
    kind: 'release',
    headline: 'Xiangqi puzzles have launched.',
    body: 'Tactics mined from real games, with puzzle ratings, hints, and a daily puzzle on the homepage.',
    href: '/puzzles',
    cta: 'Solve puzzles',
  },
  {
    date: '2026-07-04',
    kind: 'release',
    headline: 'Xiangqi has launched.',
    body: 'Standard Chinese chess on the full 9 by 10 board is now first-class on Mistboard: play the Pikafish engine at three strengths, or challenge a friend.',
    href: '/rules/xiangqi',
    cta: 'Study the rules',
  },
  {
    date: '2026-07-03',
    kind: 'release',
    headline: 'Forum and global chat have launched.',
    body: 'The forum is open for game analysis, engine talk, and site feedback, with the homepage global chat available for quick table-talk during live sessions.',
    href: '/forum',
    cta: 'Join the forum',
  },
  {
    date: '2026-07-01',
    kind: 'release',
    headline: 'Fortress has launched.',
    body: 'Xiangqi with a pocket: every piece moves as in Chinese chess, plus crazyhouse-style drops and the new Treasure. Play the bot or challenge a friend.',
    href: '/rules/fortress-xiangqi',
    cta: 'Study the rules',
  },
  {
    date: '2026-06-30',
    kind: 'release',
    headline: 'Jungle Chess has launched.',
    body: 'Rank-based animal chess on a 7 by 9 board with rivers, dens, and traps is live. Challenge a friend or take on the Misty Jungle engine.',
    href: '/rules/jungle',
    cta: 'Read rules',
  },
  {
    date: '2026-06-30',
    kind: 'release',
    headline: 'Flip Jungle has launched.',
    body: 'Every animal starts face-down on a 4 by 4 board and flips as you play. Challenge a friend or the engine.',
    href: '/rules/jungle-flip',
    cta: 'Read rules',
  },
  {
    date: '2026-06-22',
    kind: 'release',
    headline: 'Drop Mini Xiangqi has launched.',
    body: 'The 7 by 7 reserve fight is live with no enemy-palace drops, a full rules page, and a 114-ply FSF sample game to study.',
    href: '/rules/drop-mini-xiangqi',
    cta: 'Study the rules',
  },
  {
    date: '2026-06-20',
    kind: 'release',
    headline: 'Dark Crazyhouse has launched.',
    body: 'Crazyhouse under Fog of War is now live for invite games, with private hands, captured pieces entering reserve, and drops into the fog.',
    href: '/rules/dark-crazyhouse',
    cta: 'Read rules',
  },
  {
    date: '2026-06-20',
    kind: 'release',
    headline: 'Dark Crossroads Chess has launched.',
    body: 'Crossroads Chess under Fog of War is now live for invite games, with hidden enemy pieces, no check warnings, and the far-rank Try.',
    href: '/rules/dark-crossroads-chess',
    cta: 'Read rules',
  },
  {
    date: '2026-06-20',
    kind: 'release',
    headline: 'Fog Shogi has launched.',
    body: 'Shogi under Fog of War is now live for invite games, with private hands, drops into the fog, and king capture wins.',
    href: '/rules/dark-shogi',
    cta: 'Read rules',
  },
  {
    date: '2026-06-20',
    kind: 'release',
    headline: 'Kriegspiel is open for alpha play.',
    body: 'The original hidden-information chess: see only your own pieces, try moves through the umpire, and challenge a friend to a match.',
    href: '/rules/kriegspiel',
    cta: 'Read rules',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-06-18',
    kind: 'release',
    headline: 'Reveal Chess is open for alpha play.',
    body: 'Standard chess with a hidden starting arrangement: every piece but the king begins face-down and reveals its true identity the moment it moves. Challenge a friend to a match.',
    href: '/rules/reveal-chess',
    cta: 'Read rules',
  },
  {
    date: '2026-06-18',
    kind: 'release',
    headline: 'Fog Xiangqi is open for alpha play.',
    body: 'Fog of War on the full 9 by 10 xiangqi board: each side sees only the points its pieces reach. Challenge a friend to a match.',
    href: '/rules/fog-xiangqi',
    cta: 'Read rules',
  },
  {
    date: '2026-06-17',
    kind: 'release',
    headline: 'Banqi is open for alpha play.',
    body: 'Banqi on an 8 by 4 board: all 32 pieces start face-down and flip as you play. Challenge a friend to a match.',
    href: '/rules/banqi',
    cta: 'Read rules',
    showInHomeArticleWidget: false,
  },
  {
    date: '2026-06-15',
    kind: 'release',
    headline: 'Jieqi is open for alpha play.',
    body: 'Hidden-identity xiangqi: every non-general piece starts face-down and reveals as it moves. Take on PikaJieQi, our jieqi engine.',
    href: '/rules/jieqi',
    cta: 'Read rules',
  },
  {
    date: '2026-06-11',
    kind: 'release',
    headline: 'Crossroads Chess has launched.',
    body: 'A 6 by 8 chess-xiangqi variant with checkmate and king-race wins is now live on Mistboard.',
    href: '/rules/crossroads-chess',
    cta: 'Read rules',
  },
  {
    date: '2026-05-09',
    kind: 'release',
    headline: 'Fog Chess is open for alpha play.',
    body: 'Fog of War chess is live on Mistboard, with private vision, no check warnings, and king capture wins.',
    href: '/rules/fog-chess',
    cta: 'Read rules',
  },
  {
    date: '2026-05-09',
    kind: 'status',
    headline: 'Mistboard is in alpha.',
    body: 'Casual dark chess is open. Rated beta is coming.',
    href: '/contact',
    cta: 'Send feedback',
  },
  {
    date: '2026-06-09',
    kind: 'release',
    headline: 'Dark Mini Xiangqi is open for alpha play.',
    body: 'A smaller Fog of War variant on a 7 by 7 xiangqi board, with Misty engine support.',
    href: '/rules/dark-mini-xiangqi',
    cta: 'Read rules',
  },
  {
    date: '2026-06-03',
    kind: 'release',
    headline: 'Misty 1.0 has launched.',
    body: 'Our Fog of War dark chess engine is now live to play.',
    href: '/?play=computer',
    cta: 'Play the engine',
  },
];

export function announcements(): Announcement[] {
  return baseAnnouncements;
}

/**
 * Stable anchor for one entry on /feed, which is where the landing News rail
 * sends a reader who clicks a row.
 *
 * Derived from the ENGLISH headline on purpose. The rail localizes an entry
 * before rendering it, so slugging the localized headline would mint a
 * different anchor per locale and a link shared from a zh page would land
 * nowhere on an en one. Pass the source entry, never a localized copy.
 *
 * The date alone is not enough: 2026-08-30 carries two entries. The headline
 * is what makes it unique, and rewriting a shipped headline breaks its anchor,
 * which is acceptable because a headline edit is already a three-language job
 * nobody does casually.
 */
export function announcementSlug(entry: Announcement): string {
  const slug = entry.headline
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug ? `${entry.date}-${slug}` : entry.date;
}
