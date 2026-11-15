import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createInitialThreeKingdomsBanqiReplayState,
  getThreeKingdomsBanqiPlayerView,
  serializedTreeMainline,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
  threeKingdomsBanqiStateToEngineFen,
  winPercent,
} from '@mistboard/game';
import { validateStudyDecisions } from '../../apps/server/src/study-chapter-decisions.ts';
import { checkCreate, type StudyCreateSpec } from '../../apps/server/src/study-edit-cli.ts';
import { parseChapterScoreSeries } from '../../apps/server/src/study-score-series.ts';
import * as decisions from '../../apps/server/src/three-kingdoms-banqi-decisions.ts';
import type { ThreeKingdomsBanqiEngineRequest } from '../../apps/server/src/three-kingdoms-banqi-engine.ts';
import { MOVE_NAG, moveGlyphFor, type StudyNode } from '../study-annotate.ts';
import { banqiPublicLine, replayBanqiGame } from './rules-page-games/banqi.ts';
import {
  artifactKey,
  makePlan,
  readGame,
  type StudyEval,
  token,
} from './rules-page-games/hidden-study.ts';
import {
  publicRequest,
  replayThreeKingdomsGame,
  threeKingdomsPublicLine,
} from './rules-page-games/three-kingdoms-banqi.ts';

test('rules-page pool grading accepts an identity-free replay and only the observed flip', async () => {
  assert.equal(typeof decisions.evaluateThreeKingdomsBanqiPublicFlipDecision, 'function');
  const state = createInitialThreeKingdomsBanqiReplayState('public');
  const original = JSON.stringify(state);
  const requests: string[] = [];
  const result = await decisions.evaluateThreeKingdomsBanqiPublicFlipDecision(
    state,
    { from: 'f4', to: 'f4', revealed: { color: 'red', role: 'advisor' } },
    1,
    (position) => {
      for (const piece of Object.values(position.board)) {
        if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
      }
      const fen = threeKingdomsBanqiStateToEngineFen(position);
      requests.push(fen);
      return { fen, moves: [], nodes: 128_000, movetimeCapMs: 1_000 };
    },
    async (request) => ({
      cp: 0,
      mate: null,
      depth: 1,
      best: request.searchMoves?.[0] ?? null,
    }),
  );
  assert.equal(result.playedWin, 50);
  assert.equal(result.realizedWin, 50);
  assert.equal(result.bestWin, 50);
  assert.equal(result.candidates!.filter((candidate) => candidate.played).length, 1);
  assert.ok(requests.length > 14, 'every distinct pool outcome is evaluated');
  assert.equal(JSON.stringify(state), original);
  assert.equal(JSON.parse(JSON.stringify(result)).deal, undefined);
});

test('public flip means are weighted by the bag, independent of the recorded draw', async () => {
  const root = createInitialThreeKingdomsBanqiReplayState('weighted');
  const requestFor = (state: typeof root) => ({
    fen: threeKingdomsBanqiStateToEngineFen(state),
    moves: [],
    nodes: 128_000,
    movetimeCapMs: 1_000,
  });
  const provider = async (request: ThreeKingdomsBanqiEngineRequest) => ({
    // The opponent sees either a red general or another face-up piece.
    cp: request.fen.split(' ')[0]!.includes('G') ? -800 : 200,
    mate: null,
    depth: 1,
    best: request.searchMoves?.[0] ?? null,
  });
  const run = (role: 'general' | 'advisor') =>
    decisions.evaluateThreeKingdomsBanqiPublicFlipDecision(
      root,
      { from: 'f4', to: 'f4', revealed: { color: 'red', role } },
      1,
      requestFor,
      provider,
    );
  const general = await run('general');
  const advisor = await run('advisor');
  const win = (cp: number) =>
    winPercent(cp, null, decisions.THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID);
  const mean = (win(800) + 31 * win(-200)) / 32;
  assert.ok(Math.abs(general.playedWin - mean) < 1e-10);
  assert.equal(general.playedWin, advisor.playedWin);
  assert.deepEqual(general.candidates, advisor.candidates);
  assert.equal(general.realizedWin, win(800));
  assert.equal(advisor.realizedWin, win(-200));
});

