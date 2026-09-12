// Runtime feature flags, read from the environment. Single source of truth so
// server gating and the client toggle (exposed via /api/server-status) can't
// drift apart.

// The rated on-switch. Off by default — setting MISTBOARD_RATED_ENABLED=true in
// the deploy environment is the launch decision that makes rated games both
// creatable (lobby) and selectable (client toggle). Even when on, rated still
// requires a signed-in requester and is account-gated at game end.
//
// Read at call time (not a module-load const) so tests can toggle it before
// booting the server, the same way DATABASE_URL is handled.
export function ratedEnabled(): boolean {
  return process.env.MISTBOARD_RATED_ENABLED === 'true';
}

// Dark Xiangqi is a rules spike, not a public/live mode. Keep every future
// server-side entry point behind this explicit opt-in so adding integration
// code cannot accidentally expose rooms in production.
export function darkXiangqiEnabled(): boolean {
  return process.env.MISTBOARD_DARK_XIANGQI_ENABLED === 'true';
}

// Standard (open-information) Xiangqi live rooms. Server-side opt-in, default
// off — ships flag-off so the tenant exists in prod without opening room
// creation. Flip to MISTBOARD_XIANGQI_ENABLED=true at launch (alongside the
// rated flag + user_ratings CHECK migration).
export function xiangqiEnabled(): boolean {
  return process.env.MISTBOARD_XIANGQI_ENABLED === 'true';
}

// Dark Mini Xiangqi is a separate 7x7 rules spike. Keep it independently
// gateable from full Dark Xiangqi so runtime experiments cannot expose both
// families at once by accident.
export function darkMiniXiangqiEnabled(): boolean {
  return process.env.MISTBOARD_DARK_MINI_XIANGQI_ENABLED === 'true';
}

// Drop Mini Xiangqi (7x7 mini xiangqi with crazyhouse-style reserves) is a
// parked lab surface. Existing postgames remain readable, while new rooms need
// an explicit lab/runtime opt-in.
export function dropMiniXiangqiEnabled(): boolean {
  return process.env.MISTBOARD_DROP_MINI_XIANGQI_ENABLED === 'true';
}

// Fortress Xiangqi (7x8 xiangqi-with-a-pocket) live rooms. Server-side opt-in,
// default off — the tenant exists but is not launched. Flip to `return true` at
// launch (alongside the rated flag + user_ratings CHECK migration).
export function fortressXiangqiEnabled(): boolean {
  return process.env.MISTBOARD_FORTRESS_XIANGQI_ENABLED === 'true';
}

// Duck Xiangqi (9x10 xiangqi + Duck Chess's shared blocker) live rooms.
// Server-side opt-in, default off — the tenant exists but is not launched. Flip
// to `return true` at launch, alongside the rated flag + the user_ratings CHECK
// migration for the `duck_xiangqi` pool.
export function duckXiangqiEnabled(): boolean {
  return process.env.MISTBOARD_DUCK_XIANGQI_ENABLED === 'true';
}

// Hong Kong mahjong live rooms. Server-side opt-in, default off.
//
// This flag is not the only gate and is not meant to be. Mahjong is also on the
// per-account allowlist (139), so turning it on in an environment opens the
// variant to the handful of people holding a grant and to nobody else. That is
// deliberate: the hand mathematics is proven against an independent
// implementation, but the faan values were read off sources that disagree with
// each other and nobody here plays the game. Flipping this to `true` is not a
// launch.
export function mahjongEnabled(): boolean {
  return process.env.MISTBOARD_MAHJONG_ENABLED === 'true';
}

// Jieqi (full-board xiangqi with hidden identities) live rooms. Server-side
// opt-in, default off — the tenant exists but is not launched.
export function jieqiEnabled(): boolean {
  return process.env.MISTBOARD_JIEQI_ENABLED === 'true';
}

// Banqi (8x4 Chinese Dark Chess, symmetric hidden-identity) live rooms.
// Server-side opt-in, default off — the tenant exists but is not launched. PvP
// only at first (PvE is gated on an engine, like jieqi).
export function banqiEnabled(): boolean {
  return process.env.MISTBOARD_BANQI_ENABLED === 'true';
}

