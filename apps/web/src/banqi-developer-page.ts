import requestExample from '../../../docs/examples/banqi-provider-request.json';
import moveExample from '../../../docs/examples/banqi-provider-response.json';
import analysisExample from '../../../docs/examples/banqi-provider-response-analysis.json';
import { currentLocale, type Locale } from './i18n/locale.js';
import { prerenderCopy } from './prerender-copy.js';
import { buildNav } from './site-shell.js';
import {
  proseExternalLink,
  proseHeading,
  proseLink,
  proseParagraph,
  proseSection,
  proseSubheading,
} from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import './banqi-developer-page.css';

const REPOSITORY = 'https://github.com/brianhliou/mistboard/blob/main/';
export const BANQI_PROVIDER_EXAMPLES = {
  request: requestExample,
  move: moveExample,
  analysis: analysisExample,
};
export const BANQI_NATIVE_COMMANDS = [
  'uci',
  `setoption name NoProgressLimit value ${requestExample.rules.noProgressPlies}`,
  'isready',
  'ucinewgame',
  `position fen ${requestExample.repetition.fen}`,
  `go nodes ${requestExample.limits.nodes} movetime ${requestExample.limits.deadlineUnixMs - requestExample.limits.requestedAtUnixMs} searchmoves ${requestExample.legalMoves.join(' ')}`,
].join('\n');

function heading(text: string, id: string): HTMLElement {
  const h = proseSubheading(text);
  h.id = id;
  return h;
}
function codeBlock(text: string, label: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'banqi-reference-code';
  const bar = document.createElement('div');
  bar.className = 'banqi-reference-code-bar';
  const name = document.createElement('span');
  name.textContent = label;
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.setAttribute('aria-label', `Copy ${label}`);
  copy.addEventListener('click', () => {
    if (!navigator.clipboard) {
      copy.textContent = 'Select text manually';
      return;
    }
    void navigator.clipboard.writeText(text).then(
      () => {
        copy.textContent = 'Copied';
      },
      () => {
        copy.textContent = 'Select text manually';
      },
    );
  });
  const pre = document.createElement('pre');
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', label);
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);
  bar.append(name, copy);
  box.append(bar, pre);
  return box;
}
function exampleDetails(label: string, value: unknown): HTMLElement {
  const details = document.createElement('details');
  details.className = 'banqi-reference-example';
  const summary = document.createElement('summary');
  summary.textContent = label;
  details.append(summary, codeBlock(JSON.stringify(value, null, 2), label));
  return details;
}
function table(caption: string, headers: string[], rows: string[][]): HTMLElement {
  const region = document.createElement('div');
  region.className = 'banqi-reference-table';
  region.tabIndex = 0;
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', caption);
  const table = document.createElement('table');
  const name = document.createElement('caption');
  name.textContent = caption;
  const head = document.createElement('thead');
  const line = document.createElement('tr');
  for (const label of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    line.append(th);
  }
  head.append(line);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const [index, text] of row.entries()) {
      const td = document.createElement('td');
      td.dataset.label = headers[index];
      td.textContent = text;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(name, head, body);
  region.append(table);
  return region;
}
function sources(label: string, path: string): HTMLAnchorElement {
  return proseExternalLink(label, `${REPOSITORY}${path}`);
}

function reviewExample(): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'banqi-reference-review';
  const full = proseExternalLink('', '/developer-images/banqi-review-example.png');
  full.setAttribute('aria-label', 'Open full-size Banqi review example');
  const image = document.createElement('img');
  image.src = '/developer-images/banqi-review-example.png';
  image.width = 1001;
  image.height = 574;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.alt =
    'Banqi review with a board, evaluation graph, graded move list, accuracy and a +37% luck marker on the highlighted flip.';
  full.append(image);
  const caption = document.createElement('figcaption');
  caption.append(
    'Existing Misty review of a completed game, replayed from its stored analysis. The highlighted flip is an inaccuracy yet gets +37 points of luck. ',
    proseLink(
      'View the completed public game',
      '/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9',
    ),
    ' · ',
    proseExternalLink('Full-size image', '/developer-images/banqi-review-example.png'),
  );
  figure.append(full, caption);
  return figure;
}

