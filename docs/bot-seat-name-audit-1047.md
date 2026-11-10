# Bot seat name audit (#1047)

Measured on 2026-11-10 using the local web/server pair and the production card components and CSS, after document.fonts.ready. This inventory includes every registry/profile engine accepted by a tenant's seat predicate, all profile attribution IDs, web picker labels and all playable legacy chess engines, regardless of feature flags. It is not a claim about which variants are launched.

## Result

Three Kingdoms Banqi now uses `Misty level N` (levels 1–8, 13 characters) or `Misty` (historical no-level engine, 5). The internal `THREE_KINGDOMS_BANQI_ENGINE_NAME` stays `MistyThreeKingdomsBanqi` (23). Banqi's three retired aliases still accepted on reconnect resolved to `MistyBanqi Level 7` (18); their seat display function now returns `Misty Level 7` (13), as it does for the current ladder. Engine/tier descriptions and third-party names are preserved.

## Measured limit

| Viewport | Live card, BOT + 10:00 | Finished card | Game meta card, BOT + score 1 |
| --- | ---: | ---: | ---: |
| 360 × 800 | 173.94px | 113.50px | 214.31px |
| 1440 × 900 | 106.94px at the live grid's 250px card minimum | 139.66px | 197.19px |

The guard uses **106px**, rounded down from the measured 106.9375px live name slot, at the largest card name font (600 13.6px Noto Sans). The finished cards use 12.48px; meta cards use 13px. There is no universal character-count limit in a proportional font: twelve W characters exceed this budget; twelve i characters fit. The current Misty labels have at most 13 characters; `Misty Level 8` measures about 85.4px and `Misty level 8` about 81.8px at 13.6px. The test records measured printable-ASCII advances and charges unknown glyphs one em.

The desktop live measurement constrains the real grid track to its CSS minimum of 250px; the phone uses its natural layout. Meta measurements use the real card with the BOT badge, ink disc and final score present. Finished thumbnails have no BOT badge or score in their player row. These are component fixtures, not production data.

## Finished games and hover text

Names are written at game end: `variant-tenant/events.ts:tenantParticipant` → `persistence-games.ts:recordGameEnd` → `game_participants.display_name`. Reads use `attachGameParticipants` and `persistedSeatDisplayName`. Its existing tier-label mapping applies to `subjectType: bot` participants with an engine ID; Three Kingdoms seats are `engine-version` participants and keep the stored name. **Old Three Kingdoms games keep the long name.** No stored row or migration is changed. New games use the short name. The client has no Three Kingdoms ID-to-name override.

Live cards already have a title on their name element. This change adds the full displayed name to the finished-thumbnail, profile-list and shared game-meta name elements too, so recorded long names remain readable on hover. It does not rename engine pages, bot profiles or article content.

## Unique supported seat labels

Each level is spelled out below; character counts include spaces. See the next table for the variants and engine IDs.

| Seat name | Characters |
| --- | ---: |
| AB-JChess | 9 |
| Fairy-Stockfish Level 1 | 23 |
| Fairy-Stockfish Level 2 | 23 |
| Fairy-Stockfish Level 3 | 23 |
| Fairy-Stockfish Level 4 | 23 |
| Fairy-Stockfish Level 5 | 23 |
| Fairy-Stockfish Level 6 | 23 |
| Fairy-Stockfish Level 7 | 23 |
| Fairy-Stockfish Level 8 | 23 |
| General Blunder | 15 |
| jqe | 3 |
| KataGo | 6 |
| Mahjong bot | 11 |
| Misty | 5 |
| Misty level 1 | 13 |
| Misty Level 1 | 13 |
| Misty level 2 | 13 |
| Misty Level 2 | 13 |
| Misty level 3 | 13 |
| Misty Level 3 | 13 |
| Misty level 4 | 13 |
| Misty Level 4 | 13 |
| Misty level 5 | 13 |
| Misty Level 5 | 13 |
| Misty level 6 | 13 |
| Misty Level 6 | 13 |
| Misty level 7 | 13 |
| Misty Level 7 | 13 |
| Misty level 8 | 13 |
| Misty Level 8 | 13 |
| Pikafish | 8 |
| Pikafish Level 1 | 16 |
| Pikafish Level 2 | 16 |
| Pikafish Level 3 | 16 |
| Pikafish Level 4 | 16 |
| Pikafish Level 5 | 16 |
| Pikafish Level 6 | 16 |
| Pikafish Level 7 | 16 |
| Pikafish Level 8 | 16 |
| Random Mover | 12 |
| Rapfi Level 1 | 13 |
| Rapfi Level 2 | 13 |
| Rapfi Level 3 | 13 |
| Rapfi Level 4 | 13 |
| Rapfi Level 5 | 13 |
| Rapfi Level 6 | 13 |
| Rapfi Level 7 | 13 |
| Rapfi Level 8 | 13 |

