/**
 * Chess-live-shell tenant hooks — the static half of the web VariantTenant
 * registry. Tenants that ride the shared live.ts/live-render shell (currently
 * Dark Mini Xiangqi) register their render/reconcile/reset/tick/keyboard
 * hooks here so the shell dispatches without per-variant branches.
 *
 * Deliberately separate from ./registry.ts: these hooks statically import the
 * tenant live-room modules, and only the live-room chunk (live-render/live.ts,
 * which already bundled those modules) may pay for that. Self-contained
 * clients never appear here. The chess shell itself is the
 * fallback when no hook claims the room; it converges at the P2 migration.
 */

import {
  handleDarkMiniXiangqiReplayKeyboard,
  isDarkMiniXiangqiLiveRoom,
  isDarkMiniXiangqiReplayLive,
  reconcileDarkMiniXiangqiInteractionState,
  renderDarkMiniXiangqiRoom,
  resetDarkMiniXiangqiReplayState,
  tickDarkMiniXiangqiClocks,
  tickDarkMiniXiangqiCountdowns,
} from '../live-mini-xiangqi-room.js';
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

const LIVE_SHELL_TENANTS: readonly LiveShellTenant[] = [
  {
    isActive: isDarkMiniXiangqiLiveRoom,
    render: renderDarkMiniXiangqiRoom,
    reconcileInteractionState: reconcileDarkMiniXiangqiInteractionState,
    resetReplayState: resetDarkMiniXiangqiReplayState,
    isReplayLive: isDarkMiniXiangqiReplayLive,
    tickClocks: tickDarkMiniXiangqiClocks,
    tickCountdowns: tickDarkMiniXiangqiCountdowns,
    handleReplayKeyboard: handleDarkMiniXiangqiReplayKeyboard,
  },
];

export function liveShellTenants(): readonly LiveShellTenant[] {
  return LIVE_SHELL_TENANTS;
}

export function activeLiveShellTenant(): LiveShellTenant | null {
  return LIVE_SHELL_TENANTS.find((tenant) => tenant.isActive()) ?? null;
}
