# Documentation Map

Public, contributor-safe docs for Mistboard: architecture and rules. Kept small
and evergreen. Day-to-day status and detailed planning aren't tracked here (live
state is the site plus
[GitHub issues](https://github.com/brianhliou/mistboard/issues)); keep provider
setup, tokens, and internal strategy in the git-ignored `docs-private/`.

## Start Here

| Document | Use it for |
|---|---|
| [../README.md](../README.md) | Product overview and quick start. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Contributor scope, local dev, tests, and PRs. |
| [project-direction.md](project-direction.md) | Product focus, licensing, brand, and contribution fit. |

## Architecture

| Document | Use it for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Package layout, state model, and the hidden-information boundary. |
| [persistence.md](persistence.md) | Event log, game aggregates, and Postgres setup. |
| [engine-protocol.md](engine-protocol.md) | Redacted engine request/response contract. |
| [translations.md](translations.md) | Locale policy: English source contract, domain ownership, and critical-key coverage. |
| [xiangqi-broadcast-track.md](xiangqi-broadcast-track.md) | Xiangqi tournament broadcasts: architecture, sources, and local testing. |

## Rules

Player-facing rules for every live variant are published at
[mistboard.com/rules](https://mistboard.com/rules). The canonical rule logic and
regression tests live in `packages/game`.
