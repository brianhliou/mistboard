// Pure half of scripts/jieqi-state-gallery.mjs: the state catalogue, the
// loopback guard, the scripted-move policy and the gallery page. No sockets, no
// browser, so scripts/jieqi-state-gallery.test.mjs can pin all of it.

// The scripted states. Each is its own room, replaying `moves` from the start
// as both seats. A move is 'from-to' (geometry that holds for every deal: a
// face-down piece moves as the piece whose home square it stands on) or
// { policy: n } for n plies of pickPolicyMove, which reads only the mover's own
// PlayerView. With the server's dev deal seed fixed
// (MISTBOARD_DEV_JIEQI_DEAL_SEED) the policy plies replay identically.
export const GALLERY_STATES = [
  {
    id: 'a',
    title: 'Opening, nothing revealed',
    scenario: 'Both seats joined, no move played, Red to move.',
    reading:
      'Gives: 15 face-down discs a side (brown Red, green Black) on the home squares, the two generals, empty trays, the 30 s first-move countdown. Does not give: what any face-down piece could be; each side\u2019s hidden pool (2 chariots, 2 horses, 2 elephants, 2 advisors, 2 cannons, 5 soldiers) appears nowhere on the page.',
    seat: 'red',
    moves: [],
    widths: ['desktop', 'mobile'],
  },
  {
    id: 'b',
    title: 'Red moves a face-down piece',
    scenario:
      'Red plays h3-e3: the face-down piece on the cannon square moves as a cannon and flips.',
    reading:
      'Gives: the flipped piece\u2019s true identity on e3. The move list says only h3-e3, with no reveal mark or identity. Does not give: that one Red identity is now out of the hidden pool, or what the 14 Red face-down pieces could still be.',
    seat: 'red',
    moves: ['h3-e3'],
  },
  {
    id: 'c',
    title: 'Black reveals its own piece',
    scenario: 'Black answers h8-e8: its face-down cannon-square piece moves and flips.',
    reading:
      'Gives: Black\u2019s revealed piece on e8, visible to both seats. Does not give: any tally of revealed identities per side; the player counts face-up pieces off the board and subtracts from the starting set in their head.',
    seat: 'red',
    moves: ['h3-e3', 'h8-e8'],
  },
  {
    id: 'd',
    title: 'Red captures a face-down Black piece',
    scenario:
      'Red plays b3xb10: the face-down cannon-square piece jumps the face-down b8 screen and takes the face-down piece on b10.',
    reading:
      'Gives: the captured identity, face-up, in Red\u2019s own (bottom) tray: the capturer learns what it took. Does not give: that Black does not know what it lost, or that Black\u2019s hidden pool is now exactly known to Red minus one.',
    seat: 'red',
    moves: ['h3-e3', 'h8-e8', 'b3-b10'],
  },
  {
    id: 'e',
    title: 'Black captures a face-down Red piece',
    scenario:
      'Black plays b8xb1: its face-down cannon-square piece jumps Red’s b3 and takes the face-down piece on b1.',
    reading:
      'Gives: a brown face-down disc in the top tray (taken by the opponent): Red knows it lost a piece, not which. Does not give: the identity, or that Red\u2019s own hidden pool is now uncertain by one, which is why the old pool panel was removed.',
    seat: 'red',
    moves: ['h3-e3', 'b8-b1'],
  },
  {
    id: 'f',
    title: 'Midgame, Red’s seat',
    scenario:
      'The (e) line, then 12 policy plies (take a face-down piece if possible, else move a face-down piece, else the first legal move): reveals and captures on both sides. Red to move.',
    reading:
      'Gives: the top tray groups Red\u2019s unknown losses as one face-down disc with a count badge; the bottom tray shows Black\u2019s losses Red identified; the move list is plain coordinates with check marks only. Does not give: what Red\u2019s or Black\u2019s remaining face-down pieces could be; all the subtraction is the player\u2019s.',
    seat: 'red',
    moves: ['h3-e3', 'b8-b1', { policy: 12 }],
  },
  {
    id: 'g',
    title: 'Same midgame, Black’s seat',
    scenario:
      'The (f) position from the other chair, to show what each side knows that the other does not.',
    reading:
      'The mirror chair: Black sees every Red piece it took by identity, and its own loss that Red took face-down as a green disc. Same position, different knowledge: the page shows each seat only its own PlayerView.',
    seat: 'black',
    moves: ['h3-e3', 'b8-b1', { policy: 12 }],
  },
];

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Fail closed: the gallery creates rooms and plays both seats, which is only
// ever acceptable against a local dev pair. Any non-loopback host throws, so a
// typo or a copied prod URL can never open games on mistboard.com.
export function resolveGalleryTargets({ web, api } = {}) {
  const webUrl = new URL(web ?? 'http://localhost:3150');
  const apiUrl = api ? new URL(api) : new URL(webUrl.href);
  if (!api) apiUrl.port = String(Number(webUrl.port || 80) + 1);
  for (const url of [webUrl, apiUrl]) {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `jieqi-state-gallery: refusing ${url.origin}; it only drives a local dev pair (localhost, 127.0.0.1, ::1)`,
      );
    }
    if (url.protocol !== 'http:') {
      throw new Error(`jieqi-state-gallery: expected http:, got ${url.protocol} for ${url.origin}`);
    }
  }
  const wsUrl = new URL(apiUrl.href);
  wsUrl.protocol = 'ws:';
  wsUrl.pathname = '/';
  return { web: webUrl.origin, api: apiUrl.origin, ws: wsUrl.origin };
}

