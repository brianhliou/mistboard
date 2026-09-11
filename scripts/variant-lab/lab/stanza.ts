// The shared rules vocabulary, and the Fairy-Stockfish stanza fragments that
// express it on the xiangqi base.
//
// Seven candidate variants asked for the same knobs in four spellings (the
// Phase 1 critic, series.md issue 2). One vocabulary here means `report` can
// compare rows across variants and Brian settles each shared decision once.
// A variant adapter spreads SHARED_RULE_SCHEMA into its own schema and hands
// the resolved record to `sharedStanzaLines`, then adds its own lines.
//
// Every fragment documents what stock FSF can and cannot express, because the
// same fact silently broke the duck: an option the engine lacks does not
// error, it keeps the previous behaviour.

import type { XiangqiRuleConfig } from '../../../packages/game/src/xiangqi-rule-kernel.js';
import type { RuleSchema, RulesRecord } from './types.js';

export const SHARED_RULE_SCHEMA: RuleSchema = {
  facing: {
    options: ['off', 'file', 'rookline', 'capture'],
    default: 'file',
    blast: 'movegen',
    note: 'The generals may not face down an open file (xiangqi), nor along an open rank (for generals that leave the palace), or facing is a capture, or no rule.',
  },
  stalemate: {
    options: ['loss', 'win', 'draw'],
    default: 'loss',
    blast: 'terminal',
    note: 'The side to move with no legal move and not in check. loss is xiangqi; win is the antichess/fowling reading.',
  },
  progressClock: {
    options: [60, 100, 120],
    default: 60,
    blast: 'terminal',
    note: 'Plies without a capture before a draw. 60 is the site rule; 100 is stock FSF (nMoveRule 50).',
  },
  perpetualCheck: {
    options: ['draw', 'loss'],
    default: 'draw',
    blast: 'terminal',
    note: 'The lab kernel adjudicates repetition as a draw only; loss (xiangqi’s perpetual-check law) is not implemented on the kernel side yet and the engine is set to match.',
  },
};

/** The kernel config that the shared record implies; a variant spreads its own on top. */
export function sharedKernelConfig(
  rules: RulesRecord,
): Pick<XiangqiRuleConfig, 'facing' | 'stalemate' | 'progressClock' | 'repetition'> {
  return {
    facing: rules.facing as XiangqiRuleConfig['facing'],
    stalemate: rules.stalemate as XiangqiRuleConfig['stalemate'],
    progressClock: Number(rules.progressClock),
    repetition: 'draw',
  };
}

/**
 * The FSF lines for the shared record. `generalsLeavePalace` decides what
 * `facing` means to the engine: stock `flyingGeneral` is a rook-line test
 * (file and rank), which equals the file rule while both generals are
 * palace-bound and equals `rookline` once they are not. `file` for a freed
 * general and `capture` need the patched binary; both throw here so a stock
 * run cannot silently measure a different game.
 */
export function sharedStanzaLines(
  rules: RulesRecord,
  options: { generalsLeavePalace?: boolean } = {},
): string[] {
  const lines: string[] = [];
  switch (rules.facing) {
    case 'off':
      lines.push('flyingGeneral = false');
      break;
    case 'file':
      if (options.generalsLeavePalace) {
        throw new Error(
          'facing=file with a freed general needs the flyingGeneralFileOnly patch; run at facing=rookline on stock FSF and label the rows',
        );
      }
      lines.push('flyingGeneral = true');
      break;
    case 'rookline':
      lines.push('flyingGeneral = true');
      break;
    case 'capture':
      throw new Error(
        'facing=capture needs the patched binary (the duck-bot flyingGeneral-as-capture patch); stock FSF cannot express it',
      );
    default:
      throw new Error(`unknown facing "${String(rules.facing)}"`);
  }
  lines.push(`stalemateValue = ${String(rules.stalemate)}`);
  // nMoveRule counts full moves; the kernel counts plies.
  lines.push(`nMoveRule = ${Math.round(Number(rules.progressClock) / 2)}`);
  // The kernel adjudicates repetition as a plain draw and knows no chase law,
  // so the engine must not think perpetual check is illegal, or it will play
  // for (or against) a rule the referee never applies.
  lines.push('perpetualCheckIllegal = false');
  lines.push('chasingRule = none');
  lines.push('nFoldValue = draw');
  return lines;
}

/**
 * A general that is not royal: FSF's KING type refuses several options
 * (`wallingRule = duck`, extinction wins), so the piece becomes a wazir on
 * the same palace points. This is the fragment anti and atomic share. NOTE:
 * `flyingGeneral` is keyed on the KING type and becomes a no-op here; a
 * facing rule for a non-royal general needs the patch.
 */
export function nonRoyalGeneralLines(): string[] {
  return [
    'king = -',
    'wazir = k',
    'mobilityRegionWhiteWazir = d1 e1 f1 d2 e2 f2 d3 e3 f3',
    'mobilityRegionBlackWazir = d8 e8 f8 d9 e9 f9 d10 e10 f10',
  ];
}

/** A royal general free of the palace (`-` is the empty region, meaning no restriction). */
export function freedGeneralLines(): string[] {
  return ['mobilityRegionWhiteKing = -', 'mobilityRegionBlackKing = -'];
}

/** Assemble a stanza. `base` is the FSF variant to inherit from. */
export function xiangqiStanza(name: string, lines: readonly string[], base = 'xiangqi'): string {
  return `[${name}:${base}]\n${lines.join('\n')}\n`;
}
