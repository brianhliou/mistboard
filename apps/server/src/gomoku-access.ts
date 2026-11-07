// Gomoku admission for creation, socket connections, replay and live payloads.
// The runtime flag admits everyone; admins can test with it off. Public
// listings derive from publicSurface and their runtime listing gates.
import { gomokuEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

export function gomokuAdmits(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return gomokuEnabled() || accountUser?.accountRole === 'admin';
}