export function parseMove(text) {
  const match = /^([a-i](?:10|[1-9]))-([a-i](?:10|[1-9]))$/.exec(text);
  if (!match) throw new Error(`jieqi-state-gallery: bad move "${text}" (want e.g. h3-e3)`);
  return { from: match[1], to: match[2] };
}

// Expand a state's move list into one entry per ply: a parsed move or 'policy'.
export function expandMoves(moves) {
  const plies = [];
  for (const entry of moves) {
    if (typeof entry === 'string') plies.push(parseMove(entry));
    else if (entry && Number.isInteger(entry.policy) && entry.policy > 0) {
      for (let i = 0; i < entry.policy; i += 1) plies.push('policy');
    } else throw new Error(`jieqi-state-gallery: bad move entry ${JSON.stringify(entry)}`);
  }
  return plies;
}

// Deterministic move choice from the mover's own PlayerView: take a face-down
// enemy piece if possible (exercises capturer-only reveal), else move one of
// our own face-down pieces (a reveal), else the first legal move. Ties break
// lexicographically on from+to.
export function pickPolicyMove(view) {
  const mover = view?.status?.turn;
  const legal = [...(view?.legalMoves ?? [])].sort((a, b) =>
    `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`),
  );
  if (!mover || legal.length === 0) {
    throw new Error('jieqi-state-gallery: policy ply with no legal move for the seat to move');
  }
  const at = (square) => view.board?.[square];
  const takesHidden = legal.find((m) => at(m.to)?.faceDown === true && at(m.to)?.color !== mover);
  if (takesHidden) return { from: takesHidden.from, to: takesHidden.to };
  const reveals = legal.find((m) => at(m.from)?.faceDown === true);
  const chosen = reveals ?? legal[0];
  return { from: chosen.from, to: chosen.to };
}

// Plies played so far. moveNumber is the xiangqi FULL-move number (1 at the
// start, +1 after each Black move), so Red to move on move n means 2(n-1)
// plies; Black to move adds one.
export function pliesPlayed(view) {
  const moveNumber = view?.moveNumber ?? 1;
  return Math.max(0, (moveNumber - 1) * 2 + (view?.status?.turn === 'black' ? 1 : 0));
}