// Luzhanqi / Junqi live rooms. Server-side opt-in, default off. PvP-only while
// the formation editor and postgame reveal surfaces land.
export function luzhanqiEnabled(): boolean {
  return process.env.MISTBOARD_LUZHANQI_ENABLED === 'true';
}

// Reveal Chess (standard 8x8 chess with hidden piece identities) live rooms.
// Server-side opt-in, default off — the tenant exists but is not launched.
// PvP-only (no engine/bot at first).
export function revealChessEnabled(): boolean {
  return process.env.MISTBOARD_REVEAL_CHESS_ENABLED === 'true';
}

// Dark Shogi (the fog 9x9 variant, with drops + private hands) live rooms.
// Server-side opt-in, default off — the tenant exists but is not launched.
// PvP-only at first (no bot).
export function darkShogiEnabled(): boolean {
  return process.env.MISTBOARD_DARK_SHOGI_ENABLED === 'true';
}

// Dark Crazyhouse (chess + drops, under fog) live rooms. Server-side opt-in,
// default off — the tenant exists but is not launched. PvP-only (no bot: drops
// explode the belief search). Rides the dark-chess fog kernel + the Dark Shogi
// hands/drops pattern.
export function darkCrazyhouseEnabled(): boolean {
  return process.env.MISTBOARD_DARK_CRAZYHOUSE_ENABLED === 'true';
}

// Kriegspiel (standard chess played blind, ICC wild-16) live rooms. Server-side
// opt-in, default off. PvP-only (no bot yet), with watch/profile/leaderboard
// surfaces when the flag is enabled. Real check/checkmate; the umpire announces
// captures + check categories.
export function kriegspielEnabled(): boolean {
  return process.env.MISTBOARD_KRIEGSPIEL_ENABLED === 'true';
}

// Jungle / Dou Shou Qi (斗兽棋, perfect-information 7×9 animal-rank game) live
// rooms. Server-side opt-in, default off — the tenant exists but is not launched.
// PvP-only at first (the in-process α-β bot + rated pool come later).
export function jungleEnabled(): boolean {
  return process.env.MISTBOARD_JUNGLE_ENABLED === 'true';
}

// Flip Jungle (兽棋 / 翻翻棋, 4×4 flip animal chess, symmetric hidden-identity) live
// rooms. Server-side opt-in, default off — the tenant exists but is not launched.
// PvP-only at first (the belief bot comes later).
export function jungleFlipEnabled(): boolean {
  return process.env.MISTBOARD_JUNGLE_FLIP_ENABLED === 'true';
}

// Correspondence (days-per-move) dark chess on the variant-tenant stack.
// Server-side opt-in: gates room creation; existing dchx_ rooms keep routing
// if the flag flips off. Correspondence is account-gated and invite-link
// only at C1.
export function correspondenceEnabled(): boolean {
  return process.env.MISTBOARD_CORRESPONDENCE_ENABLED === 'true';
}

// Automated bot-vs-bot (engine-vs-engine) game generation. Server-side opt-in,
// default off. This gates only GENERATION of EvE games (the in-server scheduler
// that tops up a backlog of xiangqi EvE tasks for the worker to drain). It is
// deliberately independent of xiangqiEnabled(), which gates whether those games
// become VISIBLE in the /watch Engines channel — so games can be pre-generated
// to warm the feed before the xiangqi launch flag flips. See #196.
export function botVsBotEnabled(): boolean {
  return process.env.MISTBOARD_BOT_VS_BOT_ENABLED === 'true';
}

// Global lobby chat on the homepage (gate-cleared 2026-07-02, ships OFF).
// This env flag is also the kill switch: flipping it off in Railway and
// redeploying disables reads and posts in one move (the widget hides itself
// when the API reports disabled).
export function lobbyChatEnabled(): boolean {
  return process.env.MISTBOARD_LOBBY_CHAT_ENABLED === 'true';
}

// Translate buttons on forum topic titles and post bodies (130). Ships OFF.
// Needs both the explicit flag and a model API key in the environment; the
// key's presence is all this reads (never its value). The flag is the kill
// switch: off in Railway and redeploy hides the buttons and 503s the route.
export function forumTranslationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MISTBOARD_FORUM_TRANSLATION_ENABLED === 'true' && Boolean(env.ANTHROPIC_API_KEY);
}
