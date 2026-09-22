// Megaphone: post each new feed item to X (Twitter), once.
//
// Source of truth is the LIVE /feed.xml, not the repo. Two reasons:
//   1. The built feed already has the variant public-surface filter applied, so
//      the tweeted set and the published set cannot drift apart.
//   2. Reading what is deployed makes it impossible to announce something that
//      is not yet on the site. A megaphone that runs ahead of the deploy points
//      people at a 404.
//
// Idempotency is a ledger keyed by the RSS <guid>, which is derived from the
// announcement's date and headline and does not change when its link does.
// The ledger lives at ~/.config/mistboard/tweeted-announcements.json, beside
// the credentials, because the poster runs on the release machine after the
// release has pushed: a committed ledger would leave every release with a
// dirty file to commit and push again. scripts/data/tweeted-announcements.json
// is the seed a machine starts from when it has no ledger yet (the feed as of
// 2026-09-22, all marked, so a new machine never tweets the backlog).
//
//   node scripts/announce-tweet.mjs                  # dry run, shows what would post
//   node scripts/announce-tweet.mjs --post           # actually post
//   node scripts/announce-tweet.mjs --mark-all       # ledger everything live, post nothing
//   node scripts/announce-tweet.mjs --max 1          # cap this run (default 3)
//   node scripts/announce-tweet.mjs --host http://localhost:3000
//
// Credentials come from the environment, or from ~/.config/mistboard/x.env
// (KEY=VALUE lines) when the environment has none, and are never printed:
//   X_API_KEY  X_API_SECRET  X_ACCESS_TOKEN  X_ACCESS_TOKEN_SECRET
// They are an X app's consumer pair plus the @Mistboard account's user tokens,
// with Read and write permission (mistboard#433). The app's project is pay per
// use, so a post costs a fraction of a cent and a missing card fails the post.
//
// release-prod.mjs runs `--post --max 3` after a deploy's smokes pass, when the
// credentials file exists; a failure there is a warning, not a failed release.
import { createHmac, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(homedir(), '.config', 'mistboard');
const ledgerPath = resolve(configDir, 'tweeted-announcements.json');
const seedLedgerPath = resolve(__dirname, 'data', 'tweeted-announcements.json');
export const credentialsPath = resolve(configDir, 'x.env');

const TWEET_LIMIT = 280;
// X counts every link as this many characters regardless of its real length.
const TCO_LENGTH = 23;
const API_URL = 'https://api.x.com/2/tweets';

function parseArgs(argv) {
  const args = { post: false, markAll: false, max: 3, host: 'https://mistboard.com' };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--post') {
      args.post = true;
      i += 1;
    } else if (arg === '--mark-all') {
      args.markAll = true;
      i += 1;
    } else if (arg === '--max') {
      args.max = Number(argv[i + 1]);
      i += 2;
    } else if (arg === '--host') {
      args.host = argv[i + 1];
      i += 2;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!args.host) throw new Error('--host wants a value');
  if (!Number.isInteger(args.max) || args.max < 1)
    throw new Error('--max wants a positive integer');
  return args;
}

// --- feed -------------------------------------------------------------------

const unescapeXml = (value) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const tagText = (block, tag) => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? unescapeXml(match[1].trim()) : null;
};

