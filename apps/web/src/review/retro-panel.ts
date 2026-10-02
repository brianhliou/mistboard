// The "Learn from your mistakes" box (lichess retroView): a title strip with the
// n / N counter and a close button, then one feedback card per state. Pure
// rendering over a RetroController; the host re-calls update() whenever the
// retro state or the position changes.
import './retro.css';
import { t } from '../i18n/catalog.js';
import { seatDiscEl } from '../seat-disc.js';
import type { RetroController, RetroSide } from './retro.js';
import type { ReviewInk } from './review-seat-colors.js';

export interface RetroPanelOptions<Node> {
  /** "21… h8-e8" for the fault / solution move. */
  labelFor(node: Node): string;
  onClose(): void;
  /** Review the OTHER side's mistakes: the host rebuilds the controller. */
  onFlip(): void;
  /**
   * The ink this side's disc paints. `ctrl.side` is a move-order SLOT named
   * 'red'/'black', so using it directly gave a chess player a red disc; the host
   * resolves the real ink through reviewColorForSeat and passes it here.
   *
   * The surrounding PROSE is still slot-keyed ("...for Red"), because those are
   * whole translated sentences with the colour baked into the key rather than
   * interpolated. Fixing that is a catalog change across every locale.
   */
  discInk?: ReviewInk;
}

export interface RetroPanel {
  el: HTMLElement;
  update(): void;
}

export function createRetroPanel<Node>(
  ctrl: RetroController<Node>,
  opts: RetroPanelOptions<Node>,
): RetroPanel {
  const el = document.createElement('section');
  el.className = 'retro-box';
  el.setAttribute('aria-label', t('review.retroTitle'));

  const title = document.createElement('div');
  title.className = 'retro-box__title';
  const titleText = document.createElement('span');
  titleText.textContent = t('review.retroTitle');
  const counter = document.createElement('span');
  counter.className = 'retro-box__counter';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'retro-box__close';
  close.setAttribute('aria-label', t('review.retroClose'));
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', opts.onClose);
  title.append(titleText, counter, close);

  const body = document.createElement('div');
  body.className = 'retro-box__feedback';
  body.setAttribute('aria-live', 'polite');
  el.append(title, body);

  const sideKey = (red: string, black: string): string => (ctrl.side === 'red' ? red : black);

  function link(label: string, onClick: () => void, className = 'retro-box__choice'): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function choices(...items: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'retro-box__choices';
    row.append(...items);
    return row;
  }

  function skipOrView(): HTMLElement {
    return choices(
      link(t('review.retroViewSolution'), () => ctrl.viewSolution()),
      link(t('review.retroSkip'), () => ctrl.skip()),
    );
  }

  function card(icon: HTMLElement | null, ...lines: HTMLElement[]): HTMLElement {
    const player = document.createElement('div');
    player.className = 'retro-box__player';
    if (icon) player.append(icon);
    const instruction = document.createElement('div');
    instruction.className = 'retro-box__instruction';
    instruction.append(...lines);
    player.append(instruction);
    return player;
  }

  function sideDisc(): HTMLElement {
    return seatDiscEl(opts.discInk ?? ctrl.side, 'retro-box__disc');
  }

  function mark(text: string, tone: 'win' | 'fail' | 'off'): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `retro-box__icon retro-box__icon--${tone}`;
    icon.textContent = text;
    return icon;
  }

  function strong(text: string): HTMLElement {
    const node = document.createElement('strong');
    node.textContent = text;
    return node;
  }

  function em(text: string): HTMLElement {
    const node = document.createElement('em');
    node.textContent = text;
    return node;
  }

  function nextButton(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'retro-box__continue';
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    const label = document.createElement('span');
    label.textContent = t('review.retroNext');
    button.append(label);
    button.addEventListener('click', () => ctrl.jumpToNext());
    return button;
  }

  function renderEnd(): HTMLElement[] {
    const [, total] = ctrl.completion();
    const nothing = total === 0;
    const message = nothing
      ? sideKey(t('review.retroNoneRed'), t('review.retroNoneBlack'))
      : sideKey(t('review.retroDoneRed'), t('review.retroDoneBlack'));
    const links: HTMLElement[] = [];
    if (!nothing) links.push(link(t('review.retroDoItAgain'), () => ctrl.reset()));
    links.push(
      link(sideKey(t('review.retroReviewBlack'), t('review.retroReviewRed')), () => opts.onFlip()),
    );
    return [card(sideDisc(), em(message), choices(...links))];
  }

  function render(): HTMLElement[] {
    const current = ctrl.current();
    const fb = ctrl.feedback();
    if (!current) return renderEnd();
    switch (fb) {
      case 'find':
        return [
          card(
            sideDisc(),
            strong(t('review.retroWasPlayed', { move: opts.labelFor(current.fault.node) })),
            em(sideKey(t('review.retroFindBetterRed'), t('review.retroFindBetterBlack'))),
            skipOrView(),
          ),
        ];
      case 'offTrack':
        return [
          card(
            mark('!', 'off'),
            strong(t('review.retroBrowsedAway')),
            choices(link(t('review.retroResume'), () => ctrl.jumpToNext())),
          ),
        ];
      case 'fail':
        return [
          card(
            mark('✗', 'fail'),
            strong(t('review.retroYouCanDoBetter')),
            em(sideKey(t('review.retroTryAnotherRed'), t('review.retroTryAnotherBlack'))),
            skipOrView(),
          ),
        ];
      case 'win':
        return [card(mark('✓', 'win'), strong(t('review.retroGoodMove'))), nextButton()];
      case 'view':
        return [
          card(
            mark('✓', 'win'),
            strong(t('review.retroSolution')),
            em(t('review.retroBestWas', { move: opts.labelFor(current.solution.node) })),
          ),
          nextButton(),
        ];
      case 'eval': {
        // No local engine (Safari): the grader can never answer, so say so and
        // leave the two ways out on screen instead of a spinner forever.
        if (ctrl.engineUnavailable()) {
          return [card(mark('!', 'off'), strong(t('review.retroEngineUnavailable')), skipOrView())];
        }
        const progress = document.createElement('div');
        progress.className = 'retro-box__progress';
        return [card(null, strong(t('review.retroEvaluating')), progress)];
      }
    }
  }

  function update(): void {
    const [solved, total] = ctrl.completion();
    counter.textContent = `${Math.min(solved + 1, total)} / ${total}`;
    const fb = ctrl.current() ? ctrl.feedback() : 'end';
    body.className = `retro-box__feedback retro-box__feedback--${fb}`;
    body.replaceChildren(...render());
  }

  update();
  return { el, update };
}

export type { RetroSide };
