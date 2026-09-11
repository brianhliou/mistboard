// Config entries for the variant PvE smokes. Each prod-<variant>-smoke.mjs
// entry point is one row here plus a two-line script; the shared runner lives
// in variant-smoke.mjs.
//
// Engine-seat assertions are version-agnostic by prefix wherever the engine id
// carries a version suffix. Pinning a specific version silently breaks the
// smoke on every engine bump: the check never matches the new seat id and the
// smoke times out on a perfectly healthy engine (hit exactly this on the DXQ
// v1.0 -> v1.1 flip, fixed in bfb02b95). `equals` is reserved for ids with no
// version suffix at all.

export const VARIANT_SMOKE_CONFIGS = {
  duck: {
    name: 'duck',
    label: 'Duck',
    usage: 'npm run prod:smoke:duck -- [options]',
    gameSpecId: 'duck-xiangqi',
    // Higher than the fortress ceiling on purpose. This engine is its own
    // patched Fairy-Stockfish build with no NNUE, searching a root roughly
    // 2,554 turns wide against xiangqi's 44, so a healthy first move here is
    // slower than a healthy first move anywhere else on the site.
    defaultTimeoutMs: 60_000,
    // Prefix-matched for the same reason as fortress: the rung the product
    // hands a player is a knob (landing-bot-policy.ts), and pinning one level
    // makes this smoke fail when that knob moves.
    engineSeat: { prefix: 'fairy-stockfish-duck-xiangqi-' },
  },
  fortress: {
    name: 'fortress',
    label: 'Fortress',
    usage: 'npm run prod:smoke:fortress -- [options]',
    gameSpecId: 'fortress-xiangqi',
    defaultTimeoutMs: 40_000,
    // Prod assigns a Fairy-Stockfish Fortress Xiangqi engine to the red seat
    // for a PvE room. Prefix-matched, NOT pinned to one rung: the default is a
    // product knob (an 8-level ladder since the 2026-07 bot consolidation),
    // and pinning the old 'strong' id made this smoke time out on a perfectly
    // healthy engine when the default moved to Level 4 — the exact bfb02b95
    // failure mode described above.
    engineSeat: { prefix: 'fairy-stockfish-fortress-xiangqi-' },
  },
  dmx: {
    name: 'dmx',
    label: 'DMX',
    usage: 'npm run prod:smoke:dmx -- [options]',
    gameSpecId: 'dark-mini-xiangqi',
    defaultTimeoutMs: 20_000,
    // version-agnostic: any DMX engine id (python-dmx-*), per the bfb02b95
    // lesson above.
    engineSeat: { prefix: 'python-dmx-' },
  },
  dxq: {
    name: 'dxq',
    label: 'DXQ',
    usage: 'npm run prod:smoke:dxq -- [options]',
    gameSpecId: 'dark-xiangqi',
    defaultTimeoutMs: 80_000,
    // version-agnostic: any Dark Xiangqi engine id (python-fdx-*).
    engineSeat: { prefix: 'python-fdx-' },
  },
  banqi: {
    name: 'banqi',
    label: 'Banqi',
    usage: 'npm run prod:smoke:banqi -- [options]',
    gameSpecId: 'banqi',
    defaultTimeoutMs: 30_000,
    // 'misty-banqi' carries no version suffix today. Prefix-matched anyway, so
    // a later 'misty-banqi-v2' does not red a healthy engine (bfb02b95).
    engineSeat: { prefix: 'misty-banqi' },
  },
  jieqi: {
    name: 'jieqi',
    label: 'Jieqi',
    usage: 'npm run prod:smoke:jieqi -- [options]',
    gameSpecId: 'jieqi',
    // The strongest rung searches 4s behind an 8s hard timeout and retries
    // once, so a slow-but-working engine can legitimately need ~17s. Measured
    // healthy: 4.4s.
    defaultTimeoutMs: 60_000,
    // Any rung: 'pikafish-jieqi-strongest' fronts PvE today, with amateur and
    // strong rungs behind it.
    engineSeat: { prefix: 'pikafish-jieqi-' },
  },
  jungle: {
    name: 'jungle',
    label: 'Jungle',
    usage: 'npm run prod:smoke:jungle -- [options]',
    gameSpecId: 'jungle',
    defaultTimeoutMs: 30_000,
    // 'misty-jungle-level-', NOT 'misty-jungle': the shorter prefix also
    // matches 'misty-jungle-flip', which is a different variant's engine.
    engineSeat: { prefix: 'misty-jungle-level-' },
  },
  'jungle-flip': {
    name: 'jungle-flip',
    label: 'Flip Jungle',
    usage: 'npm run prod:smoke:jungle-flip -- [options]',
    gameSpecId: 'jungle-flip',
    defaultTimeoutMs: 30_000,
    engineSeat: { prefix: 'misty-jungle-flip' },
  },
  xiangqi: {
    name: 'xiangqi',
    label: 'Xiangqi',
    usage: 'npm run prod:smoke:xiangqi -- [options]',
    gameSpecId: 'xiangqi',
    defaultTimeoutMs: 40_000,
    // The ONLY variant served by two engine families: the Fairy-Stockfish
    // ladder (what a bare PvE create resolves to today) and Pikafish Level 8.
    // Both are accepted, because which one fronts the default is a product
    // knob and pinning the current answer is the bfb02b95 failure mode.
    engineSeat: { prefixes: ['fairy-stockfish-xiangqi-level-', 'pikafish-xiangqi-'] },
  },
};

export function matchesEngineSeat(engineSeat, seatId) {
  if (typeof seatId !== 'string') return false;
  if (engineSeat.equals !== undefined) return seatId === engineSeat.equals;
  // `prefixes` is for a variant served by more than one engine family (xiangqi).
  if (engineSeat.prefixes !== undefined) {
    return engineSeat.prefixes.some((prefix) => seatId.startsWith(prefix));
  }
  return seatId.startsWith(engineSeat.prefix);
}