async function readFeed(host) {
  const url = `${host.replace(/\/+$/, '')}/feed.xml`;
  const response = await fetch(url, { headers: { accept: 'application/rss+xml' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => ({
    guid: tagText(block, 'guid'),
    title: tagText(block, 'title'),
    link: tagText(block, 'link'),
    description: tagText(block, 'description'),
    pubDate: tagText(block, 'pubDate'),
  }));
  const usable = items.filter((item) => item.guid && item.title && item.link);
  if (usable.length === 0) throw new Error(`${url} parsed to zero usable items`);
  return usable;
}

// --- ledger -----------------------------------------------------------------

async function readLedgerFile(path) {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf-8'));
    return Array.isArray(parsed.posted) ? parsed : { posted: [] };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// The local ledger, or the committed seed on a machine that has none yet.
async function readLedger() {
  const local = await readLedgerFile(ledgerPath);
  if (local) return local;
  const seed = await readLedgerFile(seedLedgerPath);
  if (seed) console.log(`no ledger at ${ledgerPath}; starting from the committed seed`);
  return seed ?? { posted: [] };
}

async function writeLedger(ledger) {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
}

// --- composition ------------------------------------------------------------

// Headline, then as much of the body as fits, then the link. The headline is
// never truncated: a half-sentence reads worse than no body at all.
export function composeTweet(item) {
  const budget = TWEET_LIMIT - TCO_LENGTH - 1;
  const headline = item.title.trim();
  if (headline.length >= budget) return `${headline.slice(0, budget - 1).trimEnd()}… ${item.link}`;
  const body = (item.description ?? '').trim();
  const room = budget - headline.length - 1;
  if (body.length > 0 && body.length <= room) return `${headline} ${body} ${item.link}`;
  return `${headline} ${item.link}`;
}

// --- OAuth 1.0a -------------------------------------------------------------
// X's write endpoints take OAuth 1.0a user context. A JSON body is not part of
// the signature base string, so only the oauth_* parameters are signed.

const percentEncode = (value) =>
  encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function authorizationHeader(credentials) {
  const params = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };
  const base = [
    'POST',
    percentEncode(API_URL),
    percentEncode(
      Object.keys(params)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
        .join('&'),
    ),
  ].join('&');
  const key = `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`;
  const signed = {
    ...params,
    oauth_signature: createHmac('sha1', key).update(base).digest('base64'),
  };
  const header = Object.keys(signed)
    .sort()
    .map((name) => `${percentEncode(name)}="${percentEncode(signed[name])}"`)
    .join(', ');
  return `OAuth ${header}`;
}

// KEY=VALUE lines; blank lines and # comments skipped; optional quotes around
// the value. Values are returned, never logged.
export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function readCredentials() {
  const fromFile = await fs
    .readFile(credentialsPath, 'utf-8')
    .then(parseEnvFile)
    .catch((err) => {
      if (err.code === 'ENOENT') return {};
      throw err;
    });
  const env = (name) => process.env[name] || fromFile[name];
  const credentials = {
    apiKey: env('X_API_KEY'),
    apiSecret: env('X_API_SECRET'),
    accessToken: env('X_ACCESS_TOKEN'),
    accessSecret: env('X_ACCESS_TOKEN_SECRET'),
  };
  const missing = Object.entries(credentials)
    .filter(([, value]) => !value)
    .map(
      ([name]) =>
        ({
          apiKey: 'X_API_KEY',
          apiSecret: 'X_API_SECRET',
          accessToken: 'X_ACCESS_TOKEN',
          accessSecret: 'X_ACCESS_TOKEN_SECRET',
        })[name],
    );
  if (missing.length > 0) {
    throw new Error(
      `missing credentials: ${missing.join(', ')} (environment or ${credentialsPath})`,
    );
  }
  return credentials;
}

async function postTweet(text, credentials) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: authorizationHeader(credentials),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  const payload = await response.text();
  if (!response.ok) {
    // The body is X's error JSON; it carries no credential material.
    throw new Error(`X API returned HTTP ${response.status}: ${payload.slice(0, 400)}`);
  }
  return JSON.parse(payload).data?.id ?? null;
}

// --- run --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [items, ledger] = await Promise.all([readFeed(args.host), readLedger()]);
  const posted = new Set(ledger.posted.map((row) => row.guid));

  // Feed order is newest first; post oldest first so a backlog reads forwards.
  const pending = items.filter((item) => !posted.has(item.guid)).reverse();

  if (args.markAll) {
    const stamp = new Date().toISOString();
    ledger.posted.push(
      ...pending.map((item) => ({
        guid: item.guid,
        tweetId: null,
        at: stamp,
        note: 'marked without posting',
      })),
    );
    await writeLedger(ledger);
    console.log(`marked ${pending.length} live item(s) as already announced; nothing posted`);
    return;
  }

  if (pending.length === 0) {
    console.log(`nothing to announce (${items.length} live item(s), all in the ledger)`);
    return;
  }

  const batch = pending.slice(0, args.max);
  const held = pending.length - batch.length;
  console.log(
    `${pending.length} unannounced item(s); ${args.post ? 'posting' : 'would post'} ${batch.length}`,
  );
  if (held > 0) console.log(`holding ${held} for the next run (--max ${args.max})`);

  if (!args.post) {
    for (const item of batch) {
      const text = composeTweet(item);
      console.log(`\n--- ${item.guid} (${text.length} chars) ---\n${text}`);
    }
    console.log('\ndry run; pass --post to send');
    return;
  }

  const credentials = await readCredentials();
  for (const item of batch) {
    const text = composeTweet(item);
    // Persist per item, not at the end: a mid-run failure must not re-announce
    // what already went out.
    const tweetId = await postTweet(text, credentials);
    ledger.posted.push({ guid: item.guid, tweetId, at: new Date().toISOString() });
    await writeLedger(ledger);
    console.log(`posted ${item.guid} -> ${tweetId ?? 'unknown id'}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
