import { randomUUID } from 'node:crypto';
import type { RoomTimeControl } from '@mistboard/game';

export const LIVE_INVITE_TTL_MS = 60_000;
export const LIVE_INVITE_POLL_MS = 5_000;
export const LIVE_INVITE_RETENTION_MS = 5 * 60_000;
export const LIVE_INVITE_PENDING_CAP = 3;
export const LIVE_INVITE_SEND_LIMIT = 5;
export const LIVE_INVITE_STORE_CAP = 2_000;

export type LiveInviteParty = { userId: string; handle: string; displayName: string };
export type LiveInviteTerms = {
  gameSpecId: string;
  timeControl: RoomTimeControl;
  preferredColor: 'first' | 'second' | 'random';
  rated: boolean;
};
export type LiveInvite = LiveInviteTerms & {
  id: string;
  sender: LiveInviteParty;
  target: LiveInviteParty;
  createdAt: number;
  expiresAt: number;
  status:
    | 'pending'
    | 'accepting'
    | 'accepted'
    | 'cancelled'
    | 'declined'
    | 'expired'
    | 'unavailable';
  closedAt: number | null;
  room?: { id: string; senderSeat: string; targetSeat: string };
};
export type LiveInviteCreateError = 'duplicate_invite' | 'pending_invite_limit' | 'invite_capacity';

// All writes after asynchronous eligibility checks are synchronous: concurrent
// sends cannot race the pair, pending or global caps. Acceptance claims an
// offer synchronously before asynchronous creation. Restart forgets offers;
// accepted rooms and account seats survive in the durable room store.
export class LiveInviteStore {
  private readonly invites = new Map<string, LiveInvite>();
  private readonly sends = new Map<string, number[]>();

  constructor(private readonly capacity = LIVE_INVITE_STORE_CAP) {}

  allowSend(userId: string, now: number): boolean {
    this.prune(now);
    const hits = this.sends.get(userId) ?? [];
    if (hits.length >= LIVE_INVITE_SEND_LIMIT) return false;
    if (!this.sends.has(userId) && this.sends.size >= this.capacity) return false;
    hits.push(now);
    this.sends.set(userId, hits);
    return true;
  }

  create(
    sender: LiveInviteParty,
    target: LiveInviteParty,
    terms: LiveInviteTerms,
    now: number,
  ): { ok: true; invite: LiveInvite } | { ok: false; error: LiveInviteCreateError } {
    this.prune(now);
    const pending = [...this.invites.values()].filter(
      (invite) => invite.status === 'pending' || invite.status === 'accepting',
    );
    if (
      pending.some(
        (invite) =>
          (invite.sender.userId === sender.userId && invite.target.userId === target.userId) ||
          (invite.sender.userId === target.userId && invite.target.userId === sender.userId),
      )
    )
      return { ok: false, error: 'duplicate_invite' };
    for (const id of [sender.userId, target.userId]) {
      if (
        pending.filter((invite) => invite.sender.userId === id || invite.target.userId === id)
          .length >= LIVE_INVITE_PENDING_CAP
      )
        return { ok: false, error: 'pending_invite_limit' };
    }
    // Terminal rows may be evicted early under pressure; live offers never are.
    if (this.invites.size >= this.capacity) {
      for (const [id, invite] of this.invites) {
        if (invite.status !== 'pending' && invite.status !== 'accepting') {
          this.invites.delete(id);
          break;
        }
      }
    }
    if (this.invites.size >= this.capacity) return { ok: false, error: 'invite_capacity' };
    const invite: LiveInvite = {
      ...structuredClone(terms),
      sender: { ...sender },
      target: { ...target },
      id: randomUUID(),
      createdAt: now,
      expiresAt: now + LIVE_INVITE_TTL_MS,
      status: 'pending',
      closedAt: null,
    };
    this.invites.set(invite.id, invite);
    return { ok: true, invite: structuredClone(invite) };
  }

  getFor(id: string, userId: string, now: number): LiveInvite | null {
    this.prune(now);
    const invite = this.invites.get(id);
    return invite && (invite.sender.userId === userId || invite.target.userId === userId)
      ? structuredClone(invite)
      : null;
  }

