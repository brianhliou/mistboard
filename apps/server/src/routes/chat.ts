// Chat routes.
//
//   GET  /api/chat/lobby          last lines + viewer posting state (anon read)
//   POST /api/chat/lobby          post a line { text } (signed-in)
//   GET  /api/chat/game/:roomId   per-game spectator chat
//   POST /api/chat/game/:roomId   post a line to that game's spectator chat
//   GET  /api/chat/player/:roomId the two players' private room (seat-gated)
//   POST /api/chat/player/:roomId post a line to that private player room
//   GET  /api/chat/study/:studyId per-study chat room
//   POST /api/chat/study/:studyId post a line to that study's chat room
//   GET  /api/chat/lobby/reports  admin: open chat report queue
//   POST /api/chat/lobby/reports/:id admin: resolve/dismiss a report
//   POST /api/chat/{room}/report  signed-in: report a line { lineId, reason? }
//   POST /api/chat/{room}/timeout admin: { handle, reason? } 15-min timeout,
//                                 hides the user's visible lines
//   POST /api/chat/{room}/hide    admin: { lineId, reason? } hide one line
//
// Lobby chat remains behind MISTBOARD_LOBBY_CHAT_ENABLED. Per-game spectator
// rooms, per-study rooms, and per-game player rooms are scoped in the same
// bounded chat_lines table and use the same posting, moderation, report,
// timeout, and retention rules.
//
// game: and player: are DIFFERENT rooms for the same game (lichess anatomy).
// The player room is what the two seats talk in from the live room page; the
// spectator room is what everyone else, and the post-game review page, sees.
// A player line must never appear in the spectator room, so the gate is
// fail-closed: reading or posting to a player room requires a signed-in account
// that holds a seat in that room, verified against room_seat_tokens.
//
// Post guards, in order: room gate (lobby only), signed in, active timeout,
// flood budget (10 lines/min, DB-counted), link denial for accounts under
// 7 days, length (<=140, trimmed). Plaintext rendering keeps links non-clickable for
// everyone; young accounts cannot post them at all.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentAccountUser } from './../account-session.js';
import { CHAT_POLICY, evaluateChatText } from './../chat-policy.js';
import { lobbyChatEnabled } from './../feature-flags.js';
import * as persistence from './../persistence.js';
import {
  readJsonBody,
  requireAdminSession,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

const LINK_PATTERN = /https?:\/\/|www\./i;

type ChatRoomAction = 'room' | 'report' | 'timeout' | 'hide';

type ChatRoomTarget = {
  kind: 'lobby' | 'game' | 'study' | 'player' | 'broadcast';
  room: string;
  /** Bare id inside the room key (the room id / study id); null for the lobby. */
  scopeId: string | null;
  action: ChatRoomAction;
};

export async function tryHandle(
  _ctx: unknown,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (!pathname.startsWith('/api/chat/')) return false;
  const target = chatRoomTarget(pathname);
  const reportResolveMatch = pathname.match(/^\/api\/chat\/lobby\/reports\/([^/]+)$/);
  const handlesLobbyAdminQueue = pathname === '/api/chat/lobby/reports' || !!reportResolveMatch;
  if (!target && !handlesLobbyAdminQueue) return false;

  if ((target?.kind === 'lobby' || handlesLobbyAdminQueue) && !lobbyChatEnabled()) {
    writeJson(response, 404, { error: 'chat_disabled' });
    return true;
  }
  if (!requirePersistence(response)) return true;

  // Player rooms are private to the seats. Admin moderation actions keep their
  // own admin gate below; everything a viewer can do (read, post, report) needs
  // a seat here.
  if (target?.kind === 'player' && target.action !== 'timeout' && target.action !== 'hide') {
    const viewer = await currentAccountUser(request);
    if (!viewer) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    if (!(await persistence.isRoomSeatUser(target.scopeId ?? '', viewer.id))) {
      writeJson(response, 403, { error: 'not_a_player' });
      return true;
    }
  }

  // A broadcast's room is one per event (lichess's relay chat), shared by its
  // boards grid and every board. Only an event that exists has one, so a
  // made-up slug cannot open a room.
  if (target?.kind === 'broadcast' && target.action === 'room') {
    if (!(await persistence.getXiangqiBroadcastTour(target.scopeId ?? ''))) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
  }

  if (pathname === '/api/chat/lobby/reports') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const statusParam = parsedUrl.searchParams.get('status');
    const status = statusParam === 'resolved' || statusParam === 'dismissed' ? statusParam : 'open';
    const reports = await persistence.listChatReports({ status, limit: 100 });
    writeJson(response, 200, { reports: reports.map(serializeChatReport) });
    return true;
  }

  if (reportResolveMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const admin = await currentAccountUser(request);
    if (!admin) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const status = body.status === 'dismissed' ? 'dismissed' : 'resolved';
    const note =
      typeof body.note === 'string' ? body.note.slice(0, CHAT_POLICY.reportReasonMax) : undefined;
    const updated = await persistence.resolveChatReport({
      reportId: decodeURIComponent(reportResolveMatch[1] ?? ''),
      status,
      resolvedById: admin.id,
      note,
    });
    if (!updated) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (target?.action === 'report') {
    if (!requireMethod(request, response, 'POST')) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const lineId = typeof body.lineId === 'string' ? body.lineId.trim() : '';
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, CHAT_POLICY.reportReasonMax)
        : 'Chat message report';
    if (!lineId) {
      writeJson(response, 400, { error: 'invalid_line' });
      return true;
    }
    const result = await persistence.createChatReport({
      id: `chrpt_${randomUUID()}`,
      lineId,
      reporterId: user.id,
      reason,
    });
    if (!result.ok) {
      const status =
        result.error === 'line_not_found' ? 404 : result.error === 'already_reported' ? 409 : 403;
      writeJson(response, status, { error: result.error });
      return true;
    }
    writeJson(response, 201, {
      report: serializeChatReport(result.report),
      openReportsForLine: result.openReportsForLine,
    });
    return true;
  }

  if (target?.action === 'timeout') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const admin = await currentAccountUser(request);
    if (!admin) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
    if (!handle) {
      writeJson(response, 400, { error: 'invalid_handle' });
      return true;
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 240) : undefined;
    const result = await persistence.createChatTimeout({
      id: `chto_${randomUUID()}`,
      room: target.room,
      targetHandle: handle,
      durationMs: CHAT_POLICY.timeoutMs,
      reason,
      createdById: admin.id,
    });
    if (!result.ok) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { ok: true, until: result.until.toISOString() });
    return true;
  }

  if (target?.action === 'hide') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const admin = await currentAccountUser(request);
    if (!admin) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const body = await readJsonBody(request);
    const lineId = typeof body.lineId === 'string' ? body.lineId : '';
    if (!lineId) {
      writeJson(response, 400, { error: 'invalid_line' });
      return true;
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 240) : undefined;
    const hidden = await persistence.hideChatLine({ lineId, hiddenById: admin.id, reason });
    if (!hidden) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, { ok: true });
    return true;
  }

  if (target?.action !== 'room') return false;

  if (request.method === 'GET') {
    const lines = await persistence.listChatLines(target.room, CHAT_POLICY.servedLines);
    const viewer = await currentAccountUser(request);
    const timeoutUntil = viewer
      ? await persistence.activeChatTimeout(target.room, viewer.id)
      : null;
    writeJson(response, 200, {
      lines: lines.map((line) => ({
        id: line.id,
        handle: line.authorHandle,
        text: line.bodyText,
        createdAt: line.createdAt.toISOString(),
      })),
      canPost: !!viewer && !timeoutUntil,
      canReport: !!viewer,
      viewerHandle: viewer?.handle ?? null,
      ...(timeoutUntil ? { timeoutUntil: timeoutUntil.toISOString() } : {}),
      isAdmin: viewer?.accountRole === 'admin',
    });
    return true;
  }

  if (request.method === 'POST') {
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const now = new Date();
    const timeoutUntil = await persistence.activeChatTimeout(target.room, user.id, now);
    if (timeoutUntil) {
      writeJson(response, 403, { error: 'timed_out', until: timeoutUntil.toISOString() });
      return true;
    }
    const body = await readJsonBody(request);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length === 0 || text.length > CHAT_POLICY.maxLineChars) {
      writeJson(response, 400, { error: 'invalid_message' });
      return true;
    }
    const policy = evaluateChatText(text);
    if (policy.action === 'reject') {
      writeJson(response, 403, { error: 'message_rejected', reason: policy.reason });
      return true;
    }
    if (
      now.getTime() - user.createdAt.getTime() < CHAT_POLICY.youngAccountMs &&
      LINK_PATTERN.test(text)
    ) {
      writeJson(response, 403, { error: 'links_not_allowed' });
      return true;
    }
    if (
      (await persistence.countRecentChatLinesByUser(
        user.id,
        new Date(now.getTime() - CHAT_POLICY.floodWindowMs),
      )) >= CHAT_POLICY.floodLimitPerWindow
    ) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    if (
      (await persistence.countRecentMatchingChatLinesByUser({
        userId: user.id,
        bodyText: text,
        since: new Date(now.getTime() - CHAT_POLICY.repeatedWindowMs),
      })) >= CHAT_POLICY.repeatedLimitPerWindow
    ) {
      writeJson(response, 429, { error: 'repeated_message' });
      return true;
    }
    const id = `chln_${randomUUID()}`;
    await persistence.addChatLine({
      id,
      room: target.room,
      authorId: user.id,
      bodyText: text,
      moderationStatus: policy.status,
      moderationReason: policy.reason,
      now,
    });
    await persistence.pruneChatLines(target.room, CHAT_POLICY.retainedLines);
    writeJson(response, 201, {
      line: { id, handle: user.handle, text, createdAt: now.toISOString() },
    });
    return true;
  }

  writeJson(response, 405, { error: 'method_not_allowed' });
  return true;
}

