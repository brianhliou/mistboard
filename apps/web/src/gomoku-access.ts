// Cosmetic entry hint, like Three Kingdoms banqi (#684). The server checks
// the real account at create, socket and replay; forging this buys no access.
// With the build flag off, admins enter via /?play=friend&gameSpecId=gomoku
// or /?play=computer&gameSpecId=gomoku. Listings, including the play picker,
// keep the build flag alone.
import { gomokuEnabled } from './feature-flags.js';
import { isLikelyAdmin } from './signed-in-state.js';

export function gomokuOffered(): boolean {
  return gomokuEnabled() || isLikelyAdmin();
}
