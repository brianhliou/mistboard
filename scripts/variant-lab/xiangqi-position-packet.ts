import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  readXiangqiPositionPacket,
  sealXiangqiPositionAudit,
  XIANGQI_POSITION_PACKET_ENGINE,
  XIANGQI_POSITION_PACKET_VERSION,
  type XiangqiPositionPacket,
  xiangqiPositionPacketHash,
  xiangqiPositionPuzzleHash,
} from '../../apps/server/src/xiangqi-puzzle-position-packet.ts';
import {
  readXiangqiPositionOnlyPuzzle,
  XIANGQI_PUZZLE_ADMISSION_PROFILE,
  XIANGQI_PUZZLE_VERIFICATION_PROFILE,
} from '../../packages/game/src/index.ts';
import { auditXiangqiCorpusPuzzle } from './xiangqi-corpus-quality-audit.ts';
import { PikafishEngine } from './xiangqi-pikafish-uci.ts';

export async function buildXiangqiPositionPacket(input: {
  puzzles: unknown[];
  reviewNote: string;
  engine: Pick<PikafishEngine, 'newGame' | 'analyzeFen'> &
    Partial<Pick<PikafishEngine, 'hashMb' | 'lastSearch'>>;
}): Promise<XiangqiPositionPacket> {
  if (!input.reviewNote.trim() || input.reviewNote.length > 1000)
    throw new Error('An editorial review note is required');
  const items = [];
  for (const value of input.puzzles) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Invalid review puzzle');
    const { kind, publishable, policyVersion, ...core } = value as Record<string, unknown>;
    if (
      (kind !== undefined && kind !== 'puzzle-review') ||
      (publishable !== undefined && publishable !== false) ||
      (policyVersion !== undefined && typeof policyVersion !== 'string')
    )
      throw new Error('Invalid review envelope');
    const puzzle = readXiangqiPositionOnlyPuzzle(core);
    // Both independent checks bind the final position-only shape, not a prior
    // source-game record. Native solver searches clear their hash per turn.
    const verify = sealXiangqiPositionAudit(
      puzzle,
      await auditXiangqiCorpusPuzzle(input.engine, puzzle),
    );
    const audit = sealXiangqiPositionAudit(
      puzzle,
      await auditXiangqiCorpusPuzzle(input.engine, puzzle),
    );
    items.push({
      puzzle,
      verify,
      audit,
      review: { puzzleHash: xiangqiPositionPuzzleHash(puzzle), note: input.reviewNote.trim() },
    });
  }
  return readXiangqiPositionPacket({
    version: XIANGQI_POSITION_PACKET_VERSION,
    source: 'dpxq',
    engine: XIANGQI_POSITION_PACKET_ENGINE,
    admissionProfile: XIANGQI_PUZZLE_ADMISSION_PROFILE,
    verificationProfile: XIANGQI_PUZZLE_VERIFICATION_PROFILE,
    items,
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      out: { type: 'string' },
      binary: { type: 'string' },
      net: { type: 'string' },
      'review-note': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(
      '--input REVIEW.json --out PACKET.json --binary ENGINE --net NET --review-note NOTE\n',
    );
    return;
  }
  if (!values.input || !values.out || !values.binary || !values.net || !values['review-note'])
    throw new Error('Input, output, pinned engine/net and review note are required');
  if (statSync(values.input).size > 16 * 1024 * 1024) throw new Error('Review file exceeds 16 MiB');
  const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (
    sha(values.binary) !== XIANGQI_POSITION_PACKET_ENGINE.binarySha256 ||
    sha(values.net) !== XIANGQI_POSITION_PACKET_ENGINE.networkSha256
  )
    throw new Error('Position packet requires the pinned engine and network');
  const review = JSON.parse(readFileSync(values.input, 'utf8')) as { packets?: unknown[] };
  if (!Array.isArray(review.packets)) throw new Error('Review input must contain packets');
  const engine = new PikafishEngine(values.binary, values.net, 64);
  try {
    await engine.init();
    const packet = await buildXiangqiPositionPacket({
      puzzles: review.packets,
      reviewNote: values['review-note'],
      engine,
    });
    writeFileSync(values.out, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(
      `${JSON.stringify({ total: packet.items.length, packetSha256: xiangqiPositionPacketHash(packet), productionWrites: false })}\n`,
    );
  } finally {
    engine.quit();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
