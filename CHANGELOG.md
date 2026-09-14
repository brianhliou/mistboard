# Changelog

What changed on mistboard.com, month by month, newest first. Modeled on
[lichess.org/changelog](https://lichess.org/changelog): one line per change,
grouped by the part of the site it touches, each line linking the commit.
Unlike lichess, removals get their own heading; a change that takes something
away is still a change.

Conventions:

- Sections are months (`## 2026-09`), newest first. Within a month the
  headings are **Playing**, **Learning and puzzles**, **Watching and review**,
  **Community**, **Site**, **Removed**, **Fixed**, **Technical**. Use only the
  ones a month needs, in that order.
- One line per change, written for a player where the heading is
  player-facing and for a contributor under **Technical**. Present tense, no
  trailing period, the commit hash in parentheses at the end. A change that
  spans several commits links the first and the last.
- Every release that changes behaviour adds a line here in the same commit.
  Refactors, test-only and docs-only commits do not. The homepage News box
  (`apps/web/src/announcements.ts`) stays the curated, player-facing megaphone;
  this file is the complete record.
- The file starts at 2026-09-11. Earlier history is in `git log`.

## 2026-09

### Playing

- A Chinese-language interface, or an English one in a Chinese-reading region (CN, TW, HK, MO, SG, MY, VN), starts on the traditional hanzi piece set; everyone else keeps the international art, and a set picked in Pieces wins either way ([81303048](https://github.com/brianhliou/mistboard/commit/81303048))
- Duck Xiangqi launches on every public surface: rules page, homepage card, lobby seek, a rated ladder, and a bot that plays it ([dd12f1fd](https://github.com/brianhliou/mistboard/commit/dd12f1fd), [2488aea2](https://github.com/brianhliou/mistboard/commit/2488aea2), [aa91538e](https://github.com/brianhliou/mistboard/commit/aa91538e), [8e5704af](https://github.com/brianhliou/mistboard/commit/8e5704af))
- Duck Xiangqi offers 3+2 alongside its other paces ([7bc64a41](https://github.com/brianhliou/mistboard/commit/7bc64a41))
- Hong Kong Mahjong is registered and playable behind its flag; the table reads left to right and a complete hand says what it is worth ([5b2769f7](https://github.com/brianhliou/mistboard/commit/5b2769f7), [828b344f](https://github.com/brianhliou/mistboard/commit/828b344f), [5bb370ea](https://github.com/brianhliou/mistboard/commit/5bb370ea))
- A finished room reveals the whole game to everyone who opens it, players and spectators alike; a live fog room still shows each seat its own view and spectators nothing ([869b29b4](https://github.com/brianhliou/mistboard/commit/869b29b4), [02e3c043](https://github.com/brianhliou/mistboard/commit/02e3c043))
- Xiangqi moves read chess-style by default: piece letter, `x` on capture, destination square, `+` and `#` (`Che3`, `Cxe7+`), Chinese notation by default for zh readers; the choice in the theme gear now reaches the live room, Mistboard TV, and puzzles, not just review and analysis, and a pasted or linked game in that notation imports ([d129f051](https://github.com/brianhliou/mistboard/commit/d129f051))

### Learning and puzzles

- The Duck Xiangqi launch post and the anti-xiangqi article read in Simplified and Traditional Chinese ([0f2894e9](https://github.com/brianhliou/mistboard/commit/0f2894e9))
- "Antichess on the Xiangqi Board Is a Draw" is published: the measurement behind a variant that was not built, with kernel-checked boards and links to the full analysis and the evidence ([334789ba](https://github.com/brianhliou/mistboard/commit/334789ba))
- A rules page for Hong Kong mahjong at /rules/mahjong, unlisted while the table is invitation-only: the claims, why a complete hand is not always a win, and the faan table as the site scores it ([bcb70396](https://github.com/brianhliou/mistboard/commit/bcb70396))
- Every mate puzzle that fits one of the 23 named kill patterns (杀法) says which ([e2ce0d45](https://github.com/brianhliou/mistboard/commit/e2ce0d45))
- "Puzzles with more than one solution" is published, with the two boards playable in place ([a6d82d8b](https://github.com/brianhliou/mistboard/commit/a6d82d8b))
- Every study card carries a thumbnail drawn from its first chapter: a composition shows its diagram, a game collection its opening a few moves in, and the four archive covers stay where they were ([c12e3019](https://github.com/brianhliou/mistboard/commit/c12e3019))

### Watching and review

- A broadcast is one event page, lichess-style: the tour header with a round selector, then Boards (default, opening on the live round or the latest with games), Overview (dates in the event's own clock, venue, source, the schedule, share links) and Players (standings computed from the broadcast games); a round with no records yet says so and points at the source ([d44bca22](https://github.com/brianhliou/mistboard/commit/d44bca22))
- A finished broadcast game opens on the site's review board, with the engine, whole-game analysis, the reader's notation, Game info and Share & export, and the round's pairings in the left rail; a live game keeps its streaming replay, now in the reader's notation too ([d44bca22](https://github.com/brianhliou/mistboard/commit/d44bca22))

### Community

- Edit your own forum post in place from the post's Edit action; edited posts carry an "edited" mark, and a locked topic no longer takes edits ([0b5e4c7c](https://github.com/brianhliou/mistboard/commit/0b5e4c7c))
- Forum topics and posts written in another language open translated when a translation already exists, on the homepage box, the forum lists and the topic page, with one click back to the original; new posts are translated as they arrive, and "Show forum posts translated" in Display settings turns it off ([80e3f8e5](https://github.com/brianhliou/mistboard/commit/80e3f8e5))
- A Mistboard game, study or puzzle link alone on its line in a forum post shows as the board it points at; game links can name a side and a ply ([e901ca07](https://github.com/brianhliou/mistboard/commit/e901ca07), [f4758e4d](https://github.com/brianhliou/mistboard/commit/f4758e4d), [4a0a82f4](https://github.com/brianhliou/mistboard/commit/4a0a82f4))

### Site

- `/stats` is a real page on the about rail, leading with games per week; every count excludes the operator's own accounts and browsers, guests count as players by browser, and a game counts only once both sides have moved ([87ba6d14](https://github.com/brianhliou/mistboard/commit/87ba6d14), [cd4f58b3](https://github.com/brianhliou/mistboard/commit/cd4f58b3), [ea5d57a0](https://github.com/brianhliou/mistboard/commit/ea5d57a0), [b916a663](https://github.com/brianhliou/mistboard/commit/b916a663))
- One identity line across the tagline, About, README and the repository ([2952b177](https://github.com/brianhliou/mistboard/commit/2952b177))
- A shared link to any finished game, in every variant, previews the game: the board at full height in the site's own piece set, the two seats level with their back ranks behind their king, and the score; rules pages, position links and studies draw through the same card, and the site card is the logo, wordmark and identity line ([f5a24d9d](https://github.com/brianhliou/mistboard/commit/f5a24d9d))
- The homepage "games in play" line shows only while a game is actually in play; at zero it is gone rather than announcing an empty site, and the games-played total carries the recency ([1fb35ef0](https://github.com/brianhliou/mistboard/commit/1fb35ef0))

### Removed

- Eleven unlaunched variants are gone from the code, one commit each: Crossroads Chess and Dark Crossroads Chess, Fog Shogi, Drop Mini Xiangqi, Dark Mini Xiangqi and Mini Xiangqi with their puzzles, Reveal Chess, Dark Crazyhouse, Kriegspiel, Luzhanqi, and Dark Draft960 together with the whole pregame draft phase of Fog Chess. Their rules pages answer 410; finished games of theirs still replay. Five reserved-but-unbuilt spec ids went with them. Measured on the commit before and after: 551,242 → 477,016 source lines (−13.5%), 24 → 10 registered variants, 18 → 9 rating pools, 54 dead lazy chunks out of the web build; CI time unchanged ([2bf6490e](https://github.com/brianhliou/mistboard/commit/2bf6490e) through [ef6d463e](https://github.com/brianhliou/mistboard/commit/ef6d463e), #396)
- `/rules/shogi4` stays, unlisted, because it is linked from outside the site ([638bee89](https://github.com/brianhliou/mistboard/commit/638bee89))
- The dev-only lab pages (`/xiangqi-spike`, `/xiangqi-demo`, `/pixel-lab`, `/variant-marks`, `/dobutsu-chess-preview`, `/deepdive`, `/engine-review`), the `dev:lab` profile, `test:parked`, and the orphan one-off scripts ([29a00041](https://github.com/brianhliou/mistboard/commit/29a00041), [7a0cf35a](https://github.com/brianhliou/mistboard/commit/7a0cf35a))
- The tenant runtime's unused setup-submission phase; every room on every stack is playing from creation ([c77489c4](https://github.com/brianhliou/mistboard/commit/c77489c4))
- The "Move notation" row in account display settings, a lichess-shaped switch nothing ever read; the theme gear's xiangqi notation is the one setting, and it offers Algebraic, Chinese and WXF only: Coordinates and ICCS leave the list (exports, fog xiangqi and `?notation=` embed links still use them) ([d129f051](https://github.com/brianhliou/mistboard/commit/d129f051))

### Fixed

- The Source button on a broadcast polled from dpxq's game list opens the dpxq tour page; it linked the poller's own discovery address, which no browser can open ([4be51a37](https://github.com/brianhliou/mistboard/commit/4be51a37))
- A broadcast polled from a dpxq tour list files each game under the round its row states, whenever the record is uploaded, instead of only inside a twelve-hour window after the round started; the 2026 Shanghai Cup was polled all week and imported nothing. A tour's own page also now shows the poller's errors, which used to be written without the tour's name and so never reached it ([ad09c5ff](https://github.com/brianhliou/mistboard/commit/ad09c5ff))
- The study list shows the newest studies first; it used to sort by likes, which with four likes on the site kept the July studies pinned over everything since ([c93c2096](https://github.com/brianhliou/mistboard/commit/c93c2096))
- The variant marker on a study thumbnail scales to its frame, so the homepage rail no longer clips it off-centre ([6a467506](https://github.com/brianhliou/mistboard/commit/6a467506))
- The homepage forum box names each topic's category in the site language instead of English ([80e3f8e5](https://github.com/brianhliou/mistboard/commit/80e3f8e5))
- Mahjong: a discard nobody can claim no longer waits out a six-second window; flowers are drawn and counted toward the three-faan floor; the clock pauses during a claim window and follows a claim to the seat that made it; the table says why a fitting tile cannot be chowed; and the felt is laid out as a ring with one fixed bar for status and claim buttons ([9698ccd7](https://github.com/brianhliou/mistboard/commit/9698ccd7))
- The WebSocket dev switches (`dev=solo`, `dev=engine`, `reset=1`) are gated on the admin authorization `views=all` already required, so a production room id alone no longer opens a live fog room as a solo client ([7c7521f6](https://github.com/brianhliou/mistboard/commit/7c7521f6))
- Deleted variants' rules pages answer 410 instead of falling through to the blog shell ([2ecf7cc6](https://github.com/brianhliou/mistboard/commit/2ecf7cc6), [f2b723d1](https://github.com/brianhliou/mistboard/commit/f2b723d1))
- Duck Xiangqi counts full moves, so the pregame abort window still closes ([fdd1ed4b](https://github.com/brianhliou/mistboard/commit/fdd1ed4b))
- The Fortress Xiangqi rules page no longer links Mini Xiangqi's rules, which are gone; the credit stays ([3a28b392](https://github.com/brianhliou/mistboard/commit/3a28b392))
- A board whose socket never opens on the direct host now falls back to the page origin after two failed opens, and every failed open is reported; some players in China reached a board and were never seated ([444332b2](https://github.com/brianhliou/mistboard/commit/444332b2))
- Correspondence start and deadline emails no longer say a game is forfeited when it would be cancelled before the first move ([d9d756e1](https://github.com/brianhliou/mistboard/commit/d9d756e1))
- A rated game from a deleted variant no longer shows up on the Fog Chess rating graph; the profile drew a June Dark Mini Xiangqi result as a fog rating drop ([de467d33](https://github.com/brianhliou/mistboard/commit/de467d33))
- The Fog Chess, Fog Xiangqi and Fog Chess Concepts rules pages have a link preview again; they had shown the site card since the dark→fog rename. Jieqi, Banqi, Fortress, Duck, Jungle and Flip Jungle rules pages get one for the first time ([f5a24d9d](https://github.com/brianhliou/mistboard/commit/f5a24d9d))

### Technical

- `/api/auth/me` names the allowlisted variants an account may play (`variantGrants`); admins hold every one without a grant row, and the play menu offers a gated variant only to an account the server would seat ([349ed346](https://github.com/brianhliou/mistboard/commit/349ed346))
- Migration 144 tightens the rating-pool constraint to the nine live pools, deletes the mini-family puzzle rows, and drops `games.hidden_draft960` ([f1011fdd](https://github.com/brianhliou/mistboard/commit/f1011fdd))
- Migration 137 stores a browser device id on guest seats ([ea5d57a0](https://github.com/brianhliou/mistboard/commit/ea5d57a0))
- Migration 143 withholds the retired variants' puzzles from every serving path ([2bf6490e](https://github.com/brianhliou/mistboard/commit/2bf6490e))
- The plain-chess kernel is `standardChessVariant` (VariantId `'chess'`); `draft960Variant` and `chess960.ts` are gone ([ef6d463e](https://github.com/brianhliou/mistboard/commit/ef6d463e))
- The variant lab discovers variants from its directory, so adding one touches no shared file ([ef9f2089](https://github.com/brianhliou/mistboard/commit/ef9f2089), [53fb7e4e](https://github.com/brianhliou/mistboard/commit/53fb7e4e))
