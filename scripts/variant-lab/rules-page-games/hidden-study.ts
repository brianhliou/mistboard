// Offline only. Inputs are committed exports; engines and private nets stay in
// --assets. Checkpoints go in --scratch, never alongside the public plans.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type BanqiColor,
  type BanqiPieceRole,
  engineUciToBanqiMove,
  winPercent,
} from '@mistboard/game';
import type { BanqiDecision } from '../../../apps/server/src/banqi-analysis.ts';
import type { AnalysisProgressStore } from '../../../apps/server/src/game-analysis-kernel.ts';
import type { SweepPlyEval } from '../../../apps/server/src/game-analysis-sweep.ts';
import { validateStudyDecisions } from '../../../apps/server/src/study-chapter-decisions.ts';
import { checkCreate, type StudyCreateSpec } from '../../../apps/server/src/study-edit-cli.ts';
import { annotateFromEngine, type EngineSideline, type StudyNode } from '../../study-annotate.ts';

export type RecordGame = {
  variant: 'banqi' | 'three-kingdoms-banqi';
  game_id: string;
  players: Record<'red' | 'black', { handle: string }>;
  started_at: string;
  result: 'red' | 'black' | 'draw';
  termination: string;
  ply_count: number;
  deal_fen?: string;
  plies: {
    ply: number;
    mover: 'red' | 'black';
    uci: string;
    revealed?: { color: BanqiColor; role: BanqiPieceRole };
  }[];
};
export type StudyEval = SweepPlyEval & { pv: string[]; nodes?: number };
export const HERE = new URL('./', import.meta.url);
export function readGame(name: string): RecordGame {
  return JSON.parse(readFileSync(new URL(`inputs/${name}.export.json`, HERE), 'utf8'));
}
export const token = (uci: string) => (uci.startsWith('@') ? uci.slice(1).repeat(2) : uci);
export function assertResult(
  game: RecordGame,
  status: { type: string; winner?: string | null; reason?: string },
) {
  const expectedReason = game.termination === 'points' ? 'score' : game.termination;
  if (
    game.plies.length !== game.ply_count ||
    status.type !== 'finished' ||
    status.winner !== (game.result === 'draw' ? null : game.result) ||
    status.reason !== expectedReason
  )
    throw new Error(`${game.variant}: kernel replay does not match recorded result/termination`);
}

export function pinnedAssets(name: RecordGame['variant'], directory: string) {
  const banqi = name === 'banqi';
  const version = banqi ? '0.3.0' : '0.3.1';
  const binary = resolve(directory, banqi ? 'banqi-engine-v0.3.0' : 'three-kingdoms-engine-v0.3.1');
  const net = resolve(directory, banqi ? 'banqi.bqnn' : 'three-kingdoms-banqi.tknn');
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const pinScript = readFileSync(new URL('../../fetch-private-net.sh', import.meta.url), 'utf8');
  const section = pinScript.split(`  ${name}-net)`)[1]?.split(';;')[0];
  const pin = section?.match(/sha=([a-f0-9]{64})/)?.[1];
  if (!pin || hash(net) !== pin) throw new Error(`${name}: net SHA256 pin mismatch`);
  const probe = spawnSync(binary, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 10_000 });
  const identity = `${banqi ? 'MistyBanqi' : 'MistyThreeKingdomsBanqi'} ${version}`;
  if (
    probe.status !== 0 ||
    !probe.stdout.split(/\r?\n/).includes(`id name ${identity}`) ||
    !probe.stdout.includes('option name EvalFile ') ||
    (!banqi && !probe.stdout.includes('option name ChanceMix '))
  )
    throw new Error(`${name}: wrong engine version or capabilities`);
  const prefix = banqi ? 'MISTBOARD_BANQI' : 'MISTBOARD_THREE_KINGDOMS_BANQI';
  process.env[`${prefix}_ENGINE_PATH`] = binary;
  process.env[`${prefix}_NET`] = net;
  return { identity, version, binarySha256: hash(binary), netSha256: pin };
}