export function buildBanqiDeveloperReference(): HTMLElement {
  const section = proseSection('banqi-engine-reference');
  const nav = document.createElement('nav');
  nav.className = 'banqi-reference-contents';
  nav.setAttribute('aria-label', 'On this page');
  for (const [label, id] of [
    ['Runtime & hosting', 'runtime'],
    ['Examples', 'examples'],
    ['Analysis & cost', 'analysis'],
    ['Rules', 'rules'],
    ['Game data', 'data'],
  ])
    nav.append(proseLink(label, `#${id}`));
  section.append(
    proseParagraph([proseLink('Developers', '/developers'), ' / Engine integration']),
    proseHeading('Connect a Banqi engine'),
    proseParagraph([
      'Bring an existing engine interface. We can write the adapter, construct the public positions, validate its moves and connect it to Mistboard. Publishing your engine source or model is not required. This reference explains the current transport and what we would agree before adding an engine.',
    ]),
    nav,
    heading('Choose how the engine runs', 'runtime'),
    table(
      'Two hosting arrangements',
      ['Arrangement', 'Engine author supplies', 'Mistboard supplies'],
      [
        [
          'Mistboard-operated executable',
          'A runnable build, dependencies and private model if needed; platform requirements and permitted use.',
          'Hosting, protocol adapter, search limits and game integration. Source can remain with the author.',
        ],
        [
          'Author-operated worker',
          'A hosted engine with agreed capacity and authenticated access; the executable and model stay on your host.',
          'A client adapter that sends public positions and receives validated results over HTTPS.',
        ],
      ],
    ),
    proseParagraph([
      'A container packages files and dependencies; its host can inspect those files. Browser WASM sends executable and model files to players, so it is a different choice when those files must stay private.',
    ]),
    proseParagraph([
      'Use our ',
      proseLink('contact page', '/contact'),
      ' to share your existing protocol, operating system and CPU/GPU requirements, build/model version, rules assumptions and any evaluation output. We translate the interface; you do not need to implement the JSON contract below yourself. Onboarding, capacity and permitted use are agreed with us, rather than through an upload form.',
    ]),
    heading('The public turn boundary', 'position'),
    proseParagraph([
      'Banqi has symmetric public information: both players see the same covered squares, revealed pieces and captures. A flip reveals its piece to both sides. The first flip binds the first mover to that piece’s ink; move-order seat and piece color are separate until then.',
    ]),
    proseParagraph([
      'Each turn carries a five-field masked FEN, first/second seat, bound ink, public remaining-piece counts, last move, chased square, stamped rules, legal root moves, relevant repetition history and clock/search limits. Covered squares are X. The hidden deal, shuffle seed, canonical server state and player metadata never enter the engine request.',
    ]),
    proseParagraph([
      'The quiet replay window starts at the last capture or flip and includes every quiet move since it. Our native adapter requires that complete window, with a zero no-progress clock at its root. A FEN-only quiet resume is refused. Reconnect and postgame evaluation must preserve the relevant public history without looking ahead to later reveals.',
    ]),
    heading('Native and JSON exchanges', 'examples'),
    proseParagraph([
      'The wrapper contract is ',
      requestExample.protocol,
      '. The native adapter currently speaks one Banqi UCI dialect. An engine with another tournament interface can use a custom wrapper. In this dialect, site square a1 is engine square a0; a0a0 flips it. Files are a–h, engine ranks 0–3, and FEN ranks run top first. Piece letters are G A E R H C S (lowercase for black).',
    ]),
    proseParagraph(['Adapter sends this complete opening command sequence:']),
    codeBlock(BANQI_NATIVE_COMMANDS, 'Native UCI input'),
    proseParagraph(['Illustrative engine output; an evaluation is optional:']),
    codeBlock(
      [
        'id name ExampleEngine 1.0',
        'option name NoProgressLimit type spin default 60 min 40 max 60',
        'uciok',
        'readyok',
        'info score cp 0 nodes 64 pv a0a0',
        'bestmove a0a0',
      ].join('\n'),
      'Native UCI output',
    ),
    proseParagraph([
      'For a hosted wrapper, authenticated POST /turn uses the same public input. The complete examples below are imported from the repository’s checked JSON files. Their IDs, node budget and scores are illustrative. Timestamps 0 and 1000 show a one-second budget; regenerate absolute Unix-millisecond timestamps for a real request.',
    ]),
    exampleDetails('Complete JSON request', requestExample),
    exampleDetails('Move-only JSON response', moveExample),
    exampleDetails('JSON response with an illustrative evaluation', analysisExample),
    proseParagraph([
      'Replies echo the protocol, request/game IDs and ply, and return a move from the supplied legal roots. One absolute deadline covers queueing, transport, body reads and validation. Output/body size and concurrency are bounded; stale, expired, malformed or illegal replies are rejected. Source: ',
      sources('versioned provider guide', 'docs/banqi-engine-providers.md#the-turn-contract'),
      ' · ',
      sources('checked JSON examples', 'docs/examples/banqi-provider-request.json'),
      '.',
    ]),
    heading('Analysis uses an evaluator, not a new grading system', 'analysis'),
    proseParagraph([
      'Mistboard already implements move classification, accuracy, evaluation graphs and Banqi’s decision-versus-luck calculation. A new engine supplies position evaluations; we connect those evaluations to the existing review features. The current default evaluator is MistyBanqi. A new engine is not automatically a postgame analysis backend when its live moves work.',
    ]),
    reviewExample(),
    table(
      'What analysis integration needs',
      ['Engine author supplies', 'Mistboard supplies'],
      [
        [
          'An evaluation operation for supplied positions and relevant history, including positions the engine did not play.',
          'Whole-game replay, ordinary-move grading, accuracy, graphs, result storage and evaluator wiring.',
        ],
        [
          'Score units and viewpoint, build/model identity, rules assumptions and search controls.',
          'Validated score mapping, engine-specific cache identity, hypothetical reveal queries and probability weighting.',
        ],
        [
          'Available analysis capacity, latency and any search limits.',
          'Job and per-position limits, bounded fan-out, scheduling and cached reads that do no new engine work.',
        ],
      ],
    ),
    proseParagraph([
      'Optional scores support cp, signed mate, win probability or W/D/L, with an explicit side-to-move viewpoint. Probability values lie in [0, 1]; W/D/L sums to 1. We do not invent centipawns from them. Win probability and expected match score (win + draw / 2) are different quantities, so the score meaning and conversion must be agreed and tested before grading.',
    ]),
    proseParagraph([
      'Basic review evaluates recorded positions. Luck grading asks the same evaluator about additional hypothetical public reveal outcomes and legal alternatives, then weights those outcomes. It needs extra searches; a score recorded for the move played cannot value an unplayed reveal. No separate engine-side “luck” command is required. A move-only provider may offer play without analysis.',
    ]),
    proseParagraph([
      'Agree on a separate analysis budget before enabling it: cap whole-game jobs and their internal search fan-out, preserve live-playing capacity, and reuse cached results. Our existing sweep and decision calculation accept injected evaluators, but provider wiring, score mapping, cache identity, grade validation and cost checks remain work for each new evaluator. A game may instead use Misty’s separately labeled analysis. See the ',
      sources(
        'evaluation handoff',
        'docs/banqi-engine-providers.md#connecting-an-engine-to-postgame-grading',
      ),
      '.',
    ]),
    heading('Match the stamped Banqi rules', 'rules'),
    table(
      'Current live rules and historical compatibility',
      ['Rule', 'Mistboard behavior'],
      [
        [
          'No progress',
          'New games draw after 60 plies without a capture or flip. Either event resets the clock. Older stamped games can use 40.',
        ],
        [
          'Repetition',
          'Ordinary third occurrence of the same position and side to move is a draw. Public repetition counts and the quiet window accompany the request.',
        ],
        [
          'Perpetual chase',
          'A chase is a quiet move after which the moved piece can capture the enemy piece moved on the preceding ply, protected or not. A chase that would create the third occurrence is forbidden unless it is the side’s only legal move. A chase or flee does not itself cause a repetition draw; mutual chase is treated as ordinary play.',
        ],
        [
          'History',
          'Older stamped games may have chase enforcement off. Evaluate the rules recorded with that game, rather than assuming current defaults.',
        ],
      ],
    ),
    proseParagraph([
      'Root filtering prevents an illegal chase move from being accepted. It cannot repair an engine’s internal search assumptions or learned draw targets. If a tournament uses repetition-as-draw for all chases, discuss that difference before integration. Sending a clock limit and legal roots is not proof of internal rules compatibility.',
    ]),
    proseParagraph([
      proseLink('Public Banqi rules', '/rules/banqi'),
      ' · ',
      sources('rules kernel', 'packages/game/src/variants-banqi.ts'),
      ' · ',
      sources('protocol and validation', 'apps/server/src/banqi-provider-protocol.ts'),
    ]),
    heading('Public games for research', 'data'),
    proseParagraph([
      'Published completed public games are available as monthly JSONL and PGN downloads, with variant and public-bot filters. The download page states the CC BY 4.0 license and current publication policy. These archives are separate from the live masked engine boundary.',
    ]),
    proseParagraph([
      proseLink('Banqi game downloads', '/data?variant=banqi'),
      ' · ',
      proseLink('Formats and publication policy', '/data/about'),
      ' · ',
      proseLink('Public read API', '/api-docs'),
      ' · ',
      sources('game export implementation', 'apps/server/src/game-export-tenant.ts'),
    ]),
    heading('Start with the interface you already have', 'next'),
    proseParagraph([
      'Share a short protocol description, a build or hosting arrangement, runtime needs and rule assumptions. We can agree a small test exchange, write the adapter and validate a complete game before discussing wider availability or benchmarking.',
    ]),
    proseParagraph([
      proseLink('Contact Mistboard', '/contact'),
      ' · ',
      sources('Read the versioned repository guide', 'docs/banqi-engine-providers.md'),
    ]),
  );
  return section;
}

export function mountBanqiDeveloperReference(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'banqi-developer-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('developers', buildBanqiDeveloperReference(), locale),
  );
  // The module mounts asynchronously after navigation, so repeat native fragment positioning.
  if (window.location.hash)
    requestAnimationFrame(() =>
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView(),
    );
}
export function renderBanqiDeveloperShellForPrerender(locale: Locale): string {
  const root = document.createElement('div');
  root.className = 'landing-page banqi-developer-route';
  root.append(
    buildNav(locale),
    buildStaticPageLayout('developers', buildBanqiDeveloperReference(), locale),
  );
  return prerenderCopy(root);
}