## Per-engine sweep

Raw registry descriptions are included to distinguish engine identity from player-facing seat labels. For example, a Flip Jungle tier keeps its internal description but the seat is Misty Level N.

| Variant | Engine client ID | Resolved seat name | Characters | Raw registry name | Characters |
| --- | --- | --- | ---: | --- | ---: |
| mahjong | mahjong-efficiency (aggregate picker ID) | Mahjong bot | 11 | Mahjong bot (picker) | 11 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-1 | Fairy-Stockfish Level 1 | 23 | Fairy-Stockfish Level 1 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-2 | Fairy-Stockfish Level 2 | 23 | Fairy-Stockfish Level 2 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-3 | Fairy-Stockfish Level 3 | 23 | Fairy-Stockfish Level 3 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-4 | Fairy-Stockfish Level 4 | 23 | Fairy-Stockfish Level 4 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-5 | Fairy-Stockfish Level 5 | 23 | Fairy-Stockfish Level 5 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-6 | Fairy-Stockfish Level 6 | 23 | Fairy-Stockfish Level 6 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-7 | Fairy-Stockfish Level 7 | 23 | Fairy-Stockfish Level 7 | 23 |
| atomic-xiangqi | fairy-stockfish-atomic-xiangqi-level-8 | Fairy-Stockfish Level 8 | 23 | Fairy-Stockfish Level 8 | 23 |
| banqi | misty-banqi | Misty Level 7 | 13 | MistyBanqi | 10 |
| banqi | misty-banqi-amateur | Misty Level 7 | 13 | MistyBanqi - Amateur | 20 |
| banqi | misty-banqi-level-1 | Misty Level 1 | 13 | MistyBanqi Level 1 | 18 |
| banqi | misty-banqi-level-2 | Misty Level 2 | 13 | MistyBanqi Level 2 | 18 |
| banqi | misty-banqi-level-3 | Misty Level 3 | 13 | MistyBanqi Level 3 | 18 |
| banqi | misty-banqi-level-4 | Misty Level 4 | 13 | MistyBanqi Level 4 | 18 |
| banqi | misty-banqi-level-5 | Misty Level 5 | 13 | MistyBanqi Level 5 | 18 |
| banqi | misty-banqi-level-6 | Misty Level 6 | 13 | MistyBanqi Level 6 | 18 |
| banqi | misty-banqi-level-8 | Misty Level 8 | 13 | MistyBanqi Level 8 | 18 |
| banqi | misty-banqi-strong | Misty Level 7 | 13 | MistyBanqi - Strong | 19 |
| banqi | misty-banqi-strongest | Misty Level 7 | 13 | MistyBanqi - Strongest | 22 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-1 | Fairy-Stockfish Level 1 | 23 | Fairy-Stockfish Level 1 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-2 | Fairy-Stockfish Level 2 | 23 | Fairy-Stockfish Level 2 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-3 | Fairy-Stockfish Level 3 | 23 | Fairy-Stockfish Level 3 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-4 | Fairy-Stockfish Level 4 | 23 | Fairy-Stockfish Level 4 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-5 | Fairy-Stockfish Level 5 | 23 | Fairy-Stockfish Level 5 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-6 | Fairy-Stockfish Level 6 | 23 | Fairy-Stockfish Level 6 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-7 | Fairy-Stockfish Level 7 | 23 | Fairy-Stockfish Level 7 | 23 |
| crazyhouse-xiangqi | fairy-stockfish-crazyhouse-xiangqi-level-8 | Fairy-Stockfish Level 8 | 23 | Fairy-Stockfish Level 8 | 23 |
| dark-chess | python-dmx-v1.0 | Misty | 5 |  |  |
| dark-chess | python-v2-v1.0 | Misty | 5 | Misty 1.0 | 9 |
| dark-chess | python-v2-v1.1 | Misty | 5 | Misty 1.1 | 9 |
| dark-chess | python-v2-v1.2 | Misty | 5 | Misty 1.2 | 9 |
| dark-chess | python-v2-v1.3 | Misty | 5 | Misty 1.3 | 9 |
| dark-chess | python-v2-v1.4 | Misty | 5 | Misty 1.4 | 9 |
| dark-chess | python-v2-v1.5 | Misty | 5 | Misty 1.5 | 9 |
| dark-chess | python-v2-v1.6 | Misty | 5 | Misty 1.6 | 9 |
| dark-xiangqi | python-fdx-v1.0 | Misty | 5 | Misty DXQ 1.0 | 13 |
| dark-xiangqi | python-fdx-v1.1 | Misty | 5 | Misty DXQ 1.1 | 13 |
| dark-xiangqi | python-fdx-v1.2 | Misty | 5 | Misty DXQ 1.2 | 13 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-1 | Fairy-Stockfish Level 1 | 23 | Fairy-Stockfish Level 1 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-2 | Fairy-Stockfish Level 2 | 23 | Fairy-Stockfish Level 2 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-3 | Fairy-Stockfish Level 3 | 23 | Fairy-Stockfish Level 3 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-4 | Fairy-Stockfish Level 4 | 23 | Fairy-Stockfish Level 4 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-5 | Fairy-Stockfish Level 5 | 23 | Fairy-Stockfish Level 5 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-6 | Fairy-Stockfish Level 6 | 23 | Fairy-Stockfish Level 6 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-7 | Fairy-Stockfish Level 7 | 23 | Fairy-Stockfish Level 7 | 23 |
| duck-xiangqi | fairy-stockfish-duck-xiangqi-level-8 | Fairy-Stockfish Level 8 | 23 | Fairy-Stockfish Level 8 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-amateur | Fairy-Stockfish Level 2 | 23 |  |  |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-1 | Fairy-Stockfish Level 1 | 23 | Fairy-Stockfish Level 1 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-2 | Fairy-Stockfish Level 2 | 23 | Fairy-Stockfish Level 2 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-3 | Fairy-Stockfish Level 3 | 23 | Fairy-Stockfish Level 3 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-4 | Fairy-Stockfish Level 4 | 23 | Fairy-Stockfish Level 4 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-5 | Fairy-Stockfish Level 5 | 23 | Fairy-Stockfish Level 5 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-6 | Fairy-Stockfish Level 6 | 23 | Fairy-Stockfish Level 6 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-7 | Fairy-Stockfish Level 7 | 23 | Fairy-Stockfish Level 7 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-level-8 | Fairy-Stockfish Level 8 | 23 | Fairy-Stockfish Level 8 | 23 |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-strong | Fairy-Stockfish Level 5 | 23 |  |  |
| fortress-xiangqi | fairy-stockfish-fortress-xiangqi-very-strong | Fairy-Stockfish Level 8 | 23 |  |  |
| gomoku | rapfi-level-1 | Rapfi Level 1 | 13 |  |  |
| gomoku | rapfi-level-2 | Rapfi Level 2 | 13 |  |  |
| gomoku | rapfi-level-3 | Rapfi Level 3 | 13 |  |  |
| gomoku | rapfi-level-4 | Rapfi Level 4 | 13 |  |  |
| gomoku | rapfi-level-5 | Rapfi Level 5 | 13 |  |  |
| gomoku | rapfi-level-6 | Rapfi Level 6 | 13 |  |  |
| gomoku | rapfi-level-7 | Rapfi Level 7 | 13 |  |  |
| gomoku | rapfi-level-8 | Rapfi Level 8 | 13 |  |  |
| jieqi | ab-jchess-jieqi | AB-JChess | 9 | AB-JChess | 9 |
| jieqi | jqe-jieqi | jqe | 3 | jqe | 3 |
| jieqi | pikafish-jieqi-amateur | Pikafish | 8 | PikaJieQi - Amateur | 19 |
| jieqi | pikafish-jieqi-level-1 | Pikafish Level 1 | 16 | Pikafish Level 1 | 16 |
| jieqi | pikafish-jieqi-level-2 | Pikafish Level 2 | 16 | Pikafish Level 2 | 16 |
| jieqi | pikafish-jieqi-level-3 | Pikafish Level 3 | 16 | Pikafish Level 3 | 16 |
| jieqi | pikafish-jieqi-level-4 | Pikafish Level 4 | 16 | Pikafish Level 4 | 16 |
| jieqi | pikafish-jieqi-level-5 | Pikafish Level 5 | 16 | Pikafish Level 5 | 16 |
| jieqi | pikafish-jieqi-level-6 | Pikafish Level 6 | 16 | Pikafish Level 6 | 16 |
| jieqi | pikafish-jieqi-level-7 | Pikafish Level 7 | 16 | Pikafish Level 7 | 16 |
| jieqi | pikafish-jieqi-strong | Pikafish | 8 | PikaJieQi - Strong | 18 |
| jieqi | pikafish-jieqi-strongest | Pikafish Level 8 | 16 | Pikafish Level 8 | 16 |
| jungle-flip | misty-jungle-flip | Misty Level 7 | 13 | MistyJungleFlip | 15 |
| jungle-flip | misty-jungle-flip-level-1 | Misty Level 1 | 13 | MistyJungleFlip Level 1 | 23 |
| jungle-flip | misty-jungle-flip-level-2 | Misty Level 2 | 13 | MistyJungleFlip Level 2 | 23 |
| jungle-flip | misty-jungle-flip-level-3 | Misty Level 3 | 13 | MistyJungleFlip Level 3 | 23 |
| jungle-flip | misty-jungle-flip-level-4 | Misty Level 4 | 13 | MistyJungleFlip Level 4 | 23 |
| jungle-flip | misty-jungle-flip-level-5 | Misty Level 5 | 13 | MistyJungleFlip Level 5 | 23 |
| jungle-flip | misty-jungle-flip-level-6 | Misty Level 6 | 13 | MistyJungleFlip Level 6 | 23 |
| jungle-flip | misty-jungle-flip-level-7 | Misty Level 7 | 13 | MistyJungleFlip Level 7 (retired) | 33 |
| jungle-flip | misty-jungle-flip-level-8 | Misty Level 8 | 13 | MistyJungleFlip Level 8 | 23 |
| jungle | katago-jungle | KataGo | 6 |
| Mahjong bot | 11 | KataGo | 6 |
| jungle | misty-jungle-level-1 | Misty | 5 | Misty Jungle level 1 | 20 |
| jungle | misty-jungle-level-2 | Misty | 5 | Misty | 5 |
| jungle | misty-jungle-level-3 | Misty | 5 | Misty Jungle level 3 | 20 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi | Misty | 5 | Misty | 5 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-1 | Misty level 1 | 13 | Misty level 1 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-2 | Misty level 2 | 13 | Misty level 2 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-3 | Misty level 3 | 13 | Misty level 3 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-4 | Misty level 4 | 13 | Misty level 4 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-5 | Misty level 5 | 13 | Misty level 5 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-6 | Misty level 6 | 13 | Misty level 6 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-7 | Misty level 7 | 13 | Misty level 7 | 13 |
| three-kingdoms-banqi | misty-three-kingdoms-banqi-level-8 | Misty level 8 | 13 | Misty level 8 | 13 |
| xiangqi-mahjong | misty-xiangqi-mahjong | Misty | 5 |  |  |
| xiangqi | fairy-stockfish-xiangqi-level-1 | Fairy-Stockfish Level 1 | 23 | Fairy-Stockfish Level 1 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-2 | Fairy-Stockfish Level 2 | 23 | Fairy-Stockfish Level 2 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-3 | Fairy-Stockfish Level 3 | 23 | Fairy-Stockfish Level 3 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-4 | Fairy-Stockfish Level 4 | 23 | Fairy-Stockfish Level 4 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-5 | Fairy-Stockfish Level 5 | 23 | Fairy-Stockfish Level 5 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-6 | Fairy-Stockfish Level 6 | 23 | Fairy-Stockfish Level 6 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-7 | Fairy-Stockfish Level 7 | 23 | Fairy-Stockfish Level 7 | 23 |
| xiangqi | fairy-stockfish-xiangqi-level-8 | Fairy-Stockfish Level 8 | 23 | Fairy-Stockfish Level 8 | 23 |
| xiangqi | fairy-stockfish-xiangqi-worst | General Blunder | 15 | General Blunder | 15 |
| xiangqi | pikafish-xiangqi-amateur | Pikafish | 8 | Pikafish - Amateur | 18 |
| xiangqi | pikafish-xiangqi-level-1 | Pikafish | 8 | Pikafish - Level 1 | 18 |
| xiangqi | pikafish-xiangqi-level-2 | Pikafish | 8 | Pikafish - Level 2 | 18 |
| xiangqi | pikafish-xiangqi-level-3 | Pikafish | 8 | Pikafish - Level 3 | 18 |
| xiangqi | pikafish-xiangqi-level-4 | Pikafish | 8 | Pikafish - Level 4 | 18 |
| xiangqi | pikafish-xiangqi-level-5 | Pikafish | 8 | Pikafish - Level 5 | 18 |
| xiangqi | pikafish-xiangqi-level-6 | Pikafish | 8 | Pikafish - Level 6 | 18 |
| xiangqi | pikafish-xiangqi-level-7 | Pikafish | 8 | Pikafish - Level 7 | 18 |
| xiangqi | pikafish-xiangqi-level-8 | Pikafish | 8 | Pikafish | 8 |
| xiangqi | pikafish-xiangqi-strong | Pikafish | 8 | Pikafish - Strong | 17 |
| xiangqi | pikafish-xiangqi-strongest | Pikafish | 8 | Pikafish - Strongest | 20 |
| xiangqi | random-legal-xiangqi | Random Mover | 12 | Random Mover | 12 |

