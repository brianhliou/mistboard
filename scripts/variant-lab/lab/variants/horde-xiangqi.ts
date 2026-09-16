// Horde Xiangqi as a lab variant: Red is a horde of soldiers with no
// general, Black is the standard army. The horde wins by checkmate, the army
// by taking every soldier (extinction). Decision sheet:
// docs-private/variant-lab/horde-xiangqi/decisions.md.
//
// Everything is a configuration of the rule kernel: a non-royal red side,
// extinction as red's loss, the facing rule void (one general has no second
// operand), soldiers as xiangqi has them. The start array is the one open
// movegen decision (D1), so it is a rule key and each formation is a row.
//
// Stock Fairy-Stockfish expresses all of it as a stanza (the prior-art sweep
// ran it). Two engine facts the adapter states so nobody rediscovers them:
// `chasingRule = none` is mandatory (FSF's chase detector reads the missing
// general's square unguarded), and `flyingGeneral` is a silent no-op on a
// kingless side, so `facing` is pinned to `off` and the kernel matches.

import type { XiangqiMove } from '../../../../packages/game/src/variants-xiangqi.js';
import {
  createXiangqiRuleKernel,
  parsePlacement,
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

/** D1: the horde's count and start array. Red soldiers only; the army is standard. */
export const HORDE_FORMATIONS = {
  // Ranks 1-4 full, 9 x 4 = the parent's 36.
  solid36: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
  // Ranks 2-5 full; the front rank crosses the river on its first step.
  forward36: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/9',
  // Ranks 1-3 full plus xiangqi's own five soldier points; BrainKing's 32.
  array32: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
  // Ranks 1-5 full: 45, the count lever pulled upward (added after the first
  // three rows all went to the army, on Brian's question).
  solid45: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
  // Smaller hordes, for the veteran sweep: the count lever pulled downward.
  solid27: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/9/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
  forward27: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/9',
  solid18: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/9/9/PPPPPPPPP/PPPPPPPPP',
  forward18: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/PPPPPPPPP/PPPPPPPPP/9/9',
  // Ranks 3-6: the front rank starts across the river.
  across36: 'rnbakabnr/9/1c5c1/p1p1p1p1p/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/9/9',
  across27: 'rnbakabnr/9/1c5c1/p1p1p1p1p/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/9/9/9',
  // The parent's silhouette: a full block plus paired outposts ahead of it.
  lichess40: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/1PP2PP2/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
  lichess31: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/1PP2PP2/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP',
} as const;

export type HordeFormation = keyof typeof HORDE_FORMATIONS;

export function hordeStartFen(formation: HordeFormation): string {
  return `${HORDE_FORMATIONS[formation]} w - - 0 1`;
}

export const hordeXiangqiVariant: LabVariant<XiangqiRuleState, XiangqiMove> = {
  id: 'horde-xiangqi',
  title: 'Horde Xiangqi (a horde of soldiers, no general, vs the army)',
  ruleSchema: {
    ...SHARED_RULE_SCHEMA,
    // D5, settled: one general, so the facing rule has no second operand. The
    // key stays for report comparability but has one value; the engine's
    // flyingGeneral would be a no-op here whatever it was set to.
    facing: {
      options: ['off'],
      default: 'off',
      blast: 'movegen',
      note: 'Void: the horde has no general, so there is nothing for the army’s general to face. Pinned to off on both sides so the stanza says what the engine does.',
    },
    // D8: xiangqi’s loss or the parent’s draw; `win` has no reading here.
    stalemate: {
      options: ['loss', 'draw'],
      default: 'loss',
      blast: 'terminal',
      note: 'The side to move with no legal move and not in check. loss is xiangqi (a smothered army general is a horde win); draw is Lichess Horde.',
    },
    formation: {
      options: Object.keys(HORDE_FORMATIONS),
      default: 'solid36',
      blast: 'movegen',
      note: 'D1. solid36: ranks 1-4 full. forward36: ranks 2-5 full, front rank crosses on its first step. array32: ranks 1-3 full plus a4 c4 e4 g4 i4. solid45: ranks 1-5 full. solid27 / forward27 / solid18 / forward18: three or two full ranks, from rank 1 or from rank 2 (3 for 18).',
    },
    soldiers: {
      options: ['standard', 'veteran'],
      default: 'standard',
      blast: 'movegen',
      note: 'D4 lever (Brian, 2026-09-11). veteran: every horde soldier has the crossed soldier’s move from the start (forward or sideways, never backward). The army’s five soldiers stay standard. Engine letter V, Betza fsW.',
    },
  },
  create(rules) {
    // D9 wants xiangqi’s perpetual-check law as the default; the lab kernel
    // adjudicates repetition as a draw only and the shared stanza pins the
    // engine to match, so `loss` would silently measure `draw`. Refuse it
    // rather than label a row with a rule nobody applied.
    if (rules.perpetualCheck === 'loss') {
      throw new Error(
        'perpetualCheck=loss is not adjudicated by the lab kernel; run at draw and count repetition endings (decisions.md D9)',
      );
    }
    const formation = rules.formation as HordeFormation;
    const veteran = rules.soldiers === 'veteran';
    const startBoard = parsePlacement(HORDE_FORMATIONS[formation]);
    if (!startBoard) throw new Error(`formation ${formation} does not parse`);
    const config: XiangqiRuleConfig = {
      ...sharedKernelConfig(rules),
      startBoard,
      // D5: the horde is not royal (no general, no check against it); D7: it
      // loses when its last soldier is taken. The army stays royal and can
      // never be extinct, so its extinction value is moot.
      royal: { red: false, black: true },
      extinction: { red: 'loses', black: 'none' },
      veteranSoldiers: { red: veteran, black: false },
    };
    const inner = createXiangqiRuleKernel(config);
    // A veteran horde is a custom piece to the engine (stock SOLDIER cannot
    // differ per colour), so red soldiers are `V` in every FEN it sees. The
    // kernel keeps `P`; moves are coordinates and need no translation.
    const engineFen = (fen: string): string => {
      if (!veteran) return fen;
      const [placement, ...rest] = fen.split(' ');
      return [placement!.replace(/P/g, 'V'), ...rest].join(' ');
    };
    const kernel = { ...inner, fen: (state: XiangqiRuleState) => engineFen(inner.fen(state)) };
    const lines = [
      `startFen = ${engineFen(hordeStartFen(formation))}`,
      ...(veteran ? ['customPiece1 = v:fsW'] : []),
      // D7. `*` is every piece type; the army’s general is uncapturable so
      // only the horde can reach zero, as in FSF’s own `horde`.
      'extinctionValue = loss',
      'extinctionPieceTypes = *',
      // facing=off → flyingGeneral = false; chasingRule = none (mandatory on
      // a kingless side); stalemateValue, nMoveRule, perpetualCheckIllegal =
      // false, nFoldValue = draw.
      ...sharedStanzaLines(rules),
    ];
    return {
      kernel,
      engine: {
        variant: 'labhordexiangqi',
        ini: xiangqiStanza('labhordexiangqi', lines),
        binary: STOCK_FSF,
      },
    };
  },
  discriminatingPositions: [
    {
      name: 'soldier on the back rank',
      why: 'The start arrays have soldiers on rank 1 but a back-rank soldier only moves once the ranks ahead have emptied.',
      fen: '4k4/9/9/9/9/9/9/9/9/4P4 w - - 0 1',
    },
    {
      name: 'crossed soldier: sideways, and sideways only on the last rank',
      why: 'No horde soldier crosses the river within perft depth; the river is the horde’s only promotion.',
      fen: 'P3k4/9/9/9/4P4/9/9/9/9/9 w - - 0 1',
    },
    {
      name: 'no facing rule (D5)',
      why: 'The army’s general may stand on an open file above a soldier: there is no second general to face.',
      fen: '3k5/9/9/9/9/9/9/9/9/P8 b - - 0 1',
    },
    {
      name: 'last soldier (D7)',
      why: 'The army takes the last soldier; the move exists on both sides and the kernel ends the game on it.',
      fen: '4k4/9/9/9/9/9/9/9/9/r7P b - - 0 1',
    },
    {
      name: 'smothered general (D8)',
      why: 'The army to move with no legal move and not in check: both sides must generate nothing.',
      fen: '4k4/3P1P3/9/9/9/9/9/9/9/9 b - - 0 1',
    },
    {
      name: 'soldier perpetual (D9)',
      why: 'In check from a covered soldier with one reply; the position the sheet’s perpetual runs through.',
      fen: 'r3kc3/r1P1P4/4P4/9/9/9/9/9/9/9 b - - 0 1',
    },
    {
      name: 'covered soldier check',
      why: 'A checking soldier covered sideways by a crossed neighbour: the general may neither take it nor step beside it.',
      fen: '4k4/3PP4/9/9/9/9/9/9/9/9 b - - 0 1',
    },
    {
      name: 'army cannon screened by a soldier',
      why: 'A cannon with exactly one soldier screen and a soldier behind it; the start arrays put two soldiers in every file.',
      fen: '4k4/9/4c4/9/4P4/9/4P4/9/9/9 b - - 0 1',
    },
    {
      name: 'army horse leg blocked by a soldier',
      why: 'A horse whose leg point is a soldier that also attacks it.',
      fen: '4k4/9/9/9/9/9/9/4n4/4P4/9 b - - 0 1',
    },
  ],
};
