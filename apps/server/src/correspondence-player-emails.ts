// Correspondence emails to the players themselves (#1057), beside the seek
// creator's start email (correspondence-start-email.ts):
//   - a direct challenge, to its target;
//   - the start email to whoever accepted a seek or a challenge;
//   - Play the host: the host's "new game" email and the player's receipt,
//     in place of the two generic start emails;
//   - the game-over email, to both players, for any ending including an abort.
//
// Every send goes through persistence.correspondenceStartRecipient, which
// returns a mailbox only for an open account that has an email and has not
// turned off "A correspondence game starts". No new preference: the one switch
// covers every email about a correspondence game beginning or ending.
//
// Text only, never a board: a hidden-information game says nothing here its
// own room would not. Sends are fire-and-forget from the caller's side, so a
// provider outage never fails the post, the accept or the move that ended it.

import { DAY_MS } from '@mistboard/game';
import { crosstableReviewUrl } from './crosstable-review-url.js';
import { logger } from './obs.js';
import type { GameResult } from './persistence.js';
import * as persistence from './persistence.js';
import { SEAT_WIN_RESULT } from './persistence-counted-games.js';
import {
  correspondenceChallengeEmail,
  correspondenceGameOverEmail,
  correspondenceHostReceiptEmail,
  correspondenceHostStartEmail,
  correspondenceJoinedStartEmail,
  emailLocale,
  type GameOverOutcome,
  type PlayerEmail,
} from './player-email.js';
import { sendTransactionalEmail, transactionalEmailConfigured } from './send-email.js';

const fromAddress = process.env.MISTBOARD_AUTH_EMAIL_FROM ?? process.env.RESEND_FROM_EMAIL;
const playerEmailsEnabled = transactionalEmailConfigured && !!fromAddress;

export type PlayerEmailRecipient = {
  email: string;
  locale?: string | null;
  turnDigest?: boolean;
};

export type PlayerEmailName = { name: string; handle: string | null };

export type CorrespondencePlayerEmailDeps = {
  enabled: boolean;
  // A mailbox only when the email should go out: the opt-out lives in the query.
  loadRecipient: (userId: string) => Promise<PlayerEmailRecipient | null>;
  loadName: (userId: string) => Promise<PlayerEmailName | null>;
  reviewPath: (roomId: string, gameSpecId: string) => string | null;
  send: (to: string, email: PlayerEmail, kind: string, ref: string) => Promise<boolean>;
};

function resolveDeps(deps: Partial<CorrespondencePlayerEmailDeps>): CorrespondencePlayerEmailDeps {
  return {
    enabled: deps.enabled ?? playerEmailsEnabled,
    loadRecipient: deps.loadRecipient ?? persistence.correspondenceStartRecipient,
    loadName: deps.loadName ?? persistence.correspondenceUserName,
    reviewPath: deps.reviewPath ?? crosstableReviewUrl,
    send: deps.send ?? sendEmail,
  };
}

function fireAndForget(kind: string, ref: string, run: () => Promise<unknown>): void {
  void run().catch((err) => {
    logger.error(
      { kind: `${kind}_failure`, ref, error: (err as Error).message },
      'correspondence player email failure',
    );
  });
}

// ── Direct challenge ─────────────────────────────────────────────────────────

export type ChallengeNotice = {
  seekId: string;
  gameSpecId: string;
  targetUserId: string;
  challengerName: string;
  challengerHandle: string | null;
  daysPerMove: number;
  rated: boolean;
  expiresAt: Date;
};

export function notifyCorrespondenceChallenge(
  notice: ChallengeNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): void {
  fireAndForget('correspondence_challenge_email', notice.seekId, () =>
    sendCorrespondenceChallengeEmail(notice, deps),
  );
}

export async function sendCorrespondenceChallengeEmail(
  notice: ChallengeNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
  now: number = Date.now(),
): Promise<boolean> {
  const d = resolveDeps(deps);
  if (!d.enabled) return false;
  const recipient = await d.loadRecipient(notice.targetUserId);
  if (!recipient) return false;
  const email = correspondenceChallengeEmail(
    {
      seekId: notice.seekId,
      gameSpecId: notice.gameSpecId,
      challengerName: notice.challengerName,
      challengerHandle: notice.challengerHandle,
      daysPerMove: notice.daysPerMove,
      rated: notice.rated,
      openDays: Math.round((notice.expiresAt.getTime() - now) / DAY_MS),
    },
    emailLocale(recipient.locale),
  );
  return d.send(recipient.email, email, 'correspondence_challenge_email', notice.seekId);
}

