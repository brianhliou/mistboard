import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createInitialThreeKingdomsBanqiReplayState,
  serializedTreeMainline,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
  type ThreeKingdomsBanqiReplayState,
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
  threeKingdomsGradingOptions,
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

// Inspect the bytes that will be stored/sent, without running them through a
// player-view redactor (which would hide a leak before this assertion saw it).
function assertMaskedFen(fen: string, state: ThreeKingdomsBanqiReplayState) {
  const fields = fen.split(' ');
  assert.equal(fields.length, 9, 'public engine FEN has no dealt suffix');
  const rows = fields[0]!.split('/');
  assert.equal(rows.length, 5);
  for (const [row, placement] of rows.entries()) {
    const tiles = [...placement].flatMap((c) =>
      /[1-9]/.test(c) ? Array(Number(c)).fill('.') : [c],
    );
    assert.equal(tiles.length, 9);
    for (const [file, tile] of tiles.entries()) {
      const square = `${String.fromCharCode(97 + file)}${5 - row}` as keyof typeof state.board;
      if (state.board[square]?.faceDown)
        assert.equal(tile, 'X', `covered identity in request at ${square}`);
    }
  }
}

function assertPublicStudy(serialized: string, neverFlipped: readonly string[]) {
  assert.doesNotMatch(serialized, /deal_fen|rootFen|"setup"|captured_hidden/);
  const identity =
    /"(?:role|color|owner|type)"\s*:\s*"|"(?:[GAERHCSgaerhcs]|red|black|general|advisor|elephant|chariot|horse|cannon|soldier|(?:red|black) (?:general|advisor|elephant|chariot|horse|cannon|soldier))"/;
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const square of neverFlipped) {
        // Replay/engine tokens, plus identities stated in commentary.
        assert.doesNotMatch(value, new RegExp(`@?${square}(?:${square})?:[GAERHCSgaerhcs]`));
        assert.doesNotMatch(
          value,
          new RegExp(
            `(?:red|black) (?:general|advisor|elephant|chariot|horse|cannon|soldier) (?:on|at) ${square}\\b`,
            'i',
          ),
        );
      }
      // A FEN embedded anywhere in evidence must keep unobserved tiles covered.
      if (/^[1-9XGAERHCSgaerhcs]+(?:\/[1-9XGAERHCSgaerhcs]+){4} /.test(value)) {
        const board = Object.fromEntries(
          neverFlipped.map((square) => [square, { faceDown: true }]),
        );
        assertMaskedFen(value, { board } as ThreeKingdomsBanqiReplayState);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.faceDown === true) {
      for (const field of ['color', 'role', 'owner', 'type'])
        assert.ok(record[field] == null, `covered piece/capture carries ${field}`);
    }
    for (const square of neverFlipped) {
      if (record[square] != null)
        assert.doesNotMatch(
          JSON.stringify(record[square]),
          identity,
          `identity stored under ${square}`,
        );
      if (['square', 'at', 'from', 'to'].some((field) => record[field] === square)) {
        for (const field of ['color', 'role', 'owner', 'type', 'revealed'])
          assert.ok(record[field] == null, `unobserved ${square} carries ${field}`);
      }
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(JSON.parse(serialized));
}

test('Three Kingdoms stored study artifacts never identify an unflipped tile or covered capture', () => {
  const { states, moves } = replayThreeKingdomsGame();
  const flipped = new Set(moves.filter((move) => move.from === move.to).map((move) => move.from));
  const neverFlipped = Object.keys(states[0]!.board).filter(
    (square) =>
      states[0]!.board[square as keyof (typeof states)[0]['board']]?.faceDown &&
      !flipped.has(square as (typeof moves)[number]['from']),
  );
  assert.equal(neverFlipped.length, 7, 'exercise the actual game’s unrevealed tiles');
  const read = (kind: string) =>
    JSON.parse(
      readFileSync(
        new URL(`rules-page-games/plans/three-kingdoms-banqi.${kind}.json`, import.meta.url),
        'utf8',
      ),
    );
  const artifacts = { plan: read('plan'), luck: read('luck'), notes: read('notes') };
  assertPublicStudy(JSON.stringify(artifacts), neverFlipped);
  const masked = structuredClone(artifacts);
  masked.notes.evidence.board = Object.fromEntries(
    neverFlipped.map((square) => [square, { faceDown: true }]),
  );
  masked.notes.evidence.captures = [{ faceDown: true, role: null }];
  assertPublicStudy(JSON.stringify(masked), neverFlipped);
  // Probe every persisted surface, including notes/evidence and decisions.
  for (const square of neverFlipped) {
    for (const target of ['tree', 'decisions', 'luck', 'notes', 'evidence']) {
      const leaked = structuredClone(artifacts);
      const container = {
        tree: leaked.plan.create.chapter.tree,
        decisions: leaked.luck.decisions[0],
        luck: leaked.luck,
        notes: leaked.notes,
        evidence: leaked.notes.evidence,
      }[target];
      container[square] = { faceDown: true, color: 'red', role: 'soldier' };
      assert.throws(
        () => assertPublicStudy(JSON.stringify(leaked), neverFlipped),
        /identity|covered/,
      );
    }
    const leaked = structuredClone(artifacts);
    leaked.plan.create.chapter.tree.root.children.push({ uci: `@${square}:S`, children: [] });
    assert.throws(() => assertPublicStudy(JSON.stringify(leaked), neverFlipped));
    leaked.plan.create.chapter.tree.root.children.pop();
    leaked.notes.comments['78'] += ` A red soldier on ${square} stays covered.`;
    assert.throws(() => assertPublicStudy(JSON.stringify(leaked), neverFlipped));
  }
  const fenLeak = structuredClone(artifacts);
  const revealed = structuredClone(states[0]!);
  revealed.board[neverFlipped[0] as keyof typeof revealed.board] = {
    faceDown: false,
    color: 'red',
    role: 'soldier',
  };
  fenLeak.notes.evidence.fen = publicRequest([revealed], [], 1, 1).fen;
  assert.throws(() => assertPublicStudy(JSON.stringify(fenLeak), neverFlipped), /covered identity/);
  const captured = structuredClone(artifacts);
  captured.notes.evidence.captures = [{ faceDown: true, role: 'soldier', owner: 'red' }];
  assert.throws(
    () => assertPublicStudy(JSON.stringify(captured), neverFlipped),
    /covered piece\/capture/,
  );
});

