// Words for an engine "mate" that is a rule verdict (PlyEval.rule), not a checkmate.
// Kept apart from eval-format.ts, which Node-run scripts import and must not pull in
// the i18n catalog (it reads import.meta.env, which only Vite defines).

import { t } from '../../i18n/catalog.js';

/** The narrow form for the move-list eval column, chart readout and phone readout,
 *  in place of "#1". */
export function formatRuleEvalShort(): string {
  return t('engine.ruleShort');
}

/** The full sentence behind the short form (its tooltip). `mate` is Red's POV, as on
 *  every PlyEval: positive means the rule wins for Red. */
export function formatRuleEvalTitle(mate: number | null): string {
  return t(mate != null && mate < 0 ? 'engine.ruleBlackWins' : 'engine.ruleRedWins');
}

/** The note on a record's move that walks into the rule loss, which goes ungraded
 *  because the source event did not apply the rule. */
export function ruleRecordNote(): string {
  return t('engine.ruleRecordNote');
}
