// Admin account roster API (powers the unlisted /accounts surface).
//
//   GET /api/admin/accounts?sort=<ADMIN_ACCOUNT_SORTS>&q=<text>&limit=<n>&offset=<n>
//
// Session-admin gated like /api/admin/engines (open in local dev). Returns
// every registered account, closed and private ones included, each with its
// completed-game count, plus whole-roster signup figures. Unknown sorts and
// malformed paging reject rather than falling back to a default, so a typo in
// the URL never quietly returns a different view.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ADMIN_ACCOUNTS_MAX_LIMIT,
  type AdminAccountRow,
  type AdminAccountsQuery,
  isAdminAccountSort,
  listAdminAccounts,
} from './../persistence.js';
import { requireAdminSession, requireMethod, requirePersistence, writeJson } from './lib.js';

export const ADMIN_ACCOUNTS_DEFAULT_LIMIT = 200;
export const ADMIN_ACCOUNTS_SEARCH_MAX = 120;

// Persistence surface the handler uses, injectable so the query parsing and
// serialization are unit-testable without Postgres (routes/titles.ts pattern).
export type AdminAccountsApiPersistence = {
  listAdminAccounts: typeof listAdminAccounts;
};

const defaultPersistence: AdminAccountsApiPersistence = { listAdminAccounts };

type ApiResult = { status: number; payload: Record<string, unknown> };

export type ParsedAdminAccountsQuery =
  | { ok: true; query: AdminAccountsQuery }
  | { ok: false; error: 'invalid_sort' | 'invalid_limit' | 'invalid_offset' | 'search_too_long' };

export function parseAdminAccountsQuery(params: URLSearchParams): ParsedAdminAccountsQuery {
  const sort = params.get('sort') ?? 'newest';
  if (!isAdminAccountSort(sort)) return { ok: false, error: 'invalid_sort' };
  const search = (params.get('q') ?? '').trim();
  if (search.length > ADMIN_ACCOUNTS_SEARCH_MAX) return { ok: false, error: 'search_too_long' };
  const limit = parseCount(params.get('limit'), ADMIN_ACCOUNTS_DEFAULT_LIMIT);
  if (limit === null || limit < 1) return { ok: false, error: 'invalid_limit' };
  const offset = parseCount(params.get('offset'), 0);
  if (offset === null) return { ok: false, error: 'invalid_offset' };
  return {
    ok: true,
    query: {
      sort,
      search: search || null,
      // Over-asks clamp to the roster cap instead of erroring: the page only
      // ever grows its own limit, so the cap is a ceiling, not a typo.
      limit: Math.min(limit, ADMIN_ACCOUNTS_MAX_LIMIT),
      offset,
    },
  };
}

// A non-negative integer or its default; anything else (negative, fractional,
// text, empty string) is null so the caller can reject it.
function parseCount(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback;
  if (!/^\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

export type AdminAccountPayload = {
  id: string;
  email: string;
  emailVerified: boolean;
  handle: string;
  displayName: string;
  accountRole: AdminAccountRow['accountRole'];
  title: AdminAccountRow['title'];
  patron: boolean;
  profileVisibility: AdminAccountRow['profileVisibility'];
  createdAt: string;
  lastSeenAt: string | null;
  closedAt: string | null;
  gamesPlayed: number;
};

export function serializeAdminAccount(row: AdminAccountRow): AdminAccountPayload {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    handle: row.handle,
    displayName: row.displayName,
    accountRole: row.accountRole,
    title: row.title,
    patron: row.patronSince !== null,
    profileVisibility: row.profileVisibility,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    gamesPlayed: row.gamesPlayed,
  };
}

export async function adminAccountsForApi(
  params: URLSearchParams,
  deps: AdminAccountsApiPersistence = defaultPersistence,
): Promise<ApiResult> {
  const parsed = parseAdminAccountsQuery(params);
  if (!parsed.ok) return { status: 400, payload: { error: parsed.error } };
  const page = await deps.listAdminAccounts(parsed.query);
  return {
    status: 200,
    payload: {
      accounts: page.accounts.map(serializeAdminAccount),
      total: page.total,
      summary: page.summary,
      sort: parsed.query.sort,
      search: parsed.query.search,
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    },
  };
}

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname !== '/api/admin/accounts') return false;
  if (!requireMethod(request, response, 'GET')) return true;
  if (!(await requireAdminSession(request, response))) return true;
  if (!requirePersistence(response)) return true;
  const result = await adminAccountsForApi(parsedUrl.searchParams);
  writeJson(response, result.status, result.payload);
  return true;
}
