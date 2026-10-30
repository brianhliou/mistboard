// Phone game review (600px and under, #619): an "Engine analysis" toggle row
// in the bar's ☰ menu, and the engine bar above the board while it runs.
//
// The row switches the review's engine panel through the panel's own setOn,
// so there is one engine: the arrows on the board and the bar above it follow
// the panel, and the panel's onToggle reports back here through setOn. The bar
// is the analysis board's (engine-bar.ts). The row shows pressed while the
// engine runs, like the opening explorer's. CSS shows the row at 600px and
// under only (review-info-sheet.css); wider screens keep the card's own switch.

import { t } from '../i18n/catalog.js';
import { createEngineBar } from './engine-bar.js';
import { REVIEW_MENU_ICONS, type ReviewMenuItem } from './review-controls.js';

/** The slice of the engine panel the toggle drives and reads. */
export interface ReviewEngineSource {
  el: HTMLElement;
  supported: boolean;
  setOn(on: boolean): void;
}

export interface ReviewEngineToggle {
  /** The ☰ toggle row. */
  menuItem: ReviewMenuItem;
  /** The engine bar; goes above the board. */
  bar: HTMLElement;
  /** The engine was switched (the panel's onToggle). */
  setOn(on: boolean): void;
  /** The panel's lines changed (its onLines). */
  sync(): void;
}

export function createReviewEngineToggle(opts: {
  signal: AbortSignal;
  engine: ReviewEngineSource;
}): ReviewEngineToggle {
  const { engine, signal } = opts;
  let on = false;
  const bar = createEngineBar({ signal, engine });

  return {
    menuItem: {
      label: t('review.menuEngineAnalysis'),
      icon: REVIEW_MENU_ICONS.engine,
      dataset: { reviewEngine: '' },
      pressed: () => on,
      onClick: () => engine.setOn(!on),
    },
    bar: bar.el,
    setOn(next) {
      on = next;
      bar.setOn(on);
    },
    sync: () => bar.sync(),
  };
}
