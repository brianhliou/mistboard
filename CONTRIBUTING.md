# Contributing

Mistboard is a free, open-source place to play and study Chinese chess
(xiangqi, Jieqi, Banqi) and the original strategy games built on it, such as
Duck Xiangqi, Fog Xiangqi, Fortress, and Crazyhouse Xiangqi. Jungle Chess, Flip
Jungle, and Fog Chess are live too. Every game is server-enforced, and several
hide information from one side (Fog of War, Jieqi, Banqi, Flip Jungle). Before
opening a pull request, check whether the change helps the product rule:

> Does this make Mistboard a more trustworthy place to play, study, rank, or
> build engines for xiangqi and its variants?

If the answer is no, open an issue first.

For project direction, licensing, branding, reference, roadmap, and monetization
boundaries, see [`docs/project-direction.md`](docs/project-direction.md).

## Scope

Good contributions:

- rules correctness for any live variant, with tests in `packages/game`
- hidden-information safety and `PlayerView` tests
- replay and postgame reveal improvements
- board interaction polish
- translations (see [`docs/translations.md`](docs/translations.md))
- engine protocol surfaces in `packages/game/src/engine-protocol.ts` and
  `apps/server/src/engine-protocol/`. The first-party engine implementation is
  outside this repository; the public contract is the contribution surface here.
- documentation for rules, protocols, tournaments, and engine integration

Open an issue and agree on direction before a pull request that:

- adds a new variant
- changes ratings, matchmaking, or who can play rated
- adds or changes chat, forum, or moderation features
- touches payments or account sign-in (OAuth is not supported today)
- adds broad general chess-platform features

## Development

Prerequisites:

- Node.js 22 or newer
- npm
- Docker, for the default `npm run dev` (it starts Postgres in a container);
  `npm run dev:memory` runs without it

First-time setup:

```bash
npm install
```

Local dev loop:

```bash
npm run dev              # default: starts Docker Postgres (port 5435), applies migrations, runs server + web
npm run dev:memory       # in-memory server, no Docker needed; DB-backed pages show empty states
```

Open `http://localhost:3000`.

Before a pull request, run checks that match the blast radius:

```bash
npm run verify -- --changed
npm run check:drift       # public-doc links, SQL enum drift, fog payload guards
npm run i18n:check        # app catalog structure, critical coverage, and gap report
npm run ci:quick
npm test                 # unit and integration tests, in-memory
```

For interface copy, English is the source contract and noncritical locale gaps fall back safely.
See [`docs/translations.md`](docs/translations.md) for domain ownership and the critical-key policy.

Replay, reconnect, and persistence flows already work under the default
`npm run dev` (it is Postgres-backed). For the Postgres-backed server test
suite and product-shaped local fixtures:

```bash
npm run test:persistent  # integration tests against local Postgres
npm run db:seed:qa       # profiles, finished variant games, watch feed, QA fixtures
```

Good entry points for local testing:

```text
http://localhost:3000/?play=computer&gameSpecId=xiangqi
http://localhost:3000/?play=computer&gameSpecId=jieqi
http://localhost:3000/?room=fog-dev&reset=1&variant=dark-chess
```

The first two open the play-the-computer setup on that variant (any registered
game spec id works). The third is a Fog Chess dev room.

For mobile/article layout iteration after the dev server is running:

```bash
npm run test:mobile:shots
```

See [GitHub issues](https://github.com/brianhliou/mistboard/issues) for what's
currently being worked on. See [`docs/README.md`](docs/README.md) for the public
documentation map.

## Pull Requests

Keep PRs focused. A small bug fix with a regression test is better than a broad refactor plus product change.

For hidden-information code, include tests that prove forbidden payloads are absent. In Mistboard, a green UI is not enough; the server must not send hidden truth to the wrong client.

Before opening a PR:

- run the relevant tests
- update docs when behavior changes
- keep private planning, provider setup, and secrets out of the public repo (local notes live in the git-ignored `docs-private/`)
- avoid committing generated corpora, large tournament logs, or local artifacts unless they are explicitly part of a reviewed benchmark/release artifact
- do not include secrets, production URLs, API keys, or private credentials

## Contribution Rights

Mistboard uses a Developer Certificate of Origin style contribution policy.

By contributing, you certify that you have the right to submit the contribution and that it may be distributed under the project's license, AGPL-3.0-or-later.

For nontrivial commits, include a sign-off line:

```text
Signed-off-by: Your Name <you@example.com>
```

This project does not currently require a separate Contributor License Agreement. If that changes, it will be documented here before being required.

The workspace packages are marked `private` in their `package.json` to prevent accidental npm publishing. That is repository hygiene, not a repository-visibility policy.

## Governance

See `GOVERNANCE.md`. Contributions are welcome, but Mistboard remains founder-led. Merging a contribution does not grant commit access, release authority, financial control, or ownership of the official project identity.
