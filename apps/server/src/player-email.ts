/**
 * Words for the inbox and correspondence emails a player receives: unread
 * message notices, game starts, deadline warnings and daily "your move" digests. Each sender
 * module (correspondence-start-email.ts, correspondence-deadline-warning.ts,
 * correspondence-turn-digest.ts, inbox-email.ts) keeps its own policy (who,
 * when, throttles, opt-outs) and calls a builder here for the subject and body; every
 * body renders through email-layout.ts.
 *
 * Two rules the builders keep:
 * - The subject identifies the game (variant and opponent) or message sender.
 *   Gmail threads mail by subject, so identical subjects ("Your game has
 *   started") folded different games into one conversation.
 * - Every email says why it was sent and links to where it can be turned off.
 *
 * zh copy is machine translation (site policy since 2026-08-29) and reuses the
 * site's published terms: 通信对局, 求战, 轮到你走, 去走棋, 每步 N 天.
 * The copy carries no em dashes (site copy rule).
 */

import { type GameSpecId, maybeGameSpecForId } from '@mistboard/game';
import {
  type EmailLang,
  emailPublicHost,
  type RenderedEmail,
  renderEmail,
} from './email-layout.js';

export type EmailLocale = EmailLang;

export type PlayerEmail = RenderedEmail & { subject: string };

