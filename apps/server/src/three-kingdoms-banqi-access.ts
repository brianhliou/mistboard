/**
 * Who may reach Three Kingdoms banqi (#628) rooms during the prod playtest
 * (#684, Brian 2026-10-29: "gate behind me").
 *
 * The playtest ships in every build, but its doors open only to an admin
 * account (`account_role = 'admin'`), or to everyone when the local playtest
 * flag MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED=true is set (never in Railway).
 * Fail-closed: a guest or a signed-in non-admin is refused, never handed
 * another variant.
 *
 * The doors that consult it: the create route (rooms-route `admits`), and the
 * WebSocket connect for a live or persisted room (registration
 * `admitsConnection`), which covers seats and spectators alike. Listing
 * surfaces (TV, current games, lobby, correspondence, bot profiles) read the
 * registration's enabled(), which stays the env flag, so the variant is
 * unlisted everywhere.
 */

import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

export function threeKingdomsBanqiAdmits(
  accountUser: Pick<UserAccount, 'accountRole'> | null,
): boolean {
  return threeKingdomsBanqiEnabled() || accountUser?.accountRole === 'admin';
}