## Third-party names above the measured budget

At 600 13.6px Noto Sans, Fairy-Stockfish Level 1–8 (23 characters, about 146.5px) exceed 106px. General Blunder (15, about 107.9px), a Fairy-Stockfish persona, is also just over the live minimum. They are preserved. The pre-existing card-only Fairy-Stockfish abbreviation remains FSF Level N (11); this change introduces no third-party rename. AB-JChess (9), jqe (3), KataGo (6), Pikafish (8), Pikafish Level 1–8 (16, about 101.6px) and Rapfi Level 1–8 (13) fit.

## Other registry descriptions

These are calibration-only, local development or archived identities not accepted by a tenant seat predicate or selected by the ordinary live roster, and not mapped to a current bot persona. They are inventoried but are not supported bot tiers in the fit guard. Historical stored names remain intact.

| Engine client ID | Registry description | Characters |
| --- | --- | ---: |
| builtin-capture-seeker | Capture Seeker v1 | 17 |
| builtin-random-legal | Misty Random | 12 |
| python-random-legal | Random Legal Python v1 | 22 |
| python-tier1-current | Mistboard Engine dev build | 26 |
| python-tier1-v0.7.0 | Mistboard Engine preview | 24 |
| python-tier1-v0.7.22 | Mistboard Engine preview | 24 |
| python-tier1-v0.8.9 | Mistboard Engine preview | 24 |
| python-tier1-v0.9.1 | Mistboard Engine preview | 24 |
| python-tier1-v0.9.5 | Misty Legacy | 12 |
| python-v2-adaptive | Misty (King-floor · v1.1-rc5) | 29 |
| python-v2-current | Mistboard Engine v2 dev build | 29 |
| python-v2-faithful | Misty (Faithful · Resolve) | 26 |
| python-v2-kingsafe | Misty (King-safe · v1.1-rc2) | 28 |
| python-v2-nocarry | Misty (No-carry · v1.1-rc6) | 27 |
| python-v2-strongest | Misty (Strongest · gadget-off) | 30 |
| random-legal-atomic-xiangqi | Random Mover | 12 |
| random-legal-banqi | Random legal (Banqi) | 20 |
| random-legal-crazyhouse-xiangqi | Random Mover | 12 |
| random-legal-duck-xiangqi | Random Mover | 12 |
| random-legal-fortress-xiangqi | Random Mover | 12 |
| random-legal-jieqi | Random Mover | 12 |
| random-legal-jungle-flip | Random legal (Flip Jungle) | 26 |

## Verification

The registry-driven fit test failed before the fix on all nine Three Kingdoms IDs and the three Banqi aliases. It passes after the fix and separately rejects a planted overlong name on the actual Three Kingdoms level-7 ID. It enumerates server engine IDs, registered runtime predicates, bot profiles/attribution and web picker IDs, rather than keeping a variant/tier list. Picker IDs that are not native seat client IDs (such as Mahjong’s aggregate bot) still have their picker labels checked. Third-party engine families are explicitly exempt from renaming.

Targeted checks: server three-kingdoms-banqi-ladder.test.ts and banqi-engine.test.ts; web bot-seat-name-fit.test.ts, current-games-seat-names.test.ts, profile-ui.test.ts and review/game-meta-card.test.ts. Native-engine opt-in tests are skipped when their local binaries/nets are unavailable. Biome runs on every changed TypeScript file.
