import {
  importXiangqiGame as parseGame,
  importXiangqiPaste as parsePaste,
  type XiangqiImportResult,
  type XiangqiMoveFormat,
  type XiangqiPasteResult,
} from '@mistboard/game';
import { type I18nKey, t } from '../i18n/catalog.js';
import { currentLocale } from '../i18n/locale.js';

export type {
  XiangqiImportResult,
  XiangqiMoveFormat,
  XiangqiPasteResult,
} from '@mistboard/game';

// The rules package stays locale-agnostic. Translate its diagnostics once at
// the web boundary, including token/FEN details, for every paste-box caller.
export function importXiangqiGame(...args: Parameters<typeof parseGame>): XiangqiImportResult {
  return localizeResult(parseGame(...args));
}

export function importXiangqiPaste(...args: Parameters<typeof parsePaste>): XiangqiPasteResult {
  return localizeResult(parsePaste(...args));
}

function localizeResult<T extends { error?: string }>(result: T): T {
  return result.error ? { ...result, error: localizeError(result.error) } : result;
}

const ERROR_KEYS: Readonly<Record<string, I18nKey>> = {
  'Enter a game to import.': 'review.import.enterGame',
  'Unrecognized move notation.': 'review.import.unrecognized',
  'No moves found.': 'review.import.noMoves',
  'No moves found in this PGN.': 'review.import.noPgnMoves',
};

const FORMAT_KEYS: Record<XiangqiMoveFormat, I18nKey> = {
  coordinate: 'review.import.format.coordinate',
  'uci-0indexed': 'review.import.format.uci',
  algebraic: 'review.import.format.algebraic',
  wxf: 'review.import.format.wxf',
  chinese: 'review.import.format.chinese',
  dhtmlxq: 'review.import.format.dhtmlxq',
};

function localizeError(error: string): string {
  if (ERROR_KEYS[error]) return t(ERROR_KEYS[error]);
  const illegal = /^Move (\d+) \("([\s\S]*)"\) is not legal as ([\w-]+)\.$/.exec(error);
  if (illegal) {
    const formatKey = FORMAT_KEYS[illegal[3] as XiangqiMoveFormat];
    if (formatKey) {
      return t('review.import.illegalMove', {
        number: illegal[1]!,
        token: illegal[2]!,
        format: t(formatKey),
      });
    }
  }
  const variation = /^"([\s\S]*)" is not a legal move here\.$/.exec(error);
  if (variation) return t('review.import.illegalHere', { token: variation[1]! });
  const fen = /^Could not read the \[FEN\] tag: ([\s\S]*)$/.exec(error);
  if (fen) return t('review.import.invalidFen', { fen: fen[1]! });
  // A future parser diagnostic must not leak English into a translated page.
  return currentLocale() === 'en' ? error : t('review.import.unrecognized');
}
