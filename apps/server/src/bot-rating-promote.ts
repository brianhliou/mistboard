import pg from 'pg';
import {
  type BotRatingSnapshotPromotionOptions,
  promoteBotRatingSnapshots,
  renderBotRatingSnapshotsMarkdown,
} from './bot-rating-snapshots.js';
import { parseRatingTimeClass } from './rating-buckets.js';

type CliArgs = BotRatingSnapshotPromotionOptions & {
  format?: 'json' | 'markdown';
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to promote bot rating snapshots');
  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const promoted = await promoteBotRatingSnapshots(pool, args);
    if ((args.format ?? 'markdown') === 'json') {
      console.log(
        JSON.stringify(
          {
            level: 'info',
            kind: 'bot_rating_snapshot_promote',
            promoted,
          },
          null,
          2,
        ),
      );
    } else {
      process.stdout.write(`Promoted ${promoted.length} bot rating snapshot(s).\n\n`);
      process.stdout.write(renderBotRatingSnapshotsMarkdown(promoted));
    }
  } finally {
    await pool.end();
  }
}

function parseArgs(values: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 0; index < values.length; index++) {
    const arg = values[index]!;
    if (!arg.startsWith('--')) continue;
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const value = inlineValue ?? values[++index];
    if (!value) throw new Error(`missing value for --${rawKey}`);
    switch (rawKey) {
      case 'bot':
      case 'bot-id':
        parsed.botId = value;
        break;
      case 'format':
        if (value !== 'json' && value !== 'markdown')
          throw new Error('--format must be json or markdown');
        parsed.format = value;
        break;
      case 'game-spec':
      case 'game-spec-id':
        parsed.gameSpecId = value;
        break;
      case 'snapshot':
      case 'snapshot-id':
        parsed.snapshotId = positiveInteger(value, 'snapshot id');
        break;
      case 'source-ref':
        parsed.sourceRef = value;
        break;
      case 'time-class': {
        const timeClass = parseRatingTimeClass(value);
        // Bots have no correspondence ladder (bot_rating_snapshots is live-only).
        if (!timeClass || timeClass === 'correspondence') {
          throw new Error('--time-class must be bullet, blitz, or rapid');
        }
        parsed.timeClass = timeClass;
        break;
      }
      default:
        throw new Error(`unknown argument --${rawKey}`);
    }
  }
  return parsed;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
