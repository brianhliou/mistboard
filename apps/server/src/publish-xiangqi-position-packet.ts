import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { close, getPool, init } from './persistence-db.js';
import { readXiangqiPositionPacket } from './xiangqi-puzzle-position-packet.js';
import {
  planXiangqiPositionPublication,
  publishXiangqiPositionPacket,
} from './xiangqi-puzzle-position-publication.js';

const { values } = parseArgs({
  options: {
    packet: { type: 'string' },
    'expect-total': { type: 'string' },
    'expect-sha256': { type: 'string' },
    'operator-note': { type: 'string' },
    apply: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  process.stdout.write(
    'Dry run: --packet FILE --expect-total N\nApply: add --apply --expect-sha256 SHA --operator-note NOTE\n',
  );
  process.exit(0);
}
if (!values.packet || statSync(values.packet).size > 16 * 1024 * 1024)
  throw new Error('A packet file up to 16 MiB is required');
const total = Number(values['expect-total']);
if (!Number.isSafeInteger(total) || total < 1)
  throw new Error('--expect-total must be a positive integer');
const packet = readXiangqiPositionPacket(JSON.parse(readFileSync(values.packet, 'utf8')));
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
init(process.env.DATABASE_URL);
try {
  if (values.apply) {
    const result = await publishXiangqiPositionPacket({
      packet,
      expectedTotal: total,
      expectedPacketSha256: values['expect-sha256'] ?? '',
      operatorNote: values['operator-note'] ?? '',
    });
    process.stdout.write(`${JSON.stringify({ apply: true, ...result })}\n`);
  } else {
    const { items, ...plan } = await planXiangqiPositionPublication(getPool(), packet);
    if (plan.total !== total) throw new Error('Publication count changed');
    process.stdout.write(`${JSON.stringify({ apply: false, ...plan, eligible: items.length })}\n`);
  }
} finally {
  await close();
}
