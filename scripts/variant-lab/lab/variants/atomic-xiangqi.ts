// Atomic Xiangqi as a lab variant: xiangqi where every capture explodes.
//
// Decision sheet: docs-private/variant-lab/atomic-xiangqi/decisions.md. The
// kernel already has the blast hook (shape, immune roles, palace containment)
// and the royal rules the parent needs (a capture that blasts your own
// general is illegal, so the general never captures; blasting the enemy
// general wins and outranks check; check is judged on the post-blast board),
// so this adapter is a configuration plus a stanza.
//
// Stock Fairy-Stockfish plays exactly one point of the rules space, the
// sweep's probe stanza: 3x3 blast, soldiers die in it, no palace wall, no
// facing rule, plain repetition draw. Every other point needs the patched
// binary (MISTBOARD_FSF_ATOMIC_PATH; the patch is in the mistboard-atomic-bot
// recipe and adds `blastShape`, keys flyingGeneral and perpetualCheckIllegal
// on the extinction pseudo-royal, and makes the check test honour
// blastImmuneTypes). Without it, engine commands at a non-stock point throw
// at open, naming the gap, and kernel-only rows still run. The gaps:
//
//   - facing=file: FSF models the atomic general as a non-KING wazir made
//     royal by extinction, and `flyingGeneral` is keyed on KING, so the line
//     is a silent no-op (verified: three general moves where xiangqi has two).
//   - soldiersImmune=true: `blastImmuneTypes = p` loads with a warning, but
//     position.cpp 1152 judges the post-capture attack on the general with
//     the whole blast removed, soldiers included, so a soldier that survives
//     to screen the general reads as gone and a legal move is refused
//     (verified on `3kr4/9/9/9/9/R2n5/4P4/9/9/4K4 w`: a5d5 missing).
//   - blastShape=wazir|lines and palaceWall=true: `attacks_bb<KING>` is the
//     blast mask, hard-coded.
//
// The stanza is built lazily so a kernel-only command can run under the
// recommended defaults while an engine command under the same rules throws
// at open, naming the patch, instead of measuring a different game.

import { join } from 'node:path';
import type { XiangqiMove } from '../../../../packages/game/src/variants-xiangqi.js';
import {
  createXiangqiRuleKernel,
  type XiangqiRuleConfig,
  type XiangqiRuleState,
} from '../../../../packages/game/src/xiangqi-rule-kernel.js';
import { REPO_ROOT } from '../artifacts.js';
import {
  nonRoyalGeneralLines,
  SHARED_RULE_SCHEMA,
  sharedKernelConfig,
  sharedStanzaLines,
  xiangqiStanza,
} from '../stanza.js';
import type { BinaryLocator, LabEngineSpec, LabVariant, RulesRecord } from '../types.js';
import { STOCK_FSF } from './xiangqi.js';

const ENGINE_VARIANT = 'labatomicxiangqi';

/** Fairy-Stockfish with the atomic-xiangqi patch: blastShape, pseudo-royal facing and check law, immunity in the check test. */
export const ATOMIC_FSF: BinaryLocator = {
  env: 'MISTBOARD_FSF_ATOMIC_PATH',
  fallbacks: [join(REPO_ROOT, 'bin', 'fairy-stockfish-atomic-xiangqi')],
  label:
    'patched Fairy-Stockfish for atomic xiangqi (scripts/variant-lab/patches/fairy-stockfish-atomic-xiangqi.patch; set MISTBOARD_FSF_ATOMIC_PATH)',
};

/** The one point stock FSF plays; anything else routes to the patched binary. */
function isStockPoint(rules: RulesRecord): boolean {
  return (
    rules.facing === 'off' &&
    rules.soldiersImmune === false &&
    rules.blastShape === 'king' &&
    rules.palaceWall === false &&
    rules.perpetualCheck === 'draw' &&
    rules.palaceShelter === false &&
    rules.cannonUnloaded === false &&
    rules.cannonShotBlasts === true &&
    rules.lethalCheck === false
  );
}