/**
 * What the creator's challenge page may say about the target: who they are,
 * and whether a challenge email reaches them now. "Not emailed" never says
 * why (opted out, no address, email off on this server).
 */
export async function challengeTargetStatus(
  targetUserId: string,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): Promise<{ name: string | null; handle: string | null; emailed: boolean }> {
  const d = resolveDeps(deps);
  const [name, recipient] = await Promise.all([
    d.loadName(targetUserId),
    d.enabled ? d.loadRecipient(targetUserId) : Promise.resolve(null),
  ]);
  return { name: name?.name ?? null, handle: name?.handle ?? null, emailed: recipient !== null };
}

// ── Start: the accepter, and Play the host ───────────────────────────────────

export type AcceptedStartNotice = {
  roomId: string;
  gameSpecId: string;
  daysPerMove: number;
  creatorUserId: string;
  accepter: { id: string; displayName: string; handle: string };
  accepterOnMove: boolean;
};

export function notifyCorrespondenceJoinedStart(
  notice: AcceptedStartNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): void {
  fireAndForget('correspondence_joined_email', notice.roomId, () =>
    sendCorrespondenceJoinedStartEmail(notice, deps),
  );
}

/** To the accepter of an ordinary seek or challenge. */
export async function sendCorrespondenceJoinedStartEmail(
  notice: AcceptedStartNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): Promise<boolean> {
  const d = resolveDeps(deps);
  if (!d.enabled) return false;
  const recipient = await d.loadRecipient(notice.accepter.id);
  if (!recipient) return false;
  const creator = await d.loadName(notice.creatorUserId);
  const email = correspondenceJoinedStartEmail(
    {
      roomId: notice.roomId,
      gameSpecId: notice.gameSpecId,
      opponentName: creator?.name ?? null,
      recipientOnMove: notice.accepterOnMove,
      daysPerMove: notice.daysPerMove,
    },
    emailLocale(recipient.locale),
  );
  return d.send(recipient.email, email, 'correspondence_joined_email', notice.roomId);
}

export function notifyCorrespondenceHostStart(
  notice: AcceptedStartNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): void {
  fireAndForget('correspondence_host_start_email', notice.roomId, () =>
    sendCorrespondenceHostStartEmails(notice, deps),
  );
}

/**
 * Play the host: the host (the seek's creator) gets "New game: X started ...",
 * the player (the accepter) a receipt saying what happens next. Each send is
 * gated on its own recipient's opt-out; one failing does not stop the other.
 */
export async function sendCorrespondenceHostStartEmails(
  notice: AcceptedStartNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): Promise<{ host: boolean; player: boolean }> {
  const d = resolveDeps(deps);
  if (!d.enabled) return { host: false, player: false };
  const [hostRecipient, playerRecipient, hostName] = await Promise.all([
    d.loadRecipient(notice.creatorUserId),
    d.loadRecipient(notice.accepter.id),
    d.loadName(notice.creatorUserId),
  ]);
  const [host, player] = await Promise.all([
    hostRecipient
      ? d
          .send(
            hostRecipient.email,
            correspondenceHostStartEmail(
              {
                roomId: notice.roomId,
                gameSpecId: notice.gameSpecId,
                playerName: notice.accepter.displayName || notice.accepter.handle,
                playerHandle: notice.accepter.handle,
                hostOnMove: !notice.accepterOnMove,
                daysPerMove: notice.daysPerMove,
              },
              emailLocale(hostRecipient.locale),
            ),
            'correspondence_host_start_email',
            notice.roomId,
          )
          .catch(logSendError('correspondence_host_start_email', notice.roomId))
      : false,
    playerRecipient && hostName
      ? d
          .send(
            playerRecipient.email,
            correspondenceHostReceiptEmail(
              {
                roomId: notice.roomId,
                gameSpecId: notice.gameSpecId,
                hostName: hostName.name,
                playerOnMove: notice.accepterOnMove,
                daysPerMove: notice.daysPerMove,
                turnDigest: playerRecipient.turnDigest === true,
              },
              emailLocale(playerRecipient.locale),
            ),
            'correspondence_host_receipt_email',
            notice.roomId,
          )
          .catch(logSendError('correspondence_host_receipt_email', notice.roomId))
      : false,
  ]);
  return { host, player };
}

