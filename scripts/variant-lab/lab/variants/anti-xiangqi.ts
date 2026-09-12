// Anti xiangqi as a lab variant: compulsory capture and win by losing
// everything, on the xiangqi array. The decision sheet is
// docs-private/variant-lab/anti-xiangqi/decisions.md; the keys below are its
// open decisions (D1 generalRoyal, D2 facing, D3 stalemate) plus the shared
// vocabulary, and the settled ones (D4-D8) are fixed in the kernel config.
//
// Stock Fairy-Stockfish expresses the default point exactly: a non-royal
// general is `king = -` plus a wazir on the palace points (the piece type
// FSF's KING can never be captured), compulsory capture is `mustCapture`,
// and losing everything is `extinctionValue = win`. Two things it cannot
// express throw rather than measure a different game: any facing rule for a
// non-royal general (`flyingGeneral` is keyed on the KING type and becomes a
// silent no-op without one), and the royal flavour, whose "bare general
// wins" and "being checkmated wins" endings the shared kernel has no hook
// for yet.

import type { XiangqiMove } from '../../../../packages/game/src/variants-xiangqi.js';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleConfig,
  type XiangqiRuleState,
} from '../../../../packages/game/src/xiangqi-rule-kernel.js';
import {
  nonRoyalGeneralLines,
  SHARED_RULE_SCHEMA,
  sharedKernelConfig,
  sharedStanzaLines,
  xiangqiStanza,
} from '../stanza.js';
import type { LabVariant, RulesRecord } from '../types.js';
import { STOCK_FSF } from './xiangqi.js';

/** The kernel configuration the sheet's decisions imply; exported so the opening-tree test reads the same rules the lab measures. */
export function antiXiangqiKernelConfig(rules: RulesRecord): XiangqiRuleConfig {
  const royal = rules.generalRoyal === true;
  if (royal && rules.facing !== 'file') {
    throw new Error(
      'generalRoyal=true fixes facing=file (the sheet: the royal flavour keeps the prohibition; the adapter rejects any other pairing)',
    );
  }
  return {
    ...sharedKernelConfig(rules),
    royal: { red: royal, black: royal },
    check: royal ? 'standard' : 'none',
    mustCapture: true,
    extinction: { red: 'wins', black: 'wins' },
    stall: rules.stall === 'fewerPieces' ? 'fewerPieces' : 'draw',
    deadPosition: rules.stall === 'fewerPieces',
  };
}

export const antiXiangqiVariant: LabVariant<XiangqiRuleState, XiangqiMove> = {
  id: 'anti-xiangqi',
  title: 'Anti Xiangqi (compulsory capture, win by losing everything)',
  ruleSchema: {
    ...SHARED_RULE_SCHEMA,
    generalRoyal: {
      options: [false, true],
      default: false,
      blast: 'movegen',
      note: 'D1. false: the general is an ordinary piece (antichess). true: losers flavour, check and checkmate exist and being checkmated or reduced to the bare general wins; needs two kernel hooks the shared kernel does not have yet and throws until they exist.',
    },
    facing: {
      ...SHARED_RULE_SCHEMA.facing,
      default: 'off',
      note: 'D2. off: the generals may face (stock FSF, the sheet’s default). file: the xiangqi prohibition kept as a bare rule; stock under generalRoyal=true, needs the flyingGeneral patch under false. capture: the folk gloss made literal; needs the patched binary.',
    },
    stalemate: {
      ...SHARED_RULE_SCHEMA.stalemate,
      default: 'win',
      note: 'D3. win is the parent (Lichess); loss is xiangqi; draw is AISE. FICS’s fewer-pieces rule is not in the kernel.',
    },
    stall: {
      options: ['off', 'fewerPieces'],
      default: 'off',
      blast: 'terminal',
      note: 'D9. off: a stalled game (progress clock, repetition) is a draw and a dead position plays on to one, as measured first. fewerPieces: a dead position (no chariot, horse, cannon or soldier left) ends at once, and every stall goes to the side with fewer pieces, equal a draw. The kernel referees it; stock FSF does not know the rule, so engine rows under it are labelled engine-unaware.',
    },
  },
  create(rules) {
    const config = antiXiangqiKernelConfig(rules);
    if (rules.generalRoyal === true) {
      throw new Error(
        'generalRoyal=true is unmeasured: the kernel has no checkmate-wins or bare-general-wins hook (FSF checkmateValue / extinctionPieceCount); add them to xiangqi-rule-kernel.ts with a test if D1 lands on true',
      );
    }
    if (rules.facing !== 'off') {
      throw new Error(
        `facing=${String(rules.facing)} with a non-royal general needs the flyingGeneral patch: stock FSF keys flyingGeneral on the KING type and silently ignores it once the general is a wazir. Run at facing=off and label the rows.`,
      );
    }
    const kernel = createXiangqiRuleKernel(config);
    const lines = [
      ...nonRoyalGeneralLines(),
      ...sharedStanzaLines(rules),
      'mustCapture = true',
      'extinctionValue = win',
      'extinctionPieceTypes = *',
    ];
    return {
      kernel,
      engine: {
        variant: 'labanti',
        ini: xiangqiStanza('labanti', lines),
        binary: STOCK_FSF,
      },
    };
  },
  discriminatingPositions: [
    {
      name: 'compulsory capture through a screen; a blocked leg is no capture',
      why: 'D5. Red must play Ca1xa5 (a3 is the screen); Nc1xd3 is not available because c2 blocks the leg, so it is the only legal move. Remove the c2 soldier and there are two.',
      fen: '3k5/9/9/9/9/p8/9/P2p5/2p6/C1N1K4 w - - 0 1',
    },
    {
      name: 'the general is not royal',
      why: 'D1. Red is "in check" from e5 and the only legal move is Ra1xa5 all the same; a royal general would have to step aside instead.',
      fen: '4k4/9/9/9/9/p3r4/9/9/9/R3K4 w - - 0 1',
    },
    {
      name: 'the general can be compelled',
      why: 'D5. A black chariot stands beside the red general inside the palace and nothing else can capture: Ke1xd1 is the only legal move.',
      fen: '4k4/9/9/9/9/9/9/9/9/3rK4 w - - 0 1',
    },
    {
      name: 'the general can be captured',
      why: 'D1. Red to move has exactly one capture and it takes the black general: Ra10xe10 is the only legal move, and Black, left with nothing, has won.',
      fen: 'R3k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    },
    {
      name: 'facing generals are legal',
      why: 'D2 at off: with nothing else on the e-file, Kd1-e1 is legal (the generals then face); under the prohibition Kd1-d2 would be the only move.',
      fen: '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1',
    },
    {
      name: 'stalemate',
      why: 'D3. Red has no move at all: both advisors are blocked by the horse, the general by its own pieces and the palace edge, the horse by three soldiers on its legs. No capture, no move; the value is the rule.',
      fen: '4k4/9/9/9/9/9/9/4p4/3pNp3/3AKA3 w - - 0 1',
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
