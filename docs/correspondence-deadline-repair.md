# Correspondence rooms missing a deadline

Issue #1218 reported four running, zero-ply correspondence rooms without
`room_deadlines` rows on 2026-11-17. A read-only scan of production on
2026-11-18 found seven such rooms: the four reported (dark chess) and three more
(two xiangqi, one Gomoku) that the original games-row query could not see. All
seven are invitations nobody accepted: one seat taken, by a counted account in
the dark chess rooms and by a guest in the other three. None has an enforceable
deadline, so none needs a backfill; whether to abort them is a separate product
call.

The reproducible creation gap is mutual rematch: the registered rematch context
persisted two seat-token reservations without seat-assigned events. Until both
players connected, replay saw an unjoined room and derived no deadline. The fix
records correspondence rematch seating through the same writer used by seek
acceptance, including its deadline maintenance. A new regression reproduces the
failure for every non-retired, rematch-capable correspondence tenant, then
replays the new room without either player connecting.

Public seek acceptance (including quick-pair), directed challenge acceptance and
private-link acceptance share `createTenantCorrespondenceGameForSeek`, which
already writes both assignments and a deadline. Friend-invite rooms intentionally
have no first-move deadline until both seats fill. A running games row at ply
zero alone does not distinguish these cases. Transient deadline-index write
failures are another possible cause because the event writer treats them as
best-effort; this patch does not make that write atomic with the event append.

## Maintainer procedure

Run from the reviewed branch with dependencies built. The default only reads;
production access is through the existing maintainer `prod:db` wrapper:

```sh
npm run prod:db -- --read-only node --import tsx apps/server/src/correspondence-deadline-repair.ts
```

The JSON lines report room id, variant, creation/start/reservation dates, seat
counts, recorded seek-accept provenance and the replay-derived deadline. No
board deals, tokens or account identities are printed. Accepted-seek outcomes
can establish an accept path; reserved seats without assignment events are
consistent with rematch, but cannot prove it. Rematch origin was not persisted.
The scan starts from each room's `room-created` event, not from `games`:
xiangqi, jieqi, banqi, Jungle and fog xiangqi write their games row only when a
game ends. It covers correspondence rooms with no move event, no terminal event
and no index row, whose games row is missing or still a running PvP game.

For each reviewed room whose event log has an enforceable deadline, backfill its
original deadline (including an already elapsed deadline) and let the normal
server sweeper enforce it:

```sh
npm run prod:db -- node --import tsx apps/server/src/correspondence-deadline-repair.ts --backfill --room ROOM_ID
```

When the log has no deadline, the command refuses to invent a seat or restart
the clock. If the maintainer chooses to discard a stranded zero-move room:

```sh
npm run prod:db -- node --import tsx apps/server/src/correspondence-deadline-repair.ts --abort --room ROOM_ID
```

This appends a `game-aborted` / `user-abort` event and marks its games row aborted
in the same transaction. It does not blame an account for stalling when there
was no enforceable deadline. Inspect unfilled invites before aborting: they may
still be valid invitations. Repeat `--room` to select several rooms; every
selected id must still qualify or the whole transaction rolls back. Writes use
a serializable transaction, reject changed/unreplayable logs, and print success
only after commit. An abort does not broadcast to an already connected socket;
the next connection/write resynchronizes from the terminal event. Rerun the
read-only inspection after maintenance to confirm the selected rooms disappeared.

Validation and release review: start with
`apps/server/src/correspondence-rematch-deadline.test.ts`, then the three tenant
plumbing changes and the maintenance command. This is a server-only change;
there is no visual review sheet. Suggested release changelog:
`Fixed: Correspondence rematches start their first-move deadline before players reconnect`
