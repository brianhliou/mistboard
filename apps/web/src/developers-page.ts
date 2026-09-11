// /developers: how to put a Mistboard board in someone else's page.
//
// Five things are frameable, and the page documents each with a snippet a
// reader can paste unchanged: a study chapter, a finished game, Mistboard TV,
// a puzzle, and the analysis board. Every path and size is imported from
// @mistboard/game rather than retyped, so the snippet a developer copies and
// the limits the prose states cannot drift from what the server actually does.
//
// The live example at the top is the same widget the champions article uses. It
// is here so the page proves the claim instead of describing it, and so a broken
// embed is visible on the page whose whole job is to say the embed works.

import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_DEFAULT_WIDTH,
  EMBED_MAX_WIDTH,
  EMBED_MIN_WIDTH,
  embedAnalysisPath,
  embedGamePath,
  embedHeightForWidth,
  embedPuzzlePath,
  embedStudyPath,
  embedTvPath,
  OEMBED_ENDPOINT,
} from '@mistboard/game';
import { currentLocale, type Locale } from './i18n/locale.js';
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

// The chapter shown in the live example and in every snippet on the page. A
// real, public chapter on purpose: a reader can paste the snippet unchanged and
// watch it work before adapting it.
const EXAMPLE_STUDY = 'ytSzepET';
const EXAMPLE_CHAPTER = 'Ue0EgpS7';
// A finished public game for the game snippet: a real room id from the
// homepage showcase pool, so the snippet pastes and plays.
const EXAMPLE_GAME = 'xq_a30faae1-a4be-4d58-9cb8-da0659b2c439';
// The /watch channels a TV embed can pin. Mirrors the server's channel list
// (watch-channels.ts); the page states them so a reader need not discover them.
const TV_CHANNELS = [
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
  'engines',
] as const;

export function siteOrigin(): string {
  return typeof window === 'undefined' ? 'https://mistboard.com' : window.location.origin;
}

type StudyIds = { studyId: string; chapterId: string };
const EXAMPLE_STUDY_IDS: StudyIds = { studyId: EXAMPLE_STUDY, chapterId: EXAMPLE_CHAPTER };

export function exampleEmbedUrl(origin = siteOrigin(), ids: StudyIds = EXAMPLE_STUDY_IDS): string {
  return `${origin}${embedStudyPath(ids.studyId, ids.chapterId)}`;
}

export function exampleStudyUrl(origin = siteOrigin(), ids: StudyIds = EXAMPLE_STUDY_IDS): string {
  return `${origin}/study/${ids.studyId}/${ids.chapterId}`;
}

/** The snippet the page tells people to copy. Exported so a test can parse it. */
export function embedSnippet(origin = siteOrigin(), ids: StudyIds = EXAMPLE_STUDY_IDS): string {
  return [
    `<iframe src="${exampleEmbedUrl(origin, ids)}"`,
    `        width="${EMBED_DEFAULT_WIDTH}" height="${EMBED_DEFAULT_HEIGHT}"`,
    '        frameborder="0" loading="lazy"',
    '        style="max-width:100%;border:0"',
    '        title="Every Xiangqi Champion"></iframe>',
  ].join('\n');
}

/** One iframe snippet per embed kind. Exported so a test can parse each src. */
export function frameSnippet(
  src: string,
  size: { width: number | string; height?: number; aspect?: string },
  title: string,
): string {
  const sizing =
    typeof size.width === 'number' && size.height
      ? `        width="${size.width}" height="${size.height}"\n        style="max-width:100%;border:0"`
      : `        style="width:${size.width};aspect-ratio:${size.aspect ?? '3/2'};border:0"`;
  return [
    `<iframe src="${src}"`,
    sizing,
    '        frameborder="0" loading="lazy"',
    `        title="${title}"></iframe>`,
  ].join('\n');
}

export function gameSnippet(origin = siteOrigin(), roomId = EXAMPLE_GAME): string {
  return frameSnippet(
    `${origin}${embedGamePath(roomId)}`,
    { width: EMBED_DEFAULT_WIDTH, height: EMBED_DEFAULT_HEIGHT },
    'A xiangqi game on Mistboard',
  );
}

