import { variantTenantForSpecId } from './variant-tenant/registry.js';

export const BOT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export function parsePublicBotId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const botId = value.trim();
  return BOT_ID_PATTERN.test(botId) ? botId : null;
}

/** Whether PvE rooms can currently be created for a game spec: the chess stack
 *  is always live; everything else follows its tenant launch flag. */
export function isBotSpecPlayable(gameSpecId: string): boolean {
  if (gameSpecId === 'dark-chess') return true;
  return variantTenantForSpecId(gameSpecId)?.enabled() === true;
}
