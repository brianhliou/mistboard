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

- Duck Xiangqi launches on every public surface: rules page, homepage card, lobby seek, a rated ladder, and a bot that plays it ([dd12f1fd](https://github.com/brianhliou/mistboard/commit/dd12f1fd), [2488aea2](https://github.com/brianhliou/mistboard/commit/2488aea2), [aa91538e](https://github.com/brianhliou/mistboard/commit/aa91538e), [8e5704af](https://github.com/brianhliou/mistboard/commit/8e5704af))
- Duck Xiangqi offers 3+2 alongside its other paces ([7bc64a41](https://github.com/brianhliou/mistboard/commit/7bc64a41))
- Hong Kong Mahjong is registered and playable behind its flag; the table reads left to right and a complete hand says what it is worth ([5b2769f7](https://github.com/brianhliou/mistboard/commit/5b2769f7), [828b344f](https://github.com/brianhliou/mistboard/commit/828b344f), [5bb370ea](https://github.com/brianhliou/mistboard/commit/5bb370ea))
- A finished room reveals the whole game to everyone who opens it, players and spectators alike; a live fog room still shows each seat its own view and spectators nothing ([869b29b4](https://github.com/brianhliou/mistboard/commit/869b29b4), [02e3c043](https://github.com/brianhliou/mistboard/commit/02e3c043))

### Learning and puzzles

- Every mate puzzle that fits one of the 23 named kill patterns (杀法) says which ([e2ce0d45](https://github.com/brianhliou/mistboard/commit/e2ce0d45))
- "Puzzles with more than one solution" is published, with the two boards playable in place ([a6d82d8b](https://github.com/brianhliou/mistboard/commit/a6d82d8b))

### Community

- A Mistboard game, study or puzzle link alone on its line in a forum post shows as the board it points at; game links can name a side and a ply ([e901ca07](https://github.com/brianhliou/mistboard/commit/e901ca07), [f4758e4d](https://github.com/brianhliou/mistboard/commit/f4758e4d), [4a0a82f4](https://github.com/brianhliou/mistboard/commit/4a0a82f4))

### Site

- `/stats` is a real page on the about rail, leading with games per week; every count excludes the operator's own accounts and browsers, guests count as players by browser, and a game counts only once both sides have moved ([87ba6d14](https://github.com/brianhliou/mistboard/commit/87ba6d14), [cd4f58b3](https://github.com/brianhliou/mistboard/commit/cd4f58b3), [ea5d57a0](https://github.com/brianhliou/mistboard/commit/ea5d57a0), [b916a663](https://github.com/brianhliou/mistboard/commit/b916a663))
- One identity line across the tagline, About, README and the repository ([2952b177](https://github.com/brianhliou/mistboard/commit/2952b177))

### Removed

- Eleven unlaunched variants are gone from the code, one commit each: Crossroads Chess and Dark Crossroads Chess, Fog Shogi, Drop Mini Xiangqi, Dark Mini Xiangqi and Mini Xiangqi with their puzzles, Reveal Chess, Dark Crazyhouse, Kriegspiel, Luzhanqi, and Dark Draft960 together with the whole pregame draft phase of Fog Chess. Their rules pages answer 410; finished games of theirs still replay. Five reserved-but-unbuilt spec ids went with them. Measured on the commit before and after: 551,242 → 477,016 source lines (−13.5%), 24 → 10 registered variants, 18 → 9 rating pools, 54 dead lazy chunks out of the web build; CI time unchanged ([2bf6490e](https://github.com/brianhliou/mistboard/commit/2bf6490e) through [ef6d463e](https://github.com/brianhliou/mistboard/commit/ef6d463e), #396)
- `/rules/shogi4` stays, unlisted, because it is linked from outside the site ([638bee89](https://github.com/brianhliou/mistboard/commit/638bee89))
- The dev-only lab pages (`/xiangqi-spike`, `/xiangqi-demo`, `/pixel-lab`, `/variant-marks`, `/dobutsu-chess-preview`, `/deepdive`, `/engine-review`), the `dev:lab` profile, `test:parked`, and the orphan one-off scripts ([29a00041](https://github.com/brianhliou/mistboard/commit/29a00041), [7a0cf35a](https://github.com/brianhliou/mistboard/commit/7a0cf35a))
- The tenant runtime's unused setup-submission phase; every room on every stack is playing from creation ([c77489c4](https://github.com/brianhliou/mistboard/commit/c77489c4))

### Fixed

- The WebSocket dev switches (`dev=solo`, `dev=engine`, `reset=1`) are gated on the admin authorization `views=all` already required, so a production room id alone no longer opens a live fog room as a solo client ([7c7521f6](https://github.com/brianhliou/mistboard/commit/7c7521f6))
- Deleted variants' rules pages answer 410 instead of falling through to the blog shell ([2ecf7cc6](https://github.com/brianhliou/mistboard/commit/2ecf7cc6), [f2b723d1](https://github.com/brianhliou/mistboard/commit/f2b723d1))
- Duck Xiangqi counts full moves, so the pregame abort window still closes ([fdd1ed4b](https://github.com/brianhliou/mistboard/commit/fdd1ed4b))
- The Fortress Xiangqi rules page no longer links Mini Xiangqi's rules, which are gone; the credit stays ([3a28b392](https://github.com/brianhliou/mistboard/commit/3a28b392))

### Technical

- Migration 144 tightens the rating-pool constraint to the nine live pools, deletes the mini-family puzzle rows, and drops `games.hidden_draft960` ([f1011fdd](https://github.com/brianhliou/mistboard/commit/f1011fdd))
- Migration 137 stores a browser device id on guest seats ([ea5d57a0](https://github.com/brianhliou/mistboard/commit/ea5d57a0))
- Migration 143 withholds the retired variants' puzzles from every serving path ([2bf6490e](https://github.com/brianhliou/mistboard/commit/2bf6490e))
- The plain-chess kernel is `standardChessVariant` (VariantId `'chess'`); `draft960Variant` and `chess960.ts` are gone ([ef6d463e](https://github.com/brianhliou/mistboard/commit/ef6d463e))
- The variant lab discovers variants from its directory, so adding one touches no shared file ([ef9f2089](https://github.com/brianhliou/mistboard/commit/ef9f2089), [53fb7e4e](https://github.com/brianhliou/mistboard/commit/53fb7e4e))
