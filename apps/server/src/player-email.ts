/**
 * Words for the correspondence emails a player receives: the game-started
 * notice, the deadline warning and the daily "your move" digest. Each sender
 * module (correspondence-start-email.ts, correspondence-deadline-warning.ts,
 * correspondence-turn-digest.ts) keeps its own policy (who, when, throttles,
 * opt-outs) and calls a builder here for the subject and the body; every
 * body renders through email-layout.ts.
 *
 * Two rules the builders keep:
 * - The subject names the game (variant and opponent). Gmail threads mail by
 *   subject, so identical subjects ("Your game has started") folded different
 *   games into one conversation.
 * - Every email says why it was sent and links to the notification settings
 *   where it can be turned off.
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
  banqi: { en: 'Banqi', 'zh-Hans': '暗棋', 'zh-Hant': '暗棋' },
  mahjong: null,
  'dark-chess': { en: 'Fog Chess', 'zh-Hans': '迷雾国际象棋', 'zh-Hant': '迷霧國際象棋' },
  'dark-xiangqi': { en: 'Fog Xiangqi', 'zh-Hans': '迷雾象棋', 'zh-Hant': '迷霧象棋' },
  'fortress-xiangqi': { en: 'Fortress Xiangqi', 'zh-Hans': '堡垒象棋', 'zh-Hant': '堡壘象棋' },
  jieqi: { en: 'Jieqi', 'zh-Hans': '揭棋', 'zh-Hant': '揭棋' },
  jungle: { en: 'Jungle Chess', 'zh-Hans': '斗兽棋', 'zh-Hant': '鬥獸棋' },
  'jungle-flip': { en: 'Flip Jungle', 'zh-Hans': '翻翻棋', 'zh-Hant': '翻翻棋' },
  xiangqi: { en: 'Xiangqi', 'zh-Hans': '象棋', 'zh-Hant': '象棋' },
  'crazyhouse-xiangqi': {
    en: 'Crazyhouse Xiangqi',
    'zh-Hans': '疯狂屋象棋',
    'zh-Hant': '瘋狂屋象棋',
  },
  'duck-xiangqi': { en: 'Duck Xiangqi', 'zh-Hans': '鸭子象棋', 'zh-Hant': '鴨子象棋' },
  'atomic-xiangqi': { en: 'Atomic Xiangqi', 'zh-Hans': '原子象棋', 'zh-Hant': '原子象棋' },
  chess: { en: 'Chess', 'zh-Hans': '国际象棋', 'zh-Hant': '國際象棋' },
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
      reason: '這類郵件每天最多一封，並且只在有對局等你走棋時發送。',
    },
  },
};

function manageLink(copy: Copy) {
  return { label: copy.manage, url: notificationSettingsUrl };
}

// ── Builders ─────────────────────────────────────────────────────────────────

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