export function checkpoint<T>(path: string): AnalysisProgressStore<T> {
  return {
    load: async () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null),
    save: async (progress) => {
      writeFileSync(path, `${JSON.stringify(progress)}\n`);
    },
  };
}
export type GradingOptions = {
  analysis: { engineId: string; nodes: number; movetimeCapMs: number; chance?: string };
  decisions: {
    engineId: string;
    nodes: number | { rank: number; baseline: number; minimum: number };
    movetimeCapMs: number;
    candidates?: number;
    chance?: string;
  };
};
/** Any change to the inputs or grading recipe invalidates both checkpoints. */
export function artifactKey(
  game: RecordGame,
  artifacts: ReturnType<typeof pinnedAssets>,
  grading: GradingOptions,
): string {
  return createHash('sha256').update(JSON.stringify({ game, artifacts, grading })).digest('hex');
}
export type Notes = {
  intro: string;
  comments: Record<string, string>;
  evidence: unknown;
};
export function makePlan(options: {
  game: RecordGame;
  title: string;
  treeRoot: { rootFen: string } | { replay: string };
  moves: string[];
  analysis: StudyEval[];
  decisions: BanqiDecision[];
  engineId: string;
  decisionEngineId: string;
  notes: Notes;
  sidelines: EngineSideline[];
}) {
  const { game, analysis, decisions, notes } = options;
  if (
    analysis.length !== game.plies.length + 1 ||
    analysis.some(
      (row, i) => row.ply !== i || (!Number.isFinite(row.cp) && !Number.isFinite(row.mate)),
    )
  )
    throw new Error('incomplete mainline analysis');
  const comments = Object.entries(notes.comments);
  if (
    comments.length < 5 ||
    comments.length > 8 ||
    comments.some(
      ([ply, text]) =>
        !Number.isInteger(Number(ply)) ||
        Number(ply) < 1 ||
        Number(ply) > game.ply_count ||
        !text.trim(),
    )
  )
    throw new Error('study requires five to eight mainline notes');
  const flipPlies = game.plies.filter((ply) => ply.uci.startsWith('@')).map((ply) => ply.ply);
  if (JSON.stringify(decisions.map((d) => d.ply)) !== JSON.stringify(flipPlies))
    throw new Error('incomplete pool-mean flip analysis');
  const redScore = analysis.map((row, i) =>
    i === game.plies.length
      ? game.result === 'red'
        ? 1
        : game.result === 'black'
          ? 0
          : 0.5
      : winPercent(row.cp, row.mate, options.engineId) / 100,
  );
  const byPly = new Map(decisions.map((d) => [d.ply, d]));
  // For flips BOTH ends of the grade come from the same candidate pool means.
  // The root's ChanceMix estimate and the realized tile cannot grade a choice.
  const grading = redScore.map((score, i) => {
    const d = byPly.get(i + 1);
    return d ? (d.mover === 'red' ? d.bestWin / 100 : 1 - d.bestWin / 100) : score;
  });
  const tree = annotateFromEngine({
    rootFen: 'rootFen' in options.treeRoot ? options.treeRoot.rootFen : '',
    moves: options.moves,
    redScore: grading,
    best: analysis.map((row, i) => {
      const d = byPly.get(i + 1);
      if (!d) return row.best;
      const preferred = d.candidates?.[0]?.move;
      if (!preferred) throw new Error('missing preferred pool-mean candidate');
      if (game.variant !== 'banqi') return preferred;
      const move = engineUciToBanqiMove(preferred);
      if (!move) throw new Error('invalid Banqi decision move');
      return `${move.from}${move.to}`;
    }),
    moveScore: game.plies.map((_, i) => {
      const d = byPly.get(i + 1);
      return d ? (d.mover === 'red' ? d.playedWin / 100 : 1 - d.playedWin / 100) : redScore[i + 1]!;
    }),
    comments: notes.comments,
    intro: notes.intro,
    sidelines: options.sidelines,
  });
  const publicTree: { version: 1; root: StudyNode; rootFen?: string; replay?: string } = {
    version: 1,
    ...options.treeRoot,
    root: tree.root,
  };
  const create: StudyCreateSpec = {
    owner: 'mistboard',
    name: `${options.title}: Level 7 versus Level 8, annotated`,
    description: `A recorded engine game, analyzed with the served Level 8 engine and pinned net. Flip choices use public pool means; reveal luck is separate. From mistboard.com/rules/${game.variant}.`,
    visibility: 'public',
    chapter: {
      name: `${game.players.red.handle} vs ${game.players.black.handle}`,
      variant: game.variant,
      orientation: 'black',
      tree: publicTree,
      tags: {
        red: game.players.red.handle,
        black: game.players.black.handle,
        result: game.result === 'red' ? '1-0' : game.result === 'black' ? '0-1' : '1/2-1/2',
        event: `${options.title}, engine self-play`,
        date: game.started_at.slice(0, 10),
      },
      scoreSeries: { side: 'red', series: [{ name: options.title, color: 'a', values: redScore }] },
    },
  };
  checkCreate(create);
  const luck = validateStudyDecisions(game.variant, publicTree, {
    engineId: options.decisionEngineId,
    source: `Offline public-pool analysis (${options.decisionEngineId})`,
    decisions,
  });
  return { plan: { create, ops: [] }, luck, notes };
}
export function writeStudy(name: string, output: ReturnType<typeof makePlan>) {
  for (const kind of ['plan', 'luck', 'notes'] as const) {
    writeFileSync(
      new URL(`plans/${name}.${kind}.json`, HERE),
      `${JSON.stringify(output[kind], null, 2)}\n`,
    );
  }
}
export function isMain(url: string) {
  return process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
}
export function argumentsForBuild() {
  const value = (flag: string) => {
    const index = process.argv.indexOf(flag);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
    return resolve(process.argv[index + 1]!);
  };
  return { assets: value('--assets'), scratch: value('--scratch') };
}
