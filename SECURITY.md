# Security

Mistboard runs several hidden-information games (Fog of War, Jieqi, Banqi, Flip Jungle). Security includes ordinary web application security and game-integrity security.

## Report Privately

Do not open a public issue for vulnerabilities.

Report through GitHub's private vulnerability reporting: [open a security advisory](https://github.com/brianhliou/mistboard/security/advisories/new). If you can't use GitHub, write through [mistboard.com/contact](https://mistboard.com/contact) and say you have a security report; don't include exploit details there.

## High-Priority Issues

Report privately if you find:

- hidden pieces or hidden opponent moves sent to the wrong client
- a way to reconstruct hidden state from live payloads
- spectator or replay leakage during a live game
- engine payloads (`EngineTurnRequest` or redacted UCI positions) that reveal hidden truth to engines
- authentication, session, or room-seating bypasses
- unauthorized room control
- production secrets or credentials
- database access or event-log corruption paths
- denial-of-service vectors against live rooms or engine workers

## Security Boundary

The central product invariant:

> The server owns canonical truth. Each client receives only its legal `PlayerView`.

Any code path that sends full board state, hidden moves, hidden legal moves, or reconstructable hidden metadata to the wrong consumer is a security bug, even if the UI hides it afterward.

Live game traffic is private data. WebSocket snapshots, live event history, clocks, and debug payloads must be scoped to the receiving seat or to an explicitly authorized administrator. A room id is not permission to observe a live game.

Full event replay is public only after a game reaches a terminal state. Before then, `/api/games/:roomId/events` and any equivalent replay/export path must reject the request or return only a seat-scoped private view.

Truth/debug views are administrative capability, not a client preference. Production deployments must not enable `devViews`, `views=all`, random-engine truth views, or similar hidden-state inspection paths unless the server has authorized the requester as an administrator.

## Supported Versions

Mistboard is pre-1.0. Security fixes target the current `main` branch and the live `mistboard.com` deployment.

## Disclosure

The maintainer will try to acknowledge serious reports promptly and coordinate a fix before public disclosure. Public credit is welcome if the reporter wants it and disclosure will not harm users.
