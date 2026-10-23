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

function shotBlock(r, label) {
  // Percent, so the mark stays on the fold when the image is scaled down.
  const fold =
    r.viewportHeight && r.shotHeight > r.viewportHeight
      ? `<div class="fold" style="top: ${((r.viewportHeight / r.shotHeight) * 100).toFixed(3)}%"><span>fold</span></div>`
      : '';
  const caption = label ? `<figcaption>${esc(label)}</figcaption>` : '';
  if (!r.shotFile)
    return `<figure>${caption}<p class="why">${esc(r.skipped ?? r.error ?? 'no screenshot')}</p></figure>`;
  return `<figure>${caption}<div class="shot"><img src="shots/${esc(r.shotFile)}" alt="${esc(r.page)} on ${esc(r.device)}" loading="lazy" width="${r.viewportWidth ?? 390}">${fold}</div></figure>`;
}

// before: the same page and device on the baseline build, when the sheet
// compares two builds. The findings listed are the branch's.
function card(r, notes, before) {
  const badge = before
    ? r.unchanged
      ? ' <span class="badge same">unchanged</span>'
      : ' <span class="badge diff">changed</span>'
    : '';
  const head = `<h2>${esc(r.page)}${badge}</h2><p class="url">${esc(r.device ?? '')} · ${esc(r.url ?? '')}</p>`;
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
    : r.verdict === 'shot'
      ? ''
      : '<p class="ok">No rule findings.</p>';
  const shots = before
    ? `<div class="pair">${shotBlock(before, 'Before')}${shotBlock(r, 'After')}</div>`
    : shotBlock(r, '');
  const wide = (r.viewportWidth ?? 0) > 800 ? ' wide' : '';
  return `<article class="card ${esc(r.verdict ?? '')}${wide}">${head}${
    note ? `<p class="note">${esc(note)}</p>` : ''
  }${shots}${list}</article>`;
}

// notes: optional { [pageName]: string }, a reviewer's read of a screen that
// the rules cannot see (layout, hierarchy). Kept beside the run, not in code.
export function renderSheet({
  base,
  startedAt,
  results,
  device,
  notes = {},
  beforeBase = null,
  beforeResults = null,
}) {
  const inDevice = (r) => !device || r.device === device;
  const before = beforeResults
    ? new Map(beforeResults.filter(inDevice).map((r) => [`${r.device} ${r.page}`, r]))
    : null;
  const pairOf = (r) =>
    before?.get(`${r.device} ${r.page}`) ??
    (before ? { ...r, shotFile: null, skipped: 'not in the baseline run' } : null);
  // Grouped by device in run order; compared runs list changed screens first.
  const deviceOrder = [...new Set(results.map((r) => r.device))];
  const rows = results
    .filter(inDevice)
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        deviceOrder.indexOf(a.r.device) - deviceOrder.indexOf(b.r.device) ||
        (before ? Number(Boolean(a.r.unchanged)) - Number(Boolean(b.r.unchanged)) : 0) ||
        a.i - b.i,
    )
    .map(({ r }) => r);
  const allWide = rows.length > 0 && rows.every((r) => (r.viewportWidth ?? 0) > 800);
  const anyWide = rows.some((r) => (r.viewportWidth ?? 0) > 800);
  const changed = before ? rows.filter((r) => !r.unchanged).length : 0;
  const title = before
    ? 'Before and after'
    : allWide
      ? 'Desktop screens'
      : anyWide
        ? 'Screens'
        : 'Phone screens';
  const fails = rows.filter((r) => r.verdict === 'fail').length;
  const warns = rows.filter((r) => r.verdict === 'warn').length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
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
main.paired{grid-template-columns:repeat(auto-fill,minmax(min(100%,820px),1fr))}
.card.wide{grid-column:1/-1}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
figure{margin:0;min-width:0}
figcaption{font-size:12px;color:var(--muted);margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}
.badge{font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;vertical-align:middle;border:1px solid currentColor}
.badge.diff{color:var(--warn)}
.badge.same{color:var(--muted)}
</style>
</head>
<body>
<header>
<h1>${title}</h1>
<p>${before ? `Before: ${esc(beforeBase)} · After: ${esc(base)}` : esc(base)} · ${esc(startedAt)}${device ? ` · ${esc(device)}` : ''} · ${rows.length} pages${before ? `, ${changed} changed` : ''}, ${fails} fail, ${warns} warn. Dashed line: the bottom of the first screen.</p>
</header>
<main class="${before ? 'paired' : ''}">
${rows.map((r) => card(r, notes, pairOf(r))).join('\n')}
</main>
</body>
</html>
`;
}

// Runs in the page. A layout fingerprint: every visible element's tag and box
// in the shot's height, text ignored, so a live count or a new chat line does
// not mark a screen as changed while a moved or resized element does.
export function layoutFingerprint({ maxHeight }) {
  const parts = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.top + window.scrollY > maxHeight) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    parts.push(
      `${el.tagName}:${Math.round(r.left)},${Math.round(r.top + window.scrollY)},${Math.round(r.width)},${Math.round(r.height)}`,
    );
  }
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `${parts.length}:${h.toString(16)}`;
}

// Marks each branch row whose baseline row on the same device has the same
// layout fingerprint. A row with no fingerprint on either side stays changed:
// unknown is shown, never hidden.
export function markUnchanged(results, beforeResults) {
  const before = new Map(beforeResults.map((r) => [`${r.device} ${r.page}`, r.layout]));
  return results.map((r) => {
    const b = before.get(`${r.device} ${r.page}`);
    return { ...r, unchanged: Boolean(r.layout && b && r.layout === b) };
  });
}
