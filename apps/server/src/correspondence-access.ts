import { ffqBanqiAdmits } from './ffq-banqi-access.js';
import type { UserAccount } from './persistence.js';
import * as persistence from './persistence.js';
import { getPool } from './persistence-db.js';
import { threeKingdomsBanqiAdmits } from './three-kingdoms-banqi-access.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';

// Reuse the room doors. A grant must never bypass an admin-only playtest,
// and TK's admin door remains available while its public listing flag is off.
export async function mayPlayCorrespondence(
  user: UserAccount | null,
  specId: string,
): Promise<boolean> {
  if (!user || !correspondenceTenantForSpecId(specId)) return false;
  switch (specId) {
    case 'ffq-banqi':
      return ffqBanqiAdmits(user);
    case 'three-kingdoms-banqi':
      return threeKingdomsBanqiAdmits(user);
    default: {
      const tenant = correspondenceTenantForSpecId(specId);
      return !!tenant?.enabled() && (await persistence.mayPlayVariant(user, specId));
    }
  }
}

export async function mayPlayCorrespondenceByUserId(
  userId: string,
  specId: string,
): Promise<boolean> {
  if (!correspondenceTenantForSpecId(specId)) return false;
  if (specId !== 'ffq-banqi' && specId !== 'three-kingdoms-banqi') {
    return persistence.mayPlayVariantByUserId(userId, specId);
  }
  const result = await getPool().query<Pick<UserAccount, 'accountRole'>>(
    `SELECT account_role AS "accountRole" FROM users WHERE id = $1 AND closed_at IS NULL`,
    [userId],
  );
  const account = result.rows[0];
  if (!account) return false;
  return specId === 'ffq-banqi' ? ffqBanqiAdmits(account) : threeKingdomsBanqiAdmits(account);
}