function chatRoomTarget(pathname: string): ChatRoomTarget | null {
  if (pathname === '/api/chat/lobby') {
    return { kind: 'lobby', room: persistence.CHAT_ROOM_LOBBY, scopeId: null, action: 'room' };
  }
  const lobbyAction = pathname.match(/^\/api\/chat\/lobby\/(report|timeout|hide)$/);
  if (lobbyAction) {
    return {
      kind: 'lobby',
      room: persistence.CHAT_ROOM_LOBBY,
      scopeId: null,
      action: lobbyAction[1] as ChatRoomAction,
    };
  }

  const scopedMatch = pathname.match(
    /^\/api\/chat\/(game|study|player|broadcast)\/([^/]+)(?:\/(report|timeout|hide))?$/,
  );
  if (!scopedMatch) return null;
  const kind = scopedMatch[1] as 'game' | 'study' | 'player' | 'broadcast';
  const roomId = decodeChatRoomSegment(scopedMatch[2] ?? '');
  if (!roomId) return null;
  return {
    kind,
    room: `${kind}:${roomId}`,
    scopeId: roomId,
    action: (scopedMatch[3] as ChatRoomAction | undefined) ?? 'room',
  };
}

function decodeChatRoomSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (decoded.length === 0 || decoded.length > 160) return null;
  if (hasControlCharacter(decoded)) return null;
  return decoded;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function serializeChatReport(report: persistence.ChatReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    lineId: report.lineId,
    reporterHandle: report.reporterHandle,
    lineAuthorHandle: report.lineAuthorHandle,
    lineText: report.lineText,
    reason: report.reason,
    status: report.status,
    moderationStatus: report.moderationStatus,
    moderationReason: report.moderationReason,
    createdAt: report.createdAt.toISOString(),
  };
}
