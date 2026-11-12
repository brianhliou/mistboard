import { createHash } from 'node:crypto';
import {
  applyStandardXiangqiMove,
  assertXiangqiPuzzleAdmissionProfile,
  getStandardXiangqiLegalMoves,
  judgeXiangqiSearchEvidence,
  normalizeXiangqiSearchEvidence,
  readXiangqiPositionOnlyPuzzle,
  verifyXiangqiSearchPvs,
  XIANGQI_MATE_GOAL_PROFILE,
  XIANGQI_PUZZLE_ADMISSION_PROFILE,
  XIANGQI_PUZZLE_VERIFICATION_PROFILE,
  XIANGQI_SOLVER_SCORE_PROFILE,
  type XiangqiGameState,
  type XiangqiMateGoalEvidence,
  type XiangqiPuzzle,
  type XiangqiScoredLine,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';

export const XIANGQI_POSITION_PACKET_VERSION = 'xiangqi-position-packet-v1';
export const XIANGQI_POSITION_PACKET_ENGINE = {
  binarySha256: '68bc5d9520797dcf5895ffc4acc9f300f8bc6a41a389b73e68da558230ff2e90',
  networkSha256: XIANGQI_SOLVER_SCORE_PROFILE.networkSha256,
} as const;
type Turn = {
  solutionPly: number;
  reason: string;
  mateGoalAttempts: XiangqiMateGoalEvidence[];
  searches: { nodes: number; lines: XiangqiScoredLine[] }[];
};
export type XiangqiPositionReceipt = { puzzleHash: string; turns: Turn[] };
export type XiangqiPositionPublicationItem = {
  puzzle: XiangqiPuzzle;
  verify: XiangqiPositionReceipt;
  audit: XiangqiPositionReceipt;
  review: { puzzleHash: string; note: string };
};
export type XiangqiPositionPacket = {
  version: typeof XIANGQI_POSITION_PACKET_VERSION;
  source: 'dpxq';
  engine: typeof XIANGQI_POSITION_PACKET_ENGINE;
  admissionProfile: typeof XIANGQI_PUZZLE_ADMISSION_PROFILE;
  verificationProfile: typeof XIANGQI_PUZZLE_VERIFICATION_PROFILE;
  items: XiangqiPositionPublicationItem[];
};
export const xiangqiPositionPuzzleHash = (puzzle: XiangqiPuzzle) =>
  createHash('sha256')
    .update(JSON.stringify(readXiangqiPositionOnlyPuzzle(puzzle)))
    .digest('hex');

function obj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function fields(
  v: unknown,
  allowed: string[],
  label: string,
): asserts v is Record<string, unknown> {
  if (!obj(v) || Object.keys(v).some((k) => !allowed.includes(k)))
    throw new Error(`Invalid ${label} fields`);
}
function exact(a: unknown, b: unknown): boolean {
  if (!obj(a) || !obj(b)) return a === b;
  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(b).every((k) =>
      Array.isArray(b[k]) ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : exact(a[k], b[k]),
    )
  );
}

function validateProof(value: unknown, state: XiangqiGameState, mateIn: number, retry: boolean) {
  fields(
    value,
    [
      'version',
      'mateIn',
      'verdict',
      'reason',
      'winningMoves',
      'legalMoveCount',
      'complete',
      'nodes',
      'limits',
    ],
    'mate proof',
  );
  const expected = retry
    ? {
        maxNodes: XIANGQI_MATE_GOAL_PROFILE.retryMaxNodes,
        maxTimeMs: XIANGQI_MATE_GOAL_PROFILE.retryMaxTimeMs,
        maxPlies: XIANGQI_MATE_GOAL_PROFILE.maxPlies,
      }
    : {
        maxNodes: XIANGQI_MATE_GOAL_PROFILE.maxNodes,
        maxTimeMs: XIANGQI_MATE_GOAL_PROFILE.maxTimeMs,
        maxPlies: XIANGQI_MATE_GOAL_PROFILE.maxPlies,
      };
  if (
    value.version !== XIANGQI_MATE_GOAL_PROFILE.version ||
    value.mateIn !== mateIn ||
    !exact(value.limits, expected) ||
    value.legalMoveCount !== getStandardXiangqiLegalMoves(state).length ||
    !Number.isSafeInteger(value.nodes) ||
    Number(value.nodes) < 0 ||
    Number(value.nodes) > expected.maxNodes + (value.verdict === 'unresolved' ? 1 : 0) ||
    !Array.isArray(value.winningMoves)
  )
    throw new Error('Incompatible mate proof');
  for (const move of value.winningMoves) {
    fields(move, ['from', 'to'], 'proof move');
    if (typeof move.from !== 'string' || typeof move.to !== 'string')
      throw new Error('Invalid proof move');
  }
}

