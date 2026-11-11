// Three Kingdoms Banqi admission for creation, sockets and replay.
// The runtime flag admits everyone; admins can test with it off. Public
// listings derive from publicSurface and the registration runtime gate.
import { threeKingdomsBanqiEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

export function threeKingdomsBanqiAdmits(
  accountUser: Pick<UserAccount, 'accountRole'> | null,
): boolean {
  return threeKingdomsBanqiEnabled() || accountUser?.accountRole === 'admin';
}
