// Template for a "xiangqi plus a rule" lab variant. Copy to `<id>.ts`, set
// `id`, and edit three places: the schema (which decisions are open), the
// kernel config (what the decisions mean), and the stanza (what the engine
// is told). Everything else is inherited.
//
// As written this is standard xiangqi through the configurable kernel, and
// the lab's own tests run the full gate on it against stock Fairy-Stockfish,
// so a copy starts from a pairing that is known to agree.
//
// The leading underscore keeps this file out of the registry's discovery.

import type { XiangqiMove } from '../../../../packages/game/src/variants-xiangqi.js';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleConfig,
  type XiangqiRuleState,
} from '../../../../packages/game/src/xiangqi-rule-kernel.js';
import {
  SHARED_RULE_SCHEMA,
  sharedKernelConfig,
  sharedStanzaLines,
  xiangqiStanza,
} from '../stanza.js';
import type { LabVariant } from '../types.js';
import { STOCK_FSF } from './xiangqi.js';

export const templateVariant: LabVariant<XiangqiRuleState, XiangqiMove> = {
  id: '_template',
  title: 'Template (standard xiangqi through the rule kernel)',
  ruleSchema: {
    ...SHARED_RULE_SCHEMA,
    // Add the variant's own open decisions here, e.g.
    // blastShape: { options: ['orthogonal', 'eight'], default: 'orthogonal', blast: 'movegen', note: '...' },
  },
  create(rules) {
    const config: XiangqiRuleConfig = {
      ...sharedKernelConfig(rules),
      // The variant's rule goes here, e.g. `blast: { shape: rules.blastShape, immune: ['soldier'] }`.
    };
    const kernel = createXiangqiRuleKernel(config);
    const lines = [
      ...sharedStanzaLines(rules, { generalsLeavePalace: config.generalRegion === 'board' }),
      // The variant's engine lines go here, e.g. `blastOnCapture = true`.
    ];
    return {
      kernel,
      engine: {
        variant: 'labtemplate',
        ini: xiangqiStanza('labtemplate', lines),
        binary: STOCK_FSF,
      },
    };
  },
  discriminatingPositions: [
    // One per rule the variant adds, plus these three the base geometry needs.
    {
      name: 'flying general',
      why: 'No facing situation arises within two plies of the start array.',
      fen: '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    },
    {
      name: 'cannon screen',
      why: 'A cannon with exactly one screen and a target behind it.',
      fen: '5k3/9/9/9/4r4/9/4p4/9/4C4/3K5 w - - 0 1',
    },
    {
      name: 'horse leg',
      why: 'A horse whose leg point is occupied.',
      fen: '5k3/9/9/9/9/9/9/9/3pN4/3K5 w - - 0 1',
    },
  ],
};
