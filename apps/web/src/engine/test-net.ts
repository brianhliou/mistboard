import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type NetEnv = { MISTBOARD_REQUIRE_NETS?: string; CI?: string };

// Keep local assets optional unless the test run explicitly requires them.
export function testNetAvailable(path: string, env: NetEnv = process.env): boolean {
  const available = existsSync(path);
  if (!available && (env.MISTBOARD_REQUIRE_NETS === '1' || env.CI)) {
    throw new Error(
      `Missing required engine net: ${path}. Run npm run worktree:prepare to fetch the pinned nets. Pikafish uses gh login locally or MISTBOARD_PRIVATE_ASSETS_TOKEN (required in CI and production builds).`,
    );
  }
  return available;
}

export function requireTestEngineNet(engine: 'rapfi' | 'pikafish'): void {
  const dir = resolve(__dirname, '../../public/engine', engine);
  const pin = JSON.parse(readFileSync(resolve(dir, 'net.json'), 'utf8'));
  testNetAvailable(resolve(dir, pin.file));
}