function stockStanzaLines(rules: RulesRecord): string[] {
  if (rules.facing !== 'off') {
    throw new Error(
      `facing=${String(rules.facing)}: FSF keys flyingGeneral on the KING type and the atomic general is an extinction pseudo-royal, so the rule is a silent no-op on stock FSF; needs the flyingGeneral-on-pseudo-royal patch (series.md issue 1). Run at facing=off and label the rows.`,
    );
  }
  if (rules.soldiersImmune !== false) {
    throw new Error(
      'soldiersImmune=true: FSF position.cpp 1152 judges the post-capture attack on the general with the whole blast removed, immunity ignored, so a surviving soldier that screens the general reads as gone and a legal move is refused. Run at soldiersImmune=false and label the rows.',
    );
  }
  if (rules.blastShape !== 'king') {
    throw new Error(
      `blastShape=${String(rules.blastShape)}: FSF's blast mask is attacks_bb<KING>, hard-coded; needs a per-variant blast piece patch. Run at blastShape=king and label the rows.`,
    );
  }
  if (rules.palaceWall !== false) {
    throw new Error(
      'palaceWall=true: FSF has no region mask on the blast; needs a patch. Run at palaceWall=false and label the rows.',
    );
  }
  return [
    ...sharedStanzaLines(rules),
    ...nonRoyalGeneralLines(),
    // The general is royal by extinction, the only royalty FSF allows next to a blast.
    'extinctionValue = loss',
    'extinctionPieceTypes = k',
    'extinctionPseudoRoyal = true',
    'blastOnCapture = true',
  ];
}

/** The patched binary's options: everything the schema can say, in its vocabulary. */
function patchedStanzaLines(rules: RulesRecord): string[] {
  if (rules.palaceWall !== false) {
    throw new Error('palaceWall=true: the patch has no region mask on the blast; kernel-only.');
  }
  const shape = { king: 'king', wazir: 'wazir', lines: 'lines' }[String(rules.blastShape)];
  if (!shape) throw new Error(`unknown blastShape "${String(rules.blastShape)}"`);
  return [
    // flyingGeneral and perpetualCheckIllegal are keyed on the pseudo-royal by the patch.
    ...sharedStanzaLines(rules),
    ...nonRoyalGeneralLines(),
    'extinctionValue = loss',
    'extinctionPieceTypes = k',
    'extinctionPseudoRoyal = true',
    'blastOnCapture = true',
    `blastShape = ${shape}`,
    ...(rules.soldiersImmune === true ? ['blastImmuneTypes = p'] : []),
    ...(rules.palaceShelter === true ? ['blastShelter = true'] : []),
    ...(rules.cannonUnloaded === true ? ['cannonUnloaded = true'] : []),
    ...(rules.cannonShotBlasts === false ? ['cannonShotBlasts = false'] : []),
    ...(rules.lethalCheck === true ? ['lethalCheck = true'] : []),
  ];
}

function stanzaLines(rules: RulesRecord): string[] {
  return isStockPoint(rules) ? stockStanzaLines(rules) : patchedStanzaLines(rules);
}

