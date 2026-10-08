/**
 * The one layout every player email renders through (login codes and the
 * correspondence emails). A caller supplies words and links; this module owns
 * the look, so a new kind of email is a new set of strings, never a new
 * template.
 *
 * HTML rules, because email clients are not browsers:
 * - table layout and inline styles only; Gmail drops <style> in some clients,
 *   so the <style> block carries nothing but the dark-mode and narrow-screen
 *   refinements a client that ignores it can live without;
 * - no remote images (the wordmark is text), so nothing is blocked by default;
 * - hex colours from the site's own tokens (apps/web/src/app-base.css; email
 *   clients handle hsl() unevenly), light by default, with a
 *   prefers-color-scheme block for Apple Mail and other clients that honour it.
 *   Clients that force their own dark mode (Gmail apps, Outlook) invert the
 *   light palette, which stays legible because nothing relies on a background
 *   image or a low-contrast tint.
 *
 * The text part is the same message in plain text, with every URL written out
 * in full, so it reads the same in a client that never renders the HTML.
 */

export type EmailLang = 'en' | 'zh-Hans' | 'zh-Hant';

export type EmailLayoutInput = {
  lang?: EmailLang;
  // Inbox preview line, hidden in the body. Defaults to the first paragraph.
  preheader?: string;
  headline: string;
  paragraphs: readonly string[];
  // A one-time code, set large and monospaced (login, email change, closure).
  code?: string;
  // A short list of linked lines (the daily digest's games).
  items?: readonly { text: string; url: string }[];
  button?: { label: string; url: string };
  footer: {
    // Why the recipient got this email, in one line.
    reason: string;
    // Where to turn it off. Null for mail nobody can opt out of (login codes).
    manage: { label: string; url: string } | null;
  };
};

export type RenderedEmail = { text: string; html: string };

const WORDMARK = 'Mistboard';

// The site every link in a player email points at. One definition so a
// staging host set in MISTBOARD_HOST reaches every email at once.
export const emailPublicHost = process.env.MISTBOARD_HOST ?? 'https://mistboard.com';

// apps/web/src/app-base.css :root (light) and [data-effective-theme="dark"].
const LIGHT = {
  page: '#eeeae3', // --site-bg
  panel: '#ffffff', // --site-panel
  text: '#4f4d4a', // --site-text
  heading: '#34322d', // --site-heading
  muted: '#7a7975', // --site-muted
  border: '#d8d7d4', // --site-border
  soft: '#f7f6f5', // --site-panel-soft
  accent: '#1f6f5b', // --site-brand-accent
  onAccent: '#ffffff', // --site-brand-on-accent
  link: '#228169', // --site-link
};
// The button keeps the light accent in dark mode: white on the lifted dark
// accent (#40a58c) is under 3:1, white on #1f6f5b is over 6:1 on either field.
const DARK = {
  page: '#161512',
  panel: '#262521',
  text: '#bababa',
  heading: '#d1d1d1',
  muted: '#949494',
  border: '#42413d',
  soft: '#33312e',
  link: '#55c3a8',
};

const FONT =
  "'Noto Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

export function renderEmail(input: EmailLayoutInput): RenderedEmail {
  return { text: renderText(input), html: renderHtml(input) };
}

function renderText(input: EmailLayoutInput): string {
  const blocks: string[] = [WORDMARK, input.headline];
  if (input.code) blocks.push(input.code);
  blocks.push(...input.paragraphs);
  if (input.items?.length) {
    blocks.push(input.items.map((item) => `- ${item.text}: ${item.url}`).join('\n'));
  }
  if (input.button) blocks.push(`${input.button.label}: ${input.button.url}`);
  const footer = [input.footer.reason];
  if (input.footer.manage) footer.push(`${input.footer.manage.label}: ${input.footer.manage.url}`);
  blocks.push(`--\n${footer.join('\n')}`);
  return blocks.join('\n\n');
}