test('Three Kingdoms analysis and decision requests mask every covered tile and retain quiet history', async () => {
  const { states, moves } = replayThreeKingdomsGame();
  const grading = threeKingdomsGradingOptions();
  let decisionRequests = 0;
  for (let ply = 0; ply < moves.length; ply++) {
    const request = publicRequest(
      states.slice(0, ply + 1),
      moves.slice(0, ply),
      grading.analysis.nodes,
      grading.analysis.movetimeCapMs,
    );
    const start = ply - states[ply]!.noProgressClock;
    assert.equal(request.fen, threeKingdomsBanqiStateToEngineFen(states[start]!));
    assertMaskedFen(request.fen, states[start]!);
    assert.deepEqual(
      request.moves,
      moves.slice(start, ply).map((m) => `${m.from}${m.to}`),
    );
    assert.equal(request.chance, 'mix');
    if (request.fen.includes('X'))
      assert.throws(
        () => assertMaskedFen(request.fen.replace('X', 'S'), states[start]!),
        /covered identity/,
      );
    const played = moves[ply]!;
    if (played.from !== played.to) continue;
    await decisions.evaluateThreeKingdomsBanqiPublicFlipDecision(
      states[ply]!,
      played,
      ply + 1,
      (post, action) => {
        const history = action ? [...states.slice(0, ply + 1), post] : states.slice(0, ply + 1);
        const line = action ? [...moves.slice(0, ply), action] : moves.slice(0, ply);
        const request = publicRequest(
          history,
          line,
          grading.decisions.nodes,
          grading.decisions.movetimeCapMs,
        );
        const root = history[history.length - 1 - post.noProgressClock]!;
        assertMaskedFen(request.fen, root);
        if (request.fen.includes('X'))
          assert.throws(
            () => assertMaskedFen(request.fen.replace('X', 'S'), root),
            /covered identity/,
          );
        decisionRequests++;
        return request;
      },
      async (request) => ({ cp: 0, mate: null, depth: 1, best: request.searchMoves?.[0] ?? null }),
    );
  }
  assert.ok(decisionRequests > 100, 'exercise candidate ranking and counterfactual pool requests');
});

test('checkpoint identity binds the export, engine bytes, pinned net and complete grading recipe', () => {
  const game = readGame('three-kingdoms-banqi');
  const artifacts = {
    identity: 'MistyThreeKingdomsBanqi 0.3.1',
    version: '0.3.1',
    binarySha256: 'a',
    netSha256: 'b',
  };
  const options = threeKingdomsGradingOptions();
  const key = artifactKey(game, artifacts, options);
  assert.equal(key, artifactKey(structuredClone(game), { ...artifacts }, structuredClone(options)));
  assert.notEqual(key, artifactKey({ ...game, game_id: 'another-game' }, artifacts, options));
  assert.notEqual(key, artifactKey(game, { ...artifacts, binarySha256: 'c' }, options));
  assert.notEqual(key, artifactKey(game, { ...artifacts, netSha256: 'd' }, options));
  for (const section of ['analysis', 'decisions'] as const) {
    for (const field of ['engineId', 'nodes', 'movetimeCapMs'] as const) {
      const changed = structuredClone(options);
      if (field === 'engineId') changed[section][field] += '-new-algorithm';
      else changed[section][field]++;
      assert.notEqual(
        key,
        artifactKey(game, artifacts, changed),
        `${section}.${field} must invalidate checkpoints`,
      );
    }
  }
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
      lineName: 'Level 8',
      compare: {
        name: 'Level 7',
        engineId: notes.evidence.level7.engineId,
        analysis: notes.evidence.level7.analysis as StudyEval[],
      },
    };
    assert.throws(
      () => makePlan({ ...base, analysis: analysis.slice(0, -1) }),
      /incomplete mainline/,
    );
    assert.throws(
      () => makePlan({ ...base, compare: { ...base.compare, analysis: analysis.slice(0, -1) } }),
      /incomplete comparison/,
    );
    assert.throws(
      () => makePlan({ ...base, decisions: luck.decisions.slice(1) }),
      /incomplete pool/,
    );
    assert.throws(() => makePlan({ ...base, notes: { ...notes, comments: {} } }), /five to eight/);
    // Both levels read the whole game; the final point is the result for each line.
    const chart = parseChapterScoreSeries(create.chapter.scoreSeries, game.ply_count);
    assert.deepEqual(
      chart.series.map((line) => [line.name, line.color, line.values.length, line.values.at(-1)]),
      [
        ['Level 7', 'a', game.ply_count + 1, 0],
        ['Level 8', 'b', game.ply_count + 1, 0],
      ],
    );
    // Two separate reads, not one line drawn twice.
    assert.notDeepEqual(chart.series[0]!.values, chart.series[1]!.values);
    assert.notEqual(notes.evidence.level7.engineId, notes.evidence.engineId);
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
