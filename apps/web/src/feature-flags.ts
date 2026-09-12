// Client build-time gates for hidden or prelaunch surfaces. Most dev defaults
// stay on for local parity with launched variants; parked surfaces use explicit
// opt-in only so they do not reappear in active product UI by accident.

function labEnabled(): boolean {
  return import.meta.env.VITE_MISTBOARD_LAB_ENABLED === 'true';
}

export function darkXiangqiEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_DARK_XIANGQI_ENABLED === 'true';
}

// Standard (open-information) Xiangqi (9x10) play surface. Always on in dev for
// local parity; in prod/staging it stays hidden until the build opts in. The
// server gates room creation independently (MISTBOARD_XIANGQI_ENABLED), so an
// off web flag never strands a live room.
export function xiangqiEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_XIANGQI_ENABLED === 'true';
}

// Dark Mini Xiangqi (7x7) is a parked lab surface.
export function darkMiniXiangqiEnabled(): boolean {
  return labEnabled() || import.meta.env.VITE_DARK_MINI_XIANGQI_ENABLED === 'true';
}

// Global friends-online widget (bottom-corner pill → expandable list, lichess
// parity). On in dev; in prod/staging it stays hidden until the build opts in.
export function friendsOnlineEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_FRIENDS_ONLINE_ENABLED === 'true';
}

// Fortress Xiangqi (7x8 xiangqi-with-a-pocket). Launched: always on (the server
// MISTBOARD_FORTRESS_XIANGQI_ENABLED flag remains the runtime kill-switch for
// room creation).
export function fortressXiangqiEnabled(): boolean {
  return true;
}

// Duck Xiangqi renderer. The SERVER flag gates whether rooms can be created at
// all; this one only gates the client build, so it stays on and the tenant is
// hidden by its registry surface + the server flag.
// Hong Kong mahjong. Off by default, and the flag is only half the gate: the
// variant is also on the per-account allowlist server-side, so turning this on
// renders the table for people who hold a grant and for nobody else.
export function mahjongEnabled(): boolean {
  return import.meta.env.VITE_MAHJONG_ENABLED === 'true';
}

export function duckXiangqiEnabled(): boolean {
  return true;
}

// Identity-hidden jieqi (揭棋) play surface. Always on in dev for convenience
// (like DMX/correspondence); in prod/staging it is hidden unless the
// build opts in.
export function jieqiEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_JIEQI_ENABLED === 'true';
}

// Banqi (8x4 Chinese Dark Chess, symmetric hidden-identity) play surface. Always
// on in dev for convenience; in prod/staging it is hidden unless the build opts
// in; mirrors the jieqi gate.
export function banqiEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_BANQI_ENABLED === 'true';
}

// Luzhanqi / Junqi remains available in the explicit lab profile.
export function luzhanqiEnabled(): boolean {
  return labEnabled() || import.meta.env.VITE_LUZHANQI_ENABLED === 'true';
}

// Reveal Chess (chess-jieqi, hidden identities on an 8x8 board) play surface.
// Explicit build-time opt-in only.
export function revealChessEnabled(): boolean {
  return labEnabled() || import.meta.env.VITE_REVEAL_CHESS_ENABLED === 'true';
}

// Jungle / Dou Shou Qi (perfect-information 7×9 animal-rank game) play surface.
// Launched: always on (the server MISTBOARD_JUNGLE_ENABLED flag remains the runtime
// kill-switch for room creation).
export function jungleEnabled(): boolean {
  return true;
}

// Flip Jungle (兽棋 / 翻翻棋, 4×4 flip animal chess) play surface. Launched: always on
// (the server MISTBOARD_JUNGLE_FLIP_ENABLED flag remains the runtime kill-switch).
export function jungleFlipEnabled(): boolean {
  return true;
}

// Correspondence (days-per-move) entry points. Launched: on by default, with
// MISTBOARD_CORRESPONDENCE_ENABLED on the server as the runtime kill-switch
// (same shape as the launched variants above). The web side only decides
// whether the entry points are OFFERED, so a build that ships ahead of the
// server flag degrades rather than breaks: the seek route answers 404
// correspondence_disabled and the lobby tab falls back to its coming-soon line.
// VITE_CORRESPONDENCE_ENABLED=false still hides the surface for a build.
export function correspondenceEnabled(): boolean {
  return import.meta.env.VITE_CORRESPONDENCE_ENABLED !== 'false';
}

// Dark Crazyhouse (the fog 8x8 chess + drops variant) play surface. Server-side
// opt-in is MISTBOARD_DARK_CRAZYHOUSE_ENABLED; this gates the landing picker and
// deep links. Available through the explicit lab profile or a build flag.
export function darkCrazyhouseEnabled(): boolean {
  return labEnabled() || import.meta.env.VITE_DARK_CRAZYHOUSE_ENABLED === 'true';
}

// Kriegspiel (standard chess played blind) play surface. Server-side opt-in is
// MISTBOARD_KRIEGSPIEL_ENABLED; this gates play entry, watch, profile, and
// leaderboard surfaces.
export function kriegspielEnabled(): boolean {
  return labEnabled() || import.meta.env.VITE_KRIEGSPIEL_ENABLED === 'true';
}

// The coordinate + notation trainer (/learn/coordinates). Built and tested, but
// PARKED: it is not linked from the nav, not in the sitemap, and the server
// drops it from isClientRoute so a prod direct hit lands on the branded 404
// shell. On in dev so the code stays reachable and cannot rot silently.
// Read #327 before unparking: the site offers four notations and the drill
// covers two, and an ICCS reader would be taught every rank off by one.
export function coordinateTrainerEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_COORDINATE_TRAINER_ENABLED === 'true';
}
