// Anti xiangqi as a lab variant: compulsory capture on the xiangqi array, in
// the three flavours the antichess family has. The decision sheet is
// docs-private/variant-lab/anti-xiangqi/decisions.md; the keys below are its
// open decisions (D1/D4 flavour, D2 facing, D3 stalemate, D9 stall) plus the
// shared vocabulary, and the settled ones (D5-D8) are fixed in the config.
//
// Stock Fairy-Stockfish expresses all three flavours: a non-royal general is
// `king = -` plus a wazir on the palace points (the piece type FSF's KING can
// never be captured), compulsory capture is `mustCapture`, losing everything
// is `extinctionValue = win`, losing the general alone is
// `extinctionPieceTypes = k` (codrus), and the royal flavour (losers) keeps
// the KING with `checkmateValue = win` and `extinctionPieceCount = 1`. What
// stock FSF cannot express throws rather than measure a different game: a
// facing rule for a non-royal general (`flyingGeneral` is keyed on the KING
// type and becomes a silent no-op without one), and the stall rule, which
// the kernel referees with the engine unaware.

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

export type AntiFlavour = 'antichess' | 'losers' | 'codrus';

/** The kernel configuration the sheet's decisions imply; exported so the opening-tree test reads the same rules the lab measures. */
export function antiXiangqiKernelConfig(rules: RulesRecord): XiangqiRuleConfig {
  const flavour = rules.flavour as AntiFlavour;
  const royal = flavour === 'losers';
  if (royal && rules.facing !== 'file') {
    throw new Error(
      'flavour=losers fixes facing=file (the sheet: the royal flavour keeps the prohibition; the adapter rejects any other pairing)',
    );
  }
  return {
    ...sharedKernelConfig(rules),
    royal: { red: royal, black: royal },
    check: royal ? 'standard' : 'none',
    mustCapture: true,
    extinction:
      flavour === 'codrus' ? { red: 'none', black: 'none' } : { red: 'wins', black: 'wins' },
    checkmate: royal ? 'win' : 'loss',
    bareGeneral: royal ? 'wins' : 'none',
    generalLost: flavour === 'codrus' ? 'wins' : 'none',
    stall: rules.stall === 'fewerPieces' ? 'fewerPieces' : 'draw',
    deadPosition: rules.stall === 'fewerPieces',
  };
}

export const antiXiangqiVariant: LabVariant<XiangqiRuleState, XiangqiMove> = {
  id: 'anti-xiangqi',
  title: 'Anti Xiangqi (compulsory capture, win by losing everything)',
  ruleSchema: {
    ...SHARED_RULE_SCHEMA,
    flavour: {
      options: ['antichess', 'losers', 'codrus'],
      default: 'antichess',
      blast: 'movegen',
      note: 'D1 and D4 together. antichess: the general is an ordinary piece and you win by losing everything (the parent). losers: the general stays royal with check, and being mated or reduced to the bare general wins (ICC wild 17). codrus: the general is an ordinary piece and losing it is the win (1844). All three run on stock FSF.',
    },
    facing: {
      ...SHARED_RULE_SCHEMA.facing,
      default: 'off',
      note: 'D2. off: the generals may face (stock FSF, the sheet’s default). file: the xiangqi prohibition kept as a bare rule; stock under flavour=losers, needs the flyingGeneral patch otherwise. capture: the folk gloss made literal; needs the patched binary.',
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
    const flavour = rules.flavour as AntiFlavour;
    if (flavour !== 'losers' && rules.facing !== 'off') {
      throw new Error(
        `facing=${String(rules.facing)} with a non-royal general needs the flyingGeneral patch: stock FSF keys flyingGeneral on the KING type and silently ignores it once the general is a wazir. Run at facing=off and label the rows.`,
      );
    }
    const kernel = createXiangqiRuleKernel(config);
    const lines =
      flavour === 'losers'
        ? [
            ...sharedStanzaLines(rules),
            'mustCapture = true',
            'checkmateValue = win',
            'extinctionValue = win',
            'extinctionPieceTypes = *',
            'extinctionPieceCount = 1',
          ]
        : [
            ...nonRoyalGeneralLines(),
            ...sharedStanzaLines(rules),
            'mustCapture = true',
            'extinctionValue = win',
            `extinctionPieceTypes = ${flavour === 'codrus' ? 'k' : '*'}`,
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
      why: 'D5. A black chariot stands beside the red general inside the palace and nothing else can capture: Ke1xd1 is the only legal move (under losers it is the only evasion that captures, same answer). The far soldiers keep both sides off the bare-general ending FSF adjudicates at once.',
      fen: '4k4/9/9/p8/9/9/8P/9/9/3rK4 w - - 0 1',
    },
    {
      name: 'facing generals are legal',
      why: 'D2 at off: with nothing else on the e-file, Kd1-e1 is legal (the generals then face); under the prohibition Kd1-d2 and the soldier push are the only moves. The soldiers keep both sides off the bare-general ending.',
      fen: '4k4/9/9/p8/9/9/8P/9/9/3K5 w - - 0 1',
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
