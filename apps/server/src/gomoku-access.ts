// Gomoku prod playtest, following the Three Kingdoms banqi gate (#684).
// Create, every socket connection, replay and live payloads admit an admin
// account or anyone with the local flag on. Listings keep gomokuEnabled()
// alone, so admitting an admin never advertises this hidden variant.
import { gomokuEnabled } from './feature-flags.js';
import type { UserAccount } from './persistence.js';

export function gomokuAdmits(accountUser: Pick<UserAccount, 'accountRole'> | null): boolean {
  return gomokuEnabled() || accountUser?.accountRole === 'admin';
}