test('both exports replay to their exact recorded kernel results; altered results and reveals fail', () => {
  const b = replayBanqiGame();
  assert.equal(b.moves.length, 206);
  assert.deepEqual(b.states.at(-1)!.status, {
    type: 'finished',
    winner: 'black',
    reason: 'stalemate',
  });
  const t = replayThreeKingdomsGame();
  assert.equal(t.moves.length, 78);
  assert.deepEqual(t.states.at(-1)!.status, { type: 'finished', winner: 'black', reason: 'score' });
  assert.equal(t.states.at(-1)!.scores.black, 100);
  assert.throws(() => replayBanqiGame({ ...b.game, result: 'red' }), /result/);
  assert.throws(() => replayThreeKingdomsGame({ ...t.game, result: 'red' }), /result/);
  const altered = structuredClone(t.game);
  delete altered.plies[0]!.revealed;
  assert.throws(() => replayThreeKingdomsGame(altered), /ply/);
  assert.throws(
    () => replayThreeKingdomsGame({ ...t.game, deal_fen: b.game.deal_fen }),
    /without a deal/,
  );
});

test('Three Kingdoms public requests retain the complete quiet window and never a dealt root', () => {
  const { states, moves } = replayThreeKingdomsGame();
  for (let ply = 0; ply < moves.length; ply++) {
    const request = publicRequest(states.slice(0, ply + 1), moves.slice(0, ply), 2_048_000, 3_000);
    const start = ply - states[ply]!.noProgressClock;
    assert.equal(request.fen, threeKingdomsBanqiStateToEngineFen(states[start]!));
    assert.deepEqual(
      request.moves,
      moves.slice(start, ply).map((m) => `${m.from}${m.to}`),
    );
    assert.equal(request.chance, 'mix');
    for (const state of states.slice(0, ply + 1)) {
      const serialized = JSON.stringify(getThreeKingdomsBanqiPlayerView(state, 'red'));
      for (const piece of Object.values(JSON.parse(serialized).board) as { faceDown?: boolean }[]) {
        if (piece?.faceDown) assert.deepEqual(piece, { faceDown: true });
      }
    }
  }
});

test('checkpoint identity binds the export, engine bytes and pinned net', () => {
  const game = readGame('banqi');
  const artifacts = {
    identity: 'MistyBanqi 0.3.0',
    version: '0.3.0',
    binarySha256: 'a',
    netSha256: 'b',
  };
  const key = artifactKey(game, artifacts);
  assert.equal(key, artifactKey(structuredClone(game), { ...artifacts }));
  assert.notEqual(key, artifactKey({ ...game, game_id: 'another-game' }, artifacts));
  assert.notEqual(key, artifactKey(game, { ...artifacts, binarySha256: 'c' }));
  assert.notEqual(key, artifactKey(game, { ...artifacts, netSha256: 'd' }));
});

