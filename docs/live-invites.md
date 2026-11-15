# Directed real-time invites (lifecycle API)

These polling endpoints require an account session and persistence. Pending
invites are process-local: a restart forgets them. Acceptance creates a durable
live room with both account seats reserved before returning success. Players
reclaim their own seat by signing in; this API issues no seat credentials.

| Request | Behavior |
| --- | --- |
| `POST /api/live-invites/heartbeat` | Renew a 15-second reachability lease; returns `leaseMs` and `pollAfterMs` |
| `DELETE /api/live-invites/heartbeat` | Revoke the account's lease immediately |
| `POST /api/live-invites` | Create a directed invite; returns `201 { invite }` |
| `GET /api/live-invites` | Return the session's pending, accepting and retained accepted `incoming` and `outgoing` arrays and `pollAfterMs` |
| `GET /api/live-invites/:id` | Inspect an invite, including its retained terminal status, as either participant |
| `DELETE /api/live-invites/:id` | Cancel as sender |
| `POST /api/live-invites/:id/decline` | Decline as target |
| `POST /api/live-invites/:id/accept` | Accept as target; returns `200 { invite }` with the target's own room URL and seat |

Mutations require same-origin browser requests; POST bodies use
`Content-Type: application/json`. Heartbeat POSTs may send `{}`. All responses
are `Cache-Control: no-store`. Poll and heartbeat every five seconds while ready
to receive invites. Merely browsing or holding a game socket does not renew this
lease. Sending an invite renews the sender's lease; list/inspect requests do not.
Explicit lease revocation applies to all tabs for the account.

Creation body:

```json
{
  "targetHandle": "opponent",
  "gameSpecId": "xiangqi",
  "timeControl": { "initialMs": 180000, "incrementMs": 2000 },
  "preferredColor": "random",
  "rated": false
}
```

`preferredColor` is move order (`first`, `second`, `random`), defaulting to
`random`. `rated` defaults to `false`. Variants must have an enabled live lobby
capability (or be the legacy Fog Chess stack); they retain their existing access,
clock and rating gates. Invitations cannot open an unlaunched game surface.

Either follow direction establishes eligibility. Blocks in either direction,
closed accounts, play locks, an expired target lease, an occupied real-time seat,
or a target opt-out refuse a send with `409 target_unavailable`, without exposing
the reason. Disconnected seat holders count as busy; correspondence games and
spectators do not. Pending reads recheck both participants, their leases and
current policies; invalidated offers become `unavailable` and leave pending lists.

Set the server-enforced incoming opt-out through the existing preferences API:
`PATCH /api/account/preferences { "liveInvites": false }`. Legacy or malformed
stored values default to `true`. This is independent of `challengesBell`, which
only controls notifications. The saved permission is available under Account settings → Privacy.

An invite lasts 60 seconds. There may be at most three pending invites involving
an account, counting both directions. There may be only one pending invite per
unordered account pair, regardless of terms. Five creation attempts per minute
per sender are allowed, including rejected sends; excess attempts return `429`
with `Retry-After: 60`. The process retains at most 2,000 offers and 2,000 active
sender buckets, and at most 10,000 heartbeat leases. Capacity refuses new work;
it never evicts a pending invite. Terminal outcomes (`cancelled`, `declined`,
`expired`, `unavailable`, `accepted`) are retained for up to five minutes, with earlier
eviction permitted under capacity pressure. Expiry and retention prune on access.

Only participants can read or mutate an invite. Unauthorized inspection,
cancellation or decline returns `404`. Polling views allowlist public names,
handles, terms and lifecycle metadata; they carry no internal account ids,
email, preferences, board state or seat tokens. `canAccept` is true only for the
target of a pending invite.

## Acceptance

The target posts `{}` to `/api/live-invites/:id/accept`. The room uses the
sender's recorded variant, time control, move-order preference and explicit
rated choice. Terms in the acceptance body cannot change the invitation.
Both accounts' current play/rating eligibility, grants, follow/block policy,
target opt-out, reachability, live-seat availability, and the offer expiry are
checked again before creation. Durable seats in unloaded live rooms also count
as busy. Correspondence seats do not.

A successful invitation view adds only:

```json
{
  "status": "accepted",
  "room": { "roomId": "xq_example", "url": "/room/xq_example", "seat": "black" }
}
```

Each participant sees their own seat. The sender discovers the same room
through polling or inspection. No response includes the other seat's authority,
board state, internal account ids, token hashes or raw tokens. On reconnect,
the existing account-seat authorization applies to both live stacks.

Acceptance claims an offer before awaiting creation (`status: "accepting"`).
Competing requests for that offer return `409 invite_unavailable`; requests
sharing either account also cannot create a second game. Cancellation and
decline cannot revoke a claimed creation. Once accepted, a target's repeated
accept returns the same room while the offer is retained. Sender/stranger
accepts return `404`.

Initial room events, both account seat tokens and the running-game record
commit in one database transaction before the room enters its live map. A
failure rolls back the bundle and returns `503 room_create_failed`, releasing
both reservations so an unexpired invite can be retried. Draining returns
`503 server_draining`; unavailable/expired offers return `409 invite_unavailable`.
Offers remain process-local; the accepted game and its seats survive restart.
Existing correspondence creation and eligibility are unchanged.

The shared live factory adapters carry account seating in an async scope
(`account-room.ts`), alongside the existing lobby scope. They reuse each live
tenant's existing lobby binding and the legacy Fog Chess factory, without
adding variants, route registrations or correspondence capabilities. Regression
coverage is in `routes/live-invite-accept.test.ts`, `routes/live-invites.test.ts`
and `live-invites.test.ts`.

## Browser controller

The account navigation bootstraps one `live-invites.ts` controller per document,
including non-game pages. Only resolved signed-in accounts heartbeat and poll;
embedded documents do not initialize account navigation. The controller uses
`leaseMs` and `pollAfterMs` with a maximum five-second polling interval. Each
request is bounded to ten seconds. Incoming cards show the sender's name and
handle, variant, clock, the recipient's side, explicit rated/casual terms and a
remaining-expiry countdown before Accept or Decline.

Sender controls can pass the creation response's `invite` to
`mountLiveInviteWaiting(host, invite)`, which returns an unmount function. The
shared controller keeps tracking after that control unmounts. Known invitations
missing from the pending list are inspected individually for retained decline,
cancellation, expiry or unavailability. Unavailability does not disclose whether
a player opted out, blocked someone, went offline or became busy.

Both participants follow only the server-returned reserved `/room/:id` path on
acceptance. A per-account, per-tab session marker prevents retained acceptance
from redirecting again after reload; an Open game link remains available.
Pending ids survive navigation in session storage and are re-read from the
server before rendering. No board, seat token or hidden game information is
stored by this UI.

Sign-out, account changes and disposal abort requests and clear timers. Stale
polls cannot overwrite completed actions or a different account's state. Each
tab renews the account-wide lease independently; pagehide pauses this document
without revoking other tabs' leases, and pageshow resumes it after a back/forward
cache restore. Cross-tab identity signals trigger a fresh auth read before
resuming. Incoming opt-out and the challenge notification bell remain independent.