  listFor(userId: string, now: number): LiveInvite[] {
    this.prune(now);
    return [...this.invites.values()]
      .filter(
        (invite) =>
          ['pending', 'accepting', 'accepted'].includes(invite.status) &&
          (invite.sender.userId === userId || invite.target.userId === userId),
      )
      .map((invite) => structuredClone(invite));
  }

  closeFor(
    id: string,
    userId: string,
    action: 'cancelled' | 'declined',
    now: number,
  ): LiveInvite | null {
    const invite = this.getFor(id, userId, now);
    if (
      !invite ||
      (action === 'cancelled' ? invite.sender.userId : invite.target.userId) !== userId
    )
      return null;
    if (invite.status === 'pending') this.finish(id, action, now);
    return this.getFor(id, userId, now);
  }

  invalidate(id: string, now: number): void {
    this.prune(now);
    if (this.invites.get(id)?.status === 'pending') this.finish(id, 'unavailable', now);
  }

  beginAccept(id: string, userId: string, now: number): boolean {
    const invite = this.getFor(id, userId, now);
    if (!invite || invite.target.userId !== userId || invite.status !== 'pending') return false;
    this.invites.get(id)!.status = 'accepting';
    return true;
  }

  accept(id: string, room: NonNullable<LiveInvite['room']>, now: number): void {
    const invite = this.invites.get(id);
    if (invite?.status !== 'accepting') throw new Error('invite not claimed');
    invite.room = { ...room };
    this.finish(id, 'accepted', now);
  }

  retryAccept(id: string, now: number): void {
    const invite = this.invites.get(id);
    if (invite?.status === 'accepting') {
      invite.status = 'pending';
      invite.closedAt = null;
      this.prune(now);
    }
  }

  private finish(id: string, status: LiveInvite['status'], now: number): void {
    const invite = this.invites.get(id)!;
    invite.status = status;
    invite.closedAt = now;
  }

  private prune(now: number): void {
    for (const [id, invite] of this.invites) {
      if (invite.status === 'pending' && invite.expiresAt <= now)
        this.finish(id, 'expired', invite.expiresAt);
      if (invite.closedAt !== null && now >= invite.closedAt + LIVE_INVITE_RETENTION_MS)
        this.invites.delete(id);
    }
    for (const [id, hits] of this.sends) {
      const live = hits.filter((at) => at > now - LIVE_INVITE_TTL_MS);
      if (live.length) this.sends.set(id, live);
      else this.sends.delete(id);
    }
  }
}

export const liveInvites = new LiveInviteStore();

// Deliberate allowlist: account ids, email, preferences, tokens and any future
// internal metadata can never ride a polling response by accident.
export function liveInviteView(invite: LiveInvite, userId: string) {
  if (invite.sender.userId !== userId && invite.target.userId !== userId)
    throw new Error('invite participant required');
  const party = ({ handle, displayName }: LiveInviteParty) => ({ handle, displayName });
  return {
    id: invite.id,
    sender: party(invite.sender),
    target: party(invite.target),
    gameSpecId: invite.gameSpecId,
    timeControl: { ...invite.timeControl },
    preferredColor: invite.preferredColor,
    rated: invite.rated,
    createdAt: new Date(invite.createdAt).toISOString(),
    expiresAt: new Date(invite.expiresAt).toISOString(),
    status: invite.status,
    isMine: invite.sender.userId === userId,
    canAccept: invite.status === 'pending' && invite.target.userId === userId,
    canCancel: invite.status === 'pending' && invite.sender.userId === userId,
    canDecline: invite.status === 'pending' && invite.target.userId === userId,
    ...(invite.status === 'accepted' && invite.room
      ? {
          room: {
            roomId: invite.room.id,
            url: `/room/${encodeURIComponent(invite.room.id)}`,
            seat: invite.sender.userId === userId ? invite.room.senderSeat : invite.room.targetSeat,
          },
        }
      : {}),
  };
}
