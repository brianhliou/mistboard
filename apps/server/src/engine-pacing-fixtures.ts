/** Deterministic calibration fixtures, never player data. See docs/engine-pacing.md. */
import { createHash } from 'node:crypto';
import {
  createFFQBanqiSetup,
  createThreeKingdomsBanqiSetup,
  getFFQBanqiLegalMoves,
  getThreeKingdomsBanqiLegalMoves,
} from '@mistboard/game';
import { PACING_LEGAL_MEDIANS } from './engine-reply-pacing.js';
import { ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import { playRandomGame, VARIANTS, type VariantSpec } from './variant-postgame-fixtures.js';

export const CALIBRATION_POSITIONS = 200;
export const CALIBRATION_SEEDS = [
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const;
export const CALIBRATION_PLY_CAP = 80;

export type CalibrationPosition = { key: string; ply: number; legalCount: number };

/** Fail if the corpus is short; never cycle or pad it to meet the quota. */
export function pacingCalibrationFixtures() {
  const specs: VariantSpec[] = [
    ...VARIANTS.filter((spec) => Object.hasOwn(PACING_LEGAL_MEDIANS, spec.tenant.gameSpecId)),
    {
      tenant: threeKingdomsBanqiTenant,
      enumerate: getThreeKingdomsBanqiLegalMoves,
      makeSetup: createThreeKingdomsBanqiSetup,
    },
    {
      tenant: ffqBanqiTenant,
      enumerate: getFFQBanqiLegalMoves,
      makeSetup: createFFQBanqiSetup,
    },
  ];
  return specs.map((spec) => {
    const positions: CalibrationPosition[] = [];
    const seen = new Set<string>();
    const games = [];
    for (const seed of CALIBRATION_SEEDS) {
      const game = playRandomGame(spec, seed, CALIBRATION_PLY_CAP);
      games.push({ seed, game });
      // The fixture generator owns the cross-variant opaque state/move types.
      const events = game.events as {
        type: string;
        roomId: string;
        setup?: unknown;
        move?: unknown;
      }[];
      const created = events[0]!;
      let state = spec.tenant.rules.createInitialState(created.roomId, created.setup);
      for (let ply = 0; ply < events.length - 1; ply++) {
        const legal = spec.enumerate(state);
        const key = createHash('sha256')
          .update(JSON.stringify([state.board, state.status.turn]))
          .digest('hex');
        if (!seen.has(key) && positions.length < CALIBRATION_POSITIONS) {
          seen.add(key);
          positions.push({ key, ply, legalCount: legal.length });
        }
        state = spec.tenant.rules.applyMove(state, events[ply + 1]!.move);
      }
      if (positions.length === CALIBRATION_POSITIONS) break;
    }
    if (positions.length !== CALIBRATION_POSITIONS) {
      throw new Error(
        `${spec.tenant.gameSpecId}: only ${positions.length} distinct calibration positions`,
      );
    }
    const counts = positions.map((position) => position.legalCount).sort((a, b) => a - b);
    const median = (counts[99]! + counts[100]!) / 2;
    return {
      variant: spec.tenant.gameSpecId as keyof typeof PACING_LEGAL_MEDIANS,
      positions,
      median,
      games,
    };
  });
}
