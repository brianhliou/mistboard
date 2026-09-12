# Project Direction

Mistboard is an open-source platform for original strategy games, built for
serious play: server-enforced board games across chess, xiangqi, Jungle,
and related families, including hidden-information games such as dark chess (also
called Fog of War chess).

Mistboard is the umbrella brand; each game is named on its own. The current
anchor is standard xiangqi (Chinese chess): a lichess-quality, English-first
home for the game, with live play, analysis, broadcasts, puzzles, and teaching
that make it approachable to players who do not read Chinese. Hidden-information
variants such as dark chess remain a core strength and the platform's hardest
correctness test. Neither is the whole of the platform.

> Goal: the trustworthy open-source place to play, study, rank, and build engines
> for original strategy games.

This document defines the public product, licensing, branding, and reference
boundaries for contributors.

## Product Focus

Not a general chess clone. The focus is server-authoritative correctness for
games where it matters most, especially games with hidden information where the
server must enforce what each player is allowed to know. The primary work:

- the current anchor: an internationally approachable xiangqi presentation
  (piece sets readable without Chinese characters, English teaching content,
  translated broadcasts)
- server-authoritative state and seat-scoped player views
- correct hidden-information boundaries
- postgame reveal and replay
- ranked ladder integrity and calibration
- learning and review tools
- a public engine protocol, public baselines, and a first-party engine track

Other features earn their place only when they strengthen core play.

## Engine Identity

The formal public identity is **Mistboard Engine** (use in protocol docs,
benchmarks, replay metadata, and trust language). The player-facing opponent is
**Misty**. Public engine choices are stable strength tiers, not versions: Misty
Beginner, Casual, Strong, Max. Technical versions (`python-tier1-v0.9.5`, config
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
assets. Forks are allowed under the GPL but must use distinct branding and must
not imply they are the official service.

Contributors may use common interface conventions, compatible open-source
libraries, public standards, and original work. Do not copy source, layouts,
assets, copy, lessons, puzzles, or databases from other game or chess platforms,
or use branding that implies affiliation. Studying mature products is fine;
reproducing their protected expression or confusing users is not.

## Roadmap Boundaries

The core product is server-enforced play, review, engine challenge, and a gated
ranked ladder. Usually deferred until the core is stable: ungated ratings, broad
public matchmaking, tournaments, chat, broad social profiles, and billing. These
are not permanently forbidden, but they carry trust, integrity, moderation, and
support obligations and should be surfaced only when the project is ready for
them.

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
4. Does it avoid adding social, rating, matchmaking, billing, or moderation
   obligations before the project is ready?

If uncertain, open an issue or discussion first.