// users.locale is 'en' | 'zh-Hans' | 'zh-Hant' | NULL; anything else is English.
export function emailLocale(value: string | null | undefined): EmailLocale {
  return value === 'zh-Hans' || value === 'zh-Hant' ? value : 'en';
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ── Links ────────────────────────────────────────────────────────────────────

export function roomUrl(roomId: string): string {
  return `${emailPublicHost}/room/${encodeURIComponent(roomId)}`;
}

export const correspondenceGamesUrl = `${emailPublicHost}/correspondence`;

// The Notifications section of account settings, a route of its own. Not
// locale-prefixed: /zh-hans/account/... is not a server route, and the
// settings page renders in the account's own locale anyway.
export const notificationSettingsUrl = `${emailPublicHost}/account/settings/notifications`;

// ── Variant names ────────────────────────────────────────────────────────────

// The site's catalog names (apps/web/src/i18n/catalogs/play*.ts, keyed through
// VARIANT_NAME_KEYS in apps/web/src/game-display.ts). The server has no
// catalog of its own; player-email.test.ts reads the web catalogs and fails
// when a name here drifts from the site. Exhaustive over GameSpecId so a new
// variant fails the build until it is named; null falls back to publicName.
const VARIANT_NAMES: Record<GameSpecId, Record<EmailLocale, string> | null> = {
  gomoku: { en: 'Gomoku', 'zh-Hans': '五子棋', 'zh-Hant': '五子棋' },
  banqi: { en: 'Banqi', 'zh-Hans': '暗棋', 'zh-Hant': '暗棋' },
  // Hidden, unrouted spec; no public catalog name or correspondence support.
  'ffq-banqi': null,
  mahjong: null,
  'three-kingdoms-banqi': {
    en: 'Three Kingdoms Banqi',
    'zh-Hans': '三国暗棋',
    'zh-Hant': '三國暗棋',
  },
  'xiangqi-mahjong': { en: 'Xiangqi Mahjong', 'zh-Hans': '象棋麻将', 'zh-Hant': '象棋麻將' },
  'dark-chess': { en: 'Fog Chess', 'zh-Hans': '迷雾国际象棋', 'zh-Hant': '迷霧西洋棋' },
  'dark-xiangqi': { en: 'Fog Xiangqi', 'zh-Hans': '迷雾象棋', 'zh-Hant': '迷霧象棋' },
  'fortress-xiangqi': { en: 'Fortress Xiangqi', 'zh-Hans': '堡垒象棋', 'zh-Hant': '堡壘象棋' },
  jieqi: { en: 'Jieqi', 'zh-Hans': '揭棋', 'zh-Hant': '揭棋' },
  jungle: { en: 'Jungle Chess', 'zh-Hans': '斗兽棋', 'zh-Hant': '鬥獸棋' },
  'jungle-flip': { en: 'Flip Jungle', 'zh-Hans': '翻翻兽棋', 'zh-Hant': '翻翻獸棋' },
  xiangqi: { en: 'Xiangqi', 'zh-Hans': '象棋', 'zh-Hant': '象棋' },
  'crazyhouse-xiangqi': {
    en: 'Crazyhouse Xiangqi',
    'zh-Hans': '疯狂屋象棋',
    'zh-Hant': '瘋狂屋象棋',
  },
  'duck-xiangqi': { en: 'Duck Xiangqi', 'zh-Hans': '鸭子象棋', 'zh-Hant': '鴨子象棋' },
  'atomic-xiangqi': { en: 'Atomic Xiangqi', 'zh-Hans': '原子象棋', 'zh-Hant': '原子象棋' },
  chess: { en: 'Chess', 'zh-Hans': '国际象棋', 'zh-Hant': '西洋棋' },
};

export const EMAIL_VARIANT_NAMES = VARIANT_NAMES;

// Names that are common nouns in English running prose ("a game of xiangqi"),
// capitalized only in titles and at the start of a sentence. Coined names
// (Fog Xiangqi, Duck Xiangqi, Jungle Chess, ...) keep their capitals.
// Site voice rule, settled 2026-09-29.
const PROSE_LOWERCASE = new Set(['Xiangqi', 'Jieqi', 'Banqi', 'Chess']);

/** The variant's name; `prose` lowercases the common-noun names in English. */
export function variantName(gameSpecId: string, locale: EmailLocale, prose = false): string {
  const spec = maybeGameSpecForId(gameSpecId);
  if (!spec) return locale === 'en' ? (prose ? 'correspondence' : 'Correspondence') : '通信';
  const name = VARIANT_NAMES[spec.id]?.[locale] ?? spec.publicName;
  return locale === 'en' && prose && PROSE_LOWERCASE.has(name) ? name.toLowerCase() : name;
}

// ── Durations ────────────────────────────────────────────────────────────────

export function formatRemaining(ms: number, locale: EmailLocale): string {
  const hours = Math.max(1, Math.round(ms / HOUR_MS));
  if (hours < 36) return COPY[locale].hours(hours);
  return COPY[locale].days(Math.round(hours / 24));
}

export function daysPerMoveFromAllowance(allowanceMs: number): number {
  return Math.max(1, Math.round(allowanceMs / DAY_MS));
}

// ── Copy ─────────────────────────────────────────────────────────────────────

type Copy = {
  hours: (n: number) => string;
  days: (n: number) => string;
  pace: (days: number) => string;
  someone: string;
  manage: string;
  playYourMove: string;
  // `v` is the sentence-start name, `vp` the running-prose name.
  start: {
    subject: (v: string, vp: string, opp: string | null, onMove: boolean) => string;
    headline: (v: string, vp: string, opp: string | null) => string;
    onMove: (opp: string, pace: string) => string[];
    waiting: (opp: string, pace: string) => string[];
    openGame: string;
    reason: string;
  };
  deadline: {
    subject: (v: string, vp: string, opp: string | null) => string;
    headline: (left: string) => string;
    body: (vp: string, opp: string | null, pace: string, left: string) => string[];
    reason: string;
  };
  digest: {
    subject: (v: string, vp: string, opp: string | null, others: number) => string;
    headline: (count: number) => string;
    item: (v: string, opp: string | null, left: string) => string;
    allGames: string;
    reason: string;
  };
};

const COPY: Record<EmailLocale, Copy> = {
  en: {
    hours: (n) => (n === 1 ? '1 hour' : `${n} hours`),
    days: (n) => (n === 1 ? '1 day' : `${n} days`),
    pace: (d) => (d === 1 ? '1 day per move' : `${d} days per move`),
    someone: 'Someone',
    manage: 'Manage email notifications',
    playYourMove: 'Play your move',
    start: {
      subject: (v, vp, opp, onMove) =>
        (opp ? `${v} with ${opp} has started` : `Your ${vp} game has started`) +
        (onMove ? ': your move' : ''),
      headline: (v, vp, opp) =>
        opp ? `${v} with ${opp} has started` : `Your ${vp} game has started`,
      onMove: (opp, pace) => [
        `${opp} accepted your correspondence seek, and you have the first move.`,
        `The pace is ${pace}. If your clock runs out before you play, the game is cancelled.`,
      ],
      waiting: (opp, pace) => [
        `${opp} accepted your correspondence seek and has the first move.`,
        `The pace is ${pace}. If the first move is not played in time, the game is cancelled.`,
      ],
      openGame: 'Open the game',
      reason:
        'You got this email because someone accepted a correspondence seek you posted on Mistboard.',
    },
    deadline: {
      subject: (_v, vp, opp) =>
        opp
          ? `Your move against ${opp} in ${vp} is running out of time`
          : `Your move in ${vp} is running out of time`,
      headline: (left) => `About ${left} left on your clock`,
      body: (vp, opp, pace, left) => [
        `It's your move in your ${vp} game against ${opp ?? 'your opponent'} (${pace}), and your clock runs out in about ${left}.`,
        'If the clock runs out, the game is forfeited, or cancelled if the opening moves were never played.',
      ],
      reason:
        'You got this email because your clock is running low in a correspondence game on Mistboard.',
    },
    digest: {
      subject: (_v, vp, opp, others) =>
        `Your move in ${vp}${opp ? ` against ${opp}` : ''}` +
        (others === 0 ? '' : others === 1 ? ' and 1 other game' : ` and ${others} other games`),
      headline: (count) =>
        count === 1
          ? 'A correspondence game is waiting on your move'
          : `${count} correspondence games are waiting on your move`,
      item: (v, opp, left) => `${v} against ${opp ?? 'your opponent'}, ${left} left`,
      allGames: 'See all your games',
      reason:
        'You get at most one of these a day, and only while a game has been waiting on your move.',
    },
  },
  'zh-Hans': {
    hours: (n) => `${n} 小时`,
    days: (n) => `${n} 天`,
    pace: (d) => `每步 ${d} 天`,
    someone: '有人',
    manage: '管理邮件通知',
    playYourMove: '去走棋',
    start: {
      subject: (_v, vp, opp, onMove) =>
        (opp ? `与 ${opp} 的${vp}对局已开始` : `你的${vp}对局已开始`) +
        (onMove ? '：轮到你走' : ''),
      headline: (_v, vp, opp) => (opp ? `与 ${opp} 的${vp}对局已开始` : `你的${vp}对局已开始`),
      onMove: (opp, pace) => [
        `${opp} 接受了你发布的通信对局求战，由你先走。`,
        `${pace}。如果你在时间用完前还没有走棋，对局将被取消。`,
      ],
      waiting: (opp, pace) => [
        `${opp} 接受了你发布的通信对局求战，由对方先走。`,
        `${pace}。如果第一步没有按时走出，对局将被取消。`,
      ],
      openGame: '打开对局',
      reason: '你收到这封邮件，是因为有人接受了你在 Mistboard 发布的通信对局求战。',
    },
    deadline: {
      subject: (_v, vp, opp) =>
        opp ? `与 ${opp} 的${vp}对局：你的时间快用完了` : `你的${vp}对局：你的时间快用完了`,
      headline: (left) => `你的时间还剩大约 ${left}`,
      body: (vp, opp, pace, left) => [
        `在${opp ? `与 ${opp} 的` : '你的'}${vp}对局中轮到你走（${pace}），你的时间还剩大约 ${left}。`,
        '如果时间用完，你将被判负；如果开局着法还没有走完，对局将被取消。',
      ],
      reason: '你收到这封邮件，是因为你在 Mistboard 的一盘通信对局中时间快用完了。',
    },
    digest: {
      subject: (_v, vp, opp, others) =>
        `轮到你走：${opp ? `与 ${opp} 的` : ''}${vp}对局` +
        (others === 0 ? '' : `等 ${others + 1} 盘`),
      headline: (count) =>
        count === 1 ? '有一盘通信对局在等你走棋' : `有 ${count} 盘通信对局在等你走棋`,
      item: (v, opp, left) => `${opp ? `与 ${opp} 的` : ''}${v}对局，剩余 ${left}`,
      allGames: '查看你的所有对局',
      reason: '这类邮件每天最多一封，并且只在有对局等你走棋时发送。',
    },
  },
  'zh-Hant': {
    hours: (n) => `${n} 小時`,
    days: (n) => `${n} 天`,
    pace: (d) => `每步 ${d} 天`,
    someone: '有人',
    manage: '管理電子郵件通知',
    playYourMove: '去走棋',
    start: {
      subject: (_v, vp, opp, onMove) =>
        (opp ? `與 ${opp} 的${vp}對局已開始` : `你的${vp}對局已開始`) +
        (onMove ? '：輪到你走' : ''),
      headline: (_v, vp, opp) => (opp ? `與 ${opp} 的${vp}對局已開始` : `你的${vp}對局已開始`),
      onMove: (opp, pace) => [
        `${opp} 接受了你發布的通信對局求戰，由你先走。`,
        `${pace}。如果你在時間用完前還沒有走棋，對局將被取消。`,
      ],
      waiting: (opp, pace) => [
        `${opp} 接受了你發布的通信對局求戰，由對方先走。`,
        `${pace}。如果第一步沒有按時走出，對局將被取消。`,
      ],
      openGame: '打開對局',
      reason: '你收到這封電子郵件，是因為有人接受了你在 Mistboard 發布的通信對局求戰。',
    },
    deadline: {
      subject: (_v, vp, opp) =>
        opp ? `與 ${opp} 的${vp}對局：你的時間快用完了` : `你的${vp}對局：你的時間快用完了`,
      headline: (left) => `你的時間還剩大約 ${left}`,
      body: (vp, opp, pace, left) => [
        `在${opp ? `與 ${opp} 的` : '你的'}${vp}對局中輪到你走（${pace}），你的時間還剩大約 ${left}。`,
        '如果時間用完，你將被判負；如果開局著法還沒有走完，對局將被取消。',
      ],
      reason: '你收到這封電子郵件，是因為你在 Mistboard 的一盤通信對局中時間快用完了。',
    },
    digest: {
      subject: (_v, vp, opp, others) =>
        `輪到你走：${opp ? `與 ${opp} 的` : ''}${vp}對局` +
        (others === 0 ? '' : `等 ${others + 1} 盤`),
      headline: (count) =>
        count === 1 ? '有一盤通信對局在等你走棋' : `有 ${count} 盤通信對局在等你走棋`,
      item: (v, opp, left) => `${opp ? `與 ${opp} 的` : ''}${v}對局，剩餘 ${left}`,
      allGames: '查看你的所有對局',
      reason: '這類電子郵件每天最多一封，並且只在有對局等你走棋時寄送。',
    },
  },
};

function manageLink(copy: Copy) {
  return { label: copy.manage, url: notificationSettingsUrl };
}

// ── Builders ─────────────────────────────────────────────────────────────────

// Metadata only. Message bodies and previews are never renderer inputs.
export type InboxNoticeEmailInput = {
  senderHandle: string;
  senderName: string;
  unsubscribeUrl: string;
};

const INBOX_COPY: Record<
  EmailLocale,
  {
    subject: (sender: string) => string;
    openInbox: string;
    reason: string;
    unsubscribe: string;
  }
> = {
  en: {
    subject: (sender) => `Unread message from ${sender}`,
    openInbox: 'Open your inbox',
    reason: 'You received this email because you have an unread message on Mistboard.',
    unsubscribe: 'Unsubscribe from message emails',
  },
  'zh-Hans': {
    subject: (sender) => `${sender}发来的未读私信`,
    openInbox: '打开收件箱',
    reason: '你收到这封邮件，是因为你在 Mistboard 有未读私信。',
    unsubscribe: '退订私信邮件通知',
  },
  'zh-Hant': {
    subject: (sender) => `${sender}發來的未讀私訊`,
    openInbox: '打開收件匣',
    reason: '你收到這封電子郵件，是因為你在 Mistboard 有未讀私訊。',
    unsubscribe: '取消訂閱私訊郵件通知',
  },
};

export function inboxNoticeEmail(input: InboxNoticeEmailInput, locale: EmailLocale): PlayerEmail {
  const copy = INBOX_COPY[locale];
  const sender =
    locale === 'en'
      ? `${input.senderName} (@${input.senderHandle})`
      : `${input.senderName}（@${input.senderHandle}）`;
  const subject = copy.subject(sender);
  return {
    subject,
    ...renderEmail({
      lang: locale,
      headline: subject,
      paragraphs: [],
      button: { label: copy.openInbox, url: `${emailPublicHost}/inbox` },
      footer: {
        reason: copy.reason,
        manage: { label: copy.unsubscribe, url: input.unsubscribeUrl },
      },
    }),
  };
}

export type StartEmailInput = {
  roomId: string;
  gameSpecId: string;
  opponentName: string | null;
  creatorOnMove: boolean;
  daysPerMove: number;
};

export function correspondenceStartEmail(input: StartEmailInput, locale: EmailLocale): PlayerEmail {
  const copy = COPY[locale];
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const pace = copy.pace(input.daysPerMove);
  const opponent = input.opponentName ?? copy.someone;
  const subject = copy.start.subject(v, vp, input.opponentName, input.creatorOnMove);
  const rendered = renderEmail({
    lang: locale,
    headline: copy.start.headline(v, vp, input.opponentName),
    paragraphs: input.creatorOnMove
      ? copy.start.onMove(opponent, pace)
      : copy.start.waiting(opponent, pace),
    button: {
      label: input.creatorOnMove ? copy.playYourMove : copy.start.openGame,
      url: roomUrl(input.roomId),
    },
    footer: { reason: copy.start.reason, manage: manageLink(copy) },
  });
  return { subject, ...rendered };
}

export type DeadlineEmailInput = {
  roomId: string;
  gameSpecId: string;
  opponentName: string | null;
  allowanceMs: number;
  remainingMs: number;
};

export function correspondenceDeadlineEmail(
  input: DeadlineEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const left = formatRemaining(input.remainingMs, locale);
  const pace = copy.pace(daysPerMoveFromAllowance(input.allowanceMs));
  const rendered = renderEmail({
    lang: locale,
    headline: copy.deadline.headline(left),
    paragraphs: copy.deadline.body(vp, input.opponentName, pace, left),
    button: { label: copy.playYourMove, url: roomUrl(input.roomId) },
    footer: { reason: copy.deadline.reason, manage: manageLink(copy) },
  });
  return { subject: copy.deadline.subject(v, vp, input.opponentName), ...rendered };
}

export type DigestEmailGame = {
  roomId: string;
  gameSpecId: string;
  opponentName: string | null;
  dueAt: Date;
};

export function correspondenceDigestEmail(
  games: readonly DigestEmailGame[],
  now: Date,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const first = games[0];
  const items = games.map((game) => ({
    text: copy.digest.item(
      variantName(game.gameSpecId, locale),
      game.opponentName,
      formatRemaining(game.dueAt.getTime() - now.getTime(), locale),
    ),
    url: roomUrl(game.roomId),
  }));
  const subject = first
    ? copy.digest.subject(
        variantName(first.gameSpecId, locale),
        variantName(first.gameSpecId, locale, true),
        first.opponentName,
        games.length - 1,
      )
    : copy.digest.headline(0);
  const rendered = renderEmail({
    lang: locale,
    preheader: items.map((item) => item.text).join(' · '),
    headline: copy.digest.headline(games.length),
    paragraphs: [],
    items,
    button:
      games.length === 1 && first
        ? { label: copy.playYourMove, url: roomUrl(first.roomId) }
        : { label: copy.digest.allGames, url: correspondenceGamesUrl },
    footer: { reason: copy.digest.reason, manage: manageLink(copy) },
  });
  return { subject, ...rendered };
}

// ── Challenges, starts and results (#1057) ───────────────────────────────────
//
// Sent by correspondence-player-emails.ts: a direct challenge to its target, the
// start email to whoever joined a seek, the two Play-the-host start emails, and
// the game-over email to both players. Text only: no board, so a hidden-
// information game says nothing its own room would not.

export function challengeUrl(seekId: string): string {
  return `${emailPublicHost}/challenge/${encodeURIComponent(seekId)}`;
}

/** A path from crosstableReviewUrl, or the room when the variant has no review page. */
export function gameReviewUrl(roomId: string, reviewPath: string | null): string {
  return reviewPath ? `${emailPublicHost}${reviewPath}` : roomUrl(roomId);
}

/**
 * Play again (#606) is built separately. When it lands, return its URL here:
 * the game-over email shows a second link whenever this is not null, with no
 * other change. Null until then, so the email offers only the review.
 */
export function correspondencePlayAgainUrl(_game: {
  roomId: string;
  gameSpecId: string;
}): string | null {
  return null;
}

export type GameOverOutcome = 'won' | 'lost' | 'draw' | 'cancelled';

type NoticeCopy = {
  challenge: {
    subject: (challenger: string, v: string, pace: string) => string;
    body: (challenger: string, vp: string, pace: string, rated: boolean, days: number) => string[];
    button: string;
    reason: string;
  };
  joined: {
    onMove: (opp: string, pace: string) => string[];
    waiting: (opp: string, pace: string) => string[];
    reason: string;
  };
  host: {
    subject: (player: string, v: string, pace: string, onMove: boolean) => string;
    onMove: (player: string, vp: string, pace: string) => string[];
    waiting: (player: string, vp: string, pace: string) => string[];
    reason: string;
  };
  receipt: {
    onMove: (host: string, pace: string, days: number) => string[];
    waiting: (host: string, pace: string, days: number) => string[];
    digest: string;
    reason: string;
  };
  over: {
    subject: (vp: string, opp: string | null, outcome: GameOverOutcome) => string;
    endedBy: Partial<Record<string, string>>;
    ended: (how: string) => string;
    cancelled: string;
    review: string;
    playAgain: string;
    reason: string;
  };
};

const NOTICE_COPY: Record<EmailLocale, NoticeCopy> = {
  en: {
    challenge: {
      subject: (challenger, v, pace) => `${challenger} challenged you to ${v}, ${pace}`,
      body: (challenger, vp, pace, rated, days) => [
        `${challenger} sent you a ${rated ? 'rated' : 'casual'} correspondence challenge: ${vp}, ${pace}.`,
        `Accept it to start the game, or decline it on the same page. It stays open for ${days === 1 ? '1 day' : `${days} days`}.`,
      ],
      button: 'See the challenge',
      reason:
        'You got this email because another player challenged you to a correspondence game on Mistboard.',
    },
    joined: {
      onMove: (opp, pace) => [
        `Your correspondence game against ${opp} has started, and you have the first move.`,
        `The pace is ${pace}. If your clock runs out before you play, the game is cancelled.`,
      ],
      waiting: (opp, pace) => [
        `Your correspondence game against ${opp} has started, and ${opp} has the first move.`,
        `The pace is ${pace}. Your correspondence page shows when it is your move.`,
      ],
      reason:
        'You got this email because you accepted a correspondence seek or challenge on Mistboard.',
    },
    host: {
      subject: (player, v, pace, onMove) =>
        `New game: ${player} started ${v} against you, ${pace}` + (onMove ? ': your move' : ''),
      onMove: (player, vp, pace) => [
        `${player} started a casual ${vp} game against you from the correspondence page, and you have the first move.`,
        `The pace is ${pace}. If your clock runs out before you play, the game is cancelled.`,
      ],
      waiting: (player, vp, pace) => [
        `${player} started a casual ${vp} game against you from the correspondence page and has the first move.`,
        `The pace is ${pace}.`,
      ],
      reason:
        'You got this email because players can start correspondence games against you on Mistboard.',
    },
    receipt: {
      onMove: (host, pace, days) => [
        `Your game against ${host} has started, and you have the first move.`,
        `The pace is ${pace}, so ${host} replies to each move within ${days === 1 ? '1 day' : `${days} days`}.`,
      ],
      waiting: (host, pace, days) => [
        `Your game against ${host} has started, and ${host} has the first move.`,
        `The pace is ${pace}, so expect it within ${days === 1 ? '1 day' : `${days} days`}.`,
      ],
      digest:
        'When a move has waited on you for a while, we send at most one email a day listing your games.',
      reason: 'You got this email because you started a correspondence game on Mistboard.',
    },
    over: {
      subject: (vp, opp, outcome) => {
        const against = opp ? ` against ${opp}` : '';
        if (outcome === 'won') return `You won your ${vp} game${against}`;
        if (outcome === 'lost') return `You lost your ${vp} game${against}`;
        if (outcome === 'draw') return `Your ${vp} game${against} was drawn`;
        return `Your ${vp} game${against} was cancelled`;
      },
      endedBy: {
        checkmate: 'checkmate',
        resignation: 'resignation',
        timeout: 'timeout',
        repetition: 'repetition',
      },
      ended: (how) => `The game ended by ${how}.`,
      cancelled:
        'The game was cancelled before the opening moves were played, so it has no result.',
      review: 'Review the game',
      playAgain: 'Play again',
      reason: 'You got this email because a correspondence game you played on Mistboard has ended.',
    },
  },
  'zh-Hans': {
    challenge: {
      subject: (challenger, v, pace) => `${challenger} 向你发起${v}挑战（${pace}）`,
      body: (challenger, vp, pace, rated, days) => [
        `${challenger} 向你发起了一盘${rated ? '计分' : '休闲'}通信对局挑战：${vp}，${pace}。`,
        `接受即可开始对局，也可以在同一页面拒绝。挑战有效期为 ${days} 天。`,
      ],
      button: '查看挑战',
      reason: '你收到这封邮件，是因为有棋手在 Mistboard 向你发起了通信对局挑战。',
    },
    joined: {
      onMove: (opp, pace) => [
        `你与 ${opp} 的通信对局已开始，由你先走。`,
        `${pace}。如果你在时间用完前还没有走棋，对局将被取消。`,
      ],
      waiting: (opp, pace) => [
        `你与 ${opp} 的通信对局已开始，由对方先走。`,
        `${pace}。轮到你走时，你的通信对局页面会显示。`,
      ],
      reason: '你收到这封邮件，是因为你在 Mistboard 接受了一个通信对局求战或挑战。',
    },
    host: {
      subject: (player, v, pace, onMove) =>
        `新对局：${player} 向你开始了一盘${v}（${pace}）` + (onMove ? '：轮到你走' : ''),
      onMove: (player, vp, pace) => [
        `${player} 在通信对局页面向你开始了一盘休闲${vp}对局，由你先走。`,
        `${pace}。如果你在时间用完前还没有走棋，对局将被取消。`,
      ],
      waiting: (player, vp, pace) => [
        `${player} 在通信对局页面向你开始了一盘休闲${vp}对局，由对方先走。`,
        `${pace}。`,
      ],
      reason: '你收到这封邮件，是因为棋手可以在 Mistboard 向你开始通信对局。',
    },
    receipt: {
      onMove: (host, pace, days) => [
        `你与 ${host} 的对局已开始，由你先走。`,
        `${pace}，所以 ${host} 会在 ${days} 天内回应每一步。`,
      ],
      waiting: (host, pace, days) => [
        `你与 ${host} 的对局已开始，由 ${host} 先走。`,
        `${pace}，第一步会在 ${days} 天内走出。`,
      ],
      digest: '当有对局等你走棋一段时间后，我们每天最多发一封邮件，列出这些对局。',
      reason: '你收到这封邮件，是因为你在 Mistboard 开始了一盘通信对局。',
    },
    over: {
      subject: (vp, opp, outcome) => {
        const game = opp ? `与 ${opp} 的${vp}对局` : `你的${vp}对局`;
        if (outcome === 'won') return `${game}：你赢了`;
        if (outcome === 'lost') return `${game}：你输了`;
        if (outcome === 'draw') return `${game}：和棋`;
        return `${game}已取消`;
      },
      endedBy: {
        checkmate: '将死',
        resignation: '认输',
        timeout: '超时',
        repetition: '重复局面',
      },
      ended: (how) => `对局结束方式：${how}。`,
      cancelled: '对局在开局着法走完之前被取消，因此没有结果。',
      review: '复盘对局',
      playAgain: '再来一盘',
      reason: '你收到这封邮件，是因为你在 Mistboard 下的一盘通信对局已经结束。',
    },
  },
  'zh-Hant': {
    challenge: {
      subject: (challenger, v, pace) => `${challenger} 向你發起${v}挑戰（${pace}）`,
      body: (challenger, vp, pace, rated, days) => [
        `${challenger} 向你發起了一盤${rated ? '計分' : '休閒'}通信對局挑戰：${vp}，${pace}。`,
        `接受即可開始對局，也可以在同一頁面拒絕。挑戰有效期為 ${days} 天。`,
      ],
      button: '查看挑戰',
      reason: '你收到這封電子郵件，是因為有棋手在 Mistboard 向你發起了通信對局挑戰。',
    },
    joined: {
      onMove: (opp, pace) => [
        `你與 ${opp} 的通信對局已開始，由你先走。`,
        `${pace}。如果你在時間用完前還沒有走棋，對局將被取消。`,
      ],
      waiting: (opp, pace) => [
        `你與 ${opp} 的通信對局已開始，由對方先走。`,
        `${pace}。輪到你走時，你的通信對局頁面會顯示。`,
      ],
      reason: '你收到這封電子郵件，是因為你在 Mistboard 接受了一個通信對局求戰或挑戰。',
    },
    host: {
      subject: (player, v, pace, onMove) =>
        `新對局：${player} 向你開始了一盤${v}（${pace}）` + (onMove ? '：輪到你走' : ''),
      onMove: (player, vp, pace) => [
        `${player} 在通信對局頁面向你開始了一盤休閒${vp}對局，由你先走。`,
        `${pace}。如果你在時間用完前還沒有走棋，對局將被取消。`,
      ],
      waiting: (player, vp, pace) => [
        `${player} 在通信對局頁面向你開始了一盤休閒${vp}對局，由對方先走。`,
        `${pace}。`,
      ],
      reason: '你收到這封電子郵件，是因為棋手可以在 Mistboard 向你開始通信對局。',
    },
    receipt: {
      onMove: (host, pace, days) => [
        `你與 ${host} 的對局已開始，由你先走。`,
        `${pace}，所以 ${host} 會在 ${days} 天內回應每一步。`,
      ],
      waiting: (host, pace, days) => [
        `你與 ${host} 的對局已開始，由 ${host} 先走。`,
        `${pace}，第一步會在 ${days} 天內走出。`,
      ],
      digest: '當有對局等你走棋一段時間後，我們每天最多寄一封電子郵件，列出這些對局。',
      reason: '你收到這封電子郵件，是因為你在 Mistboard 開始了一盤通信對局。',
    },
    over: {
      subject: (vp, opp, outcome) => {
        const game = opp ? `與 ${opp} 的${vp}對局` : `你的${vp}對局`;
        if (outcome === 'won') return `${game}：你贏了`;
        if (outcome === 'lost') return `${game}：你輸了`;
        if (outcome === 'draw') return `${game}：和棋`;
        return `${game}已取消`;
      },
      endedBy: {
        checkmate: '將死',
        resignation: '認輸',
        timeout: '超時',
        repetition: '重複局面',
      },
      ended: (how) => `對局結束方式：${how}。`,
      cancelled: '對局在開局著法走完之前被取消，因此沒有結果。',
      review: '復盤對局',
      playAgain: '再來一盤',
      reason: '你收到這封電子郵件，是因為你在 Mistboard 下的一盤通信對局已經結束。',
    },
  },
};

export type ChallengeEmailInput = {
  seekId: string;
  gameSpecId: string;
  challengerName: string;
  challengerHandle: string | null;
  daysPerMove: number;
  rated: boolean;
  // Whole days until the challenge lapses.
  openDays: number;
};

// "Fox (@fox333)": the name a player picked plus the handle that tells two
// Foxes apart, as the message notice does.
function nameWithHandle(name: string, handle: string | null, locale: EmailLocale): string {
  if (!handle || handle === name) return name;
  return locale === 'en' ? `${name} (@${handle})` : `${name}（@${handle}）`;
}

export function correspondenceChallengeEmail(
  input: ChallengeEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const notice = NOTICE_COPY[locale].challenge;
  const challenger = nameWithHandle(input.challengerName, input.challengerHandle, locale);
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const pace = copy.pace(input.daysPerMove);
  const subject = notice.subject(challenger, v, pace);
  return {
    subject,
    ...renderEmail({
      lang: locale,
      headline: subject,
      paragraphs: notice.body(challenger, vp, pace, input.rated, Math.max(1, input.openDays)),
      button: { label: notice.button, url: challengeUrl(input.seekId) },
      footer: { reason: notice.reason, manage: manageLink(copy) },
    }),
  };
}

export type JoinedStartEmailInput = {
  roomId: string;
  gameSpecId: string;
  // The seek's creator: the player the recipient will face.
  opponentName: string | null;
  recipientOnMove: boolean;
  daysPerMove: number;
};

/** To the player who accepted a seek or a challenge. */
export function correspondenceJoinedStartEmail(
  input: JoinedStartEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const notice = NOTICE_COPY[locale].joined;
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const pace = copy.pace(input.daysPerMove);
  const opponent = input.opponentName ?? copy.someone;
  return {
    subject: copy.start.subject(v, vp, input.opponentName, input.recipientOnMove),
    ...renderEmail({
      lang: locale,
      headline: copy.start.headline(v, vp, input.opponentName),
      paragraphs: input.recipientOnMove
        ? notice.onMove(opponent, pace)
        : notice.waiting(opponent, pace),
      button: {
        label: input.recipientOnMove ? copy.playYourMove : copy.start.openGame,
        url: roomUrl(input.roomId),
      },
      footer: { reason: notice.reason, manage: manageLink(copy) },
    }),
  };
}

export type HostStartEmailInput = {
  roomId: string;
  gameSpecId: string;
  playerName: string | null;
  playerHandle: string | null;
  hostOnMove: boolean;
  daysPerMove: number;
};

/** To the host when a player starts a game against them (Play the host). */
export function correspondenceHostStartEmail(
  input: HostStartEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const notice = NOTICE_COPY[locale].host;
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const pace = copy.pace(input.daysPerMove);
  const player = input.playerName
    ? nameWithHandle(input.playerName, input.playerHandle, locale)
    : copy.someone;
  const subject = notice.subject(player, v, pace, input.hostOnMove);
  return {
    subject,
    ...renderEmail({
      lang: locale,
      headline: subject,
      paragraphs: input.hostOnMove
        ? notice.onMove(player, vp, pace)
        : notice.waiting(player, vp, pace),
      button: {
        label: input.hostOnMove ? copy.playYourMove : copy.start.openGame,
        url: roomUrl(input.roomId),
      },
      footer: { reason: notice.reason, manage: manageLink(copy) },
    }),
  };
}

export type HostReceiptEmailInput = {
  roomId: string;
  gameSpecId: string;
  hostName: string;
  playerOnMove: boolean;
  daysPerMove: number;
  // The daily "your move" digest is on for this player, so the email may say
  // that a waiting move reaches them by email. Off: it says nothing it cannot keep.
  turnDigest: boolean;
};

/** To the player who started a game against the host: what happens next. */
export function correspondenceHostReceiptEmail(
  input: HostReceiptEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const notice = NOTICE_COPY[locale].receipt;
  const v = variantName(input.gameSpecId, locale);
  const vp = variantName(input.gameSpecId, locale, true);
  const pace = copy.pace(input.daysPerMove);
  const paragraphs = input.playerOnMove
    ? notice.onMove(input.hostName, pace, input.daysPerMove)
    : notice.waiting(input.hostName, pace, input.daysPerMove);
  return {
    subject: copy.start.subject(v, vp, input.hostName, input.playerOnMove),
    ...renderEmail({
      lang: locale,
      headline: copy.start.headline(v, vp, input.hostName),
      paragraphs: input.turnDigest ? [...paragraphs, notice.digest] : paragraphs,
      button: {
        label: input.playerOnMove ? copy.playYourMove : copy.start.openGame,
        url: roomUrl(input.roomId),
      },
      footer: { reason: notice.reason, manage: manageLink(copy) },
    }),
  };
}

export type GameOverEmailInput = {
  roomId: string;
  gameSpecId: string;
  opponentName: string | null;
  outcome: GameOverOutcome;
  // games.termination; only a few read well in a sentence, the rest say nothing.
  termination: string | null;
  // crosstableReviewUrl's path for the finished room, or null.
  reviewPath: string | null;
};

export function correspondenceGameOverEmail(
  input: GameOverEmailInput,
  locale: EmailLocale,
): PlayerEmail {
  const copy = COPY[locale];
  const notice = NOTICE_COPY[locale].over;
  const vp = variantName(input.gameSpecId, locale, true);
  const subject = notice.subject(vp, input.opponentName, input.outcome);
  const cancelled = input.outcome === 'cancelled';
  const how = !cancelled && input.termination ? notice.endedBy[input.termination] : undefined;
  const playAgain = cancelled
    ? null
    : correspondencePlayAgainUrl({ roomId: input.roomId, gameSpecId: input.gameSpecId });
  return {
    subject,
    ...renderEmail({
      lang: locale,
      headline: subject,
      paragraphs: cancelled ? [notice.cancelled] : how ? [notice.ended(how)] : [],
      ...(playAgain ? { items: [{ text: notice.playAgain, url: playAgain }] } : {}),
      button: cancelled
        ? { label: copy.start.openGame, url: roomUrl(input.roomId) }
        : { label: notice.review, url: gameReviewUrl(input.roomId, input.reviewPath) },
      footer: { reason: notice.reason, manage: manageLink(copy) },
    }),
  };
}
