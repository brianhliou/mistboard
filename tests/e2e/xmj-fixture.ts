import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { test as base, expect } from '@playwright/test';
import pg from 'pg';

// The persistent dev pair pins this same local database. Never seed a remote
// target or reuse an operator's account. Direct session setup avoids spending
// the shared dev auth API's per-IP sign-in allowance on each browser project.
export const test = base.extend<{ grantedAccount: string }>({
  grantedAccount: async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL ?? 'http://127.0.0.1:3000');
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
    expect(origin.protocol).toBe('http:');
    const pool = new pg.Pool({
      connectionString: 'postgres://mistboard:mistboard@localhost:5435/mistboard',
      connectionTimeoutMillis: 5000,
      max: 1,
    });
    const userId = randomUUID();
    const handle = `xmj-${userId.slice(0, 8)}`;
    const sessionId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const expires = Math.floor(Date.now() / 1000) + 3600;
    try {
      await pool.query(
        `INSERT INTO users
           (id, email, email_verified_at, handle, display_name, stats_excluded_at)
         VALUES ($1, $2, now(), $3, $3, now())`,
        [userId, `${userId}@example.com`, handle],
      );
      await pool.query(
        `INSERT INTO variant_access_grants (user_id, game_spec_id, note)
         VALUES ($1, 'xiangqi-mahjong', 'e2e #674')`,
        [userId],
      );
      await pool.query(
        `INSERT INTO account_sessions (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, to_timestamp($4))`,
        [sessionId, userId, createHash('sha256').update(token).digest('hex'), expires],
      );
      await context.addCookies([
        {
          name: 'mistboard_session',
          value: `${sessionId}.${token}`,
          url: origin.origin,
          httpOnly: true,
          sameSite: 'Lax',
          expires,
        },
      ]);
      await use(userId);
    } finally {
      // Keep the excluded account so the recorded game's attribution survives;
      // remove only this fixture's session and access, even after a failed test.
      try {
        await pool.query('DELETE FROM account_sessions WHERE id = $1', [sessionId]);
        await pool.query('DELETE FROM variant_access_grants WHERE user_id = $1', [userId]);
      } finally {
        await pool.end();
      }
    }
  },
});
