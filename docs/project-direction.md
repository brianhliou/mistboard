# Project Direction

## Mission

**Bring people together across cultures through Chinese chess and original
strategy games.**

We want Chinese chess to have a world stage. Someone arriving for a first game
should be able to find a teacher, follow a tournament and become part of the
game's future. A creator should be able to contribute a game, an engine or a
way to help others understand what happens on the board.

Mistboard's long-term ambition is an international institution connecting
players and game creators with engine builders, teachers and event organizers.
That includes local clubs and in-person tournaments, professional broadcasts
and cultural exchanges. We are working toward a Washington Xiangqi club as a
local starting point. Partnerships with clubs and sporting or cultural
institutions in China and elsewhere could connect that local work to
international events.

The technical ambition includes public engine challenges and, eventually,
competitions on new abstract strategy games where humans and AI agents can
develop and compare approaches. Reproducible results and clear rules should
make each challenge useful to the next person who builds on it.

These are long-term ambitions. Current play, tools and contribution paths are
described below; future events and partnerships are not existing affiliations
or services.

## The Product Today

Mistboard is a free, open-source place to play and study Chinese chess and the
original strategy games built on it. Chinese chess here means xiangqi and its
traditional relatives, Jieqi and Banqi. Beside them sit Mistboard's own games
(Duck Xiangqi, Fog Xiangqi, Crazyhouse Xiangqi), plus Jungle Chess,
Flip Jungle, and Fog Chess.

Mistboard is the umbrella brand; each game is named on its own. The anchor is
the Chinese chess family, in English, Simplified Chinese, and Traditional
Chinese, with live and rated play, analysis, broadcasts, puzzles, and teaching.
Hidden-information games (Fog of War, Jieqi, Banqi, Flip Jungle) are the
platform's hardest correctness test.

The product standard is responsive boards, clear controls and quick improvements
from player feedback. We use AI in development to act on bugs and suggestions.
Free access and open rules let players, teachers and engine builders use and
inspect the same games.

This document defines the public product, licensing, branding, and reference
boundaries for contributors.

## Product Focus

Not a general chess clone. The focus is server-authoritative correctness for
games where it matters most, especially games with hidden information where the
server must enforce what each player is allowed to know. The primary work:

- the Chinese chess family, presented for players in English and Chinese
  (piece sets readable without Chinese characters, teaching content and
  broadcasts in both languages)
- server-authoritative state and seat-scoped player views
- correct hidden-information boundaries
- postgame reveal and replay
- ranked ladder integrity and calibration
- learning and review tools
- a public engine protocol, public baselines, and a first-party engine track

Other features earn their place only when they strengthen core play.

The mission also gives teaching, broadcasts and engine challenges a lasting
purpose: they help people take part in the games. The wider vision informs
which projects we choose; a new game, event or partnership still needs its own
agreed scope.

## Engine Identity

The formal public identity is **Mistboard Engine** (use in protocol docs,
benchmarks, replay metadata, and trust language). The player-facing opponent is
**Misty**. Bots are named by engine and level (Fairy-Stockfish and Pikafish
levels, Misty, KataGo, AB-JChess), not by version. Technical versions (`python-tier1-v0.9.5`, config
hashes, and similar) stay available for reproducibility but are not the primary
user-facing choice.

## License And Source

AGPL-3.0-or-later. AGPL-compatible libraries and engines are fine when they fit,
including GPL-3.0 (explicitly AGPL-compatible); most permissive licenses (MIT,
Apache-2.0, BSD) are compatible too. Do not add code, assets, data, or
dependencies with unclear rights.

Open source does not transfer control of the hosted service, domains, trademarks,
package publishing, roadmap, production infrastructure, events, or sponsorships.
Those remain controlled project assets.

## Brand And Reference

The Mistboard name, domains, logos, and hosted-service identity are controlled
assets. Forks are allowed under the AGPL but must use distinct branding and must
not imply they are the official service.

Contributors may use common interface conventions, compatible open-source
libraries, public standards, and original work. Do not copy source, layouts,
assets, copy, lessons, puzzles, or databases from other game or chess platforms,
or use branding that implies affiliation. Studying mature products is fine;
reproducing their protected expression or confusing users is not.

## Roadmap Boundaries

The core product is server-enforced play, review, engine challenge, and rated
play. Rated games, Find opponent matchmaking, chat, a forum, and profiles with
following are live; changes to them carry trust, integrity, moderation, and
support obligations, so open an issue before working on them. Still deferred:
running our own tournaments (broadcasts relay outside events), OAuth sign-in,
and engine help during live games.

## Monetization

The project may monetize the hosted service and original work (sponsorships,
supporter accounts, hosted events, managed rooms, infrastructure support,
research/benchmark work). Sponsors and paying users do not receive roadmap
control, private data access, benchmark or event-result control, trademark
ownership, or release authority.

## Contributor Checklist

1. Does this improve play, review, learning, research, or integrity for
   Mistboard's games?
2. Is the implementation original or clearly license-compatible?
3. Does it avoid implying affiliation with another platform?
4. If it touches ratings, matchmaking, chat, moderation, or payments, was the
   direction agreed in an issue first?

If uncertain, open an issue first.