export function tvSnippet(origin = siteOrigin(), channel: string | undefined = 'xiangqi'): string {
  return frameSnippet(
    `${origin}${embedTvPath(channel)}`,
    { width: 400, height: 440 },
    'Mistboard TV',
  );
}

export function puzzleSnippet(origin = siteOrigin()): string {
  return frameSnippet(
    `${origin}${embedPuzzlePath()}`,
    { width: EMBED_DEFAULT_WIDTH, height: 520 },
    'Daily xiangqi puzzle',
  );
}

export function analysisSnippet(origin = siteOrigin()): string {
  return frameSnippet(
    `${origin}${embedAnalysisPath()}`,
    { width: '100%', aspect: '4/3' },
    'Xiangqi analysis board',
  );
}

export function oembedRequestUrl(origin = siteOrigin(), ids: StudyIds = EXAMPLE_STUDY_IDS): string {
  return `${origin}${OEMBED_ENDPOINT}?url=${encodeURIComponent(exampleStudyUrl(origin, ids))}`;
}

function codeBlock(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'developers-code';

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'developers-copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    // Clipboard access can be denied, and a button that silently does nothing is
    // worse than one that says so.
    navigator.clipboard?.writeText(text).then(
      () => {
        copy.textContent = 'Copied';
        window.setTimeout(() => {
          copy.textContent = 'Copy';
        }, 1600);
      },
      () => {
        copy.textContent = 'Press ctrl+C';
      },
    );
  });

  wrap.append(pre, copy);
  return wrap;
}

/** A real iframe on the page, at the size the snippet beside it documents. The
 *  page proves each claim instead of describing it, so a broken embed is
 *  visible on the page whose whole job is to say the embed works. */
function liveFrame(
  src: string,
  size: { width: number; height: number },
  title: string,
  caption = 'This is an iframe, running the snippet below.',
): { figure: HTMLElement; frame: HTMLIFrameElement } {
  const figure = document.createElement('figure');
  figure.className = 'developers-example';

  const frame = document.createElement('iframe');
  frame.src = src;
  frame.width = String(size.width);
  frame.height = String(size.height);
  frame.style.maxWidth = `${size.width}px`;
  frame.style.aspectRatio = `${size.width} / ${size.height}`;
  frame.loading = 'lazy';
  frame.title = title;
  frame.setAttribute('frameborder', '0');
  figure.append(frame);

  const figcaption = document.createElement('figcaption');
  figcaption.textContent = caption;
  figure.append(figcaption);

  return { figure, frame };
}

// Same idea for the study example: the constant is a prod study, and a dev
// pair (or a fresh database) does not have it. When the study API says so,
// borrow the first public study's first chapter and re-point the frame and
// every snippet that names the ids.
async function pointStudyExampleAtLocalStudy(
  origin: string,
  figure: HTMLElement,
  blocks: { snippet: HTMLElement; theme: HTMLElement; notation: HTMLElement; oembed: HTMLElement },
): Promise<void> {
  try {
    const headers = { accept: 'application/json' };
    const probe = await fetch(`/api/studies/${EXAMPLE_STUDY}`, { headers });
    if (probe.ok) return;
    const list = await fetch('/api/studies/public?limit=10', { headers });
    if (!list.ok) return;
    const { studies } = (await list.json()) as { studies?: Array<{ id?: string }> };
    for (const study of studies ?? []) {
      if (!study.id) continue;
      const detail = await fetch(`/api/studies/${encodeURIComponent(study.id)}`, { headers });
      if (!detail.ok) continue;
      const { chapters } = (await detail.json()) as {
        chapters?: Array<{ id?: string; root?: { root?: { children?: unknown[] } } }>;
      };
      // A chapter with no moves would prove nothing; take the first that has some.
      const chapter = chapters?.find((c) => c.id && (c.root?.root?.children?.length ?? 0) > 0);
      if (!chapter?.id) continue;
      const ids = { studyId: study.id, chapterId: chapter.id };
      // A NEW frame rather than a src swap: changing src on an iframe whose first
      // document is still loading sometimes leaves the old document in place.
      figure.replaceWith(
        liveFrame(
          embedStudyPath(ids.studyId, ids.chapterId),
          { width: EMBED_DEFAULT_WIDTH, height: EMBED_DEFAULT_HEIGHT },
          'A study chapter',
        ).figure,
      );
      blocks.snippet.replaceWith(codeBlock(embedSnippet(origin, ids)));
      blocks.theme.replaceWith(codeBlock(`${exampleEmbedUrl(origin, ids)}?theme=light`));
      blocks.notation.replaceWith(
        codeBlock(`${exampleEmbedUrl(origin, ids)}?theme=light&notation=wxf`),
      );
      blocks.oembed.replaceWith(codeBlock(oembedRequestUrl(origin, ids)));
      return;
    }
  } catch {
    // The constant stays; it is a real study on production.
  }
}

