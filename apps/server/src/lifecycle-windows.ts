// Pregame-abort and disconnect-forfeit windows, shared by both live-room
// stacks: the legacy chess `room-manager` and the generic `variant-tenant`
// runtime. Kept in a neutral leaf so the reusable tenant layer does not have to
// import a game-lifecycle constant from the legacy chess stack (the only edge
// that coupled the two) — and so the eventual room-manager removal can't take
// the constant with it.

// How long the side to move has to play their first move before the game is
// auto-aborted. One window for white's move 1, then a fresh one for black's.
export const ABORT_WINDOW_MS = 30_000;

// How long a room whose seats are not all filled stays open before it is
// auto-aborted. This is the "shared an invite link, nobody came" window, and it
// is deliberately much longer than ABORT_WINDOW_MS: waiting for a friend to
// click a link is normal, waiting 30 seconds for them is not a game. Matches
// the durable guest-prestart policy default so the two agree.
export const JOIN_WINDOW_MS = 15 * 60_000;

// How long a disconnected player has to return before forfeiting an
// in-progress game (post-move-1). Reconnecting within the window cancels it.
// Only reachable while PVP_DISCONNECT_FORFEIT_ENABLED is true; PvE never
// forfeits a disconnect at all (see tenantForfeitingSeat / forfeitingSeat).
export const FORFEIT_WINDOW_MS = 30_000;

// The human-opponent half of the same question, OFF since 2026-09-22 (#436).
// Brian, that day: "maybe against players we'll implement abandonment, but keep
// it off for players too for now. we might turn it back on if there's
// measurement justifying it."
//
// The PvE case is settled on its own merits above. This is the weaker one: a
// waiting opponent is a real person, so a leaver does owe them an ending. But
// the ending we were giving them was reached by a socket close, and the server
// has no ws heartbeat, so on mobile that fires when the tab suspends, not when
// the player leaves. A clocked game already ends itself while someone is away:
// the clock runs through the disconnect and the absent seat flags, which is
// what happens at a physical board too.
//
// What would justify turning it back on: a waiting player saying the wait is
// the problem, or a measured rate of PvP games left unfinished. Neither exists
// -- clocked PvP is 8 completed games since launch. Until then, nobody loses a
// game because a connection dropped.
//
// Cost, accepted: an UNTIMED PvP game whose players both leave has no in-memory
// reaper left (11 completed untimed PvP games since launch, 6 of which ended by
// this forfeit). It is bounded -- the create route defaults a time control
// rather than yielding a clockless room (variant-tenant/rooms-route.ts), and an
// old clockless room hydrating after a restart lands in `paused` for the 24 h
// stale-paused sweep. See the reaper-coverage matrix.
export const PVP_DISCONNECT_FORFEIT_ENABLED = false;
