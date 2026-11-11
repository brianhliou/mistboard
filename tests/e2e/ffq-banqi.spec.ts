import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FFQBanqiPlayerView } from '@mistboard/game';
import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import pg from 'pg';
import { expectNoErrors, trackPageErrors } from './support';

// Local, persistent pair only; no operator account or auth rate-limit budget.
// MISTBOARD_DEV_PORT_BASE=<free base> MISTBOARD_FFQ_BANQI_ENABLED=true \
// VITE_FFQ_BANQI_ENABLED=true npm run test:e2e -- ffq-banqi.spec.ts --project=desktop --workers=1
test.skip(({ isMobile }) => isMobile, 'the requested FFQ journey is desktop');

test('FFQ: two admins flip in fixed seats and both see HP 60/60', async ({
  browser,
  baseURL,
}, info) => {
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3170');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
  expect(origin.protocol).toBe('http:');
  const pool = new pg.Pool({
    connectionString: 'postgres://mistboard:mistboard@localhost:5435/mistboard',
    connectionTimeoutMillis: 5000,
    max: 1,
  });
  const contexts: BrowserContext[] = [];
  const accounts: Array<{ userId: string; sessionId: string }> = [];
  async function adminPage(): Promise<Page> {
    const context = await browser.newContext({
      baseURL: origin.origin,
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
    });
    contexts.push(context);
    const userId = randomUUID();
    const sessionId = randomUUID();
    const handle = `ffq-${userId.slice(0, 8)}`;
    const token = randomBytes(32).toString('base64url');
    const expires = Math.floor(Date.now() / 1000) + 3600;
    await pool.query(
      `INSERT INTO users (id, email, email_verified_at, handle, display_name, account_role, stats_excluded_at)
       VALUES ($1, $2, now(), $3, $3, 'admin', now())`,
      [userId, `${userId}@example.com`, handle],
    );
    accounts.push({ userId, sessionId });
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
    const page = await context.newPage();
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const user = (await me.json()).user;
    expect(user?.id).toBe(userId);
    expect(user?.accountRole).toBe('admin');
    return page;
  }
  try {
    const red = await adminPage();
    const black = await adminPage();
    const redErrors = trackPageErrors(red);
    const blackErrors = trackPageErrors(black);
    const redWire = watchRoom(red);
    const blackWire = watchRoom(black);

    // Resolve auth before opening the standard friend setup. A fresh admin
    // then sees the hidden entry, and its request must preserve the FFQ id.
    await red.goto('/');
    await expect(red.locator('.site-nav-menu-admin')).toHaveCount(1);
    await red.goto('/?play=friend&gameSpecId=ffq-banqi&side=red');
    await expect(red.locator('.landing-setup-dialog')).toContainText('FFQ Banqi');
    const creating = red.waitForResponse(
      (res) => new URL(res.url()).pathname === '/api/rooms' && res.request().method() === 'POST',
    );
    await red.locator('.landing-setup-start').click();
    const created = await creating;
    expect(created.status(), 'force both FFQ flags on the persistent local pair').toBe(201);
    expect(created.request().postDataJSON()).toMatchObject({
      gameSpecId: 'ffq-banqi',
      mode: 'pvp',
      preferredColor: 'red',
      rated: false,
    });
    const room = (await created.json()) as { roomId: string; url: string };
    expect(room.roomId).toMatch(/^ffq_/);
    expect(room.url).toBe(`/room/${room.roomId}`);
    await expect(red).toHaveURL(new RegExp(`/room/${room.roomId}$`));
    await expect.poll(() => redWire.seat).toBe('red');
    await expectHP(red);

    const response = await black.goto(room.url);
    expect(response?.status()).toBe(200);
    await expect.poll(() => blackWire.seat).toBe('black');
    await expectHP(black);

    // Initial squares 0 and 1 are covered in every crypto deal (only 6, 15,
    // 16 and 25 start open). Click through the actual banqi hit rectangles.
    await red.locator('.banqi-live-board [data-square="a1"] > rect').click();
    await expect.poll(() => redWire.view?.ply).toBe(1);
    await expect.poll(() => blackWire.view?.ply).toBe(1);
    await expectHP(red);
    await expectHP(black);
    await black.locator('.banqi-live-board [data-square="a2"] > rect').click();
    await expect.poll(() => redWire.view?.ply).toBe(2);
    await expect.poll(() => blackWire.view?.ply).toBe(2);
    expect(redWire.view?.status).toEqual({ type: 'playing', turn: 'red' });
    expect(blackWire.view?.status).toEqual(redWire.view?.status);
    expect(redWire.view?.board).toEqual(blackWire.view?.board);
    for (const page of [red, black]) {
      await expectHP(page);
      await expect(page.locator('.ffq-banqi-counters')).toContainText('0/30');
      await expect(page.locator('.ffq-banqi-counters')).toContainText('0/4');
    }

    // A room reload keeps the same seat and masked replay snapshots.
    redWire.view = undefined;
    redWire.seat = '';
    await red.reload();
    await expect.poll(() => redWire.seat).toBe('red');
    await expect.poll(() => redWire.view?.ply).toBe(2);
    await expectHP(red);
    expect(redWire.problems).toEqual([]);
    expect(blackWire.problems).toEqual([]);
    for (const [name, page] of [
      ['red', red],
      ['black', black],
    ] as const) {
      await info.attach(`ffq-${name}-two-plies`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
    expectNoErrors(withoutClosedChat(redErrors));
    expectNoErrors(withoutClosedChat(blackErrors));
  } finally {
    for (const context of contexts) await context.close();
    try {
      for (const { userId, sessionId } of accounts) {
        await pool.query('DELETE FROM account_sessions WHERE id = $1', [sessionId]);
        // Keep excluded game attribution, remove the test-only admin role.
        await pool.query("UPDATE users SET account_role = 'player' WHERE id = $1", [userId]);
      }
    } finally {
      await pool.end();
    }
  }
});

// The FFQ HTTP gate closes every chat path for FFQ rooms, and the shared room
// chrome still mounts the player chat panel, which shows "Chat is unavailable"
// after the 404. Tolerate exactly that closed door; anything else still fails.
function withoutClosedChat(errors: string[]): string[] {
  return errors.filter(
    (error) =>
      !/status of 404 \(Not Found\) \(http:\/\/[^/]+\/api\/chat\/player\/ffq_[^/)]+\)$/.test(error),
  );
}

async function expectHP(page: Page): Promise<void> {
  await expect(page.getByRole('img', { name: 'Banqi board' })).toBeVisible();
  await expect(page.locator('.ffq-banqi-hp')).toHaveCount(2);
  for (const side of ['red', 'black']) {
    const hp = page.locator(`.ffq-banqi-hp[data-side="${side}"]`);
    await expect(hp).toContainText('60/60 HP');
    await expect(hp.locator('progress')).toHaveAttribute('value', '60');
  }
}

function watchRoom(page: Page) {
  const wire = {
    seat: '',
    view: undefined as FFQBanqiPlayerView | undefined,
    problems: [] as string[],
  };
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).searchParams.get('room')?.startsWith('ffq_')) return;
    socket.on('framereceived', ({ payload }) => {
      const frame = JSON.parse(String(payload)) as { seat?: string; state?: FFQBanqiPlayerView };
      if (frame.seat) wire.seat = frame.seat;
      if (frame.state) wire.view = frame.state;
      // Inspect the entire frame (events and liveHistory included), retaining
      // only field names in diagnostics, never session/seat tokens.
      function inspect(value: unknown): void {
        if (!value || typeof value !== 'object') return;
        const fields = Object.keys(value);
        if ('faceDown' in value && value.faceDown === true && fields.join() !== 'faceDown')
          wire.problems.push(`covered identity fields: ${fields.join(', ')}`);
        for (const [key, child] of Object.entries(value)) {
          if (['setup', 'deal', 'seed'].includes(key)) wire.problems.push(`secret field: ${key}`);
          inspect(child);
        }
      }
      inspect(frame);
    });
  });
  return wire;
}