export const atomicXiangqiVariant: LabVariant<XiangqiRuleState, XiangqiMove> = {
  id: 'atomic-xiangqi',
  title: 'Atomic Xiangqi (every capture explodes)',
  ruleSchema: {
    ...SHARED_RULE_SCHEMA,
    perpetualCheck: {
      ...SHARED_RULE_SCHEMA.perpetualCheck!,
      default: 'loss',
    },
    facing: {
      ...SHARED_RULE_SCHEMA.facing!,
      options: ['off', 'file'],
      default: 'file',
      note: 'D7. file: xiangqi’s rule, judged after the blast, so a capture whose blast empties the last piece between the generals is illegal. off: the generals may face; what stock FSF plays.',
    },
    blastShape: {
      options: ['king', 'wazir', 'lines'],
      default: 'wazir',
      blast: 'movegen',
      note: 'D1. king: the eight neighbours (the parent). wazir: the four orthogonal neighbours. lines: the points joined by a drawn line, orthogonal everywhere plus the palace diagonals (xiangqi adjacency).',
    },
    palaceWall: {
      options: [false, true],
      default: false,
      blast: 'movegen',
      note: 'D2. true: a blast never crosses a palace boundary in either direction.',
    },
    soldiersImmune: {
      options: [true, false],
      default: true,
      blast: 'movegen',
      note: 'D3. true: a soldier dies only as the captured or the capturing piece (the parent’s pawn rule). false: soldiers explode like everything else; what stock FSF plays.',
    },
    palaceShelter: {
      options: [false, true],
      default: false,
      blast: 'movegen',
      note: 'D11. true: a blast never removes a piece standing on a palace point (the capturer and the captured piece still go), so a general is mated, never blown up. Answers the advisor-file parry measured 2026-09-14.',
    },
    cannonShotBlasts: {
      options: [true, false],
      default: true,
      blast: 'movegen',
      note: 'D13. false: a cannon\u2019s capture removes the cannon and its target and nothing beside the target (the shot is at range, the explosion is on contact). Removes the shot back over a blocking chariot that drives the advisor-file dance, and makes the day-one exchange a cannon for a horse.',
    },
    lethalCheck: {
      options: [false, true],
      default: false,
      note: 'D14. true: for the repetition law, a move is check if the mover could remove the general next move by any means, blast included (xiangqi\u2019s perpetual-check rule read on what actually kills). Legality is unchanged.',
    },
    cannonUnloaded: {
      options: [false, true],
      default: false,
      blast: 'movegen',
      note: 'D12. true: a cannon on one of its own side\u2019s two cannon starting points may not capture until it has moved, so the day-one exchange is a choice rather than a ritual. Stateless: a cannon back on its starting point is unloaded again; the enemy\u2019s starting points do not count (a rule keyed on the square alone disagreed with the engine\u2019s check detection, 2026-09-15).',
    },
  },
  create(rules) {
    const config: XiangqiRuleConfig = {
      ...sharedKernelConfig(rules),
      blast: {
        shape:
          rules.blastShape === 'wazir'
            ? 'orthogonal'
            : rules.blastShape === 'lines'
              ? 'lines'
              : 'eight',
        immune: rules.soldiersImmune === true ? ['soldier'] : [],
        palaceContained: rules.palaceWall === true,
        shelter: rules.palaceShelter === true ? 'palace' : 'none',
        cannonShotBlasts: rules.cannonShotBlasts !== false,
      },
      cannonUnloaded: rules.cannonUnloaded === true,
      repetitionCheck: rules.lethalCheck === true ? 'lethal' : 'direct',
    };
    const kernel = createXiangqiRuleKernel(config);
    const engine: LabEngineSpec = {
      variant: ENGINE_VARIANT,
      // Lazy: read only when the engine is opened, so kernel-only commands run
      // under rules stock FSF cannot express and engine commands throw at open.
      get ini(): string {
        return xiangqiStanza(ENGINE_VARIANT, stanzaLines(rules));
      },
      binary: isStockPoint(rules) ? STOCK_FSF : ATOMIC_FSF,
    };
    return { kernel, engine };
  },
  discriminatingPositions: [
    {
      name: 'flying general',
      why: 'No facing situation arises within two plies of the start array; under facing=off the general has three moves, under file two.',
      fen: '3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
    },
    {
      name: 'cannon screen',
      why: 'A cannon with exactly one screen and a target behind it; the blast at the target must not reach the screen two points back.',
      fen: '5k3/9/9/9/4r4/9/4p4/9/4C4/3K5 w - - 0 1',
    },
    {
      name: 'horse leg',
      why: 'A horse whose leg point is occupied.',
      fen: '5k3/9/9/9/9/9/9/9/3pN4/3K5 w - - 0 1',
    },
    {
      name: 'D1 blast reaches the general diagonally',
      why: 'Rxd2 kills the general on e1 under king (d2-e1 is a diagonal neighbour) and not under wazir or lines.',
      fen: '3k5/9/9/9/9/3r5/9/9/3N5/4K4 b - - 0 1',
    },
    {
      name: 'D1 palace diagonal',
      why: 'Rxd1: the d1-e2 diagonal is drawn, so the general on e2 dies under king and lines, and survives under wazir.',
      fen: '5k3/9/9/3r5/9/9/9/9/4K4/3A5 b - - 0 1',
    },
    {
      name: 'D2 blast across the palace wall',
      why: 'Rxc1 is outside the palace; the blast reaches d1 unless the wall contains it.',
      fen: '5k3/2r6/9/9/9/9/9/9/9/2NK5 b - - 0 1',
    },
    {
      name: 'D3 soldier in the blast',
      why: 'Rxd4: the soldier on e4 survives only when soldiers are immune; the next move set differs.',
      fen: '3k5/9/3r5/9/9/9/3NP4/9/9/4K4 b - - 0 1',
    },
    {
      name: 'D3 surviving soldier still screens',
      why: 'Rxd5 blasts e4; the rook on e10 then bears on e1 only if the soldier died, so a5d5 is legal iff soldiers are immune. This is where FSF 1152 diverges from the kernel under soldiersImmune=true.',
      fen: '3kr4/9/9/9/9/R2n5/4P4/9/9/4K4 w - - 0 1',
    },
    {
      name: 'D3 a capturing soldier still dies',
      why: 'e4xe3: the capturer is removed even when soldiers are immune. Invisible to a move-set comparison from FEN (the engine\u2019s internal state after the move is what differs), so the gate needs perft(2) here; upstream FSF let an immune-type capturer survive.',
      fen: '5k3/9/9/9/9/9/4p4/4C4/9/3K5 b - - 0 1',
    },
    {
      name: 'D11 shelter: Rxd1 beside the general',
      why: 'The advisor and the chariot go; the general on e1 lives only under palaceShelter (its move set differs next ply), while the elephant on c1, outside the palace, dies either way. Needs perft(2): the move set from the FEN is the same.',
      fen: '3k5/9/9/9/9/3r5/9/9/9/2BAK4 b - - 0 1',
    },
    {
      name: 'D11 shelter: a chariot on the advisor file is not check',
      why: 'With the shelter Red may ignore the chariot on d9 (Rxd1 kills nothing royal), so quiet moves like a1a2 are legal; without it every non-parry loses the general and is illegal only where the kernel enforces post-blast legality.',
      fen: '4k4/3r5/9/9/9/9/9/9/9/R2AK4 w - - 0 1',
    },
    {
      name: 'D12 unloaded cannon on its start point',
      why: 'Cxb10 over the b8 cannon from b3 exists only when cannonUnloaded is false; the quiet cannon moves are unchanged.',
      fen: 'rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1',
    },
    {
      name: 'D12 a cannon on the enemy\u2019s starting point is loaded',
      why: 'A red cannon on h8 checks the general on e8 over g8 and may capture from there: the starting points are per side. This position mated in the engine and had seven legal moves in a square-keyed kernel.',
      fen: '5a3/3Pa4/4k1CCb/9/9/2B6/9/B8/4AK3/4p4 b - - 0 1',
    },
    {
      name: 'D12 a moved cannon is loaded',
      why: 'The same shot from b4 is legal under both settings.',
      fen: 'rheakaehr/9/1c5c1/p1p1p1p1p/9/1C7/P1P1P1P1P/7C1/9/RHEAKAEHR w - - 0 1',
    },
    {
      name: 'D13 a cannon shot spares the neighbours',
      why: 'Cxd10 over the chariot on d9: the advisor and the cannon go; the general on e10 dies only when cannon shots blast. Needs perft(2).',
      fen: '3ak4/3r5/9/9/9/9/9/3C5/9/4K4 w - - 0 1',
    },
    {
      name: 'D13 a chariot shot still blasts',
      why: 'The same capture by a chariot on d3 kills the general under both settings: only the cannon is exempt.',
      fen: '3ak4/9/9/9/9/9/9/3R5/9/4K4 w - - 0 1',
    },
    {
      name: 'D4 cannon parry',
      why: 'Cxd1 over Red’s own rook on d3: advisor, cannon and the general on e1 die; the screen two points back survives.',
      fen: '5k3/9/3c5/9/9/9/9/3R5/9/3AK4 b - - 0 1',
    },
    {
      name: 'D4 cannon parry, adjacent screen',
      why: 'Same shot with the screen on d2: the screen is adjacent to the target and dies too.',
      fen: '5k3/9/3c5/9/9/9/9/9/3R5/3AK4 b - - 0 1',
    },
    {
      name: 'D6 self-detonation is illegal',
      why: 'Rxd2 would blast Red’s own general on e1; the rook may not capture the horse, and Rxd10 wins.',
      fen: '3k5/3R5/9/9/9/9/9/9/3n5/4K4 w - - 0 1',
    },
    {
      name: 'D6 in check from a horse',
      why: 'The horse on d3 checks e1 (leg d2 free); Rxd3 captures the checker with a blast that spares e1, and Rxd10 wins from inside check.',
      fen: '3k5/3R5/9/9/9/9/9/3n5/9/4K4 w - - 0 1',
    },
    {
      name: 'D6 exploding the general outranks check',
      why: 'Black’s rook on a1 gives check along the rank; e2xe9 is legal anyway because its blast removes the general on e10.',
      fen: '4k4/4p4/9/9/9/9/9/9/4R4/r3K4 w - - 0 1',
    },
    {
      name: 'D7 facing produced by a blast',
      why: 'Rxe5: rook and horse both die and the e-file opens from e1 to e10. Illegal under facing=file, legal under off; in xiangqi proper the rook would still stand on e5.',
      fen: '4k4/9/9/9/9/R3n4/9/9/9/4K4 w - - 0 1',
    },
  ],
};
