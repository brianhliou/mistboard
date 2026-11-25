import { describe, expect, it } from 'vitest';
import { hasAppTranslation } from '../i18n/catalog.js';
import type { Locale } from '../i18n/locale.js';
import { CHAT_PRESETS, chatPresetLabel, displayChatText } from './chat-presets.js';

const LABELS: Record<Locale, readonly string[]> = {
  en: ['Hi', 'Good luck', 'Good game', 'Well played', 'Thanks'],
  'zh-Hans': ['你好', '请多指教', '好棋', '下得好', '谢谢'],
  'zh-Hant': ['你好', '請多指教', '好棋', '下得好', '謝謝'],
};

describe('chat presets', () => {
  it('sends the five canonical English phrases, in order, and nothing else', () => {
    expect(CHAT_PRESETS.map((preset) => preset.text)).toEqual(LABELS.en);
  });

  it('drops the old abbreviations', () => {
    const texts: readonly string[] = CHAT_PRESETS.map((preset) => preset.text);
    for (const gone of ['GG', 'WP', 'TY', 'GTG', 'BYE']) expect(texts).not.toContain(gone);
  });

  it.each(Object.entries(LABELS))('labels the buttons in %s', (locale, labels) => {
    expect(CHAT_PRESETS.map((preset) => chatPresetLabel(preset, locale as Locale))).toEqual(labels);
    for (const preset of CHAT_PRESETS)
      expect(hasAppTranslation(locale as Locale, preset.key)).toBe(true);
  });

  it.each(Object.entries(LABELS))(
    'shows a received preset in the viewer language (%s)',
    (locale, labels) => {
      expect(CHAT_PRESETS.map((preset) => displayChatText(preset.text, locale as Locale))).toEqual(
        labels,
      );
    },
  );

  it.each([
    'thanks',
    'Thanks!',
    ' Thanks',
    'Good game everyone',
    'good game',
    'GOOD LUCK',
    'Hi Hi',
    // Old presets already in chat history stay as sent.
    'GG',
    'GTG',
    'BYE',
    // A Chinese reader typing the label is free text, not a preset.
    '谢谢',
  ])('renders a near miss as sent: %j', (text) => {
    expect(displayChatText(text, 'zh-Hans')).toBe(text);
    expect(displayChatText(text, 'zh-Hant')).toBe(text);
    expect(displayChatText(text, 'en')).toBe(text);
  });

  it('planted: a preset inside a longer message is never translated', () => {
    // If the matcher ever loosens to a substring or prefix test, this fails.
    expect(displayChatText('Thanks for the game', 'zh-Hans')).toBe('Thanks for the game');
    expect(displayChatText('Well played!', 'zh-Hant')).toBe('Well played!');
  });
});