// What the seat's own PlayerView holds, counted. This is the server's side of
// the ledger; the page readout is compared against it in the gallery.
export function summarizeView(view, seat) {
  const counts = {
    red: { faceDown: 0, revealed: 0 },
    black: { faceDown: 0, revealed: 0 },
  };
  for (const piece of Object.values(view?.board ?? {})) {
    if (!piece || !counts[piece.color]) continue;
    counts[piece.color][piece.faceDown ? 'faceDown' : 'revealed'] += 1;
  }
  const lost = { red: [], black: [] };
  for (const capture of view?.captured ?? []) {
    if (lost[capture.owner]) lost[capture.owner].push(capture.role ?? '?');
  }
  return {
    seat,
    plies: pliesPlayed(view),
    turn: view?.status?.turn ?? null,
    status: view?.status?.type ?? null,
    board: counts,
    lost,
  };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// One self-contained page: screenshots are referenced as sibling files
// (written next to index.html), everything else is inline.
export function renderGalleryHtml({ entries, command, generatedAt, note }) {
  const cards = entries
    .map((entry) => {
      const shots = entry.shots
        .map(
          (shot) =>
            `<figure class="shot shot--${escapeHtml(shot.width)}"><img src="${escapeHtml(shot.file)}" alt="State ${escapeHtml(entry.id)}, ${escapeHtml(shot.width)}" loading="lazy"><figcaption>${escapeHtml(shot.width)} ${shot.viewport.width}x${shot.viewport.height}</figcaption></figure>`,
        )
        .join('');
      const facts = entry.facts.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
      return `<section class="state" id="state-${escapeHtml(entry.id)}">
  <h2><span class="tag">${escapeHtml(entry.id)}</span> ${escapeHtml(entry.title)}</h2>
  <p class="scenario">${escapeHtml(entry.scenario)} Seat: ${escapeHtml(entry.seat)}. Moves: ${escapeHtml(entry.moveText || 'none')}.</p>
  <div class="shots">${shots}</div>
  ${entry.reading ? `<p class="reading">${escapeHtml(entry.reading)}</p>` : ''}
  <ul class="facts">${facts}</ul>
</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jieqi live baseline</title>
<style>
:root { --bg: #f7f5f0; --fg: #1f1d1a; --muted: #6b665d; --card: #ffffff; --line: #e2ddd2; --tag: #8a3b12; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #151413; --fg: #ece8e1; --muted: #a39d92; --card: #1f1e1c; --line: #34312c; --tag: #f0a070; }
}
:root[data-theme="dark"] { --bg: #151413; --fg: #ece8e1; --muted: #a39d92; --card: #1f1e1c; --line: #34312c; --tag: #f0a070; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, sans-serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
.lede, .meta { color: var(--muted); margin: 0 0 12px; }
code { font: 12px/1.4 ui-monospace, monospace; background: var(--card); border: 1px solid var(--line); padding: 2px 4px; border-radius: 4px; overflow-wrap: anywhere; }
.note { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; margin: 16px 0 24px; }
.state { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 0 0 20px; }
.state h2 { font-size: 18px; margin: 0 0 6px; }
.tag { display: inline-block; min-width: 1.6em; text-align: center; color: var(--tag); font-weight: 700; }
.scenario { color: var(--muted); margin: 0 0 12px; }
.shots { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
.shot { margin: 0; flex: 1 1 640px; min-width: 0; }
.shot--mobile { flex: 0 1 260px; }
.shot img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 6px; }
.shot figcaption { color: var(--muted); font-size: 12px; }
.facts { margin: 12px 0 0; padding-left: 20px; }
.reading { margin: 12px 0 0; }
.facts { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<main>
<h1>Jieqi live game page: baseline</h1>
<p class="lede">What a seated player sees during live jieqi play, before live reveal odds. Each state is a real live room on the local dev pair, played as both seats over the normal WebSocket protocol; every screenshot is the seat's own page, so it shows only that seat's PlayerView.</p>
<p class="meta">Generated ${escapeHtml(generatedAt)}. Reproduce: <code>${escapeHtml(command)}</code></p>
<div class="note"><strong>The removed live pool (bbfad4c0, 2026-09-20).</strong> ${escapeHtml(note)}</div>
${cards}
</main>
</body>
</html>
`;
}

export const OLD_POOL_NOTE =
  'Until 2026-09-20 the jieqi room rail had a "still face-down" panel (renderHiddenPoolPanel over jieqiHiddenPool): one row per side listing the identities still face-down as this viewer knew them. The opponent’s row was exact, because the viewer was told every dark piece they took. The viewer’s own row still listed the dark pieces the opponent had taken, with an "N of these already taken, unknown which" note. It was removed because a row listing pieces that may already be gone read as a bug; the captured strips carry the same facts and the player does the subtraction. Banqi and Flip Jungle keep the panel, since a captured tile is revealed to both sides there.';