function renderHtml(input: EmailLayoutInput): string {
  const lang = input.lang ?? 'en';
  const preheader = input.preheader ?? input.paragraphs[0] ?? input.headline;
  const rows: string[] = [];

  rows.push(
    row(
      `<h1 class="mb-heading" style="margin:0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:${LIGHT.heading}">${escapeHtml(input.headline)}</h1>`,
      '0 0 16px',
    ),
  );
  if (input.code) {
    rows.push(
      row(
        `<div class="mb-code" style="display:inline-block;padding:12px 18px;border:1px solid ${LIGHT.border};border-radius:7px;background-color:${LIGHT.soft};font-family:${MONO};font-size:28px;line-height:1.2;font-weight:700;letter-spacing:0.14em;color:${LIGHT.heading}">${escapeHtml(input.code)}</div>`,
        '4px 0 20px',
      ),
    );
  }
  for (const paragraph of input.paragraphs) {
    rows.push(
      row(
        `<p class="mb-text" style="margin:0;font-family:${FONT};font-size:16px;line-height:1.55;color:${LIGHT.text}">${escapeHtml(paragraph)}</p>`,
        '0 0 14px',
      ),
    );
  }
  if (input.items?.length) {
    const items = input.items
      .map(
        (item, index) =>
          `<tr><td class="mb-item" style="padding:10px 0;${index > 0 ? `border-top:1px solid ${LIGHT.border};` : ''}font-family:${FONT};font-size:16px;line-height:1.45"><a class="mb-link" href="${escapeHtml(item.url)}" style="color:${LIGHT.link};text-decoration:none;font-weight:600">${escapeHtml(item.text)}</a></td></tr>`,
      )
      .join('');
    rows.push(
      row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${items}</table>`,
        '0 0 14px',
      ),
    );
  }
  if (input.button) {
    rows.push(row(buttonHtml(input.button), '10px 0 6px'));
    rows.push(
      row(
        `<p class="mb-muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${LIGHT.muted};word-break:break-all">${escapeHtml(input.button.url)}</p>`,
        '0',
      ),
    );
  }

  const manage = input.footer.manage
    ? `<br><a class="mb-link" href="${escapeHtml(input.footer.manage.url)}" style="color:${LIGHT.link};text-decoration:underline">${escapeHtml(input.footer.manage.label)}</a>`
    : '';

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.headline)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (max-width: 600px) {
  .mb-card { padding: 24px 20px !important; }
  .mb-outer { padding: 16px 8px !important; }
}
@media (prefers-color-scheme: dark) {
  .mb-page { background-color: ${DARK.page} !important; }
  .mb-card { background-color: ${DARK.panel} !important; border-color: ${DARK.border} !important; }
  .mb-heading, .mb-wordmark { color: ${DARK.heading} !important; }
  .mb-text { color: ${DARK.text} !important; }
  .mb-muted, .mb-footer { color: ${DARK.muted} !important; }
  .mb-link { color: ${DARK.link} !important; }
  .mb-item { border-color: ${DARK.border} !important; }
  .mb-code { background-color: ${DARK.soft} !important; border-color: ${DARK.border} !important; color: ${DARK.heading} !important; }
}
</style>
</head>
<body class="mb-page" style="margin:0;padding:0;background-color:${LIGHT.page};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(preheader)}</div>
<table role="presentation" class="mb-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${LIGHT.page}">
<tr><td class="mb-outer" align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:20px;line-height:1;font-weight:700;letter-spacing:0.01em"><a class="mb-wordmark" href="${emailPublicHost}/" style="color:${LIGHT.heading};text-decoration:none">${WORDMARK}</a></td></tr>
<tr><td class="mb-card" style="padding:32px 32px 26px;background-color:${LIGHT.panel};border:1px solid ${LIGHT.border};border-radius:7px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows.join('\n')}
</table>
</td></tr>
<tr><td class="mb-footer" style="padding:18px 4px 0;font-family:${FONT};font-size:13px;line-height:1.55;color:${LIGHT.muted}">${escapeHtml(input.footer.reason)}${manage}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function row(content: string, padding: string): string {
  return `<tr><td style="padding:${padding}">${content}</td></tr>`;
}

// A table-cell button: the cell carries the colour so clients that ignore
// padding on <a> (Outlook) still show a filled block, and the link fills the
// cell so the whole button is the tap target everywhere else.
function buttonHtml(button: { label: string; url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="mb-button" align="center" bgcolor="${LIGHT.accent}" style="border-radius:5px;background-color:${LIGHT.accent}"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;line-height:1.2;font-weight:700;color:${LIGHT.onAccent};text-decoration:none;border-radius:5px">${escapeHtml(button.label)}</a></td></tr></table>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
