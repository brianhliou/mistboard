/**
 * The correspondence (days-per-move) capability for a variant tenant, as one
 * binding a registration spreads into registerVariantTenant.
 *
 * Every piece of the durable loop was already generic: seek accept seats both
 * accounts through createTenantCorrespondenceGameForSeek, the event writer keeps
 * the room_deadlines row, and sweepTenantRoomDeadline forfeits or aborts through
 * the ws runtime's lifecycle context. What each tenant used to repeat was the
 * wiring: its room map and factory context, its hydration, its lifecycle
 * context. This takes those once and returns the registration fields, so the
 * pairing correspondence-eligibility.test.ts enforces (a seek factory AND a
 * deadline sweeper) cannot be supplied by half.
 *
 * seatBoard is opt-in and only ever the tenant's own seat redaction
 * (tenantSeatStateView, the same function the room snapshot runs for that
 * seat). A tenant opts in only when the public feed cannot draw its board
 * (fog), and the web inbox draws it only for specs it has a seat renderer for.
 */

import type { RoomTimeControl } from '@mistboard/game';
import { sweepTenantRoomDeadline, type TenantLifecycleContext } from './lifecycle.js';
import type { TenantManagedRoom, VariantTenantRegistration } from './registry.js';
import {
  createTenantCorrespondenceGameForSeek,
  type TenantLiveRoomFactoryContext,
} from './room-factory.js';
import { tenantSeatStateView } from './runtime.js';
import type { TenantGameStateLike, TenantRuntimeRoom, VariantTenant } from './tenant.js';
import type { TenantLiveRoom } from './ws.js';

export type TenantCorrespondenceBinding = {
  sweepDueDeadline: NonNullable<VariantTenantRegistration['sweepDueDeadline']>;
  createCorrespondenceGameForSeek: NonNullable<
    VariantTenantRegistration['createCorrespondenceGameForSeek']
  >;
  seatBoard?: NonNullable<VariantTenantRegistration['seatBoard']>;
};

export function tenantCorrespondenceBinding<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  deps: {
    // The same context the tenant's live rooms are created with (room map,
    // cross-variant id check, persistence), so a correspondence room is an
    // ordinary room of the tenant in every other respect.
    factoryContext: () => TenantLiveRoomFactoryContext<Kind, C, M, State, Spec>;
    getOrLoadRoom: (roomId: string) => Promise<TenantRuntimeRoom<Kind, C, M, State, Spec> | null>;
    // The ws runtime's lifecycle context: sweeper appends persist, maintain the
    // deadline row and broadcast exactly like a live flag.
    lifecycleCtx: TenantLifecycleContext<
      C,
      M,
      State,
      Spec,
      TenantLiveRoom<Kind, C, M, State, Spec>
    >;
    // Serve the inbox the seat's own redacted board. Only for tenants whose
    // public feed carries no board (fog) and that the web can draw.
    seatBoard?: boolean;
  },
): TenantCorrespondenceBinding {
  const binding: TenantCorrespondenceBinding = {
    createCorrespondenceGameForSeek: async (args: {
      timeControl: RoomTimeControl;
      first: { userId: string };
      second: { userId: string };
    }) => {
      const created = await createTenantCorrespondenceGameForSeek(
        tenant,
        deps.factoryContext(),
        args,
      );
      if (!created.ok) return created;
      return {
        ok: true,
        room: { id: created.room.id, gameSpecId: created.room.gameSpecId },
        // colors[0] is the first mover by contract; the seek stores move order.
        seats: { first: tenant.colors[0] as string, second: tenant.colors[1] as string },
      };
    },
    sweepDueDeadline: async (roomId: string) => {
      const room = await deps.getOrLoadRoom(roomId);
      if (!room) return;
      // Hydrated rooms carry an empty client set; the live room type differs
      // only in what that set holds.
      await sweepTenantRoomDeadline(
        tenant,
        room as unknown as TenantLiveRoom<Kind, C, M, State, Spec>,
        deps.lifecycleCtx,
      );
    },
  };
  if (deps.seatBoard) {
    binding.seatBoard = (room: TenantManagedRoom, seat: string) =>
      tenantSeatBoard(tenant, room as unknown as TenantRuntimeRoom<Kind, C, M, State, Spec>, seat);
  }
  return binding;
}

// The seat's own view for the /correspondence inbox card: the same redaction
// the room snapshot runs for that seat, keyed to the seat's own client id.
// Anything that is not one of the tenant's colors (a spectator seat, a typo,
// another tenant's color) gets null: fail-closed.
export function tenantSeatBoard<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  seat: string,
): View | null {
  if (!tenant.rules.isColor(seat)) return null;
  return tenantSeatStateView(tenant, room, {
    id: room.seatTokens[seat]?.clientId ?? `seat-board:${seat}`,
    seat,
    solo: false,
  });
}
