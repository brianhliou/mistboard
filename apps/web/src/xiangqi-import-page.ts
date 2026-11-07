// /import — paste a xiangqi game and land on the analysis board with it.
//
// The analysis board has carried an import box for a long time, but only as an
// under-board panel you had to already be on the board to find. This is the
// named door, the way lichess.org/paste is a door to its analysis board.
//
// It deliberately mints nothing. The game lives in the resulting ?moves= URL,
// not in a row: no account, no wait, and nothing published. That is a real
// divergence from lichess (which creates a public game) and the right default
// while we have no story for moderating or rate-limiting anonymous writes.
import './xiangqi-import-page.css';
import { t } from './i18n/catalog.js';
import { importXiangqiPaste } from './review/xiangqi-import.js';
import { buildNav } from './site-shell.js';

/** Biggest paste we will try to parse. Matches the study chapter dialog's cap;
 *  past this the sniffer's legality replay is the wrong tool anyway. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024;

const ANALYSIS_PATH = '/analysis/xiangqi';

/** Where a successful import should send the reader. Exported for the test:
 *  the URL is the whole product of this page, so it is what to assert on. */
export function xiangqiImportTargetUrl(input: string): { url: string } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { error: t('review.import.empty') };
  if (trimmed.length > MAX_INPUT_BYTES) return { error: t('review.import.tooLarge') };

  const result = importXiangqiPaste(trimmed);
  if (result.error || result.moves.length === 0) {
    return { error: result.error ?? t('review.import.noMovesRecognized') };
  }

  const params = new URLSearchParams();
  // A [FEN] start has to travel with the moves, or they replay from the
  // standard opening and quietly describe a different game.
  if (result.startFen) params.set('fen', result.startFen);
  params.set('moves', result.moves.map((move) => `${move.from}-${move.to}`).join(' '));
  return { url: `${ANALYSIS_PATH}?${params.toString()}` };
}

export function mountXiangqiImport(root: HTMLElement): void {
  root.classList.add('landing-page', 'xiangqi-import-page');
  root.replaceChildren(buildNav());

  const shell = document.createElement('main');
  shell.className = 'site-section xiangqi-import-shell';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('review.import.heading');

  const lede = document.createElement('p');
  lede.className = 'xiangqi-import-lede';
  lede.textContent = t('review.import.lede');

  const form = document.createElement('form');
  form.className = 'xiangqi-import-form';

  const label = document.createElement('label');
  label.className = 'xiangqi-import-label';
  label.textContent = t('review.import.game');
  const textarea = document.createElement('textarea');
  textarea.className = 'xiangqi-import-textarea';
  textarea.id = 'xiangqi-import-input';
  textarea.spellcheck = false;
  textarea.placeholder = t('review.import.placeholder');
  label.htmlFor = textarea.id;

  const error = document.createElement('p');
  error.className = 'xiangqi-import-error';
  error.setAttribute('role', 'alert');

  const actions = document.createElement('div');
  actions.className = 'xiangqi-import-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'site-button site-button-primary';
  submit.textContent = t('review.import.submit');
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.pgn,.txt';
  file.setAttribute('aria-label', t('review.import.file'));
  actions.append(submit, file);

  form.append(label, textarea, actions, error);

  const formats = document.createElement('p');
  formats.className = 'xiangqi-import-formats';
  // Keep notation examples as code while allowing each locale to order the sentence.
  const examples: Record<string, string> = {
    '{wxf}': 'C2.5',
    '{chinese}': '炮二平五',
    '{coordinate}': 'h3e3',
  };
  for (const part of t('review.import.formats').split(/(\{wxf\}|\{chinese\}|\{coordinate\})/)) {
    formats.append(examples[part] ? code(examples[part]) : document.createTextNode(part));
  }

  shell.append(heading, lede, form, formats);
  root.append(shell);

  const go = (text: string): void => {
    const outcome = xiangqiImportTargetUrl(text);
    if ('error' in outcome) {
      error.textContent = outcome.error;
      return;
    }
    error.textContent = '';
    window.location.assign(outcome.url);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    go(textarea.value);
  });

  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    if (!picked) return;
    if (picked.size > MAX_INPUT_BYTES) {
      error.textContent = t('review.import.tooLarge');
      return;
    }
    picked
      .text()
      .then((text) => {
        // Show what was read before navigating, so a file that fails to parse
        // leaves the reader looking at the thing that failed.
        textarea.value = text;
        go(text);
      })
      .catch(() => {
        error.textContent = t('review.import.readFailed');
      });
  });
}

function code(text: string): HTMLElement {
  const el = document.createElement('code');
  el.textContent = text;
  return el;
}