function validateLines(value: unknown): asserts value is XiangqiScoredLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new Error('Missing ranked search lines');
  const roots = new Set<string>();
  for (const [i, line] of value.entries()) {
    fields(line, ['rank', 'score', 'pvUci', 'depth', 'nodes'], 'search line');
    fields(line.score, ['cp', 'mate'], 'search score');
    const score = line.score;
    if (
      line.rank !== i + 1 ||
      !Number.isSafeInteger(line.depth) ||
      Number(line.depth) < 0 ||
      !(
        (score.cp === null && Number.isSafeInteger(score.mate)) ||
        (score.mate === null && typeof score.cp === 'number' && Number.isFinite(score.cp))
      ) ||
      !Array.isArray(line.pvUci) ||
      line.pvUci.length === 0 ||
      line.pvUci.length > 512 ||
      line.pvUci.some((m) => typeof m !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(m)) ||
      roots.has(line.pvUci[0])
    )
      throw new Error('Invalid ranked search evidence');
    roots.add(line.pvUci[0]);
    if ('nodes' in line && (!Number.isSafeInteger(line.nodes) || Number(line.nodes) < 0))
      throw new Error('Invalid search node count');
  }
}

export function validateXiangqiPositionReceipt(
  puzzle: XiangqiPuzzle,
  value: unknown,
): asserts value is XiangqiPositionReceipt {
  fields(value, ['puzzleHash', 'turns'], 'verification receipt');
  if (
    value.puzzleHash !== xiangqiPositionPuzzleHash(puzzle) ||
    !Array.isArray(value.turns) ||
    value.turns.length !== (puzzle.solution.length + 1) / 2
  )
    throw new Error('Receipt does not bind the complete puzzle');
  let state = puzzle.initial;
  for (const [ply, move] of puzzle.solution.entries()) {
    if (ply % 2 === 0) {
      const turn = value.turns[ply / 2];
      fields(
        turn,
        ['solutionPly', 'reason', 'mateGoalAttempts', 'searches'],
        'solver-turn receipt',
      );
      if (
        turn.solutionPly !== ply ||
        typeof turn.reason !== 'string' ||
        !Array.isArray(turn.mateGoalAttempts) ||
        !Array.isArray(turn.searches)
      )
        throw new Error('Incomplete solver-turn receipt');
      if (puzzle.goal.type === 'checkmate') {
        if (turn.searches.length) throw new Error('Mate goal requires board proof');
        const after = applyStandardXiangqiMove(state, move);
        const terminal =
          ply > 0 &&
          after.status.type === 'finished' &&
          after.status.winner === puzzle.goal.winner &&
          (after.status.reason === 'checkmate' || after.status.reason === 'stalemate');
        if (terminal) {
          if (turn.reason !== 'kernel-mate-goal-completed' || turn.mateGoalAttempts.length)
            throw new Error('Invalid terminal-mate receipt');
        } else {
          const n = (puzzle.solution.length - ply + 1) / 2;
          if (turn.mateGoalAttempts.length < 1 || turn.mateGoalAttempts.length > 2)
            throw new Error('Missing mate proof');
          for (const [index, proof] of turn.mateGoalAttempts.entries())
            validateProof(proof, state, n, index === 1);
          if (turn.mateGoalAttempts.length === 2) {
            const first = turn.mateGoalAttempts[0];
            if (
              n !== 3 ||
              first.verdict !== 'unresolved' ||
              first.reason !== 'mate-goal-budget-exhausted' ||
              first.complete !== false
            )
              throw new Error('Unapproved mate-proof retry');
          }
          const proof = turn.mateGoalAttempts.at(-1);
          if (
            turn.reason !== 'unique-within-mate-goal' ||
            proof.verdict !== 'unique' ||
            proof.reason !== 'unique-within-mate-goal' ||
            proof.complete !== true ||
            proof.winningMoves.length !== 1 ||
            proof.winningMoves[0].from !== move.from ||
            proof.winningMoves[0].to !== move.to
          )
            throw new Error('Mate uniqueness was not certified');
        }
      } else {
        if (turn.mateGoalAttempts.length || turn.searches.length < 2 || turn.searches.length > 3)
          throw new Error('Missing winning-advantage evidence');
        const analyses = turn.searches.map((search, i) => {
          fields(search, ['nodes', 'lines'], 'bounded search');
          const expected =
            i < 2
              ? XIANGQI_PUZZLE_VERIFICATION_PROFILE.baselineNodes[i]
              : XIANGQI_PUZZLE_VERIFICATION_PROFILE.escalationNodes;
          if (search.nodes !== expected) throw new Error('Changed verification budget');
          validateLines(search.lines);
          const coverage = getStandardXiangqiLegalMoves(state).length;
          if (
            search.lines.length <
            Math.min(coverage, XIANGQI_PUZZLE_VERIFICATION_PROFILE.minimumMultiPv)
          )
            throw new Error('Incomplete MultiPV evidence');
          const analysis = normalizeXiangqiSearchEvidence(state, search.lines);
          if (!verifyXiangqiSearchPvs(state, analysis)) throw new Error('Illegal verification PV');
          return analysis;
        });
        const judged = judgeXiangqiSearchEvidence(ply, move, analyses);
        if (
          judged.verdict !== 'pass' ||
          judged.reason !== turn.reason ||
          analyses.some((a) => a.lines[0]?.pvUci[0] !== xiangqiMoveToPikafishUci(move))
        )
          throw new Error('Winning-advantage verification does not pass');
      }
    }
    state = applyStandardXiangqiMove(state, move);
  }
}

