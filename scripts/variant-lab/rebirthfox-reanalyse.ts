// TypeScript keeps replay and fog redaction on the site's own rules kernels;
// the Python companion handles resumable UCI searches and report generation.
// Run: node --import tsx scripts/variant-lab/rebirthfox-reanalyse.ts > /tmp/rebirthfox-positions.json

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildXiangqiEngineTurnRequest } from '../../apps/server/src/engine-protocol/build-xiangqi.js';
import * as g from '../../packages/game/src/index.js';

type State = g.XiangqiGameState | g.JieqiGameState | g.BanqiGameState | g.DuckXiangqiGameState;
type ReplayMove = { from: string; to: string; duckTo: string | null };
type PublicExport = {
  game_id: string;
  variant: 'jieqi' | 'banqi' | 'duck-xiangqi' | 'dark-xiangqi';
  deal_fen?: string;
  plies: {
    uci: string;
    mover: 'red' | 'black';
    revealed?: { color: 'red' | 'black'; role: g.JieqiPieceRole };
  }[];
};
type ReplayPiece = { role: string; color: 'red' | 'black'; faceDown?: boolean };
const board = (state: State) => state.board as Record<string, ReplayPiece | undefined>;
const dir = new URL('./rebirthfox-exports/', import.meta.url);
const plus = (s: string) => s.replace(/([a-i])(\d+)/g, (_, f, r) => f + (+r + 1));
const minus = (s: string) => s.replace(/([a-i])(\d+)/g, (_, f, r) => f + (+r - 1));
function parse(s: string): ReplayMove {
  if (s.startsWith('@')) return { from: s.slice(1), to: s.slice(1), duckTo: null };
  const m = /^([a-i](?:10|[0-9]))([a-i](?:10|[0-9]))(?:@([a-i](?:10|[0-9])))?$/.exec(s);
  assert(m, s);
  return { from: m[1], to: m[2], duckTo: m[3] ?? null };
}
function duckFen(s: g.DuckXiangqiGameState): string {
  const rows = g
    .duckXiangqiPlacement(s.board)
    .split('/')
    .map((r) => r.replace(/[1-9]/g, (n) => '.'.repeat(+n)).split(''));
  if (s.duck) rows[10 - +s.duck.slice(1)][s.duck.charCodeAt(0) - 97] = '*';
  const fields = g.duckXiangqiFen(s).split(' ').slice(0, 6);
  fields[0] = rows.map((r) => r.join('').replace(/\.+/g, (a) => String(a.length))).join('/');
  return fields.join(' ');
}
const output: Record<string, unknown> = {};
for (const file of readdirSync(dir)
  .filter((f) => !f.startsWith('xmj_') && f.endsWith('.json'))
  .sort()) {
  const exp = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as PublicExport;
  const variant = exp.variant,
    room = exp.game_id;
  const tokens = exp.plies.map((p) =>
    ['jieqi', 'dark-xiangqi'].includes(variant) ? plus(p.uci) : p.uci,
  );
  const moves = tokens.map(parse);
  let state: State;
  let deal: g.JieqiDeal | undefined;
  if (variant === 'jieqi') {
    // Public exports determine only revealed roles. Fill unknown home squares
    // from the remaining bag; public:true FENs never expose this completion.
    deal = { red: [], black: [] };
    for (const color of ['red', 'black'] as const) {
      const home = g.jieqiHomeSquares(color);
      const bag = [...g.STANDARD_JIEQI_DEAL[color]];
      const known = new Map<string, g.JieqiPieceRole>();
      exp.plies.forEach((p, i) => {
        if (p.revealed?.color === color) {
          known.set(moves[i].from, p.revealed.role);
          const at = bag.indexOf(p.revealed.role);
          assert(at >= 0);
          bag.splice(at, 1);
        }
      });
      deal[color] = home.map((s) => {
        const role = known.get(s) ?? bag.shift();
        assert(role);
        return role;
      });
    }
    state = g.createInitialJieqiState(room, deal, { repetition: true, adjudicationRule: 'jqe-v1' });
  } else if (variant === 'banqi') {
    assert(exp.deal_fen);
    const parsed = g.parseBanqiFen(exp.deal_fen, { gameId: room });
    assert(parsed.ok, JSON.stringify(parsed));
    state = parsed.state;
    state.chaseRule = 'repetition';
  } else if (variant === 'duck-xiangqi') state = g.createInitialDuckXiangqiState(room);
  else state = g.createInitialXiangqiState(room);
  const states: State[] = [state];
  const events: Parameters<typeof buildXiangqiEngineTurnRequest>[0]['events'] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (exp.plies[i].revealed) {
      const p = board(state)[m.from];
      assert(p?.faceDown, `not covered ${room}/${i}`);
      assert.equal(p.role, exp.plies[i].revealed.role);
      assert.equal(p.color, exp.plies[i].revealed.color);
    }
    if (variant === 'jieqi') state = g.applyJieqiMove(state as g.JieqiGameState, m as g.JieqiMove);
    else if (variant === 'banqi')
      state = g.applyBanqiMove(state as g.BanqiGameState, m as g.BanqiMove);
    else if (variant === 'duck-xiangqi')
      state = g.applyDuckXiangqiTurn(state as g.DuckXiangqiGameState, m as g.DuckXiangqiTurn);
    else state = g.applyMove(state as g.XiangqiGameState, m as g.XiangqiMove);
    states.push(state);
    events.push({
      type: 'move-played',
      move: m as g.XiangqiMove,
      roomId: room,
      color: exp.plies[i].mover,
      at: i,
    });
  }
  let windowStart = 0;
  const positions = states.map((s, i) => {
    if (i > 0) {
      const prev = states[i - 1],
        m = moves[i - 1];
      if (variant !== 'duck-xiangqi' && (board(prev)[m.from]?.faceDown || board(prev)[m.to]))
        windowStart = i;
    }
    const fen = (p: State) =>
      variant === 'jieqi'
        ? g.jieqiStateToPikafishFen(p as g.JieqiGameState, { public: true })
        : variant === 'banqi'
          ? g.banqiStateToEngineFen(p as g.BanqiGameState)
          : variant === 'duck-xiangqi'
            ? duckFen(p as g.DuckXiangqiGameState)
            : g.standardXiangqiEngineFen(p as g.XiangqiGameState);
    const engineMove = (m: ReplayMove, j: number) =>
      variant === 'banqi'
        ? g.banqiMoveToEngineUci(m as g.BanqiMove)
        : variant === 'duck-xiangqi'
          ? `${m.from}${m.to}${m.duckTo ? `,${m.to}${m.duckTo}` : ''}`
          : minus(tokens[j]);
    const terminal = s.status.type === 'finished';
    const mover = i % 2 ? 'black' : 'red';
    const req =
      variant === 'dark-xiangqi' && !terminal
        ? buildXiangqiEngineTurnRequest({
            gameId: room,
            engineId: 'python-fdx-v1.2',
            engineSecret: 'offline-public-reanalysis-seed',
            engineColor: mover,
            state: s as g.XiangqiGameState,
            events: events.slice(0, i),
            ply: i,
            clockRemainingMs: 86400000,
            incrementMs: 0,
          })
        : null;
    return {
      ply: i,
      mover,
      fen: fen(s),
      terminal: terminal ? s.status : null,
      position: {
        fen: fen(states[windowStart]),
        moves: moves.slice(windowStart, i).map((m, j) => engineMove(m, windowStart + j)),
      },
      played: i < moves.length ? engineMove(moves[i], i) : null,
      move: tokens[i] ?? null,
      chance: i < moves.length && !!board(s)[moves[i].from]?.faceDown,
      reveal: exp.plies[i]?.revealed ?? null,
      fogRequest: req,
    };
  });
  output[room] = { variant, export: exp, deal, positions };
}
process.stdout.write(JSON.stringify(output));
