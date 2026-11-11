# Contributing

Bug fixes, rules corrections, tests, translations and engine-protocol work are
welcome. Open an issue and agree on direction before a pull request that:

- adds a variant
- changes ratings, matchmaking, or who can play rated
- adds or changes chat, forum or moderation
- touches payments or sign-in
- adds broad chess-platform features

## Setup

Node.js 22 or newer, and Docker for the default database.

```bash
npm install
npm run dev          # Postgres in Docker on port 5435, migrations, server and web
npm run dev:memory   # in-memory, no Docker
```

Open `http://localhost:3000`. `/?play=computer&gameSpecId=xiangqi` opens a game
against the computer; any variant id works. `npm run db:seed:qa` loads profiles,
finished games and a watch feed.

## Checks

Run the ones that match your change.

```bash
npm run verify -- --changed   # tests reached by your diff
npm run check:drift           # doc links, SQL enum drift, payload guards
npm run i18n:check            # translation catalogs
npm run ci:quick
npm test
npm run test:persistent       # against local Postgres
```

## Pull requests

- Keep each one focused. A bug fix comes with a test that fails before it and
  passes after.
- Rules and visibility tests live in `packages/game`.
- Anything the server sends gets a test that the payload carries nothing its
  recipient may not see.
- English is the source copy; [docs/translations.md](docs/translations.md) covers
  the other languages.
- No secrets, private credentials or generated data.

## Sign-off

By contributing you certify that you have the right to submit the work under
AGPL-3.0-or-later ([Developer Certificate of Origin](https://developercertificate.org/)).
Add a sign-off line to non-trivial commits.

```text
Signed-off-by: Your Name <you@example.com>
```

A merged contribution carries no commit access or ownership of the project; see
[GOVERNANCE.md](GOVERNANCE.md).
