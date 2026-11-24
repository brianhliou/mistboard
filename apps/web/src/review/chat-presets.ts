import { type I18nKey, t } from '../i18n/catalog.js';
import { currentLocale, type Locale } from '../i18n/locale.js';

/**
 * One-tap chat presets. The wire carries the canonical English text, so the
 * server and every old client see an ordinary chat line; each viewer's client
 * shows a line whose whole text is one of these in its own site language.
 * The buttons and the message renderer both read this one table.
 */
export const CHAT_PRESETS = [
  { text: 'Hi', key: 'live.chatPresetHi' },
  { text: 'Good luck', key: 'live.chatPresetGoodLuck' },
  { text: 'Good game', key: 'live.chatPresetGoodGame' },
  { text: 'Well played', key: 'live.chatPresetWellPlayed' },
  { text: 'Thanks', key: 'live.chatPresetThanks' },
] as const satisfies readonly { text: string; key: I18nKey }[];

export type ChatPreset = (typeof CHAT_PRESETS)[number];

const PRESET_KEY_BY_TEXT: ReadonlyMap<string, I18nKey> = new Map(
  CHAT_PRESETS.map((preset) => [preset.text, preset.key]),
);

/** The preset's label in the viewer's language. */
export function chatPresetLabel(preset: ChatPreset, locale: Locale = currentLocale()): string {
  return t(preset.key, {}, locale);
}

/**
 * The text a chat line shows: a line that is exactly a canonical preset (case
 * sensitive, nothing around it) in the viewer's language, anything else as sent.
 */
export function displayChatText(text: string, locale: Locale = currentLocale()): string {
  const key = PRESET_KEY_BY_TEXT.get(text);
  return key ? t(key, {}, locale) : text;
}