// The game example follows THIS deployment: the constant id is a prod game, so
// on a dev pair (or after that game is ever purged) the frame would say "not
// available" on the page that claims games embed. Ask the showcase pool for a
// finished game and point both the frame and the snippet at it; the constant
// is the fallback when the pool cannot answer.
async function pointGameExampleAtLocalGame(
  origin: string,
  figure: HTMLElement,
  block: HTMLElement,
): Promise<void> {
  try {
    const response = await fetch('/api/games/showcase', {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return;
    const { games } = (await response.json()) as {
      games?: Array<{ roomId?: string; variant?: string }>;
    };
    // Xiangqi first: it is the flagship and the game the page's prose describes.
    const roomId = (games?.find((g) => g.variant === 'xiangqi') ?? games?.[0])?.roomId;
    if (!roomId || roomId === EXAMPLE_GAME) return;
    figure.replaceWith(
      liveFrame(
        embedGamePath(roomId),
        { width: EMBED_DEFAULT_WIDTH, height: EMBED_DEFAULT_HEIGHT },
        'A finished game on Mistboard',
      ).figure,
    );
    block.replaceWith(codeBlock(gameSnippet(origin, roomId)));
  } catch {
    // The constant stays; it is a real game on production.
  }
}

function sizingTable(): HTMLElement {
  const rows: Array<[string, string]> = [
    ['Default', `${EMBED_DEFAULT_WIDTH} x ${EMBED_DEFAULT_HEIGHT}`],
    ['Narrowest', `${EMBED_MIN_WIDTH} x ${embedHeightForWidth(EMBED_MIN_WIDTH)}`],
    ['Widest', `${EMBED_MAX_WIDTH} x ${embedHeightForWidth(EMBED_MAX_WIDTH)}`],
  ];

  const table = document.createElement('table');
  table.className = 'developers-table';
  const body = document.createElement('tbody');
  for (const [label, value] of rows) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(th, td);
    body.append(tr);
  }
  table.append(body);
  return table;
}

function buildDevelopers(_locale: Locale = currentLocale()): HTMLElement {
  const section = proseSection('developers-section');
  const origin = siteOrigin();
  const gameExample = liveFrame(
    embedGamePath(EXAMPLE_GAME),
    { width: EMBED_DEFAULT_WIDTH, height: EMBED_DEFAULT_HEIGHT },
    'A finished game on Mistboard',
  );
  const gameBlock = codeBlock(gameSnippet(origin));
  void pointGameExampleAtLocalGame(origin, gameExample.figure, gameBlock);
  const studyExample = liveFrame(
    embedStudyPath(EXAMPLE_STUDY, EXAMPLE_CHAPTER),
    { width: EMBED_DEFAULT_WIDTH, height: EMBED_DEFAULT_HEIGHT },
    'Every Xiangqi Champion, chapter one',
  );
  const studyBlocks = {
    snippet: codeBlock(embedSnippet(origin)),
    theme: codeBlock(`${exampleEmbedUrl(origin)}?theme=light`),
    notation: codeBlock(`${exampleEmbedUrl(origin)}?theme=light&notation=wxf`),
    oembed: codeBlock(oembedRequestUrl(origin)),
  };
  void pointStudyExampleAtLocalStudy(origin, studyExample.figure, studyBlocks);

  section.append(
    proseHeading('Developers'),
    proseParagraph([
      'Five things on Mistboard can run inside your page, with nothing to install and ' +
        'no API key: a study chapter, a finished game, Mistboard TV, a puzzle, and the ' +
        'analysis board. Each is an iframe. The page inside the frame carries no ' +
        'navigation, no footer, and no sign-in state; it renders the board and nothing ' +
        'else. The study widget is the same one the articles on this site use.',
    ]),

    studyExample.figure,

    proseSubheading('Embed a study chapter'),
    proseParagraph([
      'Copy this. Swap the two ids for the study and chapter you want, which are the ' +
        'last two segments of the study URL you are reading. The board, the moves, the ' +
        'engine annotations and the branches all come along.',
    ]),
    studyBlocks.snippet,

    proseSubheading('Embed a game'),
    proseParagraph([
      'Any finished game, by its id, which is the last segment of its review URL. The ' +
        'frame shows the final position with the move list beside it; the reader steps ' +
        'through with the buttons, the arrow keys, or by clicking a move. Every variant ' +
        'the site can replay works here, fog games included: a finished fog game is ' +
        'shown from the truth board, exactly as on the review page.',
    ]),
    gameExample.figure,
    gameBlock,
    proseParagraph([
      'Add ply=N to open on a particular move instead of the end. A game still in ' +
        'progress is not available to the frame until it finishes.',
    ]),

    proseSubheading('Embed Mistboard TV'),
    proseParagraph([
      'The live board: it follows the featured game in progress and, when there is ' +
        'none, holds the most recently finished one. A game that ends while the reader ' +
        'is watching plays out once and then freezes. Nothing that finished before they ' +
        'arrived ever auto-plays.',
    ]),
    liveFrame(embedTvPath('xiangqi'), { width: 400, height: 440 }, 'Mistboard TV').figure,
    codeBlock(tvSnippet(origin)),
    proseParagraph([
      'The snippet follows the xiangqi channel. Set channel= to any of ' +
        `${TV_CHANNELS.join(', ')}, or drop it for the cross-variant pick the homepage shows:`,
    ]),
    codeBlock(`${origin}${embedTvPath()}`),

    proseSubheading('Embed the daily puzzle'),
    proseParagraph([
      "Today's puzzle, solvable in place: the reader plays the moves on the board, with " +
        'hints and the solution one click away. Attempts from a frame are never rated. ' +
        'Put a puzzle id after the path to pin one puzzle instead of the daily rotation.',
    ]),
    liveFrame(embedPuzzlePath(), { width: EMBED_DEFAULT_WIDTH, height: 520 }, 'Daily puzzle')
      .figure,
    codeBlock(puzzleSnippet(origin)),

    proseSubheading('Embed the analysis board'),
    proseParagraph([
      'The free xiangqi analysis board: play moves, branch, paste a game or a position. ' +
        'Add fen= to open on a position (underscores may stand in for spaces) and ' +
        'color=black to seat Black at the bottom.',
    ]),
    liveFrame(embedAnalysisPath(), { width: EMBED_DEFAULT_WIDTH, height: 570 }, 'Analysis board')
      .figure,
    codeBlock(analysisSnippet(origin)),
    codeBlock(`${origin}${embedAnalysisPath()}?color=black&fen=4kaR2/4a4/9/9/9/9/9/9/4A4/3AK4_w`),
    proseParagraph([
      'One thing the framed board does not have is the engine. The local evaluation ' +
        'runs on WASM threads, which need cross-origin isolation, and a frame is ' +
        'isolated only when the page framing it is too. The engine toggle inside the ' +
        'frame says so rather than half-working. For engine analysis, link to the ' +
        'analysis board itself.',
    ]),

    proseSubheading('Sizing'),
    proseParagraph([
      `Give the frame whatever width suits your layout. ${EMBED_MIN_WIDTH}px is the ` +
        'narrowest the board and the move list can share, and anything wider than ' +
        `${EMBED_MAX_WIDTH}px stops being a board on a page and starts being the page. ` +
        'The study and game frames keep the height proportional:',
    ]),
    sizingTable(),
    proseParagraph([
      'The style attribute in the snippet (max-width:100%) is what makes it behave on ' +
        'a phone, so keep it if your layout is fluid. Below about 480px the game frame ' +
        'stacks the move list under the board, so a narrow frame wants to be taller. ' +
        'The TV frame is one board and sits well at 400 by 440; the analysis board ' +
        'wants the width of a column and a 4:3 box.',
    ]),

    proseSubheading('Background'),
    proseParagraph([
      'The frame is transparent. Whatever your page has behind the iframe shows ' +
        'through around the board, so the embed sits on your surface rather than ' +
        'stamping a coloured card onto it. The board and move list sit in one panel ' +
        'of their own, so they stay legible either way.',
    ]),

    proseSubheading('Theme'),
    proseParagraph([
      'By default the embed follows the READER: it renders light or dark to match ' +
        'their system setting, the same as the rest of Mistboard. That is right for a ' +
        'site that also has both themes, and wrong for one that does not, because a ' +
        'light-only page ends up showing a dark board to every dark-mode visitor.',
    ]),
    proseParagraph([
      'Add theme=light or theme=dark to pin it, on any of the frames. Nothing on your ' +
        'side can do this for you: prefers-color-scheme inside the frame is the ' +
        'browser\u2019s, not your page\u2019s, and a color-scheme property on the iframe ' +
        'element does not reach the document inside it.',
    ]),
    studyBlocks.theme,

    proseSubheading('Notation'),
    proseParagraph([
      'Move labels follow the reader the same way, and run into the same problem: a ' +
        'reader meeting Mistboard for the first time inside your page has no stored ' +
        'preference, so they get the default, which is coordinates. That suits a ' +
        'general visitor and not an article about technique, where the source ' +
        'material is written in WXF or Chinese and a5-a9 is the one form no manual ' +
        'uses.',
    ]),
    proseParagraph([
      'Add notation=wxf, notation=chinese, notation=iccs or notation=coordinate to ' +
        'pin it for your readers. It applies to that frame alone and never writes to ' +
        "their settings, so a reader's own choice on Mistboard is untouched.",
    ]),
    studyBlocks.notation,

    proseSubheading('oEmbed'),
    proseParagraph([
      'If your platform speaks oEmbed, you do not need any of the above: paste a study ' +
        'or game link into WordPress, Ghost, Discourse or anything else that consumes ' +
        'the standard, and it will resolve the embed on its own. The provider endpoint is:',
    ]),
    codeBlock(`GET ${OEMBED_ENDPOINT}?url=<study, game or embed URL>&maxwidth=<optional>`),
    proseParagraph([
      'It accepts the permalink a reader copies (a study chapter, or a game\u2019s ' +
        'review page) as well as the embed path itself, returns a rich type with an ' +
        'html field, and answers only for studies the public can already read and games ' +
        'that have finished. A maxwidth outside the range above is clamped rather than ' +
        'refused. Try it:',
    ]),
    studyBlocks.oembed,

    proseSubheading('What you can embed'),
    proseParagraph([
      'Only what the anonymous public already sees. A private study is a 404 in the ' +
        'frame exactly as it is everywhere else; a game is available once it has ' +
        'finished and never before, so a fog game cannot be framed mid-play; TV shows ' +
        'only games the server already broadcasts. The embed pages are the only ones ' +
        'another site may frame: everything else on Mistboard sends ' +
        'frame-ancestors self.',
    ]),
    proseParagraph([
      'Embeds are free and need no key. The frame does not run our analytics and ' +
        'never asks who the viewer is, so it issues no credentialed request from ' +
        'your page. It does keep board appearance (piece set, notation) in the ' +
        "viewer's own browser storage, which is why their preferences follow them " +
        'between embeds. If you are planning something at unusual scale, ',
      proseLink('get in touch', '/contact'),
      ' first.',
    ]),

    proseSubheading('HTTP API'),
    proseParagraph([
      'The read endpoints behind these pages are public and documented: games, watch ' +
        'feeds, puzzles, studies, the leaderboard, the opening explorer. See the ',
      proseLink('API reference', '/api-docs'),
      '. It is version 0 and may change; the reference says what is stable.',
    ]),

    proseSubheading('Everything else'),
    proseParagraph([
      'Mistboard is AGPL-3.0 and the whole site is on ',
      proseExternalLink('GitHub', 'https://github.com/brianhliou/mistboard'),
      '. If you need something neither the embeds nor the API offer, the ',
      proseLink('contact page', '/contact'),
      ' is the place to say what for, which is how this page came to exist.',
    ]),
  );

  return section;
}

export function mountDevelopers(root: HTMLElement): void {
  const locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'developers-route');
  root.append(
    buildNav(locale),
    buildStaticPageLayout('developers', buildDevelopers(locale), locale),
  );
}
