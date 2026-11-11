# Replay capture orientation regression fixtures

`apps/web/src/replay.test.ts`, under `mountReplay capture rows`, enforces the
shared-orientation rule from `477fb24` and its repeat `746055b`. Every pane's
board and capture rows must agree with the chosen board orientation, regardless
of the pane's player perspective. The tests cover both starting orientations,
button and keyboard flips, immediate redraws, and scrubbing through zero,
one-sided and two-sided captures.

The production fixes are already present. These patches deliberately restore
their bugs in the current renderer so the regression check can be challenged:

| Fixture | Historical behavior restored | Focused result on 2026-11-07 |
| --- | --- | --- |
| `477fb24.patch` | Truth pane leaves its top row empty and puts both sides below; flips omit the capture redraw | 6 failed, 9 skipped; exit 1 |
| `477fb24-stale-flip.patch` | Only the missing button/keyboard redraw from the first bug, with initial placement kept correct | 4 failed, 2 passed, 9 skipped; exit 1 |
| `746055b.patch` | White and Black panes place rows by pane identity while all boards share one orientation | 6 failed, 9 skipped; exit 1 |

The first patch isolates the original truth-row and flip defects while retaining
the later correction to the player panes. The separate stale-flip patch proves
that the interaction assertions fail after a flip, even when initial placement
passes. No subsequent scrub or timer is allowed to repair the rows before the
assertion.

From the repository root, with the workspace dependencies and internal package
builds prepared, run the check:

```sh
node node_modules/vitest/vitest.mjs run --root apps/web src/replay.test.ts src/replay-board.test.ts --maxWorkers=1
```

With the fixed renderer, both files pass: **21 tests**, including all six
capture-orientation cases.

To challenge the check, apply one fixture at a time on a clean renderer:

```sh
git apply tests/fixtures/replay-capture-orientation/477fb24.patch
node node_modules/vitest/vitest.mjs run --root apps/web src/replay.test.ts -t 'mountReplay capture rows' --maxWorkers=1
git apply --reverse tests/fixtures/replay-capture-orientation/477fb24.patch
```

The middle command must exit 1. Always run the reverse command afterward, then
rerun the fixed-renderer check. Substitute either other patch name to reproduce
the remaining cases. The patches are test inputs; never commit their changes to
`apps/web/src/replay.ts`.
