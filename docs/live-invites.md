# Directed real-time invites (lifecycle API)

These polling endpoints require an account session and persistence. Pending
invites are process-local: a restart forgets them. Acceptance is deliberately
unavailable in this slice; no endpoint creates a room or issues seat credentials.

| Request | Behavior |
| --- | --- |
| `POST /api/live-invites/heartbeat` | Renew a 15-second reachability lease; returns `leaseMs` and `pollAfterMs` |
| `DELETE /api/live-invites/heartbeat` | Revoke the account's lease immediately |
| `POST /api/live-invites` | Create a directed invite; returns `201 { invite }` |
| `GET /api/live-invites` | Return the session's pending `incoming` and `outgoing` arrays and `pollAfterMs` |
| `GET /api/live-invites/:id` | Inspect an invite, including its retained terminal status, as either participant |
| `DELETE /api/live-invites/:id` | Cancel as sender |
| `POST /api/live-invites/:id/decline` | Decline as target |
| `POST /api/live-invites/:id/accept` | Always unavailable (`501` to participants, `404` to others) |

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
only controls notifications. The settings UI follows separately.

An invite lasts 60 seconds. There may be at most three pending invites involving
an account, counting both directions. There may be only one pending invite per
unordered account pair, regardless of terms. Five creation attempts per minute
per sender are allowed, including rejected sends; excess attempts return `429`
with `Retry-After: 60`. The process retains at most 2,000 offers and 2,000 active
sender buckets, and at most 10,000 heartbeat leases. Capacity refuses new work;
it never evicts a pending invite. Terminal outcomes (`cancelled`, `declined`,
`expired`, `unavailable`) are retained for up to five minutes, with earlier
eviction permitted under capacity pressure. Expiry and retention prune on access.

Only participants can read or mutate an invite. Unauthorized inspection,
cancellation or decline returns `404`. Polling views allowlist public names,
handles, terms and lifecycle metadata; they carry no internal account ids,
email, preferences, board state or seat tokens. Every view has `canAccept: false`.
