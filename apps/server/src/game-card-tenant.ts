// Share-card binding for variant tenants: the registry's `card` capability
// (VariantTenantCard), built over a tenant the same way game-export-tenant.ts
// builds `export`. The card itself (ply choice, frame, PNG) lives in
// og-game-tenant.ts; this file only answers "what is the public FEN after N
// plies of this finished game", which is the one thing that needs the tenant's
// concrete State type.

import type { PositionOgVariant } from './og-position.js';
import type { VariantTenantCard } from './variant-tenant/registry.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  VariantTenant,
} from './variant-tenant/tenant.js';

export type TenantCardOptions<State, C extends string> = {
  variant: PositionOgVariant;
  analysis: VariantTenantCard['analysis'];
  /** The tenant's PUBLIC position writer: the same FEN its analysis board and
   *  position links carry, never a form with a hidden deal field. */
  fen: (state: State) => string;
  /** The ink a seat played, read off the finished state. Absent = the seat IS
   *  the ink (every non-flip tenant). A null answer (a flip game that ended
   *  before the first flip bound anything) falls back to the seat too. */
  seatInk?: (state: State, seat: C) => 'red' | 'black' | null;
};

// Replay is the tenant's own (isTenantEventLog + replayTenantEvents, exactly
// what the postgame routes run). The log is walked to its end FIRST and only a
// replay ending 'finished' yields a position, so no ply of a live game can be
// drawn; the ply the card wants is captured on the way.
export function tenantCardBinding<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  options: TenantCardOptions<State, C>,
): VariantTenantCard {
  return {
    variant: options.variant,
    analysis: options.analysis,
    fenAtPly(events, roomId, ply) {
      if (!isTenantEventLog(tenant, events, roomId)) return null;
      if (!Number.isInteger(ply) || ply < 0) return null;
      const created = events[0];
      if (created?.type !== 'room-created') return null;
      let projection = replayTenantEvents(tenant, [created]);
      let plies = 0;
      let wanted: State | null = ply === 0 ? projection.state : null;
      for (const event of events.slice(1) as TenantRoomEvent<C, M, Spec>[]) {
        projection = applyTenantEvent(tenant, projection, event);
        if (event.type !== 'move-played') continue;
        plies += 1;
        if (plies === ply) wanted = projection.state;
      }
      if (projection.state.status.type !== 'finished') return null;
      if (wanted === null) return null;
      return options.fen(wanted);
    },
    seatInks(events, roomId) {
      if (!isTenantEventLog(tenant, events, roomId)) return null;
      const projection = replayTenantEvents(tenant, events);
      if (projection.state.status.type !== 'finished') return null;
      const inks: Record<string, 'red' | 'black'> = {};
      for (const seat of tenant.colors) {
        const ink = options.seatInk?.(projection.state, seat) ?? null;
        inks[seat] = ink ?? (seat === 'black' ? 'black' : 'red');
      }
      return inks;
    },
  };
}