/** Extract only bounded proof/search data. Raw UCI transcripts and source
 * history never enter the production receipt. Both audits run after sanitizing. */
export function sealXiangqiPositionAudit(
  puzzle: XiangqiPuzzle,
  result: unknown,
): XiangqiPositionReceipt {
  if (
    !obj(result) ||
    !obj(result.decision) ||
    result.decision.disposition !== 'keep' ||
    result.puzzleHash !== xiangqiPositionPuzzleHash(puzzle) ||
    !Array.isArray(result.judgments) ||
    !Array.isArray(result.evidence)
  )
    throw new Error('Only a passing exact-puzzle audit can be sealed');
  const evidence = result.evidence;
  const turns = result.judgments.map((j) => {
    if (!obj(j) || j.verdict !== 'pass') throw new Error('Unresolved audit cannot be sealed');
    const e = evidence.find((v: unknown) => obj(v) && v.solutionPly === j.solutionPly);
    if (!obj(e) || !Array.isArray(e.searches) || !Array.isArray(e.budgets))
      throw new Error('Missing audit evidence');
    const budgets = e.budgets;
    return {
      solutionPly: j.solutionPly,
      reason: j.reason,
      mateGoalAttempts: e.mateGoalAttempts ?? [],
      searches: e.searches.map((search, i) => {
        if (!obj(search) || !Array.isArray(search.lines)) throw new Error('Missing search lines');
        return {
          nodes: budgets[i],
          lines: search.lines.map((line) => {
            if (!obj(line) || !obj(line.score)) throw new Error('Invalid search line');
            return {
              rank: line.rank,
              score: { cp: line.score.cp, mate: line.score.mate },
              pvUci: line.pvUci,
              depth: line.depth,
              ...('nodes' in line ? { nodes: line.nodes } : {}),
            };
          }),
        };
      }),
    };
  });
  const receipt = JSON.parse(JSON.stringify({ puzzleHash: result.puzzleHash, turns })) as unknown;
  validateXiangqiPositionReceipt(puzzle, receipt);
  return receipt;
}

export function readXiangqiPositionPacket(value: unknown): XiangqiPositionPacket {
  fields(
    value,
    ['version', 'source', 'engine', 'admissionProfile', 'verificationProfile', 'items'],
    'position packet',
  );
  if (
    value.version !== XIANGQI_POSITION_PACKET_VERSION ||
    value.source !== 'dpxq' ||
    !exact(value.engine, XIANGQI_POSITION_PACKET_ENGINE) ||
    !exact(value.verificationProfile, XIANGQI_PUZZLE_VERIFICATION_PROFILE) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 100
  )
    throw new Error('Incompatible position-packet profile');
  if (!obj(value.admissionProfile)) throw new Error('Missing admission profile');
  assertXiangqiPuzzleAdmissionProfile(value.admissionProfile);
  if (!exact(value.admissionProfile, XIANGQI_PUZZLE_ADMISSION_PROFILE))
    throw new Error('Changed admission profile');
  const seen = new Set<string>();
  const items = value.items.map((item) => {
    fields(item, ['puzzle', 'verify', 'audit', 'review'], 'packet item');
    const puzzle = readXiangqiPositionOnlyPuzzle(item.puzzle);
    if (seen.has(puzzle.id)) throw new Error('Duplicate packet puzzle id');
    seen.add(puzzle.id);
    validateXiangqiPositionReceipt(puzzle, item.verify);
    validateXiangqiPositionReceipt(puzzle, item.audit);
    fields(item.review, ['puzzleHash', 'note'], 'editorial review');
    if (
      item.review.puzzleHash !== xiangqiPositionPuzzleHash(puzzle) ||
      typeof item.review.note !== 'string' ||
      !item.review.note.trim() ||
      item.review.note.length > 1000
    )
      throw new Error('Missing exact-puzzle editorial approval');
    return {
      puzzle,
      verify: JSON.parse(JSON.stringify(item.verify)) as XiangqiPositionReceipt,
      audit: JSON.parse(JSON.stringify(item.audit)) as XiangqiPositionReceipt,
      review: { puzzleHash: item.review.puzzleHash, note: item.review.note },
    };
  });
  return {
    version: XIANGQI_POSITION_PACKET_VERSION,
    source: 'dpxq',
    engine: { ...XIANGQI_POSITION_PACKET_ENGINE },
    admissionProfile: structuredClone(XIANGQI_PUZZLE_ADMISSION_PROFILE),
    verificationProfile: structuredClone(XIANGQI_PUZZLE_VERIFICATION_PROFILE),
    items,
  };
}

export function xiangqiPositionPacketHash(packet: XiangqiPositionPacket): string {
  return createHash('sha256')
    .update(JSON.stringify(readXiangqiPositionPacket(packet)))
    .digest('hex');
}
