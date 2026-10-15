// Mutual-confirm PvP rematch for a tenant room (server: variant-tenant/rematch.ts).
// Holds the room's offer flags from the finished snapshot's `rematch` extra and
// from `rematch:state` frames, and renders the shared block (rematch-controls.ts)
// for the local seat. The redirect itself is handled by socket-client.ts.
//
// `declined` is a client-only cue: an offer of mine that vanished without a
// rematch starting, and that I did not cancel, was declined.

import { rematchBlock } from '../rematch-controls.js';

type SendSocket = (payload: unknown) => boolean;

export type TenantRematch<C extends string> = {
  // The `rematch` snapshot extra (absent while the game is live).
  applyFrame(extra: unknown): void;
  // A `rematch:state` message.
  applyState(message: Record<string, unknown>): void;
  reset(): void;
  // The block for a seated player, or null for a spectator.
  controls(sendSocket: SendSocket): HTMLElement | null;
  offers(): Readonly<Partial<Record<C, boolean>>>;
};

export function createTenantRematch<C extends string>(
  colors: readonly [C, C],
  // The local player's colour, null for a spectator.
  mySeat: () => C | null,
): TenantRematch<C> {
  let offers: Partial<Record<C, boolean>> = {};
  let finalizedRoomId: string | null = null;
  let declined = false;
  let cancelling = false;

  function parse(
    raw: unknown,
  ): { offers: Partial<Record<C, boolean>>; finalized: string | null } | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as { offers?: unknown; finalizedRoomId?: unknown };
    if (typeof record.offers !== 'object' || record.offers === null) return null;
    const next: Partial<Record<C, boolean>> = {};
    for (const color of colors) {
      next[color] = (record.offers as Record<string, unknown>)[color] === true;
    }
    const finalized = typeof record.finalizedRoomId === 'string' ? record.finalizedRoomId : null;
    return { offers: next, finalized };
  }

  function apply(raw: unknown): void {
    const next = parse(raw);
    if (!next) return;
    const mine = mySeat();
    const hadMine = mine !== null && offers[mine] === true;
    const anyOffer = colors.some((color) => next.offers[color] === true);
    if (anyOffer) declined = false;
    else if (hadMine && next.finalized === null && !cancelling) declined = true;
    if (!anyOffer) cancelling = false;
    offers = next.offers;
    finalizedRoomId = next.finalized;
  }

  return {
    applyFrame: apply,
    applyState: apply,
    reset() {
      offers = {};
      finalizedRoomId = null;
      declined = false;
      cancelling = false;
    },
    controls(sendSocket) {
      const mine = mySeat();
      if (mine === null) return null;
      const theirs = mine === colors[0] ? colors[1] : colors[0];
      return rematchBlock(
        {
          iOffered: offers[mine] === true || finalizedRoomId !== null,
          theyOffered: offers[theirs] === true || finalizedRoomId !== null,
          declined,
        },
        sendSocket,
        () => {
          cancelling = true;
        },
      );
    },
    offers: () => offers,
  };
}
