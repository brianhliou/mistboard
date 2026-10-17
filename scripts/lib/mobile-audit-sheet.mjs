// mobile-audit-sheet.mjs: one HTML page showing every audited screen side by
// side, with the phone's fold marked and the rule findings under each shot.
//
// The page is self-contained apart from its images (shots/<file>), so the
// whole audit directory can be published as one artifact and republished to
// the same URL after the next run.

const SEVERITY_ORDER = { fail: 0, warn: 1 };

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function card(r, notes) {
  const head = `<h2>${esc(r.page)}</h2><p class="url">${esc(r.url ?? '')}</p>`;
  if (r.skipped || r.error || !r.shotFile) {
    const why = r.skipped ?? r.error ?? 'no screenshot';
    return `<article class="card missing">${head}<p class="why">${esc(why)}</p></article>`;
  }
  const findings = [...(r.findings ?? [])].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2),
  );
  const note = notes?.[r.page];
  const list = findings.length
    ? `<ul>${findings
        .map((f) => `<li class="${esc(f.severity)}"><b>${esc(f.rule)}</b> ${esc(f.detail)}</li>`)
        .join('')}</ul>`
    : '<p class="ok">No rule findings.</p>';
  // Percent, so the mark stays on the fold when the image is scaled down.
  const fold =
    r.viewportHeight && r.shotHeight > r.viewportHeight
      ? `<div class="fold" style="top: ${((r.viewportHeight / r.shotHeight) * 100).toFixed(3)}%"><span>fold</span></div>`
      : '';
  return `<article class="card ${esc(r.verdict ?? '')}">${head}${
    note ? `<p class="note">${esc(note)}</p>` : ''
  }<div class="shot"><img src="shots/${esc(r.shotFile)}" alt="${esc(r.page)} on a phone" loading="lazy" width="${r.viewportWidth ?? 390}">${fold}</div>${list}</article>`;
}

// notes: optional { [pageName]: string }, a reviewer's read of a screen that
// the rules cannot see (layout, hierarchy). Kept beside the run, not in code.
export function renderSheet({ base, startedAt, results, device, notes = {} }) {
  const rows = results.filter((r) => !device || r.device === device);
  const fails = rows.filter((r) => r.verdict === 'fail').length;
  const warns = rows.filter((r) => r.verdict === 'warn').length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phone screens</title>
<style>
:root{--bg:#ede8de;--surface:#fbf9f5;--ink:#1f1d1a;--muted:#5f5a52;--line:#d9d3c8;--fail:#b3261e;--warn:#8a5a00;--accent:#1f6f5f}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#1b1a18;--surface:#26241f;--ink:#ece6da;--muted:#a59e92;--line:#3a372f;--fail:#f08a80;--warn:#e0b25c;--accent:#6fc2ae}}
:root[data-theme="dark"]{--bg:#1b1a18;--surface:#26241f;--ink:#ece6da;--muted:#a59e92;--line:#3a372f;--fail:#f08a80;--warn:#e0b25c;--accent:#6fc2ae}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,system-ui,sans-serif}
header{padding:20px 16px 8px;max-width:1800px;margin:0 auto}
h1{margin:0;font-size:22px}
header p{margin:4px 0 0;color:var(--muted)}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,410px),1fr));gap:16px;padding:12px 16px 40px;max-width:1800px;margin:0 auto}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px;min-width:0}
.card.fail{border-color:var(--fail)}
.card h2{margin:0;font-size:16px}
.url{margin:0 0 8px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.note{margin:0 0 8px;padding:6px 8px;border-left:3px solid var(--accent);font-size:14px}
.shot{position:relative;max-height:1400px;overflow:auto;border:1px solid var(--line);border-radius:6px;width:fit-content;max-width:100%;margin:0 auto}
.shot img{display:block;max-width:100%;height:auto}
.fold{position:absolute;left:0;right:0;border-top:2px dashed var(--fail);pointer-events:none}
.fold span{position:absolute;right:4px;top:2px;font-size:11px;color:var(--fail);background:var(--surface);padding:0 4px;border-radius:3px}
ul{margin:8px 0 0;padding-left:18px;font-size:13px}
li.fail b{color:var(--fail)}
li.warn b{color:var(--warn)}
.ok,.why{color:var(--muted);font-size:13px;margin:8px 0 0}
</style>
</head>
<body>
<header>
<h1>Phone screens</h1>
<p>${esc(base)} · ${esc(startedAt)}${device ? ` · ${esc(device)}` : ''} · ${rows.length} pages, ${fails} fail, ${warns} warn. Dashed line: the bottom of the first screen.</p>
</header>
<main>
${rows.map((r) => card(r, notes)).join('\n')}
</main>
</body>
</html>
`;
}
