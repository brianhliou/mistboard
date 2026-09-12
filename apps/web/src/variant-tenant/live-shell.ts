/**
 * Chess-live-shell tenant hooks — the static half of the web VariantTenant
 * registry. A tenant that rides the shared live.ts/live-render shell registers
 * its render/reconcile/reset/tick/keyboard hooks here so the shell dispatches
 * without per-variant branches. None does today; the list stays so the shell
 * keeps one dispatch path.
 *
 * Deliberately separate from ./registry.ts: these hooks statically import the
 * tenant live-room modules, and only the live-room chunk (live-render/live.ts,
 * which already bundled those modules) may pay for that. Self-contained
 * clients never appear here. The chess shell itself is the
 * fallback when no hook claims the room; it converges at the P2 migration.
 */

import type { LiveRefs } from '../live-state.js';

export type LiveShellTenant = {
  // Whether the current liveState room belongs to this tenant.
  isActive(): boolean;
  render(
    refs: LiveRefs,
    callbacks: { reconnectNow: () => void; sendSocket: (payload: unknown) => boolean },
  ): void;
  reconcileInteractionState(): void;
  resetReplayState(): void;
  isReplayLive(): boolean;
  // Clock/countdown ticks on the shell's 100ms interval; tenants without them
  // fall through to the shell's chess tick path.
  tickClocks?(): void;
  tickCountdowns?(): void;
  // Replay scrubber keys; tenants without one use the chess replay handler.
  handleReplayKeyboard?(event: KeyboardEvent): void;
};

const LIVE_SHELL_TENANTS: readonly LiveShellTenant[] = [];

export function liveShellTenants(): readonly LiveShellTenant[] {
  return LIVE_SHELL_TENANTS;
}

export function activeLiveShellTenant(): LiveShellTenant | null {
  return LIVE_SHELL_TENANTS.find((tenant) => tenant.isActive()) ?? null;
}