function logSendError(kind: string, ref: string) {
  return (err: unknown): false => {
    logger.error(
      { kind: `${kind}_failure`, ref, error: (err as Error).message },
      'correspondence player email failure',
    );
    return false;
  };
}

// ── Game over ────────────────────────────────────────────────────────────────

export type GameOverSeat = {
  color: string;
  userId: string | null;
  name: string | null;
  // The result this seat's win is stored as, from the tenant's own mapping;
  // absent falls back to SEAT_WIN_RESULT by colour.
  winResult?: GameResult;
};

export type GameOverNotice = {
  roomId: string;
  gameSpecId: string;
  // Null, or no winner, for an abort.
  result: GameResult | null;
  aborted: boolean;
  termination: string | null;
  seats: GameOverSeat[];
};

export type GameOverLetter = {
  userId: string;
  outcome: GameOverOutcome;
  opponentName: string | null;
};

/** Who gets which game-over email. Pure, so the seat mapping is testable. */
export function gameOverLetters(notice: GameOverNotice): GameOverLetter[] {
  const letters: GameOverLetter[] = [];
  for (const seat of notice.seats) {
    if (!seat.userId) continue;
    const opponent = notice.seats.find((other) => other.color !== seat.color);
    letters.push({
      userId: seat.userId,
      outcome: seatOutcome(seat, notice),
      opponentName: opponent?.name ?? null,
    });
  }
  return letters;
}

function seatOutcome(seat: GameOverSeat, notice: GameOverNotice): GameOverOutcome {
  if (notice.aborted || !notice.result) return 'cancelled';
  if (notice.result === 'draw') return 'draw';
  const win =
    seat.winResult ?? (SEAT_WIN_RESULT as Record<string, GameResult | undefined>)[seat.color];
  return win === notice.result ? 'won' : 'lost';
}

export function notifyCorrespondenceGameOver(
  notice: GameOverNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): void {
  fireAndForget('correspondence_game_over_email', notice.roomId, () =>
    sendCorrespondenceGameOverEmails(notice, deps),
  );
}

export async function sendCorrespondenceGameOverEmails(
  notice: GameOverNotice,
  deps: Partial<CorrespondencePlayerEmailDeps> = {},
): Promise<number> {
  const d = resolveDeps(deps);
  if (!d.enabled) return 0;
  const reviewPath = d.reviewPath(notice.roomId, notice.gameSpecId);
  const sent = await Promise.all(
    gameOverLetters(notice).map(async (letter) => {
      const recipient = await d.loadRecipient(letter.userId);
      if (!recipient) return false;
      const email = correspondenceGameOverEmail(
        {
          roomId: notice.roomId,
          gameSpecId: notice.gameSpecId,
          opponentName: letter.opponentName,
          outcome: letter.outcome,
          termination: notice.termination,
          reviewPath,
        },
        emailLocale(recipient.locale),
      );
      return d
        .send(recipient.email, email, 'correspondence_game_over_email', notice.roomId)
        .catch(logSendError('correspondence_game_over_email', notice.roomId));
    }),
  );
  return sent.filter(Boolean).length;
}

// ── Transport ────────────────────────────────────────────────────────────────

async function sendEmail(
  to: string,
  email: PlayerEmail,
  kind: string,
  ref: string,
): Promise<boolean> {
  if (!fromAddress) return false;
  const result = await sendTransactionalEmail({
    from: fromAddress,
    to: [to],
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  if (!result.ok) {
    logger.error(
      { kind: `${kind}_rejected`, ref, status_code: result.statusCode, error: result.error },
      'correspondence player email rejected',
    );
    return false;
  }
  logger.info({ kind: `${kind}_sent`, ref }, 'correspondence player email sent');
  return true;
}
