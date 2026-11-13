# Sending xiangqi games to a Mistboard broadcast

A device or app that records xiangqi games, such as an electronic clock or a
scoring app, can send each game to a Mistboard broadcast while it is played.
After every move, the device posts the whole game so far to one URL. Viewers
on [mistboard.com/broadcast/xiangqi](https://mistboard.com/broadcast/xiangqi)
see the move within about two seconds.

## Getting a token

Write to contact@mistboard.com with the event's name, dates and number of
boards. We create the event and send you a token for it. The token can write
only to that event.

For development we issue a test token. It writes to a test event that is not
listed on the site and is not indexed by search engines; you open its boards
by their links. The API behaves the same for both kinds of token.

Keep the token out of logs and source control. If one leaks, tell us and we
revoke it and issue another.

## Posting a game

```
POST https://mistboard.com/api/xiangqi/broadcast-push
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "round": 3,
  "board": 12,
  "red": { "name": "Red Master", "federation": "SGP" },
  "black": { "name": "Black Master", "federation": "MAS" },
  "notation": "iccs",
  "moves": ["h2e2", "h9g7", "h0g2", "i9h9"],
  "status": "live",
  "clock": { "red": 1712000, "black": 1695000 },
  "seq": 4
}
```

With curl:

```sh
curl -sS https://mistboard.com/api/xiangqi/broadcast-push \
  -H "Authorization: Bearer $MISTBOARD_PUSH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"round":1,"board":1,"red":{"name":"Red player"},"black":{"name":"Black player"},"notation":"iccs","moves":["h2e2","h9g7"],"status":"live","seq":2}'
```

The first post for a round and board creates the game; later posts update it.

| Field | Required | Meaning |
|---|---|---|
| `round` | yes | Round number (1, 2, ...) or a round id we gave you, such as `women-r3`. |
| `board` | yes | Board number within the round, 1 or more. |
| `red`, `black` | on the first post | `name` (required), `federation` (optional, a three-letter code such as `CHN`), `title` (optional). |
| `moves` | yes | The whole game so far: an array of moves, or one string with the moves separated by spaces. An empty array is a game that has not started. |
| `notation` | recommended | `iccs`, `wxf` or `chinese`. Without it we detect the notation from the moves, and the first few moves of a game can read two ways. |
| `status` | yes | `live` while the game is played, `finished` once it ends. |
| `result` | when finished | `1-0` (red won), `0-1` (black won) or `1/2-1/2`. |
| `clock` | no | Time left on each side after the last move, in milliseconds: `{ "red": 1712000, "black": 1695000 }`. |
| `timeControl` | no | The time control as you would print it, such as `"90+30"`. |
| `seq` | recommended | A counter that goes up by one with every post for this game. A move count does not work, because it goes down on a takeback. See [Retries and corrections](#retries-and-corrections). |

### Notation

| `notation` | First move, cannon to the centre | Notes |
|---|---|---|
| `iccs` | `h2e2` | Files `a` to `i` from red's left, ranks `0` to `9` from red's side. Also accepted with a dash (`h2-e2`). |
| `wxf` | `C2.5` | Piece letters `K A E H R C P`, red files counted from red's right. |
| `chinese` | `炮二平五` | Red files in Chinese numerals, black files in digits (`马8进7`). |

Moves start from the standard opening position.

### A PGN body

Instead of JSON, the body can be a PGN with `Content-Type: application/x-chess-pgn`:

```
[Round "3"]
[Board "12"]
[Red "Red Master"]
[Black "Black Master"]
[Result "*"]

1. h2e2 h9g7 2. h0g2 i9h9 *
```

`[Result "*"]` is a live game; `1-0`, `0-1` or `1/2-1/2` ends it. `[White]`
is read as red when there is no `[Red]` tag. One body can hold several games,
separated by a blank line.

## Responses

A post that is accepted returns `200`:

```json
{
  "ok": true,
  "changed": true,
  "corrected": false,
  "stale": false,
  "game": {
    "round": "r3",
    "board": 12,
    "plies": 4,
    "status": "live",
    "result": "*",
    "url": "https://mistboard.com/broadcast/xiangqi/board/<event>-r3-b12"
  },
  "notation": "iccs"
}
```

`changed` is false when the post matched what we already had. A PGN body
returns `{ "ok": true, "games": [ ... ] }` with one entry per game.

Errors return `{ "ok": false, "error": "<code>", "message": "..." }`:

| Status | `error` | What to do |
|---|---|---|
| 400 | `invalid_body` | Fix the field named in `message`. |
| 401 | `unauthorized` | The token is missing or wrong. |
| 403 | `token_revoked` | Ask us for a new token. |
| 409 | `event_not_pushable` | The event is filled from another source; ask us. |
| 413 | `too_large` | The body is over 64 KB or the game over 1,000 moves. |
| 422 | `illegal_move` | `ply` and `move` say which move failed. Moves before it were not saved either. |
| 422 | `unknown_notation` | No notation reads the moves. Set `notation`. |
| 422 | `unsupported_start_position` | A PGN `[FEN]` tag named a position other than the standard opening. |
| 429 | `rate_limited` | Wait for the `Retry-After` header's seconds, then send the latest game. |

Retry a `5xx` or a network error with the latest game, waiting a little longer
each time. Do not retry a `4xx` other than `429` without changing the post.

## Retries and corrections

What a post does depends on how it compares with our copy of the game.

- The same game twice changes nothing, so a retry is always safe.
- A lower `seq` than a post we already accepted: an old post that arrived
  late. We ignore it and answer `"stale": true`.
- More moves than we have: the new moves are added.
- A different move in the middle, such as an arbiter's correction: the
  posted game replaces ours, and the response says `"corrected": true`.
- Fewer moves than we have: this is either a takeback or an old retry that
  arrived late. With `seq` higher than the last accepted post we treat it as a
  takeback and save it; without `seq`, or with a lower one, we ignore it and
  answer `"stale": true`.
- A finished game stays finished. A later post with the same moves changes
  nothing; a post with a higher `seq` can still correct it.

Send `seq` and these cases sort themselves out.

## Limits

- 2 posts a second per board, 50 a second per token.
- 64 KB per body, 1,000 moves per game.

## Checking a token

```
GET https://mistboard.com/api/xiangqi/broadcast-push/status
Authorization: Bearer <token>
```

returns the event the token writes to, whether it is a test event, and its
rounds and boards so far. It writes nothing.

## Trying it without a device

From a checkout of the [Mistboard repository](https://github.com/brianhliou/mistboard),
this replays a recorded game one move every two seconds against the API:

```sh
npm run broadcast:push-sim -- --url https://mistboard.com --token-file ./push-token --pgn game.pgn --round 1 --board 1 --interval-ms 2000
```

It is also a working client to read alongside this page.

## Changes to this API

We will add fields but not rename or remove them, and a change that would
break a client gets a new URL. Changes are listed in the
[changelog](https://mistboard.com/changelog).
