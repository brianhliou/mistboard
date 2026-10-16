// Renders every player email (correspondence start, deadline warning, daily
// digest, and the account codes) with sample data to HTML and text files, plus
// an index.html linking them, for looking at the templates in a browser.
//
//   npm run email:preview [-- <out-dir>]   (default: a folder in the OS temp dir)
//
// Sends nothing; only the builders run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { accountCodeEmail } from '../account-session.js';
import { escapeHtml } from '../email-layout.js';
import {
  correspondenceDeadlineEmail,
  correspondenceDigestEmail,
  correspondenceStartEmail,
  type EmailLocale,
  type PlayerEmail,
} from '../player-email.js';

const outDir = resolve(process.argv[2] ?? resolve(tmpdir(), 'mistboard-email-preview'));
mkdirSync(outDir, { recursive: true });

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const now = new Date();

const samples: Array<{ name: string; email: PlayerEmail }> = [];
for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as EmailLocale[]) {
  const tag = locale.toLowerCase();
  samples.push(
    {
      name: `${tag}-start-your-move`,
      email: correspondenceStartEmail(
        {
          roomId: 'bq_8f3k2m',
          gameSpecId: 'banqi',
          opponentName: 'rebirthfox333',
          creatorOnMove: true,
          daysPerMove: 1,
        },
        locale,
      ),
    },
    {
      name: `${tag}-start-their-move`,
      email: correspondenceStartEmail(
        {
          roomId: 'jq_4n7p1x',
          gameSpecId: 'jieqi',
          opponentName: 'countallloss',
          creatorOnMove: false,
          daysPerMove: 3,
        },
        locale,
      ),
    },
    {
      name: `${tag}-deadline`,
      email: correspondenceDeadlineEmail(
        {
          roomId: 'dxq_2c9v6b',
          gameSpecId: 'dark-xiangqi',
          opponentName: 'mistwalker',
          allowanceMs: DAY_MS,
          remainingMs: 8 * HOUR_MS,
        },
        locale,
      ),
    },
    {
      name: `${tag}-digest-one`,
      email: correspondenceDigestEmail(
        [
          {
            roomId: 'xq_7h1d3s',
            gameSpecId: 'xiangqi',
            opponentName: 'redcannon',
            dueAt: new Date(now.getTime() + 2 * DAY_MS),
          },
        ],
        now,
        locale,
      ),
    },
    {
      name: `${tag}-digest-three`,
      email: correspondenceDigestEmail(
        [
          {
            roomId: 'jq_4n7p1x',
            gameSpecId: 'jieqi',
            opponentName: 'countallloss',
            dueAt: new Date(now.getTime() + 20 * HOUR_MS),
          },
          {
            roomId: 'dk_5r8t2q',
            gameSpecId: 'duck-xiangqi',
            opponentName: 'quackmate',
            dueAt: new Date(now.getTime() + 2 * DAY_MS),
          },
          {
            roomId: 'jf_9w3e4r',
            gameSpecId: 'jungle-flip',
            opponentName: null,
            dueAt: new Date(now.getTime() + 6 * DAY_MS),
          },
        ],
        now,
        locale,
      ),
    },
  );
}
for (const purpose of ['login', 'email-change', 'account-closure'] as const) {
  samples.push({ name: `code-${purpose}`, email: accountCodeEmail('48203915', purpose) });
}

const rows: string[] = [];
for (const { name, email } of samples) {
  writeFileSync(resolve(outDir, `${name}.html`), email.html);
  writeFileSync(resolve(outDir, `${name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`);
  rows.push(
    `<tr><td><a href="${name}.html">${name}</a> · <a href="${name}.txt">text</a></td><td>${escapeHtml(email.subject)}</td></tr>`,
  );
}
writeFileSync(
  resolve(outDir, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Email previews</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;color:#34322d}td{padding:6px 14px 6px 0;vertical-align:top}a{color:#228169}</style>
</head><body><h1>Mistboard player emails</h1><table>${rows.join('\n')}</table></body></html>\n`,
);
console.log(`wrote ${samples.length} previews: ${resolve(outDir, 'index.html')}`);