for (const variant of ['banqi', 'three-kingdoms-banqi'] as const) {
  const read = (kind: string) =>
    JSON.parse(
      readFileSync(
        new URL(`rules-page-games/plans/${variant}.${kind}.json`, import.meta.url),
        'utf8',
      ),
    );
  test(`${variant}: generated plan, full analysis, every flip and evidence notes validate together`, () => {
    const game = readGame(variant);
    const input = readFileSync(
      new URL(`rules-page-games/inputs/${variant}.export.json`, import.meta.url),
    );
    assert.equal(
      createHash('sha256')
        .update(JSON.stringify(JSON.parse(input.toString())))
        .digest('hex'),
      variant === 'banqi'
        ? '520a4170f80ff6188a4e9438485f0068a00ece6b407849c6a52445cc19a59b49'
        : '7a93e609d491b8d61f3f2bb742e5ddd418f73f5810d9d3d1cb5585b7dd7ee998',
    );
    const { create } = read('plan') as { create: StudyCreateSpec };
    checkCreate(create);
    const tree = create.chapter.tree as { root: StudyNode; replay?: string; rootFen?: string };
    const notes = read('notes');
    const luck = read('luck');
    const analysis = notes.evidence.analysis as StudyEval[];
    assert.equal(analysis.length, game.ply_count + 1);
    const base = {
      game,
      title: variant,
      treeRoot:
        variant === 'banqi'
          ? { rootFen: game.deal_fen! }
          : { replay: THREE_KINGDOMS_BANQI_PUBLIC_REPLAY },
      moves: serializedTreeMainline(tree),
      analysis,
      decisions: luck.decisions,
      engineId: notes.evidence.engineId,
      decisionEngineId: luck.engineId,
      notes,
      sidelines: [],
    };
    assert.throws(
      () => makePlan({ ...base, analysis: analysis.slice(0, -1) }),
      /incomplete mainline/,
    );
    assert.throws(
      () => makePlan({ ...base, decisions: luck.decisions.slice(1) }),
      /incomplete pool/,
    );
    assert.throws(() => makePlan({ ...base, notes: { ...notes, comments: {} } }), /five to eight/);
    assert.equal(
      parseChapterScoreSeries(create.chapter.scoreSeries, game.ply_count).series[0]!.values.at(-1),
      0,
    );
    assert.equal(notes.evidence.version, variant === 'banqi' ? '0.3.0' : '0.3.1');
    const pins = readFileSync(new URL('../fetch-private-net.sh', import.meta.url), 'utf8');
    assert.ok(pins.includes(notes.evidence.netSha256));
    assert.match(notes.evidence.binarySha256, /^[a-f0-9]{64}$/);
    for (const [i, row] of analysis.entries()) {
      assert.equal(row.ply, i);
      assert.ok(Number.isFinite(row.cp) || Number.isFinite(row.mate));
    }
    const mainline = serializedTreeMainline(tree);
    assert.equal(mainline.length, game.ply_count);
    assert.deepEqual(validateStudyDecisions(variant, tree, luck), luck);
    assert.deepEqual(
      luck.decisions.map((d: { ply: number }) => d.ply),
      game.plies.filter((p) => p.uci.startsWith('@')).map((p) => p.ply),
    );
    const comments = Object.entries(notes.comments) as [string, string][];
    assert.ok(comments.length >= 5 && comments.length <= 8);
    const observed = new Set<string>();
    let node = tree.root;
    for (const [i, ply] of game.plies.entries()) {
      if (ply.revealed) observed.add(`${ply.revealed.color} ${ply.revealed.role}`);
      node = node.children[0]!;
      assert.equal(
        node.uci,
        variant === 'banqi'
          ? token(ply.uci)
          : ply.revealed
            ? `${ply.uci}:${({ general: 'G', advisor: 'A', elephant: 'E', chariot: 'R', horse: 'H', cannon: 'C', soldier: 'S' }[ply.revealed.role])[ply.revealed.color === 'red' ? 'toUpperCase' : 'toLowerCase']()}`
            : ply.uci,
      );
      const note = notes.comments[String(i + 1)] as string | undefined;
      if (note) {
        assert.ok(node.annotations?.comments?.some((c) => c.text.includes(note)));
        assert.doesNotMatch(note, /[\u3400-\u9fff]|—|\b(king|rook|knight|pawn)\b/i);
        for (const named of note
          .toLowerCase()
          .matchAll(/\b(red|black) (general|advisor|elephant|chariot|horse|cannon|soldier)\b/g))
          assert.ok(observed.has(named[0]), `ply ${i + 1} names an unflipped piece: ${named[0]}`);
      }
      const d = luck.decisions.find((d: { ply: number }) => d.ply === i + 1);
      if (d) {
        const g = moveGlyphFor(d.bestWin / 100, d.playedWin / 100);
        assert.deepEqual(node.annotations?.glyphs ?? [], g ? [MOVE_NAG[g]] : []);
      }
    }
    if (variant === 'three-kingdoms-banqi') {
      assert.equal(tree.replay, THREE_KINGDOMS_BANQI_PUBLIC_REPLAY);
      const all = JSON.stringify({ game, plan: read('plan'), notes, luck });
      assert.doesNotMatch(all, /deal_fen|rootFen|"setup"|captured_hidden/);
      assert.deepEqual(mainline, replayThreeKingdomsGame().tokens);
    }
  });

  test(`${variant}: every serialized sideline stops before flips and covered captures`, () => {
    const { create } = read('plan');
    const root = create.chapter.tree.root as StudyNode;
    let branches = 0;
    if (variant === 'banqi') {
      const { states } = replayBanqiGame();
      let cursor = root;
      for (let i = 0; i < states.length - 1; i++) {
        for (const branch of cursor.children.slice(1)) {
          const line: string[] = [];
          let n: StudyNode | undefined = branch;
          while (n) {
            line.push(n.uci!);
            n = n.children[0];
          }
          const engineLine = line.map(
            (t) => `${t[0]}${Number(t[1]) - 1}${t[2]}${Number(t[3]) - 1}`,
          );
          assert.deepEqual(banqiPublicLine(states[i]!, engineLine), line);
          branches++;
        }
        cursor = cursor.children[0]!;
      }
      assert.deepEqual(banqiPublicLine(states[0]!, ['b1b1']), []);
    } else {
      const { states } = replayThreeKingdomsGame();
      let cursor = root;
      for (let i = 0; i < states.length - 1; i++) {
        for (const branch of cursor.children.slice(1)) {
          const line: string[] = [];
          let n: StudyNode | undefined = branch;
          while (n) {
            line.push(n.uci!);
            n = n.children[0];
          }
          assert.deepEqual(threeKingdomsPublicLine(states[i]!, line), line);
          branches++;
        }
        cursor = cursor.children[0]!;
      }
      assert.deepEqual(threeKingdomsPublicLine(states[0]!, ['@f4:A']), []);
    }
    assert.ok(branches > 0, 'the study includes replayable evidence lines');
  });
}
