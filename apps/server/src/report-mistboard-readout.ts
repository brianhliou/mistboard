import { parseArgs } from 'node:util';
import { getBuildInfo } from './build-info.js';
import {
  type MistboardReadoutTrigger,
  renderMistboardReadoutMarkdown,
  scheduledReadoutTrigger,
} from './mistboard-readout.js';
import { close, init } from './persistence-db.js';
import { generateMistboardReadout } from './persistence-mistboard-readout.js';
import { defaultXiangqiBroadcastFetch } from './xiangqi-broadcast-fetch.js';

const { values } = parseArgs({
  options: {
    trigger: { type: 'string', default: 'manual' },
    format: { type: 'string', default: 'markdown' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    'Usage: npm run readout:mistboard -- ' +
      '[--trigger auto|daily|weekly|manual] [--format markdown|json] [--dry-run]\n',
  );
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const now = new Date();
const trigger = parseTrigger(values.trigger, now);
if (!trigger) throw new Error('--trigger must be auto, daily, weekly, or manual');
if (values.format !== 'markdown' && values.format !== 'json') {
  throw new Error('--format must be markdown or json');
}

init(databaseUrl);
try {
  const { report } = await generateMistboardReadout({
    trigger,
    now,
    dryRun: values['dry-run'],
    dpxqIndexFetch: defaultXiangqiBroadcastFetch,
    runtime: {
      revision: getBuildInfo().revision,
      activeGames: 0,
      databaseRequired: true,
      persistence: 'enabled',
      persistenceErrors: { count1m: 0, lastAt: null },
    },
  });
  process.stdout.write(
    values.format === 'json'
      ? `${JSON.stringify(report)}\n`
      : renderMistboardReadoutMarkdown(report),
  );
} finally {
  await close();
}

function parseTrigger(value: string | undefined, now: Date): MistboardReadoutTrigger | null {
  if (value === 'auto') return scheduledReadoutTrigger(now);
  if (value === 'daily' || value === 'weekly' || value === 'manual') return value;
  return null;
}
