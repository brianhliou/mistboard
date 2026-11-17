import { standardXiangqiPositionKey, type XiangqiPuzzle } from '@mistboard/game';
import { seedPuzzleContentHash } from '@mistboard/game/puzzle-seed';
import type pg from 'pg';
import { withTransaction } from './persistence-db.js';
import {
  readXiangqiPositionPacket,
  type XiangqiPositionPacket,
  type XiangqiPositionPublicationItem,
  xiangqiPositionPacketHash,
  xiangqiPositionPuzzleHash,
} from './xiangqi-puzzle-position-packet.js';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;
export type XiangqiPositionPublicationPlan = {
  packetSha256: string;
  total: number;
  alreadyPublished: number;
  nextSequence: number;
  items: XiangqiPositionPublicationItem[];
};

export async function planXiangqiPositionPublication(
  db: Queryable,
  input: unknown,
): Promise<XiangqiPositionPublicationPlan> {
  const packet = readXiangqiPositionPacket(input);
  const packetSha256 = xiangqiPositionPacketHash(packet);
  const sync = await db.query<{ seed_hash: string }>(
    'SELECT seed_hash FROM puzzle_seed_sync WHERE slot = $1',
    ['puzzles'],
  );
  if (sync.rows[0]?.seed_hash !== seedPuzzleContentHash())
    throw new Error('Synchronize the puzzle seed before publication');
  const stored = await db.query<{
    id: string;
    variant: string;
    data: XiangqiPuzzle;
    seq: number;
    position_only: boolean;
  }>('SELECT id, variant, data, seq, position_only FROM puzzles ORDER BY seq, id');
  const receipts = await db.query<{
    puzzle_id: string;
    packet_sha256: string;
    puzzle_sha256: string;
  }>('SELECT puzzle_id, packet_sha256, puzzle_sha256 FROM xiangqi_position_publications');
  const byId = new Map(stored.rows.map((r) => [r.id, r]));
  const byReceipt = new Map(receipts.rows.map((r) => [r.puzzle_id, r]));
  const positions = new Map<string, string>();
  for (const row of stored.rows) {
    if (row.variant !== 'xiangqi') continue;
    positions.set(standardXiangqiPositionKey(row.data.initial), row.id);
  }
  const seen = new Set<string>();
  const items: XiangqiPositionPublicationItem[] = [];
  let alreadyPublished = 0;
  for (const item of packet.items) {
    const p = item.puzzle,
      key = standardXiangqiPositionKey(p.initial);
    if (seen.has(key)) throw new Error('Packet repeats a puzzle position');
    seen.add(key);
    const receipt = byReceipt.get(p.id),
      row = byId.get(p.id);
    if (receipt) {
      if (
        !row?.position_only ||
        receipt.packet_sha256 !== packetSha256 ||
        receipt.puzzle_sha256 !== xiangqiPositionPuzzleHash(p) ||
        xiangqiPositionPuzzleHash(row.data) !== receipt.puzzle_sha256
      )
        throw new Error(`Published position packet changed for ${p.id}`);
      alreadyPublished++;
      continue;
    }
    if (row) throw new Error(`Puzzle id already exists: ${p.id}`);
    if (positions.has(key)) throw new Error(`Position already exists as ${positions.get(key)}`);
    items.push(item);
  }
  const nextSequence = stored.rows.reduce((max, r) => Math.max(max, r.seq), -1) + 1;
  return { packetSha256, total: packet.items.length, alreadyPublished, nextSequence, items };
}

export async function publishXiangqiPositionPacket(input: {
  packet: XiangqiPositionPacket;
  expectedTotal: number;
  expectedPacketSha256: string;
  operatorNote: string;
}) {
  if (
    !Number.isSafeInteger(input.expectedTotal) ||
    input.expectedTotal < 1 ||
    !/^[a-f0-9]{64}$/.test(input.expectedPacketSha256) ||
    !input.operatorNote.trim() ||
    input.operatorNote.length > 1000
  )
    throw new Error('Publication needs exact count, packet hash and operator note');
  // Freeze the caller's data before any asynchronous database work.
  const packet = readXiangqiPositionPacket(input.packet);
  return withTransaction(async (db) => {
    // Same lock as seed sync and legacy publication: global serving order and
    // duplicate checks are serialized across both publication paths.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['mistboard:puzzle-seed-sync']);
    const plan = await planXiangqiPositionPublication(db, packet);
    if (plan.total !== input.expectedTotal || plan.packetSha256 !== input.expectedPacketSha256)
      throw new Error('Publication count or packet hash changed');
    let seq = plan.nextSequence;
    for (const item of plan.items) {
      const p = item.puzzle;
      await db.query(
        `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, mined_at, position_only)
         VALUES ($1, 'xiangqi', $2, $3, $4, $5, $6, $7::json, 'mined', now(), true)`,
        [p.id, p.title, seq++, p.goal.type, p.themes, p.solution.length, JSON.stringify(p)],
      );
      await db.query(
        `INSERT INTO xiangqi_position_publications
         (puzzle_id, packet_sha256, puzzle_sha256, position_key, receipt, operator_note)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          p.id,
          plan.packetSha256,
          xiangqiPositionPuzzleHash(p),
          standardXiangqiPositionKey(p.initial),
          JSON.stringify({
            version: packet.version,
            source: packet.source,
            engine: packet.engine,
            admissionProfile: packet.admissionProfile,
            verificationProfile: packet.verificationProfile,
            verify: item.verify,
            audit: item.audit,
            review: item.review,
          }),
          input.operatorNote.trim(),
        ],
      );
    }
    return {
      packetSha256: plan.packetSha256,
      total: plan.total,
      publishedNow: plan.items.length,
      alreadyPublished: plan.alreadyPublished,
    };
  });
}
